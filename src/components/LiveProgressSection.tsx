import React, { useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Clock,
  Film,
  Sparkles,
} from 'lucide-react';
import { NarratorJob, JobStage } from '../types/narrator';

interface LiveProgressSectionProps {
  job: NarratorJob | null;
  videoUrl: string | null;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onRetry: () => void;
  isRetrying?: boolean;
}

interface StageStep {
  key: JobStage;
  label: string;
  burmeseName: string;
}

export const LiveProgressSection: React.FC<LiveProgressSectionProps> = ({
  job,
  videoUrl,
  currentTime,
  onTimeUpdate,
  videoRef,
  onRetry,
  isRetrying = false,
}) => {
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [isMuted, setIsMuted] = React.useState(false);

  const stages: StageStep[] = [
    { key: 'uploading', label: 'Uploading', burmeseName: 'ဗီဒီယို တင်ယူခြင်း' },
    { key: 'reading_video', label: 'Reading video', burmeseName: 'ဗီဒီယို ဖတ်ရှုစစ်ဆေးခြင်း' },
    { key: 'transcribing', label: 'Transcribing', burmeseName: 'စကားပြော ခွဲထုတ်ခြင်း' },
    { key: 'translating', label: 'Translating', burmeseName: 'မြန်မာလို ပြန်ဆိုခြင်း' },
    { key: 'waiting_for_review', label: 'Waiting for review', burmeseName: 'စာသား အတည်ပြုရန်' },
    { key: 'generating_narration', label: 'Generating narration', burmeseName: 'ဇာတ်ကြောင်းပြော အသံသွင်းခြင်း' },
    { key: 'syncing_audio', label: 'Syncing audio', burmeseName: 'အသံနှင့် ညှိနှိုင်းခြင်း' },
    { key: 'exporting_mp4', label: 'Exporting MP4', burmeseName: 'ဗီဒီယို ထုတ်ယူခြင်း' },
  ];

  const getStageIndex = (stage: JobStage): number => {
    switch (stage) {
      case 'idle':
        return -1;
      case 'uploading':
        return 0;
      case 'reading_video':
        return 1;
      case 'transcribing':
        return 2;
      case 'translating':
        return 3;
      case 'waiting_for_review':
        return 4;
      case 'generating_narration':
        return 5;
      case 'syncing_audio':
        return 6;
      case 'exporting_mp4':
        return 7;
      case 'completed':
        return 8;
      case 'error':
        return 3; // depends
      default:
        return 0;
    }
  };

  const currentStageIndex = job ? getStageIndex(job.stage) : -1;

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
  };

  const formatElapsed = (sec: number): string => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Find active segment matching currentTime for on-screen subtitle preview
  const activeSegment = job?.segments.find(
    (s) => currentTime >= s.startTime && currentTime <= s.endTime
  );

  return (
    <section className="p-6 sm:p-7 rounded-3xl bg-zinc-900/60 border border-white/10 shadow-2xl backdrop-blur-xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold flex items-center justify-center text-sm shadow-md">
            ၅
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <span>Live Preview နှင့် လုပ်ဆောင်မှု အခြေအနေ (Live Preview & Status)</span>
            </h2>
            <p className="text-xs text-zinc-400 font-myanmar mt-0.5">
              တကယ့် Real Backend Status ဖြင့် လုပ်ဆောင်ချက်များကို တိုက်ရိုက် ကြည့်ရှုနိုင်ပါသည်
            </p>
          </div>
        </div>

        {/* Elapsed Time & Retry */}
        {job && (
          <div className="flex items-center gap-2.5 self-start sm:self-center">
            <div className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs text-zinc-300 font-mono flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span>ကြာချိန်: {formatElapsed(job.elapsedSeconds)}</span>
            </div>

            {job.stage === 'error' && (
              <button
                type="button"
                onClick={onRetry}
                disabled={isRetrying}
                className="px-3.5 py-1.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold font-myanmar flex items-center gap-1.5 transition-all cursor-pointer shadow-lg active:scale-95 disabled:opacity-50"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
                <span>ပြန်လည်ကြိုးစားမည် (Retry)</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Grid: Video Player + Pipeline Status */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Video Player */}
        <div className="lg:col-span-7 space-y-3">
          <div className="relative aspect-video rounded-2xl bg-black overflow-hidden border border-white/10 shadow-2xl flex items-center justify-center group">
            {videoUrl ? (
              <>
                <video
                  ref={videoRef as any}
                  src={videoUrl}
                  className="w-full h-full object-contain"
                  onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                />

                {/* Subtitle Overlay for Active Segment */}
                {activeSegment && (
                  <div className="absolute bottom-12 left-4 right-4 pointer-events-none text-center">
                    <span className="inline-block px-4 py-2 rounded-xl bg-black/80 backdrop-blur-md text-white text-xs sm:text-sm font-myanmar font-semibold shadow-2xl border border-white/15 leading-relaxed max-w-xl">
                      {activeSegment.burmeseText}
                    </span>
                  </div>
                )}

                {/* Overlay Controls */}
                <div className="absolute bottom-0 inset-x-0 p-3 bg-gradient-to-t from-black/90 via-black/50 to-transparent flex items-center justify-between text-xs text-white opacity-95 transition-opacity">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={togglePlay}
                      className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-all cursor-pointer"
                    >
                      {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>

                    <button
                      type="button"
                      onClick={toggleMute}
                      className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer"
                    >
                      {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>

                    <span className="font-mono text-[11px] text-zinc-300">
                      {Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60) < 10 ? '0' : ''}
                      {Math.floor(currentTime % 60)} /{' '}
                      {Math.floor((job?.videoMetadata.duration || 0) / 60)}:
                      {Math.floor((job?.videoMetadata.duration || 0) % 60) < 10 ? '0' : ''}
                      {Math.floor((job?.videoMetadata.duration || 0) % 60)}
                    </span>
                  </div>

                  {activeSegment && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                      Scene #{activeSegment.index}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center p-8 space-y-2 text-zinc-500">
                <Film className="w-10 h-10 mx-auto stroke-[1.5]" />
                <p className="text-xs font-myanmar">ဗီဒီယိုဖိုင် ရွေးချယ်ပြီးပါက ဤနေရာတွင် ကြည့်ရှုနိုင်ပါမည်</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Pipeline Stage Progression & Messages */}
        <div className="lg:col-span-5 space-y-4">
          {/* Main Progress Card */}
          <div className="p-4 sm:p-5 rounded-2xl bg-black/40 border border-white/10 space-y-3.5 backdrop-blur-xl">
            <div className="flex items-center justify-between text-xs font-myanmar">
              <span className="font-bold text-white flex items-center gap-2">
                {job?.stage === 'completed' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : job?.stage === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                ) : (
                  <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                )}
                <span>လုပ်ဆောင်မှု အဆင့်:</span>
              </span>
              <span className="font-mono text-cyan-300 font-bold text-sm">
                {job?.overallPercent || 0}%
              </span>
            </div>

            {/* Overall Progress Bar */}
            <div className="w-full h-2.5 rounded-full bg-zinc-800 overflow-hidden border border-white/5">
              <div
                className="h-full bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 transition-all duration-300 rounded-full"
                style={{ width: `${Math.max(5, job?.overallPercent || 0)}%` }}
              />
            </div>

            {/* Current Real Server Message */}
            <p className="text-xs text-zinc-300 font-myanmar bg-white/5 p-3 rounded-xl border border-white/5 leading-relaxed">
              {job?.message || 'ဗီဒီယိုဖိုင် စတင်ရန် အဆင်သင့်ဖြစ်ပါပြီ'}
            </p>

            {job?.error && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 font-myanmar flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{job.error}</span>
              </div>
            )}
          </div>

          {/* 8 Pipeline Stage Steps Checklist */}
          <div className="space-y-1.5 p-4 rounded-2xl bg-white/5 border border-white/5 text-xs font-myanmar">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-2">
              လုပ်ဆောင်မှု အဆင့် ၈ ဆင့် (Processing Stages):
            </span>

            {stages.map((stage, idx) => {
              const isPast = currentStageIndex > idx;
              const isCurrent = currentStageIndex === idx && job?.stage !== 'completed';
              const isDone = isPast || (job?.stage === 'completed' && idx <= 7);

              return (
                <div
                  key={stage.key}
                  className={`flex items-center justify-between py-1.5 px-2.5 rounded-lg transition-all ${
                    isCurrent
                      ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-300'
                      : isDone
                      ? 'text-emerald-300 font-medium'
                      : 'text-zinc-500'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {isDone ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : isCurrent ? (
                      <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0" />
                    ) : (
                      <span className="w-3.5 h-3.5 rounded-full border border-zinc-700 flex items-center justify-center text-[9px] shrink-0 font-mono">
                        {idx + 1}
                      </span>
                    )}
                    <span>{stage.burmeseName}</span>
                  </div>

                  <span className="text-[10px] font-mono text-zinc-400">
                    {isDone ? '✓ Completed' : isCurrent ? 'Running...' : 'Pending'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
