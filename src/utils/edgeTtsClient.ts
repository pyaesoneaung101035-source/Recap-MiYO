/**
 * High-Quality Realistic Myanmar Voice Synthesis Studio
 * Powered by Gemini Flagship Neural Voice Models (gemini-3.8-flash-lite-tts & gemini-3.8-flash-tts)
 * with Multi-Key Rotation, Human Vocal Expression Presets, and Smooth Fallback.
 */

import { VoiceOption } from '../types';
import { loadGeminiKeys, saveGeminiKeys } from './geminiPool';

export type VoiceStyle = 'conversational' | 'recap' | 'broadcast' | 'energetic' | 'soothing' | 'affectionate';

export interface TtsOptions {
  voice: VoiceOption;
  style?: VoiceStyle;
  rate?: string; // e.g. '+0%', '+10%'
  speed?: number; // e.g. 0.5 to 2.0
  pitch?: string; // e.g. '+0Hz', '-5Hz'
  trimSilence?: boolean; // cut pauses > 0.25s down to 0.25s
  forceBackup?: boolean;
  onStatusUpdate?: (status: string) => void;
}

export interface VoiceProfile {
  name: string;
  myanmarName: string;
  gender: 'male' | 'female';
  toneTitle: string;
  geminiVoice: string; // Prebuilt Gemini voice (Charon, Puck, Fenrir, etc.)
  desc: string;
  sampleGreeting: string;
}

