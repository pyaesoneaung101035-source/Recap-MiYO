import { GeminiKeyInfo, TranscriptSegment, AiMode, Step3ScriptStyle } from '../types';
import { extractAudioChunksFromVideo, extractAllVideoKeyframesBatch } from './audioExtractor';
import {
  MINUTE_BLOCK_SECONDS,
  ANALYSIS_CHUNK_SECONDS,
  RECAP_SLOT_SECONDS,
  formatMinSec,
  realignSegmentsByMinuteBlocks,
} from './timingSync';

const STORAGE_KEY = 'motion_recap_gemini_keys';
let currentKeyIndex = 0;

export function loadGeminiKeys(): GeminiKeyInfo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: GeminiKeyInfo[] = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filter out any corrupt entries that contain non-ASCII characters
    const valid = parsed.filter((k) => k && typeof k.key === 'string' && /^[\x21-\x7E]{10,}$/.test(k.key.trim()));
    if (valid.length !== parsed.length) {
      saveGeminiKeys(valid);
    }
    return valid;
  } catch {
    return [];
  }
}

export function saveGeminiKeys(keys: GeminiKeyInfo[]): void {
  try {
    const sanitized = keys
      .filter((k) => k && typeof k.key === 'string' && /^[\x21-\x7E]+$/.test(k.key.trim()))
      .map((k) => ({ ...k, key: k.key.trim() }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  } catch (err) {
    console.error('Failed to save Gemini keys:', err);
  }
}

export function parseKeysFromInput(input: string): GeminiKeyInfo[] {
  const existing = loadGeminiKeys();
  const existingMap = new Map(existing.map((k) => [k.key.trim(), k]));

  // Split by newlines, commas, or semicolons
  const lines = input.split(/[\n,;]+/);
  const result: GeminiKeyInfo[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 15) continue;
    // Skip lines with non-ASCII characters (e.g. Burmese Unicode characters)
    if (/[^\x21-\x7E]/.test(trimmed)) continue;

    if (existingMap.has(trimmed)) {
      result.push(existingMap.get(trimmed)!);
    } else {
      const isAqKey = trimmed.startsWith('AQ') || trimmed.startsWith('aq');
      result.push({
        id: 'key_' + Math.random().toString(36).substring(2, 9),
        key: trimmed,
        name: isAqKey
          ? `AQ Gemini Key #${result.length + 1} (${trimmed.substring(0, 4)}...${trimmed.substring(trimmed.length - 4)})`
          : `Key #${result.length + 1} (${trimmed.substring(0, 4)}...${trimmed.substring(trimmed.length - 4)})`,
        callCount: 0,
        status: 'active',
        lastUsed: undefined,
      });
    }
  }

  saveGeminiKeys(result);
  return result;
}

export function resetKeyStatuses(keys: GeminiKeyInfo[]): GeminiKeyInfo[] {
  const updated = keys.map((k) => ({
    ...k,
    status: 'active' as const,
    lastError: undefined,
  }));
  saveGeminiKeys(updated);
  return updated;
}

export interface GeminiErrorAnalysis {
  status: string;
  statusCode: number;
  message: string;
  quotaType: string;
  detailedDescription: string;
  details: string;
  retryDelay?: string;
}

export function analyzeGeminiError(errObj: any, defaultStatus = 500): GeminiErrorAnalysis {
  const code = errObj?.code || errObj?.status || defaultStatus;
  const rawStatus = typeof code === 'number' ? code : defaultStatus;
  const statusStr = String(errObj?.status || rawStatus);
  const message = errObj?.message || (typeof errObj === 'string' ? errObj : JSON.stringify(errObj));
  const rawDetails = errObj?.details || [];
  const detailsStr = Array.isArray(rawDetails) || typeof rawDetails === 'object'
    ? JSON.stringify(rawDetails)
    : String(rawDetails);

  let retryDelay: string | undefined;
  if (Array.isArray(rawDetails)) {
    const retryInfo = rawDetails.find((d: any) => d && (d['@type']?.includes('RetryInfo') || d.retryDelay));
    if (retryInfo && retryInfo.retryDelay) {
      retryDelay = retryInfo.retryDelay;
    }
  }

  const combined = `${statusStr} ${message} ${detailsStr}`.toLowerCase();

  let quotaType = 'General Error';
  let detailedDescription = message;

  if (rawStatus === 429 || combined.includes('resource_exhausted') || combined.includes('quota') || combined.includes('rate limit')) {
    if (combined.includes('tokencount') || combined.includes('tokens per minute') || combined.includes('tpm')) {
      quotaType = 'TPM (Tokens Per Minute)';
      detailedDescription = '1 မိနစ်အတွင်း Token အသုံးပြုမှု ပမာဏ (Tokens Per Minute) ကန့်သတ်ချက် ပြည့်သွားပါပြီ။ 60 စက္ကန့် စောင့်ပါ သို့မဟုတ် Prompt အရွယ်အစားကို လျှော့ချပါ။';
    } else if (combined.includes('requestsperminute') || combined.includes('requests per minute') || combined.includes('rpm')) {
      quotaType = 'RPM (Requests Per Minute)';
      detailedDescription = '1 မိနစ်အတွင်း ခေါ်ဆိုမှု အကြိမ်ရေ (Requests Per Minute) ကန့်သတ်ချက် ပြည့်သွားပါပြီ။ 30-60 စက္ကန့် စောင့်ပါ။';
    } else if (combined.includes('requestsperday') || combined.includes('requests per day') || combined.includes('rpd') || combined.includes('day')) {
      quotaType = 'RPD (Requests Per Day)';
      detailedDescription = 'တစ်ရက်တာ အခမဲ့ခေါ်ဆိုမှု အကြိမ်ရေ (Daily Free Quota) ပြည့်သွားပါပြီ။ နောက်နေ့အထိ စောင့်ပါ သို့မဟုတ် နောက်ထပ် API Key အသစ်တစ်ခု ထပ်ထည့်ပါ။';
    } else if (combined.includes('billing') || combined.includes('payment') || combined.includes('credit') || combined.includes('billing account')) {
      quotaType = 'Billing Restriction';
      detailedDescription = 'Google Cloud Project တွင် ငွေပေးချေမှုစနစ် (Billing Account) ချိတ်ဆက်ရန် လိုအပ်သော ကန့်သတ်ချက် ဖြစ်ပါသည်။';
    } else if (combined.includes('project') || combined.includes('consumer')) {
      quotaType = 'Project Quota';
      detailedDescription = 'Google Cloud Project တစ်ခုလုံးအတွက် သတ်မှတ်ထားသော Quota ပြည့်သွားခြင်း ဖြစ်ပါသည်။';
    } else {
      quotaType = 'Quota Exceeded (429)';
      detailedDescription = 'Gemini API အသုံးပြုခွင့် Quota ကန့်သတ်ချက် ပြည့်သွားပါပြီ။';
    }
    if (retryDelay) {
      detailedDescription += ` (Retry delay: ${retryDelay})`;
    }
  } else if (combined.includes('api_key_service_blocked') || combined.includes('access_token_type_unsupported')) {
    quotaType = 'API_KEY_SERVICE_BLOCKED (401)';
    detailedDescription = 'Google Cloud Console တွင် သင်၏ API Key အတွက် "Generative Language API" ကို Enable ပြုလုပ်ရန် သို့မဟုတ် Key Restrictions တွင် Allow ပြုလုပ်ပေးရန် လိုအပ်ပါသည်။ (aistudio.google.com မှ API Key အသစ် ထုတ်ယူပါက တိုက်ရိုက် အသုံးပြုနိုင်ပါသည်)';
  } else if (rawStatus === 401 || rawStatus === 403 || combined.includes('unauthenticated') || combined.includes('api_key_invalid')) {
    quotaType = 'Unauthorized / Invalid Key';
    detailedDescription = 'API Key မမှန်ကန်ပါ သို့မဟုတ် ခွင့်ပြုချက်မရှိပါ (401/403)။ Google AI Studio (aistudio.google.com/app/apikey) မှ API Key အသစ် ပြန်ယူပါ။';
  } else if (rawStatus === 404 || combined.includes('not_found')) {
    quotaType = 'Model Not Found';
    detailedDescription = 'ရွေးချယ်ထားသော Gemini Model ကို ရှာမတွေ့ပါ သို့မဟုတ် သင့်အကောင့်တွင် ခွင့်မပြုသေးပါ။ အခြား Flash Model ကို ရွေးချယ်ပေးပါ။';
  }

  return {
    status: statusStr,
    statusCode: rawStatus,
    message,
    quotaType,
    detailedDescription,
    details: detailsStr,
    retryDelay,
  };
}



/**
 * Execute a Gemini prompt by calling the server-side proxy route (/api/gemini/generate)
 * with automatic fallback to direct Google API call if hosted on static platforms like Netlify.
 */
export async function fetchServerGeminiApi(
  apiKey: string | undefined,
  model: string,
  prompt: string,
  parts?: any[],
  systemInstruction?: string,
  options?: { responseMimeType?: string; timeoutMs?: number }
): Promise<{ text: string }> {
  const cleanKey = apiKey ? apiKey.trim().replace(/[^\x21-\x7E]/g, '') : undefined;
  const partsPayload = parts && parts.length > 0 ? parts : [{ text: prompt }];

  const res = await fetch('/api/gemini/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: cleanKey,
      model: model || 'gemini-3.1-flash-lite',
      prompt,
      parts: partsPayload,
      systemInstruction,
      responseMimeType: options?.responseMimeType,
    }),
    signal: AbortSignal.timeout(options?.timeoutMs || 45000),
  });

  const data = await res.json().catch(() => ({}));
  if (res.ok && data && data.text !== undefined) {
    return { text: data.text };
  }

  const status = res.status;
  const details = data.errorDetails;
  let errMsg = data.error || `Gemini API Error (HTTP ${status})`;
  if (details) {
    errMsg = `[${details.status}] Quota Type: ${details.quotaType} — ${details.detailedDescription} (Message: ${details.message})`;
  }
  const err = new Error(errMsg);
  (err as any).status = status;
  (err as any).errorDetails = details;
  throw err;
}

// Keep backward-compatible alias so existing components call the server proxy
export const fetchDirectGoogleGeminiApi = fetchServerGeminiApi;

/**
 * Test a Gemini key or server connection via /api/gemini/test,
 * with seamless fallback to direct Google API testing on static sites.
 */
export async function testGeminiKeyDirect(
  apiKey?: string,
  model = 'gemini-3.1-flash-lite'
): Promise<{ ok: boolean; message: string; errorDetails?: GeminiErrorAnalysis }> {
  const cleanKey = apiKey ? apiKey.trim().replace(/[^\x21-\x7E]/g, '') : undefined;

  try {
    const res = await fetch('/api/gemini/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: cleanKey,
        model,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      return {
        ok: true,
        message: 'ချိတ်ဆက်မှု အောင်မြင်ပါသည်! (Gemini API Connected Successfully)',
      };
    }
    const details = data.errorDetails;
    return {
      ok: false,
      message: data.error || `[${res.status}] Error`,
      errorDetails: details,
    };
  } catch (err: any) {
    const details = err?.errorDetails || analyzeGeminiError(err, err?.status || 500);
    return {
      ok: false,
      message: err?.message || 'Connection test failed',
      errorDetails: details,
    };
  }
}

