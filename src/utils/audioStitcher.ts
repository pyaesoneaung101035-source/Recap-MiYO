/**
 * Audio Stitcher for 30-Second Scene Recap Slots
 * Combines Main Narration (Part A) + an exact inter-part pause (default 0.18s) +
 * Scene-Matching Short Bridging Line (Part B) into one clean mono WAV clip.
 */

export const DEFAULT_INTER_PART_PAUSE_SEC = 0.18;

async function decodeAudioUrl(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch audio URL (HTTP ${res.status})`);
  }
  const arr = await res.arrayBuffer();
  return await ctx.decodeAudioData(arr);
}

function resampleBufferMono(buf: AudioBuffer, targetRate: number): Float32Array {
  const channel0 = buf.getChannelData(0);
  if (buf.sampleRate === targetRate) {
    return channel0;
  }
  const ratio = buf.sampleRate / targetRate;
  const newLength = Math.max(1, Math.round(channel0.length / ratio));
  const out = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcPos = i * ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const s0 = channel0[Math.min(idx, channel0.length - 1)] || 0;
    const s1 = channel0[Math.min(idx + 1, channel0.length - 1)] || 0;
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}

function encodeMono16BitWav(samples: Float32Array, sampleRate: number): Blob {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Stitches Part 1 audio and optional Part 2 bridge audio with an exact pause (default 0.18s)
 * between them. Returns a single seamless WAV blob URL and exact measured duration.
 */
export async function stitchAudioPartsWithPause(
  part1Url: string,
  part2Url?: string | null,
  pauseSeconds = DEFAULT_INTER_PART_PAUSE_SEC
): Promise<{ audioUrl: string; duration: number; part1Duration: number; part2Duration: number }> {
  const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AudioCtxClass();

  try {
    const buf1 = await decodeAudioUrl(ctx, part1Url);
    const sampleRate = buf1.sampleRate || 24000;
    const pcm1 = resampleBufferMono(buf1, sampleRate);
    const part1Duration = pcm1.length / sampleRate;

    if (!part2Url) {
      return {
        audioUrl: part1Url,
        duration: parseFloat(part1Duration.toFixed(3)),
        part1Duration: parseFloat(part1Duration.toFixed(3)),
        part2Duration: 0,
      };
    }

    const buf2 = await decodeAudioUrl(ctx, part2Url);
    const pcm2 = resampleBufferMono(buf2, sampleRate);
    const part2Duration = pcm2.length / sampleRate;

    const safePause = Math.max(0.05, Math.min(2.0, pauseSeconds || DEFAULT_INTER_PART_PAUSE_SEC));
    const gapSamples = Math.round(safePause * sampleRate);

    const totalSamples = pcm1.length + gapSamples + pcm2.length;
    const combined = new Float32Array(totalSamples);
    combined.set(pcm1, 0);
    // Gap samples remain 0 (exact digital silence for 0.18s)
    combined.set(pcm2, pcm1.length + gapSamples);

    const wavBlob = encodeMono16BitWav(combined, sampleRate);
    const audioUrl = URL.createObjectURL(wavBlob);
    const totalDuration = totalSamples / sampleRate;

    return {
      audioUrl,
      duration: parseFloat(totalDuration.toFixed(3)),
      part1Duration: parseFloat(part1Duration.toFixed(3)),
      part2Duration: parseFloat(part2Duration.toFixed(3)),
    };
  } finally {
    ctx.close().catch(() => {});
  }
}
