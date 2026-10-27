import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_VERSION = '143.0.3650.75';

// Token cache to avoid running Python on every single synthesis
let cachedToken = '';
let cachedTokenTime = 0;
const TOKEN_TTL_MS = 240000; // 4 minutes (tokens valid for 5 min windows)

function getSecMsGecV2Token(): string {
  const now = Date.now();
  if (cachedToken && now - cachedTokenTime < TOKEN_TTL_MS) {
    return cachedToken;
  }
  try {
    const scriptPath = path.resolve(__dirname, 'sec_ms_gec.py');
    const token = execSync(`python3 "${scriptPath}"`, { encoding: 'utf-8', timeout: 5000 }).trim();
    if (token && token.length > 30) {
      cachedToken = token;
      cachedTokenTime = now;
      return token;
    }
  } catch (err) {
    console.warn('Failed to compute Sec-MS-GEC v2 token via python:', err);
  }
  return cachedToken;
}

export interface CharacterVoiceProfile {
  name: string;
  myanmarName: string;
  azureVoice: string; // 'my-MM-ThihaNeural' or 'my-MM-NilarNeural'
  basePitch: string;
  baseRate: string;
  description: string;
}

export const REALITY_VOICE_CONFIGS: Record<string, CharacterVoiceProfile> = {
  // 4 Male Voices (ကျား ၄ ဦး - Authentic Human 24kHz Studio Neural)
  Thiha: {
    name: 'Thiha',
    myanmarName: 'သီဟ',
    azureVoice: 'my-MM-ThihaNeural',
    basePitch: '+0Hz',
    baseRate: '+0%',
    description: 'နွေးထွေးခန့်ညားသော နေ့စဉ်စကားပြော သဘာဝအသံ (Conversational Native Male)',
  },
  KyawKyaw: {
    name: 'Kyaw Kyaw',
    myanmarName: 'ကျော်ကျော်',
    azureVoice: 'my-MM-ThihaNeural',
    basePitch: '-14Hz',
    baseRate: '-5%',
    description: 'သြဇာကြီးမား နက်နဲသော Deep Bass အသံ (Movie Recap Specialist Male)',
  },
  AungAung: {
    name: 'Aung Aung',
    myanmarName: 'အောင်အောင်',
    azureVoice: 'my-MM-ThihaNeural',
    basePitch: '+14Hz',
    baseRate: '+8%',
    description: 'တက်ကြွသွက်လက်သော လူငယ်သံ (Dynamic Youth Male)',
  },
  MinThway: {
    name: 'Min Thway',
    myanmarName: 'မင်းသွေး',
    azureVoice: 'my-MM-ThihaNeural',
    basePitch: '-6Hz',
    baseRate: '-4%',
    description: 'အေးချမ်းတည်ကြည်သော ဇာတ်လမ်းပြောသံ (Calm Narrative Male)',
  },

  // 4 Female Voices (မ ၄ ဦး - Authentic Human 24kHz Studio Neural)
  Nilar: {
    name: 'Nilar',
    myanmarName: 'နီလာ',
    azureVoice: 'my-MM-NilarNeural',
    basePitch: '+0Hz',
    baseRate: '+0%',
    description: 'သဘာဝကျနူးညံ့ ကြည်လင်ပြတ်သားသော အသံ (Natural Clear Female)',
  },
  MayThu: {
    name: 'May Thu',
    myanmarName: 'မေသူ',
    azureVoice: 'my-MM-NilarNeural',
    basePitch: '-4Hz',
    baseRate: '-5%',
    description: 'ချိုသာနူးညံ့သော ဇာတ်လမ်းပြောသံ (Sweet Storytelling Female)',
  },
  Thiri: {
    name: 'Thiri',
    myanmarName: 'သီရိ',
    azureVoice: 'my-MM-NilarNeural',
    basePitch: '+8Hz',
    baseRate: '+6%',
    description: 'တောက်ပသွက်လက်သော သတင်းနှင့် ရုပ်သံတင်ဆက်သံ (Broadcast Presenter Female)',
  },
  SuSu: {
    name: 'Su Su',
    myanmarName: 'စုစု',
    azureVoice: 'my-MM-NilarNeural',
    basePitch: '+16Hz',
    baseRate: '+10%',
    description: 'ချစ်စဖွယ် လန်းဆန်းပျော်ရွှင်သော အသံ (Cheerful Sweet Female)',
  },
};

export interface SynthesizeOptions {
  voice?: string;
  style?: string; // 'conversational' | 'recap' | 'broadcast' | 'energetic' | 'soothing'
  speed?: number; // e.g. 1.25 (125% speed) or 0.85 (85% speed)
  rateOffset?: string;
  pitchOffset?: string;
}

/**
 * Clean and format Myanmar text for natural human pronunciation and breathing
 */
export function formatMyanmarSpeechText(rawText: string): string {
  let clean = rawText
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();

  // Ensure sentence punctuation (။, ., !, ?) has slight natural breathing pauses
  // In SSML, a comma or period creates a natural cadence pause
  clean = clean
    .replace(/([။.!?])(?!\s*($|\n))/g, '$1 ')
    .replace(/([၊,])(?!\s)/g, '$1 ')
    .trim();

  return clean;
}

/**
 * Synthesizes 100% human-reality Myanmar speech using Microsoft Azure 24kHz Studio Neural models
 * with custom persona pitch/cadence modulation and anti-artifact audio streaming.
 */
