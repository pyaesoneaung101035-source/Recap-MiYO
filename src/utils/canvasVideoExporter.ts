import { ProjectState } from '../types';
import { getInterpolatedKeyframe, getFilterCss } from './alightMotionRenderer';
import { drawCanvasSubtitle } from './canvasSubtitleRenderer';
import { clampGentleNarratorRate, getSegmentPlaybackWindow } from './timingSync';

export interface ExportCompositeOptions {
  project: ProjectState;
  width: number;
  height: number;
  videoBitsPerSecond?: number;
  forceMuteOriginalAudio?: boolean;
  onProgress?: (percent: number, statusText: string) => void;
  signal?: AbortSignal;
}

export interface ExportCompositeResult {
  blob: Blob;
  mimeType: string;
  extension: 'mp4' | 'webm';
  duration: number;
}

interface RenderScratchBuffers {
  offCanvas: HTMLCanvasElement;
  blurCanvas: HTMLCanvasElement;
  logoImg: HTMLImageElement | null;
}

function createScratchBuffers(): RenderScratchBuffers {
  return {
    offCanvas: document.createElement('canvas'),
    blurCanvas: document.createElement('canvas'),
    logoImg: null,
  };
}

function ensureCanvasSize(canvas: HTMLCanvasElement, w: number, h: number) {
  const tw = Math.max(1, Math.round(w));
  const th = Math.max(1, Math.round(h));
  if (canvas.width !== tw || canvas.height !== th) {
    canvas.width = tw;
    canvas.height = th;
  }
}

async function preloadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (url.startsWith('http') && !url.startsWith(window.location.origin)) {
      img.crossOrigin = 'anonymous';
    }
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok && img.naturalWidth > 0 ? img : null);
    };
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = url;
    if (img.complete && img.naturalWidth > 0) {
      finish(true);
    }
    setTimeout(() => finish(img.complete && img.naturalWidth > 0), 3000);
  });
}

/**
 * High-speed composite frame renderer.
 * Uses downscaled scratch blur (~0.3ms/frame instead of 200ms full-res blur)
 * so export loops maintain smooth 30 FPS without starving Chromium's decoder.
 */
