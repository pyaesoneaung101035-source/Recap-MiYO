import serverless from 'serverless-http';
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { synthesizeNeuralRealityMyanmar } from '../../server/neuralRealityTts';

dotenv.config();

const app = express();
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

function isValidAsciiApiKey(key: any): boolean {
  if (typeof key !== 'string') return false;
  const trimmed = key.trim();
  if (!trimmed || trimmed.length < 4) return false;
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

function createGeminiClient(keyToUse: string) {
  const isBearerToken = keyToUse.toLowerCase().startsWith('aq') || keyToUse.startsWith('ya29');
  const headers: Record<string, string> = {
    'User-Agent': 'aistudio-build',
  };
  if (isBearerToken) {
    headers['Authorization'] = `Bearer ${keyToUse}`;
  } else {
    headers['x-goog-api-key'] = keyToUse;
  }

  return new GoogleGenAI(
    isBearerToken
      ? { apiKey: '', httpOptions: { headers } }
      : { apiKey: keyToUse, httpOptions: { headers } }
  );
}

// Multi-route support for Netlify functions routing (/api/gemini/generate, /gemini/generate, /generate)
app.post(['/api/gemini/generate', '/gemini/generate', '/generate'], async (req, res) => {
  try {
    const { apiKey, model = 'gemini-2.5-flash', prompt, contents, parts, systemInstruction } = req.body;
    const rawKey = apiKey || process.env.GEMINI_API_KEY;

    if (!rawKey) {
      return res.status(400).json({
        error: 'Gemini API Key မရှိသေးပါ။ ကျေးဇူးပြု၍ Google AI Studio မှ API Key ထည့်သွင်းပေးပါ။',
      });
    }

    const keyToUse = cleanAsciiHeader(rawKey);
    if (!isValidAsciiApiKey(keyToUse)) {
      return res.status(400).json({
        error: 'Gemini API Key မမှန်ကန်ပါ (အင်္ဂလိပ်စာလုံးနှင့် နံပါတ်များသာ ပါရပါမည်)။',
      });
    }

    const ai = createGeminiClient(keyToUse);

    const contentsPayload = contents || (parts ? { parts } : prompt);
    const candidateModels = [model || 'gemini-2.5-flash', 'gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-2.5-flash-lite'];

    let lastError: any = null;
    for (const m of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model: m,
          contents: contentsPayload,
          config: systemInstruction ? { systemInstruction } : undefined,
        });

        if (response && response.text !== undefined) {
          return res.json({ text: response.text });
        }
      } catch (err: any) {
        lastError = err;
        const status = err?.status || err?.statusCode;
        // Do not treat 401 as a model error - return 401 immediately
        if (status === 401 || status === 403) {
          const errorDetails = analyzeGeminiError(err);
          return res.status(status).json({
            error: 'Gemini API Key မမှန်ကန်ပါ (401/403 Unauthorized)။ Google AI Studio မှ API Key အမှန်ကို စစ်ဆေးထည့်သွင်းပါ။',
            errorDetails,
            status,
          });
        }
        if (status === 429) {
          throw err;
        }
      }
    }

    const errorDetails = analyzeGeminiError(lastError);
    throw lastError || new Error('All Gemini model candidates failed');
  } catch (error: any) {
    console.error('Gemini error:', error);
    const status = error?.status || error?.statusCode || 500;
    const errorDetails = analyzeGeminiError(error);
    const errMsg = formatNetworkError(error, 'Gemini');
    return res.status(status).json({ error: errMsg, errorDetails, status });
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
    const ai = createGeminiClient(keyToUse);

    const response = await ai.models.generateContent({
      model: model || 'gemini-2.5-flash',
      contents: 'Ping',
    });

    if (response && response.text !== undefined) {
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

export const handler = serverless(app);
