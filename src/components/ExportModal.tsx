import React, { useState, useRef, useEffect } from 'react';
import { X, Download, FileText, Video, CheckCircle2, RotateCw, Play } from 'lucide-react';
import { ProjectState } from '../types';
import { downloadFile } from '../utils/alightMotionRenderer';
import { exportToDubbingPlanJSON, generateBurmeseDubbingSRT } from '../utils/geminiPool';
import { exportCompositeVideo } from '../utils/canvasVideoExporter';

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
  const exportAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      exportAbortRef.current?.abort();
    };
  }, []);

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

  // Composite Video Export via shared freeze-free exporter
  const handleExportCompositeVideo = async () => {
    if (!project.videoUrl) {
      return;
    }

    exportAbortRef.current?.abort();
    const controller = new AbortController();
    exportAbortRef.current = controller;

    setIsExportingVideo(true);
    setExportProgress(2);
    setDownloadedUrl(null);

    let width = 1080;
    let height = 1920;
    if (frameSize === 'youtube') {
      width = 1920;
      height = 1080;
    } else if (frameSize === 'square') {
      width = 1080;
      height = 1080;
    } else if (frameSize === 'portrait') {
      width = 1080;
      height = 1350;
    } else if (frameSize === 'landscape') {
      width = 1280;
      height = 720;
    }

    try {
      const result = await exportCompositeVideo({
        project,
        width,
        height,
        videoBitsPerSecond: 8000000,
        forceMuteOriginalAudio: true,
        signal: controller.signal,
        onProgress: (pct) => setExportProgress(pct),
      });

      setExportProgress(100);
      setIsExportingVideo(false);

      const cleanBaseName = (project.videoName || 'recap').replace(/\.[^/.]+$/, '');
      const filename = `${cleanBaseName}_perfect.${result.extension}`;

      const url = URL.createObjectURL(result.blob);
      setDownloadedUrl(url);
      setDownloadFilename(filename);

      downloadFile(result.blob, filename, result.mimeType);
    } catch (err: any) {
      setIsExportingVideo(false);
      if (err?.message === 'Export cancelled') return;
      console.error('Export video error:', err);
    } finally {
      if (exportAbortRef.current === controller) {
        exportAbortRef.current = null;
      }
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
