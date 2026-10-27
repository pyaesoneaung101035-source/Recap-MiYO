import React, { useState, useRef, useEffect } from 'react';
import {
  Download,
  Video,
  CheckCircle2,
  History,
  Trash2,
  Film,
  Sparkles,
  ArrowLeft,
  Clock,
  FileText,
  Volume2,
  VolumeX,
  Mic,
  Play,
} from 'lucide-react';
import { ProjectState, TranscriptSegment } from '../types';
import { getInterpolatedKeyframe, getFilterCss, generateSrtContent, downloadFile } from '../utils/alightMotionRenderer';
import { VideoPlayerView } from './VideoPlayerView';

interface ExportHistoryItem {
  id: string;
  filename: string;
  blobUrl: string;
  timestamp: string;
  duration: number;
  resolution: string;
  aspectRatio: string;
  sizeMb: string;
  segmentCount: number;
}

interface Step8ExportStudioProps {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  onPrevStep: () => void;
}

export const Step8ExportStudio: React.FC<Step8ExportStudioProps> = ({
  project,
  setProject,
  onPrevStep,
}) => {
  const [frameSize, setFrameSize] = useState<'tiktok' | 'youtube' | 'square' | 'portrait'>('tiktok');
  const [exportQuality, setExportQuality] = useState<'4k' | '1080p' | '720p' | '480p'>('1080p');
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportStatusText, setExportStatusText] = useState<string>('');
  
  const [currentExportUrl, setCurrentExportUrl] = useState<string | null>(null);
  const [currentExportFilename, setCurrentExportFilename] = useState<string>('');

  const [historyItems, setHistoryItems] = useState<ExportHistoryItem[]>([]);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      const savedHistory = localStorage.getItem('recap_export_history_meta');
      if (savedHistory) {
        const parsed = JSON.parse(savedHistory);
        setHistoryItems(parsed);
      }
    } catch (e) {
      console.warn('Failed to load export history:', e);
    }
  }, []);

  const getCanvasDimensions = (type: string, quality: '4k' | '1080p' | '720p' | '480p' = exportQuality) => {
    let baseWidth = 1080;
    let baseHeight = 1920;

    switch (type) {
      case 'tiktok':
        baseWidth = 1080; baseHeight = 1920; break;
      case 'youtube':
        baseWidth = 1920; baseHeight = 1080; break;
      case 'portrait':
        baseWidth = 1080; baseHeight = 1350; break;
      case 'square':
        baseWidth = 1080; baseHeight = 1080; break;
      default:
        baseWidth = 1080; baseHeight = 1920; break;
    }

    let scale = 1.0;
    if (quality === '4k') scale = 2.0;
    if (quality === '720p') scale = 0.6667;
    if (quality === '480p') scale = 0.4444;

    const width = Math.round(baseWidth * scale);
    const height = Math.round(baseHeight * scale);
    const label = `${width}x${height} (${quality.toUpperCase()})`;

    return { width, height, label };
  };

  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const getOffscreenCanvas = (width: number, height: number) => {
    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = document.createElement('canvas');
    }
    if (
      offscreenCanvasRef.current.width !== width ||
      offscreenCanvasRef.current.height !== height
    ) {
      offscreenCanvasRef.current.width = width;
      offscreenCanvasRef.current.height = height;
    }
    return offscreenCanvasRef.current;
  };

  const renderCanvasFrame = (
    ctx: CanvasRenderingContext2D,
    videoEl: HTMLVideoElement,
    canvasWidth: number,
    canvasHeight: number,
    currentTime: number
  ) => {
    const offCanvas = getOffscreenCanvas(canvasWidth, canvasHeight);
    const offCtx = offCanvas.getContext('2d');
    if (!offCtx) return;

    offCtx.clearRect(0, 0, canvasWidth, canvasHeight);

    if (project.frameCrop?.backgroundStyle === 'blur') {
      offCtx.save();
      offCtx.filter = 'blur(25px) brightness(0.6)';
      try {
        offCtx.drawImage(videoEl, 0, 0, canvasWidth, canvasHeight);
      } catch {}
      offCtx.restore();
    } else {
      offCtx.fillStyle = '#050505';
      offCtx.fillRect(0, 0, canvasWidth, canvasHeight);
    }

    const kf = getInterpolatedKeyframe(project.keyframes, currentTime);
    const crop = project.frameCrop || { scale: 1.0, posX: 0, posY: 0, fitMode: 'cover', backgroundStyle: 'blur' };

    offCtx.save();

    let shakeOffsetX = 0;
    let shakeOffsetY = 0;
    if (kf.shakeIntensity > 0) {
      shakeOffsetX = (Math.random() - 0.5) * kf.shakeIntensity * 4;
      shakeOffsetY = (Math.random() - 0.5) * kf.shakeIntensity * 4;
    }

    offCtx.translate(
      canvasWidth / 2 + kf.posX + shakeOffsetX + (crop.posX || 0),
      canvasHeight / 2 + kf.posY + shakeOffsetY + (crop.posY || 0)
    );
    offCtx.rotate((kf.rotation * Math.PI) / 180);
    offCtx.scale(kf.scale * (crop.scale || 1.0), kf.scale * (crop.scale || 1.0));
    offCtx.globalAlpha = Math.max(0, Math.min(1, kf.opacity));

    const filterStr = getFilterCss(kf.filter);
    const globalFilterStr = getFilterCss(project.globalColorFilter);
    const combinedFilter = [filterStr, globalFilterStr, kf.blur > 0 ? `blur(${kf.blur}px)` : ''].filter(f => f !== 'none' && f !== '').join(' ') || 'none';
    if (combinedFilter !== 'none') {
      offCtx.filter = combinedFilter;
    }

    try {
      if (videoEl.readyState >= 2) {
        offCtx.drawImage(
          videoEl,
          -canvasWidth / 2,
          -canvasHeight / 2,
          canvasWidth,
          canvasHeight
        );
      }
    } catch {}

    offCtx.restore();

    // Clear main canvas & draw the rendered video scene from offscreen canvas
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(offCanvas, 0, 0);

    // Apply Blur Boxes over the rendered video scene
    if (project.blurBoxes && project.blurBoxes.length > 0) {
      for (const box of project.blurBoxes) {
        const bx = (box.x / 100) * canvasWidth;
        const by = (box.y / 100) * canvasHeight;
        const bw = (box.width / 100) * canvasWidth;
        const bh = (box.height / 100) * canvasHeight;

        if (bw > 0 && bh > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(bx, by, bw, bh);
          ctx.clip();

          const blurPx = Math.max(12, (box.blurAmount || 16) * (canvasWidth / 640));
          ctx.filter = `blur(${blurPx}px) brightness(0.85)`;

          // Draw offscreen rendered frame through blur filter
          ctx.drawImage(offCanvas, 0, 0);

          ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
          ctx.fillRect(bx, by, bw, bh);

          ctx.restore();
        }
      }
    }

    const activeSeg = project.segments.find((s) => {
      const segEnd = Math.max(s.endTime, s.startTime + (s.audioDuration || 0));
      return currentTime >= s.startTime && currentTime <= segEnd;
    });

    if (activeSeg) {
      const text = activeSeg.myanmarTranslation || activeSeg.originalText;
      if (text) {
        const settings = project.subtitleSettings;
        ctx.save();

        const fontSize = (canvasWidth / 640) * settings.fontSize;
        ctx.font = `700 ${fontSize}px '${settings.fontFamily}', 'Pyidaungsu', 'Noto Sans Myanmar', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        let posY = canvasHeight - 120;
        if (settings.positionY === 'center') posY = canvasHeight / 2;
        if (settings.positionY === 'top') posY = 120;

        const offsetX = ((settings.offsetX || 0) / 360) * canvasWidth;
        const offsetY = ((settings.offsetY || 0) / 640) * canvasHeight;

        const metrics = ctx.measureText(text);
        const bgWidth = metrics.width + 36;
        const bgHeight = fontSize + 24;

        if (settings.backgroundColor && settings.backgroundColor !== 'transparent') {
          ctx.fillStyle = settings.backgroundColor;
          ctx.beginPath();
          ctx.roundRect(
            canvasWidth / 2 + offsetX - bgWidth / 2,
            posY + offsetY - bgHeight / 2,
            bgWidth,
            bgHeight,
            12
          );
          ctx.fill();
        }

        if (settings.strokeWidth > 0) {
          ctx.strokeStyle = settings.strokeColor || '#000000';
          ctx.lineWidth = settings.strokeWidth * 2;
          ctx.strokeText(text, canvasWidth / 2 + offsetX, posY + offsetY);
        }

        ctx.fillStyle = settings.color || '#ffffff';
        ctx.fillText(text, canvasWidth / 2 + offsetX, posY + offsetY);
        ctx.restore();
      }
    }

    if (project.logoConfig && project.logoConfig.imageUrl) {
      try {
        const logoImg = new Image();
        logoImg.crossOrigin = 'anonymous';
        logoImg.src = project.logoConfig.imageUrl;
        if (logoImg.complete) {
          ctx.save();
          const logoSize = (project.logoConfig.size || 80) * (canvasWidth / 1280);
          const logoX = (project.logoConfig.x / 100) * canvasWidth;
          const logoY = (project.logoConfig.y / 100) * canvasHeight;
          ctx.globalAlpha = project.logoConfig.opacity ?? 1;

          if (project.logoConfig.shape === 'circle') {
            ctx.beginPath();
            ctx.arc(
              logoX + logoSize / 2,
              logoY + logoSize / 2,
              logoSize / 2,
              0,
              Math.PI * 2
            );
            ctx.clip();
          }

          ctx.drawImage(logoImg, logoX, logoY, logoSize, logoSize);
          ctx.restore();
        }
      } catch {}
    }

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
  };

  const handleExportMp4Video = async () => {
    if (!project.videoUrl) {
      alert('ဗီဒီယို ဖိုင် မရှိသေးပါ။ အဆင့် 2 တွင် Custom Video တင်သွင်းပါ။');
      return;
    }

    setIsExporting(true);
    setExportProgress(1);
    setExportStatusText('Initializing Video & Audio Engines...');
    setCurrentExportUrl(null);

    const { width, height } = getCanvasDimensions(frameSize, exportQuality);
    let renderVideo: HTMLVideoElement | null = null;

    try {
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = width;
      exportCanvas.height = height;
      const ctx = exportCanvas.getContext('2d');
      if (!ctx) throw new Error('Cannot get canvas context');

      // Create video element and attach off-screen to DOM to prevent browser rendering throttling
      renderVideo = document.createElement('video');
      renderVideo.src = project.videoUrl;
      renderVideo.crossOrigin = 'anonymous';
      renderVideo.muted = false; // Must be false so AudioContext can capture audio if unmuted
      renderVideo.playsInline = true;
      renderVideo.style.position = 'fixed';
      renderVideo.style.width = '1px';
      renderVideo.style.height = '1px';
      renderVideo.style.opacity = '0.001';
      renderVideo.style.pointerEvents = 'none';
      renderVideo.style.bottom = '0';
      renderVideo.style.right = '0';
      document.body.appendChild(renderVideo);

      await new Promise<void>((resolve, reject) => {
        if (renderVideo && renderVideo.readyState >= 2) {
          resolve();
          return;
        }
        const onReady = () => resolve();
        renderVideo!.onloadeddata = onReady;
        renderVideo!.oncanplay = onReady;
        renderVideo!.onloadedmetadata = onReady;
        renderVideo!.onerror = () => reject(new Error('Failed to load video for export'));
        setTimeout(resolve, 3000); // Safety fallback
      });

      let rawVideoDuration = 0;
      if (renderVideo.duration && isFinite(renderVideo.duration) && !isNaN(renderVideo.duration) && renderVideo.duration > 0) {
        rawVideoDuration = renderVideo.duration;
      } else if (project.videoDuration && isFinite(project.videoDuration) && !isNaN(project.videoDuration) && project.videoDuration > 0) {
        rawVideoDuration = project.videoDuration;
      }

      const maxAudioEnd = project.segments.reduce((max, s) => {
        const segEnd = Math.max(s.endTime, s.startTime + (s.audioDuration || 0));
        return Math.max(max, segEnd);
      }, 0);

      const videoSpeedMultiplier = project.playbackRate || 1.0;
      const effectiveVideoDuration = rawVideoDuration > 0 ? (rawVideoDuration / videoSpeedMultiplier) : 0;
      const totalDuration = Math.max(effectiveVideoDuration, maxAudioEnd, project.videoDuration || 0, 3.0);

      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtxClass();
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const dest = audioCtx.createMediaStreamDestination();

      // Original Video Audio Handling:
      // USER REQUIREMENT: If original video sound is muted, original sound must be completely silenced (gain = 0)
      const isOriginalMuted = project.isMuted || (project.volume !== undefined && project.volume === 0);
      const effectiveVideoGain = isOriginalMuted ? 0 : (project.volume ?? 1.0);

      try {
        const videoSourceNode = audioCtx.createMediaElementSource(renderVideo);
        const videoGain = audioCtx.createGain();
        videoGain.gain.value = effectiveVideoGain;
        videoSourceNode.connect(videoGain);
        videoGain.connect(dest);
      } catch (e) {
        console.warn('Video audio node connect notice:', e);
      }

      // Voice Clone Audio Handling:
      const isVoiceMuted = project.isVoiceMuted ?? false;
      const effectiveVoiceGain = isVoiceMuted ? 0 : (project.voiceVolume ?? 1.0);

      const audioSources: { node: AudioBufferSourceNode; startTime: number }[] = [];

      for (const seg of project.segments) {
        if (seg.audioUrl) {
          try {
            const res = await fetch(seg.audioUrl);
            const arrayBuf = await res.arrayBuffer();
            const decoded = await audioCtx.decodeAudioData(arrayBuf);

            const source = audioCtx.createBufferSource();
            source.buffer = decoded;
            source.playbackRate.value = seg.playbackRate || project.voicePlaybackRate || 1.0;

            const gain = audioCtx.createGain();
            gain.gain.value = effectiveVoiceGain;
            source.connect(gain);
            gain.connect(dest);

            audioSources.push({
              node: source,
              startTime: Math.max(0, seg.startTime),
            });
          } catch (audioErr) {
            console.warn('Voice segment load error:', audioErr);
          }
        }
      }

      const canvasStream = exportCanvas.captureStream(30);
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...dest.stream.getAudioTracks(),
      ]);

      const preferredMimeTypes = [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4;codecs=h264,aac',
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm',
      ];

      let chosenMimeType = 'video/mp4';
      for (const t of preferredMimeTypes) {
        if (MediaRecorder.isTypeSupported(t)) {
          chosenMimeType = t;
          break;
        }
      }

      let bps = 8000000;
      if (exportQuality === '4k') bps = 16000000;
      if (exportQuality === '720p') bps = 4500000;
      if (exportQuality === '480p') bps = 2000000;

      const recorder = new MediaRecorder(combinedStream, {
        mimeType: chosenMimeType,
        videoBitsPerSecond: bps,
      });
      recorderRef.current = recorder;

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      renderVideo.currentTime = 0;
      renderVideo.playbackRate = videoSpeedMultiplier;
      try {
        await renderVideo.play();
      } catch (playErr) {
        console.warn('renderVideo.play() handled:', playErr);
      }

      const startTimeReal = audioCtx.currentTime;
      audioSources.forEach(({ node, startTime }) => {
        try {
          node.start(startTimeReal + startTime);
        } catch (startErr) {
          console.warn('Audio node start notice:', startErr);
        }
      });

      recorder.start(100);

      const renderLoop = () => {
        if (!recorderRef.current || recorderRef.current.state !== 'recording') return;

        const elapsed = audioCtx.currentTime - startTimeReal;
        const curTime = Math.min(elapsed, totalDuration);

        if (renderVideo) {
          renderCanvasFrame(ctx, renderVideo, width, height, curTime);
        }

        const pct = Math.min(99, Math.round((curTime / totalDuration) * 100));
        setExportProgress(pct);
        setExportStatusText(`Rendering Video (${pct}%)...`);

        // Record for the entire total duration so no audio or video is truncated
        if (elapsed < totalDuration) {
          animFrameRef.current = requestAnimationFrame(renderLoop);
        } else {
          if (recorderRef.current && recorderRef.current.state === 'recording') {
            recorderRef.current.stop();
          }
          if (renderVideo) {
            renderVideo.pause();
          }
        }
      };

      animFrameRef.current = requestAnimationFrame(renderLoop);

      recorder.onstop = () => {
        try {
          if (renderVideo && document.body.contains(renderVideo)) {
            document.body.removeChild(renderVideo);
          }
        } catch {}

        setExportProgress(100);
        setIsExporting(false);
        setExportStatusText('Export Complete!');

        const cleanBaseName = (project.videoName || 'recap').replace(/\.[^/.]+$/, '');
        const filename = `${cleanBaseName}_final_recap.mp4`;

        const videoBlob = new Blob(chunks, { type: chosenMimeType });
        const blobUrl = URL.createObjectURL(videoBlob);
        const sizeMb = (videoBlob.size / (1024 * 1024)).toFixed(2) + ' MB';

        setCurrentExportUrl(blobUrl);
        setCurrentExportFilename(filename);

        // Safe delayed revoke download
        downloadFile(videoBlob, filename, chosenMimeType);

        const newHistoryItem: ExportHistoryItem = {
          id: 'exp_' + Date.now(),
          filename,
          blobUrl,
          timestamp: new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: 'short',
          }),
          duration: Math.round(totalDuration),
          resolution: `${width}x${height}`,
          aspectRatio: frameSize,
          sizeMb,
          segmentCount: project.segments.length,
        };

        setHistoryItems((prev) => {
          const updated = [newHistoryItem, ...prev];
          try {
            const metaOnly = updated.map(({ blobUrl, ...rest }) => rest);
            localStorage.setItem('recap_export_history_meta', JSON.stringify(metaOnly));
          } catch {}
          return updated;
        });
      };
    } catch (err: any) {
      console.error('Export video error:', err);
      setIsExporting(false);
      try {
        if (renderVideo && document.body.contains(renderVideo)) {
          document.body.removeChild(renderVideo);
        }
      } catch {}
      alert(`Export Error: ${err.message || 'Error rendering MP4'}`);
    }
  };

  const handleDownloadSrt = () => {
    const srt = generateSrtContent(project.segments);
    downloadFile(srt, `${project.videoName || 'recap'}_myanmar.srt`, 'text/plain;charset=utf-8');
  };

  const handleClearHistory = () => {
    if (confirm('Clear export history?')) {
      setHistoryItems([]);
      localStorage.removeItem('recap_export_history_meta');
    }
  };

  const handleDeleteHistoryItem = (id: string) => {
    setHistoryItems((prev) => {
      const updated = prev.filter((item) => item.id !== id);
      try {
        const metaOnly = updated.map(({ blobUrl, ...rest }) => rest);
        localStorage.setItem('recap_export_history_meta', JSON.stringify(metaOnly));
      } catch {}
      return updated;
    });
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="glass-panel rounded-2xl p-5 shadow-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-cyan-400 text-zinc-950 flex items-center justify-center text-sm font-black font-mono shadow-lg shadow-cyan-400/20">
            8
          </div>
          <div>
            <h2 className="text-base font-bold text-white font-display flex items-center gap-2">
              <span>Final Video & MP4 Download Studio</span>
              <Sparkles className="w-4 h-4 text-cyan-400" />
            </h2>
            <p className="text-xs text-zinc-400 font-myanmar mt-0.5">
              Direct High-Quality MP4 Video Export & Download History
            </p>
          </div>
        </div>

        <button
          onClick={onPrevStep}
          className="px-3.5 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-semibold rounded-xl transition-all border border-white/10 flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>အဆင့် 7 သို့</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Resolution & Export Button */}
        <div className="lg:col-span-5 space-y-5">
          <div className="glass-panel rounded-2xl p-5 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 font-display">
              <Film className="w-4 h-4 text-cyan-400" />
              <span>Video Resolution & Aspect Ratio</span>
            </h3>

            <div className="grid grid-cols-2 gap-2.5">
              {[
                { id: 'tiktok', label: 'TikTok / Shorts', res: '1080x1920 (9:16)', icon: '📱' },
                { id: 'youtube', label: 'YouTube HD', res: '1920x1080 (16:9)', icon: '💻' },
                { id: 'portrait', label: 'FB / IG Feed', res: '1080x1350 (4:5)', icon: '🖼️' },
                { id: 'square', label: 'Square Post', res: '1080x1080 (1:1)', icon: '⏹️' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setFrameSize(s.id as any)}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    frameSize === s.id
                      ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200 ring-1 ring-cyan-400/30'
                      : 'bg-white/5 border-white/5 text-zinc-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold text-xs">
                    <span>{s.icon}</span>
                    <span>{s.label}</span>
                  </div>
                  <span className="block text-[10px] text-zinc-400 font-mono mt-1">{s.res}</span>
                </button>
              ))}
            </div>

            {/* Video Resolution Quality Options */}
            <div className="space-y-1.5 pt-1">
              <label className="text-xs font-bold text-zinc-200 flex items-center justify-between">
                <span>Video Resolution Quality:</span>
                <span className="text-[11px] font-mono text-cyan-300 font-bold bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                  {getCanvasDimensions(frameSize, exportQuality).label}
                </span>
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { id: '1080p', label: '1080p Full HD', desc: 'Standard' },
                  { id: '720p', label: '720p HD', desc: 'Fast' },
                  { id: '480p', label: '480p SD', desc: 'Small' },
                  { id: '4k', label: '4K Ultra', desc: 'Crisp' },
                ].map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setExportQuality(q.id as any)}
                    className={`py-2 px-1 rounded-xl border text-center transition-all cursor-pointer ${
                      exportQuality === q.id
                        ? 'bg-gradient-to-r from-cyan-500/20 to-teal-500/20 border-cyan-400 text-cyan-200 font-bold ring-1 ring-cyan-400/40 shadow-sm'
                        : 'bg-white/5 border-white/5 text-zinc-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <span className="block text-xs font-mono font-bold">{q.id.toUpperCase()}</span>
                    <span className="block text-[9px] text-zinc-400 mt-0.5">{q.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Video Stats */}
            <div className="glass-card rounded-xl p-3.5 space-y-2 text-xs">
              <div className="flex justify-between text-zinc-400">
                <span>File Name:</span>
                <span className="text-zinc-200 font-semibold truncate max-w-[180px]">
                  {project.videoName || 'custom_upload.mp4'}
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Duration:</span>
                <span className="text-cyan-300 font-mono font-semibold">
                  {Math.round(project.videoDuration || 0)}s
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Output Canvas:</span>
                <span className="text-cyan-300 font-mono font-semibold">
                  {getCanvasDimensions(frameSize, exportQuality).width}x{getCanvasDimensions(frameSize, exportQuality).height}
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Myanmar Subtitles:</span>
                <span className="text-emerald-400 font-mono font-semibold">
                  {project.segments.length} segments
                </span>
              </div>
            </div>

            {/* Audio Mixing & Mute Controls (မူရင်းအသံ & Voice Clone ချိန်ညှိမှု) */}
            <div className="glass-card rounded-xl p-4 space-y-3 border border-cyan-500/25 bg-zinc-950/70 shadow-lg">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="text-xs font-bold text-white flex items-center gap-1.5 font-display">
                  <Volume2 className="w-4 h-4 text-cyan-400" />
                  <span>Audio Mix & Mute Controls (အသံချိန်ညှိမှု)</span>
                </span>
                <span className="text-[10px] text-zinc-400 font-mono">
                  {project.segments.filter((s) => s.audioUrl).length} Voices Ready
                </span>
              </div>

              {/* Original Video Audio Track */}
              <div className="space-y-2 p-2.5 rounded-lg bg-zinc-900/90 border border-zinc-800">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setProject((prev) => ({ ...prev, isMuted: !prev.isMuted }))}
                    className={`px-2.5 py-1 rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 text-[11px] font-bold ${
                      project.isMuted
                        ? 'bg-rose-500/20 border-rose-500/50 text-rose-300'
                        : 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                    }`}
                    title={project.isMuted ? 'မူရင်းအသံ ပြန်ဖွင့်မည် (Unmute)' : 'မူရင်းအသံ ပိတ်မည် (Mute)'}
                  >
                    {project.isMuted ? (
                      <>
                        <VolumeX className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        <span>🔇 မူရင်းအသံ Mute ထားသည် (Off)</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>🔊 မူရင်းအသံ ဖွင့်ထားသည် (On)</span>
                      </>
                    )}
                  </button>
                  <span className="text-[11px] font-mono font-bold text-zinc-300">
                    {project.isMuted ? '0%' : `${Math.round((project.volume ?? 1.0) * 100)}%`}
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-0.5">
                  <span className="text-[10px] text-zinc-400 shrink-0">Vol:</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={project.isMuted ? 0 : (project.volume ?? 1.0)}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setProject((prev) => ({
                        ...prev,
                        volume: val,
                        isMuted: val === 0,
                      }));
                    }}
                    className="flex-1 h-1.5 bg-zinc-800 rounded accent-cyan-400 cursor-pointer"
                  />
                </div>

                {project.isMuted ? (
                  <p className="text-[10px] text-amber-300 font-myanmar leading-tight flex items-center gap-1 bg-amber-500/10 p-1.5 rounded border border-amber-500/20">
                    <span>✓ မူရင်းအသံကို Mute ထားပါသည်။ Export ဗီဒီယိုတွင် မူရင်းအသံလုံးဝ မပါဘဲ Voice Clone အသံဖြင့်သာ ထွက်ရှိပါမည်။</span>
                  </p>
                ) : (
                  <p className="text-[10px] text-zinc-400 font-myanmar leading-tight">
                    မူရင်းအသံနှင့် Voice Clone အသံ ၂ မျိုးစလုံးကို ရောနှော၍ Export ပြုလုပ်မည်ဖြစ်ပါသည်။
                  </p>
                )}
              </div>

              {/* Cloned Voice Audio Track */}
              <div className="space-y-2 p-2.5 rounded-lg bg-zinc-900/90 border border-zinc-800">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setProject((prev) => ({ ...prev, isVoiceMuted: !prev.isVoiceMuted }))}
                    className={`px-2.5 py-1 rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 text-[11px] font-bold ${
                      project.isVoiceMuted
                        ? 'bg-rose-500/20 border-rose-500/50 text-rose-300'
                        : 'bg-teal-500/20 border-teal-500/50 text-teal-300'
                    }`}
                    title={project.isVoiceMuted ? 'Voice Clone ဖွင့်မည်' : 'Voice Clone ပိတ်မည်'}
                  >
                    {project.isVoiceMuted ? (
                      <>
                        <VolumeX className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        <span>🔇 Voice Clone Mute</span>
                      </>
                    ) : (
                      <>
                        <Mic className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                        <span>🎙️ Voice Clone ဖွင့်ထားသည် (On)</span>
                      </>
                    )}
                  </button>
                  <span className="text-[11px] font-mono font-bold text-emerald-400">
                    {project.isVoiceMuted ? '0%' : `${Math.round((project.voiceVolume ?? 1.0) * 100)}%`}
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-0.5">
                  <span className="text-[10px] text-zinc-400 shrink-0">Vol:</span>
                  <input
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.05}
                    value={project.isVoiceMuted ? 0 : (project.voiceVolume ?? 1.0)}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setProject((prev) => ({
                        ...prev,
                        voiceVolume: val,
                        isVoiceMuted: val === 0,
                      }));
                    }}
                    className="flex-1 h-1.5 bg-zinc-800 rounded accent-emerald-400 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Render MP4 Button */}
            {isExporting ? (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between text-xs font-mono text-cyan-300">
                  <span className="animate-pulse">{exportStatusText}</span>
                  <span className="font-bold text-cyan-400">{exportProgress}%</span>
                </div>
                <div className="w-full h-3 bg-zinc-950 rounded-full overflow-hidden p-0.5 border border-white/10">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-400 to-teal-400 rounded-full transition-all duration-200"
                    style={{ width: `${exportProgress}%` }}
                  />
                </div>
              </div>
            ) : (
              <button
                onClick={handleExportMp4Video}
                className="w-full py-3.5 bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 hover:opacity-90 text-zinc-950 font-bold text-sm rounded-xl transition-all shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-5 h-5 stroke-[2.5]" />
                <span>Export MP4 Video ({exportQuality.toUpperCase()})</span>
              </button>
            )}

            {currentExportUrl && (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>MP4 Export ပြီးဆုံးပါပြီ (Download Ready)</span>
                  </span>
                </div>

                {/* Direct Video Player Preview for verified playback */}
                <div className="rounded-xl overflow-hidden border border-emerald-500/30 bg-black aspect-video flex items-center justify-center">
                  <video
                    src={currentExportUrl}
                    controls
                    className="w-full h-full object-contain"
                  />
                </div>

                {/* RESOLUTION SELECTOR RIGHT NEXT TO DOWNLOAD BUTTON */}
                <div className="flex items-center gap-2 pt-1">
                  <div className="flex-1 flex items-center gap-1.5 p-1 bg-zinc-950 border border-emerald-500/30 rounded-xl">
                    <span className="text-[10px] text-zinc-400 font-mono px-2 shrink-0">Res:</span>
                    <select
                      value={exportQuality}
                      onChange={(e) => setExportQuality(e.target.value as any)}
                      className="w-full bg-zinc-900 text-cyan-300 font-bold font-mono text-xs py-2 px-2 rounded-lg border border-zinc-700 focus:outline-none focus:border-cyan-400 cursor-pointer"
                      title="Select video resolution"
                    >
                      <option value="1080p">1080p Full HD ({getCanvasDimensions(frameSize, '1080p').width}x{getCanvasDimensions(frameSize, '1080p').height})</option>
                      <option value="720p">720p HD ({getCanvasDimensions(frameSize, '720p').width}x{getCanvasDimensions(frameSize, '720p').height})</option>
                      <option value="480p">480p SD ({getCanvasDimensions(frameSize, '480p').width}x{getCanvasDimensions(frameSize, '480p').height})</option>
                      <option value="4k">4K Ultra HD ({getCanvasDimensions(frameSize, '4k').width}x{getCanvasDimensions(frameSize, '4k').height})</option>
                    </select>
                  </div>

                  <a
                    href={currentExportUrl}
                    download={currentExportFilename}
                    className="py-3 px-4 bg-gradient-to-r from-emerald-400 to-teal-400 hover:opacity-95 text-zinc-950 font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 cursor-pointer shrink-0"
                  >
                    <Download className="w-4 h-4 stroke-[2.5]" />
                    <span>Download MP4</span>
                  </a>
                </div>
              </div>
            )}
          </div>

          <div className="glass-panel rounded-2xl p-5 shadow-2xl space-y-3">
            <h3 className="text-xs font-bold text-white flex items-center gap-2 font-display">
              <FileText className="w-4 h-4 text-emerald-400" />
              <span>Subtitles & Project File Backup</span>
            </h3>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleDownloadSrt}
                disabled={project.segments.length === 0}
                className="py-2.5 px-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span>Download SRT</span>
              </button>

              <button
                onClick={() => {
                  const json = JSON.stringify(project, null, 2);
                  downloadFile(json, `${project.videoName || 'project'}_state.json`, 'application/json');
                }}
                className="py-2.5 px-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-cyan-400" />
                <span>Save Project</span>
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Video Viewport & History */}
        <div className="lg:col-span-7 space-y-6">
          <div className="glass-panel rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2 font-display">
                <Video className="w-4 h-4 text-cyan-400" />
                <span>Edited Custom Upload Video</span>
              </h3>
              <span className="text-[10px] font-mono text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-full">
                {getCanvasDimensions(frameSize).width}x{getCanvasDimensions(frameSize).height}
              </span>
            </div>

            <VideoPlayerView
              project={project}
              setProject={setProject}
              activeSegment={
                project.segments.find((s) => {
                  const effectiveEnd = Math.max(s.endTime, s.startTime + (s.audioDuration || 0));
                  return project.currentTime >= s.startTime && project.currentTime <= effectiveEnd;
                }) || null
              }
            />
          </div>

          <div className="glass-panel rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-bold text-white font-display">
                  Export Download History
                </h3>
              </div>

              {historyItems.length > 0 && (
                <button
                  onClick={handleClearHistory}
                  className="text-xs text-rose-400 hover:underline cursor-pointer"
                >
                  Clear History
                </button>
              )}
            </div>

            {historyItems.length === 0 ? (
              <div className="glass-card rounded-xl p-8 text-center text-xs text-zinc-400 space-y-1">
                <Clock className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                <p>ယခု စက်ရှင်တွင် MP4 ဗီဒီယို ထုတ်ယူထားခြင်း မရှိသေးပါ။</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                {historyItems.map((item) => (
                  <div
                    key={item.id}
                    className="glass-card p-3.5 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Video className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span className="text-xs font-bold text-white truncate max-w-[200px]">
                          {item.filename}
                        </span>
                        <span className="text-[10px] font-mono text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/20">
                          {item.resolution}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-[11px] text-zinc-400 font-mono">
                        <span>{item.timestamp}</span>
                        <span>• {item.duration}s</span>
                        <span>• {item.sizeMb}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {item.blobUrl && (
                        <a
                          href={item.blobUrl}
                          download={item.filename}
                          className="px-3 py-1.5 bg-emerald-400 hover:bg-emerald-300 text-zinc-950 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 shadow-md shadow-emerald-500/20 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download</span>
                        </a>
                      )}

                      <button
                        onClick={() => handleDeleteHistoryItem(item.id)}
                        className="p-1.5 bg-white/5 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-300 rounded-lg transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
