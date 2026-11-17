export interface ExtractBgmResult {
  success: boolean;
  bgmUrl: string;
  vocalUrl?: string;
  engineUsed: string;
  statusMessage: string;
  durationSec: number;
}

const CHUNK_SIZE_BYTES = 1536 * 1024; // 1.5 MB per chunk (cuts request bursts 3x while staying safely under proxy caps)
const CHUNK_THRESHOLD_BYTES = 1600 * 1024; // Use chunked upload automatically above 1.6 MB
const MAX_BROWSER_DECODE_BYTES = 180 * 1024 * 1024; // Guard browser RAM when decoding audio from large videos

function encodeAudioBufferToWavBlob(audioBuffer: AudioBuffer): Blob {
  const numChannels = audioBuffer.numberOfChannels >= 2 ? 2 : 1;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const dataLength = length * numChannels * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataLength, true);

  const ch0 = audioBuffer.getChannelData(0);
  const ch1 = numChannels === 2 ? audioBuffer.getChannelData(1) : null;

  let offset = 44;
  for (let i = 0; i < length; i++) {
    const s0 = Math.max(-1, Math.min(1, ch0[i]));
    view.setInt16(offset, s0 < 0 ? s0 * 0x8000 : s0 * 0x7fff, true);
    offset += 2;
    if (ch1) {
      const s1 = Math.max(-1, Math.min(1, ch1[i]));
      view.setInt16(offset, s1 < 0 ? s1 * 0x8000 : s1 * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

async function tryExtractCompactAudioForUpload(
  sourceBlob: Blob,
  safeName: string,
  report: (pct: number, label: string) => void
): Promise<{ blob: Blob; fileName: string }> {
  if (
    typeof AudioContext === 'undefined' ||
    sourceBlob.size <= 2 * 1024 * 1024 ||
    sourceBlob.size > MAX_BROWSER_DECODE_BYTES
  ) {
    return { blob: sourceBlob, fileName: safeName };
  }

  let audioCtx: AudioContext | null = null;
  try {
    report(3, 'ဗီဒီယိုမှ အသံလမ်းကြောင်း သီးသန့် ခွဲထုတ်ပြင်ဆင်နေသည်...');
    let arrayBuf: ArrayBuffer | null = await sourceBlob.arrayBuffer();
    try {
      audioCtx = new AudioContext({ sampleRate: 44100 });
    } catch (_) {
      audioCtx = new AudioContext();
    }
    const decoded = await audioCtx.decodeAudioData(arrayBuf);
    arrayBuf = null;
    if (!decoded || decoded.numberOfChannels === 0 || decoded.length === 0) {
      return { blob: sourceBlob, fileName: safeName };
    }
    const wavBlob = encodeAudioBufferToWavBlob(decoded);

    // Only swap to WAV when it is meaningfully smaller than the uploaded video file
    if (wavBlob.size > 1000 && wavBlob.size < sourceBlob.size * 0.88) {
      const baseName = safeName.replace(/\.[^/.]+$/, '') || 'custom_audio';
      return { blob: wavBlob, fileName: `${baseName}_audio.wav` };
    }
  } catch (err) {
    console.warn('Browser audio extraction skipped (falling back to full video upload):', err);
  } finally {
    if (audioCtx) {
      try {
        await audioCtx.close();
      } catch (_) {}
    }
  }

  return { blob: sourceBlob, fileName: safeName };
}

function isNetworkFetchError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    err?.name === 'TypeError' ||
    err?.name === 'AbortError' ||
    err?.name === 'TimeoutError' ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network error') ||
    msg.includes('load failed') ||
    msg.includes('timeout') ||
    msg.includes('aborted')
  );
}

function getRetryAfterDelayMs(res: Response, fallbackMs: number): number {
  const raw = res.headers.get('retry-after');
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(30000, Math.max(1000, Math.round(seconds * 1000)));
    }
    const dateMs = Date.parse(raw);
    if (Number.isFinite(dateMs)) {
      const diff = dateMs - Date.now();
      if (diff > 0) {
        return Math.min(30000, Math.max(1000, diff));
      }
    }
  }
  return fallbackMs;
}

