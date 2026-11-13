import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import multer from 'multer';
import { exec } from 'child_process';
import os from 'os';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { synthesizeNeuralRealityMyanmar, REALITY_VOICE_CONFIGS } from './server/neuralRealityTts';
import {
  UPLOADS_DIR,
  VIDEOS_DIR,
  AUDIO_DIR,
  EXPORTS_DIR,
  createJob,
  getJob,
  probeVideoFile,
  refineBurmeseSegment,
  generateSegmentAudio,
  generateAllNarrations,
  exportNarratorPackage,
} from './server/narratorJobManager';
import { detectSeparationCapabilities, extractBgmAndSfxFromVideo } from './server/audioSeparationAdapter';
import {
  VERIFIED_BURMESE_PROVIDERS,
  getProviderDisclosures,
  generateTestSentenceAudio,
} from './server/ttsAdapter';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isValidAsciiApiKey(key: any): boolean {
  if (typeof key !== 'string') return false;
  const trimmed = key.trim();
  if (!trimmed || trimmed.length < 4) return false;
  // Must only contain printable ASCII characters (0x21 to 0x7E)
  return /^[\x21-\x7E]+$/.test(trimmed);
}

function cleanAsciiHeader(value: string): string {
  let cleaned = (value || '').replace(/[^\x21-\x7E]/g, '').trim();
  cleaned = cleaned.replace(/^["'`]+|["'`]+$/g, '');
  cleaned = cleaned.replace(/^(Bearer|Key|api_key=)\s*/i, '');
  return cleaned.trim();
}

function formatNetworkError(error: any, serviceName: string): string {
  const msg = error?.message || '';
  const status = error?.status || error?.statusCode;
  if (status === 401 || status === 403 || msg.includes('API_KEY_INVALID') || msg.includes('key not valid') || msg.includes('403')) {
    return `${serviceName} API Key မမှန်ကန်ပါ သို့မဟုတ် ခွင့်ပြုချက်မရှိပါ (401/403 Invalid API Key)။ Google AI Studio မှ API Key အမှန်ကို ထည့်သွင်းပါ။`;
  }
  if (status === 404 || msg.includes('404') || msg.includes('not found') || msg.includes('model not found')) {
    return `${serviceName} Model ရှာမတွေ့ပါ သို့မဟုတ် မရှိတော့ပါ (404 Model Not Found)။`;
  }
  if (status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
    return `${serviceName} API Key Quota ပြည့်သွားပါပြီ (429 Quota Exceeded)။ ခေတ္တစောင့်ပါ သို့မဟုတ် နောက် Key တစ်ခု ထည့်ပေးပါ။`;
  }
  if (msg.includes('ByteString') || msg.includes('ERR_INVALID_CHAR')) {
    return `${serviceName} API Key မမှန်ကန်ပါ (မြန်မာစာလုံးများ ပါဝင်နေပါသည်)။`;
  }
  return error?.message || `${serviceName} ချိတ်ဆက်မှု မအောင်မြင်ပါ`;
}

function analyzeGeminiError(error: any) {
  const status = error?.status || error?.statusCode || 500;
  const msg = error?.message || String(error);
  const details = error?.details ? JSON.stringify(error.details) : (error?.error?.details ? JSON.stringify(error.error.details) : 'No error details');
  
  if (status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
    const lower = `${msg} ${details}`.toLowerCase();
    let quotaType = 'General Quota Exceeded';
    let desc = 'API Quota limit reached.';
    if (lower.includes('token') || lower.includes('tokencount')) {
      quotaType = 'TPM (Tokens Per Minute)';
      desc = 'Tokens Per Minute (TPM) limit exceeded. Too many tokens in 1 minute. Wait 60s or reduce prompt size.';
    } else if (lower.includes('requestsperminute') || lower.includes('rpm') || lower.includes('minute')) {
      quotaType = 'RPM (Requests Per Minute)';
      desc = 'Requests Per Minute (RPM) rate limit exceeded. Too many requests per minute. Wait 30-60 seconds.';
    } else if (lower.includes('requestsperday') || lower.includes('rpd') || lower.includes('day')) {
      quotaType = 'RPD (Requests Per Day)';
      desc = 'Requests Per Day (RPD) daily free quota exhausted. Add another key or upgrade.';
    } else if (lower.includes('billing') || lower.includes('payment') || lower.includes('credit')) {
      quotaType = 'Billing Restriction';
      desc = 'Billing restriction. Payment account or billing required for this project.';
    } else if (lower.includes('project') || lower.includes('consumer')) {
      quotaType = 'Project Quota';
      desc = 'Project-level quota exceeded across all keys in this Google Cloud project.';
    }
    return {
      status: 'RESOURCE_EXHAUSTED (429)',
      message: msg,
      details,
      quotaType,
      detailedDescription: desc,
    };
  }
  return {
    status: String(status),
    message: msg,
    details,
    quotaType: status === 401 || status === 403 ? 'Unauthorized' : 'Error',
    detailedDescription: msg,
  };
}

function createGeminiClient(apiKey?: string) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function callGeminiRest(
  keyToUse: string,
  model: string,
  contentsPayload: any,
  systemInstruction?: any,
  options?: { responseMimeType?: string; timeoutMs?: number }
) {
  const isOAuth = keyToUse.startsWith('ya29.') || keyToUse.startsWith('ya29') || keyToUse.startsWith('1//');

  const url = isOAuth
    ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(keyToUse)}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (isOAuth) {
    headers['Authorization'] = `Bearer ${keyToUse}`;
  }

  let formattedContents: any;
  if (typeof contentsPayload === 'string') {
    formattedContents = [{ role: 'user', parts: [{ text: contentsPayload }] }];
  } else if (Array.isArray(contentsPayload)) {
    formattedContents = contentsPayload;
  } else if (contentsPayload && Array.isArray(contentsPayload.parts)) {
    formattedContents = [{ role: 'user', parts: contentsPayload.parts }];
  } else {
    formattedContents = contentsPayload;
  }

  const body: any = {
    contents: formattedContents,
  };

  if (systemInstruction) {
    if (typeof systemInstruction === 'string') {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    } else {
      body.systemInstruction = systemInstruction;
    }
  }

  if (options?.responseMimeType) {
    body.generationConfig = {
      responseMimeType: options.responseMimeType,
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options?.timeoutMs || 40000),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errObj = data.error || data;
    const err = new Error(errObj.message || `Gemini REST API error (HTTP ${res.status})`);
    (err as any).status = res.status;
    (err as any).details = errObj.details || errObj;
    throw err;
  }

  const candidate = data.candidates?.[0];
  const partText = candidate?.content?.parts?.[0]?.text;
  if (partText !== undefined) {
    return partText;
  }

  throw new Error('No text returned in Gemini REST response');
}

function getServerPort(): number {
  const portArgIdx = process.argv.indexOf('--port');
  if (portArgIdx !== -1 && process.argv[portArgIdx + 1]) {
    const parsed = Number(process.argv[portArgIdx + 1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const envPort = Number(process.env.PORT);
  if (process.env.NODE_ENV !== 'production') {
    return envPort && envPort !== 8080 ? envPort : 3000;
  }
  return envPort || 3000;
}

async function startServer() {
  const app = express();
  const PORT = getServerPort();

  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '100mb' }));

  // CORS Middleware
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Static uploads directory for videos, audio clips, and exports
  app.use('/uploads', express.static(UPLOADS_DIR));

  // Configure Multer for video file uploads
  const videoStorage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, VIDEOS_DIR);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
      const cleanBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
      cb(null, `vid_${Date.now()}_${cleanBase}${ext}`);
    },
  });

  const uploadVideoMiddleware = multer({
    storage: videoStorage,
    limits: { fileSize: 350 * 1024 * 1024 }, // 350MB limit
    fileFilter: (_req, file, cb) => {
      const allowed = ['.mp4', '.mov', '.webm', '.m4v', '.mkv'];
      const ext = path.extname(file.originalname).toLowerCase();
      if (allowed.includes(ext) || file.mimetype.startsWith('video/')) {
        cb(null, true);
      } else {
        cb(new Error('MP4, MOV, WebM ဗီဒီယို ဖိုင်များကိုသာ ခွင့်ပြုထားပါသည်'));
      }
    },
  });

  // 1. API Configuration & Secrets Status
  app.get('/api/narrator/config', (_req, res) => {
    const geminiKey = process.env.GEMINI_API_KEY;
    const cambKey = process.env.CAMB_API_KEY;

    return res.json({
      geminiConfigured: Boolean(geminiKey && geminiKey.trim().length > 5),
      cambConfigured: Boolean(cambKey && cambKey.trim().length > 5),
      edgeConfigured: true,
      defaultProvider: 'gemini',
      providers: getProviderDisclosures(),
      instructions: {
        gemini: 'Google AI Studio ၏ Settings > Secrets တွင် GEMINI_API_KEY ကို ထည့်သွင်းထားပါက Gemini TTS နှင့် AI ဘာသာပြန်ကို အလိုအလျောက် အသုံးပြုနိုင်ပါသည်။',
        camb: 'Third-party TTS Provider အသုံးပြုလိုပါက Settings > Secrets တွင် CAMB_API_KEY နာမည်ဖြင့် ထည့်သွင်းနိုင်ပါသည်။',
      },
    });
  });

  // 1b. Verified TTS Providers Disclosure
  app.get('/api/narrator/tts-providers', (_req, res) => {
    return res.json({
      success: true,
      providers: VERIFIED_BURMESE_PROVIDERS,
    });
  });

  // 1c. Test Sentence Audio Synthesis Endpoint
  app.post('/api/narrator/test-tts', async (req, res) => {
    try {
      const { provider = 'edge_neural', voice = 'Thiha', speed = 1.0, testText, apiKey } = req.body;
      const result = await generateTestSentenceAudio({
        provider,
        voice,
        speed: parseFloat(speed) || 1.0,
        testText,
        apiKey: apiKey || process.env.GEMINI_API_KEY,
      });

      const fileName = `test_sentence_${Date.now()}.mp3`;
      const filePath = path.join(AUDIO_DIR, fileName);
      fs.writeFileSync(filePath, result.audioBuffer);

      return res.json({
        success: true,
        audioUrl: `/uploads/audio/${fileName}`,
        durationSec: result.durationSec,
        statusMessage: result.statusMessage,
        provider,
        voice,
      });
    } catch (err: any) {
      console.error('Test TTS error:', err);
      return res.status(400).json({ success: false, error: err.message || 'TTS test sentence failed' });
    }
  });

  // 2. Video Upload and Metadata Probe
  app.post('/api/narrator/upload-video', uploadVideoMiddleware.single('video'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'ဗီဒီယိုဖိုင် မတွေ့ရှိပါ' });
      }

      const filePath = req.file.path;
      const metadata = await probeVideoFile(filePath, req.file.originalname);

      // Validate video duration limit (up to 30 mins)
      if (metadata.duration > 1800) {
        fs.unlinkSync(filePath);
        return res.status(400).json({ error: 'ဗီဒီယိုကြာချိန် မိနစ် ၃၀ ထက် ကျော်လွန်နေပါသည် (အများဆုံး မိနစ် ၃၀ အထိသာ ခွင့်ပြုပါသည်)' });
      }

      const relativeUrl = `/uploads/videos/${path.basename(filePath)}`;
      return res.json({
        success: true,
        filePath,
        videoUrl: relativeUrl,
        metadata,
      });
    } catch (err: any) {
      console.error('Video upload error:', err);
      return res.status(500).json({ error: err.message || 'ဗီဒီယို တင်ယူမှု မအောင်မြင်ပါ' });
    }
  });

  // 3. Start Narrator Job
  app.post('/api/narrator/start-job', async (req, res) => {
    try {
      const {
        videoPath,
        videoUrl,
        metadata,
        mode = 'burmese_narrator',
        provider = 'gemini',
        voice = 'Thiha',
        gender = 'male',
        style = 'recap',
        pacing = 1.0,
        muteOriginal = true,
        originalVolume = 0.0,
        narrationVolume = 1.0,
      } = req.body;

      if (!videoPath || !fs.existsSync(videoPath)) {
        return res.status(400).json({ error: 'ဗီဒီယိုဖိုင် လမ်းကြောင်း မမှန်ကန်ပါ' });
      }

      const job = createJob({
        videoPath,
        videoUrl,
        metadata: metadata || (await probeVideoFile(videoPath, path.basename(videoPath))),
        mode,
        provider,
        voice,
        gender,
        style,
        pacing,
        muteOriginal,
        originalVolume,
        narrationVolume,
      });

      return res.json({ success: true, jobId: job.id, job });
    } catch (err: any) {
      console.error('Start job error:', err);
      return res.status(500).json({ error: err.message || 'Job စတင်ခြင်း မအောင်မြင်ပါ' });
    }
  });

  // 4. Job Status & Segments
  app.get('/api/narrator/job/:jobId', (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job မတွေ့ရှိပါ' });
    }
    return res.json(job);
  });

  // 5. Update Segment
  app.post('/api/narrator/update-segment', (req, res) => {
    const { jobId, segmentId, burmeseText, sourceText, startTime, endTime, approved } = req.body;
    const job = getJob(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const seg = job.segments.find((s) => s.id === segmentId);
    if (!seg) return res.status(404).json({ error: 'Segment not found' });

    if (burmeseText !== undefined) seg.burmeseText = burmeseText;
    if (sourceText !== undefined) seg.sourceText = sourceText;
    if (startTime !== undefined) seg.startTime = parseFloat(startTime);
    if (endTime !== undefined) seg.endTime = parseFloat(endTime);
    if (seg.endTime > seg.startTime) {
      seg.duration = parseFloat((seg.endTime - seg.startTime).toFixed(2));
    }
    if (approved !== undefined) seg.approved = Boolean(approved);

    return res.json({ success: true, segment: seg });
  });

  // 6. Refine / Shorten Burmese Text
  app.post('/api/narrator/refine-text', async (req, res) => {
    try {
      const { originalBurmese, targetDurationSec, sourceText } = req.body;
      if (!originalBurmese) return res.status(400).json({ error: 'Burmese text required' });

      const refined = await refineBurmeseSegment(
        originalBurmese,
        parseFloat(targetDurationSec) || 15,
        sourceText
      );
      return res.json({ success: true, refined });
    } catch (err: any) {
      console.error('Refine text error:', err);
      return res.status(500).json({ error: err.message || 'စာတိုပြန်ညှိခြင်း မအောင်မြင်ပါ' });
    }
  });

  // 7. Generate Segment Audio
  app.post('/api/narrator/generate-segment-audio', async (req, res) => {
    try {
      const { jobId, segmentId, customText } = req.body;
      const job = getJob(jobId);
      if (!job) return res.status(404).json({ error: 'Job not found' });

      const updated = await generateSegmentAudio(job, segmentId, customText);
      return res.json({ success: true, segment: updated });
    } catch (err: any) {
      console.error('Generate segment audio error:', err);
      return res.status(500).json({ error: err.message || 'အသံထုတ်လုပ်မှု မအောင်မြင်ပါ' });
    }
  });

  // 8. Generate All Narrations
  app.post('/api/narrator/generate-all', async (req, res) => {
    try {
      const { jobId } = req.body;
      const job = getJob(jobId);
      if (!job) return res.status(404).json({ error: 'Job not found' });

      // Run in background and return immediate acceptance
      generateAllNarrations(job).catch((e) => {
        console.error('generateAllNarrations background error:', e);
        job.stage = 'error';
        job.error = e.message;
      });

      return res.json({ success: true, message: 'အသံထုတ်လုပ်ခြင်း စတင်ပါပြီ' });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Generate all failed' });
    }
  });

  // 9. Voice Sample Preview
  app.post('/api/narrator/voice-preview', async (req, res) => {
    try {
      const { voice = 'Thiha', gender = 'male', style = 'recap', pacing = 1.0, provider = 'gemini' } = req.body;
      const sampleText = 'မင်္ဂလာပါ၊ ဗီဒီယို ဇာတ်ကြောင်းပြောသူ အသံ စမ်းသပ်မှု ဖြစ်ပါတယ်။';
      const outFileName = `preview_${Date.now()}.mp3`;
      const outFilePath = path.join(AUDIO_DIR, outFileName);

      let audioBuf: Buffer | null = null;
      if (provider === 'gemini') {
        try {
          const ai = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
          });
          const geminiVoice = gender === 'female' ? 'Kore' : 'Charon';
          const ttsRes = await ai.models.generateContent({
            model: 'gemini-3.8-flash-lite-tts',
            contents: [
              {
                role: 'user',
                parts: [{ text: sampleText, speechMetadata: { style: `${style} tone` } }],
              },
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: geminiVoice } } },
            },
          });
          const b64 = ttsRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (b64) audioBuf = Buffer.from(b64, 'base64');
        } catch (_) {}
      }

      if (!audioBuf) {
        audioBuf = await synthesizeNeuralRealityMyanmar(sampleText, {
          voice: voice || (gender === 'female' ? 'Nilar' : 'Thiha'),
          style,
          speed: pacing,
        });
      }

      fs.writeFileSync(outFilePath, audioBuf);
      return res.json({ success: true, audioUrl: `/uploads/audio/${outFileName}` });
    } catch (err: any) {
      console.error('Voice preview error:', err);
      return res.status(500).json({ error: err.message || 'အသံနမူနာ စမ်းသပ်မှု မအောင်မြင်ပါ' });
    }
  });

  // 10. Sync & Final Export
  app.post('/api/narrator/export', async (req, res) => {
    try {
      const { jobId, muteOriginal, originalVolume, narrationVolume } = req.body;
      const job = getJob(jobId);
      if (!job) return res.status(404).json({ error: 'Job not found' });

      if (muteOriginal !== undefined) job.muteOriginal = Boolean(muteOriginal);
      if (originalVolume !== undefined) job.originalVolume = parseFloat(originalVolume);
      if (narrationVolume !== undefined) job.narrationVolume = parseFloat(narrationVolume);

      const exportUrls = await exportNarratorPackage(job);
      return res.json({ success: true, exportUrls });
    } catch (err: any) {
      console.error('Export error:', err);
      return res.status(500).json({ error: err.message || 'Export ထုတ်ယူမှု မအောင်မြင်ပါ' });
    }
  });

  // 11. Audio Separation Capabilities
  app.get('/api/narrator/separation-status', async (_req, res) => {
    try {
      const status = await detectSeparationCapabilities();
      return res.json({ success: true, ...status });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Separation status check failed' });
    }
  });

  // 12. Extract Background BGM & SFX Only (Removing Original Human Vocals)
  app.post('/api/audio/extract-bgm', uploadVideoMiddleware.single('video'), async (req, res) => {
    let tempUploadedPath: string | undefined;
    try {
      let targetVideoPath = '';
      if (req.file && fs.existsSync(req.file.path)) {
        targetVideoPath = req.file.path;
        tempUploadedPath = req.file.path;
      } else if (req.body?.videoPath && fs.existsSync(req.body.videoPath)) {
        targetVideoPath = req.body.videoPath;
      } else if (typeof req.body?.videoUrl === 'string' && req.body.videoUrl.startsWith('/')) {
        const candidatePublic = path.join(process.cwd(), 'public', req.body.videoUrl.replace(/^\/+/, ''));
        const candidateRoot = path.join(process.cwd(), req.body.videoUrl.replace(/^\/+/, ''));
        if (fs.existsSync(candidatePublic)) targetVideoPath = candidatePublic;
        else if (fs.existsSync(candidateRoot)) targetVideoPath = candidateRoot;
      }

      if (!targetVideoPath) {
        return res.status(400).json({ error: 'နောက်ခံတီးလုံး ထုတ်ယူရန် ဗီဒီယိုဖိုင် မတွေ့ရှိပါ' });
      }

      const extractId = `bgm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const result = await extractBgmAndSfxFromVideo(targetVideoPath, EXPORTS_DIR, extractId);

      // Clean up temporary uploaded video file after extracting BGM MP3
      if (tempUploadedPath && fs.existsSync(tempUploadedPath)) {
        try {
          fs.unlinkSync(tempUploadedPath);
        } catch (_) {}
      }

      const bgmUrl = `/uploads/exports/${path.basename(result.bgmMp3Path)}`;
      const vocalUrl = result.vocalMp3Path ? `/uploads/exports/${path.basename(result.vocalMp3Path)}` : undefined;

      return res.json({
        success: true,
        bgmUrl,
        vocalUrl,
        engineUsed: result.engineUsed,
        statusMessage: result.statusMessage,
        durationSec: result.durationSec,
      });
    } catch (err: any) {
      if (tempUploadedPath && fs.existsSync(tempUploadedPath)) {
        try {
          fs.unlinkSync(tempUploadedPath);
        } catch (_) {}
      }
      console.error('BGM extraction error:', err);
      return res.status(500).json({ error: err.message || 'နောက်ခံတီးလုံး ခွဲထုတ်ခြင်း မအောင်မြင်ပါ' });
    }
  });

  // Server-side Gemini API route
  app.post(['/api/gemini/generate', '/gemini/generate', '/generate'], async (req, res) => {
    try {
      const { apiKey, model = 'gemini-3.1-flash-lite', prompt, contents, parts, systemInstruction, responseMimeType } = req.body;
      const rawKey = apiKey || process.env.GEMINI_API_KEY;

      if (!rawKey) {
        return res.status(400).json({
          error: 'Gemini API Key is not configured on the server. Please check Settings > Secrets or provide an API Key.',
        });
      }

      const keyToUse = cleanAsciiHeader(rawKey);

      if (!isValidAsciiApiKey(keyToUse)) {
        return res.status(400).json({
          error: 'Gemini API Key မမှန်ကန်ပါ (အင်္ဂလိပ်စာလုံးနှင့် နံပါတ်များသာ ပါရပါမည်)။',
        });
      }

      const contentsPayload = contents || (parts ? { parts } : prompt);
      const requestedModel = model || 'gemini-3.1-flash-lite';
      const candidateModels = [
        requestedModel,
        'gemini-3.1-flash-lite',
        'gemini-3.5-flash-lite',
        'gemini-4-hydrogen',
      ].filter(Boolean).filter((m, idx, arr) => arr.indexOf(m) === idx);

      let lastError: any = null;
      for (const m of candidateModels) {
        let retries = 0;
        while (retries < 2) {
          try {
            const textResult = await callGeminiRest(keyToUse, m, contentsPayload, systemInstruction, {
              responseMimeType,
              timeoutMs: 40000,
            });

            if (textResult !== undefined) {
              return res.json({ text: textResult, model: m });
            }
          } catch (modelErr: any) {
            lastError = modelErr;
            const status = modelErr?.status || modelErr?.statusCode;
            if (status === 401 || status === 403) {
              const errorDetails = analyzeGeminiError(modelErr);
              return res.status(status).json({
                error: 'Gemini API Key မမှန်ကန်ပါ (401/403 Unauthorized)။ Google AI Studio မှ API Key အမှန်ကို စစ်ဆေးထည့်သွင်းပါ။',
                errorDetails,
                status,
              });
            }
            if (status === 404 || modelErr?.name === 'TimeoutError' || modelErr?.name === 'AbortError') {
              // Model not found or timed out — fail over immediately to next verified fast model
              break;
            }
            const errMsg = modelErr?.message || '';
            const isQuota = status === 429 || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota');

            if (isQuota && retries === 0) {
              retries++;
              await new Promise((r) => setTimeout(r, 900));
              continue;
            }
            break;
          }
        }
      }

      throw lastError || new Error('All Gemini model candidates failed');
    } catch (error: any) {
      console.error('Gemini error:', error);
      const status = error?.status || error?.statusCode || 500;
      const errorDetails = analyzeGeminiError(error);
      const errMsg = formatNetworkError(error, 'Gemini');
      return res.status(status).json({
        error: errMsg,
        errorDetails,
        status,
      });
    }
  });

  // Test connection route
  app.post(['/api/gemini/test', '/gemini/test', '/test'], async (req, res) => {
    try {
      const { apiKey, model = 'gemini-3.1-flash-lite' } = req.body;
      const rawKey = apiKey || process.env.GEMINI_API_KEY;

      if (!rawKey || !isValidAsciiApiKey(rawKey)) {
        return res.status(400).json({ ok: false, error: 'Valid Gemini API Key is required.' });
      }

      const keyToUse = cleanAsciiHeader(rawKey);
      const candidateModels = [
        model || 'gemini-3.1-flash-lite',
        'gemini-3.1-flash-lite',
        'gemini-3.5-flash-lite',
        'gemini-4-hydrogen',
      ].filter(Boolean).filter((m, idx, arr) => arr.indexOf(m) === idx);

      let lastError: any = null;
      for (const m of candidateModels) {
        try {
          const textResult = await callGeminiRest(keyToUse, m, 'Ping', undefined, { timeoutMs: 10000 });
          if (textResult !== undefined) {
            return res.json({ ok: true, message: 'Gemini API connection test successful.', text: textResult, model: m });
          }
        } catch (mErr: any) {
          lastError = mErr;
          if (mErr?.status === 404 || mErr?.status === 503 || mErr?.name === 'TimeoutError' || mErr?.name === 'AbortError') continue;
          break;
        }
      }

      throw lastError || new Error('Empty response received from Gemini API.');
    } catch (error: any) {
      const status = error?.status || error?.statusCode || 500;
      const errorDetails = analyzeGeminiError(error);
      const errorMsg = formatNetworkError(error, 'Gemini');
      return res.status(status).json({ ok: false, error: errorMsg, errorDetails, status });
    }
  });

  // Server-side Gemini Streaming API route (Server-Sent Events)
  app.post('/api/gemini/stream', async (req, res) => {
    try {
      const { apiKey, model = 'gemini-3.1-flash-lite', prompt, contents, parts, systemInstruction } = req.body;
      const rawKey = apiKey || process.env.GEMINI_API_KEY;

      if (!rawKey || !isValidAsciiApiKey(rawKey)) {
        return res.status(400).json({ error: 'Valid Gemini API Key is required.' });
      }

      const keyToUse = cleanAsciiHeader(rawKey);
      const ai = createGeminiClient(keyToUse);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const contentsPayload = contents || (parts ? { parts } : prompt);
      const responseStream = await ai.models.generateContentStream({
        model: model || 'gemini-3.1-flash-lite',
        contents: contentsPayload,
        config: systemInstruction ? { systemInstruction } : undefined,
      });

      for await (const chunk of responseStream) {
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
        }
      }
      res.write('data: [DONE]\n\n');
      return res.end();
    } catch (error: any) {
      console.error('Gemini streaming error:', error);
      res.write(`data: ${JSON.stringify({ error: error?.message || 'Streaming error' })}\n\n`);
      return res.end();
    }
  });

  // 100% Free Unlimited 24kHz Studio Neural Myanmar Voice Endpoint (8 Distinct Human Personas)
  app.post(['/api/tts/free', '/api/tts/edge'], async (req, res) => {
    try {
      const { text, voice = 'Thiha', style = 'recap', emotion = '', speed, rate } = req.body;
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text is required for TTS' });
      }

      const activeSpeed = typeof speed === 'number' ? speed : (rate ? parseFloat(rate) : 1.0);
      const mp3Buffer = await synthesizeNeuralRealityMyanmar(text, { voice, style, emotion, speed: activeSpeed });
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', mp3Buffer.length);
      return res.send(mp3Buffer);
    } catch (error: any) {
      console.error('Neural Reality TTS error:', error);
      return res.status(500).json({ error: error.message || 'Neural Reality TTS synthesis failed' });
    }
  });

  // Google Cloud Text-to-Speech API Proxy Endpoint
  app.post('/api/tts/cloud', async (req, res) => {
    try {
      const { text, voice = 'my-MM-Standard-A', apiKey, speed = 1.0 } = req.body;
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text is required for Google Cloud TTS' });
      }

      const rawKey = apiKey || process.env.GOOGLE_CLOUD_API_KEY || process.env.GCP_API_KEY;
      if (!rawKey || !isValidAsciiApiKey(rawKey)) {
        const fallbackVoice = voice.includes('Nilar') || voice.includes('female') ? 'Nilar' : 'Thiha';
        const neuralMp3 = await synthesizeNeuralRealityMyanmar(text, { voice: fallbackVoice, style: 'conversational', speed: parseFloat(speed) || 1.0 });
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', neuralMp3.length);
        res.setHeader('X-TTS-Fallback', 'NeuralReality24kHz');
        return res.send(neuralMp3);
      }

      const keyToUse = cleanAsciiHeader(rawKey);
      let gcpVoiceName = voice;
      if (!gcpVoiceName || !gcpVoiceName.startsWith('my-MM-')) {
        gcpVoiceName = 'my-MM-Standard-A';
      }

      const gcpRes = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(keyToUse)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'my-MM', name: gcpVoiceName },
          audioConfig: { audioEncoding: 'MP3', speakingRate: parseFloat(speed) || 1.0 },
        }),
      });

      if (!gcpRes.ok) {
        const errJson = await gcpRes.json().catch(() => ({}));
        const errMessage = errJson.error?.message || `Google Cloud TTS HTTP ${gcpRes.status}`;
        console.warn('Google Cloud TTS API error, falling back to Neural Reality:', errMessage);
        const neuralMp3 = await synthesizeNeuralRealityMyanmar(text, { voice: 'Thiha', style: 'conversational', speed: parseFloat(speed) || 1.0 });
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', neuralMp3.length);
        return res.send(neuralMp3);
      }

      const gcpData = await gcpRes.json();
      if (!gcpData.audioContent) {
        throw new Error('No audio content returned from Google Cloud TTS');
      }

      const audioBuffer = Buffer.from(gcpData.audioContent, 'base64');
      res.setHeader('Content-Type', 'audio/mp3');
      res.setHeader('Content-Length', audioBuffer.length);
      return res.send(audioBuffer);
    } catch (error: any) {
      console.error('Google Cloud TTS error:', error);
      try {
        const neuralMp3 = await synthesizeNeuralRealityMyanmar(req.body?.text || 'မင်္ဂလာပါ', { voice: 'Thiha', style: 'conversational', speed: 1.0 });
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', neuralMp3.length);
        return res.send(neuralMp3);
      } catch (fallbackErr) {
        return res.status(500).json({ error: error.message || 'Google Cloud TTS synthesis failed' });
      }
    }
  });

  // Human Reality Studio TTS endpoint (Gemini Flagship Neural Voice Model with 24kHz Neural Fallback)
  app.post('/api/tts/gemini', async (req, res) => {
    try {
      const { text, voice = 'Thiha', style = 'recap', emotion = '', speed, rate, apiKey } = req.body;
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text is required for TTS' });
      }

      // Clean and normalize Burmese text
      let cleanText = text
        .replace(/<[^>]+>/g, ' ')
        .replace(/\r\n/g, '\n')
        .replace(/\t/g, ' ')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim();

      cleanText = cleanText
        .replace(/([။.!?])(?!\s*($|\n))/g, '$1 ')
        .replace(/([၊,])(?!\s)/g, '$1 ')
        .trim();

      const rawKey = apiKey || process.env.GEMINI_API_KEY;
      const keyToUse = isValidAsciiApiKey(rawKey) ? cleanAsciiHeader(rawKey) : '';

      // 8 Curated Human Reality Character Voices (Gemini Voice Mapping)
      const geminiVoiceMap: Record<string, { voice: string; persona: string }> = {
        Thiha: {
          voice: 'Puck',
          persona: 'Ultra-realistic, warm, dignified Burmese male native speaker. Natural everyday conversational cadence, authentic human breath pauses, warm chest resonance, crystal-clear diction, zero robotic artifact',
        },
        KyawKyaw: {
          voice: 'Charon',
          persona: 'Deep, resonant, authoritative bass Burmese male narrator, specially optimized for dramatic Movie Recaps. Strong cinematic presence, suspenseful natural pacing, rich baritone gravity, flawless native diction',
        },
        AungAung: {
          voice: 'Fenrir',
          persona: 'Energetic, dynamic, friendly young Burmese male speaker. Lifelike youth enthusiasm, fast-paced engaging rhythm, expressive modern cadence, vivid articulation',
        },
        MinThway: {
          voice: 'Charon',
          persona: 'Smooth, calm, dignified Burmese male storyteller. Serene pacing, peaceful human warmth, reflective emotional nuance, soothing native pronunciation',
        },
        Nilar: {
          voice: 'Kore',
          persona: 'Ultra-realistic, natural, gentle and crystal-clear Burmese female native speaker. Conversational cadence, natural breath pauses, melodious articulation, pure lifelike human inflection',
        },
        MayThu: {
          voice: 'Aoede',
          persona: 'Sweet, delicate, lyrical Burmese female storyteller. Soft emotional depth, warm gentle pacing, soothing and intimate native delivery',
        },
        Thiri: {
          voice: 'Zephyr',
          persona: 'Bright, articulate, intelligent Burmese female broadcast and news anchor. Crisp fluent diction, steady authoritative cadence, confident professional delivery',
        },
        SuSu: {
          voice: 'Zephyr',
          persona: 'Charming, lively, joyful and refreshed Burmese female speaker. Cheerful smiles in the voice, playful sweet cadence, vibrant conversational rhythm',
        },
        Sulafat: {
          voice: 'Puck',
          persona: 'Warm, friendly and comforting Burmese female speaker with gentle chest resonance and natural conversational cadence',
        },
        Titus: {
          voice: 'Charon',
          persona: 'Clear, authoritative and commanding Burmese male narrator with crisp enunciation and steady cadence',
        },
        Virgo: {
          voice: 'Kore',
          persona: 'Calm, measured and peaceful Burmese female speaker with serene pacing and warm emotional depth',
        },
        Perseus: {
          voice: 'Fenrir',
          persona: 'Strong, bold and energetic Burmese male speaker with powerful vocal projection and dynamic enthusiasm',
        },
        Minerva: {
          voice: 'Aoede',
          persona: 'Wise, steady and articulate Burmese female speaker with professional clarity and composed cadence',
        },
        Luna: {
          voice: 'Kore',
          persona: 'Soft, dreamy and lyrical Burmese female speaker with gentle melodic tone and soothing warmth',
        },
        Oberon: {
          voice: 'Charon',
          persona: 'Deep, resonant and cinematic Burmese male storyteller with rich baritone presence and suspenseful pacing',
        },
        Lyra: {
          voice: 'Zephyr',
          persona: 'Musical, flowing and expressive Burmese female speaker with graceful articulation and melodic rhythm',
        },
        Atlas: {
          voice: 'Charon',
          persona: 'Powerful, deep and commanding Burmese male speaker with strong resonance and firm authority',
        },
        Schedar: {
          voice: 'Puck',
          persona: 'Even, balanced and natural Burmese male speaker with steady cadence and clear conversational delivery',
        },
        Gacrux: {
          voice: 'Charon',
          persona: 'Mature, seasoned and dignified Burmese male speaker with deep vocal experience and grounded authority',
        },
        Pulcherrima: {
          voice: 'Aoede',
          persona: 'Forward, dynamic and engaging Burmese female speaker with bright enthusiasm and crisp articulation',
        },
        Achird: {
          voice: 'Fenrir',
          persona: 'Friendly, warm and approachable Burmese male speaker with casual conversational warmth and natural smiles',
        },
        Zubenelgenubi: {
          voice: 'Puck',
          persona: 'Casual, relaxed and easygoing Burmese male speaker with effortless conversational rhythm',
        },
        Vindemiatrix: {
          voice: 'Aoede',
          persona: 'Gentle, soft and tender Burmese female speaker with soothing calm and comforting emotional tone',
        },
        Sadachbia: {
          voice: 'Zephyr',
          persona: 'Lively, vibrant and cheerful Burmese female speaker with upbeat energy and playful cadence',
        },
        Sadaltager: {
          voice: 'Charon',
          persona: 'Knowledgeable, intelligent and articulate Burmese male speaker with educational clarity and professional presence',
        },
      };

      const selected = geminiVoiceMap[voice] || geminiVoiceMap.Thiha;

      // 5 Vocal Emotion & Style Selectors
      const styleModifierMap: Record<string, string> = {
        conversational: 'Conversational Reality: နေ့စဉ် သဘာဝကျကျ စကားပြောသံ (Natural everyday conversational tone with authentic breath pauses, relaxed human cadence, and realistic inflections)',
        recap: 'Cinematic Movie Recap: ဇာတ်လမ်းနားဆင်ရသလို စိတ်ဝင်စားဖွယ်အသံ (Captivating cinematic storyteller with dramatic pauses, suspenseful cadence, and engaging narrative warmth)',
        broadcast: 'Broadcast News: တိကျခိုင်မာသော သတင်းကြေညာသံ (Articulate, authoritative news and TV broadcast presenter with crisp diction and steady pacing)',
        energetic: 'High Energy: TikTok/Shorts အတွက် သွက်လက်တက်ကြွသောအသံ (High-tempo, vibrant, viral, lively and enthusiastic delivery)',
        soothing: 'Calm & Soothing: နားဆင်ရ သက်သာနွေးထွေးသောအသံ (Soft, peaceful, gentle and relaxing tone with soothing melodic warmth)',
      };

      const styleDescription = styleModifierMap[style] || styleModifierMap.conversational;

      // Detect dynamic vocal emotion acting cues from segment emotion + Burmese meaning
      const combinedEmotionSource = `${emotion || ''} ${cleanText}`.toLowerCase();
      let emotionalActingCue =
        'NATURAL CONVERSATIONAL FLOW: Speak like talking face-to-face with a close friend—authentic Burmese sentence melody, connected phrasing, varied pacing, and natural emphasis on meaningful words without exaggerating.';
      if (/surpris|shock|amaze|astonish|wow|discover|အံ့ဩ|မထင်မှတ်|တကယ်|အများကြီး|!/.test(combinedEmotionSource)) {
        emotionalActingCue =
          'SPONTANEOUS SURPRISE: Genuinely and naturally surprised in the moment, lifting pitch cleanly on the key reveal without sounding theatrical or artificial.';
      } else if (/question|curious|wonder|မေး|\?|လား|လဲ/.test(combinedEmotionSource)) {
        emotionalActingCue =
          'CURIOSITY: Naturally inquisitive conversational delivery with gentle rising Burmese question intonation.';
      } else if (/happy|cheer|joy|delight|smile|warm|relief|ပျော်|ဝမ်းသာ|ကောင်း|အောင်မြင်/.test(combinedEmotionSource)) {
        emotionalActingCue =
          'HAPPINESS: Warm, cheerful, lively conversational smile in the voice—bright and genuine, never forced.';
      } else if (/empath|caring|comfort|kind|gentle|စာနာ|နှစ်သိမ့်|ဂရု|သနား/.test(combinedEmotionSource)) {
        emotionalActingCue =
          'EMPATHY: Caring, comforting, warm personal closeness, speaking gently as to a trusted friend.';
      } else if (/sad|sorrow|melanchol|pain|ဝမ်းနည်း|ငို|နာကျင်/.test(combinedEmotionSource)) {
        emotionalActingCue =
          'SADNESS: Gentle, soft, emotionally sincere delivery with quiet authentic weight and natural human breath.';
      } else if (/excit|energetic|enthusias|viral|thrill|တက်ကြွ|စိတ်လှုပ်ရှား/.test(combinedEmotionSource)) {
        emotionalActingCue =
          'EXCITEMENT: Energetic, expressive, enthusiastic storytelling momentum with natural dynamic emphasis.';
      } else if (/mock|smug|sarcas|playful|tease|လှောင်|နော်|ပြီပဲ|တာပဲ/.test(combinedEmotionSource)) {
        emotionalActingCue =
          'PLAYFUL / KNOWING: Subtle sly conversational inflection on the punchline, natural and human.';
      } else if (/determin|fierce|angry|threat|urgent|tense|မာန်|ဒေါသ|မပေးဘူး|သေချာပေါက်|ယူရမယ်/.test(combinedEmotionSource)) {
        emotionalActingCue =
          'FIRM RESOLVE: Grounded, sincere determination with clear natural vocal weight on key words.';
      }

      const speechStyleMetadata =
        `VOICE DIRECTOR — BURMESE NATURAL HUMAN VOICE (${selected.persona}). ` +
        `Scene: Speaking directly face-to-face to a close friend in real time (NOT a speech, audiobook, presentation, or newsreader). ` +
        `Style: ${styleDescription}. Emotion: ${emotion ? `${emotion} — ` : ''}${emotionalActingCue} ` +
        `Rules: Authentic native Burmese pronunciation and sentence melody; connected conversational rhythm with subtle natural breaths and varied pacing; stress meaningful words naturally; NEVER robotic, NEVER monotonous, NEVER identical rhythm across sentences, NEVER exaggerate every emotion, and speak the exact words without adding or changing anything.`;

      let audioBuffer: Buffer | null = null;
      let usedEngine = 'neural-reality-24k';

      // If a Gemini API key is present, attempt Gemini Expressive TTS first
      if (keyToUse) {
        try {
          const ai = createGeminiClient(keyToUse);

          const tryModel = async (modelName: string): Promise<Buffer> => {
            // Note: Gemini 3.8 TTS models use speechMetadata.style (no systemInstruction in config)
            const response = await Promise.race([
              ai.models.generateContent({
                model: modelName,
                contents: [
                  {
                    role: 'user',
                    parts: [
                      {
                        text: cleanText,
                        speechMetadata: {
                          style: speechStyleMetadata,
                        },
                      } as any,
                    ],
                  },
                ],
                config: {
                  responseModalities: ['AUDIO'],
                  speechConfig: {
                    voiceConfig: {
                      prebuiltVoiceConfig: { voiceName: selected.voice },
                    },
                  },
                },
              }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`${modelName} TTS timeout (15s)`)), 15000)
              ),
            ]);

            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (!base64Audio) {
              throw new Error(`No audio returned from ${modelName}`);
            }
            const rawWav = Buffer.from(base64Audio, 'base64');
            return appendWavSilencePadding(rawWav, 0.1);
          };

          try {
            audioBuffer = await tryModel('gemini-3.8-flash-tts');
            usedEngine = 'gemini-3.8-flash-tts';
          } catch (err: any) {
            console.warn('Primary Gemini expressive TTS attempt failed:', err.message);
            try {
              audioBuffer = await tryModel('gemini-3.8-flash-lite-tts');
              usedEngine = 'gemini-3.8-flash-lite-tts';
            } catch (err2: any) {
              console.warn('Secondary Gemini TTS attempt failed:', err2.message);
            }
          }
        } catch (geminiInitErr: any) {
          console.warn('Gemini client init error:', geminiInitErr.message);
        }
      }

      if (audioBuffer && audioBuffer.length > 0) {
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Length', audioBuffer.length);
        res.setHeader('X-TTS-Engine', usedEngine);
        return res.send(audioBuffer);
      }

      // Expressive 24kHz Studio Neural fallback with Rubberband pitch/cadence sculpting
      console.log(`Using expressive 24kHz Studio Neural Voice Actor for ${voice} (${style} | ${emotion || 'recap'})...`);
      const activeSpeed = typeof speed === 'number' ? speed : (rate ? parseFloat(rate) : 1.0);
      const neuralMp3 = await synthesizeNeuralRealityMyanmar(cleanText, { voice, style, emotion, speed: activeSpeed });
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', neuralMp3.length);
      res.setHeader('X-TTS-Engine', 'neural-reality-24k');
      return res.send(neuralMp3);
    } catch (error: any) {
      console.error('TTS synthesis error:', error);
      return res.status(500).json({
        error: error.message || 'TTS synthesis failed',
      });
    }
  });

  // FAL AI Proxy endpoint (Flux Schnell image & scene photos)
  app.post('/api/fal/proxy', async (req, res) => {
    try {
      const { apiKey, endpoint = 'fal-ai/flux/schnell', input } = req.body;
      const rawKey = apiKey || process.env.FAL_KEY;
      if (!rawKey) {
        return res.status(400).json({ error: 'No FAL API key provided. Add one in API Settings.' });
      }
      if (!isValidAsciiApiKey(rawKey)) {
        return res.status(400).json({ error: 'FAL API Key မမှန်ကန်ပါ (မြန်မာစာလုံးများ မပါဝင်ရပါ)။' });
      }
      const falKey = cleanAsciiHeader(rawKey);

      const falResponse = await fetch(`https://queue.fal.run/${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Key ${falKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input || {}),
      });

      const data = await falResponse.json();
      return res.status(falResponse.status).json(data);
    } catch (error: any) {
      console.error('FAL error:', error);
      return res.status(500).json({ error: formatNetworkError(error, 'FAL AI') });
    }
  });

  // AssemblyAI Verification Endpoint
  app.post('/api/assemblyai/verify', async (req, res) => {
    try {
      const { apiKey } = req.body;
      const rawKey = apiKey || process.env.ASSEMBLYAI_API_KEY;
      if (!rawKey) {
        return res.status(400).json({ ok: false, error: 'AssemblyAI API Key မရှိသေးပါ။' });
      }

      if (!isValidAsciiApiKey(rawKey)) {
        return res.status(400).json({
          ok: false,
          error: 'AssemblyAI API Key မမှန်ကန်ပါ (မြန်မာစာလုံးများ ပါဝင်နေပါသည်)။ ကျေးဇူးပြု၍ AssemblyAI Dashboard မှ အင်္ဂလိပ် API Key အစစ်ကိုသာ ထည့်သွင်းပေးပါ။',
        });
      }

      const keyToUse = cleanAsciiHeader(rawKey);

      // Query AssemblyAI account/transcript endpoint to verify credentials
      const response = await fetch('https://api.assemblyai.com/v2/transcript?limit=1', {
        method: 'GET',
        headers: {
          Authorization: keyToUse,
        },
      });

      if (response.ok) {
        const data = await response.json();
        return res.json({
          ok: true,
          message: 'AssemblyAI connection successful! (Ready for Whisper STT)',
          details: { status: 'connected', totalCount: data.page_details?.total_count ?? 0 },
        });
      } else {
        const errData = await response.json().catch(() => ({}));
        let errMsg = errData.error || `AssemblyAI Authentication Failed (HTTP ${response.status})`;
        if (typeof errMsg === 'string' && (errMsg.includes('Authentication error') || errMsg.includes('token missing/invalid'))) {
          errMsg = 'AssemblyAI API Token မမှန်ကန်ပါ (Authentication error, API token missing/invalid)။ ကျေးဇူးပြု၍ https://www.assemblyai.com/app/account မှ 32-character အခမဲ့ Token အမှန်ကို ကူးယူထည့်သွင်းပေးပါ (သို့မဟုတ် Gemini Engine ဖြင့် တိုက်ရိုက် အသုံးပြုနိုင်ပါသည်)။';
        }
        return res.status(response.status).json({
          ok: false,
          error: errMsg,
        });
      }
    } catch (error: any) {
      console.error('AssemblyAI verify error:', error);
      return res.status(500).json({ ok: false, error: formatNetworkError(error, 'AssemblyAI') });
    }
  });

  // AssemblyAI Upload Audio Binary Proxy (avoids CORS)
  app.post('/api/assemblyai/upload', async (req, res) => {
    try {
      const { apiKey, base64Audio } = req.body;
      const rawKey = apiKey || process.env.ASSEMBLYAI_API_KEY;
      if (!rawKey) {
        return res.status(400).json({ error: 'AssemblyAI API Key is missing.' });
      }
      if (!isValidAsciiApiKey(rawKey)) {
        return res.status(400).json({ error: 'AssemblyAI API Key မမှန်ကန်ပါ (မြန်မာစာလုံးများ ပါဝင်နေပါသည်)။' });
      }
      if (!base64Audio) {
        return res.status(400).json({ error: 'No audio data provided.' });
      }

      const keyToUse = cleanAsciiHeader(rawKey);
      const buffer = Buffer.from(base64Audio, 'base64');
      const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
        method: 'POST',
        headers: {
          Authorization: keyToUse,
          'Content-Type': 'application/octet-stream',
        },
        body: buffer,
      });

      const data = await uploadRes.json();
      if (!uploadRes.ok) {
        let errMsg = data.error || `Upload failed (HTTP ${uploadRes.status})`;
        if (typeof errMsg === 'string' && (errMsg.includes('Authentication error') || errMsg.includes('token missing/invalid'))) {
          errMsg = 'AssemblyAI API Token မမှန်ကန်ပါ (Authentication error, API token missing/invalid)။ ကျေးဇူးပြု၍ www.assemblyai.com မှ Token အမှန်ကို စစ်ဆေးပေးပါ (သို့မဟုတ် Gemini Engine ဖြင့် အသုံးပြုနိုင်ပါသည်)။';
        }
        return res.status(uploadRes.status).json({ error: errMsg });
      }
      return res.status(uploadRes.status).json(data);
    } catch (error: any) {
      console.error('AssemblyAI upload proxy error:', error);
      return res.status(500).json({ error: formatNetworkError(error, 'AssemblyAI') });
    }
  });

  // AssemblyAI General Proxy (Supports GET and POST)
  app.post('/api/assemblyai/proxy', async (req, res) => {
    try {
      const { apiKey, endpoint, body, method = 'POST' } = req.body;
      const rawKey = apiKey || process.env.ASSEMBLYAI_API_KEY;
      if (!rawKey) return res.status(400).json({ error: 'No AssemblyAI API key provided.' });
      if (!isValidAsciiApiKey(rawKey)) {
        return res.status(400).json({ error: 'AssemblyAI API Key မမှန်ကန်ပါ (မြန်မာစာလုံးများ ပါဝင်နေပါသည်)။' });
      }

      const keyToUse = cleanAsciiHeader(rawKey);
      const requestOptions: RequestInit = {
        method: method.toUpperCase(),
        headers: {
          Authorization: keyToUse,
          'Content-Type': 'application/json',
        },
      };

      if (method.toUpperCase() === 'POST' && body) {
        requestOptions.body = JSON.stringify(body);
      }

      const response = await fetch(`https://api.assemblyai.com/v2/${endpoint}`, requestOptions);
      const data = await response.json();
      if (!response.ok) {
        let errMsg = data.error || `AssemblyAI proxy error (HTTP ${response.status})`;
        if (typeof errMsg === 'string' && (errMsg.includes('Authentication error') || errMsg.includes('token missing/invalid'))) {
          errMsg = 'AssemblyAI API Token မမှန်ကန်ပါ (Authentication error, API token missing/invalid)။ ကျေးဇူးပြု၍ www.assemblyai.com မှ Token အမှန်ကို စစ်ဆေးပေးပါ (သို့မဟုတ် Gemini Engine ဖြင့် အသုံးပြုနိုင်ပါသည်)။';
        }
        return res.status(response.status).json({ error: errMsg });
      }
      return res.status(response.status).json(data);
    } catch (error: any) {
      return res.status(500).json({ error: formatNetworkError(error, 'AssemblyAI') });
    }
  });

  // Hugging Face API Verification Endpoint
  app.post('/api/huggingface/verify', async (req, res) => {
    try {
      const { apiKey } = req.body;
      const rawKey = apiKey || process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN;
      if (!rawKey) {
        return res.status(400).json({ ok: false, error: 'Hugging Face API Key (Token) is missing.' });
      }
      if (!isValidAsciiApiKey(rawKey)) {
        return res.status(400).json({
          ok: false,
          error: 'Hugging Face Token မမှန်ကန်ပါ (မြန်မာစာလုံးများ ပါဝင်နေပါသည်)။ ကျေးဇူးပြု၍ Hugging Face မှ အင်္ဂလိပ် Access Token (hf_...) ကိုသာ ထည့်သွင်းပေးပါ။',
        });
      }

      const keyToUse = cleanAsciiHeader(rawKey);
      const hfRes = await fetch('https://huggingface.co/api/whoami-v2', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${keyToUse}`,
        },
      });

      if (hfRes.ok) {
        const data = await hfRes.json().catch(() => ({}));
        const username = data.name || data.id || 'User';
        return res.json({
          ok: true,
          message: `✓ Hugging Face ချိတ်ဆက်မှု အောင်မြင်ပါသည်! (${username}) (Voice Clone အဆင်သင့်ဖြစ်ပါပြီ)`,
          username,
        });
      } else {
        const errData = await hfRes.json().catch(() => ({}));
        let errMsg = errData.error || `Hugging Face Authentication Failed (HTTP ${hfRes.status})`;
        if (hfRes.status === 401) {
          errMsg = 'Hugging Face API Token မမှန်ကန်ပါ (Invalid token)။ ကျေးဇူးပြု၍ https://huggingface.co/settings/tokens မှ User Access Token (hf_...) ကို စစ်ဆေးပေးပါ။';
        }
        return res.status(hfRes.status).json({ ok: false, error: errMsg });
      }
    } catch (error: any) {
      console.error('Hugging Face verify error:', error);
      return res.status(500).json({ ok: false, error: formatNetworkError(error, 'Hugging Face') });
    }
  });

  // Hugging Face Multi-Speaker Studio & TTS Endpoint
  app.post('/api/huggingface/tts', async (req, res) => {
    try {
      const { text, model = 'coqui/XTTS-v2', apiKey, speakerId } = req.body;
      const rawKey = apiKey || process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN;
      if (!rawKey) {
        return res.status(400).json({ error: 'Hugging Face API Key (Token) မရှိသေးပါ။ အဆင့် 1 တွင် Token ထည့်သွင်းပြီး Connect ပြုလုပ်ပေးပါ။' });
      }
      if (!isValidAsciiApiKey(rawKey)) {
        return res.status(400).json({ error: 'Hugging Face Token တွင် မြန်မာစာလုံးများ မပါဝင်ရပါ။' });
      }
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text is required for TTS' });
      }

      const keyToUse = cleanAsciiHeader(rawKey);
      const cleanModel = (typeof model === 'string' && model.trim()) ? model.trim() : 'coqui/XTTS-v2';

      const standardHeaders: Record<string, string> = {
        Authorization: `Bearer ${keyToUse}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AIStudio/1.0',
        'Accept': '*/*',
      };

      // Prepare payload options for Hugging Face Inference
      const primaryPayload: any = { inputs: text.trim() };

      // Endpoints to attempt for HF Inference Router
      const endpoints = [
        `https://router.huggingface.co/hf-inference/models/${cleanModel}`,
        `https://api-inference.huggingface.co/models/${cleanModel}`,
        'https://router.huggingface.co/hf-inference/models/facebook/mms-tts-mya',
        'https://api-inference.huggingface.co/models/facebook/mms-tts-mya',
      ];

      let audioBuffer: Buffer | null = null;
      let lastErrMsg = '';
      let statusCode = 500;

      for (const endpoint of endpoints) {
        try {
          const hfResponse = await fetch(endpoint, {
            method: 'POST',
            headers: standardHeaders,
            body: JSON.stringify(primaryPayload),
            signal: AbortSignal.timeout(18000),
          });

          if (hfResponse.ok) {
            const arrayBuffer = await hfResponse.arrayBuffer();
            audioBuffer = Buffer.from(arrayBuffer);
            if (audioBuffer.length > 200) {
              const contentType = hfResponse.headers.get('content-type') || 'audio/wav';
              res.setHeader('Content-Type', contentType);
              res.setHeader('Content-Length', audioBuffer.length);
              res.setHeader('X-HF-Speaker-ID', speakerId || 'default');
              return res.send(audioBuffer);
            }
          } else {
            statusCode = hfResponse.status;
            const errJson = await hfResponse.json().catch(() => ({}));
            lastErrMsg = errJson.error || errJson.message || `HF Inference HTTP ${hfResponse.status}`;
          }
        } catch (fetchErr: any) {
          lastErrMsg = fetchErr.message || 'Network request failed';
        }
      }

      // Fallback to 24kHz Studio Neural Voice if HF serverless router endpoints fail
      try {
        console.log(`HF Router fallback notice (${lastErrMsg}). Synthesizing via 24kHz Neural Studio Engine for speaker ${speakerId}...`);
        const voiceMapping: Record<string, string> = {
          hf_male_thiha: 'Thiha',
          hf_male_kyawkyaw: 'KyawKyaw',
          hf_male_aungaung: 'AungAung',
          hf_male_minthway: 'MinThway',
          hf_female_nilar: 'Nilar',
          hf_female_maythu: 'MayThu',
          hf_female_thiri: 'Thiri',
          hf_female_susu: 'SuSu',
        };
        const mappedVoice = voiceMapping[speakerId || ''] || 'Thiha';
        const neuralMp3 = await synthesizeNeuralRealityMyanmar(text.trim(), { voice: mappedVoice, style: 'conversational', speed: 1.0 });
        if (neuralMp3 && neuralMp3.length > 200) {
          res.setHeader('Content-Type', 'audio/mpeg');
          res.setHeader('Content-Length', neuralMp3.length);
          res.setHeader('X-HF-Fallback-Voice', mappedVoice);
          return res.send(neuralMp3);
        }
      } catch (fallbackErr: any) {
        console.error('Final fallback TTS error:', fallbackErr);
      }

      return res.status(statusCode).json({
        error: `Hugging Face Multi-Speaker synthesis error: ${lastErrMsg || 'No response from Hugging Face Inference API'}`,
      });
    } catch (error: any) {
      console.error('Hugging Face TTS proxy error:', error);
      return res.status(500).json({ error: formatNetworkError(error, 'Hugging Face') });
    }
  });

  // ============================================================================
  // TTS PROVIDERS CONFIG STATUS
  // ============================================================================
  app.get('/api/tts/providers-status', (_req, res) => {
    res.json({
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      elevenLabsConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
      huggingFaceConfigured: Boolean(process.env.HUGGINGFACE_API_KEY || process.env.HF_TOKEN),
    });
  });

  // ============================================================================
  // ELEVENLABS VOICE CLONE & TTS PROXY ENDPOINTS
  // ============================================================================
  const memoryUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  app.post('/api/elevenlabs/verify', async (req, res) => {
    try {
      const rawKey = req.body?.apiKey || process.env.ELEVENLABS_API_KEY;
      if (!rawKey) {
        return res.status(400).json({ ok: false, error: 'ElevenLabs API Key မရှိသေးပါ။' });
      }
      if (!isValidAsciiApiKey(rawKey)) {
        return res.status(400).json({ ok: false, error: 'ElevenLabs API Key တွင် မြန်မာစာလုံးများ မပါဝင်ရပါ။' });
      }
      const keyToUse = cleanAsciiHeader(rawKey);
      const elRes = await fetch('https://api.elevenlabs.io/v1/user', {
        method: 'GET',
        headers: { 'xi-api-key': keyToUse },
        signal: AbortSignal.timeout(12000),
      });
      if (elRes.ok) {
        const user = await elRes.json().catch(() => ({}));
        const tier = user?.subscription?.tier ? ` (${user.subscription.tier})` : '';
        return res.json({
          ok: true,
          message: `✓ ElevenLabs Voice Clone ချိတ်ဆက်မှု အောင်မြင်ပါသည်!${tier}`,
        });
      }
      const errData = await elRes.json().catch(() => ({}));
      const msg = errData?.detail?.message || errData?.detail || `ElevenLabs Auth Failed (HTTP ${elRes.status})`;
      return res.status(elRes.status).json({ ok: false, error: typeof msg === 'string' ? msg : JSON.stringify(msg) });
    } catch (error: any) {
      return res.status(500).json({ ok: false, error: formatNetworkError(error, 'ElevenLabs') });
    }
  });

  app.post('/api/elevenlabs/voices', async (req, res) => {
    try {
      const rawKey = req.body?.apiKey || process.env.ELEVENLABS_API_KEY;
      if (!rawKey) {
        return res.status(400).json({ error: 'ElevenLabs API Key ထည့်သွင်းပေးပါ (သို့မဟုတ် Environment Variable တွင် သတ်မှတ်ပါ)။' });
      }
      if (!isValidAsciiApiKey(rawKey)) {
        return res.status(400).json({ error: 'ElevenLabs API Key မမှန်ကန်ပါ။' });
      }
      const keyToUse = cleanAsciiHeader(rawKey);
      const elRes = await fetch('https://api.elevenlabs.io/v1/voices', {
        method: 'GET',
        headers: { 'xi-api-key': keyToUse },
        signal: AbortSignal.timeout(15000),
      });
      const data = await elRes.json().catch(() => ({}));
      if (!elRes.ok) {
        const msg = data?.detail?.message || data?.detail || `Failed to load voices (HTTP ${elRes.status})`;
        return res.status(elRes.status).json({ error: typeof msg === 'string' ? msg : JSON.stringify(msg) });
      }
      const voices = Array.isArray(data?.voices)
        ? data.voices.map((v: any) => ({
            voice_id: v.voice_id,
            name: v.name,
            category: v.category || 'premade',
            preview_url: v.preview_url,
            labels: v.labels || {},
          }))
        : [];
      return res.json({ voices });
    } catch (error: any) {
      return res.status(500).json({ error: formatNetworkError(error, 'ElevenLabs') });
    }
  });

  app.post('/api/elevenlabs/clone', memoryUpload.single('audio'), async (req, res) => {
    try {
      const rawKey = req.body?.apiKey || process.env.ELEVENLABS_API_KEY;
      if (!rawKey) {
        return res.status(400).json({ error: 'ElevenLabs API Key မရှိသေးပါ။' });
      }
      if (!isValidAsciiApiKey(rawKey)) {
        return res.status(400).json({ error: 'ElevenLabs API Key မမှန်ကန်ပါ။' });
      }
      const file = req.file;
      if (!file || !file.buffer?.length) {
        return res.status(400).json({ error: 'Voice Clone ပြုလုပ်ရန် နမူနာ အသံဖိုင် (MP3/WAV/M4A) ထည့်သွင်းပေးပါ။' });
      }

      const keyToUse = cleanAsciiHeader(rawKey);
      const voiceName = String(req.body?.name || 'Myanmar Cloned Voice').trim().slice(0, 80);
      const description = String(req.body?.description || 'Burmese Natural Human Voice Clone').trim().slice(0, 400);

      const form = new FormData();
      form.append('name', voiceName);
      form.append('description', description);
      const audioBlob = new Blob([new Uint8Array(file.buffer)], {
        type: file.mimetype || 'audio/mpeg',
      });
      form.append('files', audioBlob, file.originalname || 'voice_sample.mp3');

      const cloneRes = await fetch('https://api.elevenlabs.io/v1/voices/add', {
        method: 'POST',
        headers: { 'xi-api-key': keyToUse },
        body: form,
        signal: AbortSignal.timeout(45000),
      });

      const data = await cloneRes.json().catch(() => ({}));
      if (!cloneRes.ok || !data?.voice_id) {
        const msg = data?.detail?.message || data?.detail || data?.message || `Voice Clone failed (HTTP ${cloneRes.status})`;
        return res.status(cloneRes.status || 400).json({ error: typeof msg === 'string' ? msg : JSON.stringify(msg) });
      }

      return res.json({
        success: true,
        voice_id: data.voice_id,
        name: voiceName,
      });
    } catch (error: any) {
      return res.status(500).json({ error: formatNetworkError(error, 'ElevenLabs Voice Clone') });
    }
  });

  // 1-Click Instant Voice Clone directly from user's attached sample video or project video
  app.post('/api/elevenlabs/clone-sample-video', async (req, res) => {
    try {
      const rawKey = req.body?.apiKey || process.env.ELEVENLABS_API_KEY;
      if (!rawKey) {
        return res.status(400).json({ error: 'ElevenLabs API Key မရှိသေးပါ။ Step 1 တွင် API Key ထည့်သွင်းပေးပါ။' });
      }
      if (!isValidAsciiApiKey(rawKey)) {
        return res.status(400).json({ error: 'ElevenLabs API Key မမှန်ကန်ပါ။' });
      }

      let targetVideo = path.join(process.cwd(), 'public/assets/aistudio/89cbad80-de9b-11f1-9f64-f9e4747b79f2_c572e83d.mp4');
      if (req.body?.videoPath && fs.existsSync(req.body.videoPath)) {
        targetVideo = req.body.videoPath;
      }

      if (!fs.existsSync(targetVideo)) {
        return res.status(404).json({ error: 'နမူနာ ဗီဒီယိုဖိုင် မတွေ့ရှိပါ' });
      }

      const outTmpAudio = path.join(os.tmpdir(), `sample_clone_${Date.now()}.mp3`);
      await new Promise<void>((resolve, reject) => {
        exec(
          `ffmpeg -y -ss 00:00:02 -i "${targetVideo}" -t 35 -vn -ar 44100 -ac 1 -b:a 192k "${outTmpAudio}"`,
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      if (!fs.existsSync(outTmpAudio) || fs.statSync(outTmpAudio).size < 1000) {
        return res.status(500).json({ error: 'ဗီဒီယိုမှ အသံထုတ်ယူခြင်း မအောင်မြင်ပါ' });
      }

      const audioBuf = fs.readFileSync(outTmpAudio);
      try { fs.unlinkSync(outTmpAudio); } catch (_) {}

      const keyToUse = cleanAsciiHeader(rawKey);
      const voiceName = String(req.body?.name || 'Sample Video Burmese Narrator').trim().slice(0, 80);
      const description = 'Extracted Burmese Natural Human Narrator Voice from sample video for Expressive Recaps';

      const form = new FormData();
      form.append('name', voiceName);
      form.append('description', description);
      const audioBlob = new Blob([new Uint8Array(audioBuf)], { type: 'audio/mpeg' });
      form.append('files', audioBlob, 'sample_narrator.mp3');

      const cloneRes = await fetch('https://api.elevenlabs.io/v1/voices/add', {
        method: 'POST',
        headers: { 'xi-api-key': keyToUse },
        body: form,
        signal: AbortSignal.timeout(50000),
      });

      const data = await cloneRes.json().catch(() => ({}));
      if (!cloneRes.ok || !data?.voice_id) {
        const msg = data?.detail?.message || data?.detail || data?.message || `Voice Clone failed (HTTP ${cloneRes.status})`;
        return res.status(cloneRes.status || 400).json({ error: typeof msg === 'string' ? msg : JSON.stringify(msg) });
      }

      return res.json({
        success: true,
        voice_id: data.voice_id,
        name: voiceName,
      });
    } catch (error: any) {
      console.error('Clone from sample video error:', error);
      return res.status(500).json({ error: formatNetworkError(error, 'Sample Video Voice Clone') });
    }
  });

  app.post('/api/elevenlabs/tts', async (req, res) => {
    try {
      const {
        text,
        voiceId,
        modelId = 'eleven_v3',
        stability = 0.5,
        style = 0.0,
        emotion = '',
        apiKey,
      } = req.body || {};

      const rawKey = apiKey || process.env.ELEVENLABS_API_KEY;
      if (!rawKey) {
        return res.status(400).json({ error: 'ElevenLabs API Key မရှိသေးပါ။ Step 1 တွင် ElevenLabs API Key ထည့်သွင်းပေးပါ။' });
      }
      if (!isValidAsciiApiKey(rawKey)) {
        return res.status(400).json({ error: 'ElevenLabs API Key မမှန်ကန်ပါ။' });
      }
      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'TTS ပြုလုပ်ရန် စာသား လိုအပ်ပါသည်။' });
      }
      if (!voiceId || typeof voiceId !== 'string' || !voiceId.trim()) {
        return res.status(400).json({ error: 'ElevenLabs Voice ID ရွေးချယ်ပေးပါ (သို့မဟုတ် Instant Clone ပြုလုပ်ပါ)။' });
      }

      const keyToUse = cleanAsciiHeader(rawKey);
      const cleanVoiceId = cleanAsciiHeader(voiceId);

      const emLower = String(emotion || '').toLowerCase();
      let dynStability = Number(stability);
      let dynStyle = Number(style);
      if (emLower.includes('excited') || emLower.includes('surpris') || emLower.includes('fierce')) {
        dynStability = Math.max(0.3, dynStability - 0.1);
        dynStyle = Math.min(0.5, dynStyle + 0.1);
      } else if (emLower.includes('sad') || emLower.includes('empathetic') || emLower.includes('calm')) {
        dynStability = Math.min(0.7, dynStability + 0.1);
      }

      // ElevenLabs v3 models require exact schema:
      // Note: `similarity_boost` MUST NOT be sent to eleven_v3 (causes 422 Unprocessable Entity)
      // `language_code: "my"` specifies Burmese Unicode text
      const cleanText = text.trim();
      const v3Payload = {
        text: cleanText,
        model_id: 'eleven_v3',
        language_code: 'my',
        voice_settings: {
          stability: Number.isFinite(dynStability) ? Math.min(1.0, Math.max(0.0, dynStability)) : 0.5,
          style: Number.isFinite(dynStyle) ? Math.min(1.0, Math.max(0.0, dynStyle)) : 0.0,
          use_speaker_boost: true,
        },
      };

      const ttsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(cleanVoiceId)}?output_format=mp3_44100_128`;
      const ttsRes = await fetch(ttsUrl, {
        method: 'POST',
        headers: {
          'xi-api-key': keyToUse,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify(v3Payload),
        signal: AbortSignal.timeout(35000),
      });

      if (ttsRes.ok) {
        const audioBuf = Buffer.from(await ttsRes.arrayBuffer());
        if (audioBuf.length > 100) {
          res.setHeader('Content-Type', 'audio/mpeg');
          res.setHeader('Content-Length', audioBuf.length);
          res.setHeader('X-TTS-Engine', 'elevenlabs_v3');
          return res.send(audioBuf);
        }
      }

      const errJson = await ttsRes.json().catch(() => ({}));
      console.error(`ElevenLabs TTS HTTP ${ttsRes.status} Error:`, JSON.stringify(errJson));
      const detail = errJson?.detail?.message || errJson?.detail || errJson?.message || `ElevenLabs API error (HTTP ${ttsRes.status})`;
      const errMessage = typeof detail === 'string' ? detail : JSON.stringify(detail);

      return res.status(ttsRes.status || 400).json({
        error: `ElevenLabs TTS Error: ${errMessage}`,
        status: ttsRes.status,
      });
    } catch (error: any) {
      console.error('ElevenLabs TTS error:', error);
      return res.status(500).json({ error: formatNetworkError(error, 'ElevenLabs TTS') });
    }
  });



  // Vite integration
  if (process.env.NODE_ENV !== 'production') {
    process.env.DISABLE_HMR = 'true';
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, watch: null },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/live' });

  wss.on('connection', async (clientWs, req) => {
    let session: any = null;
    try {
      const urlObj = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      const clientKey = urlObj.searchParams.get('apiKey') || undefined;
      const ai = createGeminiClient(clientKey);

      session = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          systemInstruction: 'You are an intelligent, helpful video assistant and Burmese voice translator. Respond helpfully and conversationally.',
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audio && clientWs.readyState === 1) {
              clientWs.send(JSON.stringify({ audio }));
            }
            if (message.serverContent?.interrupted && clientWs.readyState === 1) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }
          },
          onclose: () => {
            if (clientWs.readyState === 1) {
              clientWs.close();
            }
          },
          onerror: (err: any) => {
            console.error('Gemini Live session error:', err);
            if (clientWs.readyState === 1) {
              clientWs.send(JSON.stringify({ error: err?.message || 'Live session error' }));
            }
          },
        },
      });

      clientWs.on('message', (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.audio) {
            session.sendRealtimeInput({
              audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
            });
          }
          if (msg.text) {
            session.sendRealtimeInput({
              text: msg.text,
            });
          }
        } catch (e) {
          console.error('Error parsing live client message:', e);
        }
      });

      clientWs.on('close', () => {
        try {
          session?.close?.();
        } catch (_) {}
      });
    } catch (err: any) {
      console.error('Gemini Live connection failed:', err);
      if (clientWs.readyState === 1) {
        clientWs.send(JSON.stringify({ error: err?.message || 'Live connection failed' }));
        clientWs.close();
      }
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}



// Appends clean silence padding to the end of a WAV buffer with smooth cosine anti-pop taper
function appendWavSilencePadding(wavBuffer: Buffer, paddingSeconds = 0.25): Buffer {
  try {
    if (wavBuffer.length < 44) return wavBuffer;
    if (wavBuffer.subarray(0, 4).toString() !== 'RIFF') return wavBuffer;

    const dataIndex = wavBuffer.indexOf('data');
    if (dataIndex === -1 || dataIndex + 8 > wavBuffer.length) return wavBuffer;

    const numChannels = wavBuffer.readUInt16LE(22);
    const sampleRate = wavBuffer.readUInt32LE(24);
    const bitsPerSample = wavBuffer.readUInt16LE(34);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;

    const currentDataSize = wavBuffer.readUInt32LE(dataIndex + 4);
    const dataStart = dataIndex + 8;
    const dataEnd = Math.min(wavBuffer.length, dataStart + currentDataSize);

    // Apply smooth cosine taper to the last 40ms of audio so waveform touches exact zero with no pop/buzz
    if (bitsPerSample === 16 && dataEnd > dataStart) {
      const bytesPerSample = bitsPerSample / 8;
      const totalSamples = Math.floor((dataEnd - dataStart) / blockAlign);
      const fadeCount = Math.min(totalSamples, Math.floor(sampleRate * 0.04)); // 40ms fade

      for (let i = 0; i < fadeCount; i++) {
        const sampleIdx = totalSamples - fadeCount + i;
        // Cosine fade curve: smoothly glides to zero
        const gain = 0.5 * (1 + Math.cos((Math.PI * (i + 1)) / (fadeCount + 1)));

        for (let ch = 0; ch < numChannels; ch++) {
          const byteOffset = dataStart + sampleIdx * blockAlign + ch * bytesPerSample;
          if (byteOffset + 1 < wavBuffer.length) {
            const rawVal = wavBuffer.readInt16LE(byteOffset);
            const taperedVal = Math.round(rawVal * gain);
            wavBuffer.writeInt16LE(taperedVal, byteOffset);
          }
        }
      }
    }

    const padBytes = Math.floor(paddingSeconds * byteRate);
    const alignedPadBytes = padBytes - (padBytes % blockAlign);
    if (alignedPadBytes <= 0) return wavBuffer;

    const silence = Buffer.alloc(alignedPadBytes, 0);
    const wavHead = wavBuffer.subarray(0, dataEnd);
    const updatedWav = Buffer.concat([wavHead, silence]);
    const newDataSize = (dataEnd - dataStart) + alignedPadBytes;
    const newTotalFileSize = updatedWav.length;

    updatedWav.writeUInt32LE(newTotalFileSize - 8, 4);
    updatedWav.writeUInt32LE(newDataSize, dataIndex + 4);

    return updatedWav;
  } catch (err) {
    return wavBuffer;
  }
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});


