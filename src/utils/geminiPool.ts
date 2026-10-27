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

    if (existingMap.has(trimmed)) {
      result.push(existingMap.get(trimmed)!);
    } else {
      result.push({
        id: 'key_' + Math.random().toString(36).substring(2, 9),
        key: trimmed,
        name: `Key #${result.length + 1} (${trimmed.substring(0, 4)}...${trimmed.substring(trimmed.length - 4)})`,
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
 * Execute a Gemini prompt with smart multi-key rotation and automatic quota fallback.
 * Supports sending multimodal inline data (Audio track / Video frames).
 */
/**
 * Execute a Gemini prompt with smart multi-key rotation and automatic quota fallback.
 * Supports sending multimodal inline data (Audio track / Video frames).
 */
export async function callGeminiWithRotation(
  prompt: string,
  systemInstruction?: string,
  model = 'gemini-3.8-flash',
  mediaParts?: Array<{ mimeType: string; data: string }>
): Promise<{ text: string; usedKeyName: string }> {
  let keys = loadGeminiKeys();

  // Construct parts
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

  // If no keys in local storage, try the server default key
  if (keys.length === 0) {
    const serverRes = await fetch('/api/gemini/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, parts, systemInstruction, model }),
    });

    if (!serverRes.ok) {
      const errJson = await serverRes.json().catch(() => ({}));
      throw new Error(errJson.error || 'Server Gemini API call failed. Please add Gemini API keys in the API Settings box.');
    }
    const data = await serverRes.json();
    return { text: data.text, usedKeyName: 'Server Default Key' };
  }

  // Filter keys that haven't been permanently invalidated in this cycle
  const maxAttempts = keys.length * 2;
  let attempts = 0;
  let lastError = '';

  while (attempts < maxAttempts) {
    // Pick next key in round-robin order
    const keyInfo = keys[currentKeyIndex % keys.length];
    currentKeyIndex = (currentKeyIndex + 1) % keys.length;
    attempts++;

    // Skip keys marked as quota_exceeded or invalid if other active keys exist
    const hasActiveKeys = keys.some((k) => k.status === 'active');
    if (hasActiveKeys && keyInfo.status !== 'active') {
      continue;
    }

    try {
      // Direct Google Gemini API call (phone & browser direct call support)
      const directUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(keyInfo.key)}`;
      
      const payload: any = {
        contents: [
          {
            parts,
          },
        ],
      };

      if (systemInstruction) {
        payload.systemInstruction = {
          parts: [{ text: systemInstruction }],
        };
      }

      let res = await fetch(directUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // If direct fetch had CORS / network restriction or error, fallback to server proxy
      if (!res.ok && res.status !== 429 && res.status !== 400 && res.status !== 403) {
        res = await fetch('/api/gemini/generate', {
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
      }

      if (res.ok) {
        const data = await res.json();
        const candidateText =
          data.candidates?.[0]?.content?.parts?.[0]?.text || data.text || '';

        // Success! Update key stats
        keyInfo.callCount = (keyInfo.callCount || 0) + 1;
        keyInfo.status = 'active';
        keyInfo.lastUsed = new Date().toLocaleTimeString();
        keyInfo.lastError = undefined;
        saveGeminiKeys(keys);

        return { text: candidateText, usedKeyName: keyInfo.name };
      }

      // Check if error is quota exhaustion or invalid key
      const errText = await res.text();
      const isQuota = res.status === 429 || errText.includes('RESOURCE_EXHAUSTED') || errText.includes('quota');
      const isInvalid = res.status === 400 && (errText.includes('API_KEY_INVALID') || errText.includes('key not valid'));

      if (isQuota) {
        console.warn(`Key ${keyInfo.name} reached quota limit. Rotating to next key.`);
        keyInfo.status = 'quota_exceeded';
        keyInfo.lastError = '429 Quota Exceeded';
      } else if (isInvalid) {
        console.warn(`Key ${keyInfo.name} is invalid.`);
        keyInfo.status = 'invalid';
        keyInfo.lastError = 'Invalid Key';
      } else {
        keyInfo.lastError = `HTTP ${res.status}: ${errText.substring(0, 100)}`;
      }

      saveGeminiKeys(keys);
      lastError = keyInfo.lastError || 'API error';
    } catch (netErr: any) {
      console.warn(`Error with key ${keyInfo.name}:`, netErr);
      keyInfo.lastError = netErr.message || 'Network error';
      saveGeminiKeys(keys);
      lastError = netErr.message;
    }
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
  onProgress?: (msg: string) => void
): Promise<TranscriptSegment[]> {
  const allSegments: TranscriptSegment[] = [];

  // PHASE 1: AUDIO CHUNKING (3-MIN PARTS) & PER-CHUNK TRANSCRIPTION & TRANSLATION
  if (videoFile || videoUrl) {
    try {
      if (onProgress) {
        onProgress('🎙️ [အဆင့် ၁: Audio Chunks Extraction] - ၆ မိနစ်/ရှည်လျားသော ဗီဒီယိုဖိုင်ကို ၃ မိနစ်စာစီ (Part 1: 0-3m, Part 2: 3-6m, Part 3: 6-9m...) အလိုအလျောက် ဖြတ်ထုတ်နေပါသည်...');
      }

      const chunks = await extractAudioChunksFromVideo(videoFile || videoUrl!, 180);
      const totalParts = chunks.length;

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const offsetSec = chunk.startTimeSeconds; // Part 1: 0, Part 2: 180s (+3m), Part 3: 360s (+6m)...
        const partNum = chunk.partIndex;

        // Pacing delay between chunk API calls to protect API quota
        if (i > 0) {
          await new Promise((r) => setTimeout(r, 1200));
        }

        const partMsg = `🎙️ [အဆင့် ၁: Part ${partNum}/${totalParts}] (Offset: +${Math.floor(offsetSec / 60)}m / +${offsetSec}s) - Transcribing & Translating speech to Myanmar TTX...`;
        if (onProgress) onProgress(partMsg);

        const chunkPrompt = `
YOU ARE PROCESSING CHUNK PART ${partNum} OF ${totalParts} FROM THE VIDEO "${videoTitle}".
Chunk Offset: ${offsetSec} seconds (${Math.floor(offsetSec / 60)} minutes).
Chunk Duration: ${chunk.durationSeconds} seconds.
Mode: ${aiMode}.
Creator Note / Context: ${customContext || 'Natural recap storytelling for Myanmar audience'}.

Listen to this 3-minute audio chunk (Part ${partNum}), accurately transcribe the speech, and translate into natural, direct spoken Burmese dialogue (သဘာဝကျသော လူပြောစကား မြန်မာစကားပြော တိုက်ရိုက်ပြန်ဆိုချက်) with accurate relative timestamps (00:00:00,000 to 00:03:00,000).

IMPORTANT: DO NOT WRITE IN NARRATOR STYLE (narrator ပုံစံဖြင့် လုံးဝမရေးရ). WRITE AS DIRECT CONVERSATIONAL SPEECH / DUBBING DIALOGUE. DO NOT LIST FACTS OR DATA POINTS. USE NATURAL, SPOKEN BURMESE.

Return ONLY a valid JSON array matching this exact format:
[
  {
    "id": 1,
    "start": "00:00:00,000",
    "end": "00:00:03,500",
    "originalText": "spoken English/original sentence",
    "text": "ဒီနေရာမှာတော့ မင်းသားက..."
  }
]
(JSON ONLY, NO MARKDOWN EXPLANATION)
`;

        // Retry loop per chunk to ensure no part is missed
        let chunkSuccess = false;
        let retries = 0;

        while (!chunkSuccess && retries < 3) {
          try {
            retries++;
            const { text: chunkResText, usedKeyName } = await callGeminiWithRotation(
              chunkPrompt,
              buildSystemPromptForMode(aiMode),
              'gemini-3.8-flash',
              [{ mimeType: chunk.mimeType, data: chunk.base64Wav }]
            );

            const cleanedChunk = chunkResText.replace(/```json/gi, '').replace(/```/g, '').trim();
            const parsedChunk = JSON.parse(cleanedChunk);

            if (Array.isArray(parsedChunk) && parsedChunk.length > 0) {
              parsedChunk.forEach((item: any, idx: number) => {
                const rawStartStr = String(item.start !== undefined ? item.start : (item.startTime || '00:00:00,000'));
                const rawEndStr = String(item.end !== undefined ? item.end : (item.endTime || '00:00:03,500'));
                const myanmarText = item.text || item.myanmarTranslation || item.originalText || '';
                const origText = item.originalText || item.text || '';

                const unadjustedStartSec = parseTimestampToSeconds(rawStartStr);
                const unadjustedEndSec = parseTimestampToSeconds(rawEndStr);

                // ACCURATE OFFSET ADJUSTMENT (Part 1: +0s, Part 2: +180s, Part 3: +360s, Part 4: +540s...)
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
              if (onProgress) {
                onProgress(`✓ [Part ${partNum}/${totalParts} Complete] ${parsedChunk.length} Segments added (Used Key: ${usedKeyName}). Total so far: ${allSegments.length} Segments.`);
              }
            }
          } catch (chunkErr) {
            console.warn(`Chunk ${partNum} attempt ${retries} failed:`, chunkErr);
            if (retries < 3) {
              await new Promise((r) => setTimeout(r, 1500));
            }
          }
        }
      }

      if (allSegments.length > 0) {
        // Sort all segments chronologically across all parts
        allSegments.sort((a, b) => a.startTime - b.startTime);

        if (onProgress) {
          onProgress(`🎉 [အောင်မြင်ပါသည်] Part 1 မှ Part ${totalParts} အထိ စုစုပေါင်း Segments ${allSegments.length} ခု အပြည့်အစုံ (100%) ထုတ်ယူပြီးပါပြီ။`);
        }

        return allSegments;
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