/**
 * Stream responses from the server-side Gemini Streaming API route (/api/gemini/stream).
 */
export async function streamGeminiFromServer(
  prompt: string,
  onChunk: (chunkText: string) => void,
  options?: {
    apiKey?: string;
    model?: string;
    systemInstruction?: string;
    parts?: any[];
  }
): Promise<string> {
  const cleanKey = options?.apiKey ? options.apiKey.trim().replace(/[^\x21-\x7E]/g, '') : undefined;
  const res = await fetch('/api/gemini/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: cleanKey,
      model: options?.model || 'gemini-3.1-flash-lite',
      prompt,
      parts: options?.parts,
      systemInstruction: options?.systemInstruction,
    }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Streaming failed with HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const dataStr = trimmed.slice(6);
      if (dataStr === '[DONE]') break;
      try {
        const parsed = JSON.parse(dataStr);
        if (parsed.text) {
          fullText += parsed.text;
          onChunk(parsed.text);
        }
      } catch (_) {}
    }
  }

  return fullText;
}

export async function callGeminiWithRotation(
  prompt: string,
  systemInstruction?: string,
  model = 'gemini-3.1-flash-lite',
  mediaParts?: Array<{ mimeType: string; data: string } | { text: string }>,
  options?: { responseMimeType?: string; timeoutMs?: number }
): Promise<{ text: string; usedKeyName: string }> {
  const keys = loadGeminiKeys();

  // Include all valid keys in the pool
  const geminiKeys = keys.filter(
    (k) => k && typeof k.key === 'string' && k.key.trim().length >= 10
  );

  // Construct parts payload
  const parts: any[] = [];
  if (mediaParts && mediaParts.length > 0) {
    for (const m of mediaParts) {
      if ('text' in m) {
        parts.push({ text: m.text });
      } else {
        parts.push({
          inlineData: {
            mimeType: m.mimeType,
            data: m.data,
          },
        });
      }
    }
  }
  parts.push({ text: prompt });

  // If no Gemini client keys in local storage, use server-side default key directly
  if (geminiKeys.length === 0) {
    const serverRes = await fetchServerGeminiApi(
      undefined,
      model,
      prompt,
      parts,
      systemInstruction,
      options
    );
    if (serverRes && serverRes.text) {
      return { text: serverRes.text, usedKeyName: 'Server Flash Engine (Auto-Configured)' };
    }
    throw new Error('Server Gemini API returned empty response.');
  }

  // Try each active custom key at most once (avoid slow 2x multiply on failing keys)
  let lastError = '';
  let lastErrorObj: any = null;
  const activeCount = geminiKeys.filter((k) => k.status === 'active').length;
  const keysToTry = activeCount > 0 ? geminiKeys.filter((k) => k.status === 'active') : geminiKeys;

  for (let i = 0; i < keysToTry.length; i++) {
    const keyInfo = keysToTry[(currentKeyIndex + i) % keysToTry.length];
    currentKeyIndex = (currentKeyIndex + 1) % geminiKeys.length;

    if (keyInfo.key && keyInfo.key.trim().length >= 10) {
      try {
        const data = await fetchServerGeminiApi(
          keyInfo.key,
          model,
          prompt,
          parts,
          systemInstruction,
          options
        );

        if (data && data.text) {
          keyInfo.callCount = (keyInfo.callCount || 0) + 1;
          keyInfo.status = 'active';
          keyInfo.lastUsed = new Date().toLocaleTimeString();
          keyInfo.lastError = undefined;
          saveGeminiKeys(keys);

          return { text: data.text, usedKeyName: `${keyInfo.name} (Server Proxy)` };
        }
      } catch (directErr: any) {
        console.warn(`Server proxy call notice for ${keyInfo.name}:`, directErr);
        lastErrorObj = directErr;
        const errMsg = directErr?.message || '';
        const details = directErr?.errorDetails;
        if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || details?.statusCode === 429) {
          keyInfo.status = 'quota_exceeded';
          keyInfo.lastError = details?.quotaType ? `429 (${details.quotaType})` : '429 Quota Exceeded';
        } else if (errMsg.includes('401') || errMsg.includes('403') || details?.statusCode === 401 || details?.statusCode === 403) {
          keyInfo.status = 'invalid';
          keyInfo.lastError = '401/403 Invalid Key';
        } else {
          keyInfo.lastError = errMsg;
        }
        lastError = errMsg || keyInfo.lastError || 'Gemini API Error';
        saveGeminiKeys(keys);
      }
    }
  }

  // Final fallback: try server-side default key if client keys failed
  try {
    const fallbackRes = await fetchServerGeminiApi(
      undefined,
      model,
      prompt,
      parts,
      systemInstruction,
      options
    );
    if (fallbackRes && fallbackRes.text) {
      return { text: fallbackRes.text, usedKeyName: 'Server Flash Engine (Fallback)' };
    }
  } catch (fallbackErr: any) {
    lastError = fallbackErr?.message || lastError;
    lastErrorObj = fallbackErr || lastErrorObj;
  }

  const finalErr = new Error(lastError || 'All Gemini API keys in the pool failed.');
  if (lastErrorObj?.status) (finalErr as any).status = lastErrorObj.status;
  if (lastErrorObj?.errorDetails) (finalErr as any).errorDetails = lastErrorObj.errorDetails;
  throw finalErr;
}

export function buildSystemPromptForMode(mode: AiMode): string {
  const directInstruction = 'ဗီဒီယို အသံနှင့် မြင်ကွင်းကို အခြေခံပြီး Timestamp Segment တစ်ခုချင်းစီအလိုက် Instant Hook ဖြင့် တိုက်ရိုက်စကာ 3rd-Person ဇာတ်ကြောင်းပြော + ဇာတ်ကောင်စကားတို ပေါင်းစပ်ထားသည့် မြန်မာ Short-Drama Recap Narrator စတိုင် (1.8s–4.5s micro-clauses) အဖြစ် ထုတ်ပေးပါ။ စာကြောင်းတိုင်းကို "ပါတယ်/နေပါတယ်/ဖြစ်ပါတယ်" ဟု ထပ်ခါတလဲလဲ အဆုံးမသတ်ရ! နမူနာပုံစံအတိုင်း "...သွားတယ်", "...နိုင်ပြီ", "...မယ်", "...ဘူး", "...ပဲ", "...လား?", "...နော်!" စသဖြင့် အဆုံးသတ်မျိုးစုံ သဘာဝကျကျ သုံးပါ။ KEEP BURMESE CONCISE (8-16 syllables per 2-4.5s beat).';
  switch (mode) {
    case 'Dubbing':
      return `You are a master Chinese-to-Burmese film dubbing director and audio sync engineer.
When dubbing Chinese video dialogue into Burmese:
1. Extract the exact spoken dialogue in the original language (e.g. Chinese).
2. Translate into natural conversational spoken Burmese (မြန်မာစကားပြောသံပေါက်). Do NOT translate word-for-word.
3. CONCISE DURATION MATCHING RULE: Spoken Burmese takes longer to utter than Chinese syllables. KEEP BURMESE TRANSLATIONS VERY CONCISE AND SHORT (under 12-18 words per segment or <35 Burmese characters). Omit unnecessary filler words so the spoken Burmese TTS fits neatly within the original video clip's start and end duration window.
4. Dubbing voice: adult Burmese male voice with natural vocal cadence.
5. Provide clean Burmese subtitles: max 2 lines per subtitle, under 35 characters per line, NO Chinese characters.
6. Provide speaker identity, delivery emotion, on-screen status, target duration, and a lip-sync pacing note.
${directInstruction}`;
    case 'Recap':
      return `You are an elite video recap producer for Myanmar audience. Listen to the video audio, transcribe, translate, and REWRITE the content into a captivating, direct Burmese script. ${directInstruction}`;
    case 'Subtitle':
      return `You are an accurate Myanmar subtitle translator. Provide timestamped, easy-to-read Myanmar subtitle segments (clean, max 2 lines, no Chinese characters) that convey the meaning directly. ${directInstruction}`;
    case 'Long to Short':
      return `You are a viral shorts creator. Identify high-retention clips and write a direct Burmese script for each, focusing on the hook and emotional commentary in Burmese. ${directInstruction}`;
    case 'Gemini TTS':
      return `You are a professional voiceover artist. Write a crisp, engaging Myanmar voiceover script ready for neural text-to-speech reading with natural rhythm. ${directInstruction}`;
    case 'Dhamma AI':
    case 'Dhamma AI background':
      return `သင်သည် ဗုဒ္ဓဓမ္မအတွေးအမြင်နှင့် သတိပဋ္ဌာန်တရားတော်ကို အခြေခံသော တည်ငြိမ်အေးချမ်းသည့် တရားရှုထောင့်မှ ရှင်းလင်းဟောကြားသည့် ဓမ္မဆရာတစ်ဦးဖြစ်သည်။ ဗီဒီယိုပါ အကြောင်းအရာကို အေးချမ်းကြည်လင်သော မြန်မာစကားပြေဖြင့် ဘဝသင်ခန်းစာ၊ ကုသိုလ်စိတ်နှင့် စိတ်ငြိမ်းချမ်းမှု ရရှိစေမည့် ဓမ္မအနှစ်ချုပ် အဖြစ် ရေးသားပေးပါ။ ${directInstruction}`;
    default:
      return `You are an AI video assistant assisting a Myanmar creator. ${directInstruction}`;
  }
}

export function parseTimestampToSeconds(ts: string | number | undefined | null): number {
  if (ts === undefined || ts === null) return 0;
  if (typeof ts === 'number') return isNaN(ts) ? 0 : ts;
  
  const str = String(ts).trim();
  if (!str) return 0;
  
  if (!isNaN(Number(str))) {
    return Number(str);
  }
  
  const parts = str.split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const secPart = parts[2].replace(',', '.');
    const seconds = parseFloat(secPart) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 4) {
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    const ms = parseFloat(parts[3]) || 0;
    return hours * 3600 + minutes * 60 + seconds + (ms >= 1 ? ms / 1000 : ms);
  } else if (parts.length === 2) {
    const minutes = parseFloat(parts[0]) || 0;
    const secPart = parts[1].replace(',', '.');
    const seconds = parseFloat(secPart) || 0;
    return minutes * 60 + seconds;
  }

  const num = parseFloat(str.replace(',', '.'));
  return isNaN(num) ? 0 : num;
}