export const VOICE_PROFILES: Record<VoiceOption, VoiceProfile> = {
  // 4 DISTINCT MALE VOICES (ကျား ၄ ဦး - Reality Human 24kHz Studio)
  Thiha: {
    name: 'Thiha',
    myanmarName: 'သီဟ',
    gender: 'male',
    toneTitle: 'နွေးထွေးခန့်ညားသော နေ့စဉ်စကားပြော သဘာဝအသံ',
    geminiVoice: 'Puck',
    desc: 'နွေးထွေးခန့်ညားသော နေ့စဉ်စကားပြော သဘာဝအသံ (Conversational Male)',
    sampleGreeting: 'မင်္ဂလာပါခင်ဗျာ၊ ကျွန်တော်ကတော့ သီဟ ဖြစ်ပါတယ်။ သဘာဝကျပြီး နွေးထွေးတဲ့ နေ့စဉ်စကားပြော အသံစစ်စစ် ဖြစ်ပါတယ်။',
  },
  KyawKyaw: {
    name: 'Kyaw Kyaw',
    myanmarName: 'ကျော်ကျော်',
    gender: 'male',
    toneTitle: 'သြဇာကြီးမား နက်နဲသော Bass အသံ (Movie Recap အတွက် အထူးသင့်လျော်)',
    geminiVoice: 'Charon',
    desc: 'သြဇာကြီးမား နက်နဲသော Bass အသံ (Movie Recap အတွက် အထူးသင့်လျော်)',
    sampleGreeting: 'မင်္ဂလာပါ၊ ကျွန်တော်ကတော့ ကျော်ကျော် ဖြစ်ပါတယ်။ ဇာတ်လမ်းဇာတ်ကွက်တွေကို နက်နဲသော Bass အသံနဲ့ Movie Recap အတွက် အထူးသင့်လျော်စွာ တင်ဆက်ပေးသွားမှာပါ။',
  },
  AungAung: {
    name: 'Aung Aung',
    myanmarName: 'အောင်အောင်',
    gender: 'male',
    toneTitle: 'တက်ကြွသွက်လက်သော လူငယ်သံ',
    geminiVoice: 'Fenrir',
    desc: 'တက်ကြွသွက်လက်သော လူငယ်သံ (Dynamic Youth Male)',
    sampleGreeting: 'ဟေ့ မင်္ဂလာပါဗျာ၊ အောင်အောင် ပါ။ တက်ကြွသွက်လက်တဲ့ လူငယ်အသံနဲ့ စိတ်လှုပ်ရှားစရာ အစီအစဉ်သစ်တွေကို တင်ဆက်ပေးပါ့မယ်။',
  },
  MinThway: {
    name: 'Min Thway',
    myanmarName: 'မင်းသွေး',
    gender: 'male',
    toneTitle: 'အေးချမ်းတည်ကြည်သော ဇာတ်လမ်းပြောသံ',
    geminiVoice: 'Orpheus',
    desc: 'အေးချမ်းတည်ကြည်သော ဇာတ်လမ်းပြောသံ (Calm Narrative Male)',
    sampleGreeting: 'မင်္ဂလာပါခင်ဗျာ၊ ကျွန်တော် မင်းသွေး ပါ။ အေးချမ်းတည်ကြည်တဲ့ ဇာတ်လမ်းပြောသံနဲ့ စိတ်အေးချမ်းသာစွာ နားဆင်ခံစားနိုင်မှာ ဖြစ်ပါတယ်။',
  },

  // 4 DISTINCT FEMALE VOICES (မ ၄ ဦး - Reality Human 24kHz Studio)
  Nilar: {
    name: 'Nilar',
    myanmarName: 'နီလာ',
    gender: 'female',
    toneTitle: 'သဘာဝကျနူးညံ့ ကြည်လင်ပြတ်သားသော အသံ',
    geminiVoice: 'Kore',
    desc: 'သဘာဝကျနူးညံ့ ကြည်လင်ပြတ်သားသော အသံ (Expressive Natural Female)',
    sampleGreeting: 'မင်္ဂလာပါရှင်၊ ကျွန်မ နီလာ ပါ။ သဘာဝကျနူးညံ့ ကြည်လင်ပြတ်သားတဲ့ လူသားစစ်စစ် အသံနဲ့ နှုတ်ခွန်းဆက်သအပ်ပါတယ်။',
  },
  MayThu: {
    name: 'May Thu',
    myanmarName: 'မေသူ',
    gender: 'female',
    toneTitle: 'ချိုသာနူးညံ့သော ဇာတ်လမ်းပြောသံ',
    geminiVoice: 'Aoede',
    desc: 'ချိုသာနူးညံ့သော ဇာတ်လမ်းပြောသံ (Sweet Storytelling Female)',
    sampleGreeting: 'မင်္ဂလာပါရှင်၊ ကျွန်မ မေသူ ပါ။ ချိုသာနူးညံ့တဲ့ ဇာတ်လမ်းပြောသံလေးနဲ့ ရင်ခုန်စရာ ဇာတ်လမ်းတွေကို ပြောပြပေးပါ့မယ်ရှင်။',
  },
  Thiri: {
    name: 'Thiri',
    myanmarName: 'သီရိ',
    gender: 'female',
    toneTitle: 'တောက်ပသွက်လက်သော သတင်းနှင့် ရုပ်သံတင်ဆက်သံ',
    geminiVoice: 'Zephyr',
    desc: 'တောက်ပသွက်လက်သော သတင်းနှင့် ရုပ်သံတင်ဆက်သံ (Broadcast Presenter)',
    sampleGreeting: 'မင်္ဂလာပါရှင်၊ ကျွန်မ သီရိ ပါ။ တောက်ပသွက်လက်တဲ့ သတင်းနှင့် ရုပ်သံတင်ဆက်သံနဲ့ အကြောင်းအရာတွေကို တိကျပြတ်သားစွာ တင်ဆက်ပေးပါ့မယ်။',
  },
  SuSu: {
    name: 'Su Su',
    myanmarName: 'စုစု',
    gender: 'female',
    toneTitle: 'ချစ်စဖွယ် လန်းဆန်းပျော်ရွှင်သော အသံ',
    geminiVoice: 'Enceladus',
    desc: 'ချစ်စဖွယ် လန်းဆန်းပျော်ရွှင်သော အသံ (Cheerful Sweet Female)',
    sampleGreeting: 'ဟယ်လို မင်္ဂလာပါရှင်၊ စုစု ပါ။ ချစ်စဖွယ် လန်းဆန်းပျော်ရွှင်တဲ့ အသံလေးနဲ့ ရယ်မောပျော်ရွှင်စွာ တင်ဆက်ပေးမှာပါ။',
  },
  Sulafat: {
    name: 'Sulafat',
    myanmarName: 'စူလာဖတ်',
    gender: 'female',
    toneTitle: 'Warm (နွေးထွေးသော အသံ)',
    geminiVoice: 'Puck',
    desc: 'Warm female voice',
    sampleGreeting: 'မင်္ဂလာပါရှင်၊ စူလာဖတ် ပါ။ နွေးထွေးပျူငှာသော အသံဖြင့် နှုတ်ခွန်းဆက်သအပ်ပါတယ်။',
  },
  Titus: {
    name: 'Titus',
    myanmarName: 'တိုက်တပ်စ်',
    gender: 'male',
    toneTitle: 'Clear, authoritative (ကြည်လင် တိကျခိုင်မာသော အသံ)',
    geminiVoice: 'Charon',
    desc: 'Clear, authoritative male voice',
    sampleGreeting: 'မင်္ဂလာပါခင်ဗျာ၊ တိုက်တပ်စ် ပါ။ တိကျခိုင်မာသော အသံဖြင့် တင်ဆက်ပေးပါမည်။',
  },
  Virgo: {
    name: 'Virgo',
    myanmarName: 'ဗာဂို',
    gender: 'female',
    toneTitle: 'Calm, measured (အေးချမ်း တည်ငြိမ်သော အသံ)',
    geminiVoice: 'Kore',
    desc: 'Calm, measured female voice',
    sampleGreeting: 'မင်္ဂလာပါရှင်၊ ဗာဂို ပါ။ အေးချမ်းတည်ငြိမ်သော အသံဖြင့် နားဆင်ခံစားနိုင်ပါတယ်။',
  },
  Perseus: {
    name: 'Perseus',
    myanmarName: 'ပါဆီးရပ်စ်',
    gender: 'male',
    toneTitle: 'Strong, bold (အားမာန်ပါ စွမ်းအားပြည့် အသံ)',
    geminiVoice: 'Fenrir',
    desc: 'Strong, bold male voice',
    sampleGreeting: 'မင်္ဂလာပါခင်ဗျာ၊ ပါဆီးရပ်စ် ပါ။ အားမာန်ပါသေချာသော အသံဖြင့် တင်ဆက်ပေးပါမယ်။',
  },
  Minerva: {
    name: 'Minerva',
    myanmarName: 'မီနာဗာ',
    gender: 'female',
    toneTitle: 'Wise, steady (ပညာရှိ တည်ငြိမ်သော အသံ)',
    geminiVoice: 'Aoede',
    desc: 'Wise, steady female voice',
    sampleGreeting: 'မင်္ဂလာပါရှင်၊ မီနာဗာ ပါ။ တည်ငြိမ်ပညာရှိသော အသံဖြင့် တင်ဆက်ပါတယ်။',
  },
  Luna: {
    name: 'Luna',
    myanmarName: 'လူးနား',
    gender: 'female',
    toneTitle: 'Soft, dreamy (နူးညံ့ ယဉ်ကျေး စိတ်ကူးယဉ်ဆန်သော အသံ)',
    geminiVoice: 'Zephyr',
    desc: 'Soft, dreamy female voice',
    sampleGreeting: 'မင်္ဂလာပါရှင်၊ လူးနား ပါ။ နူးညံ့ပျော့ပြောင်းသော အသံဖြင့် နှုတ်ခွန်းဆက်ပါတယ်။',
  },
  Oberon: {
    name: 'Oberon',
    myanmarName: 'အိုဘီရွန်',
    gender: 'male',
    toneTitle: 'Deep, resonant (နက်နဲ ရင်သပ်ရှုမောဖွယ် Bass အသံ)',
    geminiVoice: 'Orpheus',
    desc: 'Deep, resonant male voice',
    sampleGreeting: 'မင်္ဂလာပါခင်ဗျာ၊ အိုဘီရွန် ပါ။ နက်နဲခန့်ညားသော Bass အသံ ဖြစ်ပါတယ်။',
  },
  Lyra: {
    name: 'Lyra',
    myanmarName: 'လိုင်ရာ',
    gender: 'female',
    toneTitle: 'Musical, flowing (တေးသံသာယာ စီးဆင်းသော အသံ)',
    geminiVoice: 'Enceladus',
    desc: 'Musical, flowing female voice',
    sampleGreeting: 'မင်္ဂလာပါရှင်၊ လိုင်ရာ ပါ။ တေးသံသာယာစွာ စီးဆင်းသော အသံဖြင့် တင်ဆက်ပါတယ်။',
  },
  Atlas: {
    name: 'Atlas',
    myanmarName: 'အတ္တလပ်စ်',
    gender: 'male',
    toneTitle: 'Powerful, deep (စွမ်းအားထက်မြက် နက်နဲသော အသံ)',
    geminiVoice: 'Charon',
    desc: 'Powerful, deep male voice',
    sampleGreeting: 'မင်္ဂလာပါခင်ဗျာ၊ အတ္တလပ်စ် ပါ။ စွမ်းအားထက်မြက်နက်နဲသော အသံ ဖြစ်ပါတယ်။',
  },
  Schedar: {
    name: 'Schedar',
    myanmarName: 'ရှီဒါ',
    gender: 'male',
    toneTitle: 'Even (ညီညာမျှတသော အသံ)',
    geminiVoice: 'Puck',
    desc: 'Even tone male voice',
    sampleGreeting: 'မင်္ဂလာပါခင်ဗျာ၊ ရှီဒါ ပါ။ ညီညာမျှတသော နေ့စဉ်စကားပြော အသံ ဖြစ်ပါတယ်။',
  },
  Gacrux: {
    name: 'Gacrux',
    myanmarName: 'ဂက်ခရတ်စ်',
    gender: 'male',
    toneTitle: 'Mature (ရင့်ကျက် တည်ကြည်သော အသံ)',
    geminiVoice: 'Orpheus',
    desc: 'Mature male voice',
    sampleGreeting: 'မင်္ဂလာပါခင်ဗျာ၊ ဂက်ခရတ်စ် ပါ။ ရင့်ကျက်တည်ကြည်သော အသံ ဖြစ်ပါတယ်။',
  },
  Pulcherrima: {
    name: 'Pulcherrima',
    myanmarName: 'ပယ်လ်ချယ်ရီမာ',
    gender: 'female',
    toneTitle: 'Forward (ရှေ့ရောက် တက်ကြွသော အသံ)',
    geminiVoice: 'Kore',
    desc: 'Forward female voice',
    sampleGreeting: 'မင်္ဂလာပါရှင်၊ ပယ်လ်ချယ်ရီမာ ပါ။ တက်ကြွရှေ့ရောက်သော အသံ ဖြစ်ပါတယ်။',
  },
  Achird: {
    name: 'Achird',
    myanmarName: 'အာချာ့ဒ်',
    gender: 'male',
    toneTitle: 'Friendly (ဖော်ရွေ ရင်းနှီးသော အသံ)',
    geminiVoice: 'Fenrir',
    desc: 'Friendly male voice',
    sampleGreeting: 'မင်္ဂလာပါခင်ဗျာ၊ အာချာ့ဒ် ပါ။ ဖော်ရွေရင်းနှီးသော အသံ ဖြစ်ပါတယ်။',
  },
  Zubenelgenubi: {
    name: 'Zubenelgenubi',
    myanmarName: 'ဇူဘီနယ်ဂျီနူဘီ',
    gender: 'male',
    toneTitle: 'Casual (ပေါ့ပါး ရိုးရှင်းသော အသံ)',
    geminiVoice: 'Puck',
    desc: 'Casual male voice',
    sampleGreeting: 'မင်္ဂလာပါခင်ဗျာ၊ ဇူဘီနယ်ဂျီနူဘီ ပါ။ ပေါ့ပါးရိုးရှင်းသော အသံ ဖြစ်ပါတယ်။',
  },
  Vindemiatrix: {
    name: 'Vindemiatrix',
    myanmarName: 'ဗင်ဒီမီယာထရစ်ဇ်',
    gender: 'female',
    toneTitle: 'Gentle (နူးညံ့သိမ်မွေ့သော အသံ)',
    geminiVoice: 'Aoede',
    desc: 'Gentle female voice',
    sampleGreeting: 'မင်္ဂလာပါရှင်၊ ဗင်ဒီမီယာထရစ်ဇ် ပါ။ နူးညံ့သိမ်မွေ့သော အသံ ဖြစ်ပါတယ်။',
  },
  Sadachbia: {
    name: 'Sadachbia',
    myanmarName: 'ဆာဒက်ဘီယာ',
    gender: 'female',
    toneTitle: 'Lively (သွက်လက် ပျော်ရွှင်သော အသံ)',
    geminiVoice: 'Zephyr',
    desc: 'Lively female voice',
    sampleGreeting: 'မင်္ဂလာပါရှင်၊ ဆာဒက်ဘီယာ ပါ။ သွက်လက်ပျော်ရွှင်သော အသံ ဖြစ်ပါတယ်။',
  },
  Sadaltager: {
    name: 'Sadaltager',
    myanmarName: 'ဆာဒယ်လ်တေဂါ',
    gender: 'male',
    toneTitle: 'Knowledgeable (ဗဟုသုတကြွယ်ဝ ကျွမ်းကျင်သော အသံ)',
    geminiVoice: 'Orpheus',
    desc: 'Knowledgeable male voice',
    sampleGreeting: 'မင်္ဂလာပါခင်ဗျာ၊ ဆာဒယ်လ်တေဂါ ပါ။ ဗဟုသုတကြွယ်ဝသော အသံ ဖြစ်ပါတယ်။',
  },
};

