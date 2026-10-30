import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  CheckCircle2,
  Clock,
  Play,
  Pause,
  RotateCw,
  Scissors,
  Check,
  ChevronLeft,
  ChevronRight,
  Volume2,
  AudioLines,
  Sliders,
  User,
  ShieldCheck,
  Zap,
  Activity,
  Smile,
  AlertTriangle,
} from 'lucide-react';
import { ProjectState, TranscriptSegment, VoiceOption } from '../types';
import { countBurmeseSyllables, calculateMaxAllowedSyllables, shortenBurmeseTextForDuration } from '../utils/geminiPool';
import { synthesizeMyanmarVoice, VOICE_PROFILES } from '../utils/edgeTtsClient';

interface HumanReviewDubbingStudioProps {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  onSeekTo: (time: number) => void;
}

export const HumanReviewDubbingStudio: React.FC<HumanReviewDubbingStudioProps> = ({
  project,
  setProject,
  onSeekTo,
}) => {
  const [selectedSegIndex, setSelectedSegIndex] = useState<number>(0);
  const [isPlayingSegment, setIsPlayingSegment] = useState<boolean>(false);
  const [isShortening, setIsShortening] = useState<boolean>(false);
  const [isSynthesizing, setIsSynthesizing] = useState<boolean>(false);
  const [audioPlayer, setAudioPlayer] = useState<HTMLAudioElement | null>(null);
  const [visemeState, setVisemeState] = useState<'rest' | 'open' | 'half' | 'round' | 'wide'>('rest');

  const segments = project.segments || [];
  const currentSeg: TranscriptSegment | undefined = segments[selectedSegIndex];

  // Calculate current segment stats
  const slotDuration = currentSeg ? Math.max(0.5, currentSeg.endTime - currentSeg.startTime) : 5.0;
  const currentSyllables = currentSeg ? countBurmeseSyllables(currentSeg.myanmarTranslation) : 0;
  const maxSyllables = currentSeg?.maxAllowedSyllables || calculateMaxAllowedSyllables(slotDuration);
  const isOverBudget = currentSyllables > maxSyllables;

  // Auto-calculated atempo rate
  const calculatedAtempo = currentSeg?.audioDuration
    ? parseFloat(Math.min(1.35, Math.max(0.85, currentSeg.audioDuration / slotDuration)).toFixed(2))
    : (currentSeg?.atempoRate || 1.0);

  // Stop audio on unmount or segment change
  useEffect(() => {
    return () => {
      if (audioPlayer) {
        audioPlayer.pause();
      }
    };
  }, [audioPlayer]);

  // Viseme mouth movement simulation during audio playback
  useEffect(() => {
    let animInterval: NodeJS.Timeout;
    if (isPlayingSegment) {
      const visemes: ('open' | 'half' | 'round' | 'wide' | 'rest')[] = ['open', 'half', 'wide', 'round', 'half'];
      let step = 0;
      animInterval = setInterval(() => {
        step = (step + 1) % visemes.length;
        setVisemeState(visemes[step]);
      }, 140);
    } else {
      setVisemeState('rest');
    }
    return () => {
      if (animInterval) clearInterval(animInterval);
    };
  }, [isPlayingSegment]);

  const handleUpdateCurrentSeg = (updates: Partial<TranscriptSegment>) => {
    if (!currentSeg) return;
    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s, idx) => (idx === selectedSegIndex ? { ...s, ...updates } : s)),
    }));
  };

  const handleNudgeTime = (field: 'startTime' | 'endTime', delta: number) => {
    if (!currentSeg) return;
    const newVal = Math.max(0, parseFloat((currentSeg[field] + delta).toFixed(2)));
    if (field === 'startTime' && newVal >= currentSeg.endTime) return;
    if (field === 'endTime' && newVal <= currentSeg.startTime) return;

    const newDur = field === 'endTime' ? newVal - currentSeg.startTime : currentSeg.endTime - newVal;
    const newMaxSyl = calculateMaxAllowedSyllables(newDur);

    handleUpdateCurrentSeg({
      [field]: newVal,
      duration: parseFloat(newDur.toFixed(2)),
      maxAllowedSyllables: newMaxSyl,
    });
    onSeekTo(newVal);
  };

  // 1-Click AI Syllable Shortener
  const handleShortenText = async () => {
    if (!currentSeg || isShortening) return;
    setIsShortening(true);
    try {
      const shortened = await shortenBurmeseTextForDuration(
        currentSeg.myanmarTranslation,
        slotDuration,
        currentSeg.originalText
      );
      if (shortened && shortened !== currentSeg.myanmarTranslation) {
        const newSyl = countBurmeseSyllables(shortened);
        handleUpdateCurrentSeg({
          myanmarTranslation: shortened,
          subtitleText: shortened,
          syllableCount: newSyl,
        });
      }
    } catch (e) {
      console.warn('Failed to shorten segment text:', e);
    } finally {
      setIsShortening(false);
    }
  };

  // Generate / Regenerate Single Male Narrator Audio
  const handleSynthesizeCurrent = async () => {
    if (!currentSeg || isSynthesizing) return;
    setIsSynthesizing(true);
    try {
      const voiceToUse: VoiceOption = currentSeg.voice || 'Thiha';
      const result = await synthesizeMyanmarVoice(currentSeg.myanmarTranslation, {
        voice: voiceToUse,
        style: 'conversational',
        speed: currentSeg.atempoRate || 1.0,
      });

      const audioDur = result.duration;
      const atempo = parseFloat(Math.min(1.35, Math.max(0.85, audioDur / slotDuration)).toFixed(2));

      handleUpdateCurrentSeg({
        audioUrl: result.audioUrl,
        audioDuration: audioDur,
        atempoRate: atempo,
      });
    } catch (err: any) {
      console.error('TTS error:', err);
      alert(`အသံသွင်းမှု မအောင်မြင်ပါ: ${err.message || 'Error'}`);
    } finally {
      setIsSynthesizing(false);
    }
  };

  // 1-Click "Listen & Inspect"
  const handleListenAndInspect = () => {
    if (!currentSeg) return;

    if (isPlayingSegment && audioPlayer) {
      audioPlayer.pause();
      setIsPlayingSegment(false);
      return;
    }

    onSeekTo(currentSeg.startTime);

    if (currentSeg.audioUrl) {
      const audio = new Audio(currentSeg.audioUrl);
      const speed = currentSeg.atempoRate || 1.0;
      audio.playbackRate = speed;
      (audio as any).preservesPitch = true;
      (audio as any).webkitPreservesPitch = true;

      audio.onended = () => setIsPlayingSegment(false);
      audio.onerror = () => setIsPlayingSegment(false);

      audio.play().then(() => {
        setAudioPlayer(audio);
        setIsPlayingSegment(true);
      }).catch((e) => {
        console.warn('Inspect play error:', e);
        setIsPlayingSegment(false);
      });
    } else {
      handleSynthesizeCurrent();
    }
  };

  if (segments.length === 0) {
    return (
      <div className="glass-panel rounded-2xl p-6 text-center space-y-3 border border-white/10">
        <Sparkles className="w-8 h-8 text-cyan-400 mx-auto" />
        <h3 className="text-sm font-bold text-white font-display">
          အဆင့် ၇ — လူကိုယ်တိုင် စစ်ဆေးညှိနှိုင်းခန်း (Human-in-the-Loop Review Studio)
        </h3>
        <p className="text-xs text-zinc-400 font-myanmar">
          စစ်ဆေးရန် Segment များ မရှိသေးပါ။ အဆင့် ၄ (AI Transcript) တွင် Speech-to-Text အရင် ပြုလုပ်ပေးပါ။
        </p>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-3xl p-6 shadow-2xl space-y-6 border border-cyan-500/30 backdrop-blur-2xl relative overflow-hidden">
      {/* Background Ambient Glow */}
      <div className="absolute top-0 right-0 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* 7-STAGE PIPELINE HEADER */}
      <div className="pb-4 border-b border-white/10 relative z-10 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-cyan-400 to-teal-400 text-zinc-950 font-black flex items-center justify-center text-sm shadow-lg shadow-cyan-500/20">
              7
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-white font-display tracking-tight flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-cyan-400" />
                  <span>Myanmar AI Dubbing Workflow (၇ ဆင့် စစ်ဆေးရေး စတူဒီယို)</span>
                </h2>
                <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono text-[10px] font-bold border border-cyan-500/30">
                  Human-in-the-Loop
                </span>
              </div>
              <p className="text-xs text-zinc-400 font-myanmar mt-0.5">
                စကားအစ၊ စကားအဆုံး၊ Pause နှင့် ပါးစပ်လှုပ်ရှားမှု (Lip-Sync) ကို မူရင်းဗီဒီယိုနှင့် ကွက်တိဖြစ်အောင် ပြန်လည်စစ်ဆေးပါ။
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-mono text-zinc-400">
              Approved: <strong className="text-emerald-400">{segments.filter((s) => s.isHumanReviewed).length}</strong> / {segments.length}
            </span>
          </div>
        </div>

        {/* 7-Step Visual Pipeline Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1.5 text-[10px] font-bold pt-2">
          <div className="px-2 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-center">
            1. Scene/Shot ခွဲခြမ်း
          </div>
          <div className="px-2 py-1.5 rounded-lg bg-sky-500/20 border border-sky-500/40 text-sky-300 text-center">
            2. Speaker Diarization
          </div>
          <div className="px-2 py-1.5 rounded-lg bg-teal-500/20 border border-teal-500/40 text-teal-300 text-center">
            3. 5s စာတိုပြန်ဆိုချက်
          </div>
          <div className="px-2 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-center">
            4. ယောက်ျားအသံ TTS
          </div>
          <div className="px-2 py-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-center">
            5. atempo Retiming
          </div>
          <div className="px-2 py-1.5 rounded-lg bg-purple-500/20 border border-purple-500/40 text-purple-300 text-center">
            6. Lip-Sync ချိန်ညှိ
          </div>
          <div className="px-2 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-center ring-1 ring-amber-400">
            7. လူကိုယ်တိုင် စစ်ဆေး
          </div>
        </div>
      </div>

      {/* SEGMENT STRIP SELECTOR */}
      <div className="space-y-2 relative z-10">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-white flex items-center gap-1.5 font-display">
            <AudioLines className="w-3.5 h-3.5 text-cyan-400" />
            <span>Timeline Segments ({segments.length} ခု)</span>
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setSelectedSegIndex((prev) => Math.max(0, prev - 1))}
              disabled={selectedSegIndex === 0}
              className="p-1 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-mono text-zinc-300 font-bold px-2">
              #{selectedSegIndex + 1} of {segments.length}
            </span>
            <button
              onClick={() => setSelectedSegIndex((prev) => Math.min(segments.length - 1, prev + 1))}
              disabled={selectedSegIndex === segments.length - 1}
              className="p-1 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 disabled:opacity-40 cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Horizontal Segment Scrubber Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-thin">
          {segments.map((seg, idx) => {
            const isSelected = idx === selectedSegIndex;
            const hasAudio = !!seg.audioUrl;
            const isApproved = !!seg.isHumanReviewed;
            return (
              <button
                key={seg.id}
                onClick={() => {
                  setSelectedSegIndex(idx);
                  onSeekTo(seg.startTime);
                }}
                className={`px-3 py-2 rounded-xl text-left transition-all shrink-0 border cursor-pointer ${
                  isSelected
                    ? 'bg-cyan-500/25 border-cyan-400 text-white shadow-lg ring-1 ring-cyan-400/50'
                    : isApproved
                    ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/30'
                    : hasAudio
                    ? 'bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10'
                    : 'bg-black/40 border-white/5 text-zinc-500 hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-1.5 text-[10px] font-mono">
                  <span>#{idx + 1}</span>
                  {isApproved && <Check className="w-3 h-3 text-emerald-400 stroke-[3]" />}
                </div>
                <div className="text-[11px] font-bold truncate max-w-[110px]">
                  {seg.startTime.toFixed(1)}s - {seg.endTime.toFixed(1)}s
                </div>
                <div className="text-[9px] text-zinc-400 truncate max-w-[110px] font-myanmar">
                  {seg.myanmarTranslation || 'No translation'}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ACTIVE SEGMENT INSPECTION & ADJUSTMENT WORKBENCH */}
      {currentSeg && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start relative z-10">
          {/* LEFT COLUMN: Timestamp Tuning & Syllable 5-Second Brevity Controls */}
          <div className="lg:col-span-7 space-y-4">
            {/* Shot & Speaker Diarization Badges */}
            <div className="flex items-center justify-between gap-2 p-3 rounded-2xl bg-black/40 border border-white/10 text-xs">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-lg bg-sky-500/20 text-sky-300 border border-sky-500/30 font-semibold font-mono">
                  🎬 {currentSeg.sceneShotId || `Shot ${Math.floor(selectedSegIndex / 2) + 1}`}
                </span>
                <span className="px-2.5 py-0.5 rounded-lg bg-teal-500/20 text-teal-300 border border-teal-500/30 font-semibold flex items-center gap-1">
                  <User className="w-3 h-3" />
                  <span>{currentSeg.speaker || 'Speaker 1 (Adult Male)'}</span>
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleUpdateCurrentSeg({ isHumanReviewed: !currentSeg.isHumanReviewed })}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    currentSeg.isHumanReviewed
                      ? 'bg-emerald-500 text-zinc-950 shadow-md font-black'
                      : 'bg-white/10 hover:bg-white/15 text-zinc-300 border border-white/10'
                  }`}
                >
                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                  <span>{currentSeg.isHumanReviewed ? 'စစ်ဆေး အတည်ပြုပြီး' : 'အတည်ပြုရန် နှိပ်ပါ'}</span>
                </button>
              </div>
            </div>

            {/* Original Spoken Text */}
            {currentSeg.originalText && (
              <div className="p-3 rounded-2xl bg-zinc-950/80 border border-white/5 space-y-1">
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block font-display">
                  မူရင်းစကားပြော (Original Dialogue):
                </span>
                <p className="text-xs text-zinc-300 font-sans">{currentSeg.originalText}</p>
              </div>
            )}

            {/* Burmese Translation & 5-Second Syllable Brevity Budget */}
            <div className="p-4 rounded-2xl bg-black/50 border border-cyan-500/30 space-y-3">
              <div className="flex items-center justify-between text-xs flex-wrap gap-2">
                <span className="font-bold text-cyan-300 font-myanmar flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  <span>မြန်မာဘာသာပြန်စကားပြော (5s Duration Constraint):</span>
                </span>

                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold ${
                      isOverBudget
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    }`}
                  >
                    Syllables: {currentSyllables} / {maxSyllables} max ({slotDuration.toFixed(1)}s slot)
                  </span>

                  <button
                    onClick={handleShortenText}
                    disabled={isShortening}
                    className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-xl text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1 disabled:opacity-50"
                    title="မူရင်းစကားပြောချိန်အတွင်း ဖတ်နိုင်ရန် AI ဖြင့် စာတိုအောင် ပြင်မည်"
                  >
                    {isShortening ? (
                      <RotateCw className="w-3 h-3 animate-spin text-amber-400" />
                    ) : (
                      <Scissors className="w-3 h-3 text-amber-400" />
                    )}
                    <span>{isShortening ? 'ချုံ့နေသည်...' : '✂️ 5s စာတိုချုံ့မည်'}</span>
                  </button>
                </div>
              </div>

              {isOverBudget && (
                <div className="p-2 rounded-xl bg-amber-950/60 border border-amber-500/40 text-[11px] text-amber-300 font-myanmar flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    သတိပြုရန်: မြန်မာစာလုံးရေ ({currentSyllables}) သည် သတ်မှတ်ချိန် ({slotDuration.toFixed(1)}s) ထက် များနေသဖြင့် အသံထွက်ကြာနိုင်ပါသည်။ '5s စာတိုချုံ့မည်' ကို နှိပ်၍ စာလုံး လျှော့ချပါ။
                  </span>
                </div>
              )}

              <textarea
                value={currentSeg.myanmarTranslation}
                onChange={(e) => {
                  const val = e.target.value;
                  const syl = countBurmeseSyllables(val);
                  handleUpdateCurrentSeg({
                    myanmarTranslation: val,
                    subtitleText: val,
                    syllableCount: syl,
                  });
                }}
                rows={2}
                placeholder="တိုတောင်း၍ လိုရင်းရောက်သော မြန်မာစကားပြော..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-white/10 text-xs text-white font-myanmar focus:outline-none focus:border-cyan-400 transition-colors"
              />
            </div>

            {/* PRECISION TIMESTAMPS: START TIME & END TIME CONTROLS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Start Time (စကားစချိန်) */}
              <div className="p-3.5 rounded-2xl bg-zinc-950/70 border border-white/10 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-zinc-300 font-myanmar">စကားစချိန် (Start Time):</span>
                  <span className="font-mono text-cyan-300 font-bold">{currentSeg.startTime.toFixed(2)}s</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleNudgeTime('startTime', -0.2)}
                    className="flex-1 py-1 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-mono font-bold cursor-pointer"
                  >
                    -0.2s
                  </button>
                  <button
                    onClick={() => handleNudgeTime('startTime', -0.05)}
                    className="flex-1 py-1 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-mono font-bold cursor-pointer"
                  >
                    -0.05s
                  </button>
                  <button
                    onClick={() => handleNudgeTime('startTime', 0.05)}
                    className="flex-1 py-1 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-mono font-bold cursor-pointer"
                  >
                    +0.05s
                  </button>
                  <button
                    onClick={() => handleNudgeTime('startTime', 0.2)}
                    className="flex-1 py-1 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-mono font-bold cursor-pointer"
                  >
                    +0.2s
                  </button>
                </div>
              </div>

              {/* End Time (စကားဆုံးချိန်) */}
              <div className="p-3.5 rounded-2xl bg-zinc-950/70 border border-white/10 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-zinc-300 font-myanmar">စကားဆုံးချိန် (End Time):</span>
                  <span className="font-mono text-cyan-300 font-bold">{currentSeg.endTime.toFixed(2)}s</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleNudgeTime('endTime', -0.2)}
                    className="flex-1 py-1 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-mono font-bold cursor-pointer"
                  >
                    -0.2s
                  </button>
                  <button
                    onClick={() => handleNudgeTime('endTime', -0.05)}
                    className="flex-1 py-1 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-mono font-bold cursor-pointer"
                  >
                    -0.05s
                  </button>
                  <button
                    onClick={() => handleNudgeTime('endTime', 0.05)}
                    className="flex-1 py-1 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-mono font-bold cursor-pointer"
                  >
                    +0.05s
                  </button>
                  <button
                    onClick={() => handleNudgeTime('endTime', 0.2)}
                    className="flex-1 py-1 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-mono font-bold cursor-pointer"
                  >
                    +0.2s
                  </button>
                </div>
              </div>
            </div>

            {/* PAUSE & REACTION TIMING (အသက်ရှုချိန် & တုံ့ပြန်မှု ချိန်ညှိမှု) */}
            <div className="p-3.5 rounded-2xl bg-zinc-950/70 border border-white/10 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-zinc-300 font-myanmar">
                  စကားမစမီ Pause & Reaction ချိန်ညှိမှု:
                </span>
                <span className="font-mono text-teal-300 text-[11px]">
                  Lead: {(currentSeg.pauseLead || 0.1).toFixed(2)}s | Trail: {(currentSeg.pauseTrail || 0.15).toFixed(2)}s
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <label className="text-[10px] text-zinc-400 font-myanmar">စကားမစမီ Lead Pause</label>
                  <input
                    type="range"
                    min="0"
                    max="0.5"
                    step="0.05"
                    value={currentSeg.pauseLead || 0.1}
                    onChange={(e) => handleUpdateCurrentSeg({ pauseLead: parseFloat(e.target.value) })}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-zinc-400 font-myanmar">စကားဆုံး Trail Pause</label>
                  <input
                    type="range"
                    min="0"
                    max="0.5"
                    step="0.05"
                    value={currentSeg.pauseTrail || 0.15}
                    onChange={(e) => handleUpdateCurrentSeg({ pauseTrail: parseFloat(e.target.value) })}
                    className="w-full accent-teal-400 cursor-pointer"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Single Male Voice Synthesis, atempo, and Lip-Sync Engine */}
          <div className="lg:col-span-5 space-y-4">
            {/* Adult Male Narrator Voice Selector */}
            <div className="p-4 rounded-2xl bg-black/40 border border-emerald-500/30 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-emerald-300 font-myanmar flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-emerald-400" />
                  <span>အနီးစပ်ဆုံး ယောက်ျားအသံ (Adult Male Narrator):</span>
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold">
                  Single Male
                </span>
              </div>

              <select
                value={currentSeg.voice || 'Thiha'}
                onChange={(e) => handleUpdateCurrentSeg({ voice: e.target.value as VoiceOption })}
                className="w-full px-3 py-2 bg-zinc-900 border border-emerald-500/40 rounded-xl text-xs font-bold text-emerald-300 focus:outline-none cursor-pointer"
              >
                <option value="Thiha">သီဟ / Thiha — နွေးထွေးခန့်ညားသော Adult Male (အနီးစပ်ဆုံး သဘာဝအသံ)</option>
                <option value="KyawKyaw">ကျော်ကျော် / Kyaw Kyaw — သြဇာကြီးမား နက်နဲသော Bass Male</option>
                <option value="MinThway">မင်းသွေး / Min Thway — အေးချမ်းတည်ကြည်သော Adult Male</option>
                <option value="AungAung">အောင်အောင် / Aung Aung — တက်ကြွသွက်လက်သော Male</option>
              </select>

              {/* atempo Speed / Retiming Control */}
              <div className="space-y-1.5 pt-2 border-t border-white/5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300 font-myanmar flex items-center gap-1">
                    <Activity className="w-3.5 h-3.5 text-cyan-400" />
                    <span>atempo Dynamic Retime (Pitch Preserved):</span>
                  </span>
                  <span className="font-mono text-cyan-300 font-bold text-xs">
                    {(currentSeg.atempoRate || calculatedAtempo).toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  min="0.85"
                  max="1.35"
                  step="0.01"
                  value={currentSeg.atempoRate || calculatedAtempo}
                  onChange={(e) => handleUpdateCurrentSeg({ atempoRate: parseFloat(e.target.value) })}
                  className="w-full accent-cyan-400 cursor-pointer"
                />
                <div className="flex items-center justify-between text-[9px] text-zinc-500 font-mono">
                  <span>0.85x (Slow)</span>
                  <span>1.00x (Normal)</span>
                  <span>1.35x (Snappy)</span>
                </div>
              </div>
            </div>

            {/* LIP-SYNC VISUAL ENGINE PREVIEW */}
            <div className="p-4 rounded-2xl bg-zinc-950/90 border border-purple-500/30 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-purple-300 font-display flex items-center gap-1.5">
                  <Smile className="w-3.5 h-3.5 text-purple-400" />
                  <span>Lip-Sync Engine (ပါးစပ်လှုပ်ရှားမှု ချိန်ညှိချက်)</span>
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300">
                  Viseme State: {visemeState.toUpperCase()}
                </span>
              </div>

              {/* Animated Viseme Mouth Shape */}
              <div className="p-3 rounded-xl bg-black/60 border border-white/5 flex items-center justify-center gap-4">
                <div className="w-16 h-12 rounded-2xl bg-zinc-900 border border-purple-500/40 flex items-center justify-center relative overflow-hidden">
                  {visemeState === 'rest' && (
                    <div className="w-8 h-1 rounded-full bg-purple-400" />
                  )}
                  {visemeState === 'half' && (
                    <div className="w-7 h-3 rounded-full bg-purple-400 animate-pulse" />
                  )}
                  {visemeState === 'open' && (
                    <div className="w-8 h-6 rounded-2xl bg-purple-400 transition-all" />
                  )}
                  {visemeState === 'round' && (
                    <div className="w-5 h-5 rounded-full bg-purple-400 transition-all" />
                  )}
                  {visemeState === 'wide' && (
                    <div className="w-10 h-3 rounded-full bg-purple-400 transition-all" />
                  )}
                </div>

                <div className="text-left text-[11px] space-y-0.5">
                  <span className="font-bold text-white block">
                    {visemeState === 'rest' ? 'Mouth Rest (စကားနားချိန်)' : 'Mouth Speaking (အသံထွက်နေစဉ်)'}
                  </span>
                  <span className="text-[10px] text-zinc-400 font-myanmar block">
                    {currentSeg.lipSyncNote || 'မူရင်းစကားပြော timing နှင့် ကွက်တိ ကိုက်ညီမှု ရှိပါသည်'}
                  </span>
                </div>
              </div>
            </div>

            {/* ACTION BUTTONS: LISTEN & INSPECT + SYNTHESIZE */}
            <div className="space-y-2">
              <button
                onClick={handleListenAndInspect}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 hover:opacity-90 text-zinc-950 font-black text-xs transition-all flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 cursor-pointer active:scale-95"
              >
                {isPlayingSegment ? (
                  <>
                    <Pause className="w-4 h-4 fill-zinc-950" />
                    <span>ရပ်တန့်မည် (Stop Inspect)</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-zinc-950" />
                    <span>နားထောင်ပြီး စစ်ဆေးမည် (Listen & Inspect)</span>
                  </>
                )}
              </button>

              <button
                onClick={handleSynthesizeCurrent}
                disabled={isSynthesizing}
                className="w-full py-2.5 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-emerald-300 border border-emerald-500/30 text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSynthesizing ? (
                  <>
                    <RotateCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                    <span>အသံထုတ်လုပ်နေပါသည်...</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>အသံအသစ် ထုတ်လုပ်မည် (Regenerate Voice)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
