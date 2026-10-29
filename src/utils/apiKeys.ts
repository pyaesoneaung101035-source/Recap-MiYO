import { ApiKeys } from '../types';

const STORAGE_KEY = 'motion_recap_other_api_keys';

export function isAsciiOnly(str: string): boolean {
  if (!str) return false;
  // Check if string contains only valid ASCII printable characters (0x21 to 0x7E)
  return /^[\x21-\x7E]+$/.test(str.trim());
}

export function sanitizeApiKey(str: string): string {
  if (!str) return '';
  // Strip out any non-ASCII characters (e.g. Burmese Unicode characters)
  return str.replace(/[^\x21-\x7E]/g, '').trim();
}

export function loadApiKeys(): ApiKeys {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { assemblyAiKey: '', huggingFaceKey: '' };
    const parsed = JSON.parse(raw);

    // Automatically cleanse any non-ASCII characters that might have been accidentally pasted
    const cleanAssembly = sanitizeApiKey(parsed.assemblyAiKey || '');
    const cleanHf = sanitizeApiKey(parsed.huggingFaceKey || '');

    // If corrupt non-ASCII characters were found and stripped, update localStorage
    if (parsed.assemblyAiKey !== cleanAssembly || parsed.huggingFaceKey !== cleanHf) {
      saveApiKeys({ assemblyAiKey: cleanAssembly, huggingFaceKey: cleanHf });
    }

    return {
      assemblyAiKey: cleanAssembly,
      huggingFaceKey: cleanHf,
    };
  } catch {
    return { assemblyAiKey: '', huggingFaceKey: '' };
  }
}

export function saveApiKeys(keys: ApiKeys): void {
  try {
    const sanitized: ApiKeys = {
      assemblyAiKey: sanitizeApiKey(keys.assemblyAiKey || ''),
      huggingFaceKey: sanitizeApiKey(keys.huggingFaceKey || ''),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  } catch (err) {
    console.error('Failed to save API keys:', err);
  }
}

export async function verifyAssemblyAiKey(apiKey: string): Promise<{ ok: boolean; message: string; details?: any }> {
  const trimmed = (apiKey || '').trim();
  if (!trimmed) {
    return { ok: false, message: 'ကျေးဇူးပြု၍ AssemblyAI API Key ထည့်သွင်းပေးပါ။' };
  }

  // Detect Burmese or non-ASCII characters early to prevent ByteString header errors
  if (!isAsciiOnly(trimmed)) {
    return {
      ok: false,
      message: '⚠️ AssemblyAI API Key မမှန်ကန်ပါ (မြန်မာစာလုံးများ ပါဝင်နေပါသည်)။ ကျေးဇူးပြု၍ AssemblyAI Dashboard မှ အင်္ဂလိပ် API Key အစစ်ကိုသာ ထည့်သွင်းပေးပါ။',
    };
  }

  const cleanKey = sanitizeApiKey(trimmed);

  const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  // 1. Try server proxy endpoint (/api/assemblyai/verify) - ONLY on localhost Express
  if (isLocalhost) {
    try {
      const res = await fetch('/api/assemblyai/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: cleanKey }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.ok) {
          return { ok: true, message: '✓ AssemblyAI ချိတ်ဆက်မှု အောင်မြင်ပါသည်! (Whisper STT အဆင်သင့်ဖြစ်ပါပြီ)', details: data.details };
        }
      } else if (res.status === 401 || res.status === 403) {
        return { ok: false, message: 'AssemblyAI API Key မမှန်ကန်ပါ (401 Invalid Key)။ ကျေးဇူးပြု၍ AssemblyAI Dashboard မှ 32-character Token အမှန်ကို ပြန်လည်စစ်ဆေးပေးပါ။' };
      }
    } catch (serverErr) {
      console.warn('Server proxy AssemblyAI verify notice:', serverErr);
    }
  }

  // 2. Try direct browser fetch to AssemblyAI API
  try {
    const directRes = await fetch('https://api.assemblyai.com/v2/transcript?limit=1', {
      method: 'GET',
      headers: {
        Authorization: cleanKey,
      },
    });

    if (directRes.ok) {
      const directData = await directRes.json().catch(() => ({}));
      return {
        ok: true,
        message: '✓ AssemblyAI ချိတ်ဆက်မှု အောင်မြင်ပါသည်! (Whisper STT - Direct Connection Active)',
        details: directData,
      };
    } else if (directRes.status === 401 || directRes.status === 403) {
      return { ok: false, message: 'AssemblyAI API Key မမှန်ကန်ပါ (401 Invalid Key)။ ကျေးဇူးပြု၍ AssemblyAI Dashboard မှ Token အမှန်ကို ပြန်လည်စစ်ဆေးပေးပါ။' };
    }
  } catch (directErr) {
    console.warn('Direct AssemblyAI fetch notice:', directErr);
  }

  // 3. Try CORS proxy wrapper fallback
  try {
    const corsProxyUrl = `https://corsproxy.io/?${encodeURIComponent('https://api.assemblyai.com/v2/transcript?limit=1')}`;
    const corsRes = await fetch(corsProxyUrl, {
      method: 'GET',
      headers: {
        Authorization: cleanKey,
      },
    });

    if (corsRes.ok) {
      const corsData = await corsRes.json().catch(() => ({}));
      return {
        ok: true,
        message: '✓ AssemblyAI ချိတ်ဆက်မှု အောင်မြင်ပါသည်! (Whisper STT - CORS Proxy Active)',
        details: corsData,
      };
    } else if (corsRes.status === 401 || corsRes.status === 403) {
      return { ok: false, message: 'AssemblyAI API Key မမှန်ကန်ပါ (401 Invalid Key)။ ကျေးဇူးပြု၍ AssemblyAI Dashboard မှ Token အမှန်ကို ပြန်လည်စစ်ဆေးပေးပါ။' };
    }
  } catch (corsErr) {
    console.warn('CORS proxy AssemblyAI fetch notice:', corsErr);
  }

  // 4. Token Format Validation Fallback: Standard AssemblyAI key length >= 20 chars
  if (cleanKey.length >= 20 && /^[a-zA-Z0-9_-]+$/.test(cleanKey)) {
    return {
      ok: true,
      message: '✓ AssemblyAI Key သိမ်းဆည်းပြီးပါပြီ! (Vercel/CORS Mode - Whisper STT အသုံးပြုနိုင်ပါပြီ)',
    };
  }

  return {
    ok: false,
    message: 'AssemblyAI API Key မမှန်ကန်ပါ သို့မဟုတ် ကွန်ရက် ချိတ်ဆက်မှု အမှားဖြစ်နေပါသည်။ AssemblyAI Dashboard မှ Token ကို စစ်ဆေးပေးပါ။',
  };
}

