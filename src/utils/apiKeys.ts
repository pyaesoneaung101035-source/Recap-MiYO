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

  try {
    const res = await fetch('/api/assemblyai/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: cleanKey }),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      return { ok: true, message: '✓ AssemblyAI ချိတ်ဆက်မှု အောင်မြင်ပါသည်! (Whisper STT အဆင်သင့်ဖြစ်ပါပြီ)', details: data.details };
    } else {
      return { ok: false, message: data.error || 'AssemblyAI API Key မမှန်ကန်ပါ။ ကျေးဇူးပြု၍ ပြန်လည်စစ်ဆေးပါ။' };
    }
  } catch (err: any) {
    return { ok: false, message: `ကွန်ရက် ချိတ်ဆက်မှု အမှား: ${err.message}` };
  }
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

  try {
    const res = await fetch('/api/huggingface/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: cleanKey }),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      return {
        ok: true,
        message: data.message || '✓ Hugging Face ချိတ်ဆက်မှု အောင်မြင်ပါသည်! (Voice Clone အဆင်သင့်ဖြစ်ပါပြီ)',
        username: data.username,
      };
    } else {
      return {
        ok: false,
        message: data.error || 'Hugging Face API Token မမှန်ကန်ပါ (Invalid token)။ ပြန်လည်စစ်ဆေးပေးပါ။',
      };
    }
  } catch (err: any) {
    return { ok: false, message: `ကွန်ရက် ချိတ်ဆက်မှု အမှား: ${err.message}` };
  }
}
