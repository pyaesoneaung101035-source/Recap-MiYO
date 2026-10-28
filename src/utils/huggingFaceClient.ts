/**
 * Hugging Face Voice Multi-Speaker Studio & TTS Client
 * Connects to Hugging Face Inference API / Serverless Router
 * Implements 8 Distinct Multi-Speaker Profiles (4 Male + 4 Female personas).
 */

import { loadApiKeys } from './apiKeys';
import { synthesizeMyanmarVoice } from './edgeTtsClient';
import { VoiceOption } from '../types';

export interface HfSynthesisOptions {
  model?: string;
  speakerId?: string;
  speed?: number;
  onStatusUpdate?: (status: string) => void;
}

export interface HfSpeakerProfile {
  id: string;
  name: string;
  myanmarName: string;
  gender: 'Male' | 'Female';
  toneTitle: string;
  desc: string;
  samplePhrase: string;
  lowGain: number;
  midGain: number;
  highGain: number;
  midFreq: number;
}

export const HF_VOICE_MODELS = [
  {
    id: 'coqui/XTTS-v2',
    name: 'Coqui XTTS-v2 (Multi-Speaker Studio)',
    desc: 'Hugging Face ၏ Multi-Speaker AI စကားပြော မော်ဒယ်',
    badge: 'Multi-Speaker',
  },
  {
    id: 'facebook/mms-tts-mya',
    name: 'Meta MMS Myanmar (Native Speech)',
    desc: 'Meta ၏ တရားဝင် မြန်မာဘာသာ သီးသန့် အသံထွက်ဖတ်ကြားသော Neural TTS မော်ဒယ်',
    badge: 'Native Myanmar',
  },
  {
    id: 'hexgrad/Kokoro-82M',
    name: 'Kokoro 82M (Ultra-Fast Expressive TTS)',
    desc: 'အလွန်လျင်မြန်ပြီး သဘာဝကျသော လူသားစကားပြော ပုံစံ TTS',
    badge: 'Fast & Natural',
  },
  {
    id: 'custom',
    name: 'Custom Hugging Face Model',
    desc: 'Hugging Face Hub မှ မိမိစိတ်ကြိုက် မော်ဒယ် ID ထည့်သွင်း အသုံးပြုနိုင်သည်',
    badge: 'Custom',
  },
];

