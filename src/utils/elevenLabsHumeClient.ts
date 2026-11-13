import { loadApiKeys } from './apiKeys';

export interface ElevenLabsVoiceItem {
  voice_id: string;
  name: string;
  category: string;
  preview_url?: string;
  labels?: Record<string, string>;
}

export interface ProviderConfigStatus {
  geminiConfigured: boolean;
  elevenLabsConfigured: boolean;
  huggingFaceConfigured: boolean;
}

let sharedAudioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
  if (!sharedAudioCtx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    sharedAudioCtx = new AC();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume();
  }
  return sharedAudioCtx;
}

function encodeWavFromBuffer(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitsPerSample = 16;
  const blockAlign = numChannels * 2;
  const dataLength = buffer.length * blockAlign;
  const ab = new ArrayBuffer(44 + dataLength);
  const view = new DataView(ab);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

async function decodeAndTrimToBlobUrl(rawBytes: ArrayBuffer): Promise<{ audioUrl: string; duration: number }> {
  try {
    const ctx = getAudioCtx();
    const decoded = await ctx.decodeAudioData(rawBytes.slice(0));
    const sr = decoded.sampleRate;
    const ch0 = decoded.getChannelData(0);
    const total = decoded.length;

    let first = 0;
    while (first < total && Math.abs(ch0[first]) < 0.0012) first++;
    if (first >= total) first = 0;

    let last = total - 1;
    while (last > first && Math.abs(ch0[last]) < 0.0012) last--;

    const startIdx = Math.max(0, first - Math.floor(0.03 * sr));
    const endIdx = Math.min(total, last + Math.floor(0.12 * sr));
    const newLen = Math.max(1, endIdx - startIdx);

    const out = ctx.createBuffer(decoded.numberOfChannels, newLen, sr);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      out.getChannelData(c).set(decoded.getChannelData(c).subarray(startIdx, endIdx));
    }

    const wavBlob = encodeWavFromBuffer(out);
    return {
      audioUrl: URL.createObjectURL(wavBlob),
      duration: parseFloat(out.duration.toFixed(2)),
    };
  } catch {
    const blob = new Blob([rawBytes], { type: 'audio/mpeg' });
    return {
      audioUrl: URL.createObjectURL(blob),
      duration: parseFloat(Math.max(1.5, rawBytes.byteLength / 8000).toFixed(2)),
    };
  }
}

export async function fetchTtsProvidersStatus(): Promise<ProviderConfigStatus> {
  try {
    const res = await fetch('/api/tts/providers-status');
    if (res.ok) {
      return await res.json();
    }
  } catch {}
  return {
    geminiConfigured: false,
    elevenLabsConfigured: false,
    huggingFaceConfigured: false,
  };
}

export async function fetchElevenLabsVoices(overrideApiKey?: string): Promise<ElevenLabsVoiceItem[]> {
  const { elevenLabsKey } = loadApiKeys();
  const key = overrideApiKey || elevenLabsKey;
  const res = await fetch('/api/elevenlabs/voices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: key || undefined }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `ElevenLabs voices fetch failed (HTTP ${res.status})`);
  }
  return Array.isArray(data.voices) ? data.voices : [];
}

export async function cloneElevenLabsVoice(
  name: string,
  audioFile: File,
  description = 'Burmese Narrator Cloned Voice',
  overrideApiKey?: string
): Promise<{ voice_id: string; name: string }> {
  const { elevenLabsKey } = loadApiKeys();
  const key = overrideApiKey || elevenLabsKey;
  const form = new FormData();
  form.append('name', name.trim() || 'Myanmar Cloned Voice');
  form.append('description', description);
  form.append('audio', audioFile);
  if (key) form.append('apiKey', key);

  const res = await fetch('/api/elevenlabs/clone', {
    method: 'POST',
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.voice_id) {
    throw new Error(data.error || `ElevenLabs Voice Clone failed (HTTP ${res.status})`);
  }
  return { voice_id: data.voice_id, name: data.name || name };
}

export async function cloneElevenLabsFromSampleVideo(
  name = 'Sample Video Burmese Narrator',
  videoPath?: string,
  overrideApiKey?: string
): Promise<{ voice_id: string; name: string }> {
  const { elevenLabsKey } = loadApiKeys();
  const key = overrideApiKey || elevenLabsKey;
  const res = await fetch('/api/elevenlabs/clone-sample-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: key || undefined,
      name,
      videoPath: videoPath || undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.voice_id) {
    throw new Error(data.error || `Sample video voice clone failed (HTTP ${res.status})`);
  }
  return { voice_id: data.voice_id, name: data.name || name };
}

export async function synthesizeElevenLabsVoice(
  text: string,
  options: {
    voiceId: string;
    modelId?: string;
    stability?: number;
    style?: number;
    emotion?: string;
    onStatusUpdate?: (msg: string) => void;
  }
): Promise<{ audioUrl: string; duration: number }> {
  const { elevenLabsKey } = loadApiKeys();
  if (options.onStatusUpdate) {
    options.onStatusUpdate('🎙️ ElevenLabs Voice Clone (eleven_v3) ဖြင့် အသံထုတ်လုပ်နေပါသည်...');
  }

  const res = await fetch('/api/elevenlabs/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      voiceId: options.voiceId,
      modelId: options.modelId || 'eleven_v3',
      stability: options.stability ?? 0.5,
      style: options.style ?? 0.0,
      emotion: options.emotion,
      apiKey: elevenLabsKey || undefined,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `ElevenLabs TTS failed (HTTP ${res.status})`);
  }

  const buf = await res.arrayBuffer();
  return await decodeAndTrimToBlobUrl(buf);
}

