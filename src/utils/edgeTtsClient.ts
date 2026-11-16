/**
 * High-Quality Realistic Myanmar Voice Synthesis Studio
 * Powered by Gemini Flagship Neural Voice Models (gemini-3.8-flash-lite-tts & gemini-3.8-flash-tts)
 * with Multi-Key Rotation, Human Vocal Expression Presets, and Smooth Fallback.
 */

import { VoiceOption, VoiceToneOption, TtsEngineMode } from '../types';
import { loadGeminiKeys, saveGeminiKeys } from './geminiPool';
import { generateOfflineWebAudioSpeech } from './webAudioTts';
import { MINUTE_BLOCK_SECONDS } from './timingSync';

export type VoiceStyle = 'conversational' | 'recap' | 'broadcast' | 'energetic' | 'soothing' | 'affectionate';

export interface VoiceTonePreset {
  id: VoiceToneOption;
  label: string;
  myanmarLabel: string;
  pitchPct: number;
  badge: string;
}

export const VOICE_TONE_PRESETS: VoiceTonePreset[] = [
  { id: 'natural', label: 'Natural', myanmarLabel: 'သဘာဝအတိုင်း (ပုံမှန်)', pitchPct: 0, badge: '🎙️ 0%' },
  { id: 'warm', label: 'Warm & Rich', myanmarLabel: 'နွေးထွေးကြင်နာ', pitchPct: -2, badge: '☕ -2%' },
  { id: 'deep', label: 'Deep Bass', myanmarLabel: 'နက်နဲသြဇာရှိ', pitchPct: -8, badge: '🎬 -8%' },
  { id: 'bright', label: 'Bright & Clear', myanmarLabel: 'ကြည်လင်တောက်ပ', pitchPct: 6, badge: '✨ +6%' },
  { id: 'calm', label: 'Calm & Steady', myanmarLabel: 'အေးချမ်းတည်ငြိမ်', pitchPct: -4, badge: '🍃 -4%' },
  { id: 'dramatic', label: 'Dramatic Recap', myanmarLabel: 'ဇာတ်ရှိန်တင်', pitchPct: -3, badge: '🎭 -3%' },
  { id: 'soft', label: 'Soft & Gentle', myanmarLabel: 'နူးညံ့သိမ်မွေ့', pitchPct: 2, badge: '🕊️ +2%' },
];

export interface TtsOptions {
  voice: VoiceOption;
  style?: VoiceStyle;
  tone?: VoiceToneOption;
  pitchOffset?: number; // Fine pitch adjustment in % (-15 to +15)
  emotion?: string; // Expressive vocal emotion cue (e.g. 'surprised, amazed', 'mocking', 'determined')
  rate?: string; // e.g. '+0%', '+10%'
  speed?: number; // e.g. 0.5 to 2.0
  pitch?: string; // e.g. '+0Hz', '-5Hz'
  trimSilence?: boolean; // cut pauses > 0.25s down to 0.25s
  forceBackup?: boolean;
  preferredEngine?: TtsEngineMode;
  onStatusUpdate?: (status: string) => void;
}

export interface VoiceProfile {
  name: string;
  myanmarName: string;
  gender: 'male' | 'female';
  toneTitle: string;
  geminiVoice: string; // Prebuilt Gemini voice (Charon, Puck, Fenrir, etc.)
  naraVoiceId?: 'ko-banyar' | 'htet-myat' | 'shoon' | 'thazin'; // Nara Mini v1 preset ID
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