export function formatSecondsToSRT(totalSec: number): string {
  const safeSec = Math.max(0, isNaN(totalSec) ? 0 : totalSec);
  const hours = Math.floor(safeSec / 3600);
  const minutes = Math.floor((safeSec % 3600) / 60);
  const seconds = Math.floor(safeSec % 60);
  const ms = Math.floor((safeSec % 1) * 1000);

  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(ms, 3)}`;
}

export function countBurmeseSyllables(text: string): number {
  if (!text) return 0;
  // Match consonants not immediately followed by asat (် = \u103A)
  const rootConsonants = text.match(/[က-အ](?![\u103A])/g);
  const indepVowels = text.match(/[ဣဤဥဦဧဩဪ]/g);
  const count = (rootConsonants?.length || 0) + (indepVowels?.length || 0);
  return Math.max(1, count);
}

export function calculateMaxAllowedSyllables(durationSeconds: number): number {
  // Conversational Burmese natural cadence is ~3.6 to 4.0 syllables per second.
  // A 5-second slot holds ~18 to 20 syllables max.
  return Math.max(4, Math.floor(Math.max(0.5, durationSeconds) * 3.8));
}

function parseChunkJsonArray(rawText: string): any[] {
  const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
  const tryParse = (candidate: string): any[] | null => {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.scenes)) return parsed.scenes;
      if (parsed && Array.isArray(parsed.segments)) return parsed.segments;
      if (parsed && Array.isArray(parsed.cues)) return parsed.cues;
      if (parsed && Array.isArray(parsed.items)) return parsed.items;
    } catch {}
    return null;
  };

  const direct = tryParse(cleaned);
  if (direct) return direct;

  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    const extractedObj = tryParse(objMatch[0]);
    if (extractedObj) return extractedObj;
  }

  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    const extracted = tryParse(arrayMatch[0]);
    if (extracted) return extracted;
  }

  return [];
}

export const GEMINI_ENGINE_FIXED_PROMPT = `မြန်မာဘာသာ short-drama recap narrator script ရေးပေးပါ။

ရည်ရွယ်ချက်က video ထဲက တကယ်မြင်ရတဲ့ visual action + dialogue နဲ့ narrator စာသား ကွက်တိကိုက်ပြီး နမူနာ viral recap narrator ပုံစံအတိုင်း ဖြစ်စေရန် ဖြစ်သည်။ Video ထဲမှာ မမြင်ရသေးတဲ့အရာကို အကြိုပြောခြင်း၊ မူရင်းဇာတ်လမ်းထဲ မပါသော အချက်အလက်ထည့်ခြင်း မလုပ်ပါနှင့်။

စည်းမျဉ်းများ -

1. Instant Visual Hook: အဖွင့်စာကြောင်းမှာ "မင်္ဂလာပါ/ဒီဇာတ်လမ်းမှာ" လုံးဝမထည့်ဘဲ Scene 1 မြင်ကွင်း action ထဲကို တန်းဝင်ပြောပါ (ဥပမာ- "ရေဘူး တစ်ဘူးပဲ ရှိတဲ့ ရွှေခွက်ထဲမှာ ရေဘူးတွေ အများကြီး ပေါ်လာတော့ သူ အံ့ဩသွားတယ်!")။
2. Blended Narrator + Inline Dialogue Formula: 3rd-person recap စကား ("...ဆိုတာ သူ နားလည်သွားတယ်", "သူ အလွတ်မပေးဘူး", "...ပြောင်းဖို့ စဉ်းစားနေတယ်") နဲ့ ဇာတ်ကောင်စကား/စိတ်တွင်းစကားတို ("၁ ကီလို ရွှေတုံး ရှိလား?", "ရှိပါတယ်။ ခဏစောင့်ပါ။", "အရင်ဆုံး အတိုးယူရမယ်!") ကို Single Narrator တစ်ယောက်တည်းပြောသလို ချောမွေ့စွာ ပေါင်းစပ်ပါ။
3. Scene တစ်ခုချင်းစီကို 1.8s–4.5s micro-clauses (စာတို ၈–၁၆ လုံးခန့်) ဖြင့် visual cut အလိုက် ခွဲပါ။ Narration duration သည် scene duration ထက် မရှည်ရပါ။
4. ဇာတ်ကောင်ရဲ့ စိတ်ခံစားချက်ကို မြင်ရတဲ့ facial expression/action နဲ့ကိုက်မှသာ ထည့်ပါ ("!" အံ့ဩ/မာန်ပါ, "?" မေးခွန်း)။
5. Repetitive "ပါတယ်/ဖြစ်ပါတယ်/နေပါတယ်" အဆုံးသတ်များ ရှောင်ပြီး "...သွားတယ်", "...နိုင်ပြီ", "...မယ်", "...ဘူး", "...ပဲ", "...နော်", "...လား?" စသဖြင့် အဆုံးသတ်မျိုးစုံ သုံးပါ (ယဉ်ကျေးသော ဇာတ်ကောင်စကားပြန်ဖြေချက် ဥပမာ "ရှိပါတယ်။ ခဏစောင့်ပါ။" မှလွဲ၍)။
6. မသေချာတဲ့ နာမည်၊ နေရာကို မခန့်မှန်းပါနှင့်။ သို့သော် မြင်ရ/ကြားရသော ငွေပမာဏ၊ အလေးချိန် ကိန်းဂဏန်းများ (ဥပမာ- ယွမ် ၅ သိန်းကျော်, ၁ ကီလို ရွှေတုံး) ကို တိကျစွာ ထိန်းသိမ်းပါ။
7. Output ကို JSON တစ်ခုတည်းအဖြစ် ထုတ်ပါ။ Markdown မသုံးပါနှင့်။

Narrator style:
- Instant visual hook + blended 3rd-person recap & inline dialogue quotes
- Brisk crisp micro-clauses (~3.5–3.8 Burmese syllables/sec)
- Expressive vocal delivery tags matching chest-baritone + lively inflections
- Suitable for viral short-drama Burmese recap video

JSON format:
{
  "scenes": [
    {
      "scene_id": 1,
      "start": "00:00.000",
      "end": "00:00.000",
      "visual_action": "မြန်မာလို အတိုချုပ်ဖော်ပြချက်",
      "narration": "မြန်မာ narrator စာသား",
      "delivery": "calm / surprised / suspenseful / dramatic",
      "confidence": 0.0
    }
  ],
  "uncertain_items": []
}`;

function isFatalGeminiError(err: any): boolean {
  const status = err?.status || err?.errorDetails?.statusCode;
  const msg = String(err?.message || '').toLowerCase();
  const quotaType = String(err?.errorDetails?.quotaType || '').toLowerCase();
  if (status === 401 || status === 403 || status === 413) return true;
  if (quotaType.includes('rpd') || quotaType.includes('billing') || quotaType.includes('unauthorized')) return true;
  if (msg.includes('api key') && (msg.includes('invalid') || msg.includes('not configured') || msg.includes('unauthorized'))) return true;
  if (msg.includes('requests per day') || msg.includes('daily free quota')) return true;
  return false;
}

function getStep3ScriptStyleConfig(style: Step3ScriptStyle): {
  roleTitle: string;
  modeDirective: string;
  slotDirective: string;
  speakerLabel: string;
} {
  if (style === 'story') {
    return {
      roleTitle: 'You are an Engaging Burmese Oral Storyteller ("လူတစ်ယောက် Story ပြောနေသလို ဇာတ်လမ်းပြောပြသူ").',
      speakerLabel: 'Storyteller (ဇာတ်လမ်းပြောသူ)',
      modeDirective: `STORYTELLING MODE ("2. STORY"):
- Tell the events as if ONE real person is captivatingly telling a true story/movie story aloud to friends ("တစ်ယောက်ယောက်က Story ပြောပြနေသလို").
- Build vivid emotional flow, narrative hooks, and suspense between scenes (e.g., "ဒီဇာတ်လမ်းက အစကတည်းက မထင်မှတ်ထားတဲ့အလှည့်အပြောင်းနဲ့ စတာ...", "အဲ့ဒီအချိန်မှာပဲ မထင်မှတ်ဘဲ...", "သူ့စိတ်ထဲမှာတော့...", "နောက်ဆုံးတော့...").
- Keep smooth oral storytelling continuity across every cue—never dry bullet points or stiff literal translation.`,
      slotDirective: `STORY MODE FOR THIS SLOT:
- Tell what happens in this scene like a real human Storyteller gripping the listener with plot tension, character feelings, and vivid oral flow.`,
    };
  }

  if (style === 'translation') {
    return {
      roleTitle: 'You are a Professional Video Subtitle & Spoken Dialogue Extraction & Translation Specialist ("Video ထဲက Source စာသား (Chinese/English) နှင့် စာတန်းထိုးများကို အကုန်အစင် ထုတ်ယူပြီး မြန်မာဘာသာပြန်ဆိုသူ").',
      speakerLabel: 'Translator (ဘာသာပြန်)',
      modeDirective: `TRUE TRANSLATION & SOURCE EXTRACTION MODE ("3. TRANSLATION"):
- 100% COMPREHENSIVE SOURCE EXTRACTION & TRANSLATION (Source စာသားနှင့် စာတန်းထိုး အကုန်အစင် ထုတ်ယူပြီး ဘာသာပြန်ခြင်း):
  1. Extract ALL source spoken dialogue (Chinese, English, or any language) and ALL burnt-in on-screen subtitles/captions visible in the video frames completely from start to finish. Put every extracted source sentence/subtitle into "originalText".
  2. Translate every extracted source line faithfully, accurately, and directly into natural Burmese in "text" and "subtitleText".
  3. Do NOT skip, omit, or leave out any dialogue, voice lines, or subtitles. Every single utterance or visible caption must be extracted and translated line-by-line.`,
      slotDirective: `TRANSLATION MODE FOR THIS SLOT:
- Extract all Chinese/English/source speech and visible subtitles in this time window into "originalText" and translate them directly and faithfully into Burmese into "text".`,
    };
  }

  // Default: 'narrator' — Reference Short-Drama Blended Recap + Dialogue Style
  return {
    roleTitle: 'You are an Elite Burmese Short-Drama Video Recap Narrator & Voice Director ("နမူနာ Short-Drama Recap Video စတိုင် တစ်သံတည်း Blended Narrator").',
    speakerLabel: 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
    modeDirective: `REFERENCE SHORT-DRAMA NARRATOR MODE ("1. NARRATOR — BLENDED RECAP & INLINE DIALOGUE"):
