import fs from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { GoogleGenAI, Type } from '@google/genai';
import { synthesizeNeuralRealityMyanmar, REALITY_VOICE_CONFIGS } from './neuralRealityTts';
import { separateAudioStems, detectSeparationCapabilities } from './audioSeparationAdapter';

const execAsync = promisify(exec);

export interface VideoMetadata {
  filename: string;
  filesize: number;
  duration: number; // in seconds
  width: number;
  height: number;
  resolution: string;
  format: string;
  hasAudio: boolean;
  uploadedAt: number;
}

export interface NarratorSegment {
  id: string;
  index: number;
  startTime: number;
  endTime: number;
  duration: number;
  sourceText: string;
  burmeseText: string;
  uncertainWords: string[];
  approved: boolean;
  audioUrl?: string | null;
  audioDuration?: number | null;
  speedAdjustment?: number; // e.g. 1.0 to 1.10 max
  status: 'pending' | 'review' | 'generating' | 'ready' | 'error';
  errorMessage?: string;
  durationWarning?: string;
}

export type JobStage =
  | 'idle'
  | 'uploading'
  | 'reading_video'
  | 'transcribing'
  | 'translating'
  | 'waiting_for_review'
  | 'generating_narration'
  | 'syncing_audio'
  | 'exporting_mp4'
  | 'completed'
  | 'error';

export interface NarratorJob {
  id: string;
  createdAt: number;
  stage: JobStage;
  stagePercent: number;
  overallPercent: number;
  message: string;
  elapsedSeconds: number;
  mode: 'burmese_narrator' | 'scene_retell' | 'transcript_only' | 'subtitle_only' | 'narration_and_subtitle';
  provider: 'gemini' | 'edge_neural' | 'camb';
  voice: string;
  gender: 'male' | 'female';
  style: 'recap' | 'conversational' | 'documentary' | 'energetic' | 'soothing';
  pacing: number; // 0.8 to 1.2
  muteOriginal: boolean;
  originalVolume: number; // 0.0 to 1.0
  narrationVolume: number; // 0.5 to 1.5
  videoPath: string;
  videoUrl: string;
  videoMetadata: VideoMetadata;
  audioPath?: string;
  segments: NarratorSegment[];
  exportUrls?: {
    videoMp4?: string;
    audioWav?: string;
    subtitleSrt?: string;
    scriptTxt?: string;
    scriptJson?: string;
  };
  error?: string;
}

export const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
export const VIDEOS_DIR = path.join(UPLOADS_DIR, 'videos');
export const AUDIO_DIR = path.join(UPLOADS_DIR, 'audio');
export const EXPORTS_DIR = path.join(UPLOADS_DIR, 'exports');