let currentTtsKeyIndex = 0;

// AudioContext singleton for decoding and trimming
let audioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Direct browser call to Google Gemini TTS REST API (gemini-3.8-flash-tts / gemini-3.8-flash-lite-tts).
 * Works on Netlify, GitHub Pages, Mobile, and Static SPA deployments without requiring an Express server.
 */
export async function fetchDirectGeminiTtsRest(
  text: string,
  voice: VoiceOption,
  apiKey?: string
): Promise<ArrayBuffer> {
  const profile = VOICE_PROFILES[voice] || VOICE_PROFILES.Thiha;
  const geminiVoice = profile.geminiVoice || 'Puck';

  const keys = loadGeminiKeys();
  const cleanUserKey = apiKey ? apiKey.trim().replace(/[^\x21-\x7E]/g, '') : undefined;
  const poolKeys = keys
    .map((k) => (k && k.key ? k.key.trim().replace(/[^\x21-\x7E]/g, '') : ''))
    .filter((k) => k.length >= 10);

  const candidateKeys = [cleanUserKey, ...poolKeys].filter(Boolean) as string[];

  if (candidateKeys.length === 0) {
    throw new Error('Gemini API Key မရှိသေးပါ။ ကျေးဇူးပြု၍ API Settings တွင် Google Gemini API Key ထည့်သွင်းပေးပါ။');
  }

  const candidateModels = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'];
  let lastErrMessage = '';

  for (const keyToUse of candidateKeys) {
    for (const model of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(keyToUse)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': keyToUse,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: geminiVoice,
                  },
                },
              },
            },
          }),
        });

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
          if (inlineData && inlineData.data) {
            const base64Str = inlineData.data;
            const binaryStr = atob(base64Str);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            if (bytes.buffer && bytes.buffer.byteLength > 100) {
              return bytes.buffer;
            }
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          lastErrMessage = errData.error?.message || `HTTP ${res.status}`;
        }
      } catch (netErr: any) {
        lastErrMessage = netErr?.message || 'Network error';
      }
    }
  }

  throw new Error(`Gemini TTS Direct Call Error: ${lastErrMessage || 'Failed to generate audio'}`);
}

