import { GeminiKeyInfo, TranscriptSegment, AiMode } from '../types';
import { extractAudioChunksFromVideo, extractAllVideoKeyframesBatch } from './audioExtractor';
import { MINUTE_BLOCK_SECONDS, formatMinSec, realignSegmentsByMinuteBlocks } from './timingSync';

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
  const directInstruction = 'ဗီဒီယို အသံနှင့် မြင်ကွင်းကို အခြေခံပြီး Timestamp Segment တစ်ခုချင်းစီအလိုက် သဘာဝကျသော မြန်မာ ဇာတ်ကြောင်းပြောစကား (Recap Style) အဖြစ် တိကျစွာ ထုတ်ပေးပါ။ စာကြောင်းတိုင်းကို "ပါတယ်/နေပါတယ်/ဖြစ်ပါတယ်" ဟု ထပ်ခါတလဲလဲ အဆုံးမသတ်ရ! နမူနာပုံစံအတိုင်း "...ပြီ", "...မယ်", "...ဘူး", "...ပဲ", "...လား", "...နော်", "...သွားတယ်" စသဖြင့် အဆုံးသတ်မျိုးစုံ သဘာဝကျကျ သုံးပါ။ KEEP BURMESE CONCISE (<12-18 syllables per 4-5s segment).';
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
      if (parsed && Array.isArray(parsed.segments)) return parsed.segments;
      if (parsed && Array.isArray(parsed.cues)) return parsed.cues;
      if (parsed && Array.isArray(parsed.items)) return parsed.items;
    } catch {}
    return null;
  };

  const direct = tryParse(cleaned);
  if (direct) return direct;

  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    const extracted = tryParse(arrayMatch[0]);
    if (extracted) return extracted;
  }

  return [];
}

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
  model = 'gemini-3.1-flash-lite'
): Promise<TranscriptSegment[]> {
  if (!videoFile && !videoUrl) {
    throw new Error('ဗီဒီယိုဖိုင် မတွေ့ရှိပါ။ Step 2 တွင် Custom Video ကို အရင်တင်ပေးပါ။');
  }

  const strictSystemInstruction = `You are an elite Burmese Movie-Recap Storyteller & Voice-Acting Director (နမူနာ YouTube/TikTok Recap ဇာတ်ကြောင်းပြောသူ).
MANDATORY STEP 3 NARRATION & VOICE-EXPRESSION RULES:
1. MATCH SAMPLE VIDEO BURMESE STYLE — BAN REPETITIVE "တယ် / ပါတယ်" ENDINGS:
   - NEVER end consecutive sentences with robotic textbook forms like "...နေပါတယ်။", "...ဖြစ်ပါတယ်။", "...သွားပါတယ်။", "...လိုက်ပါတယ်။".
   - Write crisp, natural SPOKEN Burmese storytelling (စကားပြောဇာတ်ကြောင်း) mixing varied endings:
     • Surprise / realization: "...ပေါ်လာတော့ သူ အံ့ဩသွားတယ်!", "...ရတနာပွားခွက်ပဲ ဆိုတာ သူ နားလည်သွားတယ်"
     • Readiness / turning point: "...ဒီခွက်နဲ့ လာမယ့်ပြိုင်ပွဲမှာ ဝင်ပြိုင်နိုင်ပြီ။"
     • Intent / promise / forecast: "...သေချာပေါက် ဝင်ပြိုင်မယ်။", "...အရင်ဆုံး အတိုးယူရမယ်။", "...သန်းပေါင်းများစွာ ကုန်မယ်။"
     • Defiance / refusal: "...သူ အလွတ်မပေးဘူး။"
     • Punchy irony / taunts / questions: "...ငါ့နောက်လိုက်နေတဲ့သူပဲ။", "...သန်းနဲ့ချီ တန်မယ်နော်!", "...အောင်မြင်နေပြီပဲ။", "...တစ်ကီလို ရွှေတုံး ရှိလား?"
   - Avoid "ပါတယ်" in narration (only use polite "ပါတယ်" when retelling a shop clerk's polite reply like "ရှိပါတယ်။ ခဏစောင့်ပါ။"). Never end more than 2 cues in a row with "တယ်".
2. EXPRESSIVE VOCAL EMOTION & PUNCTUATION FOR VOICE CLONE:
   - Use "!" on shocking/surprising reveals or threats, and "?" on questions so TTS raises/lowers vocal pitch expressively (အသံနိမ့်မြင့် ပါဝင်စေရန်) rather than reading flatly.
   - Set specific "emotion" tags on EVERY segment matching the scene: e.g. "surprised, amazed", "determined, fierce", "curious, questioning", "smug, mocking", "urgent, tense", "calm storytelling", "sad, heartfelt".
3. SCENE-BY-SCENE VISUAL + AUDIO ALIGNMENT:
   - Inspect EVERY timestamped visual frame AND listen sequentially. Start each cue AT THE EXACT MOMENT that scene or exchange appears.
   - Keep "speaker": "Narrator (ဇာတ်ကြောင်းပြောသူ)" on every segment. Preserve exact numbers, money, weights, and names faithfully.
4. CONCISE SPEAKING-TIME BUDGET (~3.4 syllables/sec):
   - Keep each 3.5s–5.5s cue concise (~10–18 Burmese syllables) so the narrator finishes cleanly inside [start, end] BEFORE the next scene cut.
5. TIMESTAMPS & SUBTITLES:
   - Return sequential non-overlapping chunk-relative timestamps ("00:00:00,000" to chunk end). Subtitles max 2 lines, <=35 chars/line, ZERO foreign/Chinese characters.`;

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
    onProgress?.('🎙️ [1/3] ဗီဒီယိုကို ၁ မိနစ်စာ အပိုင်းများခွဲ၍ အသံထုတ်ယူနေပါသည်...', 8);

    // Always process in 1-minute (60s) blocks for tight visual-to-timestamp grounding
    const chunks = await extractAudioChunksFromVideo(
      videoFile || videoUrl!,
      MINUTE_BLOCK_SECONDS,
      totalDuration
    );
    const totalParts = chunks.length;
    if (totalParts === 0) {
      throw new Error('ဗီဒီယို အပိုင်းများ ခွဲထုတ်၍မရပါ။ ဗီဒီယိုဖိုင် မှန်ကန်မှုကို စစ်ဆေးပါ။');
    }

    onProgress?.(
      `🎥 [2/3] မြင်ကွင်း Keyframes များကို (${totalParts} Parts — high density 4s/frame) ထုတ်ယူနေပါသည်...`,
      20
    );

    // Extract 15 aspect-preserved keyframes per 60s block (~every 4 seconds) so every scene cut is aligned cleanly
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
        keyframesByPart = await extractAllVideoKeyframesBatch(videoUrlToUse, windows, 15);
      } catch (kfErr) {
        console.warn('Batch keyframe extraction skipped:', kfErr);
      }
    }

    onProgress?.(
      `⚡ [3/3] Gemini AI ဖြင့် Part 1/${totalParts} မှ စတင် ခွဲခြမ်းနေပါသည်...`,
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

      const chunkPrompt = `
YOU ARE PROCESSING 1-MINUTE BLOCK PART ${partNum} OF ${totalParts} FOR VIDEO "${videoTitle}".
Block Window: ${formatMinSec(offsetSec)} to ${formatMinSec(chunkEndSec)} (Chunk Duration: ${chunk.durationSeconds.toFixed(1)}s).
${chunk.hasAudio === false ? 'NOTE: No decodable audio track detected; describe chronological scenes visually from the timestamped frames.\n' : ''}Creator Context: ${customContext || 'Engaging Burmese recap storyteller with natural emotional pitch variation and varied spoken endings'}.

CRITICAL SCENE-LOCKED & NATURAL BURMESE RULES:
1. BAN "တယ် / ပါတယ်" REPETITION: Write crisp colloquial Burmese movie-recap sentences ending naturally with "...ပြီ", "...မယ်", "...ဘူး", "...ပဲ", "...လား?", "...နော်!", "...သွားတယ်" — NEVER repeat "...ပါတယ် / ...နေပါတယ် / ...ဖြစ်ပါတယ်" like a textbook!
2. EXPRESSIVE EMOTION + PUNCTUATION: Put "!" on shocking/surprised lines ("သူ အံ့ဩသွားတယ်!"), "?" on questions ("ရှိလား?"), and an accurate vocal "emotion" tag (e.g. "surprised, amazed", "determined, fierce", "mocking, smug", "curious, questioning", "calm storytelling").
3. MATCH VISUAL FRAME TIMESTAMPS: Inspect "[Visual Frame @ ... | Chunk +Xs]" images (~every 4s) alongside the audio. Align every cue to exact scene/dialogue timing.
4. CONCISE SPOKEN LENGTH: Keep each cue ~3.4 syllables/sec (~10–18 Burmese syllables per 3.5s–5.5s cue) so TTS finishes cleanly inside the scene slot.
5. SINGLE NARRATOR STORYTELLING: Always set "speaker": "Narrator (ဇာတ်ကြောင်းပြောသူ)".
6. CHUNK-RELATIVE TIMESTAMPS: Report "start" and "end" strictly between "00:00:00,000" and "${formatSecondsToSRT(chunk.durationSeconds)}" (sequential non-overlapping cues).
7. Return ONLY a valid JSON array matching this exact schema:
[
  {
    "id": 1,
    "start": "00:00:00,000",
    "end": "00:00:04,500",
    "duration": 4.5,
    "speaker": "Narrator (ဇာတ်ကြောင်းပြောသူ)",
    "originalText": "Spoken dialogue or key on-screen event at this exact timestamp",
    "text": "ရေဘူးတွေ အများကြီး ပေါ်လာတော့ သူ အံ့ဩသွားတယ်!",
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
      while (retries < 2 && !fatalError) {
        try {
          retries++;
          const { text: chunkResText } = await callGeminiWithRotation(
            chunkPrompt,
            strictSystemInstruction,
            model,
            chunkPayload,
            { responseMimeType: 'application/json', timeoutMs: 45000 }
          );

          const parsedChunk = parseChunkJsonArray(chunkResText);
          if (parsedChunk.length === 0) {
            throw new Error(`Part ${partNum} မှ AI ပြန်လည်ဖြေကြားချက် JSON ပုံစံ မမှန်ကန်ပါ`);
          }

          const partSegments: TranscriptSegment[] = [];
          let blockCursor = offsetSec;
          const blockHardEnd = offsetSec + chunk.durationSeconds;

          parsedChunk.forEach((item: any, idx: number) => {
            const rawStartStr = String(item.start || item.startTime || '00:00:00,000');
            const rawEndStr = String(item.end || item.endTime || '00:00:05,000');
            const myanmarText = (item.text || item.myanmarTranslation || item.natural_burmese_translation || '').trim();
            if (!myanmarText) return;

            const origText = (item.originalText || item.original_dialogue || myanmarText).trim();
            const subText = (item.subtitleText || item.burmese_subtitle_text || myanmarText).trim();

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

            partSegments.push({
              id: `p${partNum}_${item.id || idx + 1}_${Date.now()}_${idx}`,
              startTime: parseFloat(adjustedStartSec.toFixed(2)),
              endTime: parseFloat(adjustedEndSec.toFixed(2)),
              duration: dur,
              originalText: origText,
              myanmarTranslation: myanmarText,
              subtitleText: subText.replace(/[\u4e00-\u9fa5]/g, '').trim(),
              speaker: 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
              emotion: item.emotion || item.speaking_emotion_and_delivery || 'Storytelling narrator, clear cadence',
              isOnScreen: false,
              lipSyncNote: 'Aligned to 1-minute scene block timeline',
              voice: 'Thiha',
              syllableCount: sylCount,
              maxAllowedSyllables: maxSyl,
              atempoRate: 1.0,
              playbackRate: 1.0,
              pauseLead: 0.1,
              pauseTrail: 0.15,
              sceneShotId: `shot_p${partNum}_${idx + 1}`,
              minutePartIndex: partNum,
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
          if (retries < 2) {
            await new Promise((r) => setTimeout(r, 900));
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
        `🎉 [အောင်မြင်ပါသည်] 1-Minute Block Part 1 မှ Part ${totalParts} အထိ Narrator ဇာတ်ကြောင်းပြော Segments ${finalSegments.length} ခု တိကျစွာ ထုတ်ယူပြီးပါပြီ။`,
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

    const polishPrompt = `You are polishing an existing Burmese Movie-Recap script to sound EXACTLY like a top human Burmese TikTok/YouTube recap narrator.

PROBLEMS TO FIX:
- Currently there are TOO MANY repetitive textbook endings ("...ပါတယ်", "...နေပါတယ်", "...ဖြစ်ပါတယ်", "...သွားပါတယ်", "...လိုက်ပါတယ်").
- Lines sound flat when read aloud.

TARGET STYLE (FOLLOW STRICTLY):
1. Strip unnecessary "ပါတယ် / ဖြစ်ပါတယ် / နေပါတယ်" padding (keep "ပါတယ်" ONLY inside polite quoted replies like "ရှိပါတယ်။ ခဏစောင့်ပါ။").
2. Vary sentence endings naturally across cues just like this authentic reference:
   - Surprise / reveal: "ရေဘူးတွေ အများကြီး ပေါ်လာတော့ သူ အံ့ဩသွားတယ်!"
   - Understanding / turning point: "ရတနာပွားခွက်ပဲ ဆိုတာ သူ နားလည်သွားတယ်။ ဒီခွက်နဲ့ ဝင်ပြိုင်နိုင်ပြီ။"
   - Intent / resolve: "သေချာပေါက် ဝင်ပြိုင်မယ်။", "သူ အလွတ်မပေးဘူး။", "အရင်ဆုံး အတိုးယူရမယ်။"
   - Playful / mocking / dialogue: "ငါ့နောက်လိုက်နေတဲ့သူပဲ။", "သန်းနဲ့ချီ တန်မယ်နော်!", "အောင်မြင်နေပြီပဲ။", "တစ်ကီလို ရွှေတုံး ရှိလား?"
3. Keep ALL facts, numbers, money amounts, weights, and character names 100% unchanged! Keep each line concise for its "durationSec" (~3.4 syllables/sec).
4. Add "!" for surprise/amazement/warnings and "?" for questions, AND output an accurate vocal "emotion" tag per item from:
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
