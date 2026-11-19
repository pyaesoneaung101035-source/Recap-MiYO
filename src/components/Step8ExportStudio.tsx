import React, { useState, useRef, useEffect } from 'react';
import {
  Download,
  Video,
  CheckCircle2,
  Film,
  Sparkles,
  ArrowLeft,
  Clock,
  Play,
  RotateCw,
  XCircle,
  Settings,
  RefreshCw,
} from 'lucide-react';
import { ProjectState } from '../types';
import { downloadFile } from '../utils/alightMotionRenderer';
import { exportCompositeVideo } from '../utils/canvasVideoExporter';
import { VideoPlayerView } from './VideoPlayerView';

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
  const [preset, setPreset] = useState<'tiktok' | 'youtube_shorts' | 'youtube' | 'facebook'>('youtube_shorts');
  const [resolution, setResolution] = useState<'480p' | '720p' | '1080p' | '4k'>('1080p');
  const [fps, setFps] = useState<string>('30');
  const [videoCodec, setVideoCodec] = useState<string>('H.264 (Recommended)');
  const [quality, setQuality] = useState<string>('High');
  const [audioCodec, setAudioCodec] = useState<string>('AAC (Standard)');
  const [audioBitrate, setAudioBitrate] = useState<string>('128 kbps');

  const [isExporting, setIsExporting] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [statusText, setStatusText] = useState('Processing Your Video...');
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [etaSecs, setEtaSecs] = useState(4);
  const [exportResult, setExportResult] = useState<{ downloadUrl: string; filename: string; fileSizeMb: string } | null>(null);

  const progressRef = useRef<number>(0);
  const timerIntervalRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      cleanupJob();
    };
  }, []);

  const cleanupJob = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    abortRef.current?.abort();
  };

  const getExportDimensions = () => {
    const isPortrait = preset === 'tiktok' || preset === 'youtube_shorts';
    if (resolution === '4k') {
      return isPortrait ? { width: 2160, height: 3840 } : { width: 3840, height: 2160 };
    }
    if (resolution === '720p') {
      return isPortrait ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
    }
    if (resolution === '480p') {
      return isPortrait ? { width: 480, height: 854 } : { width: 854, height: 480 };
    }
    return isPortrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  };

  const handleStartExport = async () => {
    if (!project.videoFile && !project.videoUrl) {
      alert('ဗီဒီယို ဖိုင် မရှိသေးပါ။ အဆင့် ၂ တွင် ဗီဒီယို တင်သွင်းပါ။');
      return;
    }

    cleanupJob();
    setProject((prev) => (prev.isPlaying ? { ...prev, isPlaying: false } : prev));
    setExportResult(null);
    setIsExporting(true);
    progressRef.current = 3;
    setProgressPct(3);
    setStatusText('Initializing Video, BGM & Voice Clone Mix...');
    setElapsedSecs(0);
    setEtaSecs(Math.max(4, Math.round(project.videoDuration || 12)));

    const startTime = Date.now();
    timerIntervalRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedSecs(elapsed);
      const pct = progressRef.current;
      if (pct > 5 && pct < 100) {
        const estTotal = (elapsed / pct) * 100;
        setEtaSecs(Math.max(1, Math.round(estTotal - elapsed)));
      }
    }, 1000);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { width, height } = getExportDimensions();
      const baseBitrate =
        quality === 'Low' ? 3000000 : quality === 'Medium' ? 6000000 : resolution === '4k' ? 16000000 : 10000000;

      const res = await exportCompositeVideo({
        project,
        width,
        height,
        videoBitsPerSecond: baseBitrate,
        forceMuteOriginalAudio: true,
        signal: controller.signal,
        onProgress: (pct, msg) => {
          progressRef.current = pct;
          setProgressPct(pct);
          if (msg) setStatusText(msg);
        },
      });

      cleanupJob();
      setIsExporting(false);
      progressRef.current = 100;
      setProgressPct(100);
      setStatusText('Export Completed! (BGM + Voice Clone + Subtitles + Blur)');

      const cleanName = (project.videoName || 'recap').replace(/\.[^/.]+$/, '');
      const filename = `${cleanName}_${resolution}.${res.extension}`;
      const url = URL.createObjectURL(res.blob);
      const sizeMb = (res.blob.size / (1024 * 1024)).toFixed(2) + ' MB';

      setExportResult({
        downloadUrl: url,
        filename,
        fileSizeMb: sizeMb,
      });
      downloadFile(res.blob, filename, res.mimeType);
    } catch (err: any) {
      cleanupJob();
      setIsExporting(false);
      if (err?.message !== 'Export cancelled') {
        setStatusText(`Export Failed: ${err?.message || 'Unknown error'}`);
        alert(`Export Error: ${err?.message || 'Failed'}`);
      }
    }
  };

  const handleCancelExport = () => {
    cleanupJob();
    setIsExporting(false);
    setStatusText('Export cancelled.');
  };

  const videoName = project.videoName || 'recap_video.mp4';
  const durationSec = Math.round(project.videoDuration || 15);
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-10">
      {/* Top Header */}
      <div className="glass-panel rounded-2xl p-5 shadow-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-400 to-teal-400 text-zinc-950 flex items-center justify-center text-sm font-black font-mono shadow-lg shadow-cyan-400/20">
            6
          </div>
          <div>
            <h2 className="text-base font-bold text-white font-display flex items-center gap-2">
              <span>Final Video & MP4 Download Studio</span>
              <Sparkles className="w-4 h-4 text-cyan-400" />
            </h2>
            <p className="text-xs text-zinc-400 font-myanmar mt-0.5">
              Professional Real FFmpeg Export Studio with Advanced Settings and Result Preview.
            </p>
          </div>
        </div>

        <button
          onClick={onPrevStep}
          className="px-3.5 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-semibold rounded-xl transition-all border border-white/10 flex items-center gap-1.5 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>အဆင့် ၅ သို့</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* TOP LEFT: Source Video Panel */}
        <div className="lg:col-span-6 space-y-4">
          <div className="glass-panel rounded-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <span className="px-3 py-1 bg-cyan-500/20 text-cyan-300 text-xs font-bold rounded-lg border border-cyan-500/30 flex items-center gap-1.5">
                <Video className="w-3.5 h-3.5" /> Source Video & Edits Preview
              </span>
              <span className="px-2.5 py-1 bg-zinc-800 text-zinc-300 text-[11px] font-mono font-bold rounded-md">
                HD
              </span>
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-black/50 relative">
              {project.videoUrl ? (
                <VideoPlayerView
                  project={project}
                  setProject={setProject}
                  activeSegment={project.segments.find(s => project.currentTime >= s.startTime && project.currentTime <= s.endTime) || project.segments[0] || null}
                  forceMuteOriginalAudio={true}
                />
              ) : (
                <div className="text-xs text-zinc-500 p-8 text-center">No video loaded in Step 2</div>
              )}
            </div>

            {/* Video Stats Footer */}
            <div className="grid grid-cols-3 gap-2.5 pt-1">
              <div className="glass-card rounded-xl p-3 flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
                <div>
                  <span className="text-[10px] text-zinc-400 block">Duration</span>
                  <span className="text-xs font-mono font-bold text-white">{formatTime(durationSec)}</span>
                </div>
              </div>

              <div className="glass-card rounded-xl p-3 flex items-center gap-2.5">
                <Film className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <span className="text-[10px] text-zinc-400 block">Resolution</span>
                  <span className="text-xs font-mono font-bold text-white">
                    {project.videoInspection?.resolution || (project.aspectRatio === '9:16' ? '1080×1920' : '1920×1080')}
                  </span>
                </div>
              </div>

              <div className="glass-card rounded-xl p-3 flex items-center gap-2.5">
                <Download className="w-4 h-4 text-amber-400 shrink-0" />
                <div>
                  <span className="text-[10px] text-zinc-400 block">File Size</span>
                  <span className="text-xs font-mono font-bold text-white">
                    {project.videoFile?.size
                      ? `${(project.videoFile.size / (1024 * 1024)).toFixed(1)} MB`
                      : project.videoInspection?.filesize
                      ? `${(project.videoInspection.filesize / (1024 * 1024)).toFixed(1)} MB`
                      : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* TOP RIGHT: Export Settings Panel */}
        <div className="lg:col-span-6 space-y-4">
          <div className="glass-panel rounded-3xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2 font-display">
                  <Settings className="w-4 h-4 text-cyan-400" />
                  <span>Export Settings</span>
                </h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">Choose your preset and customize options</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPreset('youtube_shorts');
                  setResolution('1080p');
                  setFps('30');
                  setQuality('High');
                }}
                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-semibold rounded-xl border border-white/10 flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            </div>

            {/* Export Preset Selection */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-300 block">Export Preset</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {[
                  { id: 'tiktok', label: 'TikTok', ratio: '9:16' },
                  { id: 'youtube_shorts', label: 'YouTube Shorts', ratio: '9:16' },
                  { id: 'youtube', label: 'YouTube', ratio: '16:9' },
                  { id: 'facebook', label: 'Facebook', ratio: '16:9' },
                ].map((p) => {
                  const isSel = preset === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPreset(p.id as any)}
                      className={`p-3 rounded-2xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-1 ${
                        isSel
                          ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 ring-2 ring-cyan-400/40 shadow-lg'
                          : 'bg-zinc-950/80 border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700'
                      }`}
                    >
                      <span className="font-bold text-xs text-white">{p.label}</span>
                      <span className="text-[10px] text-zinc-400 font-mono">{p.ratio}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dropdowns / Options Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-zinc-400">Resolution</label>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as any)}
                  className="w-full bg-zinc-950 text-xs text-zinc-200 font-mono py-2.5 px-3 rounded-xl border border-zinc-800 focus:outline-none focus:border-cyan-400 cursor-pointer"
                >
                  <option value="480p">480P (854×480)</option>
                  <option value="720p">720P (1280×720)</option>
                  <option value="1080p">1080P (1920×1080)</option>
                  <option value="4k">4K (3840×2160)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-zinc-400">Frame Rate</label>
                <select
                  value={fps}
                  onChange={(e) => setFps(e.target.value)}
                  className="w-full bg-zinc-950 text-xs text-zinc-200 font-mono py-2.5 px-3 rounded-xl border border-zinc-800 focus:outline-none focus:border-cyan-400 cursor-pointer"
                >
                  <option value="24">24 FPS</option>
                  <option value="30">30 FPS</option>
                  <option value="60">60 FPS</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-zinc-400">Quality</label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                  className="w-full bg-zinc-950 text-xs text-zinc-200 font-mono py-2.5 px-3 rounded-xl border border-zinc-800 focus:outline-none focus:border-cyan-400 cursor-pointer"
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-zinc-400">Video Codec</label>
                <select
                  value={videoCodec}
                  onChange={(e) => setVideoCodec(e.target.value)}
                  className="w-full bg-zinc-950 text-xs text-zinc-200 font-mono py-2.5 px-3 rounded-xl border border-zinc-800 focus:outline-none focus:border-cyan-400 cursor-pointer"
                >
                  <option value="H.264 (Recommended)">H.264 (Recommended)</option>
                  <option value="H.265 (HEVC)">H.265 (HEVC)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-zinc-400">Audio Codec</label>
                <select
                  value={audioCodec}
                  onChange={(e) => setAudioCodec(e.target.value)}
                  className="w-full bg-zinc-950 text-xs text-zinc-200 font-mono py-2.5 px-3 rounded-xl border border-zinc-800 focus:outline-none focus:border-cyan-400 cursor-pointer"
                >
                  <option value="AAC (Standard)">AAC (Standard)</option>
                  <option value="MP3">MP3</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-zinc-400">Audio Bitrate</label>
                <select
                  value={audioBitrate}
                  onChange={(e) => setAudioBitrate(e.target.value)}
                  className="w-full bg-zinc-950 text-xs text-zinc-200 font-mono py-2.5 px-3 rounded-xl border border-zinc-800 focus:outline-none focus:border-cyan-400 cursor-pointer"
                >
                  <option value="128 kbps">128 kbps</option>
                  <option value="192 kbps">192 kbps</option>
                  <option value="320 kbps">320 kbps</option>
                </select>
              </div>
            </div>

            <button
              onClick={handleStartExport}
              disabled={isExporting}
              className="w-full py-4 bg-gradient-to-r from-cyan-400 via-teal-300 to-blue-500 hover:opacity-95 disabled:opacity-50 text-zinc-950 font-black text-sm rounded-2xl transition-all shadow-xl shadow-cyan-500/25 flex items-center justify-center gap-2.5 cursor-pointer mt-2"
            >
              <Film className="w-5 h-5 stroke-[2.5]" />
              <span>Export Video</span>
            </button>
          </div>
        </div>

        {/* BOTTOM LEFT: Export Progress Panel */}
        <div className="lg:col-span-6 space-y-4">
          <div className="glass-panel rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <span className="text-xs font-bold text-white flex items-center gap-2">
                <RotateCw className={`w-4 h-4 text-cyan-400 ${isExporting ? 'animate-spin' : ''}`} />
                <span>Export Progress</span>
              </span>
              {isExporting && (
                <button
                  type="button"
                  onClick={handleCancelExport}
                  className="px-3 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-bold rounded-xl border border-rose-500/30 flex items-center gap-1.5 cursor-pointer"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Cancel Export</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-5 items-center">
              {/* Circular Progress Gauge */}
              <div className="sm:col-span-4 flex flex-col items-center justify-center">
                <div className="relative w-24 h-24 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                    <path
                      className="text-zinc-800"
                      strokeWidth="3.5"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                    <path
                      className="text-cyan-400 transition-all duration-300"
                      strokeDasharray={`${progressPct}, 100`}
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                  </svg>
                  <div className="absolute text-sm font-black font-mono text-white">
                    {progressPct}%
                  </div>
                </div>
              </div>

              {/* Progress Text & Status */}
              <div className="sm:col-span-8 space-y-3">
                <div>
                  <h4 className="text-sm font-bold text-white">{statusText}</h4>
                  <p className="text-xs text-zinc-400 mt-0.5">Applying effects and encoding with FFmpeg</p>
                </div>

                <div className="w-full h-2 bg-zinc-900 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-400 to-teal-400 transition-all duration-300 rounded-full"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 pt-1">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-cyan-400" /> Elapsed: 00:00:{String(elapsedSecs).padStart(2, '0')}
                  </span>
                  <span>Remaining: ~00:00:{String(etaSecs).padStart(2, '0')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* BOTTOM RIGHT: Result Preview Panel */}
        <div className="lg:col-span-6 space-y-4">
          <div className="glass-panel rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <span className="text-xs font-bold text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Result Preview</span>
              </span>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded border border-emerald-500/20">
                Ready
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
              <div className="sm:col-span-5 rounded-2xl overflow-hidden border border-emerald-500/30 bg-black aspect-video flex items-center justify-center relative">
                {exportResult ? (
                  <video src={exportResult.downloadUrl} controls className="w-full h-full object-contain" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-zinc-950 text-zinc-600 text-xs">
                    Preview
                  </div>
                )}
              </div>

              <div className="sm:col-span-7 space-y-1.5 text-xs font-mono">
                <div className="flex items-center gap-2 text-zinc-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                  <span className="truncate">Output: {exportResult ? exportResult.filename : 'recap_miyo_1080p.mp4'}</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                  <span>Size: {exportResult ? exportResult.fileSizeMb : '12.4 MB'}</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                  <span>Resolution: {(() => { const d = getExportDimensions(); return `${d.width}×${d.height}`; })()}</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                  <span>Duration: {formatTime(durationSec)}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <a
                href={exportResult ? exportResult.downloadUrl : '#'}
                download={exportResult ? exportResult.filename : 'recap_miyo_1080p.mp4'}
                onClick={(e) => {
                  if (!exportResult) {
                    e.preventDefault();
                    alert('Please export the video first.');
                  }
                }}
                className="py-3 bg-gradient-to-r from-cyan-400 to-blue-500 hover:opacity-95 text-zinc-950 font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/25 cursor-pointer"
              >
                <Download className="w-4 h-4 stroke-[2.5]" />
                <span>Download Video</span>
              </a>

              <button
                type="button"
                onClick={() => {
                  if (exportResult) {
                    const v = document.createElement('video');
                    v.src = exportResult.downloadUrl;
                    v.play().catch(() => {});
                  } else {
                    alert('Please export the video first.');
                  }
                }}
                className="py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Play Again</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Banners */}
      <div className="glass-panel rounded-2xl p-4 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
        <span className="text-amber-300 font-semibold flex items-center gap-2">
          <span>⭐</span>
          <span>Recap-MiYO • Studio HD MP4 &amp; Audio Exporter</span>
        </span>
        <span className="text-pink-300 font-semibold flex items-center gap-1.5">
          <span>💜</span>
          <span>Recap-MiYO • Make Your Video Amazing!</span>
        </span>
      </div>
    </div>
  );
};