async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  maxAttempts = 8
): Promise<Response> {
  let lastErr: any = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: init?.signal || AbortSignal.timeout(60000),
      });
      if (
        (res.status === 429 || res.status === 408 || res.status === 500 || (res.status >= 502 && res.status <= 504)) &&
        attempt < maxAttempts - 1
      ) {
        const baseBackoff = res.status === 429
          ? Math.min(15000, 2500 * Math.pow(1.5, attempt))
          : Math.min(5000, 1000 * (attempt + 1));
        const waitMs = res.status === 429 ? getRetryAfterDelayMs(res, baseBackoff) : baseBackoff;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      return res;
    } catch (err: any) {
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, Math.min(5000, 1000 * (attempt + 1))));
      }
    }
  }
  if (isNetworkFetchError(lastErr)) {
    throw new Error(
      'Server နှင့် ချိတ်ဆက်မှု ယာယီပြတ်တောက်နေပါသည် (Failed to fetch)။ စက္ကန့်အနည်းငယ်စောင့်ပြီး ထပ်မံကြိုးစားပေးပါ။'
    );
  }
  throw lastErr;
}

/**
 * Extracts vocal-removed Background music.mp3 via the resilient chunked job pipeline.
 */
export async function extractBackgroundMusicFromVideo(
  videoFile?: File | null,
  videoUrl?: string | null,
  videoName = 'custom_video.mp4'
): Promise<ExtractBgmResult> {
  return extractBgmWithProgress(videoFile, videoUrl, videoName);
}