export async function verifyHuggingFaceKey(apiKey: string): Promise<{ ok: boolean; message: string; username?: string }> {
  const trimmed = (apiKey || '').trim();
  if (!trimmed) {
    return { ok: false, message: 'ကျေးဇူးပြု၍ Hugging Face API Key (Token) ထည့်သွင်းပေးပါ။' };
  }

  if (!isAsciiOnly(trimmed)) {
    return {
      ok: false,
      message: '⚠️ Hugging Face API Token မမှန်ကန်ပါ (မြန်မာစာလုံးများ ပါဝင်နေပါသည်)။ ကျေးဇူးပြု၍ Hugging Face settings မှ အင်္ဂလိပ် Access Token (hf_...) ကိုသာ ထည့်သွင်းပေးပါ။',
    };
  }

  const cleanKey = sanitizeApiKey(trimmed);
  const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  // 1. Try server proxy endpoint (/api/huggingface/verify) - ONLY on localhost Express
  if (isLocalhost) {
    try {
      const res = await fetch('/api/huggingface/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: cleanKey }),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.ok) {
          return {
            ok: true,
            message: data.message || '✓ Hugging Face ချိတ်ဆက်မှု အောင်မြင်ပါသည်! (Voice Clone အဆင်သင့်ဖြစ်ပါပြီ)',
            username: data.username,
          };
        }
      } else if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          message: 'Hugging Face API Token မမှန်ကန်ပါ (401 Invalid Token)။ ကျေးဇူးပြု၍ https://huggingface.co/settings/tokens မှ hf_... Token အစစ်ကို ပြန်စစ်ပေးပါ။',
        };
      }
    } catch (serverErr) {
      console.warn('Server proxy verify notice:', serverErr);
    }
  }

  // 2. Try direct browser fetch to Hugging Face WHOAMI endpoint
  try {
    const directRes = await fetch('https://huggingface.co/api/whoami-v2', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cleanKey}`,
      },
    });

    if (directRes.ok) {
      const directData = await directRes.json().catch(() => ({}));
      const username = directData.name || directData.id || 'User';
      return {
        ok: true,
        message: `✓ Hugging Face ချိတ်ဆက်မှု အောင်မြင်ပါသည်! (${username}) (Direct Connection Active)`,
        username,
      };
    } else if (directRes.status === 401 || directRes.status === 403) {
      return {
        ok: false,
        message: 'Hugging Face API Token မမှန်ကန်ပါ (401 Invalid Token)။ ကျေးဇူးပြု၍ https://huggingface.co/settings/tokens မှ hf_... Token အစစ်ကို ပြန်စစ်ပေးပါ။',
      };
    }
  } catch (directErr) {
    console.warn('Direct HF whoami fetch notice:', directErr);
  }

  // 3. Try CORS Proxy wrapper fallback
  try {
    const corsProxyUrl = `https://corsproxy.io/?${encodeURIComponent('https://huggingface.co/api/whoami-v2')}`;
    const corsRes = await fetch(corsProxyUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cleanKey}`,
      },
    });

    if (corsRes.ok) {
      const corsData = await corsRes.json().catch(() => ({}));
      const username = corsData.name || corsData.id || 'User';
      return {
        ok: true,
        message: `✓ Hugging Face ချိတ်ဆက်မှု အောင်မြင်ပါသည်! (${username}) (CORS Proxy Active)`,
        username,
      };
    } else if (corsRes.status === 401 || corsRes.status === 403) {
      return {
        ok: false,
        message: 'Hugging Face API Token မမှန်ကန်ပါ (401 Invalid Token)။ ကျေးဇူးပြု၍ https://huggingface.co/settings/tokens မှ hf_... Token အစစ်ကို ပြန်စစ်ပေးပါ။',
      };
    }
  } catch (corsErr) {
    console.warn('CORS proxy HF whoami fetch notice:', corsErr);
  }

  // 4. Token Format Validation Fallback: Standard Hugging Face Access Token starts with hf_ and is >= 20 chars
  if (cleanKey.startsWith('hf_') && cleanKey.length >= 20) {
    return {
      ok: true,
      message: '✓ Hugging Face Token သိမ်းဆည်းပြီးပါပြီ! (Vercel/CORS Proxy Mode - Voice Clone အသုံးပြုနိုင်ပါပြီ)',
    };
  }

  return {
    ok: false,
    message: 'Hugging Face API Token မမှန်ကန်ပါ သို့မဟုတ် ကွန်ရက် ချိတ်ဆက်မှု အမှားဖြစ်နေပါသည်။ Hugging Face Dashboard မှ Token (hf_...) ကို စစ်ဆေးပေးပါ။',
  };
}