/**
 * Synthesize authentic Myanmar speech with multi-key rotation and automatic 429 quota handling.
 * Prioritizes Gemini Flagship Neural Voice Model for 100% lifelike human realism.
 */
export async function synthesizeMyanmarVoice(
  text: string,
  options: TtsOptions = { voice: 'Thiha', style: 'conversational', trimSilence: false }
): Promise<{ audioUrl: string; duration: number; isRealityGemini: boolean }> {
  let arrayBuffer: ArrayBuffer | null = null;
  let lastErrorMsg = '';
  let isRealityGemini = false;

  const profile = VOICE_PROFILES[options.voice] || VOICE_PROFILES.Thiha;
  const style = options.style || 'conversational';

  const isNetlifyOrStatic = typeof window !== 'undefined' && (
    window.location.hostname.includes('netlify.app') ||
    window.location.hostname.includes('github.io') ||
    (!window.location.hostname.includes('localhost') && !window.location.hostname.includes('run.app') && !window.location.hostname.includes('127.0.0.1'))
  );

  // 1. PRIMARY: Direct Gemini REST TTS (if running on Netlify/static hosting)
  if (isNetlifyOrStatic && !options.forceBackup) {
    try {
      if (options.onStatusUpdate) {
        options.onStatusUpdate(`✨ Reality Human Voice (${profile.name} - ${profile.myanmarName}) ဖြင့် သဘာဝကျကျ အသံထုတ်လုပ်နေပါသည်...`);
      }
      const directBuf = await fetchDirectGeminiTtsRest(text, options.voice);
      if (directBuf && directBuf.byteLength > 100) {
        arrayBuffer = directBuf;
        isRealityGemini = true;
      }
    } catch (directErr: any) {
      console.warn('Direct Gemini TTS notice:', directErr);
      lastErrorMsg = directErr.message || lastErrorMsg;
    }
  }

  // 2. SECONDARY: Server Proxy endpoint (if running on full-stack server and direct wasn't attempted or failed)
  if (!arrayBuffer && !options.forceBackup) {
    let keys = loadGeminiKeys();
    const activeKeys = keys.filter((k) => k.status === 'active');
    const availableKeys = activeKeys.length > 0 ? activeKeys : keys;
    const maxAttempts = Math.max(1, availableKeys.length);
    let attempts = 0;

    // Loop through keys if available
    while (attempts < maxAttempts) {
      const currentKey = availableKeys.length > 0 ? availableKeys[currentTtsKeyIndex % availableKeys.length] : null;
      if (availableKeys.length > 0) {
        currentTtsKeyIndex = (currentTtsKeyIndex + 1) % availableKeys.length;
      }
      attempts++;

      if (options.onStatusUpdate) {
        const keyLabel = currentKey ? ` (Key: ${currentKey.name})` : '';
        options.onStatusUpdate(`✨ Reality Human Voice (${profile.name} - ${profile.myanmarName})${keyLabel} ဖြင့် သဘာဝကျကျ အသံထုတ်လုပ်နေပါသည်...`);
      }

      try {
        const res = await fetch('/api/tts/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            voice: options.voice,
            style,
            speed: options.speed,
            apiKey: currentKey ? currentKey.key : undefined,
          }),
        });

        const contentType = res.headers.get('content-type') || '';
        if (res.ok && !contentType.includes('text/html')) {
          const buf = await res.arrayBuffer();
          if (buf && buf.byteLength > 200) {
            arrayBuffer = buf;
            isRealityGemini = true;

            if (currentKey) {
              currentKey.callCount = (currentKey.callCount || 0) + 1;
              currentKey.status = 'active';
              currentKey.lastUsed = new Date().toLocaleTimeString();
              currentKey.lastError = undefined;
              saveGeminiKeys(keys);
            }
            break;
          }
        } else {
          if (contentType.includes('text/html')) {
            break; // Skip server retries if Netlify returned HTML redirect
          }
        }

        const errJson = await res.json().catch(() => ({}));
        const errText = errJson.error || `HTTP ${res.status}`;
        lastErrorMsg = errText;
      } catch (err: any) {
        lastErrorMsg = err.message;
      }
    }

    // Also try server-side default key if user keys failed and not HTML redirect
    if (!arrayBuffer && !isNetlifyOrStatic) {
      try {
        if (options.onStatusUpdate) {
          options.onStatusUpdate(`✨ Studio Reality Voice (${profile.name}) ဖြင့် အသံထုတ်လုပ်နေပါသည်...`);
        }
        const serverRes = await fetch('/api/tts/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            voice: options.voice,
            style,
            speed: options.speed,
          }),
        });

        const contentType = serverRes.headers.get('content-type') || '';
        if (serverRes.ok && !contentType.includes('text/html')) {
          const buf = await serverRes.arrayBuffer();
          if (buf && buf.byteLength > 200) {
            arrayBuffer = buf;
            isRealityGemini = true;
          }
        }
      } catch (err: any) {
        lastErrorMsg = err.message;
      }
    }
  }

  // 3. TERTIARY DIRECT FALLBACK: If arrayBuffer is still empty, call Direct Gemini REST TTS
  if (!arrayBuffer) {
    try {
      if (options.onStatusUpdate) {
        options.onStatusUpdate(`✨ Direct Gemini Studio TTS (${profile.name}) ဖြင့် အသံထုတ်လုပ်နေပါသည်...`);
      }
      const directBuf = await fetchDirectGeminiTtsRest(text, options.voice);
      if (directBuf && directBuf.byteLength > 100) {
        arrayBuffer = directBuf;
        isRealityGemini = true;
      }
    } catch (directErr: any) {
      lastErrorMsg = directErr.message || lastErrorMsg;
    }
  }

  if (!arrayBuffer || arrayBuffer.byteLength < 50) {
    throw new Error(
      `အသံထုတ်လုပ်၍ မရသေးပါ။ ကျေးဇူးပြု၍ API Settings တွင် Gemini API Key ရှိမရှိ စစ်ဆေးပေးပါ (${lastErrorMsg || 'Unknown Error'})`
    );
  }

  // Decode audio data via Web Audio API (Full 24kHz Studio Fidelity)
  const ctx = getAudioContext();
  let decodedBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

  // Only trim if explicitly requested, but preserve natural sentence pauses up to 0.85s and protect word endings
  if (options.trimSilence === true) {
    decodedBuffer = trimAudioSilence(decodedBuffer, ctx, 0.85, 0.002);
  }

  // Clean trailing static/buzzing, apply soft cosine fade-in/out, and add clean silence padding
  decodedBuffer = cleanAndFadeAudioBuffer(decodedBuffer, ctx, 0.25);

  // Convert to playable WAV Blob URL
  const wavBlob = audioBufferToWav(decodedBuffer);
  const audioUrl = URL.createObjectURL(wavBlob);

  return {
    audioUrl,
    duration: decodedBuffer.duration,
    isRealityGemini,
  };
}

