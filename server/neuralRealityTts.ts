import { execFile, execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import WebSocket from 'ws';

const execFileAsync = promisify(execFile);

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
  basePitchPct: number;
  baseRatePct: number;
  description: string;
}

export const REALITY_VOICE_CONFIGS: Record<string, CharacterVoiceProfile> = {
  // Reference Video Chest-Baritone + 4 Male Voices
  RecapPro: {
    name: 'Min Khant (Recap Pro)',
    myanmarName: 'မင်းခန့် · Recap Pro',
    azureVoice: 'my-MM-ThihaNeural',
    basePitchPct: -5,
    baseRatePct: 5,
    description: 'နမူနာ Video စတိုင် 135Hz Warm Chest-Baritone Short-Drama Recap Narrator',
  },
  Thiha: {
    name: 'Thiha',
    myanmarName: 'သီဟ',
    azureVoice: 'my-MM-ThihaNeural',
    basePitchPct: 0,
    baseRatePct: 0,
    description: 'နွေးထွေးခန့်ညားသော နေ့စဉ်စကားပြော သဘာဝအသံ (Conversational Native Male)',
  },
  KyawKyaw: {
    name: 'Kyaw Kyaw',
    myanmarName: 'ကျော်ကျော်',
    azureVoice: 'my-MM-ThihaNeural',
    basePitchPct: -7,
    baseRatePct: -3,
    description: 'သြဇာကြီးမား နက်နဲသော Deep Bass အသံ (Movie Recap Specialist Male)',
  },
  AungAung: {
    name: 'Aung Aung',
    myanmarName: 'အောင်အောင်',
    azureVoice: 'my-MM-ThihaNeural',
    basePitchPct: 7,
    baseRatePct: 5,
    description: 'တက်ကြွသွက်လက်သော လူငယ်သံ (Dynamic Youth Male)',
  },
  MinThway: {
    name: 'Min Thway',
    myanmarName: 'မင်းသွေး',
    azureVoice: 'my-MM-ThihaNeural',
    basePitchPct: -4,
    baseRatePct: -2,
    description: 'အေးချမ်းတည်ကြည်သော ဇာတ်လမ်းပြောသံ (Calm Narrative Male)',
  },

  // 4 Female Voices
  Nilar: {
    name: 'Nilar',
    myanmarName: 'နီလာ',
    azureVoice: 'my-MM-NilarNeural',
    basePitchPct: 0,
    baseRatePct: 0,
    description: 'သဘာဝကျနူးညံ့ ကြည်လင်ပြတ်သားသော အသံ (Natural Clear Female)',
  },
  MayThu: {
    name: 'May Thu',
    myanmarName: 'မေသူ',
    azureVoice: 'my-MM-NilarNeural',
    basePitchPct: -3,
    baseRatePct: -3,
    description: 'ချိုသာနူးညံ့သော ဇာတ်လမ်းပြောသံ (Sweet Storytelling Female)',
  },
  Thiri: {
    name: 'Thiri',
    myanmarName: 'သီရိ',
    azureVoice: 'my-MM-NilarNeural',
    basePitchPct: 5,
    baseRatePct: 4,
    description: 'တောက်ပသွက်လက်သော သတင်းနှင့် ရုပ်သံတင်ဆက်သံ (Broadcast Presenter Female)',
  },
  SuSu: {
    name: 'Su Su',
    myanmarName: 'စုစု',
    azureVoice: 'my-MM-NilarNeural',
    basePitchPct: 9,
    baseRatePct: 7,
    description: 'ချစ်စဖွယ် လန်းဆန်းပျော်ရွှင်သော အသံ (Cheerful Sweet Female)',
  },
};

export interface SynthesizeOptions {
  voice?: string;
  style?: string;
  tone?: string;
  emotion?: string;
  speed?: number;
  rateOffset?: string;
  pitchOffset?: number | string;
}