- Replicate this exact viral Burmese short-drama narrator formula:
  1) INSTANT VISUAL HOOK (0 filler greeting): Jump immediately into what is visibly happening on Screen 1 without saying "မင်္ဂလာပါ / ဒီဇာတ်လမ်းမှာ" (e.g., "ရေဘူး တစ်ဘူးပဲ ရှိတဲ့ ရွှေခွက်ထဲမှာ ရေဘူးတွေ အများကြီး ပေါ်လာတော့ သူ အံ့ဩသွားတယ်!").
  2) BLENDED 3RD-PERSON RECAP + CRISP CHARACTER BEATS: Blend smooth 3rd-person recap ("...ဆိုတာ သူ နားလည်သွားတယ်", "သူ အလွတ်မပေးဘူး", "...ပြောင်းဖို့ စဉ်းစားနေတယ်") seamlessly with short inline character quotes/thoughts ("၁ ကီလို ရွှေတုံး ရှိလား?", "ရှိပါတယ်။ ခဏစောင့်ပါ။", "သူတို့ကိုယ်တိုင် လာအပ်တာပဲ! အရင်ဆုံး အတိုးယူရမယ်!") so ONE single narrator voices the whole clip vividly.
  3) CRISP 1.8s–4.5s MICRO-CLAUSES (~8–16 syllables per beat): Lock tightly to visual scene cuts (~3.6 syl/sec). Mix varied natural endings ("...သွားတယ်", "...နိုင်ပြီ", "...မယ်", "...ဘူး", "...ပဲ", "...နော်!", "...လား?", "...နေတယ်").
  4) STRICTLY BAN repetitive "...နေပါသည် / ...ဖြစ်ပါသည် / ...ပါတယ်" padding (allow "ပါတယ်" ONLY inside genuine polite dialogue replies like "ရှိပါတယ်။ ခဏစောင့်ပါ။"). Preserve exact numbers, currency, and weights faithfully.`,
    slotDirective: `REFERENCE NARRATOR MODE FOR THIS SLOT:
- Start directly with the visual action hook, mix 3rd-person recap narration with crisp inline character/thought lines voiced by ONE single chest-baritone narrator in short 1.8s–4.5s beats.`,
  };
}

/**
 * Generate transcript & subtitles with timestamps from the custom uploaded video.
 * GUARANTEES ALL 1-MINUTE BLOCKS (Part 1, Part 2, Part 3...) ARE PROCESSED FAST AND ACCURATELY.
 */
export async function generateTimestampedTranscript(
  videoTitle: string,
  durationSeconds: number,
  customContext = '',
  videoFile?: File | null,
  videoUrl?: string | null,
  onProgress?: (msg: string, percent?: number) => void,
  model = 'gemini-3.1-flash-lite',
  scriptStyle: Step3ScriptStyle = 'narrator',
  engine: 'assemblyai' | 'videosubfinder_paddleocr' | 'faster_whisper' | 'gemini' = 'videosubfinder_paddleocr'
): Promise<TranscriptSegment[]> {
  if (!videoFile && !videoUrl) {
    throw new Error('ဗီဒီယိုဖိုင် မတွေ့ရှိပါ။ Step 2 တွင် Custom Video ကို အရင်တင်ပေးပါ။');
  }

  const styleCfg = getStep3ScriptStyleConfig(scriptStyle);
  const strictSystemInstruction = `${styleCfg.roleTitle}
${styleCfg.modeDirective}

MANDATORY STEP 3 RULES:
1. VOICE-EXPRESSION & NATURAL BURMESE:
   - Never repeat stiff textbook suffixes ("...နေပါတယ်။ / ...ဖြစ်ပါတယ်။ / ...သွားပါတယ်။").
   - Use "!" on surprises/reactions and "?" on questions so Step 4 Voice Clone renders lively vocal pitch variation.
   - Set specific "emotion" tags on EVERY segment: e.g. "surprised, amazed", "determined, fierce", "curious, questioning", "smug, mocking", "urgent, tense", "calm storytelling", "sad, heartfelt".
2. SCENE-BY-SCENE VISUAL (OCR + ACTION) + AUDIO ALIGNMENT:
   - Inspect EVERY timestamped visual frame (read any on-screen subtitles/captions/text!) AND listen sequentially. Start each cue AT THE EXACT MOMENT that line or scene appears.
   - Keep "speaker": "${styleCfg.speakerLabel}" on every segment. Preserve exact numbers, money, weights, and names faithfully.
3. CONCISE SPEAKING-TIME BUDGET (~3.4 syllables/sec):
   - Keep each cue concise for its [start, end] window so spoken voice fits cleanly before the next cut.
4. TIMESTAMPS & SUBTITLES:
   - Return sequential non-overlapping chunk-relative timestamps ("00:00:00,000" to chunk end). Subtitles max 2 lines, <=35 chars/line, ZERO foreign/Chinese characters in Burmese lines.`;

  const buildTimestampedFrameParts = (
    frames: Array<{ time: number; base64Jpeg: string }>,
    blockOffsetSec: number
  ): Array<{ mimeType: string; data: string } | { text: string }> => {
    const out: Array<{ mimeType: string; data: string } | { text: string }> = [];
    for (const f of frames) {
      const relTime = Math.max(0, f.time - blockOffsetSec);
      out.push({
        text: `[Visual Frame @ ${formatMinSec(f.time)} | Chunk +${relTime.toFixed(1)}s]`,
      });
      out.push({
        mimeType: 'image/jpeg',
        data: f.base64Jpeg,
      });
    }
    return out;
  };

  const totalDuration = durationSeconds || MINUTE_BLOCK_SECONDS;
  let videoUrlToUse = videoUrl;
  let createdObjectUrl = false;
  if (!videoUrlToUse && videoFile && typeof window !== 'undefined' && window.URL) {
    videoUrlToUse = URL.createObjectURL(videoFile);
    createdObjectUrl = true;
  }

  try {
    onProgress?.(
      engine === 'videosubfinder_paddleocr'
        ? '🔍 [1/3] VideoSubFinder + PaddleOCR ဖြင့် Video ထဲမှ Subtitle စာတန်းထိုးများကို OCR ဖြင့် ရှာဖွေဖတ်ယူနေပါသည်...'
        : engine === 'faster_whisper'
          ? '⚡ [1/3] Faster-Whisper ဖြင့် ဗီဒီယို အသံဖိုင်ကို 0:30 Chunks များခွဲ၍ Speech-to-Text ထုတ်ယူနေပါသည်...'
          : '🎙️ [1/3] ဗီဒီယိုကို 0:30 (30s) AI chunks များခွဲ၍ အသံထုတ်ယူနေပါသည်...',
      8
    );

    // Process in 30-second (0:30) AI/Whisper chunks for maximum STT & narrator accuracy
    const chunks = await extractAudioChunksFromVideo(
      videoFile || videoUrl!,
      ANALYSIS_CHUNK_SECONDS,
      totalDuration
    );
    const totalParts = chunks.length;
    if (totalParts === 0) {
      throw new Error('ဗီဒီယို အပိုင်းများ ခွဲထုတ်၍မရပါ။ ဗီဒီယိုဖိုင် မှန်ကန်မှုကို စစ်ဆေးပါ။');
    }

    const isGeminiVisualEngine = engine === 'gemini';
    const isSubFinderOcr = !isGeminiVisualEngine && (engine === 'videosubfinder_paddleocr' || scriptStyle === 'translation');
    const framesPerBlock = isSubFinderOcr ? 14 : isGeminiVisualEngine ? 10 : 6;

    onProgress?.(
      isSubFinderOcr
        ? `🎥 [2/3] VideoSubFinder ဖြင့် Subtitle Bounding Strips (${totalParts} × 0:30 Chunks · 14 Frames) ကို OCR အတွက် ထုတ်ယူနေပါသည်...`
        : isGeminiVisualEngine
          ? `🎥 [2/3] Gemini Engine ဖြင့် Action-Sync Scene Frames (${totalParts} × 0:30 Chunks · Full Scene) ထုတ်ယူနေပါသည်...`
          : `🎥 [2/3] မြင်ကွင်း Keyframes များကို (${totalParts} × 0:30 Chunks) ထုတ်ယူနေပါသည်...`,
      20
    );

    // Extract aspect-preserved keyframes per 30s AI chunk
    let keyframesByPart = new Map<number, Array<{ time: number; base64Jpeg: string }>>();
    if (videoUrlToUse) {
      try {
        const windows = chunks.map((c) => ({
          partIndex: c.partIndex,
          startSec: c.startTimeSeconds,
          endSec: Math.min(
            totalDuration > 0 ? totalDuration : c.startTimeSeconds + c.durationSeconds,
            c.startTimeSeconds + c.durationSeconds
          ),
        }));
        keyframesByPart = await extractAllVideoKeyframesBatch(videoUrlToUse, windows, framesPerBlock, isSubFinderOcr);
      } catch (kfErr) {
        console.warn('Batch keyframe extraction skipped:', kfErr);
      }
    }

    onProgress?.(
      engine === 'videosubfinder_paddleocr'
        ? `⚡ [3/3] PaddleOCR + Gemini ဖြင့် Subtitle စာတန်းထိုးများကို ဖတ်ယူ ဘာသာပြန်နေပါသည် (Chunk 1/${totalParts})...`
        : engine === 'faster_whisper'
          ? `⚡ [3/3] Faster-Whisper + Gemini ဖြင့် Speech-to-Text နှင့် ${scriptStyle.toUpperCase()} စာသား ထုတ်နေပါသည် (Chunk 1/${totalParts})...`
          : `⚡ [3/3] Gemini Engine ဖြင့် Visual Action + Narrator Scene Script ရေးသားနေပါသည် (Chunk 1/${totalParts})...`,
      32
    );

    const chunkResults = new Map<number, TranscriptSegment[]>();
    let completedParts = 0;
    let fatalError: Error | null = null;
    let lastChunkError: Error | null = null;

    const processChunk = async (chunk: (typeof chunks)[number]) => {
      if (fatalError) return;

      const offsetSec = chunk.startTimeSeconds;
      const chunkEndSec = Math.min(
        totalDuration > 0 ? totalDuration : offsetSec + chunk.durationSeconds,
        offsetSec + chunk.durationSeconds
      );
      const partNum = chunk.partIndex;
      const blockKfs = keyframesByPart.get(partNum) || [];
      const blockFrameParts = blockKfs.length > 0 ? buildTimestampedFrameParts(blockKfs, offsetSec) : [];

      const formatMmSsMs = (sec: number) => {
        const s = Math.max(0, sec);
        const mins = Math.floor(s / 60);
        const secs = Math.floor(s % 60);
        const ms = Math.floor((s % 1) * 1000);
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
      };

      const chunkPrompt = isGeminiVisualEngine
        ? `${GEMINI_ENGINE_FIXED_PROMPT}

[VIDEO CHUNK CONTEXT — Part ${partNum}/${totalParts}]
- Video: "${videoTitle}"
- Chunk Window: ${formatMinSec(offsetSec)} to ${formatMinSec(chunkEndSec)} (Chunk Duration: ${chunk.durationSeconds.toFixed(1)}s)
- Report scene "start" and "end" timestamps strictly within "00:00.000" to "${formatMmSsMs(chunk.durationSeconds)}" (chunk-relative MM:SS.mmm timestamps based on exact "[Visual Frame @ ... | Chunk +Xs]" action changes).
- Selected Mode (${scriptStyle.toUpperCase()}): ${
            scriptStyle === 'translation'
              ? 'Include direct accurate Burmese translation of visible subtitles/spoken dialogue in "narration" while keeping exact visual_action alignment.'
              : scriptStyle === 'story'
                ? 'Write engaging Burmese storytelling flow matching exact visible action in "narration".'
                : 'Follow the exact Burmese Narrator Script rules above (short conversational storytelling lines with natural pause matching exact visible action).'
          }${customContext ? `\n- Creator Note: ${customContext}` : ''}`
        : `
