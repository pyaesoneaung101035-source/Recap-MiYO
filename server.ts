import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { synthesizeNeuralRealityMyanmar, REALITY_VOICE_CONFIGS } from './server/neuralRealityTts';

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

function createGeminiClient(apiKey: string) {
  return new GoogleGenAI({ apiKey });
}

async function callGeminiRest(keyToUse: string, model: string, contentsPayload: any, systemInstruction?: any) {
  const isOAuth = keyToUse.startsWith('ya29.') || keyToUse.startsWith('ya29') || keyToUse.startsWith('1//');
  
  const url = isOAuth
    ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(keyToUse)}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'aistudio-build',
  };

  if (isOAuth) {
    headers['Authorization'] = `Bearer ${keyToUse}`;
  } else {
    headers['x-goog-api-key'] = keyToUse;
  }

  const body: any = {
    contents: typeof contentsPayload === 'string' ? [{ parts: [{ text: contentsPayload }] }] : contentsPayload,
  };

  if (systemInstruction) {
    if (typeof systemInstruction === 'string') {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    } else {
      body.systemInstruction = systemInstruction;
    }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
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

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

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

  // Server-side Gemini API route
  app.post(['/api/gemini/generate', '/gemini/generate', '/generate'], async (req, res) => {
    try {
      const { apiKey, model = 'gemini-2.0-flash', prompt, contents, parts, systemInstruction } = req.body;
      const rawKey = apiKey || process.env.GEMINI_API_KEY;

      if (!rawKey) {
        return res.status(400).json({
          error: 'Gemini API Key မရှိသေးပါ။ ကျေးဇူးပြု၍ Google AI Studio မှ API Key ထည့်သွင်းပေးပါ။',
        });
      }

      let keyToUse = cleanAsciiHeader(rawKey);

      if (!isValidAsciiApiKey(keyToUse)) {
        return res.status(400).json({
          error: 'Gemini API Key မမှန်ကန်ပါ (အင်္ဂလိပ်စာလုံးနှင့် နံပါတ်များသာ ပါရပါမည်)။',
        });
      }

      const contentsPayload = contents || (parts ? { parts } : prompt);
      const candidateModels = [model || 'gemini-2.0-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];

      let lastError: any = null;
      for (const m of candidateModels) {
        let retries = 0;
        while (retries < 2) {
          try {
            const textResult = await callGeminiRest(keyToUse, m, contentsPayload, systemInstruction);

            if (textResult !== undefined) {
              return res.json({ text: textResult });
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
            const errMsg = modelErr?.message || '';
            const isQuota = status === 429 || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota');
            
            if (isQuota && retries === 0) {
              retries++;
              await new Promise((r) => setTimeout(r, 1500));
              continue;
            }
            break;
          }
        }
      }

      const errorDetails = analyzeGeminiError(lastError);
      throw lastError || new Error('All Gemini model candidates failed');
    } catch (error: any) {
      console.error('Gemini error:', error);
      const status = error?.status || error?.statusCode || 500;
      const errorDetails = analyzeGeminiError(error);
      let errMsg = formatNetworkError(error, 'Gemini');
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
      const { apiKey, model = 'gemini-2.5-flash' } = req.body;
      const rawKey = apiKey || process.env.GEMINI_API_KEY;

      if (!rawKey || !isValidAsciiApiKey(rawKey)) {
        return res.status(400).json({ ok: false, error: 'Valid Gemini API Key is required (400 Bad Request).' });
      }

      const keyToUse = cleanAsciiHeader(rawKey);
      const textResult = await callGeminiRest(keyToUse, model || 'gemini-2.5-flash', 'Ping');

      if (textResult !== undefined) {
        return res.json({ ok: true, message: 'Gemini API connection test successful.' });
      }

      return res.status(500).json({ ok: false, error: 'Empty response received from Gemini API.' });
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
      const { apiKey, prompt, contents, parts, systemInstruction } = req.body;
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
        model: 'gemini-3.8-flash',
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
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      return res.end();
    }
  });

  // 100% Free Unlimited 24kHz Studio Neural Myanmar Voice Endpoint (8 Distinct Human Personas)
  app.post(['/api/tts/free', '/api/tts/edge'], async (req, res) => {
    try {
      const { text, voice = 'Thiha', style = 'conversational', speed, rate } = req.body;
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text is required for TTS' });
      }

      const activeSpeed = typeof speed === 'number' ? speed : (rate ? parseFloat(rate) : 1.0);
      const mp3Buffer = await synthesizeNeuralRealityMyanmar(text, { voice, style, speed: activeSpeed });
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
      const { text, voice = 'Thiha', style = 'conversational', speed, rate, apiKey } = req.body;
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
        .replace(/([။.!?])(?!\s*($|\n))/g, '$1\n\n')
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
          voice: 'Orpheus',
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
          voice: 'Enceladus',
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
          voice: 'Minerva',
          persona: 'Wise, steady and articulate Burmese female speaker with professional clarity and composed cadence',
        },
        Luna: {
          voice: 'Luna',
          persona: 'Soft, dreamy and lyrical Burmese female speaker with gentle melodic tone and soothing warmth',
        },
        Oberon: {
          voice: 'Oberon',
          persona: 'Deep, resonant and cinematic Burmese male storyteller with rich baritone presence and suspenseful pacing',
        },
        Lyra: {
          voice: 'Lyra',
          persona: 'Musical, flowing and expressive Burmese female speaker with graceful articulation and melodic rhythm',
        },
        Atlas: {
          voice: 'Atlas',
          persona: 'Powerful, deep and commanding Burmese male speaker with strong resonance and firm authority',
        },
        Schedar: {
          voice: 'Schedar',
          persona: 'Even, balanced and natural Burmese male speaker with steady cadence and clear conversational delivery',
        },
        Gacrux: {
          voice: 'Gacrux',
          persona: 'Mature, seasoned and dignified Burmese male speaker with deep vocal experience and grounded authority',
        },
        Pulcherrima: {
          voice: 'Pulcherrima',
          persona: 'Forward, dynamic and engaging Burmese female speaker with bright enthusiasm and crisp articulation',
        },
        Achird: {
          voice: 'Achird',
          persona: 'Friendly, warm and approachable Burmese male speaker with casual conversational warmth and natural smiles',
        },
        Zubenelgenubi: {
          voice: 'Zubenelgenubi',
          persona: 'Casual, relaxed and easygoing Burmese male speaker with effortless conversational rhythm',
        },
        Vindemiatrix: {
          voice: 'Vindemiatrix',
          persona: 'Gentle, soft and tender Burmese female speaker with soothing calm and comforting emotional tone',
        },
        Sadachbia: {
          voice: 'Sadachbia',
          persona: 'Lively, vibrant and cheerful Burmese female speaker with upbeat energy and playful cadence',
        },
        Sadaltager: {
          voice: 'Sadaltager',
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

      const combinedStylePrompt = `GEMINI FLAGSHIP NEURAL REALITY ENGINE (24kHz Studio Neural Model).
Speaker Persona: ${selected.persona}.
Delivery Style: ${styleDescription}.
Native Language: Burmese (မြန်မာဘာသာ).

EXACT HUMAN REALITY DIRECTIVES:
1. PURE HUMAN REALISM: Speak with 100% natural human voice. Incorporate natural breath pauses (သဘာဝကျသော အသက်ရှုသံ), conversational cadence (စကားပြောစည်းဝါး), and human inflection (အသံနေအထား). Eliminate all robotic concatenation or synthetic flatness.
2. FULL AND COMPLETE READING: You MUST narrate the text completely from the first word to the very last word without dropping or skipping words.
3. NATURAL SENTENCE PAUSES: Pause gently and naturally at sentence ends ('။', '.', '?', '!') before narrating the next sentence.
4. CLEAN SILENT PAUSES & CRYSTAL TAIL: The audio must remain crystal clear with zero buzz ('jee-jee'), zero clicks, and zero vocoder artifacts at word and sentence endings.`;

      let audioBuffer: Buffer | null = null;

      // If a Gemini API key is present, attempt Gemini synthesis first
      if (keyToUse) {
        try {
          const ai = createGeminiClient(keyToUse);

          const tryModel = async (modelName: string): Promise<Buffer> => {
            const fullPromptText = `Instructions: Perform the following Burmese narration with exact vocal emotion, pitch, tempo, and character style.
Speaker Persona: ${selected.persona}.
Delivery Style: ${styleDescription}.

BURMESE TEXT TO READ OUT LOUD COMPLETELY:
${cleanText}`;

            const response = await ai.models.generateContent({
              model: modelName,
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      text: fullPromptText,
                    },
                  ],
                },
              ],
              config: {
                systemInstruction: combinedStylePrompt,
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: selected.voice },
                  },
                },
              },
            });

            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (!base64Audio) {
              throw new Error(`No audio returned from ${modelName}`);
            }
            const rawWav = Buffer.from(base64Audio, 'base64');
            return appendWavSilencePadding(rawWav, 0.25);
          };

          try {
            audioBuffer = await tryModel('gemini-3.8-flash-lite-tts');
          } catch (err: any) {
            console.warn('Primary Gemini TTS attempt failed (quota or model):', err.message);
            try {
              audioBuffer = await tryModel('gemini-3.8-flash-tts');
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
        return res.send(audioBuffer);
      }

      // If Gemini hit quota (429) or no key, instantly synthesize with 24kHz Studio Neural Model
      console.log(`Using 24kHz Studio Neural Voice Actor fallback for ${voice} (${style})...`);
      const activeSpeed = typeof speed === 'number' ? speed : (rate ? parseFloat(rate) : 1.0);
      const neuralMp3 = await synthesizeNeuralRealityMyanmar(cleanText, { voice, style, speed: activeSpeed });
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', neuralMp3.length);
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



  // Vite integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
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

startServer();