export function formatMyanmarSpeechText(rawText: string): string {
  let clean = rawText
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\[\]*#_`~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  clean = clean
    .replace(/([။.!?])(?!\s*($|\n))/g, '$1 ')
    .replace(/([၊,])(?!\s)/g, '$1 ')
    .trim();

  return clean;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parsePitchOffsetPct(pitchOffset?: number | string): number {
  if (typeof pitchOffset === 'number' && isFinite(pitchOffset)) {
    return Math.max(-15, Math.min(15, Math.round(pitchOffset)));
  }
  if (typeof pitchOffset === 'string' && pitchOffset.trim()) {
    const cleaned = pitchOffset.replace(/hz|%/gi, '').trim();
    const num = parseFloat(cleaned);
    if (isFinite(num)) {
      return Math.max(-15, Math.min(15, Math.round(num)));
    }
  }
  return 0;
}

function getToneAdjustments(tone?: string): { pitchPct: number; ratePct: number; volPct: number } {
  switch ((tone || 'natural').toLowerCase()) {
    case 'recap_pro':
      return { pitchPct: -5, ratePct: 4, volPct: 5 };
    case 'warm':
      return { pitchPct: -2, ratePct: -2, volPct: 2 };
    case 'deep':
      return { pitchPct: -8, ratePct: -4, volPct: 4 };
    case 'bright':
      return { pitchPct: 6, ratePct: 4, volPct: 3 };
    case 'calm':
      return { pitchPct: -4, ratePct: -6, volPct: -2 };
    case 'dramatic':
      return { pitchPct: -3, ratePct: 2, volPct: 6 };
    case 'soft':
      return { pitchPct: 2, ratePct: -5, volPct: -6 };
    case 'natural':
    default:
      return { pitchPct: 0, ratePct: 0, volPct: 0 };
  }
}

/**
 * Splits a Burmese line into AT MOST 2 cohesive halves so Edge WS runs in ONE single stream
 * with consistent vocal identity (zero mid-sentence voice switching or double-voice artifacts).
 */
function splitIntoTwoBalancedClauses(text: string): string[] {
  if (text.length < 36) return [text];

  // Prefer natural punctuation midpoint
  const punctMatches = [...text.matchAll(/[။.!?\n၊,]\s+/g)];
  if (punctMatches.length > 0) {
    const mid = text.length / 2;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (const m of punctMatches) {
      if (m.index !== undefined) {
        const splitPos = m.index + m[0].length;
        if (splitPos > 8 && splitPos < text.length - 8) {
          const dist = Math.abs(splitPos - mid);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = splitPos;
          }
        }
      }
    }
    if (bestIdx !== -1) {
      return [text.slice(0, bestIdx).trim(), text.slice(bestIdx).trim()].filter(Boolean);
    }
  }

  // Otherwise try natural Burmese clause particles near midpoint
  const words = text.split(/\s+/);
  if (words.length >= 5) {
    const midWord = Math.ceil(words.length / 2);
    return [words.slice(0, midWord).join(' '), words.slice(midWord).join(' ')];
  }

  return [text];
}

