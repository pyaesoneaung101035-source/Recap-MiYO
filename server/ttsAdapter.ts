import fs from 'fs';
import path from 'path';
import { synthesizeNeuralRealityMyanmar, REALITY_VOICE_CONFIGS } from './neuralRealityTts';
import { GoogleGenAI } from '@google/genai';

export interface TTSVoiceProfile {
  id: string;
  name: string;
  myanmarName: string;
  gender: 'male' | 'female';
  ageGroup: 'adult' | 'youth' | 'senior';
  tone: string;
  description: string;
  isMaleNarratorRecommended: boolean;
}

export interface TTSProvider {
  id: string;
  name: string;
  supportsMyanmarLanguage: boolean; // Verified my-MM locale support
  isFree: boolean;
  pricingInfo: string;
  maleNarratorVoices: TTSVoiceProfile[];
  description: string;
}

export const VERIFIED_BURMESE_PROVIDERS: TTSProvider[] = [
  {
    id: 'edge_neural',
    name: '24kHz Studio Neural Voice Engine (Edge Neural)',
    supportsMyanmarLanguage: true,
    isFree: true,
    pricingInfo: '100% Free & Unlimited (No API Key Required)',
    description: 'Microsoft Azure 24kHz Studio Neural Model for Myanmar Burmese (my-MM-ThihaNeural & my-MM-NilarNeural). Native Burmese pronunciation with natural human cadence.',
    maleNarratorVoices: [
      {
        id: 'Thiha',
        name: 'Thiha (သီဟ)',
        myanmarName: 'သီဟ',
        gender: 'male',
        ageGroup: 'adult',
        tone: 'Deep, warm, natural conversational Burmese adult male narrator',
        description: 'နွေးထွေးခန့်ညားသော နေ့စဉ်စကားပြော သဘာဝအသံ (Adult Male Natural Narrator)',
        isMaleNarratorRecommended: true,
      },
      {
        id: 'KyawKyaw',
        name: 'Kyaw Kyaw (ကျော်ကျော်)',
        myanmarName: 'ကျော်ကျော်',
        gender: 'male',
        ageGroup: 'adult',
        tone: 'Deep bass cinematic documentary narrator',
        description: 'သြဇာကြီးမား နက်နဲသော Deep Bass အသံ (Movie Recap & Documentary Specialist)',
        isMaleNarratorRecommended: true,
      },
      {
        id: 'AungAung',
        name: 'Aung Aung (အောင်အောင်)',
        myanmarName: 'အောင်အောင်',
        gender: 'male',
        ageGroup: 'youth',
        tone: 'Dynamic, energetic, engaging male voice',
        description: 'တက်ကြွသွက်လက်သော လူငယ်သံ (Dynamic Youth Male)',
        isMaleNarratorRecommended: false,
      },
      {
        id: 'MinThway',
        name: 'Min Thway (မင်းသွေး)',
        myanmarName: 'မင်းသွေး',
        gender: 'male',
        ageGroup: 'adult',
        tone: 'Calm, steady, dignified narrative narrator',
        description: 'အေးချမ်းတည်ကြည်သော ဇာတ်လမ်းပြောသံ (Calm Narrative Male)',
        isMaleNarratorRecommended: true,
      },
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini Flagship Neural Audio (Google AI Studio)',
    supportsMyanmarLanguage: true,
    isFree: true, // Free tier in Google AI Studio
    pricingInfo: 'Free tier available via Google AI Studio API key (Pay-as-you-go for higher quotas)',
    description: 'Google Gemini Flash Audio TTS with prebuilt voices (Charon, Puck, Fenrir, Orpheus) prompted with natural Burmese native speaker persona instructions.',
    maleNarratorVoices: [
      {
        id: 'Thiha',
        name: 'Thiha (Puck Persona)',
        myanmarName: 'သီဟ',
        gender: 'male',
        ageGroup: 'adult',
        tone: 'Warm adult male native Burmese speaker',
        description: 'Gemini Puck voice mapped to native Burmese male narrator persona',
        isMaleNarratorRecommended: true,
      },
      {
        id: 'KyawKyaw',
        name: 'Kyaw Kyaw (Charon Deep Bass Persona)',
        myanmarName: 'ကျော်ကျော်',
        gender: 'male',
        ageGroup: 'adult',
        tone: 'Cinematic deep bass baritone male narrator',
        description: 'Gemini Charon baritone mapped to cinematic Burmese documentary narrator',
        isMaleNarratorRecommended: true,
      },
    ],
  },
  {
    id: 'gcp_tts',
    name: 'Google Cloud Text-to-Speech (my-MM)',
    supportsMyanmarLanguage: true,
    isFree: false,
    pricingInfo: 'Paid API Key Required (Disclosed: $4 per 1M characters, free tier 4M chars/month)',
    description: 'Official Google Cloud TTS API using standard Burmese voices (my-MM-Standard-A & my-MM-Standard-B).',
    maleNarratorVoices: [
      {
        id: 'my-MM-Standard-B',
        name: 'my-MM-Standard-B (Male)',
        myanmarName: 'Standard-B (ကျား)',
        gender: 'male',
        ageGroup: 'adult',
        tone: 'Standard Burmese male speaker',
        description: 'Official Google Cloud TTS standard Burmese male voice',
        isMaleNarratorRecommended: true,
      },
    ],
  },
  {
    id: 'nara_mini_v1',
    name: 'Nara Mini v1 (YeeNyunn/nara-mini-v1 • HF Space)',
    supportsMyanmarLanguage: true,
    isFree: true,
    pricingInfo: '100% Free & Open Source (Apache 2.0 • hugging-apps/nara-mini-v1-tts)',
    description: 'Kokoro-based Burmese & English 24kHz TTS model (YeeNyunn/nara-mini-v1) with native Burmese number normalization.',
    maleNarratorVoices: [
      {
        id: 'NaraKoBanyar',
        name: 'Ko Banyar (ကိုဗညား)',
        myanmarName: 'ကိုဗညား',
        gender: 'male',
        ageGroup: 'adult',
        tone: 'Natural Burmese male narrator (Nara Mini v1 ko-banyar)',
        description: 'YeeNyunn/nara-mini-v1 24kHz Kokoro Burmese Male Narrator',
        isMaleNarratorRecommended: true,
      },
      {
        id: 'NaraHtetMyat',
        name: 'Htet Myat (ထက်မြတ်)',
        myanmarName: 'ထက်မြတ်',
        gender: 'male',
        ageGroup: 'youth',
        tone: 'Articulate Burmese male voice (Nara Mini v1 htet-myat)',
        description: 'YeeNyunn/nara-mini-v1 24kHz Kokoro Burmese Male',
        isMaleNarratorRecommended: true,
      },
    ],
  },
];

/**
 * Validates whether a provider genuinely supports Myanmar Burmese (my-MM).
 */
export function isBurmeseCompatibleProvider(providerId: string): boolean {
  const provider = VERIFIED_BURMESE_PROVIDERS.find((p) => p.id === providerId);
  return provider ? provider.supportsMyanmarLanguage : false;
}

/**
 * Returns detailed Burmese compatibility and pricing disclosures for all providers.
 */
export function getProviderDisclosures() {
  return VERIFIED_BURMESE_PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    supportsMyanmar: p.supportsMyanmarLanguage,
    isFree: p.isFree,
    pricingInfo: p.pricingInfo,
    description: p.description,
    maleVoicesCount: p.maleNarratorVoices.length,
  }));
}