/**
 * Applies a gentle acoustic softening filter to smooth harsh metallic edges of fallback TTS.
 */
function applyAcousticSoftFilter(sourceBuffer: AudioBuffer, ctx: AudioContext): AudioBuffer {
  const numChannels = sourceBuffer.numberOfChannels;
  const length = sourceBuffer.length;
  const sampleRate = sourceBuffer.sampleRate;
  const output = ctx.createBuffer(numChannels, length, sampleRate);

  // Soft lowpass filter to remove metallic ringing above 6.5kHz
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * 6500);
  const alpha = dt / (rc + dt);

  for (let c = 0; c < numChannels; c++) {
    const input = sourceBuffer.getChannelData(c);
    const out = output.getChannelData(c);
    let prev = 0;

    for (let i = 0; i < length; i++) {
      prev = prev + alpha * (input[i] - prev);
      out[i] = prev;
    }
  }

  return output;
}

/**
 * Completely eliminates ending buzz ("jee-jee"), clicks, DC offset pops, and vocoder static:
 * 1. 60ms silent lead-in pre-padding so initial consonants/vowels ("မ", "သ", "ကျွန်") are NEVER clipped by browser Web Audio DAC initialization.
 * 2. Soft 8ms cosine fade-in on speech start to avoid pop clicks.
 * 3. Soft 50ms cosine S-curve fade-out at the tail down to exact 0.0 amplitude.
 * 4. Appends 250ms of pristine silence so browser decoders/timeline seek never clip the final syllable.
 */
