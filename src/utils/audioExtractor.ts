/**
 * Audio & Video Frame Extractor
 * Extracts real audio and timestamped keyframes cleanly and quickly from uploaded video files.
 */

export interface AudioChunkResult {
  partIndex: number;
  totalParts: number;
  startTimeSeconds: number;
  durationSeconds: number;
  base64Wav: string;
  mimeType: string;
  hasAudio?: boolean;
}

/**
 * Fast, main-thread-friendly Uint8Array -> base64 converter
 * (avoids millions of single-char string concatenations)
 */
function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x4000; // 16KB
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    chunks.push(String.fromCharCode.apply(null, slice as unknown as number[]));
  }
  return btoa(chunks.join(''));
}

async function loadVideoArrayBuffer(videoSource: File | string): Promise<ArrayBuffer> {
  if (typeof videoSource !== 'string') {
    return await videoSource.arrayBuffer();
  }
  try {
    const res = await fetch(videoSource);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.arrayBuffer();
  } catch (err: any) {
    throw new Error(
      `ဗီဒီယိုဖိုင်ကို ဖတ်ယူ၍မရပါ (${err?.message || 'File not found'})။ Step 2 တွင် Custom Video ဖိုင်ကို ပြန်လည်တင်ပေးပါ။`
    );
  }
}

export async function extractAudioFromVideo(
  videoSource: File | string,
  maxDurationSeconds = 180
): Promise<{ base64Wav: string; mimeType: string; duration: number }> {
  const arrayBuffer = await loadVideoArrayBuffer(videoSource);

  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioContextClass();

  try {
    const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    const duration = Math.min(decodedBuffer.duration, maxDurationSeconds);
    const targetSampleRate = 16000; // 16kHz for AssemblyAI/speech upload
    const targetLength = Math.max(1, Math.floor(duration * targetSampleRate));

    const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = decodedBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    const renderedBuffer = await offlineCtx.startRendering();
    const channelData = renderedBuffer.getChannelData(0);

    const wavBytes = encodeWavMono16Bit(channelData, targetSampleRate);
    const base64Wav = uint8ToBase64(wavBytes);

    return {
      base64Wav,
      mimeType: 'audio/wav',
      duration,
    };
  } finally {
    audioCtx.close().catch(() => {});
  }
}

/**
 * Slice audio track of long videos into chunk-sized PCM WAVs (default 1 min = 60s each)
 * Part 1: 0-1m, Part 2: 1-2m, Part 3: 2-3m ...
 */
export async function extractAudioChunksFromVideo(
  videoSource: File | string,
  chunkSizeSeconds = 60,
  fallbackTotalDurationSec = 60
): Promise<AudioChunkResult[]> {
  const arrayBuffer = await loadVideoArrayBuffer(videoSource);

  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioContextClass();

  try {
    let decodedBuffer: AudioBuffer | null = null;
    try {
      decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } catch (decodeErr) {
      console.warn('Video has no decodable audio track or codec unsupported in browser:', decodeErr);
      // Graceful fallback for silent videos: return chunk descriptors so visual keyframes can still be analyzed
      const safeDur = Math.max(5, fallbackTotalDurationSec || chunkSizeSeconds);
      const totalParts = Math.max(1, Math.ceil(safeDur / chunkSizeSeconds));
      const visualOnlyChunks: AudioChunkResult[] = [];
      for (let i = 0; i < totalParts; i++) {
        const startTimeSeconds = i * chunkSizeSeconds;
        const durationSeconds = Math.min(chunkSizeSeconds, safeDur - startTimeSeconds);
        if (durationSeconds <= 0.1) continue;
        visualOnlyChunks.push({
          partIndex: i + 1,
          totalParts,
          startTimeSeconds,
          durationSeconds,
          base64Wav: '',
          mimeType: 'audio/wav',
          hasAudio: false,
        });
      }
      return visualOnlyChunks;
    }

    const totalDuration = decodedBuffer.duration;
    const totalParts = Math.max(1, Math.ceil(totalDuration / chunkSizeSeconds));
    // 12kHz Mono WAV keeps speech completely intelligible while reducing base64 payload ~25%
    const targetSampleRate = 12000;
    const results: AudioChunkResult[] = [];

    for (let i = 0; i < totalParts; i++) {
      const startTimeSeconds = i * chunkSizeSeconds;
      const durationSeconds = Math.min(chunkSizeSeconds, totalDuration - startTimeSeconds);
      if (durationSeconds <= 0.1) continue;

      const targetLength = Math.max(1, Math.floor(durationSeconds * targetSampleRate));
      const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = decodedBuffer;
      source.connect(offlineCtx.destination);

      source.start(0, startTimeSeconds, durationSeconds);

      const renderedBuffer = await offlineCtx.startRendering();
      const channelData = renderedBuffer.getChannelData(0);

      const wavBytes = encodeWavMono16Bit(channelData, targetSampleRate);
      const base64Wav = uint8ToBase64(wavBytes);

      results.push({
        partIndex: i + 1,
        totalParts,
        startTimeSeconds,
        durationSeconds,
        base64Wav,
        mimeType: 'audio/wav',
        hasAudio: true,
      });
    }

    return results;
  } finally {
    audioCtx.close().catch(() => {});
  }
}