  // 4 NATIVE BURMESE NARA MINI v1 VOICES (YeeNyunn/nara-mini-v1 • Kokoro 24kHz)
  NaraKoBanyar: {
    name: 'Ko Banyar (Nara v1)',
    myanmarName: 'ကိုဗညား',
    gender: 'male',
    toneTitle: '🤗 Nara Mini v1 Native Male Narrator (ko-banyar • 24kHz Kokoro)',
    geminiVoice: 'Charon',
    naraVoiceId: 'ko-banyar',
    desc: 'YeeNyunn/nara-mini-v1 ko-banyar — Free Hugging Face Kokoro Burmese Male',
    sampleGreeting: 'မင်္ဂလာပါခင်ဗျာ၊ ကျွန်တော် ကိုဗညား ပါ။ Nara Mini v1 မြန်မာ ဇာတ်ကြောင်းပြော အသံဖြစ်ပါတယ်။',
  },
  NaraHtetMyat: {
    name: 'Htet Myat (Nara v1)',
    myanmarName: 'ထက်မြတ်',
    gender: 'male',
    toneTitle: '🤗 Nara Mini v1 Dynamic Youth Male (htet-myat • 24kHz Kokoro)',
    geminiVoice: 'Puck',
    naraVoiceId: 'htet-myat',
    desc: 'YeeNyunn/nara-mini-v1 htet-myat — Free Hugging Face Kokoro Burmese Male',
    sampleGreeting: 'မင်္ဂလာပါခင်ဗျာ၊ ကျွန်တော် ထက်မြတ် ပါ။ Nara Mini v1 ကြည်လင်ပြတ်သားတဲ့ မြန်မာအသံ ဖြစ်ပါတယ်။',
  },
  NaraShoon: {
    name: 'Shoon (Nara v1)',
    myanmarName: 'ရွှန်း',
    gender: 'female',
    toneTitle: '🤗 Nara Mini v1 Clear Female Narrator (shoon • 24kHz Kokoro)',
    geminiVoice: 'Kore',
    naraVoiceId: 'shoon',
    desc: 'YeeNyunn/nara-mini-v1 shoon — Free Hugging Face Kokoro Burmese Female',
    sampleGreeting: 'မင်္ဂလာပါရှင်၊ ကျွန်မ ရွှန်း ပါ။ Nara Mini v1 သဘာဝကျတဲ့ မြန်မာအမျိုးသမီးအသံ ဖြစ်ပါတယ်။',
  },
  NaraThazin: {
    name: 'Thazin (Nara v1)',
    myanmarName: 'သဇင်',
    gender: 'female',
    toneTitle: '🤗 Nara Mini v1 Soft Storytelling Female (thazin • 24kHz Kokoro)',
    geminiVoice: 'Aoede',
    naraVoiceId: 'thazin',
    desc: 'YeeNyunn/nara-mini-v1 thazin — Free Hugging Face Kokoro Burmese Female',
    sampleGreeting: 'မင်္ဂလာပါရှင်၊ ကျွန်မ သဇင် ပါ။ Nara Mini v1 နူးညံ့ချိုသာတဲ့ မြန်မာအသံ ဖြစ်ပါတယ်။',
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
 * Direct browser call to Google Gemini TTS REST API.
 * Uses gemini-3.1-flash-tts-preview, gemini-3.8-flash-tts, and gemini-3.8-flash-lite-tts.
 * Works on Netlify, GitHub Pages, Mobile, and Static SPA deployments without requiring an Express server.
 */
export async function fetchDirectGeminiTtsRest(
  text: string,
  voice: VoiceOption,
  apiKey?: string,
  style: VoiceStyle = 'recap',
  emotion?: string,
  tone: VoiceToneOption = 'natural',
  pitchOffset = 0,
  preferredEngine: TtsEngineMode = 'auto'
): Promise<{ buffer: ArrayBuffer; engineUsed: 'gemini' | 'neural' | 'nara' }> {
  if (preferredEngine === 'nara') {
    const res = await fetch('/api/tts/nara', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, normalizeNumbers: true, pitchOffset }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Nara Mini v1 TTS error (HTTP ${res.status})`);
    }
    return { buffer: await res.arrayBuffer(), engineUsed: 'nara' };
  }

  const res = await fetch('/api/tts/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, style, tone, pitchOffset, emotion, apiKey, preferredEngine }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server TTS error (HTTP ${res.status})`);
  }
  const engineHeader = (res.headers.get('X-TTS-Engine') || '').toLowerCase();
  const engineUsed: 'gemini' | 'neural' = engineHeader.includes('gemini') ? 'gemini' : 'neural';
  return { buffer: await res.arrayBuffer(), engineUsed };
}

/**
 * Synthesize authentic Myanmar speech with multi-key rotation and single-engine locking
 * so all generated clips in a project keep ONE identical voice timbre.
 */
export async function synthesizeMyanmarVoice(
  text: string,
  options: TtsOptions = { voice: 'Thiha', style: 'recap', tone: 'natural', trimSilence: false }
): Promise<{ audioUrl: string; duration: number; isRealityGemini: boolean; engineUsed: 'gemini' | 'neural' | 'nara' }> {
  let arrayBuffer: ArrayBuffer | null = null;
  let lastErrorMsg = '';
  let isRealityGemini = false;
  let engineUsed: 'gemini' | 'neural' | 'nara' = 'neural';

  const profile = VOICE_PROFILES[options.voice] || VOICE_PROFILES.Thiha;
  const style = options.style || 'recap';
  const tone: VoiceToneOption = options.tone || 'natural';
  const pitchOffset = typeof options.pitchOffset === 'number' ? options.pitchOffset : 0;
  const emotion = options.emotion || '';
  const requestedNaraVoice = Boolean(profile.naraVoiceId);
  const preferredEngine: TtsEngineMode = options.forceBackup
    ? 'neural'
    : requestedNaraVoice
      ? 'nara'
      : (options.preferredEngine || 'auto');

  const isNetlifyOrStatic = typeof window !== 'undefined' && (
    window.location.hostname.includes('netlify.app') ||
    window.location.hostname.includes('github.io') ||
    (!window.location.hostname.includes('localhost') && !window.location.hostname.includes('run.app') && !window.location.hostname.includes('127.0.0.1'))
  );

  // 0. NARA MINI v1 ENGINE (Hugging Face YeeNyunn/nara-mini-v1 • hugging-apps/nara-mini-v1-tts)
  if (preferredEngine === 'nara') {
    if (options.onStatusUpdate) {
      options.onStatusUpdate(`🤗 Nara Mini v1 (${profile.name} - ${profile.myanmarName}) ဖြင့် အသံထုတ်လုပ်နေပါသည်...`);
    }
    try {
      const naraRes = await fetch('/api/tts/nara', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: profile.naraVoiceId || options.voice,
          normalizeNumbers: true,
          pitchOffset,
        }),
      });
      const contentType = naraRes.headers.get('content-type') || '';
      if (!naraRes.ok || contentType.includes('text/html') || contentType.includes('application/json')) {
        const errJson = await naraRes.json().catch(() => ({}));
        throw new Error(errJson.error || `Nara Mini v1 HTTP ${naraRes.status}`);
      }
      const naraBuf = await naraRes.arrayBuffer();
      if (!naraBuf || naraBuf.byteLength < 100) {
        throw new Error('Nara Mini v1 returned empty audio buffer');
      }
      arrayBuffer = naraBuf;
      engineUsed = 'nara';
      isRealityGemini = false;
    } catch (naraErr: any) {
      throw new Error(
        `Nara Mini v1 (HF Space) အသံထုတ်မရသေးပါ: ${naraErr?.message || 'Connection error'}။ ခေတ္တစောင့်ပြီး ထပ်စမ်းကြည့်ပါ။`
      );
    }
  }

  // 1. PRIMARY: Direct Gemini REST TTS (if running on Netlify/static hosting and not locked to neural/nara)
  if (!arrayBuffer && isNetlifyOrStatic && preferredEngine !== 'neural' && preferredEngine !== 'nara') {
    try {
      if (options.onStatusUpdate) {
        options.onStatusUpdate(`✨ Reality Human Voice (${profile.name} - ${profile.myanmarName}) ဖြင့် သဘာဝကျကျ အသံထုတ်လုပ်နေပါသည်...`);
      }
      const directRes = await fetchDirectGeminiTtsRest(
        text,
        options.voice,
        undefined,
        style,
        emotion,
        tone,
        pitchOffset,
        preferredEngine
      );
      if (directRes.buffer && directRes.buffer.byteLength > 100) {
        arrayBuffer = directRes.buffer;
        engineUsed = directRes.engineUsed;
        isRealityGemini = directRes.engineUsed === 'gemini';
      }
    } catch (directErr: any) {
      console.warn('Direct Gemini TTS notice:', directErr);
      lastErrorMsg = directErr.message || lastErrorMsg;
    }
  }

  // 2. SECONDARY: Server Proxy endpoint (if running on full-stack server and not locked to neural)
  if (!arrayBuffer && preferredEngine !== 'neural') {
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
            tone,
            pitchOffset,
            emotion,
            speed: options.speed,
            preferredEngine,
            apiKey: currentKey ? currentKey.key : undefined,
          }),
        });

        const contentType = res.headers.get('content-type') || '';
        const headerEngine = (res.headers.get('X-TTS-Engine') || '').toLowerCase();
        if (res.ok && !contentType.includes('text/html')) {
          const buf = await res.arrayBuffer();
          if (buf && buf.byteLength > 200) {
            arrayBuffer = buf;
            engineUsed = headerEngine.includes('gemini') ? 'gemini' : 'neural';
            isRealityGemini = engineUsed === 'gemini';

            if (currentKey && isRealityGemini) {
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
            tone,
            pitchOffset,
            emotion,
            speed: options.speed,
            preferredEngine,
          }),
        });

        const contentType = serverRes.headers.get('content-type') || '';
        const headerEngine = (serverRes.headers.get('X-TTS-Engine') || '').toLowerCase();
        if (serverRes.ok && !contentType.includes('text/html')) {
          const buf = await serverRes.arrayBuffer();
          if (buf && buf.byteLength > 200) {
            arrayBuffer = buf;
            engineUsed = headerEngine.includes('gemini') ? 'gemini' : 'neural';
            isRealityGemini = engineUsed === 'gemini';
          }
        }
      } catch (err: any) {
        lastErrorMsg = err.message;
      }
    }
  }

  // 3. TERTIARY FALLBACK / DIRECT NEURAL MODE: Call /api/tts/free directly (consistent 24kHz Myanmar Neural voice)
  if (!arrayBuffer) {
    try {
      if (options.onStatusUpdate) {
        options.onStatusUpdate(`✨ Neural Reality Studio (${profile.name}) ဖြင့် အသံထုတ်လုပ်နေပါသည်...`);
      }
      const freeRes = await fetch('/api/tts/free', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: options.voice,
          style,
          tone,
          pitchOffset,
          emotion,
          speed: options.speed || 1.0,
        }),
      });
      if (freeRes.ok && !(freeRes.headers.get('content-type') || '').includes('text/html')) {
        const freeBuf = await freeRes.arrayBuffer();
        if (freeBuf && freeBuf.byteLength > 200) {
          arrayBuffer = freeBuf;
          engineUsed = 'neural';
          isRealityGemini = false;
        }
      }
    } catch (freeErr: any) {
      lastErrorMsg = freeErr.message || lastErrorMsg;
    }
  }

  if (!arrayBuffer || arrayBuffer.byteLength < 50) {
    try {
      if (options.onStatusUpdate) {
        options.onStatusUpdate(`⚡ Studio Offline Voice Engine (${profile.name}) ဖြင့် အသံထုတ်လုပ်ပေးနေပါသည်...`);
      }
      arrayBuffer = await generateOfflineWebAudioSpeech(text, options.voice, options.speed);
      engineUsed = 'neural';
      isRealityGemini = false;
    } catch (offlineErr: any) {
      throw new Error(
        `အသံထုတ်လုပ်၍ မရသေးပါ။ ကျေးဇူးပြု၍ API Settings တွင် Gemini API Key ရှိမရှိ စစ်ဆေးပေးပါ (${lastErrorMsg || offlineErr?.message || 'Unknown Error'})`
      );
    }
  }

  let audioUrl = '';
  let duration = 3.0;

  try {
    const ctx = getAudioContext();
    let decodedBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

    // Strip excessive pure digital silence at head/tail while keeping 140ms safety tail
    decodedBuffer = trimEdgeDeadSilence(decodedBuffer, ctx, 0.0012, 0.03, 0.14);

    if (options.trimSilence === true) {
      decodedBuffer = trimAudioSilence(decodedBuffer, ctx, 0.85, 0.002);
    }
    decodedBuffer = cleanAndFadeAudioBuffer(decodedBuffer, ctx, 0.12);
    duration = decodedBuffer.duration;

    const wavBlob = audioBufferToWav(decodedBuffer);
    audioUrl = URL.createObjectURL(wavBlob);
  } catch (decodeErr) {
    console.warn('Web Audio decodeAudioData notice, fallback to direct Blob URL:', decodeErr);
    const header = new Uint8Array(arrayBuffer.slice(0, 4));
    const isRiff = header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46;
    const rawBlob = new Blob([arrayBuffer], { type: isRiff ? 'audio/wav' : 'audio/mpeg' });
    audioUrl = URL.createObjectURL(rawBlob);
  }

  return {
    audioUrl,
    duration,
    isRealityGemini,
    engineUsed,
  };
}