function computeNaturalSingleVoiceProsody(
  clause: string,
  emotionHint: string,
  idx: number,
  total: number,
  basePitchPct: number,
  baseRatePct: number,
  baseVolPct: number
): { pitchStr: string; rateStr: string; volStr: string } {
  const hint = (emotionHint || '').toLowerCase();
  const isLast = idx === total - 1;
  const combined = `${hint} ${clause}`.toLowerCase();

  let pitchDelta = 0;
  let rateDelta = 0;
  let volDelta = 0;

  const isQuestion =
    /question|curious|wonder|ask|မေး|စူးစမ်း/.test(hint) ||
    /[?？]|(?:လား|လဲ|မလား|ပြီလား|ရှိလား)[။.!?]?$/.test(clause);

  const isSurprise =
    /surpris|shock|amaze|astonish|wow|gasp|discover|အံ့ဩ|မထင်မှတ်|တကယ်|အများကြီး|ဟာ/.test(
      combined
    ) || (clause.includes('!') && !/angry|fierce|threat|မပေးဘူး|ဒေါသ/.test(combined));

  const isHappiness = /happy|cheer|joy|delight|smile|relief|ပျော်|ဝမ်းသာ|အောင်မြင်/.test(combined);
  const isEmpathy = /empath|caring|comfort|kind|tender|warm|စာနာ|နှစ်သိမ့်|ဂရု|သနား/.test(hint);
  const isExcitement = /excit|enthusias|thrill|energetic|vivid|တက်ကြွ|စိတ်လှုပ်ရှား/.test(hint);
  const isMocking =
    /mock|smug|sarcas|playful|tease|ironic|chuckle|လှောင်|ခနဲ့/.test(hint) ||
    /(?:ပြီပဲ|တာပဲ|နော်|ရယ်)[။.!?]?$/.test(clause);
  const isDetermined =
    /determin|fierce|angry|threat|intense|urgent|tense|warning|resolve|မာန်|ဒေါသ|ပြင်းထန်/.test(hint) ||
    /(?:မပေးဘူး|သေချာပေါက်|ယူရမယ်|မခံဘူး|လုပ်ရမယ်|ဝယ်လိုက်)[။.!?]?$/.test(clause);
  const isSad = /sad|sorrow|melanchol|grief|cry|pain|ဝမ်းနည်း|ငို|နာကျင်|မျက်ရည်/.test(combined);

  // Subtle single-speaker inflection (strictly preserves the exact same speaker voice pitch without mid-sentence jumps)
  if (isQuestion) {
    pitchDelta = isLast ? 5 : 2;
    rateDelta = 2;
    volDelta = 3;
  } else if (isSurprise) {
    pitchDelta = isLast ? 6 : 3;
    rateDelta = 4;
    volDelta = 6;
  } else if (isHappiness) {
    pitchDelta = 4;
    rateDelta = 3;
    volDelta = 4;
  } else if (isEmpathy) {
    pitchDelta = -2;
    rateDelta = -2;
    volDelta = 0;
  } else if (isExcitement) {
    pitchDelta = 5;
    rateDelta = 5;
    volDelta = 6;
  } else if (isMocking) {
    pitchDelta = 2;
    rateDelta = 3;
    volDelta = 4;
  } else if (isDetermined) {
    pitchDelta = -4;
    rateDelta = 3;
    volDelta = 8;
  } else if (isSad) {
    pitchDelta = -4;
    rateDelta = -5;
    volDelta = -4;
  } else {
    // Smooth single-speaker cadence with minimal natural shift
    const warmEnd = /(?:ပြီ|ပဲ|မယ်|နော်|!)[။.!?]?$/.test(clause);
    pitchDelta = total === 1 ? (warmEnd ? 2 : 0) : idx === 0 ? 1 : (warmEnd ? 2 : -1);
    rateDelta = 2;
    volDelta = 2;
  }

  const finalPitch = Math.max(-22, Math.min(22, basePitchPct + pitchDelta));
  const finalRate = Math.max(-25, Math.min(40, baseRatePct + rateDelta));
  const finalVol = Math.max(-15, Math.min(20, baseVolPct + volDelta));

  return {
    pitchStr: `${finalPitch >= 0 ? '+' : ''}${finalPitch}%`,
    rateStr: `${finalRate >= 0 ? '+' : ''}${finalRate}%`,
    volStr: `${finalVol >= 0 ? '+' : ''}${finalVol}%`,
  };
}

/**
 * Light single-pass studio mic EQ & clean silence trim (ZERO pitch-splitting or crossfaded sub-clips).
 */
