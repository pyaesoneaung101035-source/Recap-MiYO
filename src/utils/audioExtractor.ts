/**
 * Audio & Video Frame Extractor
 * Extracts real audio from uploaded video files for Gemini Speech-to-Text & Transcription.
 */

export interface AudioChunkResult {
  partIndex: number;
  totalParts: number;
  startTimeSeconds: number;
  durationSeconds: number;
  base64Wav: string;
  mimeType: string;
}

export async function extractAudioFromVideo(
  videoSource: File | string,
  maxDurationSeconds = 180
): Promise<{ base64Wav: string; mimeType: string; duration: number }> {
  let arrayBuffer: ArrayBuffer;

  if (typeof videoSource === 'string') {
    const res = await fetch(videoSource);
    arrayBuffer = await res.arrayBuffer();
  } else {
    arrayBuffer = await videoSource.arrayBuffer();
  }

  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioContextClass();

  // Decode the audio track from the video container (MP4, WebM, MOV)
  const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  const duration = Math.min(decodedBuffer.duration, maxDurationSeconds);
  const targetSampleRate = 16000; // 16kHz is ideal for speech transcription
  const targetLength = Math.floor(duration * targetSampleRate);

  // Downsample to 16kHz Mono
  const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = decodedBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const renderedBuffer = await offlineCtx.startRendering();
  const channelData = renderedBuffer.getChannelData(0);

  // Encode to 16-bit Mono PCM WAV
  const wavBytes = encodeWavMono16Bit(channelData, targetSampleRate);

  // Convert to base64
  let binary = '';
  const len = wavBytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(wavBytes[i]);
  }
  const base64Wav = btoa(binary);

  return {
    base64Wav,
    mimeType: 'audio/wav',
    duration,
  };
}

/**
 * Slice audio track of long videos into chunk-sized PCM WAVs (default 3 mins = 180s each)
 * Part 1: 0-3m, Part 2: 3-6m, Part 3: 6-9m ...
 */
export async function extractAudioChunksFromVideo(
  videoSource: File | string,
  chunkSizeSeconds = 180
): Promise<AudioChunkResult[]> {
  let arrayBuffer: ArrayBuffer;

  if (typeof videoSource === 'string') {
    const res = await fetch(videoSource);
    arrayBuffer = await res.arrayBuffer();
  } else {
    arrayBuffer = await videoSource.arrayBuffer();
  }

  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioContextClass();

  const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  const totalDuration = decodedBuffer.duration;
  const totalParts = Math.max(1, Math.ceil(totalDuration / chunkSizeSeconds));
  const targetSampleRate = 16000;
  const results: AudioChunkResult[] = [];

  for (let i = 0; i < totalParts; i++) {
    const startTimeSeconds = i * chunkSizeSeconds;
    const durationSeconds = Math.min(chunkSizeSeconds, totalDuration - startTimeSeconds);
    if (durationSeconds <= 0.1) continue;

    const targetLength = Math.floor(durationSeconds * targetSampleRate);
    const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = decodedBuffer;
    source.connect(offlineCtx.destination);

    source.start(0, startTimeSeconds, durationSeconds);

    const renderedBuffer = await offlineCtx.startRendering();
    const channelData = renderedBuffer.getChannelData(0);

    const wavBytes = encodeWavMono16Bit(channelData, targetSampleRate);

    let binary = '';
    const len = wavBytes.byteLength;
    for (let j = 0; j < len; j++) {
      binary += String.fromCharCode(wavBytes[j]);
    }
    const base64Wav = btoa(binary);

    results.push({
      partIndex: i + 1,
      totalParts,
      startTimeSeconds,
      durationSeconds,
      base64Wav,
      mimeType: 'audio/wav',
    });
  }

  return results;
}

/**
 * Extracts a sequence of keyframe screenshots from a video element / file
 */
export async function extractVideoKeyframes(
  videoUrl: string,
  numFrames = 5
): Promise<Array<{ time: number; base64Jpeg: string }>> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.src = videoUrl;
    video.crossOrigin = 'anonymous';
    video.muted = true;

    video.onloadedmetadata = async () => {
      const duration = video.duration || 10;
      const step = duration / (numFrames + 1);
      const canvas = document.createElement('canvas');
      canvas.width = 480;
      canvas.height = 270;
      const ctx = canvas.getContext('2d');

      const frames: Array<{ time: number; base64Jpeg: string }> = [];

      for (let i = 1; i <= numFrames; i++) {
        const time = i * step;
        video.currentTime = time;
        await new Promise((r) => {
          video.onseeked = () => r(null);
        });

        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
          const base64 = dataUrl.split(',')[1];
          if (base64) {
            frames.push({ time, base64Jpeg: base64 });
          }
        }
      }

      resolve(frames);
    };

    video.onerror = () => {
      resolve([]);
    };
  });
}

/**
 * Resamples any uploaded audio file (WAV, MP3, M4A, OGG) to 16kHz Mono 16-bit PCM WAV base64
 * Ensures compact payload for Hugging Face Voice Clone API (~250KB for 10s audio)
 */
export async function resampleAudioFileToWavBase64(
  fileOrBlob: File | Blob,
  maxDurationSeconds = 12
): Promise<{ base64Wav: string; duration: number; byteLength: number }> {
  const arrayBuffer = await fileOrBlob.arrayBuffer();
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioContextClass();

  const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  const duration = Math.min(decodedBuffer.duration, maxDurationSeconds);
  const targetSampleRate = 16000;
  const targetLength = Math.floor(duration * targetSampleRate);

  const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = decodedBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const renderedBuffer = await offlineCtx.startRendering();
  const channelData = renderedBuffer.getChannelData(0);

  const wavBytes = encodeWavMono16Bit(channelData, targetSampleRate);

  let binary = '';
  const len = wavBytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(wavBytes[i]);
  }
  const base64Wav = btoa(binary);

  return {
    base64Wav,
    duration,
    byteLength: wavBytes.byteLength,
  };
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
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, 1, true); // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  view.setUint16(32, 2, true); // BlockAlign (NumChannels * BitsPerSample/8)
  view.setUint16(34, 16, true); // BitsPerSample (16-bit)

  // data chunk
  writeAscii(view, 36, 'data');
  view.setUint32(40, numSamples * 2, true);

  // Write PCM samples
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