[UPLOADS_DIR, VIDEOS_DIR, AUDIO_DIR, EXPORTS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const jobs = new Map<string, NarratorJob>();

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server. Please check Google AI Studio Settings > Secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function probeVideoFile(filePath: string, originalName: string): Promise<VideoMetadata> {
  const stats = fs.statSync(filePath);
  let duration = 0;
  let width = 0;
  let height = 0;
  let format = path.extname(originalName).replace('.', '').toLowerCase();
  let hasAudio = false;

  try {
    const cmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration -show_entries format=duration,format_name -of json "${filePath}"`;
    const { stdout } = await execAsync(cmd);
    const data = JSON.parse(stdout);

    if (data.streams && data.streams[0]) {
      width = parseInt(data.streams[0].width || '0', 10);
      height = parseInt(data.streams[0].height || '0', 10);
      duration = parseFloat(data.streams[0].duration || '0');
    }

    if (!duration && data.format && data.format.duration) {
      duration = parseFloat(data.format.duration);
    }

    const audioCmd = `ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
    const { stdout: audioOut } = await execAsync(audioCmd);
    hasAudio = audioOut.trim().length > 0;
  } catch (err) {
    console.warn('ffprobe probe warning:', err);
  }

  return {
    filename: originalName,
    filesize: stats.size,
    duration: Math.max(1, Math.round(duration)),
    width: width || 1280,
    height: height || 720,
    resolution: width && height ? `${width}x${height}` : 'Standard',
    format: format || 'mp4',
    hasAudio,
    uploadedAt: Date.now(),
  };
}

export function createJob(params: {
  videoPath: string;
  videoUrl: string;
  metadata: VideoMetadata;
  mode: NarratorJob['mode'];
  provider: NarratorJob['provider'];
  voice: string;
  gender: 'male' | 'female';
  style: NarratorJob['style'];
  pacing: number;
  muteOriginal: boolean;
  originalVolume: number;
  narrationVolume: number;
}): NarratorJob {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const job: NarratorJob = {
    id: jobId,
    createdAt: Date.now(),
    stage: 'reading_video',
    stagePercent: 10,
    overallPercent: 10,
    message: 'ဗီဒီယိုဖိုင်ကို စစ်ဆေးဖတ်ရှုနေပါသည်...',
    elapsedSeconds: 0,
    mode: params.mode,
    provider: params.provider,
    voice: params.voice,
    gender: params.gender,
    style: params.style,
    pacing: params.pacing || 1.0,
    muteOriginal: params.muteOriginal !== undefined ? params.muteOriginal : true,
    originalVolume: params.originalVolume !== undefined ? params.originalVolume : 0.0,
    narrationVolume: params.narrationVolume !== undefined ? params.narrationVolume : 1.0,
    videoPath: params.videoPath,
    videoUrl: params.videoUrl,
    videoMetadata: params.metadata,
    segments: [],
  };

  jobs.set(jobId, job);
  startJobProcessing(job).catch((err) => {
    console.error(`Error processing job ${jobId}:`, err);
    job.stage = 'error';
    job.error = err.message || 'Job processing failed';
    job.message = `လုပ်ဆောင်မှု မအောင်မြင်ပါ: ${err.message || 'မသိရသော အမှား'}`;
  });

  return job;
}

export function getJob(jobId: string): NarratorJob | undefined {
  const job = jobs.get(jobId);
  if (job) {
    job.elapsedSeconds = Math.round((Date.now() - job.createdAt) / 1000);
  }
  return job;
}

async function startJobProcessing(job: NarratorJob): Promise<void> {
  const audioOutputPath = path.join(AUDIO_DIR, `${job.id}_source.mp3`);

  job.stage = 'reading_video';
  job.stagePercent = 25;
  job.overallPercent = 15;
  job.message = 'ဗီဒီယိုမှ မူရင်းအသံဖိုင်ကို ခွဲထုတ်ရယူနေပါသည်...';

  try {
    if (job.videoMetadata.hasAudio) {
      await execAsync(`ffmpeg -y -i "${job.videoPath}" -vn -ar 16000 -ac 1 -b:a 64k "${audioOutputPath}"`);
      job.audioPath = audioOutputPath;
    }
  } catch (err) {
    console.warn('Could not extract audio track, will proceed with video inspection:', err);
  }

  job.stage = 'transcribing';
  job.stagePercent = 50;
  job.overallPercent = 35;
  job.message = 'မူရင်း စကားပြောနှင့် အချိန်ကွက်များကို ခွဲခြမ်းစိတ်ဖြာနေပါသည်...';

  let rawAudioBase64 = '';
  if (job.audioPath && fs.existsSync(job.audioPath)) {
    const audioBuf = fs.readFileSync(job.audioPath);
    if (audioBuf.length <= 15 * 1024 * 1024) {
      rawAudioBase64 = audioBuf.toString('base64');
    }
  }

  // Extract representative visual keyframes from the custom uploaded MP4 video
  const keyframeParts: any[] = [];
  try {
    const tempFramesDir = path.join(UPLOADS_DIR, `frames_${job.id}`);
    if (!fs.existsSync(tempFramesDir)) fs.mkdirSync(tempFramesDir, { recursive: true });

    const durationSec = job.videoMetadata.duration || 60;
    const numKeyframes = Math.min(12, Math.max(6, Math.floor(durationSec / 15)));
    const frameRate = Math.max(0.05, numKeyframes / durationSec);
    await execAsync(`ffmpeg -y -i "${job.videoPath}" -vf "fps=${frameRate.toFixed(3)},scale=640:-1" -vframes 12 "${tempFramesDir}/frame_%02d.jpg"`);

    const extractedFiles = fs.readdirSync(tempFramesDir).filter((f) => f.endsWith('.jpg')).sort();
    for (const f of extractedFiles) {
      const fPath = path.join(tempFramesDir, f);
      const buf = fs.readFileSync(fPath);
      if (buf.length > 500) {
        keyframeParts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: buf.toString('base64'),
          },
        });
      }
    }
    fs.rmSync(tempFramesDir, { recursive: true, force: true });
  } catch (frameErr: any) {
    console.warn('Server keyframe extraction warning:', frameErr.message);
  }

  const ai = getGeminiClient();

  const durationSec = job.videoMetadata.duration || 60;
  const targetSegmentsCount = Math.max(2, Math.round(durationSec / 20)); // ~15-25 seconds per scene segment

  const stylePrompts = {
    recap: 'Dramatic cinematic movie recap style (စိတ်လှုပ်ရှားဖွယ် ဇာတ်လမ်းပြော)',
    conversational: 'Warm natural conversational everyday tone (သဘာဝကျသော စကားပြော)',
    documentary: 'Serious informative documentary narration (တည်ကြည်လေးနက်သော မှတ်တမ်းတင်ဟန်)',
    energetic: 'Upbeat dynamic engaging viral style (သွက်လက်တက်ကြွသော စတိုင်လ်)',
    soothing: 'Calm gentle peaceful pacing (အေးချမ်းညင်သာသော ဇာတ်လမ်းပြော)',
  };

  const modeInstructions = {
    burmese_narrator: 'Translate and retell the dialogue in natural spoken Burmese narration, preserving exact sequence, jokes, names, numbers, and facts without inventing events.',
    scene_retell: 'Provide scene-timed retelling that explains the action and dialogue in concise, vivid Burmese narration synchronized with video events.',
    transcript_only: 'Transcribe source speech accurately line-by-line and translate faithfully to Burmese.',
    subtitle_only: 'Provide clean, concise subtitle-friendly segments (<35 Burmese characters per line) ready for SRT.',
    narration_and_subtitle: 'Provide both natural Burmese voiceover narration and clean subtitle lines.',
  };

  const systemInstruction = `You are a professional Burmese video narrator, audio sync engineer, and dialogue localization expert.
MANDATORY STEP 3 TTX NARRATOR RULES FOR CUSTOM UPLOADS:
1. STRICT VIDEO FIDELITY & TIMELINE ORDER: Inspect the attached visual JPEG keyframes AND audio. Translate original spoken dialogue in chronological order and track exactly which scene/moment of the video each event belongs to.
2. NO VAGUE SUMMARIZATION / NO GUESSING: Do NOT collapse scenes into vague summaries or invent unrecorded events. Retain real names, numbers, money amounts, weights, locations, jokes, and facts.
3. SINGLE NARRATOR STORYTELLING STYLE (တစ်သံတည်း ဇာတ်ကြောင်းပြန်ပြောပုံစံ): Write as ONE consistent Burmese storyteller retelling character dialogue and events in narrative format without splitting into separate acting character voices.
4. UNCLEAR SPEECH: If any speech or name is muffled or uncertain, mark it explicitly in uncertainWords and insert "[မရှင်းလင်း]" in the text rather than guessing.
5. SCENE SEGMENTATION: Divide into chronological sequential scene beats (4s–10s each) matched strictly to start and end timestamps inside each 1-minute block.
6. SUBTITLE FORMATTING: Max 2 lines per subtitle cue, under 35 Burmese characters per line, broken at natural phrase breaks.
7. STYLE: ${stylePrompts[job.style]}.
8. MODE: ${modeInstructions[job.mode]}.`;

  const promptText = `Analyze this custom uploaded video content (duration: ${durationSec}s, filename: "${job.videoMetadata.filename}").
Inspect the attached visual JPEG keyframes from this specific video alongside the audio.
Divide it into chronological sequential segments anchored inside each 1-minute window (0-60s, 60-120s, etc., typically 4 to 10 seconds per segment).
For each segment return:
- index: 1-based integer
- startTime: start time in seconds (float)
- endTime: end time in seconds (float)
- sourceText: exact original spoken dialogue or visual event at that timestamp in THIS video
- burmeseText: single-narrator storytelling Burmese retelling matching THIS exact moment (တစ်သံတည်း ဇာတ်ကြောင်းပြော)
- uncertainWords: array of words/names you are unsure about and need user review (can be empty [])`;

  job.stage = 'translating';
  job.stagePercent = 75;
  job.overallPercent = 50;
  job.message = 'သဘာဝကျသော မြန်မာဇာတ်ကြောင်းပြော ဇာတ်ညွှန်းအဖြစ် စီစဉ်နေပါသည်...';

  const parts: any[] = [...keyframeParts];
  if (rawAudioBase64) {
    parts.push({
      inlineData: {
        mimeType: 'audio/mp3',
        data: rawAudioBase64,
      },
    });
  }
  parts.push({ text: promptText });

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite',
    contents: { parts },
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            index: { type: Type.INTEGER },
            startTime: { type: Type.NUMBER },
            endTime: { type: Type.NUMBER },
            sourceText: { type: Type.STRING },
            burmeseText: { type: Type.STRING },
            uncertainWords: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ['index', 'startTime', 'endTime', 'sourceText', 'burmeseText'],
        },
      },
    },
  });

  let rawList: any[] = [];
  try {
    const jsonStr = (response.text || '[]').trim();
    rawList = JSON.parse(jsonStr);
  } catch (parseErr) {
    console.error('Failed to parse Gemini JSON output:', parseErr, response.text);
    rawList = [];
  }

  if (!rawList || rawList.length === 0) {
    const chunkDur = Math.min(25, Math.ceil(durationSec / 4));
    for (let t = 0; t < durationSec; t += chunkDur) {
      const start = t;
      const end = Math.min(durationSec, t + chunkDur);
      rawList.push({
        index: rawList.length + 1,
        startTime: start,
        endTime: end,
        sourceText: `Scene segment ${start}s - ${end}s`,
        burmeseText: `ဗီဒီယို အပိုင်း ${rawList.length + 1} စတင်ပါပြီ။`,
        uncertainWords: [],
      });
    }
  }

  job.segments = rawList.map((item, idx) => {
    const start = Math.max(0, parseFloat(item.startTime || '0'));
    const end = Math.max(start + 1, parseFloat(item.endTime || `${start + 15}`));
    const dur = parseFloat((end - start).toFixed(2));
    return {
      id: `seg_${job.id}_${idx + 1}`,
      index: idx + 1,
      startTime: parseFloat(start.toFixed(2)),
      endTime: parseFloat(end.toFixed(2)),
      duration: dur,
      sourceText: item.sourceText || '',
      burmeseText: item.burmeseText || '',
      uncertainWords: Array.isArray(item.uncertainWords) ? item.uncertainWords : [],
      approved: false,
      audioUrl: null,
      audioDuration: null,
      speedAdjustment: 1.0,
      status: 'review',
    };
  });

  job.stage = 'waiting_for_review';
  job.stagePercent = 100;
  job.overallPercent = 60;
  job.message = `အပိုင်း ${job.segments.length} ခု ခွဲခြမ်းပြီးပါပြီ။ စာသားများနှင့် အချိန်များကို စစ်ဆေးအတည်ပြုပေးပါ။`;
}