/**
 * Safely trims ONLY pure dead silence before the first spoken sample and after the last spoken sample.
 * Preserves 100% of spoken syllables with zero mid-speech cuts and keeps keepTailSec after last sound.
 */
function trimEdgeDeadSilence(
  sourceBuffer: AudioBuffer,
  ctx: AudioContext,
  threshold = 0.0012,
  keepLeadSec = 0.03,
  keepTailSec = 0.14
): AudioBuffer {
  const sampleRate = sourceBuffer.sampleRate;
  const numChannels = sourceBuffer.numberOfChannels;
  const totalLength = sourceBuffer.length;
  if (totalLength <= 0) return sourceBuffer;

  const ch0 = sourceBuffer.getChannelData(0);
  let firstAudible = 0;
  while (firstAudible < totalLength && Math.abs(ch0[firstAudible]) < threshold) {
    firstAudible++;
  }
  if (firstAudible >= totalLength) {
    return sourceBuffer;
  }

  let lastAudible = totalLength - 1;
  while (lastAudible > firstAudible && Math.abs(ch0[lastAudible]) < threshold) {
    lastAudible--;
  }

  const startIdx = Math.max(0, firstAudible - Math.floor(keepLeadSec * sampleRate));
  const endIdx = Math.min(totalLength, lastAudible + Math.floor(keepTailSec * sampleRate));
  const newLength = endIdx - startIdx;
  if (newLength <= 0 || (startIdx === 0 && endIdx === totalLength)) {
    return sourceBuffer;
  }

  const output = ctx.createBuffer(numChannels, newLength, sampleRate);
  for (let c = 0; c < numChannels; c++) {
    const src = sourceBuffer.getChannelData(c);
    output.getChannelData(c).set(src.subarray(startIdx, endIdx));
  }
  return output;
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
 * Adds short pre-padding and gentle 12ms fade-out at the end of the silence tail
 * so initial & final spoken consonants/vowels are 100% untouched.
 */
function cleanAndFadeAudioBuffer(sourceBuffer: AudioBuffer, ctx: AudioContext, tailPadSeconds = 0.12): AudioBuffer {
  const sampleRate = sourceBuffer.sampleRate;
  const numChannels = sourceBuffer.numberOfChannels;
  const totalLength = sourceBuffer.length;
  if (totalLength <= 0) return sourceBuffer;

  const startPadSamples = Math.floor(0.03 * sampleRate); // 30ms lead-in pre-padding
  const tailPadSamples = Math.floor(tailPadSeconds * sampleRate); // 120ms tail silence
  const newLength = startPadSamples + totalLength + tailPadSamples;
  const output = ctx.createBuffer(numChannels, newLength, sampleRate);

  const fadeInSamples = Math.min(Math.floor(0.006 * sampleRate), Math.floor(totalLength / 4));
  const fadeOutSamples = Math.min(Math.floor(0.015 * sampleRate), Math.floor(totalLength / 4)); // 15ms ultra-short tail smooth

  for (let c = 0; c < numChannels; c++) {
    const src = sourceBuffer.getChannelData(c);
    const dest = output.getChannelData(c);

    dest.set(src, startPadSamples);

    const speechStart = startPadSamples;
    const speechEnd = startPadSamples + totalLength;

    for (let i = 0; i < fadeInSamples; i++) {
      const gain = 0.5 * (1 - Math.cos((Math.PI * i) / fadeInSamples));
      dest[speechStart + i] *= gain;
    }

    const fadeOutStart = speechEnd - fadeOutSamples;
    for (let i = 0; i < fadeOutSamples; i++) {
      const idx = fadeOutStart + i;
      const progress = i / fadeOutSamples;
      const gain = 0.5 * (1 + Math.cos(Math.PI * progress));
      dest[idx] *= gain;
    }

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

/**
 * 1-Click Auto Narrator Voice Generation:
 * Automatically synthesizes Adult Male Narrator voice ("Thiha") for all segments,
 * and calculates pitch-preserving atempo rate so each segment matches the video timeline.
 */
export async function autoGenerateAllNarratorVoices(
  segments: import('../types').TranscriptSegment[],
  onProgress?: (message: string, current: number, total: number) => void,
  defaultVoice: VoiceOption = 'Thiha',
  tone: VoiceToneOption = 'natural',
  pitchOffset = 0
): Promise<import('../types').TranscriptSegment[]> {
  if (!segments || segments.length === 0) return [];
  const updated: import('../types').TranscriptSegment[] = [];
  const total = segments.length;
  let lockedBatchEngine: TtsEngineMode = (VOICE_PROFILES[defaultVoice]?.naraVoiceId ? 'nara' : 'auto');

  for (let i = 0; i < total; i++) {
    const seg = segments[i];
    const textToSpeak = (seg.myanmarTranslation || seg.originalText || '').trim();

    if (!textToSpeak) {
      updated.push(seg);
      continue;
    }

    if (onProgress) {
      onProgress(
        `🔊 [One-Click Narrator TTS] (${i + 1}/${total}) — တစ်သံတည်း (Single Voice) ထုတ်လုပ်နေပါသည်: "${textToSpeak.substring(0, 18)}..."`,
        i + 1,
        total
      );
    }

    try {
      const activeVoice = defaultVoice || 'Thiha';
      const result = await synthesizeMyanmarVoice(textToSpeak, {
        voice: activeVoice,
        style: seg.style || 'recap',
        tone: seg.tone || tone,
        pitchOffset: typeof seg.pitch === 'number' ? seg.pitch : pitchOffset,
        emotion: seg.emotion,
        preferredEngine: lockedBatchEngine,
      });
      if (lockedBatchEngine === 'auto') {
        lockedBatchEngine = result.engineUsed;
      }

      // Keep audio inside its 30-second part and before the next segment with gentle speed tuning (max 1.15x)
      const blockEnd = (Math.floor(Math.max(0, seg.startTime) / MINUTE_BLOCK_SECONDS) + 1) * MINUTE_BLOCK_SECONDS;
      const nextStartTime = (i < total - 1 && segments[i + 1])
        ? Math.min(blockEnd, segments[i + 1].startTime)
        : blockEnd;
      const availableTime = Math.max(0.5, nextStartTime - seg.startTime - 0.08);
      const audioDur = result.duration;

      let rate = 1.0;
      if (audioDur > availableTime) {
        rate = Math.min(audioDur / availableTime, 1.15); // Gentle narrator speed adjustment max 1.15x
      }
      const atempo = parseFloat(Math.max(0.9, rate).toFixed(2));

      updated.push({
        ...seg,
        audioUrl: result.audioUrl,
        audioDuration: audioDur,
        atempoRate: atempo,
        playbackRate: atempo,
        voice: activeVoice,
        speaker: 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
        minutePartIndex: Math.floor(Math.max(0, seg.startTime) / MINUTE_BLOCK_SECONDS) + 1,
      });
    } catch (err) {
      console.warn(`Voice synthesis notice for segment #${i + 1}:`, err);
      updated.push(seg);
    }
  }

  return updated;
}