/**
 * Extracts keyframes for ALL 1-minute windows in ONE single forward pass using ONE <video> element.
 * Much faster than reloading the video element for each chunk (saves 10-90+ seconds on multi-minute videos).
 */
export async function extractAllVideoKeyframesBatch(
  videoUrl: string,
  windows: Array<{ partIndex: number; startSec: number; endSec: number }>,
  framesPerBlock = 5
): Promise<Map<number, Array<{ time: number; base64Jpeg: string }>>> {
  const resultMap = new Map<number, Array<{ time: number; base64Jpeg: string }>>();
  for (const w of windows) {
    resultMap.set(w.partIndex, []);
  }
  if (!videoUrl || windows.length === 0) return resultMap;

  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = videoUrl;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        video.onloadedmetadata = null;
        video.onseeked = null;
        video.onerror = null;
        video.removeAttribute('src');
        video.load();
      } catch {}
      resolve(resultMap);
    };

    const maxWaitMs = Math.min(45000, Math.max(15000, windows.length * 7500));
    const overallTimeout = setTimeout(finish, maxWaitMs);

    video.onloadedmetadata = async () => {
      const duration = video.duration || windows[windows.length - 1]?.endSec || 60;
      const vw = video.videoWidth || 720;
      const vh = video.videoHeight || 1280;
      const maxDim = 384;
      const canvas = document.createElement('canvas');
      if (vw >= vh) {
        canvas.width = maxDim;
        canvas.height = Math.max(120, Math.round((vh / vw) * maxDim));
      } else {
        canvas.height = maxDim;
        canvas.width = Math.max(120, Math.round((vw / vh) * maxDim));
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        clearTimeout(overallTimeout);
        finish();
        return;
      }

      // Build ordered list of seek targets across all minute blocks
      const targets: Array<{ partIndex: number; time: number }> = [];
      for (const w of windows) {
        const winStart = Math.max(0, Math.min(w.startSec, Math.max(0, duration - 0.4)));
        const winEnd = Math.max(winStart + 0.4, Math.min(duration - 0.06, w.endSec));
        const span = winEnd - winStart;
        const step = span / (framesPerBlock + 1);
        for (let i = 1; i <= framesPerBlock; i++) {
          targets.push({
            partIndex: w.partIndex,
            time: parseFloat(Math.min(winEnd, winStart + i * step).toFixed(2)),
          });
        }
      }

      let consecutiveTimeouts = 0;
      let corsTainted = false;

      for (const t of targets) {
        if (settled || corsTainted || consecutiveTimeouts >= 3) break;

        const seekOk = await new Promise<boolean>((r) => {
          const seekTimeout = setTimeout(() => {
            video.onseeked = null;
            r(false);
          }, 1100);
          video.onseeked = () => {
            clearTimeout(seekTimeout);
            video.onseeked = null;
            r(true);
          };
          try {
            video.currentTime = t.time;
          } catch {
            clearTimeout(seekTimeout);
            r(false);
          }
        });

        if (!seekOk) {
          consecutiveTimeouts++;
          continue;
        }
        consecutiveTimeouts = 0;

        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.55);
          const base64 = dataUrl.split(',')[1];
          if (base64) {
            resultMap.get(t.partIndex)?.push({ time: t.time, base64Jpeg: base64 });
          }
        } catch (drawErr: any) {
          if (drawErr?.name === 'SecurityError') {
            corsTainted = true;
          }
        }
      }

      clearTimeout(overallTimeout);
      finish();
    };

    video.onerror = () => {
      clearTimeout(overallTimeout);
      finish();
    };
  });
}