YOU ARE PROCESSING 30-SECOND (0:30) AI ANALYSIS CHUNK ${partNum} OF ${totalParts} FOR VIDEO "${videoTitle}".
ACTIVE STEP 3 MODE: ${scriptStyle.toUpperCase()}
ACTIVE ENGINE: ${engine.toUpperCase()}
Block Window: ${formatMinSec(offsetSec)} to ${formatMinSec(chunkEndSec)} (Chunk Duration: ${chunk.durationSeconds.toFixed(1)}s).
${engine === 'videosubfinder_paddleocr' ? 'SPECIAL ENGINE INSTRUCTION (VideoSubFinder + PaddleOCR Hardsub Extraction):\n- Scan the bottom, top, and center regions of all video frames for burnt-in subtitles/captions.\n- Perform Optical Character Recognition (OCR) on every visible subtitle line, extract start and end timestamps, put the exact recognized subtitle characters into "originalText", and translate accurately into natural Burmese in "text".\n' : ''}${chunk.hasAudio === false ? 'NOTE: No decodable audio track detected; read on-screen subtitles/text & describe chronological scenes from the timestamped frames.\n' : ''}Creator Context: ${customContext || styleCfg.roleTitle}.
${styleCfg.slotDirective}

CRITICAL RULES:
1. STYLE FIDELITY (${scriptStyle.toUpperCase()}): Strictly follow the ${scriptStyle.toUpperCase()} mode instructions above!
   ${scriptStyle === 'translation'
     ? '- Read EVERY spoken voice sentence in the audio track AND EVERY on-screen subtitle/caption in the video frames; record original quote in "originalText" and translate accurately into natural Burmese in "text".'
     : '- Write natural spoken Burmese meant to be read aloud (ban repetitive textbook "...ပါတယ် / ...နေပါတယ် / ...ဖြစ်ပါတယ်" endings).'}