export async function synthesizeNeuralRealityMyanmar(
  text: string,
  options: SynthesizeOptions = {}
): Promise<Buffer> {
  const voiceKey = options.voice || 'Thiha';
  const profile = REALITY_VOICE_CONFIGS[voiceKey] || REALITY_VOICE_CONFIGS.Thiha;
  const style = options.style || 'conversational';

  // Calculate style prosody offsets
  let pitchShift = 0;
  let rateShift = 0;

  switch (style) {
    case 'recap':
      // Cinematic Movie Recap: Deep bass storyteller, suspenseful dramatic pacing
      pitchShift = -12;
      rateShift = -8;
      break;
    case 'broadcast':
      // Broadcast News: Crisp, authoritative, fluent TV anchor cadence
      pitchShift = 6;
      rateShift = 12;
      break;
    case 'energetic':
      // TikTok/Shorts High Energy: High-tempo, vibrant, enthusiastic delivery
      pitchShift = 18;
      rateShift = 22;
      break;
    case 'soothing':
      // Calm & Soothing: Soft, relaxed, peaceful intimate warmth
      pitchShift = -8;
      rateShift = -14;
      break;
    case 'affectionate':
      // Affectionate: Warm, soft, intimate, gentle delivery
      pitchShift = 4;
      rateShift = -6;
      break;
    case 'conversational':
    default:
      pitchShift = 0;
      rateShift = 0;
      break;
  }

  // Combine profile base pitch/rate with style offset and user speed
  const basePitchNum = parseInt(profile.basePitch.replace('Hz', ''), 10) || 0;
  const baseRateNum = parseInt(profile.baseRate.replace('%', ''), 10) || 0;

  // Process user requested voice speed multiplier (e.g. 1.25 -> +25%)
  let userSpeedPercent = 0;
  if (typeof options.speed === 'number' && options.speed > 0) {
    userSpeedPercent = Math.round((options.speed - 1.0) * 100);
  } else if (options.rateOffset) {
    userSpeedPercent = parseInt(options.rateOffset.replace('%', ''), 10) || 0;
  }

  const totalPitch = basePitchNum + pitchShift;
  const totalRate = Math.min(100, Math.max(-50, baseRateNum + rateShift + userSpeedPercent));

  const finalPitchStr = `${totalPitch >= 0 ? '+' : ''}${totalPitch}Hz`;
  const finalRateStr = `${totalRate >= 0 ? '+' : ''}${totalRate}%`;

  const cleanSpeechText = formatMyanmarSpeechText(text);

  const token = getSecMsGecV2Token();
  if (!token) {
    throw new Error('Failed to generate Sec-MS-GEC v2 authentication token');
  }

  const reqId = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const wsUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${token}&Sec-MS-GEC-Version=2-${CHROMIUM_VERSION}&ConnectionId=${reqId}`;

  return new Promise((resolve, reject) => {
    let ws: WebSocket | null = null;
    const audioChunks: Buffer[] = [];
    let isFinished = false;

    const timeout = setTimeout(() => {
      if (!isFinished) {
        isFinished = true;
        if (ws) {
          try {
            ws.terminate();
          } catch (_) {}
        }
        if (audioChunks.length > 0) {
          resolve(Buffer.concat(audioChunks));
        } else {
          reject(new Error('Neural Reality TTS synthesis timed out'));
        }
      }
    }, 15000);

    try {
      ws = new WebSocket(wsUrl, {
        headers: {
          'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0`,
          'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      ws.on('open', () => {
        // 1. Send speech config (24kHz 48kbps MP3)
        const configMsg =
          'Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}';
        ws?.send(configMsg);

        // 2. Escape XML text
        const xmlEscaped = cleanSpeechText
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');

        // 3. Send SSML with prosody
        const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="my-MM"><voice name="${profile.azureVoice}"><prosody pitch="${finalPitchStr}" rate="${finalRateStr}">${xmlEscaped}</prosody></voice></speak>`;
        const ssmlMsg = `X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`;
        ws?.send(ssmlMsg);
      });

      ws.on('message', (data: any, isBinary: boolean) => {
        if (isBinary) {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
          const delim = 'Path:audio\r\n';
          const idx = buf.indexOf(delim);
          if (idx !== -1) {
            const audioData = buf.subarray(idx + delim.length);
            if (audioData.length > 0) {
              audioChunks.push(audioData);
            }
          }
        } else {
          const textMsg = data.toString();
          if (textMsg.includes('Path:turn.end')) {
            if (!isFinished) {
              isFinished = true;
              clearTimeout(timeout);
              ws?.close();
              const fullAudio = Buffer.concat(audioChunks);
              resolve(fullAudio);
            }
          }
        }
      });

      ws.on('error', (err) => {
        if (!isFinished) {
          isFinished = true;
          clearTimeout(timeout);
          if (audioChunks.length > 0) {
            resolve(Buffer.concat(audioChunks));
          } else {
            reject(err);
          }
        }
      });

      ws.on('close', () => {
        if (!isFinished) {
          isFinished = true;
          clearTimeout(timeout);
          if (audioChunks.length > 0) {
            resolve(Buffer.concat(audioChunks));
          } else {
            reject(new Error('WebSocket closed before audio was received'));
          }
        }
      });
    } catch (err) {
      if (!isFinished) {
        isFinished = true;
        clearTimeout(timeout);
        reject(err);
      }
    }
  });
}