async function uploadVideoInChunks(
  uploadBlob: Blob,
  safeName: string,
  report: (pct: number, label: string) => void
): Promise<string> {
  const uploadId = `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const totalChunks = Math.max(1, Math.ceil(uploadBlob.size / CHUNK_SIZE_BYTES));

  for (let idx = 0; idx < totalChunks; idx++) {
    const start = idx * CHUNK_SIZE_BYTES;
    const end = Math.min(uploadBlob.size, start + CHUNK_SIZE_BYTES);
    const slice = uploadBlob.slice(start, end);

    const chunkPct = 5 + Math.round(((idx + 1) / totalChunks) * 15); // 5% -> 20%
    report(chunkPct, `အသံ/ဗီဒီယို ဖိုင်ကို Server သို့ ပို့ဆောင်နေသည်... (${idx + 1}/${totalChunks})`);

    let lastChunkErr: any = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const fd = new FormData();
        fd.append('uploadId', uploadId);
        fd.append('chunkIndex', String(idx));
        fd.append('totalChunks', String(totalChunks));
        fd.append('fileName', safeName);
        fd.append('chunk', slice, safeName);

        const res = await fetch('/api/audio/bgm/upload-chunk', {
          method: 'POST',
          body: fd,
          signal: AbortSignal.timeout(45000),
        });
        if (res.status === 429 && attempt < 7) {
          const waitMs = getRetryAfterDelayMs(res, Math.min(15000, 2500 * Math.pow(1.5, attempt)));
          lastChunkErr = new Error('HTTP 429');
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        const data = await res.json().catch(() => ({}));
        if (((res.status >= 502 && res.status <= 504) || res.status === 500 || res.status === 408) && attempt < 7) {
          throw new Error(`HTTP ${res.status}`);
        }
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `Chunk ${idx + 1} upload error (HTTP ${res.status})`);
        }
        lastChunkErr = null;
        break;
      } catch (err: any) {
        lastChunkErr = err;
        if (attempt < 7) {
          await new Promise((r) => setTimeout(r, Math.min(6000, 900 * Math.pow(1.4, attempt))));
        }
      }
    }

    if (lastChunkErr) {
      if (isNetworkFetchError(lastChunkErr)) {
        throw new Error(
          'ဗီဒီယိုပို့ဆောင်စဉ် Server နှင့် ချိတ်ဆက်မှု ပြတ်တောက်သွားပါသည် (Failed to fetch)။ စက္ကန့်အနည်းငယ်စောင့်ပြီး ထပ်မံနှိပ်ပေးပါ။'
        );
      }
      throw lastChunkErr;
    }

    if (idx < totalChunks - 1) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  report(21, 'ဖိုင်စုစည်းပြီး Demucs BGM ခွဲထုတ်မှု စတင်နေသည်...');
  const startRes = await fetchWithRetry('/api/audio/bgm/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, totalChunks, videoName: safeName }),
  });
  const startData = await startRes.json().catch(() => ({}));
  if (!startRes.ok || !startData?.jobId) {
    throw new Error(startData?.error || `BGM extraction start error (HTTP ${startRes.status})`);
  }
  return startData.jobId;
}

/**
 * Sends custom uploaded video to the built-in server stem extractor (Demucs v4 / BS-RoFormer / FFmpeg vocal removal, NO external API key needed),
 * reports live percentage progress (0% -> 100%), and returns Background music .mp3.
 */
export async function extractBgmWithProgress(
  videoFile?: File | null,
  videoUrl?: string | null,
  videoName = 'custom_video.mp4',
  onProgress?: (percent: number, stageLabel: string) => void
): Promise<ExtractBgmResult> {
  if (!videoFile && !videoUrl) {
    throw new Error('နောက်ခံတီးလုံး ထုတ်ယူရန် ဗီဒီယိုဖိုင် အရင်တင်ပေးပါ။');
  }

  const report = (pct: number, label: string) => {
    onProgress?.(Math.max(0, Math.min(100, Math.round(pct))), label);
  };

  report(2, 'Custom upload video ကို ပြင်ဆင်နေသည်...');

  let jobId = '';
  const isServerOrRemoteUrl = Boolean(
    videoUrl &&
      !videoFile &&
      (videoUrl.startsWith('/') || videoUrl.startsWith('http://') || videoUrl.startsWith('https://'))
  );

  if (isServerOrRemoteUrl && videoUrl) {
    report(16, 'ဗီဒီယိုမှ နောက်ခံတီးလုံး ခွဲထုတ်မှု စတင်နေသည်...');
    try {
      const startRes = await fetchWithRetry('/api/audio/bgm/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl, videoName }),
      });
      const startData = await startRes.json().catch(() => ({}));
      if (startRes.ok && startData?.jobId) {
        jobId = startData.jobId;
      } else if (videoUrl.startsWith('/')) {
        throw new Error(startData?.error || 'BGM ထုတ်ယူမှု မစတင်နိုင်ပါ');
      }
    } catch (serverUrlErr: any) {
      if (videoUrl.startsWith('/')) {
        throw serverUrlErr;
      }
      // If remote http(s) URL failed on server side, fall through to browser fetch + chunk upload
    }
  }

  if (!jobId) {
    let rawBlob: Blob;
    if (videoFile) {
      rawBlob = videoFile;
    } else if (videoUrl) {
      report(4, 'ဗီဒီယိုဖိုင် ဖတ်ယူနေသည်...');
      let blobRes: Response;
      try {
        blobRes = await fetch(videoUrl);
      } catch (_) {
        throw new Error(
          'ဗီဒီယိုဖိုင် အဆက်အသွယ်ပြတ်တောက်သွားပါသည်။ Step 2 တွင် "Upload Video" ခလုတ်ဖြင့် ဗီဒီယိုဖိုင် အသစ်ပြန်တင်ပေးပါ။'
        );
      }
      if (!blobRes.ok) {
        throw new Error(
          'ဗီဒီယိုဖိုင် မရရှိနိုင်ပါ။ Step 2 တွင် "Upload Video" ခလုတ်ဖြင့် ဗီဒီယိုဖိုင် အသစ်ပြန်တင်ပေးပါ။'
        );
      }
      rawBlob = await blobRes.blob();
    } else {
      throw new Error('ဗီဒီယိုဖိုင် မတွေ့ရှိပါ။');
    }

    // Ensure blob has a valid mime type
    if (!rawBlob.type || rawBlob.type === 'application/octet-stream') {
      rawBlob = new Blob([rawBlob], { type: 'video/mp4' });
    }

    const rawName = videoFile?.name || videoName || 'custom_video.mp4';
    const initialSafeName = rawName.includes('.') ? rawName : `${rawName}.mp4`;

    // Extract audio-only WAV in browser when it produces a smaller payload than heavy >1min MP4 video
    const prepared = await tryExtractCompactAudioForUpload(rawBlob, initialSafeName, report);
    const uploadBlob = prepared.blob;
    const safeName = prepared.fileName;

    if (uploadBlob.size > CHUNK_THRESHOLD_BYTES) {
      jobId = await uploadVideoInChunks(uploadBlob, safeName, report);
    } else {
      const formData = new FormData();
      formData.append('video', uploadBlob, safeName);
      formData.append('videoName', safeName);

      let startData: any = null;
      try {
        startData = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/audio/bgm/start');

          xhr.upload.onprogress = (evt) => {
            if (evt.lengthComputable && evt.total > 0) {
              const uploadPct = 5 + Math.round((evt.loaded / evt.total) * 15); // 5% -> 20%
              report(uploadPct, `Custom video ကို ပို့ဆောင်နေသည်... (${uploadPct}%)`);
            }
          };

          xhr.onload = () => {
            let parsed: any = null;
            if (typeof xhr.response === 'object' && xhr.response !== null) {
              parsed = xhr.response;
            } else {
              const raw = xhr.responseText || (typeof xhr.response === 'string' ? xhr.response : '');
              if (raw) {
                try {
                  parsed = JSON.parse(raw);
                } catch (_) {}
              }
            }

            if (xhr.status >= 200 && xhr.status < 300 && parsed?.jobId) {
              resolve(parsed);
            } else {
              const errMsg =
                parsed?.error ||
                (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0
                  ? JSON.stringify(parsed)
                  : null);
              reject(new Error(errMsg || `BGM extraction start error (HTTP ${xhr.status})`));
            }
          };

          xhr.onerror = () => {
            reject(new Error('Network error during video upload'));
          };

          xhr.send(formData);
        });
      } catch (xhrErr: any) {
        console.warn('Direct XHR upload failed, falling back to chunked upload:', xhrErr?.message);
        if (String(xhrErr?.message || '').includes('429')) {
          await new Promise((r) => setTimeout(r, 2500));
        }
        jobId = await uploadVideoInChunks(uploadBlob, safeName, report);
      }

      if (!jobId) {
        if (!startData || !startData.jobId) {
          throw new Error('BGM extraction job ID မရရှိပါ');
        }
        jobId = startData.jobId;
      }
    }
  }

  report(22, 'Demucs v4 AI ဖြင့် လူစကားပြောသံများ ဖယ်ရှားပြီး Background music.mp3 ခွဲထုတ်နေသည်...');

  // Poll job progress until completed (22% -> 100%, up to 25 min for multi-minute videos)
  // Adaptive interval (2.5s -> 5s+) keeps proxy request rate well below HTTP 429 thresholds
  const startedAt = Date.now();
  let consecutiveTransientErrors = 0;
  let consecutiveNotFound = 0;
  let consecutiveRateLimits = 0;
  let pollIntervalMs = 2500;

  while (Date.now() - startedAt < 1500000) {
    const elapsedMs = Date.now() - startedAt;
    const adaptiveDelay =
      elapsedMs > 180000 ? Math.max(pollIntervalMs, 5000)
      : elapsedMs > 60000 ? Math.max(pollIntervalMs, 3500)
      : pollIntervalMs;

    await new Promise((r) => setTimeout(r, adaptiveDelay));

    let statusRes: Response;
    try {
      statusRes = await fetch(`/api/audio/bgm/status/${encodeURIComponent(jobId)}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(30000),
      });
    } catch (_) {
      consecutiveTransientErrors++;
      if (consecutiveTransientErrors >= 15) {
        throw new Error(
          'Server နှင့် ချိတ်ဆက်မှု ယာယီပြတ်တောက်နေပါသည် (Failed to fetch)။ ထပ်မံကြိုးစားပေးပါ။'
        );
      }
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    if (statusRes.status === 429 || statusRes.status === 408) {
      consecutiveRateLimits++;
      if (consecutiveRateLimits <= 25) {
        const fallbackWait = Math.min(20000, Math.round(3000 * Math.pow(1.35, consecutiveRateLimits - 1)));
        const waitMs = statusRes.status === 429 ? getRetryAfterDelayMs(statusRes, fallbackWait) : fallbackWait;
        pollIntervalMs = Math.min(8000, Math.max(pollIntervalMs + 1000, 4000));
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw new Error('Server အလုပ်များနေပါသည် (HTTP 429)။ စက္ကန့်အနည်းငယ်စောင့်ပြီး ထပ်မံကြိုးစားပေးပါ။');
    }

    const statusData = await statusRes.json().catch(() => ({}));

    if (!statusRes.ok) {
      if (statusRes.status >= 500 && consecutiveTransientErrors < 15) {
        consecutiveTransientErrors++;
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (statusRes.status === 404 && consecutiveNotFound < 5) {
        consecutiveNotFound++;
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      throw new Error(statusData.error || `BGM status check error (HTTP ${statusRes.status})`);
    }

    consecutiveTransientErrors = 0;
    consecutiveNotFound = 0;
    consecutiveRateLimits = 0;

    if (typeof statusData.percent === 'number') {
      report(
        statusData.percent,
        statusData.stageLabel || `Background music.mp3 ခွဲထုတ်နေသည်... (${statusData.percent}%)`
      );
    }

    if (statusData.status === 'error') {
      throw new Error(statusData.error || 'Background music.mp3 ထုတ်ယူမှု မအောင်မြင်ပါ');
    }

    if (statusData.status === 'completed' && statusData.bgmUrl) {
      report(100, '100% — Background music.mp3 ရရှိပြီး BGM အဖြစ် ထည့်သွင်းပြီးပါပြီ!');
      return {
        success: true,
        bgmUrl: statusData.bgmUrl,
        engineUsed: statusData.engineUsed || 'demucs_ai',
        statusMessage: statusData.stageLabel || 'Background music.mp3 ready',
        durationSec: statusData.durationSec || 0,
      };
    }
  }

  throw new Error('BGM ထုတ်ယူမှု အချိန်ကျော်လွန်သွားပါသည်။ ထပ်မံကြိုးစားပါ။');
}