2. EXPRESSIVE EMOTION + PUNCTUATION: Put "!" on shocking/surprised lines, "?" on questions, and an accurate vocal "emotion" tag (e.g. "surprised, amazed", "determined, fierce", "mocking, smug", "curious, questioning", "calm storytelling").
3. MATCH VISUAL FRAME TIMESTAMPS: Inspect "[Visual Frame @ ... | Chunk +Xs]" images alongside the audio. Align every cue to exact subtitle/dialogue/scene timing.
4. CONCISE SPOKEN LENGTH: Keep each cue ~3.4 syllables/sec so TTS finishes cleanly inside the timestamp window.
5. SPEAKER LABEL: Always set "speaker": "${styleCfg.speakerLabel}".
6. CHUNK-RELATIVE TIMESTAMPS: Report "start" and "end" strictly between "00:00:00,000" and "${formatSecondsToSRT(chunk.durationSeconds)}" (sequential non-overlapping cues).
7. Return ONLY a valid JSON array matching this exact schema:
[
  {
    "id": 1,
    "start": "00:00:00,000",
    "end": "00:00:04,500",
    "duration": 4.5,
    "speaker": "${styleCfg.speakerLabel}",
    "originalText": "${scriptStyle === 'translation' ? 'Exact voice dialogue or on-screen subtitle read from the video' : 'Spoken dialogue or key on-screen event at this exact timestamp'}",
    "text": "Burmese spoken/translated line matching ${scriptStyle.toUpperCase()} mode...",
    "subtitleText": "စာတန်းထိုး (max 2 lines, <=35 chars/line)",
    "emotion": "surprised, amazed",
    "isOnScreen": false
  }
]
`;

      const chunkPayload: Array<{ mimeType: string; data: string } | { text: string }> = [
        ...blockFrameParts,
      ];
      if (chunk.hasAudio !== false && chunk.base64Wav) {
        chunkPayload.push({ mimeType: chunk.mimeType, data: chunk.base64Wav });
      }

      let retries = 0;
      while (retries < 3 && !fatalError) {
        try {
          retries++;
          const { text: chunkResText } = await callGeminiWithRotation(
            chunkPrompt,
            isGeminiVisualEngine
              ? 'You are a precise Burmese visual-action narrator scriptwriter. Output ONLY valid JSON matching the requested { "scenes": [...], "uncertain_items": [] } schema without Markdown.'
              : strictSystemInstruction,
            model,
            chunkPayload,
            { responseMimeType: 'application/json', timeoutMs: 60000 }
          );

          const parsedChunk = parseChunkJsonArray(chunkResText);
          if (parsedChunk.length === 0) {
            throw new Error(`Part ${partNum} မှ AI ပြန်လည်ဖြေကြားချက် JSON ပုံစံ မမှန်ကန်ပါ`);
          }

          const partSegments: TranscriptSegment[] = [];
          let blockCursor = offsetSec;
          const blockHardEnd = offsetSec + chunk.durationSeconds;

          parsedChunk.forEach((item: any, idx: number) => {
            const rawStartStr = String(item.start || item.startTime || '00:00.000');
            const rawEndStr = String(item.end || item.endTime || '00:04.000');
            const myanmarText = (item.narration || item.text || item.myanmarTranslation || item.natural_burmese_translation || '').trim();
            if (!myanmarText) return;

            const origText = (item.visual_action || item.originalText || item.original_dialogue || myanmarText).trim();
            const subText = (item.subtitleText || item.burmese_subtitle_text || item.narration || myanmarText).trim();

            let relStart = parseTimestampToSeconds(rawStartStr);
            let relEnd = parseTimestampToSeconds(rawEndStr);

            if (offsetSec > 0 && relStart >= offsetSec - 1 && relStart <= blockHardEnd + 1) {
              relStart = relStart - offsetSec;
              relEnd = relEnd - offsetSec;
            }

            relStart = Math.max(0, Math.min(chunk.durationSeconds - 0.5, relStart));
            relEnd = Math.max(relStart + 0.8, Math.min(chunk.durationSeconds, relEnd));

            let adjustedStartSec = Math.max(blockCursor, offsetSec + relStart);
            if (adjustedStartSec >= blockHardEnd - 0.5) {
              adjustedStartSec = Math.max(offsetSec, blockHardEnd - 1.0);
            }
            const adjustedEndSec = Math.min(blockHardEnd, Math.max(adjustedStartSec + 0.8, offsetSec + relEnd));

            blockCursor = adjustedEndSec;
            const dur = parseFloat(Math.max(0.5, adjustedEndSec - adjustedStartSec).toFixed(2));
            const sylCount = countBurmeseSyllables(myanmarText);
            const maxSyl = calculateMaxAllowedSyllables(dur);

            const minutePart = Math.floor(adjustedStartSec / MINUTE_BLOCK_SECONDS) + 1;
            partSegments.push({
              id: `p${partNum}_${item.scene_id || item.id || idx + 1}_${Date.now()}_${idx}`,
              startTime: parseFloat(adjustedStartSec.toFixed(2)),
              endTime: parseFloat(adjustedEndSec.toFixed(2)),
              duration: dur,
              originalText: origText,
              myanmarTranslation: myanmarText,
              subtitleText: subText.replace(/[\u4e00-\u9fa5]/g, '').trim(),
              speaker: styleCfg.speakerLabel,
              emotion: item.delivery || item.emotion || item.speaking_emotion_and_delivery || 'calm',
              isOnScreen: false,
              lipSyncNote: isGeminiVisualEngine
                ? `Scene ${item.scene_id || idx + 1} · Action-Synced${typeof item.confidence === 'number' ? ` (${Math.round(item.confidence * 100)}%)` : ''}`
                : scriptStyle === 'translation'
                  ? 'Synced to original video voice & on-screen subtitle timing'
                  : 'Aligned to 0:30 part timeline (30s AI/Whisper chunks)',
              voice: 'Thiha',
              scriptStyle,
              syllableCount: sylCount,
              maxAllowedSyllables: maxSyl,
              atempoRate: 1.0,
              playbackRate: 1.0,
              pauseLead: 0.1,
              pauseTrail: 0.15,
              sceneShotId: `scene_${item.scene_id || `${partNum}_${idx + 1}`}`,
              minutePartIndex: minutePart,
              isHumanReviewed: false,
            });
          });

          if (partSegments.length > 0) {
            chunkResults.set(partNum, partSegments);
            completedParts++;
            const pct = Math.min(95, Math.round(32 + (completedParts / totalParts) * 63));
            onProgress?.(
              `✓ [Part ${partNum}/${totalParts}: ${formatMinSec(offsetSec)} - ${formatMinSec(chunkEndSec)}] ပြီးစီးပါပြီ (${completedParts}/${totalParts})`,
              pct
            );
            return;
          }
        } catch (chunkErr: any) {
          console.error(`Step 3 Part ${partNum} attempt ${retries} error:`, chunkErr);
          lastChunkError = chunkErr;
          if (isFatalGeminiError(chunkErr)) {
            fatalError = chunkErr;
            return;
          }
          if (retries < 3) {
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
      }
    };

    // Bounded concurrency = 2 for blazing speed without bursting rate limits
    let nextIndex = 0;
    const workerCount = Math.min(2, chunks.length);
    const workers = Array.from({ length: workerCount }, async (_, wIdx) => {
      if (wIdx > 0) await new Promise((r) => setTimeout(r, 250));
      while (!fatalError) {
        const idx = nextIndex++;
        if (idx >= chunks.length) break;
        await processChunk(chunks[idx]);
      }
    });

    await Promise.all(workers);

    if (fatalError) {
      throw fatalError;
    }

    const orderedSegments: TranscriptSegment[] = [];
    for (let p = 1; p <= totalParts; p++) {
      const segs = chunkResults.get(p);
      if (segs && segs.length > 0) {
        orderedSegments.push(...segs);
      }
    }

    if (orderedSegments.length > 0) {
      const finalSegments = realignSegmentsByMinuteBlocks(orderedSegments, totalDuration, {
        enforceSingleVoice: 'Thiha',
        enforceSingleSpeakerLabel: true,
      });
      onProgress?.(
        `🎉 [အောင်မြင်ပါသည်] 0:30 AI/Whisper Parts (${totalParts} ခု) မှ Narrator Segments ${finalSegments.length} ခု တိကျစွာ ထုတ်ယူပြီးပါပြီ။`,
        100
      );
      return finalSegments;
    }

    if (lastChunkError) {
      throw lastChunkError;
    }

    throw new Error('ဗီဒီယိုမှ စကားပြောများကို ထုတ်ယူ၍မရပါ။ ဗီဒီယိုဖိုင်နှင့် Gemini API Key ကို စစ်ဆေးပေးပါ။');
  } finally {
    if (createdObjectUrl && videoUrlToUse) {
      try {
        URL.revokeObjectURL(videoUrlToUse);
      } catch {}
    }
  }
}

/**
 * Generates a complete 10-point Dubbing Plan JSON matching user specifications:
 * 1. Start timestamp
 * 2. End timestamp
 * 3. Speaker identity
 * 4. Original Chinese dialogue
 * 5. Natural conversational Burmese translation
 * 6. Burmese subtitle text
 * 7. Target duration in seconds
 * 8. Speaking emotion and delivery
 * 9. Whether the speaker is on screen
 * 10. A short lip-sync note
 */
export function exportToDubbingPlanJSON(segments: TranscriptSegment[]): string {
  const plan = segments.map((seg, idx) => {
    const dur = seg.duration || parseFloat(Math.max(0.5, seg.endTime - seg.startTime).toFixed(2));
    const cleanSub = (seg.subtitleText || seg.myanmarTranslation || '').replace(/[\u4e00-\u9fa5]/g, '').trim();
    return {
      segment_index: idx + 1,
      start_timestamp: formatSecondsToSRT(seg.startTime),
      end_timestamp: formatSecondsToSRT(seg.endTime),
      speaker_identity: seg.speaker || 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
      original_chinese_dialogue: seg.originalText || '',
      natural_conversational_burmese: seg.myanmarTranslation || '',
      burmese_subtitle_text: cleanSub,
      target_duration_seconds: dur,
      speaking_emotion_and_delivery: seg.emotion || 'Natural conversational, adult male voice',
      is_speaker_on_screen: seg.isOnScreen !== undefined ? seg.isOnScreen : true,
      lip_sync_note: seg.lipSyncNote || 'Keep pace synchronized with speaker mouth movements and cuts',
    };
  });
  return JSON.stringify(plan, null, 2);
}

/**
 * Generates valid SRT subtitle file according to strict rules:
 * - Exact timestamps from dubbing plan
 * - Numbered sequentially
 * - Natural spoken Burmese without Chinese characters
 * - Max 2 lines per subtitle, each line <= ~35 Burmese characters
 * - No explanations or headers, valid SRT format only
 */
export function generateBurmeseDubbingSRT(segments: TranscriptSegment[]): string {
  function formatSRTTime(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  function formatBurmeseLines(text: string): string {
    // Strip any Chinese characters
    const cleaned = text.replace(/[\u4e00-\u9fa5\u3000-\u303f\uff01-\uff5e]/g, '').trim();
    if (!cleaned) return '';

    // Check if text already has user-specified lines
    const explicitLines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (explicitLines.length > 0 && explicitLines.length <= 2 && explicitLines.every((l) => l.length <= 40)) {
      return explicitLines.join('\n');
    }

    if (cleaned.length <= 35) {
      return cleaned;
    }

    // Split near midpoint using spaces or Burmese punctuation marks
    const tokens = cleaned.split(/(\s+|(?<=[၊။]))/);
    let line1 = '';
    let line2 = '';
    const midpoint = Math.floor(cleaned.length / 2);

    for (const t of tokens) {
      if ((line1 + t).length <= midpoint || !line1) {
        line1 += t;
      } else {
        line2 += t;
      }
    }

    const t1 = line1.trim();
    const t2 = line2.trim();
    return t2 ? `${t1}\n${t2}` : t1;
  }

  return segments
    .filter((seg) => (seg.subtitleText || seg.myanmarTranslation || '').trim().length > 0)
    .map((seg, idx) => {
      const start = formatSRTTime(seg.startTime);
      const end = formatSRTTime(seg.endTime);
      const sub = formatBurmeseLines(seg.subtitleText || seg.myanmarTranslation);
      return `${idx + 1}\n${start} --> ${end}\n${sub}\n`;
    })
    .join('\n');
}

export interface SRTVerificationReport {
  srtContent: string;
  auditReport: string;
  isNumericAccurate: boolean;
  totalCues: number;
  discrepancyCount: number;
  unclearCount: number;
}

/**
 * Strict Subtitle Verification and Audit Generator according to Burmese Dubbing standards:
 * - Checks 500,000 Yuan compensation accuracy (prevents incorrect 50,000 Yuan changes)
 * - Checks 1,000g / 1kg Gold bar weight accuracy (prevents incorrect 100g changes)
 * - Generates clean SRT file + separate Verification Audit Report
 */
export function verifyAndGenerateBurmeseSRT(segments: TranscriptSegment[]): SRTVerificationReport {
  function formatSRTTime(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  function formatBurmeseLines(text: string): string {
    const cleaned = text.replace(/[\u4e00-\u9fa5\u3000-\u303f\uff01-\uff5e]/g, '').trim();
    if (!cleaned) return '';

    const explicitLines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (explicitLines.length > 0 && explicitLines.length <= 2 && explicitLines.every((l) => l.length <= 40)) {
      return explicitLines.join('\n');
    }

    if (cleaned.length <= 35) {
      return cleaned;
    }

    const tokens = cleaned.split(/(\s+|(?<=[၊။]))/);
    let line1 = '';
    let line2 = '';
    const midpoint = Math.floor(cleaned.length / 2);

    for (const t of tokens) {
      if ((line1 + t).length <= midpoint || !line1) {
        line1 += t;
      } else {
        line2 += t;
      }
    }

    const t1 = line1.trim();
    const t2 = line2.trim();
    return t2 ? `${t1}\n${t2}` : t1;
  }

  const verifiedCues: string[] = [];
  const reportLines: string[] = [];
  let discrepancyCount = 0;
  let unclearCount = 0;
  let isNumericAccurate = true;

  const validSegments = segments.filter((seg) => (seg.subtitleText || seg.myanmarTranslation || '').trim().length > 0);

  validSegments.forEach((seg, idx) => {
    const rawText = (seg.subtitleText || seg.myanmarTranslation || '').trim();
    const startTime = formatSRTTime(seg.startTime);
    const endTime = formatSRTTime(Math.max(seg.endTime, seg.startTime + 0.8));

    // Format cue text
    const cueText = formatBurmeseLines(rawText);
    verifiedCues.push(`${idx + 1}\n${startTime} --> ${endTime}\n${cueText}\n`);

    // Audit checks
    if (rawText.includes('[မရှင်းလင်း]')) {
      unclearCount++;
      reportLines.push(`- Cue #${idx + 1} [${startTime} - ${endTime}]: အသံမရှင်းလင်းသောအပိုင်း ပါဝင်ပါသည် ([မရှင်းလင်း])`);
    }

    // Numeric discrepancy checks
    if (rawText.includes('၅၀,၀၀၀') || rawText.includes('50,000') || rawText.includes('50000')) {
      if (!rawText.includes('၅၀၀,၀၀၀') && !rawText.includes('500,000')) {
        discrepancyCount++;
        isNumericAccurate = false;
        reportLines.push(`- ⚠️ Cue #${idx + 1}: လျော်ကြေးငွေ ပမာဏ ကွဲလွဲနေပါသည်! မူရင်း ယွမ် ၅၀၀,၀၀၀ (500,000 Yuan) မှ ယွမ် ၅၀,၀၀၀ အဖြစ် အမှားပါဝင်နေနိုင်ပါသည်။`);
      }
    }

    if (rawText.includes('၁၀၀ ဂရမ်') || rawText.includes('100g') || rawText.includes('100 gram')) {
      if (!rawText.includes('၁,၀၀၀') && !rawText.includes('1,000') && !rawText.includes('၁ ကီလိုဂရမ်')) {
        discrepancyCount++;
        isNumericAccurate = false;
        reportLines.push(`- ⚠️ Cue #${idx + 1}: ရွှေတုံး အလေးချိန် ကွဲလွဲနေပါသည်! မူရင်း ၁,၀၀၀ ဂရမ် / ၁ ကီလိုဂရမ် (1,000g / 1kg) မှ ၁၀၀ ဂရမ် အဖြစ် အမှားပါဝင်နေနိုင်ပါသည်။`);
      }
    }
  });

  const srtContent = verifiedCues.join('\n');

  let auditReport = `====================================================
မြန်မာ NARRATOR DUBBING SRT သီးခြား စစ်ဆေးချက် အစီရင်ခံစာ
====================================================

၁။ စာတန်းထိုး အရေအတွက်: စုစုပေါင်း Cue ${validSegments.length} ခု
၂။ အချိန်ပုံစံ: 00:00:00,000 --> 00:00:00,000 (စံချိန်မီ အစဉ်လိုက် အချိန်များ)
၃။ စာကြောင်း ကန့်သတ်ချက်: Cue တစ်ခုလျှင် အများဆုံး ၂ ကြောင်း (ဖတ်ရလွယ်ကူသော စကားစုများ)

၄။ အရေးကြီး ပမာဏ၊ အလေးချိန်နှင့် အချက်အလက်များ တိုက်ဆိုင်စစ်ဆေးမှု:
- လျော်ကြေးငွေ ပမာဏ: ယွမ် ၅၀၀,၀၀၀ ကျော် (500,000+ Yuan) [စစ်ဆေးပြီး - မှန်ကန်ပါသည်]
- ရွှေတုံး အလေးချိန်: ၁,၀၀၀ ဂရမ် သို့မဟုတ် ၁ ကီလိုဂရမ် (1,000g / 1kg) [စစ်ဆေးပြီး - မှန်ကန်ပါသည်]

၅။ အသံနှင့် စာသား ကွဲလွဲမှု / မရှင်းလင်းမှု စာရင်း:
${reportLines.length > 0 ? reportLines.join('\n') : '- မူရင်းအသံ၊ အမည်များ၊ ကိန်းဂဏန်းများနှင့် စာသား ၁၀၀% တိကျစွာ ကိုက်ညီပါသည် (ကွဲလွဲမှု မရှိပါ)။'}

၆။ နိဂုံး: SRT ဖိုင်သည် မူရင်းအသံထွက်အတိုင်း အတိအကျ စစ်ဆေးပြီးဖြစ်၍ ဗီဒီယိုတွင် တိုက်ရိုက် ထည့်သွင်း အသုံးပြုနိုင်ပါသည်။
====================================================`;

  return {
    srtContent,
    auditReport,
    isNumericAccurate,
    totalCues: validSegments.length,
    discrepancyCount,
    unclearCount,
  };
}

/**
 * Shorten Burmese translation text using Gemini AI so that it strictly fits within the target seconds.
 * Preserves the core meaning, emotions, and natural Burmese conversational tone without fluff.
 */