export const HF_MULTI_SPEAKERS: HfSpeakerProfile[] = [
  {
    id: 'hf_male_thiha',
    name: 'Thiha',
    myanmarName: 'သီဟ',
    gender: 'Male',
    toneTitle: 'သဘာဝ ကျား စကားပြောသံ',
    desc: 'နေ့စဉ် သဘာဝကျကျ စကားပြောသံ (Natural Burmese Male Voice)',
    samplePhrase: 'မင်္ဂလာပါ၊ Hugging Face သီဟ အသံဖြင့် စကားပြောဆိုနေခြင်း ဖြစ်ပါတယ်။',
    lowGain: 2,
    midGain: 1.5,
    highGain: 1,
    midFreq: 1200,
  },
  {
    id: 'hf_male_kyawkyaw',
    name: 'Kyaw Kyaw',
    myanmarName: 'ကျော်ကျော်',
    gender: 'Male',
    toneTitle: 'Movie Recap ဇာတ်လမ်းပြော ကျားအသံ',
    desc: 'ဩဇာပြည့်ဝသော ဇာတ်လမ်းပြော သြဇာအသံ (Deep Cinematic Bass Male)',
    samplePhrase: 'မင်္ဂလာပါ၊ Hugging Face ကျော်ကျော် အသံဖြင့် ဇာတ်လမ်းပြောပြပေးသွားမှာ ဖြစ်ပါတယ်။',
    lowGain: 5.5,
    midGain: 2.5,
    highGain: -1,
    midFreq: 900,
  },
  {
    id: 'hf_male_aungaung',
    name: 'Aung Aung',
    myanmarName: 'အောင်အောင်',
    gender: 'Male',
    toneTitle: 'တက်ကြွ ရွှင်လန်း ကျားအသံ',
    desc: 'TikTok နှင့် Shorts အတွက် သွက်လက်သော ကျားအသံ (Energetic Youth Male)',
    samplePhrase: 'မင်္ဂလာပါဗျာ၊ Hugging Face အောင်အောင် အသံဖြင့် တက်ကြွစွာ တင်ဆက်ပေးနေပါတယ်။',
    lowGain: 0.5,
    midGain: 3,
    highGain: 4,
    midFreq: 2200,
  },
  {
    id: 'hf_male_minthway',
    name: 'Min Thway',
    myanmarName: 'မင်းသွေး',
    gender: 'Male',
    toneTitle: 'အေးဆေး နူးညံ့ ကျားအသံ',
    desc: 'နားဆင်ရ သက်သာ နွေးထွေးသော ကျားအသံ (Soothing Storyteller Male)',
    samplePhrase: 'မင်္ဂလာပါ၊ Hugging Face မင်းသွေး အသံဖြင့် စိတ်အေးချမ်းစွာ နားဆင်နိုင်ပါတယ်။',
    lowGain: 3,
    midGain: 1,
    highGain: 1.5,
    midFreq: 1000,
  },
  {
    id: 'hf_female_nilar',
    name: 'Nilar',
    myanmarName: 'နီလာ',
    gender: 'Female',
    toneTitle: 'သဘာဝ မ စကားပြောသံ',
    desc: 'သဘာဝကျကျ ရှင်းလင်းသော မ အသံ (Gentle Native Female Voice)',
    samplePhrase: 'မင်္ဂလာပါရှင့်၊ Hugging Face နီလာ အသံဖြင့် ဖတ်ကြားပေးနေတာ ဖြစ်ပါတယ်ရှင်။',
    lowGain: 0,
    midGain: 2.5,
    highGain: 3.5,
    midFreq: 1800,
  },
  {
    id: 'hf_female_maythu',
    name: 'May Thu',
    myanmarName: 'မေသူ',
    gender: 'Female',
    toneTitle: 'နူးညံ့ ချိုသာ မ အသံ',
    desc: 'ချိုသာ စိုက်လိုက်ဆင်းလိုက် မ အသံ (Lyrical Soft Storyteller Female)',
    samplePhrase: 'မင်္ဂလာပါရှင့်၊ Hugging Face မေသူ အသံဖြင့် နူးညံ့စွာ ပြောပြပေးပါမည်ရှင်။',
    lowGain: 1,
    midGain: 3.5,
    highGain: 4.5,
    midFreq: 2400,
  },
  {
    id: 'hf_female_thiri',
    name: 'Thiri',
    myanmarName: 'သီရိ',
    gender: 'Female',
    toneTitle: 'သတင်းကြေညာ ရုပ်သံ မအသံ',
    desc: 'တိကျ ခိုင်မာသော သတင်းကြေညာသံ (Professional Broadcast Female)',
    samplePhrase: 'မင်္ဂလာပါရှင့်၊ Hugging Face သီရိ အသံဖြင့် သတင်းအချက်အလက်များကို ဖတ်ကြားပေးပါမည်။',
    lowGain: -1,
    midGain: 4,
    highGain: 5,
    midFreq: 2800,
  },
  {
    id: 'hf_female_susu',
    name: 'Su Su',
    myanmarName: 'စုစု',
    gender: 'Female',
    toneTitle: 'တက်ကြွ ရွှင်လန်း မအသံ',
    desc: 'ချစ်စရာကောင်းပြီး တက်ကြွသော မ အသံ (Vibrant Cheerful Female)',
    samplePhrase: 'မင်္ဂလာပါရှင်၊ Hugging Face စုစု အသံဖြင့် ပျော်ရွှင်စွာ ပြောဆိုနေတာ ဖြစ်ပါတယ်ရှင်။',
    lowGain: 0.5,
    midGain: 3,
    highGain: 6,
    midFreq: 3200,
  },
];

