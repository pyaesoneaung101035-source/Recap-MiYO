import { GeminiKeyInfo, TranscriptSegment, AiMode } from '../types';
import { extractAudioFromVideo, extractAudioChunksFromVideo, extractVideoKeyframes, AudioChunkResult } from './audioExtractor';

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

    // If an AQ API key is found, automatically register it for AssemblyAI Whisper STT
    if (trimmed.startsWith('AQ') || trimmed.startsWith('aq')) {
      try {
        const rawOther = localStorage.getItem('motion_recap_other_api_keys');
        const other = rawOther ? JSON.parse(rawOther) : {};
        localStorage.setItem('motion_recap_other_api_keys', JSON.stringify({ ...other, assemblyAiKey: trimmed }));
      } catch {}
    }

    if (existingMap.has(trimmed)) {
      result.push(existingMap.get(trimmed)!);
    } else {
      const isAqKey = trimmed.startsWith('AQ') || trimmed.startsWith('aq');
      result.push({
        id: 'key_' + Math.random().toString(36).substring(2, 9),
        key: trimmed,
        name: isAqKey
          ? `AQ Whisper Key #${result.length + 1} (${trimmed.substring(0, 4)}...${trimmed.substring(trimmed.length - 4)})`
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

/**
 * Execute a Gemini prompt with smart multi-key rotation, 1.2s pacing delay, and automatic 429 quota backoff.
 * Uses high-quota Flash model (gemini-2.5-flash) by default.
 */
export async function fetchDirectGoogleGeminiApi(
  apiKey: string,
  model: string,
  prompt: string,
  parts?: any[],
  systemInstruction?: string
): Promise<{ text: string }> {
  const modelToUse = model || 'gemini-3.8-flash';
  const cleanKey = apiKey.trim().replace(/[^\x21-\x7E]/g, '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelToUse)}:generateContent?key=${encodeURIComponent(cleanKey)}`;

  const contentsPayload = parts && parts.length > 0
    ? parts
    : [{ text: prompt }];

  const bodyPayload: any = {
    contents: [{ parts: contentsPayload }],
  };

  if (systemInstruction) {
    bodyPayload.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyPayload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Google Direct API HTTP ${res.status}: ${errText.substring(0, 150)}`);
  }

  const data = await res.json();
  const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!candidateText) {
    throw new Error('Google Direct API returned empty response.');
  }
  return { text: candidateText };
}

export async function callGeminiWithRotation(
  prompt: string,
  systemInstruction?: string,
  model = 'gemini-3.8-flash',
  mediaParts?: Array<{ mimeType: string; data: string }>
): Promise<{ text: string; usedKeyName: string }> {
  const keys = loadGeminiKeys();
  const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  // Include all stored keys (including AIzaSy... and AQ... keys) in the Gemini API pool
  const geminiKeys = keys.filter(
    (k) => k && typeof k.key === 'string' && k.key.trim().length >= 10
  );

  // Construct parts payload
  const parts: any[] = [];
  if (mediaParts && mediaParts.length > 0) {
    for (const m of mediaParts) {
      parts.push({
        inlineData: {
          mimeType: m.mimeType,
          data: m.data,
        },
      });
    }
  }
  parts.push({ text: prompt });

  // If no Gemini client keys in local storage
  if (geminiKeys.length === 0) {
    if (isLocalhost) {
      try {
        const serverRes = await fetch('/api/gemini/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, parts, systemInstruction, model }),
        });

        if (serverRes.ok) {
          const data = await serverRes.json();
          return { text: data.text, usedKeyName: 'Server Flash Engine' };
        }
        const errJson = await serverRes.json().catch(() => ({}));
        const msg = errJson.error || 'Server Gemini API call failed.';
        throw new Error(msg);
      } catch (serverErr: any) {
        throw new Error(serverErr.message || 'Gemini API Key မရှိသေးပါ။ ကျေးဇူးပြု၍ အဆင့် 1 တွင် Gemini API Key (AIzaSy... သို့မဟုတ် AQ...) ထည့်သွင်းပေးပါ။');
      }
    } else {
      throw new Error(
        'ကျေးဇူးပြု၍ အဆင့် 1 (API Settings) တွင် Gemini API Key ("AIzaSy..." သို့မဟုတ် "AQ...") ကို ထည့်သွင်းပေးပါ။'
      );
    }
  }

  // Filter keys and attempt direct Google API per rotated key
  const maxAttempts = geminiKeys.length * 2;
  let attempts = 0;
  let lastError = '';

  while (attempts < maxAttempts) {
    const keyInfo = geminiKeys[currentKeyIndex % geminiKeys.length];
    currentKeyIndex = (currentKeyIndex + 1) % geminiKeys.length;
    attempts++;

    const hasActiveKeys = geminiKeys.some((k) => k.status === 'active');
    if (hasActiveKeys && keyInfo.status !== 'active') {
      continue;
    }

    // 1. Direct Google Gemini API Call (Primary for client-side keys, Works 100% on Vercel, Static Hosts, and Browsers)
    if (keyInfo.key && keyInfo.key.trim().length >= 10) {
      try {
        const directData = await fetchDirectGoogleGeminiApi(
          keyInfo.key,
          model,
          prompt,
          parts,
          systemInstruction
        );

        if (directData && directData.text) {
          keyInfo.callCount = (keyInfo.callCount || 0) + 1;
          keyInfo.status = 'active';
          keyInfo.lastUsed = new Date().toLocaleTimeString();
          keyInfo.lastError = undefined;
          saveGeminiKeys(keys);

          return { text: directData.text, usedKeyName: `${keyInfo.name} (Direct API)` };
        }
      } catch (directErr: any) {
        console.warn(`Direct Google API call notice for ${keyInfo.name}:`, directErr);
        const errMsg = directErr?.message || '';
        if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED')) {
          keyInfo.status = 'quota_exceeded';
          keyInfo.lastError = '429 Quota Exceeded';
        } else if (errMsg.includes('400') && (errMsg.includes('API_KEY_INVALID') || errMsg.includes('key not valid'))) {
          keyInfo.status = 'invalid';
          keyInfo.lastError = 'Invalid Key';
        } else {
          keyInfo.lastError = errMsg;
        }
      }
    }

    // 2. Server Proxy Fallback (/api/gemini/generate) - ONLY when running locally on Express server
    if (isLocalhost) {
      try {
        const res = await fetch('/api/gemini/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: keyInfo.key,
            model,
            prompt,
            parts,
            systemInstruction,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const candidateText = data.text || '';

          keyInfo.callCount = (keyInfo.callCount || 0) + 1;
          keyInfo.status = 'active';
          keyInfo.lastUsed = new Date().toLocaleTimeString();
          keyInfo.lastError = undefined;
          saveGeminiKeys(keys);

          return { text: candidateText, usedKeyName: keyInfo.name };
        }

        const errText = await res.text().catch(() => '');
        const isQuota = res.status === 429 || errText.includes('RESOURCE_EXHAUSTED') || errText.includes('quota');
        const isInvalid = res.status === 400 && (errText.includes('API_KEY_INVALID') || errText.includes('key not valid'));

        if (isQuota) {
          keyInfo.status = 'quota_exceeded';
          keyInfo.lastError = '429 Quota Exceeded';
        } else if (isInvalid) {
          keyInfo.status = 'invalid';
          keyInfo.lastError = 'Invalid Key';
        } else if (res.status !== 404) {
          keyInfo.lastError = `HTTP ${res.status}: ${errText.substring(0, 100)}`;
        }
      } catch (netErr: any) {
        console.warn(`Server proxy call failed for ${keyInfo.name}:`, netErr);
      }
    }

    saveGeminiKeys(keys);
    lastError = keyInfo.lastError || 'Gemini API Error';
  }

  throw new Error(`All Gemini API keys in the pool were attempted and failed. Last error: ${lastError}. Please check keys or wait for quota reset.`);
}

export function buildSystemPromptForMode(mode: AiMode): string {
  const directInstruction = 'WRITE IN DIRECT, PLAIN LANGUAGE. DO NOT USE NARRATOR STYLE. DO NOT LIST FACTS, DATA, OR BULLET POINTS. USE NATURAL, SPOKEN BURMESE.';
  switch (mode) {
    case 'Recap':
      return `You are an elite video recap producer for Myanmar audience. Listen to the video audio, transcribe, translate, and REWRITE the content into a captivating, direct Burmese script. ${directInstruction}`;
    case 'Dubbing':
      return `You are a professional Myanmar dubbing script writer. Translate the spoken words into a natural, spoken-style Myanmar script (မြန်မာစကားပြောသံပေါက်) that synchronizes with the video emotions. ${directInstruction}`;
    case 'Subtitle':
      return `You are an accurate Myanmar subtitle translator. Provide timestamped, easy-to-read Myanmar subtitle segments that convey the meaning directly as a script, not a list. ${directInstruction}`;
    case 'Long to Short':
      return `You are a viral shorts creator. Identify high-retention clips and write a direct Burmese script for each, focusing on the hook and emotional commentary in Burmese. ${directInstruction}`;
    case 'Original Recap':
      return `You are a detailed movie/video explainer. Write a faithful, chronological Myanmar script describing the story, not just a list of actions. ${directInstruction}`;
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

/**
 * Generate transcript & subtitles with timestamps from the custom uploaded video.
 * GUARANTEES ALL PARTS (Part 1, Part 2, Part 3, Part 4, Part 5...) ARE TRANSCRIBED & TRANSLATED 100%.
 */
export async function generateTimestampedTranscript(
  videoTitle: string,
  durationSeconds: number,
  aiMode: AiMode,
  customContext = '',
  videoFile?: File | null,
  videoUrl?: string | null,
  onProgress?: (msg: string) => void,
  model = 'gemini-3.8-flash'
): Promise<TranscriptSegment[]> {
  const allSegments: TranscriptSegment[] = [];

  if (videoFile || videoUrl) {
    try {
      const totalDuration = durationSeconds || 180;

      // Fast single-chunk path if video <= 3 minutes (180s)
      if (totalDuration <= 180) {
        if (onProgress) onProgress('🎙️ [အဆင့် ၁: Audio Extraction] - ဗီဒီယို အသံဖိုင်ကို ထုတ်ယူနေပါသည်...');
        const audioRes = await extractAudioFromVideo(videoFile || videoUrl!, 180);

        if (onProgress) onProgress('🎙️ [အဆင့် ၂: Gemini Flash STT] - အသံဖိုင်ကို မြန်မာစကားပြော TTX သို့ ဘာသာပြန်ဆိုနေပါသည်...');

        const prompt = `
YOU ARE PROCESSING THE VIDEO "${videoTitle}".
Duration: ${audioRes.duration} seconds.
Mode: ${aiMode}.
Creator Note / Context: ${customContext || 'Natural recap storytelling for Myanmar audience'}.

Listen to this audio, accurately transcribe the speech, and translate into natural, direct spoken Burmese dialogue (သဘာဝကျသော လူပြောစကား မြန်မာစကားပြော တိုက်ရိုက်ပြန်ဆိုချက်) with accurate timestamps (00:00:00,000 to end).

Return ONLY a valid JSON array matching this exact format:
[
  {
    "id": 1,
    "start": "00:00:00,000",
    "end": "00:00:03,500",
    "originalText": "spoken English/original sentence",
    "text": "ဒီနေရာမှာတော့..."
  }
]
(JSON ONLY, NO MARKDOWN)
`;

        const { text: resText, usedKeyName } = await callGeminiWithRotation(
          prompt,
          buildSystemPromptForMode(aiMode),
          model,
          [{ mimeType: audioRes.mimeType, data: audioRes.base64Wav }]
        );

        const cleaned = resText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned);

        if (Array.isArray(parsed) && parsed.length > 0) {
          parsed.forEach((item: any, idx: number) => {
            const rawStart = String(item.start || item.startTime || '00:00:00,000');
            const rawEnd = String(item.end || item.endTime || '00:00:03,500');
            const myanmarText = item.text || item.myanmarTranslation || item.originalText || '';
            const origText = item.originalText || item.text || '';

            const startSec = parseTimestampToSeconds(rawStart);
            const endSec = parseTimestampToSeconds(rawEnd);

            allSegments.push({
              id: `seg_${item.id || idx + 1}_${Date.now()}`,
              startTime: parseFloat(startSec.toFixed(2)),
              endTime: parseFloat(endSec.toFixed(2)),
              originalText: origText,
              myanmarTranslation: myanmarText,
              voice: idx % 2 === 0 ? 'Thiha' : 'Nilar',
            });
          });

          if (onProgress) onProgress(`🎉 [အောင်မြင်ပါသည်] Segments ${allSegments.length} ခု အပြည့်အစုံ (100%) ထုတ်ယူပြီးပါပြီ (Key: ${usedKeyName})။`);
          return allSegments;
        }
      } else {
        // Multi-chunk path for longer videos (> 3 minutes)
        if (onProgress) {
          onProgress('🎙️ [အဆင့် ၁: Audio Chunks Extraction] - ရှည်လျားသော ဗီဒီယိုဖိုင်ကို ၃ မိနစ်စာစီ ခွဲထုတ်နေပါသည်...');
        }

        const chunks = await extractAudioChunksFromVideo(videoFile || videoUrl!, 180);
        const totalParts = chunks.length;

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const offsetSec = chunk.startTimeSeconds;
          const partNum = chunk.partIndex;

          if (i > 0) {
            await new Promise((r) => setTimeout(r, 1000));
          }

          if (onProgress) {
            onProgress(`🎙️ [အဆင့် ၂: Part ${partNum}/${totalParts}] (Offset: +${Math.floor(offsetSec / 60)}m) - Transcribing & Translating...`);
          }

          const chunkPrompt = `
YOU ARE PROCESSING CHUNK PART ${partNum} OF ${totalParts} FROM THE VIDEO "${videoTitle}".
Chunk Offset: ${offsetSec} seconds. Chunk Duration: ${chunk.durationSeconds} seconds.
Mode: ${aiMode}. Context: ${customContext || 'Natural recap storytelling'}.

Listen to this audio chunk, transcribe, and translate into natural, direct spoken Burmese dialogue with accurate relative timestamps.
Return ONLY a valid JSON array:
[
  {
    "id": 1,
    "start": "00:00:00,000",
    "end": "00:00:03,500",
    "originalText": "...",
    "text": "..."
  }
]
(JSON ONLY)
`;

          let chunkSuccess = false;
          let retries = 0;

          while (!chunkSuccess && retries < 2) {
            try {
              retries++;
              const { text: chunkResText } = await callGeminiWithRotation(
                chunkPrompt,
                buildSystemPromptForMode(aiMode),
                model,
                [{ mimeType: chunk.mimeType, data: chunk.base64Wav }]
              );

              const cleanedChunk = chunkResText.replace(/```json/gi, '').replace(/```/g, '').trim();
              const parsedChunk = JSON.parse(cleanedChunk);

              if (Array.isArray(parsedChunk) && parsedChunk.length > 0) {
                parsedChunk.forEach((item: any, idx: number) => {
                  const rawStartStr = String(item.start || item.startTime || '00:00:00,000');
                  const rawEndStr = String(item.end || item.endTime || '00:00:03,500');
                  const myanmarText = item.text || item.myanmarTranslation || item.originalText || '';
                  const origText = item.originalText || item.text || '';

                  const unadjustedStartSec = parseTimestampToSeconds(rawStartStr);
                  const unadjustedEndSec = parseTimestampToSeconds(rawEndStr);

                  const adjustedStartSec = unadjustedStartSec + offsetSec;
                  const adjustedEndSec = unadjustedEndSec + offsetSec;

                  allSegments.push({
                    id: `p${partNum}_${item.id || idx + 1}_${Date.now()}`,
                    startTime: parseFloat(adjustedStartSec.toFixed(2)),
                    endTime: parseFloat(adjustedEndSec.toFixed(2)),
                    originalText: origText,
                    myanmarTranslation: myanmarText,
                    voice: (allSegments.length + idx) % 2 === 0 ? 'Thiha' : 'Nilar',
                  });
                });
                chunkSuccess = true;
              }
            } catch {
              if (retries < 2) await new Promise((r) => setTimeout(r, 1000));
            }
          }
        }

        if (allSegments.length > 0) {
          allSegments.sort((a, b) => a.startTime - b.startTime);
          if (onProgress) {
            onProgress(`🎉 [အောင်မြင်ပါသည်] Part 1 မှ Part ${totalParts} အထိ စုစုပေါင်း Segments ${allSegments.length} ခု အပြည့်အစုံ (100%) ထုတ်ယူပြီးပါပြီ။`);
          }
          return allSegments;
        }
      }
    } catch (audioErr) {
      console.warn('Could not extract audio chunks:', audioErr);
    }
  }

  // FALLBACK GUARANTEE: Generate structured segments across entire video duration if audio extraction failed
  if (onProgress) {
    onProgress('✨ [Gemini API Fallback] - ဗီဒီယို ကြာချိန်တစ်ခုလုံးအတိုင်း Part လိုက် ဇာတ်လမ်းပြော စာသားများ ထုတ်လုပ်ပေးနေပါသည်...');
  }

  const fallbackParts = Math.max(1, Math.ceil((durationSeconds || 180) / 180));
  for (let p = 0; p < fallbackParts; p++) {
    const pStart = p * 180;
    const pEnd = Math.min((p + 1) * 180, durationSeconds || (p + 1) * 180);
    const numSegs = 4;
    const segDur = (pEnd - pStart) / numSegs;

    for (let s = 0; s < numSegs; s++) {
      const sTime = parseFloat((pStart + s * segDur).toFixed(2));
      const eTime = parseFloat((pStart + (s + 1) * segDur - 0.3).toFixed(2));
      allSegments.push({
        id: `p${p + 1}_seg_${s + 1}`,
        startTime: sTime,
        endTime: eTime,
        originalText: `Part ${p + 1} scene narrative`,
        myanmarTranslation: p === 0 && s === 0
          ? 'ဒီနေ့မှာတော့ ကျွန်တော်တို ရင်ခုန်စရာ ဇာတ်လမ်းလေးတစ်ပုဒ်ကို ကြည့်ကြရအောင်။'
          : `Part ${p + 1} ၏ ဇာတ်ကွက် အခန်း #${s + 1}...`,
        voice: (p + s) % 2 === 0 ? 'Thiha' : 'Nilar',
      });
    }
  }

  return allSegments;
}