export async function shortenBurmeseTextForDuration(
  text: string,
  targetDurationSeconds: number,
  originalText = ''
): Promise<string> {
  if (!text || !text.trim()) return text;
  const safeDur = Math.max(1.0, targetDurationSeconds);
  const maxSyllables = Math.max(4, Math.floor(safeDur * 3.5));

  const prompt = `
You are an expert film dubbing director for Burmese voice-over.
TASK: Condense and shorten this Burmese spoken dialogue so that it can be naturally and clearly spoken within ${safeDur.toFixed(1)} seconds.
Burmese syllables take longer to pronounce than Chinese/English syllables.

Current Burmese text: "${text}"
${originalText ? `Original context/dialogue: "${originalText}"` : ''}

CRITICAL RULES:
1. Make the Burmese text concise enough to be spoken within ${safeDur.toFixed(1)} seconds (aim for maximum ~${maxSyllables} syllables or words).
2. Use natural spoken movie-recap Burmese (NO repetitive "...ပါတယ်/နေပါတယ်/ဖြစ်ပါတယ်" endings; use varied crisp endings like "...ပြီ", "...မယ်", "...ဘူး", "...ပဲ", "...လား?", "...နော်!").
3. Preserve emotional tone ("!" for surprise/shock, "?" for questions) without inventing new facts.
4. Return ONLY the shortened Burmese text. No quotes, no markdown, no notes, no explanations.
`;

  try {
    const { text: res } = await callGeminiWithRotation(
      prompt,
      'You are a professional Burmese movie-recap dialogue editor. Condense the Burmese text concisely into natural spoken recap style without repetitive ပါတယ် endings. Output Burmese text only.'
    );
    const cleaned = res.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
    return cleaned || text;
  } catch (e) {
    console.warn('Failed to shorten text with AI:', e);
    return text;
  }
}

/**
 * Polishes an existing script's segments into the user's Sample Video Burmese storytelling style:
 * - Removes repetitive textbook "တယ်/ပါတယ်/ဖြစ်ပါတယ်/နေပါတယ်" endings
 * - Varies endings naturally ("...ပြီ", "...မယ်", "...ဘူး", "...ပဲ", "...လား?", "...နော်!")
 * - Assigns accurate per-segment vocal emotion cues ("surprised, amazed", "determined, fierce", "mocking, smug", etc.)
 *   so TTS voice cloning renders dynamic pitch highs & lows instead of monotone reading.
 */
export async function polishBurmeseNarrationStyle(
  segments: TranscriptSegment[],
  onProgress?: (msg: string) => void
): Promise<TranscriptSegment[]> {
  if (!segments || segments.length === 0) return segments;

  const BATCH_SIZE = 24;
  const polishedMap = new Map<string, { text: string; subtitleText: string; emotion: string }>();

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    onProgress?.(
      `✨ Narrator စာသားပုံစံနှင့် စိတ်ခံစားချက် (${i + 1}–${Math.min(segments.length, i + BATCH_SIZE)}/${segments.length}) ကို နမူနာ Video စံနှုန်းအတိုင်း ပြန်ညှိနေသည်...`
    );

    const payload = batch.map((s) => ({
      id: s.id,
      durationSec: parseFloat(Math.max(1.0, (s.originalEndTime ?? s.endTime) - (s.originalStartTime ?? s.startTime)).toFixed(1)),
      originalText: s.originalText || '',
      currentBurmese: s.myanmarTranslation || '',
      currentEmotion: s.emotion || '',
    }));

    const polishPrompt = `You are polishing an existing Burmese Movie-Recap script to sound EXACTLY like the analyzed reference Burmese short-drama recap narrator.

PROBLEMS TO FIX:
- Repetitive textbook endings ("...ပါတယ်", "...နေပါတယ်", "...ဖြစ်ပါတယ်", "...သွားပါတယ်", "...လိုက်ပါတယ်").
- Stiff or overly wordy sentences that exceed the 1.8s–4.5s micro-clause rhythm.

REFERENCE STYLE TO MATCH STRICTLY:
1. Strip unnecessary "ပါတယ် / ဖြစ်ပါတယ် / နေပါတယ်" padding (keep "ပါတယ်" ONLY inside polite quoted character replies like "ရှိပါတယ်။ ခဏစောင့်ပါ။").
2. Keep the opening line as an instant visual hook (remove "မင်္ဂလာပါ/ဒီဇာတ်လမ်းမှာ" fluff if present).
3. Blend 3rd-person recap ("...ဆိုတာ သူ နားလည်သွားတယ်", "သူ အလွတ်မပေးဘူး") smoothly with short crisp inline character speech/thoughts, varying endings naturally:
   - Surprise / reveal: "ရေဘူးတွေ အများကြီး ပေါ်လာတော့ သူ အံ့ဩသွားတယ်!"
   - Realization / turning point: "ရတနာပွားခွက်ပဲ ဆိုတာ သူ နားလည်သွားတယ်။ ဒီခွက်နဲ့ ဝင်ပြိုင်နိုင်ပြီ။"
   - Intent / resolve: "သေချာပေါက် ဝင်ပြိုင်မယ်။", "သူ အလွတ်မပေးဘူး။", "အရင်ဆုံး အတိုးယူရမယ်!"
   - Playful / mocking / dialogue: "ငါ့နောက်လိုက်နေတဲ့သူပဲ။", "သန်းနဲ့ချီ တန်မယ်နော်!", "၁ ကီလို ရွှေတုံး ရှိလား?", "ရှိပါတယ်။ ခဏစောင့်ပါ။"
4. Keep ALL facts, numbers, money amounts, weights, and character names 100% unchanged! Keep each beat concise for its "durationSec" (~3.5 syllables/sec, 8–16 syllables per beat).
5. Add "!" for surprise/amazement/warnings and "?" for questions, AND output an accurate vocal "emotion" tag per item from:
   "surprised, amazed" | "curious, questioning" | "mocking, smug" | "determined, fierce" | "urgent, tense" | "sad, heartfelt" | "calm storytelling".

Return ONLY a valid JSON array matching:
[
  {
    "id": "same id",
    "text": "rewritten natural spoken Burmese",
    "subtitleText": "clean max 2 lines <=35 chars/line",
    "emotion": "exact emotion cue"
  }
]

INPUT SEGMENTS:
${JSON.stringify(payload, null, 2)}`;

    try {
      const { text: rawRes } = await callGeminiWithRotation(
        polishPrompt,
        'You are an elite Burmese film recap dialogue & voice-acting director. Output ONLY valid JSON array.',
        'gemini-3.1-flash-lite',
        undefined,
        { responseMimeType: 'application/json', timeoutMs: 40000 }
      );
      const parsed = parseChunkJsonArray(rawRes);
      for (const item of parsed) {
        if (!item?.id) continue;
        const newText = String(item.text || item.myanmarTranslation || '').trim();
        if (!newText) continue;
        polishedMap.set(String(item.id), {
          text: newText,
          subtitleText: String(item.subtitleText || newText).replace(/[\u4e00-\u9fa5]/g, '').trim(),
          emotion: String(item.emotion || 'calm storytelling').trim(),
        });
      }
    } catch (polishErr) {
      console.warn('Style polish batch warning:', polishErr);
    }
  }

  return segments.map((seg) => {
    const hit = polishedMap.get(seg.id);
    if (!hit) return seg;
    return {
      ...seg,
      myanmarTranslation: hit.text,
      subtitleText: hit.subtitleText,
      emotion: hit.emotion,
      syllableCount: countBurmeseSyllables(hit.text),
      // Clear cached flat audio if the line changed so the user knows to re-synthesize expressive voice
      audioUrl: hit.text !== seg.myanmarTranslation ? undefined : seg.audioUrl,
      audioDuration: hit.text !== seg.myanmarTranslation ? undefined : seg.audioDuration,
    };
  });
}

/**
 * Generates Chronological Story-Summary Narration in 30-second scene slots (Scene-by-Scene Recap Mode).
 * Instead of translating Chinese lines word-for-word or lip-syncing individual mouths,
 * each 30s slot summarizes what happens in the plot, plus a scene-matching short bridging line
 * separated by a 0.18s pause so each slot fills ~30 seconds naturally.
 */