function cleanAndFadeAudioBuffer(sourceBuffer: AudioBuffer, ctx: AudioContext, tailPadSeconds = 0.25): AudioBuffer {
  const sampleRate = sourceBuffer.sampleRate;
  const numChannels = sourceBuffer.numberOfChannels;
  const totalLength = sourceBuffer.length;
  if (totalLength <= 0) return sourceBuffer;

  const startPadSamples = Math.floor(0.06 * sampleRate); // 60ms lead-in pre-padding
  const tailPadSamples = Math.floor(tailPadSeconds * sampleRate); // 250ms tail silence
  const newLength = startPadSamples + totalLength + tailPadSamples;
  const output = ctx.createBuffer(numChannels, newLength, sampleRate);

  const fadeInSamples = Math.min(Math.floor(0.008 * sampleRate), Math.floor(totalLength / 4));
  const fadeOutSamples = Math.min(Math.floor(0.050 * sampleRate), Math.floor(totalLength / 2)); // 50ms smooth fade-out

  for (let c = 0; c < numChannels; c++) {
    const src = sourceBuffer.getChannelData(c);
    const dest = output.getChannelData(c);

    // Copy voice samples starting at 60ms offset
    dest.set(src, startPadSamples);

    const speechStart = startPadSamples;
    const speechEnd = startPadSamples + totalLength;

    // 1. Smooth Cosine Fade-in (8ms) on speech start
    for (let i = 0; i < fadeInSamples; i++) {
      const gain = 0.5 * (1 - Math.cos((Math.PI * i) / fadeInSamples));
      dest[speechStart + i] *= gain;
    }

    // 2. Smooth Cosine Fade-out (50ms) to eliminate trailing buzz / "jee-jee" / vocoder cutoff clicks
    const fadeOutStart = speechEnd - fadeOutSamples;
    for (let i = 0; i < fadeOutSamples; i++) {
      const idx = fadeOutStart + i;
      const progress = i / fadeOutSamples;
      // Cosine S-curve from 1.0 down to 0.0
      const gain = 0.5 * (1 + Math.cos(Math.PI * progress));
      dest[idx] *= gain;
    }

    // 3. Ensure exact zero at voice end
    dest[speechEnd - 1] = 0;
  }

  return output;
}