/**
 * Extracts timestamped keyframe screenshots strictly within a specific [startTimeSec, endTimeSec] window
 */
export async function extractVideoKeyframesInRange(
  videoUrl: string,
  startTimeSec: number,
  endTimeSec: number,
  numFrames = 5
): Promise<Array<{ time: number; base64Jpeg: string }>> {
  const map = await extractAllVideoKeyframesBatch(
    videoUrl,
    [{ partIndex: 1, startSec: startTimeSec, endSec: endTimeSec }],
    numFrames
  );
  return map.get(1) || [];
}

/**
 * Extracts a sequence of keyframe screenshots from a video element / file
 */
export async function extractVideoKeyframes(
  videoUrl: string,
  numFrames = 6
): Promise<Array<{ time: number; base64Jpeg: string }>> {
  return new Promise((resolve) => {
    const probe = document.createElement('video');
    probe.crossOrigin = 'anonymous';
    probe.muted = true;
    probe.preload = 'metadata';
    probe.src = videoUrl;
    const t = setTimeout(() => resolve([]), 8000);
    probe.onloadedmetadata = async () => {
      clearTimeout(t);
      const dur = probe.duration || 60;
      const frames = await extractVideoKeyframesInRange(videoUrl, 0, dur, numFrames);
      resolve(frames);
    };
    probe.onerror = () => {
      clearTimeout(t);
      resolve([]);
    };
  });
}

/**
 * Resamples any uploaded audio file (WAV, MP3, M4A, OGG) to 16kHz Mono 16-bit PCM WAV base64
 * Ensures compact payload for Voice Clone API (~250KB for 10s audio)
 */
export async function resampleAudioFileToWavBase64(
  fileOrBlob: File | Blob,
  maxDurationSeconds = 12
): Promise<{ base64Wav: string; duration: number; byteLength: number }> {
  const arrayBuffer = await fileOrBlob.arrayBuffer();
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioContextClass();

  try {
    const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const duration = Math.min(decodedBuffer.duration, maxDurationSeconds);
    const targetSampleRate = 16000;
    const targetLength = Math.max(1, Math.floor(duration * targetSampleRate));

    const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = decodedBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    const renderedBuffer = await offlineCtx.startRendering();
    const channelData = renderedBuffer.getChannelData(0);

    const wavBytes = encodeWavMono16Bit(channelData, targetSampleRate);
    const base64Wav = uint8ToBase64(wavBytes);

    return {
      base64Wav,
      duration,
      byteLength: wavBytes.byteLength,
    };
  } finally {
    audioCtx.close().catch(() => {});
  }
}

function encodeWavMono16Bit(samples: Float32Array, sampleRate: number): Uint8Array {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  // RIFF header
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeAscii(view, 8, 'WAVE');

  // fmt chunk
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);

  // data chunk
  writeAscii(view, 36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const intSample = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