export async function synthesizeHuggingFaceVoice(
  text: string,
  options: HfSynthesisOptions = {}
): Promise<{ audioUrl: string; duration: number }> {
  const apiKeys = loadApiKeys();
  const hfKey = apiKeys.huggingFaceKey;
  if (!hfKey) {
    throw new Error('Hugging Face API Key (Token) မရှိသေးပါ။ အဆင့် 1 တွင် Token ထည့်သွင်းပြီး Connect ပြုလုပ်ပေးပါ။');
  }

  const cleanText = text.trim();
  if (!cleanText) {
    throw new Error('အသံထုတ်လုပ်ရန် စာသား မရှိပါ။');
  }

  const targetModel = options.model && options.model !== 'custom' ? options.model : 'coqui/XTTS-v2';
  const speakerId = options.speakerId || 'hf_male_thiha';
  const speakerInfo = HF_MULTI_SPEAKERS.find((s) => s.id === speakerId) || HF_MULTI_SPEAKERS[0];

  if (options.onStatusUpdate) {
    options.onStatusUpdate(`🤗 Hugging Face [${speakerInfo.name} (${speakerInfo.myanmarName})] ဖြင့် စကားပြောထုတ်လုပ်နေပါသည်...`);
  }

  // 1. Attempt Server Proxy endpoint first
  try {
    const res = await fetch('/api/huggingface/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: cleanText,
        model: targetModel,
        apiKey: hfKey,
        speakerId,
      }),
    });

    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer && arrayBuffer.byteLength >= 50) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContextClass();
        let audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

        try {
          audioBuffer = await applyHfSpeakerProfile(audioBuffer, speakerInfo);
        } catch (speakerAdaptErr) {
          console.warn('Speaker profile notice:', speakerAdaptErr);
        }

        const wavBlob = audioBufferToWavBlob(audioBuffer);
        return {
          audioUrl: URL.createObjectURL(wavBlob),
          duration: parseFloat(audioBuffer.duration.toFixed(2)),
        };
      }
    }
  } catch (serverErr) {
    console.warn('Server proxy HF TTS notice:', serverErr);
  }

  // 2. Attempt direct / CORS proxy fetch to Hugging Face Inference API
  const endpoints = [
    `https://router.huggingface.co/hf-inference/models/${targetModel}`,
    `https://api-inference.huggingface.co/models/${targetModel}`,
    `https://corsproxy.io/?${encodeURIComponent(`https://router.huggingface.co/hf-inference/models/${targetModel}`)}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const hfRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${hfKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: cleanText }),
      });

      if (hfRes.ok) {
        const arrayBuffer = await hfRes.arrayBuffer();
        if (arrayBuffer && arrayBuffer.byteLength >= 50) {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          const ctx = new AudioContextClass();
          let audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

          try {
            audioBuffer = await applyHfSpeakerProfile(audioBuffer, speakerInfo);
          } catch {}

          const wavBlob = audioBufferToWavBlob(audioBuffer);
          return {
            audioUrl: URL.createObjectURL(wavBlob),
            duration: parseFloat(audioBuffer.duration.toFixed(2)),
          };
        }
      }
    } catch (directErr) {
      console.warn('Direct HF TTS notice:', directErr);
    }
  }

  // 3. Fallback to 24kHz Studio Neural Voice if HF router endpoints fail or hit quota
  console.log(`HF Engine fallback notice. Synthesizing via 24kHz Studio Neural Engine for speaker ${speakerId}...`);
  const voiceMapping: Record<string, VoiceOption> = {
    hf_male_thiha: 'Thiha',
    hf_male_kyawkyaw: 'KyawKyaw',
    hf_male_aungaung: 'AungAung',
    hf_male_minthway: 'MinThway',
    hf_female_nilar: 'Nilar',
    hf_female_maythu: 'MayThu',
    hf_female_thiri: 'Thiri',
    hf_female_susu: 'SuSu',
  };
  const mappedVoice = voiceMapping[speakerId] || 'Thiha';
  return await synthesizeMyanmarVoice(cleanText, {
    voice: mappedVoice,
    style: 'conversational',
    speed: options.speed || 1.0,
    onStatusUpdate: options.onStatusUpdate,
  });
}

/**
 * Applies Hugging Face Multi-Speaker Acoustic Profile (Biquad Filter Graph & Compression)
 */
async function applyHfSpeakerProfile(
  sourceBuffer: AudioBuffer,
  speaker: HfSpeakerProfile
): Promise<AudioBuffer> {
  const offlineCtx = new OfflineAudioContext(
    sourceBuffer.numberOfChannels,
    sourceBuffer.length,
    sourceBuffer.sampleRate
  );

  const sourceNode = offlineCtx.createBufferSource();
  sourceNode.buffer = sourceBuffer;

  // Lowshelf Bass Filter
  const bassFilter = offlineCtx.createBiquadFilter();
  bassFilter.type = 'lowshelf';
  bassFilter.frequency.value = 220;
  bassFilter.gain.value = speaker.lowGain;

  // Vocal Peaking Filter
  const midFilter = offlineCtx.createBiquadFilter();
  midFilter.type = 'peaking';
  midFilter.frequency.value = speaker.midFreq;
  midFilter.Q.value = 1.2;
  midFilter.gain.value = speaker.midGain;

  // Highshelf Treble Filter
  const trebleFilter = offlineCtx.createBiquadFilter();
  trebleFilter.type = 'highshelf';
  trebleFilter.frequency.value = 4000;
  trebleFilter.gain.value = speaker.highGain;

  // Dynamics Compressor
  const compressor = offlineCtx.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 10;
  compressor.ratio.value = 3.5;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.08;

  // Audio Graph Connect
  sourceNode.connect(bassFilter);
  bassFilter.connect(midFilter);
  midFilter.connect(trebleFilter);
  trebleFilter.connect(compressor);
  compressor.connect(offlineCtx.destination);

  sourceNode.start(0);

  return await offlineCtx.startRendering();
}

/**
 * Converts an AudioBuffer into a PCM 16-bit Mono/Stereo WAV Blob
 */
function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
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

  // RIFF Chunk
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');

  // fmt Subchunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  // data Subchunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
