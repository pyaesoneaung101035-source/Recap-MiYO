export interface ExtractBgmResult {
  success: boolean;
  bgmUrl: string;
  vocalUrl?: string;
  engineUsed: string;
  statusMessage: string;
  durationSec: number;
}

const CHUNK_SIZE_BYTES = Math.floor(2 * 1024 * 1024); // 2 MB per chunk
const CHUNK_THRESHOLD_BYTES = 3 * 1024 * 1024; // Use chunked upload automatically above 3 MB

function isNetworkFetchError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    err?.name === 'TypeError' ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network error') ||
    msg.includes('load failed') ||
    msg.includes('timeout')
  );
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
      if ((res.status >= 502 && res.status <= 504 || res.status === 500) && attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err: any) {
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
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
    report(chunkPct, `Custom video ကို ပို့ဆောင်နေသည်... (${idx + 1}/${totalChunks})`);

    let lastChunkErr: any = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const fd = new FormData();
        fd.append('uploadId', uploadId);
        fd.append('chunkIndex', String(idx));
        fd.append('fileName', safeName);
        fd.append('chunk', slice, safeName);

        const res = await fetch('/api/audio/bgm/upload-chunk', {
          method: 'POST',
          body: fd,
          signal: AbortSignal.timeout(60000),
        });
        const data = await res.json().catch(() => ({}));
        if ((res.status >= 502 && res.status <= 504 || res.status === 500) && attempt < 7) {
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
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(1.3, attempt)));
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
  }

  report(21, 'ဗီဒီယိုဖိုင် စုစည်းပြီး BGM ခွဲထုတ်မှု စတင်နေသည်...');
  const startRes = await fetchWithRetry('/api/audio/bgm/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId, videoName: safeName }),
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
    let uploadBlob: Blob;
    if (videoFile) {
      uploadBlob = videoFile;
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
      uploadBlob = await blobRes.blob();
    } else {
      throw new Error('ဗီဒီယိုဖိုင် မတွေ့ရှိပါ။');
    }

    // Ensure blob has a video mime type
    if (!uploadBlob.type || uploadBlob.type === 'application/octet-stream') {
      uploadBlob = new Blob([uploadBlob], { type: 'video/mp4' });
    }

    const rawName = videoFile?.name || videoName || 'custom_video.mp4';
    const safeName = rawName.includes('.') ? rawName : `${rawName}.mp4`;

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

  // Poll job progress until completed (22% -> 100%, up to 15 min)
  const startedAt = Date.now();
  let consecutiveTransientErrors = 0;

  while (Date.now() - startedAt < 900000) {
    await new Promise((r) => setTimeout(r, 700));

    let statusRes: Response;
    try {
      statusRes = await fetch(`/api/audio/bgm/status/${encodeURIComponent(jobId)}`);
    } catch (_) {
      consecutiveTransientErrors++;
      if (consecutiveTransientErrors >= 8) {
        throw new Error(
          'Server နှင့် ချိတ်ဆက်မှု ယာယီပြတ်တောက်နေပါသည် (Failed to fetch)။ ထပ်မံကြိုးစားပေးပါ။'
        );
      }
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    const statusData = await statusRes.json().catch(() => ({}));

    if (!statusRes.ok) {
      if (statusRes.status >= 500 && consecutiveTransientErrors < 8) {
        consecutiveTransientErrors++;
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw new Error(statusData.error || `BGM status check error (HTTP ${statusRes.status})`);
    }

    consecutiveTransientErrors = 0;

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