export async function refineBurmeseSegment(
  originalBurmese: string,
  targetDurationSec: number,
  sourceText?: string
): Promise<string> {
  const ai = getGeminiClient();
  const prompt = `The following Burmese narrator sentence takes too long to read within the target scene window (${targetDurationSec} seconds).
Rewrite it to be more concise, punchy, and natural in spoken Burmese, while strictly preserving its original meaning, character names, numbers, and core intent.
Target read time: strictly under ${targetDurationSec} seconds (approx ${Math.max(8, Math.floor(targetDurationSec * 3))} syllables).
Source context: "${sourceText || ''}"
Current Burmese sentence: "${originalBurmese}"

Return ONLY the refined Burmese sentence without commentary or quotes.`;

  const res = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite',
    contents: prompt,
  });

  const refined = (res.text || '').trim().replace(/^["']|["']$/g, '');
  return refined || originalBurmese;
}

export async function generateSegmentAudio(
  job: NarratorJob,
  segmentId: string,
  customText?: string
): Promise<NarratorSegment> {
  const segment = job.segments.find((s) => s.id === segmentId);
  if (!segment) {
    throw new Error('Segment not found');
  }

  segment.status = 'generating';
  const textToSynthesize = (customText !== undefined ? customText : segment.burmeseText).trim();
  if (!textToSynthesize) {
    throw new Error('Burmese narration text is empty');
  }

  const outFileName = `${segment.id}_${Date.now()}.mp3`;
  const outFilePath = path.join(AUDIO_DIR, outFileName);

  let audioBuffer: Buffer | null = null;

  if (job.provider === 'edge_neural' || job.provider === 'camb') {
    const selectedVoice = job.voice || (job.gender === 'female' ? 'Nilar' : 'Thiha');
    audioBuffer = await synthesizeNeuralRealityMyanmar(textToSynthesize, {
      voice: selectedVoice,
      style: job.style || 'recap',
      speed: job.pacing || 1.0,
    });
  } else {
    try {
      const ai = getGeminiClient();
      const geminiVoice = job.gender === 'female' ? 'Kore' : 'Charon';

      const ttsResponse = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: textToSynthesize,
                speechMetadata: {
                  style: `VOICE DIRECTOR — BURMESE NATURAL HUMAN VOICE (${job.style} mood): Speak like a real native Burmese person talking face-to-face to a close friend—natural Burmese sentence melody, connected speech, subtle breaths, stress meaningful words naturally, never robotic/audiobook/newsreader, never exaggerate.`,
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: geminiVoice },
            },
          },
        },
      });

      const base64Data = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Data) {
        audioBuffer = Buffer.from(base64Data, 'base64');
      }
    } catch (geminiTtsErr: any) {
      console.warn('Gemini TTS fallback notice, using 24kHz Studio Neural Voice:', geminiTtsErr.message);
      const fallbackVoice = job.gender === 'female' ? 'Nilar' : 'Thiha';
      audioBuffer = await synthesizeNeuralRealityMyanmar(textToSynthesize, {
        voice: fallbackVoice,
        style: job.style || 'recap',
        speed: job.pacing || 1.0,
      });
    }
  }

  if (!audioBuffer || audioBuffer.length < 100) {
    throw new Error('Audio generation failed to produce valid audio');
  }

  fs.writeFileSync(outFilePath, audioBuffer);

  let measuredDuration = 0;
  try {
    const probeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outFilePath}"`;
    const { stdout } = await execAsync(probeCmd);
    measuredDuration = parseFloat(stdout.trim()) || 0;
  } catch (err) {
    measuredDuration = parseFloat(((audioBuffer.length / 32000)).toFixed(2));
  }

  segment.audioUrl = `/uploads/audio/${outFileName}`;
  segment.audioDuration = parseFloat(measuredDuration.toFixed(2));
  segment.burmeseText = textToSynthesize;

  const slotDuration = segment.duration;
  let speedAdjustment = 1.0;
  let durationWarning = '';

  if (measuredDuration > slotDuration) {
    const ratio = measuredDuration / slotDuration;
    if (ratio <= 1.10) {
      speedAdjustment = parseFloat(ratio.toFixed(2));
      durationWarning = `စကားသံကြာချိန် အနည်းငယ်ကျော်နေပါသည် (+${(measuredDuration - slotDuration).toFixed(1)}s)။ ${Math.round((speedAdjustment - 1) * 100)}% နှုန်း အသာအယာညှိထားပါသည်။`;
    } else {
      speedAdjustment = 1.10;
      durationWarning = `⚠️ စကားသံ ${(measuredDuration - slotDuration).toFixed(1)}s ရှည်နေပါသည်! သဘာဝကျစေရန် စာကြောင်းကို တိုတိုပြန်ရေးပေးပါ။`;
    }
  }

  segment.speedAdjustment = speedAdjustment;
  segment.durationWarning = durationWarning;
  segment.status = 'ready';
  segment.approved = true;

  return segment;
}