/**
 * Trims silence periods that exceed maxPauseSeconds down to maxPauseSeconds,
 * with Hann window cross-fading at cut points to prevent audio clicks.
 * Preserves natural sentence breath pauses (up to 0.85s) and trailing word syllables.
 */
export function trimAudioSilence(
  sourceBuffer: AudioBuffer,
  ctx: AudioContext,
  maxPauseSeconds = 0.85,
  silenceThreshold = 0.002
): AudioBuffer {
  const sampleRate = sourceBuffer.sampleRate;
  const numChannels = sourceBuffer.numberOfChannels;
  const maxPauseSamples = Math.floor(maxPauseSeconds * sampleRate);
  const releasePadSamples = Math.floor(0.2 * sampleRate); // 200ms speech tail protection

  const channelData = sourceBuffer.getChannelData(0);
  const totalSamples = channelData.length;

  const keepRanges: Array<{ start: number; end: number }> = [];
  let inSilence = false;
  let silenceStart = 0;
  let activeStart = 0;

  for (let i = 0; i < totalSamples; i++) {
    const amp = Math.abs(channelData[i]);
    const isQuiet = amp < silenceThreshold;

    if (isQuiet) {
      if (!inSilence) {
        inSilence = true;
        silenceStart = i;
      }
    } else {
      if (inSilence) {
        inSilence = false;
        const silenceDuration = i - silenceStart;
        if (silenceDuration > maxPauseSamples) {
          const endPoint = Math.min(silenceStart + maxPauseSamples, i);
          if (endPoint > activeStart) {
            keepRanges.push({ start: activeStart, end: endPoint });
          }
          // Prevent overlapping chunks: start must never be before endPoint
          activeStart = Math.max(endPoint, i - releasePadSamples);
        }
      }
    }
  }

  if (activeStart < totalSamples) {
    keepRanges.push({ start: activeStart, end: totalSamples });
  }

  const totalKeptSamples = keepRanges.reduce((acc, r) => acc + (r.end - r.start), 0);

  if (totalKeptSamples <= 0 || totalKeptSamples === totalSamples) {
    return sourceBuffer;
  }

  const newBuffer = ctx.createBuffer(numChannels, totalKeptSamples, sampleRate);
  const fadeLength = Math.min(256, Math.floor(sampleRate * 0.008)); // 8ms Hann crossfade

  for (let c = 0; c < numChannels; c++) {
    const src = sourceBuffer.getChannelData(c);
    const dest = newBuffer.getChannelData(c);
    let destOffset = 0;

    for (const r of keepRanges) {
      const len = r.end - r.start;
      dest.set(src.subarray(r.start, r.end), destOffset);

      // Hann fade-in at chunk start
      for (let f = 0; f < fadeLength && destOffset + f < totalKeptSamples; f++) {
        const gain = 0.5 * (1 - Math.cos((Math.PI * f) / fadeLength));
        dest[destOffset + f] *= gain;
      }

      // Hann fade-out at chunk end
      for (let f = 0; f < fadeLength && destOffset + len - 1 - f >= destOffset; f++) {
        const gain = 0.5 * (1 - Math.cos((Math.PI * f) / fadeLength));
        dest[destOffset + len - 1 - f] *= gain;
      }

      destOffset += len;
    }
  }

  return newBuffer;
}

/**
 * Converts an AudioBuffer into a WAV Blob
 */
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const dataLength = buffer.length * blockAlign;
  const bufferLength = 44 + dataLength;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = buffer.getChannelData(c)[i];
      sample = Math.max(-1, Math.min(1, sample));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