export function renderCompositeCanvasFrame(
  ctx: CanvasRenderingContext2D,
  videoEl: HTMLVideoElement,
  project: ProjectState,
  canvasWidth: number,
  canvasHeight: number,
  currentTime: number,
  scratch: RenderScratchBuffers
) {
  ensureCanvasSize(scratch.offCanvas, canvasWidth, canvasHeight);
  const offCtx = scratch.offCanvas.getContext('2d');
  if (!offCtx) return;

  const vw = videoEl.videoWidth && videoEl.videoWidth > 0 ? videoEl.videoWidth : canvasWidth;
  const vh = videoEl.videoHeight && videoEl.videoHeight > 0 ? videoEl.videoHeight : canvasHeight;
  const videoAspect = vw / vh;
  const canvasAspect = canvasWidth / canvasHeight;

  const crop = project.frameCrop || {
    scale: 1.0,
    posX: 0,
    posY: 0,
    fitMode: 'contain',
    backgroundStyle: 'blur',
  };
  const kf = getInterpolatedKeyframe(project.keyframes, currentTime);

  const hasReadyVideo = videoEl.readyState >= 2 && videoEl.videoWidth > 0;

  // Check if foreground video already fills 100% of the canvas
  const coversFullCanvas =
    crop.fitMode === 'cover' &&
    (crop.scale || 1.0) >= 0.99 &&
    (kf.scale || 1.0) >= 0.99 &&
    Math.abs(kf.posX) < 1 &&
    Math.abs(kf.posY) < 1 &&
    Math.abs(crop.posX || 0) < 1 &&
    Math.abs(crop.posY || 0) < 1 &&
    Math.abs(kf.rotation) < 0.1 &&
    kf.opacity >= 0.99;

  offCtx.fillStyle = '#050505';
  offCtx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Background treatment only when letterboxed / visible behind video
  if (!coversFullCanvas && crop.backgroundStyle === 'blur' && hasReadyVideo) {
    try {
      const tinyMax = 160;
      const tinyW = canvasWidth >= canvasHeight ? tinyMax : Math.max(48, Math.round(tinyMax * canvasAspect));
      const tinyH = canvasHeight >= canvasWidth ? tinyMax : Math.max(48, Math.round(tinyMax / canvasAspect));
      ensureCanvasSize(scratch.blurCanvas, tinyW, tinyH);
      const bCtx = scratch.blurCanvas.getContext('2d');
      if (bCtx) {
        bCtx.save();
        bCtx.clearRect(0, 0, tinyW, tinyH);
        bCtx.filter = 'blur(5px) brightness(0.55)';
        let bgW = tinyW;
        let bgH = tinyH;
        if (videoAspect > canvasAspect) {
          bgH = tinyH;
          bgW = tinyH * videoAspect;
        } else {
          bgW = tinyW;
          bgH = tinyW / videoAspect;
        }
        bCtx.drawImage(videoEl, (tinyW - bgW) / 2, (tinyH - bgH) / 2, bgW, bgH);
        bCtx.restore();

        offCtx.save();
        offCtx.imageSmoothingEnabled = true;
        offCtx.imageSmoothingQuality = 'medium';
        offCtx.drawImage(scratch.blurCanvas, 0, 0, canvasWidth, canvasHeight);
        offCtx.restore();
      }
    } catch {}
  }

  // Draw foreground video frame
  offCtx.save();
  offCtx.translate(
    canvasWidth / 2 + kf.posX + (crop.posX || 0),
    canvasHeight / 2 + kf.posY + (crop.posY || 0)
  );
  if (kf.rotation !== 0) {
    offCtx.rotate((kf.rotation * Math.PI) / 180);
  }
  const finalScale = kf.scale * (crop.scale || 1.0);
  if (finalScale !== 1) {
    offCtx.scale(finalScale, finalScale);
  }
  offCtx.globalAlpha = Math.max(0, Math.min(1, kf.opacity));

  const filterStr = getFilterCss(kf.filter);
  const globalFilterStr = getFilterCss(project.globalColorFilter);
  const combinedFilter =
    [filterStr, globalFilterStr, kf.blur > 0 ? `blur(${kf.blur}px)` : '']
      .filter((f) => f !== 'none' && f !== '')
      .join(' ') || 'none';
  if (combinedFilter !== 'none') {
    offCtx.filter = combinedFilter;
  }

  let drawW = canvasWidth;
  let drawH = canvasHeight;
  if (crop.fitMode === 'cover') {
    if (videoAspect > canvasAspect) {
      drawH = canvasHeight;
      drawW = canvasHeight * videoAspect;
    } else {
      drawW = canvasWidth;
      drawH = canvasWidth / videoAspect;
    }
  } else {
    if (videoAspect > canvasAspect) {
      drawW = canvasWidth;
      drawH = canvasWidth / videoAspect;
    } else {
      drawH = canvasHeight;
      drawW = canvasHeight * videoAspect;
    }
  }

  if (hasReadyVideo) {
    try {
      offCtx.drawImage(videoEl, -drawW / 2, -drawH / 2, drawW, drawH);
    } catch {}
  }
  offCtx.restore();

  // Copy composited video scene to main export canvas
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.drawImage(scratch.offCanvas, 0, 0);

  const isLandscape = canvasWidth > canvasHeight;
  const scaleFactor = Math.max(1.0, canvasHeight / (isLandscape ? 540 : 960));

  // Fast localized Blur Boxes
  if (project.blurBoxes && project.blurBoxes.length > 0) {
    for (const box of project.blurBoxes) {
      const bx = (box.x / 100) * canvasWidth;
      const by = (box.y / 100) * canvasHeight;
      const bw = (box.width / 100) * canvasWidth;
      const bh = (box.height / 100) * canvasHeight;

      if (bw > 0 && bh > 0) {
        const sx = Math.max(0, Math.min(canvasWidth - 1, bx));
        const sy = Math.max(0, Math.min(canvasHeight - 1, by));
        const sw = Math.max(1, Math.min(canvasWidth - sx, bw));
        const sh = Math.max(1, Math.min(canvasHeight - sy, bh));

        const tinyBoxW = Math.max(12, Math.min(140, Math.round(sw / 8)));
        const tinyBoxH = Math.max(12, Math.min(140, Math.round(sh / 8)));
        ensureCanvasSize(scratch.blurCanvas, tinyBoxW, tinyBoxH);
        const bCtx = scratch.blurCanvas.getContext('2d');

        ctx.save();
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(bx, by, bw, bh, 6 * scaleFactor);
        } else {
          ctx.rect(bx, by, bw, bh);
        }
        ctx.clip();

        if (bCtx) {
          bCtx.save();
          bCtx.clearRect(0, 0, tinyBoxW, tinyBoxH);
          const blurFactor = Math.max(2, Math.min(8, ((box.blurAmount || 20) / 20) * 3));
          bCtx.filter = `blur(${blurFactor}px) brightness(0.8)`;
          bCtx.drawImage(scratch.offCanvas, sx, sy, sw, sh, 0, 0, tinyBoxW, tinyBoxH);
          bCtx.restore();

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'medium';
          ctx.drawImage(scratch.blurCanvas, 0, 0, tinyBoxW, tinyBoxH, bx, by, bw, bh);
        }

        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.restore();
      }
    }
  }

  // Active Myanmar Subtitle
  const activeSeg = project.segments.find((s) => {
    const rate = clampGentleNarratorRate(
      s.atempoRate || s.playbackRate || project.voicePlaybackRate || 1.0
    );
    const subStart = s.subtitleStartTime ?? s.startTime;
    const baseSubEnd = s.subtitleEndTime ?? s.endTime;
    const segEnd =
      s.subtitleEndTime !== undefined
        ? baseSubEnd
        : Math.max(baseSubEnd, subStart + (s.audioDuration ? s.audioDuration / rate : 0));
    return currentTime >= subStart && currentTime <= segEnd;
  });

  if (activeSeg) {
    const text = activeSeg.myanmarTranslation || activeSeg.originalText;
    if (text) {
      drawCanvasSubtitle({
        ctx,
        text,
        settings: project.subtitleSettings,
        canvasWidth,
        canvasHeight,
        scaleFactor,
      });
    }
  }

  // Preloaded Logo Watermark
  if (project.logoConfig && project.logoConfig.imageUrl && scratch.logoImg?.complete) {
    try {
      ctx.save();
      const logoSize = (project.logoConfig.size || 80) * (canvasWidth / 1280);
      const logoX = (project.logoConfig.x / 100) * canvasWidth;
      const logoY = (project.logoConfig.y / 100) * canvasHeight;
      ctx.globalAlpha = project.logoConfig.opacity ?? 1;

      if (project.logoConfig.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
        ctx.clip();
      }

      ctx.drawImage(scratch.logoImg, logoX, logoY, logoSize, logoSize);
      ctx.restore();
    } catch {}
  }

  // Animated Text Watermark
  if (project.logoConfig && project.logoConfig.textWatermark) {
    ctx.save();
    const txt = project.logoConfig.textWatermark;
    const txtSize = (project.logoConfig.textWatermarkSize || 24) * (canvasWidth / 1280);
    ctx.font = `bold ${txtSize}px 'Pyidaungsu', 'Noto Sans Myanmar', sans-serif`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const speed = project.logoConfig.textWatermarkSpeed || 30;
    const yPos = (((currentTime * speed) % 100) / 100) * canvasHeight;
    ctx.fillText(txt, canvasWidth * 0.1, yPos);
    ctx.restore();
  }
}