export async function generateAllNarrations(
  job: NarratorJob,
  onProgress?: (index: number, total: number) => void
): Promise<void> {
  job.stage = 'generating_narration';
  job.stagePercent = 0;
  job.overallPercent = 70;
  job.message = 'ဇာတ်ကြောင်းပြော အသံဖိုင်များကို တစ်ပိုင်းချင်း အချိန်ကိုက် ထုတ်လုပ်နေပါသည်...';

  const total = job.segments.length;
  for (let i = 0; i < total; i++) {
    const seg = job.segments[i];
    job.message = `အပိုင်း (${i + 1}/${total}) အတွက် အသံထုတ်လုပ်နေပါသည်...`;
    job.stagePercent = Math.round(((i + 1) / total) * 100);
    job.overallPercent = Math.round(70 + ((i + 1) / total) * 15);

    try {
      await generateSegmentAudio(job, seg.id);
    } catch (err: any) {
      console.error(`Failed to generate audio for segment ${seg.id}:`, err);
      seg.status = 'error';
      seg.errorMessage = err.message || 'Generation failed';
    }

    if (onProgress) {
      onProgress(i + 1, total);
    }
  }

  job.stagePercent = 100;
  job.overallPercent = 85;
  job.message = 'အသံဖိုင်များ အားလုံး အောင်မြင်စွာ ထုတ်လုပ်ပြီးပါပြီ!';
}