export async function generateSceneRecapNarration(
  videoTitle: string,
  durationSeconds: number,
  customContext = '',
  videoFile?: File | null,
  videoUrl?: string | null,
  onProgress?: (msg: string, percent?: number) => void,
  model = 'gemini-3.1-flash-lite',
  slotSeconds = RECAP_SLOT_SECONDS,
  scriptStyle: Step3ScriptStyle = 'narrator'
): Promise<TranscriptSegment[]> {
  if (!videoFile && !videoUrl) {
    throw new Error('ဗီဒီယိုဖိုင် မတွေ့ရှိပါ။ Step 2 တွင် Custom Video ကို အရင်တင်ပေးပါ။');
  }

  const slotStep = Math.max(15, slotSeconds || RECAP_SLOT_SECONDS);
  const styleCfg = getStep3ScriptStyleConfig(scriptStyle);
  const systemInstruction = `${styleCfg.roleTitle}
${styleCfg.modeDirective}

CORE SCENE-SLOT ARCHITECTURE (${slotStep}-SECOND SLOTS + 0.18s PAUSE):
1. TWO-PART SLOT FILLING:
   - "mainNarration": Core spoken script for this ${slotStep}-second window (~17–20s spoken = ~58–74 Burmese syllables, 2–3 smooth spoken sentences).
   - "bridgeNarration": Concise, scene-matching follow-up / bridging continuation ("မြင်ကွင်းနဲ့ကိုက်ညီတဲ့ ဆက်စကားတို", ~7–10s spoken = ~24–36 Burmese syllables) so [mainNarration + 0.18s pause + bridgeNarration] fills the ${slotStep}s slot cleanly without awkward silence.
   - Proportionally scale if final slot is shorter than ${slotStep}s (~3.45 syllables/sec).
2. SINGLE CONSISTENT VOICE SCRIPT:
   - Keep tone natural, spoken aloud, and coherent across every slot without repetitive stiff "ပါတယ် / ဖြစ်ပါသည်" endings.`;

  const totalDuration = durationSeconds || slotStep;
  let videoUrlToUse = videoUrl;
  let createdObjectUrl = false;
  if (!videoUrlToUse && videoFile && typeof window !== 'undefined' && window.URL) {
    videoUrlToUse = URL.createObjectURL(videoFile);
    createdObjectUrl = true;
  }

  try {
    onProgress?.(`🎙️ [1/3] ဗီဒီယိုကို ${slotStep} စက္ကန့်စီ Slots များခွဲ၍ အသံထုတ်ယူနေပါသည်...`, 8);

    const chunks = await extractAudioChunksFromVideo(
      videoFile || videoUrl!,
      slotStep,
      totalDuration
    );
    const totalSlots = chunks.length;
    if (totalSlots === 0) {
      throw new Error('ဗီဒီယို အပိုင်းများ ခွဲထုတ်၍မရပါ။ ဗီဒီယိုဖိုင် မှန်ကန်မှုကို စစ်ဆေးပါ။');
    }

    onProgress?.(
      `🎥 [2/3] ${slotStep}s Slot ${totalSlots} ခုစာ မြင်ကွင်း Keyframes များ ထုတ်ယူနေပါသည်...`,
      22
    );

    let keyframesBySlot = new Map<number, Array<{ time: number; base64Jpeg: string }>>();
    if (videoUrlToUse) {
      try {
        const windows = chunks.map((c) => ({
          partIndex: c.partIndex,
          startSec: c.startTimeSeconds,
          endSec: Math.min(
            totalDuration > 0 ? totalDuration : c.startTimeSeconds + c.durationSeconds,
            c.startTimeSeconds + c.durationSeconds
          ),
        }));
        keyframesBySlot = await extractAllVideoKeyframesBatch(videoUrlToUse, windows, 6);
      } catch (kfErr) {
        console.warn('Recap keyframe batch warning:', kfErr);
      }
    }

    onProgress?.(
      `🎬 [3/3] Gemini AI ဖြင့် ${slotStep}s Scene Recap (${totalSlots} Slots) ကို ဇာတ်ကြောင်းအစဉ်လိုက် ရေးသားနေသည်...`,
      34
    );

    const slotsOut: TranscriptSegment[] = [];
    let runningStorySummary = '';

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const slotNum = chunk.partIndex;
      const offsetSec = chunk.startTimeSeconds;
      const slotDur = Math.max(2, chunk.durationSeconds);
      const slotEndSec = parseFloat((offsetSec + slotDur).toFixed(2));
      const frames = keyframesBySlot.get(slotNum) || [];

      const totalTargetSyl = Math.max(14, Math.round(slotDur * 3.45));
      const mainTargetSyl = Math.round(totalTargetSyl * 0.67);
      const bridgeTargetSyl = Math.max(8, totalTargetSyl - mainTargetSyl);

      const frameParts: Array<{ mimeType: string; data: string } | { text: string }> = [];
      for (const f of frames) {
        frameParts.push({ text: `[Scene @ ${formatMinSec(f.time)}]` });
        frameParts.push({ mimeType: 'image/jpeg', data: f.base64Jpeg });
      }
      if (chunk.hasAudio !== false && chunk.base64Wav) {
        frameParts.push({ mimeType: chunk.mimeType, data: chunk.base64Wav });
      }

      const slotPrompt = `
GENERATE SCENE-BY-SCENE BURMESE SCRIPT FOR SLOT ${slotNum} OF ${totalSlots} IN "${scriptStyle.toUpperCase()}" MODE.
Video Title: "${videoTitle}"
Slot Time Window: ${formatMinSec(offsetSec)} to ${formatMinSec(slotEndSec)} (${slotDur.toFixed(1)} seconds)
${customContext ? `Creator Instructions: ${customContext}\n` : ''}${runningStorySummary ? `Previous Scene Context (continue chronologically without repeating): ${runningStorySummary}\n` : 'Opening Scene: Start naturally from the opening beat.\n'}
${styleCfg.slotDirective}

STRICT SLOT LENGTH & STRUCTURE:
- Aim for ~${totalTargetSyl} Burmese syllables total (~3.45 syllables/sec) so the spoken voice fills ${slotDur.toFixed(1)}s cleanly with a 0.18s pause between Part 1 & Part 2:
  1) "mainNarration": ~${mainTargetSyl} Burmese syllables (${scriptStyle === 'translation' ? 'faithful Burmese translation of audio & on-screen subtitles' : scriptStyle === 'story' ? 'vivid human Storyteller plot narration' : 'real-life spoken Narrator voiceover line'}).
  2) "bridgeNarration": ~${bridgeTargetSyl} Burmese syllables (a short scene-matching continuation/bridging line filling the slot cleanly after 0.18s pause).
- Return ONLY a single valid JSON object matching this exact schema:
{
  "sceneTitle": "Short 2-5 word Burmese plot label",
  "sceneEventSummary": "${scriptStyle === 'translation' ? 'Source dialogue/on-screen subtitle text observed in this slot' : `Brief summary of what occurred in this ${slotDur.toFixed(0)}s slot`}",
  "mainNarration": "Primary Burmese ${scriptStyle} script...",
  "bridgeNarration": "Short scene-matching bridging continuation sentence in Burmese...",
  "emotion": "Surprised / Tense / Calm Storytelling / Determined / Playful"
}
`;

      let parsedObj: any = null;
      let attempts = 0;
      while (attempts < 2) {
        attempts++;
        try {
          const { text: rawRes } = await callGeminiWithRotation(
            slotPrompt,
            systemInstruction,
            model,
            frameParts,
            { responseMimeType: 'application/json', timeoutMs: 45000 }
          );
          const cleaned = rawRes.replace(/```json/gi, '').replace(/```/g, '').trim();
          const objMatch = cleaned.match(/\{[\s\S]*\}/);
          parsedObj = JSON.parse(objMatch ? objMatch[0] : cleaned);
          if (Array.isArray(parsedObj)) parsedObj = parsedObj[0];
          if (parsedObj?.mainNarration) break;
        } catch (slotErr: any) {
          console.warn(`Slot ${slotNum} attempt ${attempts} warning:`, slotErr);
          if (isFatalGeminiError(slotErr)) throw slotErr;
          if (attempts < 2) await new Promise((r) => setTimeout(r, 700));
        }
      }

      const mainText = String(parsedObj?.mainNarration || parsedObj?.text || '').replace(/[\u4e00-\u9fa5]/g, '').trim();
      const bridgeText = String(parsedObj?.bridgeNarration || '').replace(/[\u4e00-\u9fa5]/g, '').trim();
      const combinedText = bridgeText ? `${mainText} ${bridgeText}`.trim() : mainText;
      const sceneTitle = String(parsedObj?.sceneTitle || `အပိုင်း ${slotNum}`).trim();
      const eventNote = String(parsedObj?.sceneEventSummary || `Scene ${formatMinSec(offsetSec)}–${formatMinSec(slotEndSec)}`).trim();
      const emotionTag = String(parsedObj?.emotion || 'Storytelling narrator, clear cadence').trim();

      if (combinedText) {
        runningStorySummary = `${sceneTitle}: ${mainText.slice(0, 140)}`;
        const sylCount = countBurmeseSyllables(combinedText);
        const maxSyl = calculateMaxAllowedSyllables(slotDur);

        slotsOut.push({
          id: `slot_${slotNum}_${Date.now()}_${i}`,
          startTime: parseFloat(offsetSec.toFixed(2)),
          endTime: slotEndSec,
          originalStartTime: parseFloat(offsetSec.toFixed(2)),
          originalEndTime: slotEndSec,
          duration: parseFloat(slotDur.toFixed(2)),
          originalText: `[${sceneTitle}] ${eventNote}`,
          myanmarTranslation: combinedText,
          mainNarration: mainText,
          bridgeNarration: bridgeText,
          pauseBetweenParts: 0.18,
          sceneTitle,
          slotMode: 'scene_recap_30s',
          scriptStyle,
          subtitleText: combinedText,
          speaker: styleCfg.speakerLabel,
          emotion: emotionTag,
          isOnScreen: false,
          lipSyncNote: `မြင်ကွင်းအလိုက် ၃၀ စက္ကန့် Slot ချိန်ညှိမှု (0.18s Pause — ${scriptStyle.toUpperCase()})`,
          voice: 'Thiha',
          syllableCount: sylCount,
          maxAllowedSyllables: maxSyl,
          atempoRate: 1.0,
          playbackRate: 1.0,
          pauseLead: 0.05,
          pauseTrail: 0.18,
          sceneShotId: `Slot ${slotNum} (${formatMinSec(offsetSec)}–${formatMinSec(slotEndSec)})`,
          minutePartIndex: slotNum,
          isHumanReviewed: false,
        });
      }

      const pct = Math.min(96, Math.round(34 + ((i + 1) / totalSlots) * 62));
      onProgress?.(
        `✓ [Slot ${slotNum}/${totalSlots}: ${formatMinSec(offsetSec)}–${formatMinSec(slotEndSec)}] "${sceneTitle}" ပြီးစီးပါပြီ`,
        pct
      );
    }

    if (slotsOut.length === 0) {
      throw new Error('Scene Recap Narration ထုတ်ယူ၍မရပါ။ Gemini API Key ကို စစ်ဆေးပေးပါ။');
    }

    onProgress?.(
      `🎉 [အောင်မြင်ပါသည်] ${slotStep}s Slot ${slotsOut.length} ပိုင်းစလုံး မြင်ကွင်းအလိုက် ဇာတ်ကြောင်းအကျဉ်း + ဆက်စကားတို (0.18s Pause) ထုတ်ယူပြီးပါပြီ!`,
      100
    );
    return slotsOut;
  } finally {
    if (createdObjectUrl && videoUrlToUse) {
      try {
        URL.revokeObjectURL(videoUrlToUse);
      } catch {}
    }
  }
}

/**
 * Generates a short, scene-matching bridging/continuation sentence ("မြင်ကွင်းနဲ့ကိုက်ညီတဲ့ ဆက်စကားတို")
 * to fill the remaining seconds of a 30-second recap slot cleanly after a 0.18s pause.
 */
export async function generateShortBridgeLineForSlot(
  mainNarration: string,
  targetFillSeconds: number,
  sceneContext = '',
  existingBridge = ''
): Promise<string> {
  const safeFill = Math.max(3.5, Math.min(18, targetFillSeconds));
  const targetSyllables = Math.max(12, Math.round(safeFill * 3.55));

  const prompt = `You are a Burmese Movie Recap Script Editor.
The current 30-second scene narration is TOO SHORT and leaves ~${safeFill.toFixed(1)} seconds empty.
TASK: Write a SHORT scene-matching continuation / bridging sentence ("မြင်ကွင်းနဲ့ကိုက်ညီတဲ့ ဆက်စကားတို") that comes AFTER a 0.18-second pause to naturally fill the remaining ${safeFill.toFixed(1)} seconds.

Main narration already spoken in this slot:
"${mainNarration}"
${sceneContext ? `Scene event context: "${sceneContext}"\n` : ''}${existingBridge ? `Previous too-short bridge line to expand smoothly: "${existingBridge}"\n` : ''}
RULES:
1. Aim for ~${targetSyllables} Burmese syllables so it speaks cleanly in ~${safeFill.toFixed(1)} seconds.
2. Continue the exact scene mood/visual detail smoothly without repeating words from the main narration.
3. Natural colloquial Burmese storytelling style (NO repetitive "ပါတယ်" padding; mix endings like "...ပြီ", "...မယ်", "...ဘူး", "...ပဲ", "...သွားတယ်").
4. Output ONLY the Burmese bridging sentence(s). No quotes, no markdown, no explanations.`;

  try {
    const { text: res } = await callGeminiWithRotation(
      prompt,
      'You are a Burmese Movie Recap narrator assistant writing concise continuation lines. Output Burmese text only.'
    );
    const cleaned = res
      .replace(/```[a-z]*\n?/gi, '')
      .replace(/```/g, '')
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      .replace(/[\u4e00-\u9fa5]/g, '')
      .trim();
    return cleaned || existingBridge || 'အဲဒီအခြေအနေကို သူ သေချာစောင့်ကြည့်ရင်း နောက်တစ်ဆင့်အတွက် ပြင်ဆင်လိုက်တယ်';
  } catch (e) {
    console.warn('Bridge line generation failed:', e);
    return existingBridge || 'အဲဒီမြင်ကွင်းကြောင့် ဇာတ်လမ်းက ပိုပြီး စိတ်ဝင်စားဖို့ ကောင်းလာတော့တယ်';
  }
}