/**
 * Exports a composite MP4/WebM video with synchronized live video frames,
 * mixed voice clones, vocal-removed BGM, blur boxes, watermarks, and Myanmar subtitles.
 */
export async function exportCompositeVideo({
  project,
  width,
  height,
  videoBitsPerSecond = 8000000,
  forceMuteOriginalAudio = false,
  onProgress,
  signal,
}: ExportCompositeOptions): Promise<ExportCompositeResult> {
  if (!project.videoUrl) {
    throw new Error('ဗီဒီယို ဖိုင် မရှိသေးပါ။');
  }

  onProgress?.(1, 'Initializing Video & Audio Engines...');

  const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
  const audioCtx = new AudioCtxClass();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = width;
  exportCanvas.height = height;
  // Attach unobtrusively to DOM so compositor keeps captureStream active
  exportCanvas.style.position = 'fixed';
  exportCanvas.style.width = '4px';
  exportCanvas.style.height = '4px';
  exportCanvas.style.opacity = '0.02';
  exportCanvas.style.pointerEvents = 'none';
  exportCanvas.style.top = '0';
  exportCanvas.style.left = '0';
  exportCanvas.style.zIndex = '1';
  document.body.appendChild(exportCanvas);

  const ctx = exportCanvas.getContext('2d');
  if (!ctx) {
    document.body.removeChild(exportCanvas);
    await audioCtx.close().catch(() => {});
    throw new Error('Cannot get canvas 2D context');
  }

  // Keep video element non-tiny and visible-opacity inside viewport so Chromium NEVER suspends video frame decoding
  const renderVideo = document.createElement('video');
  const videoUrl = project.videoUrl;
  if (videoUrl.startsWith('http') && !videoUrl.startsWith(window.location.origin)) {
    renderVideo.crossOrigin = 'anonymous';
  }
  renderVideo.preload = 'auto';
  renderVideo.playsInline = true;
  renderVideo.src = videoUrl;
  renderVideo.style.position = 'fixed';
  renderVideo.style.width = '320px';
  renderVideo.style.height = '180px';
  renderVideo.style.opacity = '0.02';
  renderVideo.style.pointerEvents = 'none';
  renderVideo.style.top = '0';
  renderVideo.style.left = '0';
  renderVideo.style.zIndex = '1';
  document.body.appendChild(renderVideo);

  let animFrameId: number | null = null;
  let safetyTimerId: number | null = null;
  let combinedStream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;

  const cleanup = () => {
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
    if (safetyTimerId !== null) {
      window.clearInterval(safetyTimerId);
      safetyTimerId = null;
    }
    try {
      renderVideo.pause();
      renderVideo.removeAttribute('src');
      renderVideo.load();
    } catch {}
    try {
      if (document.body.contains(renderVideo)) document.body.removeChild(renderVideo);
    } catch {}
    try {
      if (document.body.contains(exportCanvas)) document.body.removeChild(exportCanvas);
    } catch {}
    if (combinedStream) {
      combinedStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
      combinedStream = null;
    }
    if (audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {});
    }
  };

  try {
    // Wait until actual video frame data is decoded (readyState >= 2 & videoWidth > 0)
    await new Promise<void>((resolve, reject) => {
      if (renderVideo.readyState >= 2 && renderVideo.videoWidth > 0) {
        resolve();
        return;
      }
      let settled = false;
      const done = () => {
        if (settled) return;
        if (renderVideo.readyState >= 2 && renderVideo.videoWidth > 0) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      };
      const timer = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve();
        }
      }, 10000);
      renderVideo.onloadeddata = done;
      renderVideo.oncanplay = done;
      renderVideo.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('Failed to load video for export'));
        }
      };
      renderVideo.load();
    });

    if (signal?.aborted) throw new Error('Export cancelled');

    const scratch = createScratchBuffers();
    if (project.logoConfig?.imageUrl) {
      scratch.logoImg = await preloadImage(project.logoConfig.imageUrl);
    }

    let rawVideoDuration = 0;
    if (
      renderVideo.duration &&
      isFinite(renderVideo.duration) &&
      !isNaN(renderVideo.duration) &&
      renderVideo.duration > 0
    ) {
      rawVideoDuration = renderVideo.duration;
    } else if (
      project.videoDuration &&
      isFinite(project.videoDuration) &&
      !isNaN(project.videoDuration) &&
      project.videoDuration > 0
    ) {
      rawVideoDuration = project.videoDuration;
    }

    const maxAudioEnd = project.segments.reduce((max, s) => {
      const rate = clampGentleNarratorRate(
        s.atempoRate || s.playbackRate || project.voicePlaybackRate || 1.0
      );
      const segEnd = Math.max(
        s.endTime,
        s.startTime + (s.audioDuration ? s.audioDuration / rate : 0) + 0.15
      );
      return Math.max(max, segEnd);
    }, 0);

    const videoSpeedMultiplier = project.playbackRate || 1.0;
    const effectiveVideoDuration =
      rawVideoDuration > 0 ? rawVideoDuration / videoSpeedMultiplier : 0;
    let totalDuration = Math.max(
      effectiveVideoDuration,
      maxAudioEnd,
      project.videoDuration || 0,
      3.0
    );

    const dest = audioCtx.createMediaStreamDestination();

    // Original Video Audio Handling
    const useExtractedBgm = Boolean(
      project.extractedBgmUrl &&
      (forceMuteOriginalAudio ? project.useExtractedBgm !== false : project.useExtractedBgm)
    );
    const hasClonedVoices = project.segments.some((s) => Boolean(s.audioUrl));
    const isVoiceMuted = project.isVoiceMuted ?? false;
    const isOriginalMuted = Boolean(
      forceMuteOriginalAudio ||
        project.isMuted ||
        useExtractedBgm ||
        (hasClonedVoices && !isVoiceMuted) ||
        (project.volume !== undefined && project.volume === 0)
    );
    const effectiveVideoGain = isOriginalMuted ? 0 : project.volume ?? 1.0;

    if (isOriginalMuted) {
      renderVideo.defaultMuted = true;
      renderVideo.muted = true;
      renderVideo.volume = 0;
    } else {
      renderVideo.muted = false;
      try {
        const videoSourceNode = audioCtx.createMediaElementSource(renderVideo);
        const videoGain = audioCtx.createGain();
        videoGain.gain.value = effectiveVideoGain;
        videoSourceNode.connect(videoGain);
        videoGain.connect(dest);
      } catch (e) {
        console.warn('Video audio node connect notice:', e);
      }
    }

    // Extracted BGM Track
    let bgmSourceNode: AudioBufferSourceNode | null = null;
    let bgmGainNode: GainNode | null = null;
    const targetBgmVol = Math.max(0, Math.min(1, project.bgmVolume ?? 0.45));

    if (useExtractedBgm && project.extractedBgmUrl && targetBgmVol > 0) {
      try {
        onProgress?.(4, 'Loading Background Music...');
        const bgmRes = await fetch(project.extractedBgmUrl);
        if (bgmRes.ok) {
          const bgmArrayBuf = await bgmRes.arrayBuffer();
          const decodedBgm = await audioCtx.decodeAudioData(bgmArrayBuf);
          bgmSourceNode = audioCtx.createBufferSource();
          bgmSourceNode.buffer = decodedBgm;
          bgmSourceNode.playbackRate.value = 1.0;
          bgmGainNode = audioCtx.createGain();
          bgmGainNode.gain.value = targetBgmVol;
          bgmSourceNode.connect(bgmGainNode);
          bgmGainNode.connect(dest);
        }
      } catch (bgmErr) {
        console.warn('Extracted BGM load warning in export:', bgmErr);
      }
    }

    // Voice Clone Audio Segments
    const effectiveVoiceGain = isVoiceMuted ? 0 : project.voiceVolume ?? 1.0;
    const audioSources: {
      node: AudioBufferSourceNode;
      startTime: number;
      gainNode: GainNode;
      duration: number;
    }[] = [];

    const sortedExportSegs = [...project.segments].sort((a, b) => a.startTime - b.startTime);
    let exportCursor = 0;
    for (let i = 0; i < sortedExportSegs.length; i++) {
      if (signal?.aborted) throw new Error('Export cancelled');
      const seg = sortedExportSegs[i];
      if (seg.audioUrl) {
        try {
          const res = await fetch(seg.audioUrl);
          const arrayBuf = await res.arrayBuffer();
          const decoded = await audioCtx.decodeAudioData(arrayBuf);

          const win = getSegmentPlaybackWindow(
            sortedExportSegs,
            i,
            project.voicePlaybackRate || 1.0
          );
          const rate = clampGentleNarratorRate(
            seg.atempoRate || seg.playbackRate || project.voicePlaybackRate || 1.0
          );
          const source = audioCtx.createBufferSource();
          source.buffer = decoded;
          source.playbackRate.value = rate;

          const gain = audioCtx.createGain();
          gain.gain.value = 0;
          source.connect(gain);
          gain.connect(dest);

          const fullDur = decoded.duration / rate;
          const scheduledStart = Math.max(exportCursor, Math.max(0, win.startTime));
          exportCursor = scheduledStart + fullDur + 0.04;

          audioSources.push({
            node: source,
            startTime: scheduledStart,
            gainNode: gain,
            duration: fullDur,
          });
        } catch (audioErr) {
          console.warn('Voice segment load error:', audioErr);
        }
      }
    }

    totalDuration = Math.max(totalDuration, exportCursor + 0.15);

    // Silent keep-alive clock so MediaStreamAudioDestinationNode always outputs audio packets from t=0
    const keepAliveNode = audioCtx.createConstantSource();
    keepAliveNode.offset.value = 0;
    const keepAliveGain = audioCtx.createGain();
    keepAliveGain.gain.value = 0;
    keepAliveNode.connect(keepAliveGain);
    keepAliveGain.connect(dest);

    // Seek video to 0.0 and confirm frame 0 is decoded before starting MediaRecorder
    if (Math.abs(renderVideo.currentTime) > 0.04) {
      renderVideo.currentTime = 0;
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          renderVideo.removeEventListener('seeked', onSeeked);
          resolve();
        };
        renderVideo.addEventListener('seeked', onSeeked);
        setTimeout(() => {
          renderVideo.removeEventListener('seeked', onSeeked);
          resolve();
        }, 1200);
      });
    }

    renderVideo.playbackRate = videoSpeedMultiplier;
    try {
      await renderVideo.play();
    } catch {
      // Fallback: if unmuted autoplay was rejected after async awaits, mute element so video frames NEVER freeze
      renderVideo.muted = true;
      await renderVideo.play().catch((err) => {
        console.warn('renderVideo.play() fallback notice:', err);
      });
    }

    // Draw initial frame 0 onto canvas before capturing stream
    renderCompositeCanvasFrame(ctx, renderVideo, project, width, height, 0, scratch);

    const canvasStream = exportCanvas.captureStream(30);
    const videoTrack = canvasStream.getVideoTracks()[0];
    combinedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);

    const preferredMimeTypes = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1.4D401E,mp4a.40.2',
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4;codecs=h264,aac',
      'video/mp4',
      'video/webm;codecs=h264,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];

    let chosenMimeType = 'video/mp4';
    for (const t of preferredMimeTypes) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
        chosenMimeType = t;
        break;
      }
    }

    recorder = new MediaRecorder(combinedStream, {
      mimeType: chosenMimeType,
      videoBitsPerSecond,
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const resultPromise = new Promise<ExportCompositeResult>((resolve, reject) => {
      recorder!.onstop = async () => {
        try {
          const isNativeMp4 = chosenMimeType.includes('mp4');
          const rawBlob = new Blob(chunks, { type: chosenMimeType });
          cleanup();

          if (!isNativeMp4) {
            onProgress?.(99, 'Converting to MP4...');
            try {
              const formData = new FormData();
              formData.append('video', rawBlob, 'export_raw.webm');
              const remuxRes = await fetch('/api/video/remux-mp4', {
                method: 'POST',
                body: formData,
              });
              if (remuxRes.ok) {
                const mp4Blob = await remuxRes.blob();
                if (mp4Blob.size > 0) {
                  resolve({
                    blob: mp4Blob,
                    mimeType: 'video/mp4',
                    extension: 'mp4',
                    duration: totalDuration,
                  });
                  return;
                }
              }
            } catch (remuxErr) {
              console.warn('WebM->MP4 remux skipped:', remuxErr);
            }
          }

          resolve({
            blob: rawBlob,
            mimeType: isNativeMp4 ? 'video/mp4' : chosenMimeType,
            extension: isNativeMp4 ? 'mp4' : 'webm',
            duration: totalDuration,
          });
        } catch (err) {
          cleanup();
          reject(err);
        }
      };

      recorder!.onerror = (e: any) => {
        cleanup();
        reject(new Error(e?.error?.message || 'MediaRecorder error'));
      };
    });

    const startTimeReal = audioCtx.currentTime;
    keepAliveNode.start(startTimeReal);
    keepAliveNode.stop(startTimeReal + totalDuration + 0.2);

    if (bgmSourceNode && bgmGainNode) {
      try {
        bgmGainNode.gain.setValueAtTime(targetBgmVol, startTimeReal);
        if (effectiveVoiceGain > 0 && audioSources.length > 0) {
          const duckedVol = Math.max(0.04, targetBgmVol * 0.35);
          audioSources.forEach(({ startTime, duration }) => {
            const tStart = startTimeReal + startTime;
            const tEnd = tStart + duration;
            bgmGainNode!.gain.setValueAtTime(targetBgmVol, Math.max(startTimeReal, tStart - 0.08));
            bgmGainNode!.gain.linearRampToValueAtTime(duckedVol, tStart + 0.05);
            bgmGainNode!.gain.setValueAtTime(duckedVol, Math.max(tStart + 0.05, tEnd - 0.05));
            bgmGainNode!.gain.linearRampToValueAtTime(targetBgmVol, tEnd + 0.12);
          });
        }
        bgmSourceNode.start(startTimeReal);
        bgmSourceNode.stop(startTimeReal + totalDuration + 0.15);
      } catch (bgmStartErr) {
        console.warn('BGM schedule notice:', bgmStartErr);
      }
    }

    audioSources.forEach(({ node, startTime, gainNode, duration }) => {
      try {
        const tStart = startTimeReal + startTime;
        const tEnd = tStart + duration;
        gainNode.gain.setValueAtTime(0.0001, tStart);
        gainNode.gain.linearRampToValueAtTime(effectiveVoiceGain, Math.min(tEnd, tStart + 0.008));
        gainNode.gain.setValueAtTime(effectiveVoiceGain, Math.max(tStart + 0.008, tEnd - 0.012));
        gainNode.gain.linearRampToValueAtTime(0.0001, tEnd);

        node.start(tStart);
        node.stop(tEnd + 0.06);
      } catch (startErr) {
        console.warn('Audio node start notice:', startErr);
      }
    });

    recorder.start(500);

    let lastRenderPerf = 0;
    let lastProgressPct = 0;
    let lastSeekSyncPerf = 0;
    let stopped = false;

    const stepFrame = () => {
      if (stopped || !recorder || recorder.state !== 'recording') return;

      if (signal?.aborted) {
        stopped = true;
        recorder.stop();
        return;
      }

      const now = performance.now();
      if (now - lastRenderPerf < 24) {
        return; // ~30-40 FPS cap
      }
      lastRenderPerf = now;

      const elapsed = audioCtx.currentTime - startTimeReal;
      const curTime = Math.min(elapsed, totalDuration);

      // Active playback watchdog: keep <video> decoding and aligned to audio clock
      const targetVideoTime = curTime * videoSpeedMultiplier;
      if (rawVideoDuration > 0 && targetVideoTime < rawVideoDuration - 0.08) {
        if (renderVideo.paused && !renderVideo.ended) {
          renderVideo.play().catch(() => {
            renderVideo.muted = true;
            renderVideo.play().catch(() => {});
          });
        }
        const drift = Math.abs(renderVideo.currentTime - targetVideoTime);
        if (drift > 0.35 && !renderVideo.seeking && now - lastSeekSyncPerf > 450) {
          lastSeekSyncPerf = now;
          try {
            renderVideo.currentTime = targetVideoTime;
          } catch {}
        }
      }

      renderCompositeCanvasFrame(ctx, renderVideo, project, width, height, curTime, scratch);

      if (videoTrack && typeof (videoTrack as any).requestFrame === 'function') {
        try {
          (videoTrack as any).requestFrame();
        } catch {}
      }

      const pct = Math.min(98, Math.max(5, Math.round((curTime / totalDuration) * 100)));
      if (pct !== lastProgressPct) {
        lastProgressPct = pct;
        onProgress?.(pct, `Rendering Video (${pct}%)...`);
      }

      if (elapsed >= totalDuration) {
        stopped = true;
        if (recorder.state === 'recording') {
          recorder.stop();
        }
        renderVideo.pause();
      }
    };

    const rafLoop = () => {
      if (stopped) return;
      stepFrame();
      if (!stopped) {
        animFrameId = requestAnimationFrame(rafLoop);
      }
    };

    animFrameId = requestAnimationFrame(rafLoop);
    // Fallback timer ensures frame capture continues even if rAF is throttled in background tabs
    safetyTimerId = window.setInterval(stepFrame, 33);

    return await resultPromise;
  } catch (err) {
    cleanup();
    throw err;
  }
}
