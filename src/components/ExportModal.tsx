import React, { useState } from 'react';
import { X, Download, FileText, Video, CheckCircle2, RotateCw, Play } from 'lucide-react';
import { ProjectState } from '../types';
import { generateSrtContent, downloadFile, getInterpolatedKeyframe, getFilterCss } from '../utils/alightMotionRenderer';
import { drawCanvasSubtitle } from '../utils/canvasSubtitleRenderer';
import { exportToDubbingPlanJSON, generateBurmeseDubbingSRT } from '../utils/geminiPool';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectState;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  project,
}) => {
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [downloadedUrl, setDownloadedUrl] = useState<string | null>(null);
  const [downloadFilename, setDownloadFilename] = useState<string>('recap_perfect.mp4');
  const getInitialFrameSize = () => {
    if (project.aspectRatio === '16:9') return 'youtube';
    if (project.aspectRatio === '1:1') return 'square';
    if (project.aspectRatio === '4:5') return 'portrait';
    return 'tiktok';
  };
  const [frameSize, setFrameSize] = useState<'tiktok' | 'youtube' | 'square' | 'portrait' | 'landscape'>(getInitialFrameSize);

  if (!isOpen) return null;

  // Export SRT Subtitle File
  const handleDownloadSrt = () => {
    const srt = generateBurmeseDubbingSRT(project.segments);
    downloadFile(srt, `${project.videoName || 'video'}_burmese_subtitles.srt`, 'text/plain;charset=utf-8');
  };

  // Export Dubbing Plan JSON (10-Point Analysis)
  const handleDownloadDubbingPlan = () => {
    const json = exportToDubbingPlanJSON(project.segments);
    downloadFile(json, `${project.videoName || 'video'}_dubbing_plan.json`, 'application/json');
  };

  // Export Project JSON
  const handleDownloadProjectJson = () => {
    const json = JSON.stringify(project, null, 2);
    downloadFile(json, `${project.videoName || 'project'}_motionrecap.json`, 'application/json');
  };

  // Composite Video Export via Canvas & MediaRecorder (Outputs standard .mp4 video)
  const handleExportCompositeVideo = async () => {
    if (!project.videoUrl) {
      alert('ဗီဒီယို မရှိသေးပါ။ အဆင့် 2 တွင် ဗီဒီယို ဖိုင် အရင် တင်ပေးပါ။');
      return;
    }

    setIsExportingVideo(true);
    setExportProgress(2);
    setDownloadedUrl(null);

    try {
      const video = document.createElement('video');
      video.src = project.videoUrl;
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.playsInline = true;

      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('Failed to load video for export'));
      });

      const canvas = document.createElement('canvas');
      if (frameSize === 'tiktok') {
        canvas.width = 1080;
        canvas.height = 1920; // 9:16 Vertical TikTok / Reels / Shorts
      } else if (frameSize === 'youtube') {
        canvas.width = 1920;
        canvas.height = 1080; // 16:9 Standard YouTube
      } else if (frameSize === 'square') {
        canvas.width = 1080;
        canvas.height = 1080; // 1:1 Square
      } else if (frameSize === 'portrait') {
        canvas.width = 1080;
        canvas.height = 1350; // 4:5 Portrait
      } else {
        canvas.width = 1280;
        canvas.height = 720; // Standard Landscape HD
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');

      // Web Audio API destination for mixing Cloned Voices + Background Video audio
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtxClass();
      const dest = audioCtx.createMediaStreamDestination();

      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      // Schedule all generated voice clone audio clips into audioCtx destination
      for (const seg of project.segments) {
        if (seg.audioUrl) {
          try {
            const audioRes = await fetch(seg.audioUrl);
            const arrayBuf = await audioRes.arrayBuffer();
            const decodedBuf = await audioCtx.decodeAudioData(arrayBuf);

            const source = audioCtx.createBufferSource();
            source.buffer = decodedBuf;

            // Apply segment voice speed
            const speed = seg.playbackRate || project.voicePlaybackRate || 1.0;
            source.playbackRate.value = speed;

            source.connect(dest);

            const startTime = Math.max(0, seg.startTime);
            source.start(audioCtx.currentTime + startTime);
          } catch (audioErr) {
            console.warn('Audio segment load notice:', audioErr);
          }
        }
      }

      // Combine video canvas stream + audio destination stream
      const canvasStream = canvas.captureStream(30); // 30 FPS
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...dest.stream.getAudioTracks(),
      ]);

      // Determine best MP4 / WebM MediaRecorder MimeType
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

      const recorder = new MediaRecorder(combinedStream, {
        mimeType: chosenMimeType,
        videoBitsPerSecond: 8000000, // 8 Mbps High Quality MP4
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      const maxAudioEnd = project.segments.reduce(
        (max, s) => Math.max(max, s.startTime + (s.audioDuration || s.endTime - s.startTime)),
        0
      );
      const videoSpeedMultiplier = project.playbackRate || 1.0;
      const duration = Math.max(
        (project.videoDuration || 10) / videoSpeedMultiplier,
        maxAudioEnd
      );

      recorder.start();

      // Precise Async Frame-by-Frame Seek Render Loop
      const fps = 30;
      const totalFrames = Math.floor(duration * fps);

      for (let currentFrame = 0; currentFrame < totalFrames; currentFrame++) {
        const currentTime = currentFrame / fps;
        const videoTime = currentTime * videoSpeedMultiplier;

        // Async seek video element to exact frame timestamp
        video.currentTime = Math.min(video.duration || 10, videoTime);
        await new Promise<void>((resolve) => {
          const onSeeked = () => {
            video.removeEventListener('seeked', onSeeked);
            resolve();
          };
          if (Math.abs(video.currentTime - videoTime) < 0.03 && !video.seeking) {
            resolve();
          } else {
            video.addEventListener('seeked', onSeeked);
            setTimeout(resolve, 60); // Safety timeout
          }
        });

        // Create temporary offscreen canvas for rendering transformed video frame
        const offCanvas = document.createElement('canvas');
        offCanvas.width = canvas.width;
        offCanvas.height = canvas.height;
        const offCtx = offCanvas.getContext('2d');

        if (offCtx) {
          const vw = (video.videoWidth && video.videoWidth > 0) ? video.videoWidth : canvas.width;
          const vh = (video.videoHeight && video.videoHeight > 0) ? video.videoHeight : canvas.height;
          const videoAspect = vw / vh;
          const canvasAspect = canvas.width / canvas.height;

          const kf = getInterpolatedKeyframe(project.keyframes, currentTime);
          const crop = project.frameCrop || { scale: 1.0, posX: 0, posY: 0, fitMode: 'contain', backgroundStyle: 'blur' };

          offCtx.clearRect(0, 0, canvas.width, canvas.height);

          if (crop.backgroundStyle === 'blur') {
            offCtx.save();
            offCtx.filter = 'blur(28px) brightness(0.55)';
            try {
              let bgW = canvas.width;
              let bgH = canvas.height;
              if (videoAspect > canvasAspect) {
                bgH = canvas.height;
                bgW = canvas.height * videoAspect;
              } else {
                bgW = canvas.width;
                bgH = canvas.width / videoAspect;
              }
              offCtx.drawImage(video, (canvas.width - bgW) / 2, (canvas.height - bgH) / 2, bgW, bgH);
            } catch {}
            offCtx.restore();
          } else {
            offCtx.fillStyle = '#050505';
            offCtx.fillRect(0, 0, canvas.width, canvas.height);
          }

          offCtx.save();
          let shakeOffsetX = 0;
          let shakeOffsetY = 0;
          if (kf.shakeIntensity > 0) {
            shakeOffsetX = (Math.random() - 0.5) * kf.shakeIntensity * 4;
            shakeOffsetY = (Math.random() - 0.5) * kf.shakeIntensity * 4;
          }

          offCtx.translate(canvas.width / 2 + kf.posX + shakeOffsetX + (crop.posX || 0), canvas.height / 2 + kf.posY + shakeOffsetY + (crop.posY || 0));
          offCtx.rotate((kf.rotation * Math.PI) / 180);
          offCtx.scale(kf.scale * (crop.scale || 1.0), kf.scale * (crop.scale || 1.0));
          offCtx.globalAlpha = Math.max(0, Math.min(1, kf.opacity));

          const filterStr = getFilterCss(kf.filter);
          if (filterStr !== 'none' || kf.blur > 0) {
            offCtx.filter = `${filterStr} ${kf.blur > 0 ? `blur(${kf.blur}px)` : ''}`.trim();
          }

          // Calculate draw dimensions based on fitMode to avoid stretching/squashing
          let drawW = canvas.width;
          let drawH = canvas.height;
          if (crop.fitMode === 'cover') {
            if (videoAspect > canvasAspect) {
              drawH = canvas.height;
              drawW = canvas.height * videoAspect;
            } else {
              drawW = canvas.width;
              drawH = canvas.width / videoAspect;
            }
          } else {
            // 'contain' (default)
            if (videoAspect > canvasAspect) {
              drawW = canvas.width;
              drawH = canvas.width / videoAspect;
            } else {
              drawH = canvas.height;
              drawW = canvas.height * videoAspect;
            }
          }

          try {
            offCtx.drawImage(video, -drawW / 2, -drawH / 2, drawW, drawH);
          } catch {}

          offCtx.restore();

          // Draw offscreen frame onto main canvas
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(offCanvas, 0, 0);

          const videoLeft = (canvas.width - drawW) / 2;
          const videoTop = (canvas.height - drawH) / 2;

          const isLandscape = canvas.width > canvas.height;
          const scaleFactor = Math.max(1.0, canvas.height / (isLandscape ? 540 : 960));

          // Draw Blur Boxes with exact 1:1 coordinates matching preview
          if (project.blurBoxes && project.blurBoxes.length > 0) {
            for (const box of project.blurBoxes) {
              const bx = (box.x / 100) * canvas.width;
              const by = (box.y / 100) * canvas.height;
              const bw = (box.width / 100) * canvas.width;
              const bh = (box.height / 100) * canvas.height;

              if (bw > 0 && bh > 0) {
                ctx.save();
                ctx.beginPath();
                if (ctx.roundRect) {
                  ctx.roundRect(bx, by, bw, bh, 6 * scaleFactor);
                } else {
                  ctx.rect(bx, by, bw, bh);
                }
                ctx.clip();

                const blurPx = Math.max(16, (box.blurAmount || 20) * scaleFactor * 1.25);
                ctx.filter = `blur(${blurPx}px) brightness(0.8)`;

                ctx.drawImage(offCanvas, 0, 0);

                ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
                ctx.fillRect(bx, by, bw, bh);

                ctx.restore();
              }
            }
          }

          // Draw Live Myanmar Subtitles Overlay with wrapped multi-line rendering
          const activeSeg = project.segments.find(
            (s) => currentTime >= s.startTime && currentTime <= s.endTime
          );

          if (activeSeg) {
            const text = activeSeg.myanmarTranslation || activeSeg.originalText;
            if (text) {
              drawCanvasSubtitle({
                ctx,
                text,
                settings: project.subtitleSettings,
                canvasWidth: canvas.width,
                canvasHeight: canvas.height,
                scaleFactor,
              });
            }
          }
        }

        // Draw Fixed Logo Watermark on Export Canvas if configured
        if (project.logoConfig && project.logoConfig.imageUrl) {
          try {
            const logoImg = new Image();
            logoImg.crossOrigin = 'anonymous';
            logoImg.src = project.logoConfig.imageUrl;
            if (logoImg.complete) {
              ctx.save();
              const logoSize = (project.logoConfig.size || 80) * (canvas.width / 1280);
              const logoX = (project.logoConfig.x / 100) * canvas.width;
              const logoY = (project.logoConfig.y / 100) * canvas.height;
              ctx.globalAlpha = project.logoConfig.opacity ?? 1;

              if (project.logoConfig.shape === 'circle') {
                ctx.beginPath();
                ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
                ctx.clip();
              }

              ctx.drawImage(logoImg, logoX, logoY, logoSize, logoSize);
              ctx.restore();
            }
          } catch {}
        }

        // Draw Animated Text Watermark on Export Canvas if configured
        if (project.logoConfig && project.logoConfig.textWatermark) {
          ctx.save();
          const txt = project.logoConfig.textWatermark;
          const txtSize = (project.logoConfig.textWatermarkSize || 24) * (canvas.width / 1280);
          ctx.font = `bold ${txtSize}px 'Pyidaungsu', 'Noto Sans Myanmar', sans-serif`;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';

          const speed = project.logoConfig.textWatermarkSpeed || 30;
          const yPos = ((currentTime * speed) % 100 / 100) * canvas.height;
          ctx.fillText(txt, canvas.width * 0.1, yPos);
          ctx.restore();
        }

        const pct = Math.min(99, Math.round(((currentFrame + 1) / totalFrames) * 100));
        setExportProgress(pct);

        // Yield execution to prevent UI freeze
        await new Promise((r) => setTimeout(r, 8));
      }

      recorder.stop();

      recorder.onstop = () => {
        setExportProgress(100);
        setIsExportingVideo(false);

        const isMp4 = chosenMimeType.includes('mp4');
        const outputMime = isMp4 ? 'video/mp4' : 'video/mp4';
        const cleanBaseName = (project.videoName || 'recap').replace(/\.[^/.]+$/, '');
        const filename = `${cleanBaseName}_perfect.mp4`;

        const videoBlob = new Blob(chunks, { type: outputMime });
        const url = URL.createObjectURL(videoBlob);
        setDownloadedUrl(url);
        setDownloadFilename(filename);

        // Trigger direct MP4 download
        downloadFile(videoBlob, filename, 'video/mp4');
      };
    } catch (err: any) {
      console.error('Export video error:', err);
      setIsExportingVideo(false);
      alert(`ဗီဒီယို ထုတ်လုပ်မှု ချို့ယွင်းချက် ဖြစ်ပေါ်ခဲ့ပါသည်: ${err.message || 'Error rendering MP4 video'}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-cyan-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              Export Perfect MP4 Video & Myanmar Subtitles
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Options */}
        <div className="p-6 space-y-4">
          {/* Option 1: Full Composite Video Export */}
          <div className="p-4 rounded-xl bg-zinc-950/70 border border-zinc-800 space-y-3.5">
            <div>
              <h3 className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                <Video className="w-4 h-4 text-cyan-400" />
                <span>Burned-in Subtitles & Motion FX Perfect MP4 Video</span>
              </h3>
              <p className="text-[11px] text-zinc-400 font-myanmar mt-0.5">
                မြန်မာစာတန်းထိုး၊ အသံနှင့် Alight Keyframe လှုပ်ရှားမှုများ ပါဝင်သော MP4 ဗီဒီယိုဖိုင် အပြည့်အစုံ ထုတ်ယူမည်။
              </p>
            </div>

            {/* Frame Size Selector (TikTok vs YouTube vs Landscape) */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-zinc-300 block">
                📹 Video Frame Size (ဗီဒီယို အတိုင်းအတာ ရွေးချယ်ရန်):
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'tiktok', label: 'TikTok / Shorts', res: '1080x1920 (9:16)' },
                  { id: 'youtube', label: 'YouTube Standard', res: '1920x1080 (16:9)' },
                  { id: 'landscape', label: 'Landscape HD', res: '1280x720 (16:9)' },
                ].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setFrameSize(s.id as any)}
                    className={`p-2 rounded-lg border text-left transition-all ${
                      frameSize === s.id
                        ? 'bg-cyan-950 border-cyan-400 text-cyan-200 shadow-md ring-1 ring-cyan-400/30'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <span className="block font-bold text-xs">{s.label}</span>
                    <span className="block text-[10px] text-zinc-500 font-mono mt-0.5">{s.res}</span>
                  </button>
                ))}
              </div>
            </div>

            {isExportingVideo ? (
              <div className="space-y-2 pt-1">
                <div className="flex justify-between text-xs font-mono-num text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <RotateCw className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                    <span>Rendering MP4 Frames ({exportProgress}%)...</span>
                  </span>
                  <span className="text-cyan-400 font-bold">{exportProgress}%</span>
                </div>
                <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-cyan-400 transition-all duration-150"
                    style={{ width: `${exportProgress}%` }}
                  />
                </div>
              </div>
            ) : (
              <button
                onClick={handleExportCompositeVideo}
                className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-zinc-950 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-cyan-500/20 cursor-pointer"
              >
                <Video className="w-4 h-4" />
                <span>🎬 Render & Export Perfect MP4 Video</span>
              </button>
            )}

            {/* Direct Player Preview & Download Button when finished */}
            {downloadedUrl && (
              <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/80 space-y-2.5 animate-fadeIn">
                <div className="flex items-center justify-between text-xs text-emerald-300 font-semibold font-myanmar">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>MP4 ဗီဒီယို ထုတ်ယူမှု အောင်မြင်ပါသည်!</span>
                  </span>
                  <span className="text-[10px] font-mono text-emerald-400">Ready</span>
                </div>

                <video src={downloadedUrl} controls className="w-full rounded-lg border border-emerald-500/40 max-h-[180px] bg-black" />

                <a
                  href={downloadedUrl}
                  download={downloadFilename}
                  className="w-full py-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-xs rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/30 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>⬇️ Download MP4 Video ({downloadFilename})</span>
                </a>
              </div>
            )}
          </div>

          {/* Option 2: Dubbing Plan JSON (10-Point Analysis) */}
          <div className="p-3.5 rounded-xl bg-zinc-950/70 border border-sky-500/20 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-semibold text-sky-200 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-sky-400" />
                <span>Burmese Dubbing Plan (10-Point JSON)</span>
              </h4>
              <p className="text-[11px] text-zinc-400 font-myanmar">တရုတ်-မြန်မာ အသံထပ်စကားပြော အပြည့်အစုံ JSON</p>
            </div>
            <button
              onClick={handleDownloadDubbingPlan}
              disabled={project.segments.length === 0}
              className="px-3 py-1.5 text-xs bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-1 cursor-pointer border border-sky-500/30"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download JSON</span>
            </button>
          </div>

          {/* Option 3: SRT Subtitle File */}
          <div className="p-3.5 rounded-xl bg-zinc-950/70 border border-zinc-800 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-emerald-400" />
                <span>Myanmar Clean SRT Subtitles (.srt)</span>
              </h4>
              <p className="text-[11px] text-zinc-400 font-myanmar">တရုတ်စာမပါ၊ ၂ ကြောင်းကန့်သတ် မြန်မာစာတန်းထိုး</p>
            </div>
            <button
              onClick={handleDownloadSrt}
              disabled={project.segments.length === 0}
              className="px-3 py-1.5 text-xs bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-50 text-emerald-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer border border-emerald-500/30"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download SRT</span>
            </button>
          </div>

          {/* Option 3: Project State JSON */}
          <div className="p-3.5 rounded-xl bg-zinc-950/70 border border-zinc-800 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-medium text-zinc-200">
                Studio Project File (.json)
              </h4>
              <p className="text-[11px] text-zinc-400">Keyframe များနှင့် စာသားများကို သိမ်းဆည်းရန်</p>
            </div>
            <button
              onClick={handleDownloadProjectJson}
              className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Save Project</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