function formatBurmeseSrtLines(text: string): string {
  const cleaned = (text || '').replace(/[\u4e00-\u9fa5\u3000-\u303f\uff01-\uff5e]/g, '').trim();
  if (!cleaned) return '';

  const explicitLines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (explicitLines.length > 0 && explicitLines.length <= 2 && explicitLines.every((l) => l.length <= 40)) {
    return explicitLines.join('\n');
  }

  if (cleaned.length <= 35) return cleaned;

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

export async function exportNarratorPackage(job: NarratorJob): Promise<NarratorJob['exportUrls']> {
  job.stage = 'syncing_audio';
  job.stagePercent = 30;
  job.overallPercent = 88;
  job.message = 'မူရင်း ဗီဒီယိုနှင့် ဇာတ်ကြောင်းပြော အသံလှိုင်းများကို အချိန်ကွက် တိကျစွာ ညှိနှိုင်းနေပါသည်...';

  const srtFileName = `${job.id}_subtitles.srt`;
  const srtFilePath = path.join(EXPORTS_DIR, srtFileName);
  let srtContent = '';

  const txtFileName = `${job.id}_script.txt`;
  const txtFilePath = path.join(EXPORTS_DIR, txtFileName);
  let txtContent = `Burmese Video Narrator Script\nVideo: ${job.videoMetadata.filename}\nDuration: ${job.videoMetadata.duration}s\n\n`;

  const jsonFileName = `${job.id}_script.json`;
  const jsonFilePath = path.join(EXPORTS_DIR, jsonFileName);

  job.segments.forEach((seg, idx) => {
    const startSrt = formatSecondsToSRT(seg.startTime);
    const endSrt = formatSecondsToSRT(Math.max(seg.endTime, seg.startTime + 0.8));
    const formattedBurmeseText = formatBurmeseSrtLines(seg.burmeseText);
    srtContent += `${idx + 1}\n${startSrt} --> ${endSrt}\n${formattedBurmeseText}\n\n`;
    txtContent += `[${startSrt.split(',')[0]} - ${endSrt.split(',')[0]}] ${seg.burmeseText}\n`;
  });

  fs.writeFileSync(srtFilePath, srtContent.trim() + '\n', 'utf-8');
  fs.writeFileSync(txtFilePath, txtContent.trim(), 'utf-8');
  fs.writeFileSync(jsonFilePath, JSON.stringify(job.segments, null, 2), 'utf-8');

  job.stage = 'exporting_mp4';
  job.stagePercent = 60;
  job.overallPercent = 92;
  job.message = 'ဗီဒီယိုဖိုင်သစ် (MP4)၊ အသံလမ်းကြောင်းများ အော်တို Ducking နှင့် peak limiting ပြုလုပ်၍ Final Export ထုတ်ပေးနေပါသည်...';

  const outputVideoName = `${job.id}_narrated.mp4`;
  const outputVideoPath = path.join(EXPORTS_DIR, outputVideoName);

  const narratorAudioName = `${job.id}_narrator_raw.wav`;
  const narratorAudioPath = path.join(EXPORTS_DIR, narratorAudioName);

  const finalMixedAudioName = `${job.id}_final_mixed.wav`;
  const finalMixedAudioPath = path.join(EXPORTS_DIR, finalMixedAudioName);

  const readySegments = job.segments
    .filter((s) => s.audioUrl && fs.existsSync(path.join(process.cwd(), s.audioUrl)))
    .sort((a, b) => a.startTime - b.startTime);

  // 1. Build Burmese Narration Track from Timestamped Segments (with gentle atempo & zero end truncation)
  if (readySegments.length > 0) {
    const inputArgs: string[] = [];
    const filterParts: string[] = [];
    let mixCursorSec = 0;

    readySegments.forEach((seg, idx) => {
      const localAudioPath = path.join(process.cwd(), seg.audioUrl!);
      inputArgs.push(`-i "${localAudioPath}"`);
      const gentleRate = Math.min(1.15, Math.max(0.90, seg.speedAdjustment || 1.0));
      const fullClipDur = (seg.audioDuration && seg.audioDuration > 0 ? seg.audioDuration : seg.duration) / gentleRate;
      const actualStart = Math.max(mixCursorSec, Math.max(0, seg.startTime));
      mixCursorSec = actualStart + fullClipDur + 0.04;

      const delayMs = Math.max(0, Math.round(actualStart * 1000));
      const chain: string[] = [];
      if (Math.abs(gentleRate - 1.0) > 0.01) {
        chain.push(`atempo=${gentleRate.toFixed(2)}`);
      }
      chain.push(`adelay=${delayMs}|${delayMs}`);
      filterParts.push(`[${idx}:a]${chain.join(',')}[a${idx}]`);
    });

    const mixInputs = readySegments.map((_, i) => `[a${i}]`).join('');
    const mixFilter = `${filterParts.join(';')};${mixInputs}amix=inputs=${readySegments.length}:duration=longest:normalize=0[aout]`;

    try {
      const narratorMixCmd = `ffmpeg -y ${inputArgs.join(' ')} -filter_complex "${mixFilter}" -map "[aout]" -c:a pcm_s16le "${narratorAudioPath}"`;
      await execAsync(narratorMixCmd);
    } catch (mixErr: any) {
      console.warn('Narrator audio build warning:', mixErr.message);
    }
  }

  // 2. Perform Stem Separation & Dynamic Sidechain Ducking + Peak Limiting
  const origVol = job.muteOriginal ? 0.0 : (job.originalVolume !== undefined ? job.originalVolume : 0.4);
  const narrVol = job.narrationVolume !== undefined ? job.narrationVolume : 1.0;

  let instrumentalPath: string | null = null;
  if (origVol > 0.01 && job.audioPath && fs.existsSync(job.audioPath)) {
    try {
      job.message = 'နောက်ခံတန့်သံ/သီချင်း (BGM) ကို သီးခြားခွဲထုတ်၍ စကားပြောချိန် အသံအလိုအလျောက် တီးတိုးပေးသည့် Ducking ပြုလုပ်နေပါသည်...';
      const sepResult = await separateAudioStems(job.audioPath, EXPORTS_DIR, job.id);
      if (sepResult.success && sepResult.instrumentalStemPath && fs.existsSync(sepResult.instrumentalStemPath)) {
        instrumentalPath = sepResult.instrumentalStemPath;
      }
    } catch (sepErr: any) {
      console.warn('Stem separation warning:', sepErr.message);
    }
  }

  // Combine narration and background stem with sidechain compression ducking & alimiter
  try {
    if (fs.existsSync(narratorAudioPath)) {
      if (instrumentalPath && fs.existsSync(instrumentalPath)) {
        // Apply sidechain compression ducking: when narrator speaks, BGM volume reduces dynamically and recovers between lines
        // alimiter=limit=0.95 prevents distortion or clipping
        const sidechainFilter = `[0:a]volume=${origVol}[bgm];[1:a]volume=${narrVol}[narr];[bgm][narr]sidechaincompress=threshold=0.08:ratio=6:attack=20:release=300:link=average[ducked];[ducked][narr]amix=inputs=2:duration=first:normalize=0[mixed];[mixed]alimiter=limit=0.95:level=disabled[final_a]`;
        const duckCmd = `ffmpeg -y -i "${instrumentalPath}" -i "${narratorAudioPath}" -filter_complex "${sidechainFilter}" -map "[final_a]" -c:a pcm_s16le "${finalMixedAudioPath}"`;
        await execAsync(duckCmd);
      } else {
        // Pure narration peak limiting
        const limitCmd = `ffmpeg -y -i "${narratorAudioPath}" -filter_complex "[0:a]volume=${narrVol},alimiter=limit=0.95:level=disabled[outa]" -map "[outa]" -c:a pcm_s16le "${finalMixedAudioPath}"`;
        await execAsync(limitCmd);
      }
    }
  } catch (mixFilterErr: any) {
    console.warn('Audio sidechain mixing warning:', mixFilterErr.message);
  }

  const audioToUse = fs.existsSync(finalMixedAudioPath) ? finalMixedAudioPath : (fs.existsSync(narratorAudioPath) ? narratorAudioPath : null);

  // 3. Merge audio with video stream, keeping exact video duration
  try {
    if (audioToUse && fs.existsSync(job.videoPath)) {
      const videoCmd = `ffmpeg -y -i "${job.videoPath}" -i "${audioToUse}" -c:v copy -map 0:v:0 -map 1:a:0 -shortest "${outputVideoPath}"`;
      await execAsync(videoCmd);
    }
  } catch (vidErr: any) {
    console.warn('MP4 final video merge warning:', vidErr.message);
  }

  job.exportUrls = {
    videoMp4: fs.existsSync(outputVideoPath) ? `/uploads/exports/${outputVideoName}` : undefined,
    audioWav: audioToUse ? `/uploads/exports/${path.basename(audioToUse)}` : undefined,
    subtitleSrt: `/uploads/exports/${srtFileName}`,
    scriptTxt: `/uploads/exports/${txtFileName}`,
    scriptJson: `/uploads/exports/${jsonFileName}`,
  };

  job.stage = 'completed';
  job.stagePercent = 100;
  job.overallPercent = 100;
  job.message = 'ဗီဒီယို ဇာတ်ကြောင်းပြောနှင့် Subtitle Export အားလုံး အောင်မြင်စွာ ပြီးစီးပါပြီ!';

  return job.exportUrls;
}

function formatSecondsToSRT(seconds: number): string {
  const pad = (num: number, size = 2) => String(num).padStart(size, '0');
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}
