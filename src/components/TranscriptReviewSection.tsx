import React, { useState } from 'react';
import {
  Clock,
  Play,
  Volume2,
  CheckCircle,
  AlertTriangle,
  Scissors,
  Check,
  Edit3,
  Loader2,
  Sparkles,
  Layers,
  HelpCircle,
} from 'lucide-react';
import { NarratorSegment } from '../types/narrator';
import { refineSegmentText, generateSegmentAudio } from '../utils/narratorApi';

interface TranscriptReviewSectionProps {
  jobId: string;
  segments: NarratorSegment[];
  onUpdateSegment: (segmentId: string, updates: Partial<NarratorSegment>) => void;
  onSeekVideo: (time: number) => void;
  onGenerateAll: () => void;
  isGeneratingAll: boolean;
  disabled?: boolean;
}

export const TranscriptReviewSection: React.FC<TranscriptReviewSectionProps> = ({
  jobId,
  segments,
  onUpdateSegment,
  onSeekVideo,
  onGenerateAll,
  isGeneratingAll,
  disabled = false,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [refiningId, setRefiningId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [activeAudioObj, setActiveAudioObj] = useState<HTMLAudioElement | null>(null);

  const formatMinSec = (sec: number): string => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m}:${s < 10 ? '0' : ''}${s}.${ms}`;
  };

  const handlePlayAudio = (seg: NarratorSegment) => {
    if (!seg.audioUrl) return;

    if (activeAudioObj) {
      activeAudioObj.pause();
    }

    if (playingAudioId === seg.id) {
      setPlayingAudioId(null);
      return;
    }

    const audio = new Audio(seg.audioUrl);
    setActiveAudioObj(audio);
    setPlayingAudioId(seg.id);

    audio.onended = () => {
      setPlayingAudioId(null);
    };
    audio.onerror = () => {
      setPlayingAudioId(null);
    };

    audio.play().catch(() => setPlayingAudioId(null));
  };

  const handleRefineText = async (seg: NarratorSegment) => {
    setRefiningId(seg.id);
    try {
      const refined = await refineSegmentText(seg.burmeseText, seg.duration, seg.sourceText);
      if (refined && refined !== seg.burmeseText) {
        onUpdateSegment(seg.id, { burmeseText: refined });
      }
    } catch (err) {
      console.warn('Refine text notice:', err);
    } finally {
      setRefiningId(null);
    }
  };

  const handleGenerateVoice = async (seg: NarratorSegment) => {
    setGeneratingId(seg.id);
    try {
      const res = await generateSegmentAudio(jobId, seg.id, seg.burmeseText);
      if (res.segment) {
        onUpdateSegment(seg.id, res.segment);
      }
    } catch (err: any) {
      console.error('Failed to generate segment audio:', err);
      onUpdateSegment(seg.id, { status: 'error', errorMessage: err.message });
    } finally {
      setGeneratingId(null);
    }
  };

  const handleApproveAll = () => {
    segments.forEach((seg) => {
      if (!seg.approved) {
        onUpdateSegment(seg.id, { approved: true });
      }
    });
  };

  const approvedCount = segments.filter((s) => s.approved).length;

  return (
    <section className="p-6 sm:p-7 rounded-3xl bg-zinc-900/60 border border-white/10 shadow-2xl backdrop-blur-xl space-y-5">
      {/* Step Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold flex items-center justify-center text-sm shadow-md">
            ၄
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white tracking-tight">
                Transcript နှင့် အချိန်ညှိရန် (Transcript & Timing Review)
              </h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-mono">
                {segments.length} အပိုင်း
              </span>
            </div>
            <p className="text-xs text-zinc-400 font-myanmar mt-0.5">
              မူရင်းအဓိပ္ပာယ်၊ အမည်များ၊ ကိန်းဂဏန်းများ မပျက်စေဘဲ ဇာတ်ညွှန်းကို ပြင်ဆင်စစ်ဆေး အတည်ပြုပါ
            </p>
          </div>
        </div>

        {/* Global Review Actions */}
        <div className="flex items-center gap-2 self-start sm:self-center">
          <button
            type="button"
            onClick={handleApproveAll}
            disabled={disabled || segments.length === 0}
            className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-emerald-300 border border-emerald-500/30 text-xs font-bold font-myanmar transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            <span>အားလုံးကို အတည်ပြုမည် ({approvedCount}/{segments.length})</span>
          </button>

          <button
            type="button"
            onClick={onGenerateAll}
            disabled={disabled || isGeneratingAll || segments.length === 0}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 text-zinc-950 text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer shadow-lg shadow-cyan-500/20 active:scale-95 disabled:opacity-50"
          >
            {isGeneratingAll ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 stroke-[2.5]" />
            )}
            <span className="font-myanmar">
              {isGeneratingAll ? 'အသံများ ထုတ်လုပ်နေပါသည်...' : 'ဇာတ်ကြောင်းပြော အသံအားလုံးထုတ်မည်'}
            </span>
          </button>
        </div>
      </div>

      {/* Segments Container */}
      {segments.length === 0 ? (
        <div className="p-10 rounded-2xl bg-black/30 border border-white/5 text-center space-y-2">
          <Clock className="w-8 h-8 text-zinc-500 mx-auto" />
          <p className="text-xs text-zinc-400 font-myanmar">
            ဗီဒီယိုဖိုင်ကို တင်သွင်းပြီးပါက အပိုင်းအလိုက် စကားပြောများနှင့် အချိန်ကွက်များကို ဤနေရာတွင် စစ်ဆေးနိုင်ပါမည်။
          </p>
        </div>
      ) : (
        <div className="space-y-4 max-h-[38rem] overflow-y-auto pr-1">
          {segments.map((seg) => {
            const isEditing = editingId === seg.id;
            const isRefining = refiningId === seg.id;
            const isGeneratingThis = generatingId === seg.id;
            const isPlayingThis = playingAudioId === seg.id;

            return (
              <div
                key={seg.id}
                className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                  seg.approved
                    ? 'bg-emerald-950/15 border-emerald-500/30'
                    : 'bg-white/5 border-white/10 hover:border-white/20'
                }`}
              >
                {/* Segment Top Bar: Time, Seek, Status, Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2.5 pb-3 border-b border-white/5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono font-bold text-zinc-400">
                      #{seg.index}
                    </span>

                    {/* Seek Video Button */}
                    <button
                      type="button"
                      onClick={() => onSeekVideo(seg.startTime)}
                      className="px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs font-mono font-semibold flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
                      title="ဗီဒီယိုတွင် ဤအချိန်ကွက်သို့ ရွှေ့ဖွင့်မည်"
                    >
                      <Play className="w-3 h-3 text-cyan-400 fill-cyan-400" />
                      <span>
                        {formatMinSec(seg.startTime)} - {formatMinSec(seg.endTime)}
                      </span>
                    </button>

                    <span className="text-[11px] px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 font-mono">
                      {seg.duration.toFixed(1)}s (Duration)
                    </span>

                    {/* Audio Status & Player */}
                    {seg.audioUrl && (
                      <button
                        type="button"
                        onClick={() => handlePlayAudio(seg)}
                        className={`px-2.5 py-1 rounded-lg border text-xs font-bold font-myanmar flex items-center gap-1.5 transition-all cursor-pointer ${
                          isPlayingThis
                            ? 'bg-emerald-500 text-zinc-950 border-emerald-400'
                            : 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/40 text-emerald-300'
                        }`}
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>
                          {isPlayingThis ? 'နားထောင်နေသည်...' : `အသံနားထောင်မည် (${seg.audioDuration ? seg.audioDuration + 's' : ''})`}
                        </span>
                      </button>
                    )}
                  </div>

                  {/* Right side segment actions: Refine, Generate, Approve */}
                  <div className="flex items-center gap-2">
                    {/* Concise Rewrite AI button */}
                    <button
                      type="button"
                      onClick={() => handleRefineText(seg)}
                      disabled={isRefining || disabled}
                      className="px-2.5 py-1 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 text-[11px] font-bold font-myanmar transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      title="အချိန်အတွင်း ဝင်ဆံ့အောင် AI ဖြင့် စာတိုပြန်ညှိမည်"
                    >
                      {isRefining ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Scissors className="w-3 h-3 text-purple-400" />
                      )}
                      <span>{isRefining ? 'ပြန်ညှိနေသည်...' : 'AI စာတိုညှိ'}</span>
                    </button>

                    {/* Single Segment Voice Synthesis */}
                    <button
                      type="button"
                      onClick={() => handleGenerateVoice(seg)}
                      disabled={isGeneratingThis || disabled}
                      className="px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 text-[11px] font-bold font-myanmar transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      {isGeneratingThis ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3 text-cyan-400" />
                      )}
                      <span>{isGeneratingThis ? 'အသံထုတ်နေသည်...' : 'အသံထုတ်မည်'}</span>
                    </button>

                    {/* Approve Toggle */}
                    <button
                      type="button"
                      onClick={() => onUpdateSegment(seg.id, { approved: !seg.approved })}
                      className={`px-3 py-1 rounded-lg text-xs font-bold font-myanmar flex items-center gap-1 transition-all cursor-pointer ${
                        seg.approved
                          ? 'bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/20'
                          : 'bg-white/5 hover:bg-white/10 text-zinc-300 border border-white/10'
                      }`}
                    >
                      <Check className="w-3 h-3 stroke-[3]" />
                      <span>{seg.approved ? 'အတည်ပြုပြီး' : 'အတည်ပြုမည်'}</span>
                    </button>
                  </div>
                </div>

                {/* Source Speech and Dialogue */}
                <div className="py-3 grid grid-cols-1 md:grid-cols-12 gap-3 text-xs">
                  {/* Left: Source Text */}
                  <div className="md:col-span-5 p-3 rounded-xl bg-black/40 border border-white/5 space-y-1">
                    <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider block">
                      မူရင်း အသံစကားပြော (Source Transcript):
                    </span>
                    <p className="text-zinc-300 font-sans leading-relaxed">
                      {seg.sourceText || 'စကားပြော မပါဝင်သော မြင်ကွင်း'}
                    </p>
                  </div>

                  {/* Right: Burmese Narration Text */}
                  <div className="md:col-span-7 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-cyan-300 font-bold font-myanmar flex items-center gap-1.5">
                        <Edit3 className="w-3 h-3 text-cyan-400" />
                        <span>မြန်မာ ဇာတ်ကြောင်းပြောစာသား (Burmese Narrator Text):</span>
                      </span>

                      <span className="text-[10px] text-zinc-400 font-mono">
                        {seg.burmeseText.length} စာလုံး
                      </span>
                    </div>

                    <textarea
                      rows={2}
                      value={seg.burmeseText}
                      disabled={disabled}
                      onChange={(e) => onUpdateSegment(seg.id, { burmeseText: e.target.value })}
                      placeholder="မြန်မာ ဇာတ်ကြောင်းပြော စာသားကို ဤနေရာတွင် တည်းဖြတ်ပါ..."
                      className="w-full px-3.5 py-2.5 rounded-xl bg-black/60 border border-white/10 focus:border-cyan-400 text-xs text-white font-myanmar leading-relaxed outline-none transition-all resize-y"
                    />
                  </div>
                </div>

                {/* Bottom Row: Uncertain Words Alert & Duration Warnings */}
                {(seg.uncertainWords && seg.uncertainWords.length > 0) || seg.durationWarning ? (
                  <div className="pt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                    {/* Uncertain words pill tags */}
                    {seg.uncertainWords && seg.uncertainWords.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] text-amber-300 font-semibold font-myanmar flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-amber-400" />
                          <span>မသေချာသော စကားလုံးများ:</span>
                        </span>
                        {seg.uncertainWords.map((word, i) => (
                          <span
                            key={i}
                            className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20"
                          >
                            "{word}"
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Timing Warning */}
                    {seg.durationWarning && (
                      <span className="text-[10px] font-myanmar text-cyan-300 bg-cyan-950/60 px-2.5 py-1 rounded-lg border border-cyan-800">
                        {seg.durationWarning}
                      </span>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