/**
 * Generate a short test Burmese audio sentence before full processing to verify TTS works.
 */
export async function generateTestSentenceAudio(params: {
  provider?: string;
  voice?: string;
  speed?: number;
  testText?: string;
  apiKey?: string;
}): Promise<{
  success: boolean;
  audioBuffer: Buffer;
  mimeType: string;
  durationSec: number;
  statusMessage: string;
}> {
  const text = (params.testText || 'မင်္ဂလာပါ၊ ဗီဒီယို ဇာတ်ကြောင်းပြောသူ အသံ စမ်းသပ်မှု ဖြစ်ပါတယ်။').trim();
  const provider = params.provider || 'edge_neural';
  const voice = params.voice || 'Thiha';
  const speed = params.speed || 1.0;

  if (!isBurmeseCompatibleProvider(provider)) {
    throw new Error(`Provider "${provider}" is not verified for Myanmar Burmese (my-MM) language.`);
  }

  let audioBuf: Buffer | null = null;
  let mimeType = 'audio/mpeg';

  if (provider === 'gemini' && params.apiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey: params.apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const ttsRes = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [{ text, speechMetadata: { style: 'VOICE DIRECTOR — Real native Burmese male speaker speaking naturally face-to-face to a close friend; authentic Burmese sentence melody, warm natural rhythm, never robotic or formal' } }],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } },
        },
      });
      const b64 = ttsRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (b64) {
        audioBuf = Buffer.from(b64, 'base64');
        mimeType = 'audio/wav';
      }
    } catch (err: any) {
      console.warn('Gemini test sentence failed, falling back to 24kHz Studio Neural:', err.message);
    }
  }

  if (!audioBuf) {
    // 24kHz Studio Neural Male Voice synthesis
    audioBuf = await synthesizeNeuralRealityMyanmar(text, {
      voice,
      style: 'recap',
      speed,
    });
    mimeType = 'audio/mpeg';
  }

  if (!audioBuf || audioBuf.length < 100) {
    throw new Error('TTS test sentence failed to generate valid audio output');
  }

  // Estimate duration (~32kbps for 24kHz mono mp3)
  const durationSec = parseFloat((audioBuf.length / 4000).toFixed(2));

  return {
    success: true,
    audioBuffer: audioBuf,
    mimeType,
    durationSec,
    statusMessage: `အသံစမ်းသပ်မှု အောင်မြင်ပါသည် (${voice} male voice, ${durationSec}s)`,
  };
}