async function polishSingleVoiceStream(rawMp3: Buffer, isRecapPro = false): Promise<Buffer> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-clean-'));
  try {
    const inPath = path.join(workDir, 'in.mp3');
    const outPath = path.join(workDir, 'out.mp3');
    fs.writeFileSync(inPath, rawMp3);

    const filterChain = isRecapPro
      ? 'silenceremove=start_periods=1:start_duration=0:start_threshold=-46dB:stop_periods=-1:stop_duration=0.14:stop_threshold=-46dB,highpass=f=80,equalizer=f=155:t=q:w=1.1:g=2.8,equalizer=f=3100:t=q:w=1.0:g=2.2,acompressor=threshold=-16dB:ratio=2.4:attack=8:release=85,alimiter=limit=0.95'
      : 'silenceremove=start_periods=1:start_duration=0:start_threshold=-46dB:stop_periods=-1:stop_duration=0.16:stop_threshold=-46dB,highpass=f=80,equalizer=f=185:t=q:w=1.2:g=2.0,equalizer=f=3100:t=q:w=1.1:g=1.5,acompressor=threshold=-18dB:ratio=2.0:attack=10:release=90,alimiter=limit=0.95';

    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        inPath,
        '-af',
        filterChain,
        '-ar',
        '24000',
        '-ac',
        '1',
        '-b:a',
        '64k',
        outPath,
      ],
      { timeout: 12000 }
    );

    const polished = fs.readFileSync(outPath);
    return polished.length > 100 ? polished : rawMp3;
  } catch {
    return rawMp3;
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

/**
 * Synthesizes ONE cohesive, recognizable Myanmar voice stream (single speaker identity,
 * natural Burmese cadence, explicit Voice Tone & pitch support, zero double-voice artifacts).
 */
export async function synthesizeNeuralRealityMyanmar(
  text: string,
  options: SynthesizeOptions = {}
): Promise<Buffer> {
  const voiceKey = options.voice || 'Thiha';
  const profile = REALITY_VOICE_CONFIGS[voiceKey] || REALITY_VOICE_CONFIGS.Thiha;
  const style = options.style || 'recap';
  const emotionHint = options.emotion || '';

  let pitchShiftPct = 0;
  let rateShiftPct = 10;

  switch (style) {
    case 'recap':
      pitchShiftPct = 0;
      rateShiftPct = 12;
      break;
    case 'broadcast':
      pitchShiftPct = 2;
      rateShiftPct = 10;
      break;
    case 'energetic':
      pitchShiftPct = 4;
      rateShiftPct = 16;
      break;
    case 'soothing':
      pitchShiftPct = -2;
      rateShiftPct = -4;
      break;
    case 'affectionate':
      pitchShiftPct = 1;
      rateShiftPct = 4;
      break;
    case 'conversational':
    default:
      pitchShiftPct = 0;
      rateShiftPct = 8;
      break;
  }

  const toneAdj = getToneAdjustments(options.tone);
  const finePitchPct = parsePitchOffsetPct(options.pitchOffset);

  let userSpeedPercent = 0;
  if (typeof options.speed === 'number' && options.speed > 0) {
    userSpeedPercent = Math.round((options.speed - 1.0) * 100);
  } else if (options.rateOffset) {
    userSpeedPercent = parseInt(options.rateOffset.replace('%', ''), 10) || 0;
  }

  const totalBasePitchPct = profile.basePitchPct + pitchShiftPct + toneAdj.pitchPct + finePitchPct;
  const totalBaseRatePct = Math.min(42, Math.max(-30, profile.baseRatePct + rateShiftPct + toneAdj.ratePct + userSpeedPercent));
  const totalBaseVolPct = toneAdj.volPct;

  const cleanSpeechText = formatMyanmarSpeechText(text);
  if (!cleanSpeechText || !/[က-႟a-zA-Z0-9]/.test(cleanSpeechText)) {
    throw new Error('Speech text contains no speakable characters');
  }

  // Max 2 <prosody> blocks inside ONE continuous <voice> stream — always single cohesive voice
  const clauses = splitIntoTwoBalancedClauses(cleanSpeechText);
  const prosodyXml = clauses
    .map((clause, idx) => {
      const p = computeNaturalSingleVoiceProsody(
        clause,
        emotionHint,
        idx,
        clauses.length,
        totalBasePitchPct,
        totalBaseRatePct,
        totalBaseVolPct
      );
      return `<prosody pitch="${p.pitchStr}" rate="${p.rateStr}" volume="${p.volStr}">${escapeXml(clause)}</prosody>`;
    })
    .join(' ');

  const runOnce = (forceFreshToken = false): Promise<Buffer> => {
    if (forceFreshToken) {
      cachedToken = '';
      cachedTokenTime = 0;
    }
    const token = getSecMsGecV2Token();
    if (!token) {
      return Promise.reject(new Error('Failed to generate Sec-MS-GEC v2 authentication token'));
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
          if (audioChunks.length > 100) {
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
          const configMsg =
            'Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}';
          ws?.send(configMsg);

          const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="my-MM"><voice name="${profile.azureVoice}">${prosodyXml}</voice></speak>`;
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
                if (fullAudio.length < 100) {
                  reject(new Error('Empty audio buffer from Edge Neural TTS'));
                } else {
                  resolve(fullAudio);
                }
              }
            }
          }
        });

        ws.on('error', (err) => {
          if (!isFinished) {
            isFinished = true;
            clearTimeout(timeout);
            if (audioChunks.length > 100) {
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
            const fullAudio = Buffer.concat(audioChunks);
            if (fullAudio.length > 100) {
              resolve(fullAudio);
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
  };

  const useRecapProMastering = voiceKey === 'RecapPro' || (options.tone || '').toLowerCase() === 'recap_pro';

  try {
    const raw = await runOnce(false);
    return await polishSingleVoiceStream(raw, useRecapProMastering);
  } catch (firstErr: any) {
    console.warn('Neural Reality TTS retry #1 notice:', firstErr?.message);
    await new Promise((r) => setTimeout(r, 250));
    const raw = await runOnce(true);
    return await polishSingleVoiceStream(raw, useRecapProMastering);
  }
}
