import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Plus,
  Trash2,
  Edit3,
  Clock,
  Play,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
  Radio,
  Zap,
  Check,
  ArrowRight,
  ArrowLeft,
  Copy,
  Download,
  FileText,
  Eye,
  X,
  Volume2,
  Scissors,
} from 'lucide-react';
import { ProjectState, TranscriptSegment, AiMode } from '../types';
import {
  generateTimestampedTranscript,
  exportToDubbingPlanJSON,
  generateBurmeseDubbingSRT,
  shortenBurmeseTextForDuration,
  countBurmeseSyllables,
  calculateMaxAllowedSyllables,
  polishBurmeseNarrationStyle,
} from '../utils/geminiPool';
import { transcribeVideoWithAssemblyAi } from '../utils/assemblyAi';
import { loadApiKeys } from '../utils/apiKeys';
import { downloadFile } from '../utils/alightMotionRenderer';
import { getMinuteBlocks, formatMinSec, realignSegmentsByMinuteBlocks } from '../utils/timingSync';

interface AiRecapStudioProps {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  onSeekTo: (time: number) => void;
  onPrevStep?: () => void;
  onNextStep?: () => void;
  stepNumber?: number;
}

export const AiRecapStudio: React.FC<AiRecapStudioProps> = ({
  project,
  setProject,
  onSeekTo,
  onPrevStep,
  onNextStep,
  stepNumber = 3,
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [customPrompt, setCustomPrompt] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editingSegId, setEditingSegId] = useState<string | null>(null);
  const [shorteningSegId, setShorteningSegId] = useState<string | null>(null);
  const [isPolishing, setIsPolishing] = useState(false);
  const [selectedPartFilter, setSelectedPartFilter] = useState<number | 'all'>('all');
  const [selectedEngine, setSelectedEngine] = useState<'assemblyai' | 'gemini' | 'faster_whisper'>('gemini');
  const [hasAssemblyAiKey, setHasAssemblyAiKey] = useState(false);
  const [selectedGeminiModel, setSelectedGeminiModel] = useState<string>('gemini-3.1-flash-lite');
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [showDubbingPlanModal, setShowDubbingPlanModal] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const handlePolishNarrationStyle = async () => {
    if (!project.segments.length || isPolishing || isGenerating) return;
    setIsPolishing(true);
    setErrorMessage(null);
    try {
      const polished = await polishBurmeseNarrationStyle(project.segments, (msg) =>
        setStatusMessage(msg)
      );
      setProject((prev) => ({
        ...prev,
        segments: polished,
      }));
      setStatusMessage(
        '✓ နမူနာ Video ပုံစံအတိုင်း "တယ်/ပါတယ်" ထပ်နေမှုများ လျှော့ချပြီး စိတ်ခံစားချက် (အံ့ဩ/မာန်ပါ/မေးခွန်း) Tag များ ညှိပြီးပါပြီ! အဆင့် ၄ တွင် Voice Clone ပြန်ထုတ်နိုင်ပါသည်။'
      );
    } catch (err: any) {
      setErrorMessage(`Style Polish error: ${err?.message || 'Failed to polish narration style'}`);
    } finally {
      setIsPolishing(false);
    }
  };

  const handleShortenSegment = async (seg: TranscriptSegment) => {
    if (!seg.myanmarTranslation || shorteningSegId) return;
    const slotDur = Math.max(1.0, seg.endTime - seg.startTime);
    setShorteningSegId(seg.id);
    try {
      const shortened = await shortenBurmeseTextForDuration(
        seg.myanmarTranslation,
        slotDur,
        seg.originalText
      );
      if (shortened && shortened !== seg.myanmarTranslation) {
        handleUpdateSegment(seg.id, {
          myanmarTranslation: shortened,
          subtitleText: shortened,
        });
      }
    } catch (err) {
      console.warn('Failed to shorten segment:', err);
    } finally {
      setShorteningSegId(null);
    }
  };

  const handleCopyDubbingPlanJson = () => {
    if (!project.segments.length) return;
    const jsonStr = exportToDubbingPlanJSON(project.segments);
    navigator.clipboard.writeText(jsonStr);
    setCopyFeedback('Dubbing Plan (JSON) ကူးယူပြီးပါပြီ!');
    setTimeout(() => setCopyFeedback(null), 3000);
  };

  const handleDownloadDubbingPlanJson = () => {
    if (!project.segments.length) return;
    const jsonStr = exportToDubbingPlanJSON(project.segments);
    downloadFile(jsonStr, `${project.videoName || 'video'}_dubbing_plan.json`, 'application/json');
  };

  const handleDownloadBurmeseSRT = () => {
    if (!project.segments.length) return;
    const srtStr = generateBurmeseDubbingSRT(project.segments);
    downloadFile(srtStr, `${project.videoName || 'video'}_burmese_subtitles.srt`, 'text/plain;charset=utf-8');
  };

  // Track live elapsed seconds while Step 3 pipeline is running
  useEffect(() => {
    if (!isGenerating) {
      setElapsedSeconds(0);
      return;
    }
    const startAt = Date.now();
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isGenerating]);

  useEffect(() => {
    const keys = loadApiKeys();
    setHasAssemblyAiKey(Boolean(keys.assemblyAiKey));
    if (keys.assemblyAiKey) {
      setSelectedEngine('assemblyai');
    } else {
      setSelectedEngine('gemini');
    }
  }, []);

  const videoParts = getMinuteBlocks(project.videoDuration || 60);
  const totalParts = videoParts.length;

  const displayedSegments = project.segments.filter((s) => {
    if (selectedPartFilter === 'all') return true;
    const part = videoParts[selectedPartFilter - 1];
    if (!part) return true;
    const isLastPart = part.partNumber === totalParts;
    return isLastPart
      ? s.startTime >= part.startSec && s.startTime <= part.endSec + 0.5
      : s.startTime >= part.startSec && s.startTime < part.endSec;
  });

  const handleGenerateScript = async () => {
    if (!project.videoFile && !project.videoUrl) {
      setErrorMessage('ကျေးဇူးပြု၍ စာသားထုတ်ယူလိုသော Custom Video ကို အရင် တင်ပေးပါ။');
      return;
    }

    if (selectedEngine === 'assemblyai' && !hasAssemblyAiKey) {
      const msg = 'AssemblyAI API Key မတွေ့ရှိပါ။ ကျေးဇူးပြု၍ Step 1 တွင် AssemblyAI Key (32-digit Token) ကို ထည့်သွင်းပေးပါ။';
      setErrorMessage(msg);
      return;
    }

    setIsGenerating(true);
    setProgressPercent(5);
    setStatusMessage('အသံလှိုင်းနှင့် မြင်ကွင်းများ စစ်ဆေးနေပါသည်...');
    setErrorMessage(null);

    try {
      let rawSegments: TranscriptSegment[] = [];

      if (selectedEngine === 'assemblyai') {
        try {
          if (!hasAssemblyAiKey) {
            throw new Error('AssemblyAI Key မတွေ့ရှိပါ။ ကျေးဇူးပြု၍ Step 1 တွင် AssemblyAI Key (32-digit Token) ထည့်သွင်းပေးပါ။');
          }
          setStatusMessage('🎙️ [Assembly Generator] အသံလှိုင်း စစ်ဆေးနေပါသည်...');
          setProgressPercent(25);
          rawSegments = await transcribeVideoWithAssemblyAi(
            project.videoFile || project.videoUrl!,
            {
              onProgress: (msg) => setStatusMessage(msg),
            }
          );
        } catch (assemblyErr: any) {
          console.warn('AssemblyAI fallback notice:', assemblyErr);
          const errMsg = `AssemblyAI Error: ${assemblyErr.message || 'AssemblyAI ချိတ်ဆက်မှု အဆင်မပြေပါ'}။`;
          setErrorMessage(errMsg);
          setIsGenerating(false);
          return;
        }
      } else {
        rawSegments = await generateTimestampedTranscript(
          project.videoName || 'Uploaded Video',
          project.videoDuration || 30,
          customPrompt,
          project.videoFile,
          project.videoUrl,
          (msg, pct) => {
            setStatusMessage(msg);
            if (typeof pct === 'number') {
              setProgressPercent(pct);
            }
          },
          selectedGeminiModel
        );
      }

      setProgressPercent(96);
      const sorted = [...rawSegments].sort((a, b) => a.startTime - b.startTime);
      const segments = sorted.map((s) => {
        const start = Math.max(0, s.startTime);
        const end = Math.max(start + 0.5, s.endTime);
        const dur = parseFloat((end - start).toFixed(2));
        return {
          ...s,
          startTime: parseFloat(start.toFixed(2)),
          endTime: parseFloat(end.toFixed(2)),
          duration: s.duration || dur,
        };
      });

      const alignedSegments = realignSegmentsByMinuteBlocks(
        segments.map((seg) => ({
          ...seg,
          syllableCount: countBurmeseSyllables(seg.myanmarTranslation || ''),
        })),
        project.videoDuration || 60,
        { enforceSingleVoice: 'Thiha', enforceSingleSpeakerLabel: true }
      );

      setProgressPercent(100);
      setProject((prev) => ({
        ...prev,
        segments: alignedSegments,
      }));

      setStatusMessage(`🎉 [အောင်မြင်ပါသည်] ၁ မိနစ်စာ အပိုင်း (${totalParts} Parts) အလိုက် မြင်ကွင်းနှင့် စကားပြော တိုက်ဆိုင်စစ်ဆေးပြီး Single-Narrator ဇာတ်ကြောင်းပြော စာသား (${alignedSegments.length} Segments) ထုတ်ယူပြီးပါပြီ။ အဆင့် ၄ သို့သွား၍ Narrator အသံသွင်းနိုင်ပါသည်။`);
    } catch (err: any) {
      console.error('Failed to generate auto dubbing:', err);
      setErrorMessage(err.message || 'AI စာသားထုတ်လုပ်မှု မအောင်မြင်ပါ။ API Key ကို စစ်ဆေးပါ။');
    } finally {
      setProgressPercent(100);
      setIsGenerating(false);
    }
  };

  const handleAddSegment = () => {
    const lastSeg = project.segments[project.segments.length - 1];
    const newStart = lastSeg ? lastSeg.endTime + 0.2 : 0;
    const newEnd = newStart + 4;

    const newSeg: TranscriptSegment = {
      id: `seg_${Date.now()}`,
      startTime: parseFloat(newStart.toFixed(1)),
      endTime: parseFloat(newEnd.toFixed(1)),
      originalText: 'New dialogue',
      myanmarTranslation: 'စာသားအသစ် ထည့်ရန်...',
      voice: 'Thiha',
    };

    setProject((prev) => ({
      ...prev,
      segments: [...prev.segments, newSeg],
    }));
    setEditingSegId(newSeg.id);
  };

  const handleUpdateSegment = (id: string, updates: Partial<TranscriptSegment>) => {
    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    }));
  };

  const handleDeleteSegment = (id: string) => {
    setProject((prev) => ({
      ...prev,
      segments: prev.segments.filter((s) => s.id !== id),
    }));
  };

  return (
    <div className="glass-panel rounded-2xl p-6 shadow-2xl space-y-6">
      {/* Title Header with Step Navigation Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-400 to-teal-400 text-zinc-950 font-black flex items-center justify-center text-xs shadow-lg">
            {stepNumber}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white font-display tracking-tight flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <span>အဆင့် {stepNumber} — AI Narrator Script & Dubbing Engine (Gemini API)</span>
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 font-mono text-[10px] font-bold">
                Gemini API Natural Localization
              </span>
            </div>
            <p className="text-xs text-zinc-400 font-myanmar mt-0.5">
              ဗီဒီယိုမှ စကားပြောများကို Gemini API ဖြင့် သဘာဝကျပြီး တိကျမှန်ကန်သော မြန်မာ ဇာတ်ကြောင်းပြော (Narrator Voiceover) စာသားအဖြစ် ထုတ်ယူပါ (Auto Voice Clone မပါဘဲ စာသားကို သီးသန့်ထုတ်ပေးပါသည်)။
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {onPrevStep && (
            <button
              onClick={onPrevStep}
              className="px-3.5 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-semibold rounded-xl transition-all border border-white/10 flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>ရှေ့အဆင့်</span>
            </button>
          )}
          {onNextStep && (
            <button
              onClick={onNextStep}
              className="px-5 py-2.5 bg-gradient-to-r from-sky-400 to-teal-400 hover:opacity-90 text-zinc-950 font-black text-xs rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-sky-500/20 cursor-pointer active:scale-95"
            >
              <span>နောက်အဆင့် (TTS Studio)</span>
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          )}
        </div>
      </div>

      {/* 1-Minute Part Breakdown Filter Buttons */}
      <div className="glass-card rounded-xl p-3.5 space-y-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-white flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-cyan-400" />
            <span>Video 1-Min Parts ({totalParts} Blocks — Single Narrator Storytelling)</span>
          </span>
          <span className="text-[11px] font-mono text-cyan-300">
            {Math.floor((project.videoDuration || 0) / 60)}m {Math.floor((project.videoDuration || 0) % 60)}s
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSelectedPartFilter('all')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              selectedPartFilter === 'all'
                ? 'bg-cyan-400 text-zinc-950 shadow-md shadow-cyan-400/20'
                : 'bg-white/5 text-zinc-400 hover:text-zinc-200 border border-white/5'
            }`}
          >
            All Parts ({project.segments.length})
          </button>

          {videoParts.map((part) => {
            const isLastPart = part.partNumber === totalParts;
            const segCount = project.segments.filter((s) =>
              isLastPart
                ? s.startTime >= part.startSec && s.startTime <= part.endSec + 0.5
                : s.startTime >= part.startSec && s.startTime < part.endSec
            ).length;

            return (
              <button
                key={part.partNumber}
                onClick={() => {
                  setSelectedPartFilter(part.partNumber);
                  onSeekTo(part.startSec);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                  selectedPartFilter === part.partNumber
                    ? 'bg-cyan-400 text-zinc-950 font-bold shadow-md shadow-cyan-400/20'
                    : 'bg-white/5 text-zinc-300 hover:bg-white/10 border border-white/5'
                }`}
              >
                <span>{part.label}</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/40 text-cyan-300">
                  {segCount}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* AI STT Engine Selector */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => setSelectedEngine('assemblyai')}
          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
            selectedEngine === 'assemblyai'
              ? 'bg-blue-500/15 border-blue-400/50 text-blue-200 shadow-lg ring-1 ring-blue-400/30'
              : 'bg-white/5 border-white/5 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5 font-bold text-xs">
              <Radio className="w-3.5 h-3.5 text-blue-400" />
              <span>Assembly Generator</span>
            </div>
            {hasAssemblyAiKey && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Connected
              </span>
            )}
          </div>
          <p className="text-[11px] text-zinc-400 font-myanmar">
            AssemblyAI API ဖြင့် Speech-to-Text ပြုလုပ်ပြီး Gemini API မှ မြန်မာဘာသာပြန်ဆို၍ TTX ထုတ်ပေးမည်
          </p>
        </button>

        <button
          type="button"
          onClick={() => setSelectedEngine('gemini')}
          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
            selectedEngine === 'gemini'
              ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200 shadow-lg ring-1 ring-cyan-400/30'
              : 'bg-white/5 border-white/5 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5 font-bold text-xs">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>Whisper Generator</span>
            </div>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              Rotation Pool
            </span>
          </div>
          <p className="text-[11px] text-zinc-400 font-myanmar">
            Whisper ဖြင့် Speech-to-Text ပြုလုပ်ပြီး Gemini API မှ မြန်မာဘာသာပြန်ဆို၍ TTX ထုတ်ပေးမည်
          </p>
        </button>

        <button
          type="button"
          onClick={() => setSelectedEngine('faster_whisper')}
          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
            selectedEngine === 'faster_whisper'
              ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-200 shadow-lg ring-1 ring-emerald-400/30'
              : 'bg-white/5 border-white/5 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5 font-bold text-xs">
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              <span>Faster-Whisper (CPU int8)</span>
            </div>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              High-Speed CPU
            </span>
          </div>
          <p className="text-[11px] text-zinc-400 font-myanmar">
            Faster-whisper (CPU mode int8) ဖြင့် အမြန်ဆုံး Speech-to-Text ပြုလုပ်ပြီး Gemini ဖြင့် မြန်မာဘာသာပြန်မည်
          </p>
        </button>
      </div>

      {/* Prompt input & Action button */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="အထူး ညွှန်ကြားချက်များ (ဥပမာ- ဟာသဆန်ဆန် ပြန်ဆိုပေးပါ)..."
            className="glass-input flex-1 px-4 py-2.5 rounded-xl text-xs font-myanmar placeholder-zinc-500"
          />
          <select
            value={selectedGeminiModel}
            onChange={(e) => setSelectedGeminiModel(e.target.value)}
            className="px-3 py-2.5 bg-zinc-900 border border-cyan-500/30 rounded-xl text-xs text-cyan-300 font-mono font-semibold focus:outline-none cursor-pointer shrink-0"
            title="Gemini Model Selection"
          >
            <option value="gemini-3.1-flash-lite">⚡ Gemini 3.1 Flash Lite (Ultra Fast &amp; Recommended)</option>
            <option value="gemini-3.5-flash-lite">⚡ Gemini 3.5 Flash Lite (Fast &amp; Low Latency)</option>
            <option value="gemini-4-hydrogen">🧠 Gemini 4 Hydrogen (High Accuracy Reasoning)</option>
          </select>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleGenerateScript}
              disabled={isGenerating}
              className="px-5 py-2.5 bg-gradient-to-r from-sky-400 via-cyan-400 to-teal-400 hover:opacity-90 disabled:opacity-50 text-zinc-950 font-black text-xs rounded-xl transition-all shadow-xl shadow-cyan-500/25 flex items-center gap-2 cursor-pointer active:scale-95"
              title="ဗီဒီယိုကို Analysis လုပ်ပြီး မြန်မာ Narrator TTX စာသားများကို အလိုအလျောက် ထုတ်ယူမည်"
            >
              {isGenerating ? (
                <RotateCw className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 text-zinc-950 stroke-[2.5]" />
              )}
              <span>✨ TTX Generator (Narrator စာသားထုတ်မည်)</span>
            </button>

            <button
              onClick={handleGenerateScript}
              disabled={isGenerating}
              className="px-5 py-2.5 bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 hover:opacity-90 disabled:opacity-50 text-zinc-950 font-black text-xs rounded-xl transition-all shadow-xl shadow-emerald-500/25 flex items-center gap-2 cursor-pointer active:scale-95"
              title="Video Analyzing ဖြင့် Narrator TTX စာသား သီးသန့် ထုတ်ယူမည်"
            >
              {isGenerating ? (
                <RotateCw className="w-4 h-4 animate-spin" />
              ) : (
                <FileText className="w-4 h-4 text-zinc-950 stroke-[2.5]" />
              )}
              <span>🎬 Video Analyzing TTX</span>
            </button>
          </div>
        </div>

        {/* TTX Success & Proceed to Step 4 Voice Clone Card */}
        {project.segments.length > 0 && !isGenerating && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-zinc-900/60 to-cyan-950/40 border border-emerald-500/30 text-xs">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <span className="font-bold text-white font-myanmar text-sm block">
                  ✓ Narrator TTX စာသား ({project.segments.length} Segments) အောင်မြင်စွာ ထွက်ရှိပါပြီ
                </span>
                <span className="text-[11px] text-zinc-300 font-myanmar">
                  (အဆင့် ၃ တွင် Voice Clone မပါပါ။) အောက်ပါ Narrator TTX စာသားများအား အသံသွင်းရန်အတွက် "အဆင့် ၄ (Voice Clone)" သို့ ဆက်သွားပါ
                </span>
              </div>
            </div>

            {onNextStep && (
              <button
                onClick={onNextStep}
                className="px-6 py-2.5 bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 hover:opacity-90 text-zinc-950 font-black rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-emerald-500/25 active:scale-95 shrink-0"
              >
                <span>အဆင့် ၄ (Voice Clone ပြုလုပ်မည်) သို့</span>
                <ArrowRight className="w-4 h-4 stroke-[2.5]" />
              </button>
            )}
          </div>
        )}

        {/* Live Percentage Progress Bar & Speed Status */}
        {isGenerating && (
          <div className="space-y-2 p-3.5 rounded-xl bg-cyan-950/40 border border-cyan-500/30 backdrop-blur-md">
            <div className="flex items-center justify-between text-xs font-mono font-bold gap-2">
              <span className="text-cyan-300 flex items-center gap-1.5 font-myanmar">
                <RotateCw className="w-3.5 h-3.5 animate-spin text-cyan-400 shrink-0" />
                <span>{statusMessage || 'AI Processing Video Chunks...'}</span>
              </span>
              <span className="text-cyan-400 shrink-0">
                {Math.round(progressPercent)}% ({elapsedSeconds}s)
              </span>
            </div>

            {/* Progress Bar Track */}
            <div className="w-full h-2 bg-zinc-900 rounded-full overflow-hidden border border-cyan-500/20">
              <div
                className="h-full bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 transition-all duration-300 rounded-full shadow-lg shadow-cyan-400/50"
                style={{ width: `${Math.max(5, Math.min(100, progressPercent))}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono">
              <span>⚡ {selectedGeminiModel} (Parallel 1-Min Visual + Dialogue Alignment)</span>
              <span>100% ရောက်ရှိလျှင် ပြီးဆုံးပါမည်</span>
            </div>
          </div>
        )}

        {statusMessage && !isGenerating && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-myanmar">{statusMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="font-myanmar">{errorMessage}</span>
          </div>
        )}
      </div>

      {/* Dubbing Plan & Subtitle Actions Toolbar */}
      {project.segments.length > 0 && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-950/60 via-zinc-900 to-indigo-950/50 border border-sky-500/30 shadow-xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-sky-400" />
              <span className="text-xs font-bold text-white font-myanmar">
                {'Burmese Script & Subtitles Plan'}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30 font-mono">
                {project.segments.length} Segments
              </span>
            </div>

            {copyFeedback && (
              <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1.5 animate-pulse bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                <Check className="w-3.5 h-3.5" />
                {copyFeedback}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <button
              onClick={handlePolishNarrationStyle}
              disabled={isPolishing || isGenerating}
              className="px-3 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-50 text-amber-200 text-xs font-bold flex items-center justify-center gap-1.5 border border-amber-400/40 transition-colors cursor-pointer active:scale-95"
              title="နမူနာ Video စံနှုန်းအတိုင်း တယ်/ပါတယ် ထပ်နေမှုလျှော့ပြီး အသံနိမ့်မြင့် စိတ်ခံစားချက် Tag များ ထည့်သွင်းပြင်ဆင်မည်"
            >
              <Sparkles className={`w-3.5 h-3.5 text-amber-300 ${isPolishing ? 'animate-spin' : ''}`} />
              <span>{isPolishing ? 'ညှိနေသည်...' : '✨ Style Polish (တယ်လျှော့)'}</span>
            </button>

            <button
              onClick={handleCopyDubbingPlanJson}
              className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sky-300 text-xs font-semibold flex items-center justify-center gap-1.5 border border-white/10 transition-colors cursor-pointer active:scale-95"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copy JSON Plan</span>
            </button>

            <button
              onClick={handleDownloadDubbingPlanJson}
              className="px-3 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 text-xs font-semibold flex items-center justify-center gap-1.5 border border-sky-500/30 transition-colors cursor-pointer active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download JSON</span>
            </button>

            <button
              onClick={handleDownloadBurmeseSRT}
              className="px-3 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 text-xs font-semibold flex items-center justify-center gap-1.5 border border-emerald-500/30 transition-colors cursor-pointer active:scale-95"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Download .SRT</span>
            </button>

            <button
              onClick={() => setShowDubbingPlanModal(true)}
              className="px-3 py-2 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-200 text-xs font-semibold flex items-center justify-center gap-1.5 border border-indigo-500/30 transition-colors cursor-pointer active:scale-95"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>View 10-Point Plan</span>
            </button>
          </div>
        </div>
      )}

      {/* Segment List & Timestamp Editor */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-white">
              Segments ({displayedSegments.length} of {project.segments.length})
            </span>
          </div>
          <button
            onClick={handleAddSegment}
            className="px-3 py-1.5 text-xs font-bold text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 rounded-xl transition-all flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Segment</span>
          </button>
        </div>

        {displayedSegments.length === 0 ? (
          <div className="glass-card rounded-xl p-8 text-center text-xs text-zinc-400 space-y-1">
            <p className="font-myanmar">စာသားအပိုင်းများ မရှိသေးပါ။ Transcribe & Translate ခလုတ်ကို နှိပ်ပါ။</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[32rem] overflow-y-auto pr-1">
            {displayedSegments.map((seg, idx) => (
              <div
                key={seg.id}
                className={`p-3.5 rounded-xl border transition-all ${
                  project.currentTime >= seg.startTime && project.currentTime <= seg.endTime
                    ? 'bg-cyan-500/15 border-cyan-400/60 ring-1 ring-cyan-400/30'
                    : 'glass-card'
                }`}
              >
                {/* Header: Segment number, time, duration, and controls */}
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-zinc-500 text-xs font-bold">#{idx + 1}</span>
                    <button
                      onClick={() => onSeekTo(seg.startTime)}
                      className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-cyan-300 font-mono-num text-xs flex items-center gap-1 border border-white/10 transition-colors cursor-pointer"
                    >
                      <Play className="w-2.5 h-2.5 text-cyan-400" />
                      <span>
                        {formatMinSec(seg.startTime)} - {formatMinSec(seg.endTime)}
                      </span>
                    </button>
                    <span className="px-2 py-0.5 rounded-md bg-zinc-800/80 text-[10px] text-zinc-400 font-mono">
                      {(seg.duration || seg.endTime - seg.startTime).toFixed(2)}s
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-sky-500/10 text-sky-300 text-[10px] font-semibold border border-sky-500/20">
                      {seg.speaker || 'Narrator (ဇာတ်ကြောင်းပြောသူ)'}
                    </span>
                    {seg.isOnScreen !== undefined && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-zinc-800 text-zinc-400">
                        {seg.isOnScreen ? '👁️ On Screen' : '🎙️ Off Screen'}
                      </span>
                    )}

                    {seg.audioUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          const audio = new Audio(seg.audioUrl);
                          audio.playbackRate = seg.atempoRate || seg.playbackRate || 1.0;
                          (audio as any).preservesPitch = true;
                          audio.play().catch(() => {});
                        }}
                        className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold flex items-center gap-1 cursor-pointer hover:bg-emerald-500/30 transition-all"
                        title="ဖတ်ပြထားသော မြန်မာယောက်ျားသံ (သီဟ) ကို နားဆင်ရန်"
                      >
                        <Volume2 className="w-3 h-3 text-emerald-400" />
                        <span>အသံနားဆင်မည် ({seg.audioDuration ? seg.audioDuration.toFixed(1) + 's' : 'TTS'})</span>
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={seg.voice}
                      onChange={(e) =>
                        handleUpdateSegment(seg.id, { voice: e.target.value as any })
                      }
                      className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-white/10 text-xs text-emerald-400 font-semibold focus:outline-none cursor-pointer"
                    >
                      <optgroup label="Male Voices (Adult Burmese)">
                        <option value="Thiha">Thiha (Adult Male)</option>
                        <option value="KyawKyaw">Kyaw Kyaw (Adult Male)</option>
                        <option value="AungAung">Aung Aung</option>
                        <option value="MinThway">Min Thway</option>
                      </optgroup>
                      <optgroup label="Female Voices">
                        <option value="Nilar">Nilar</option>
                        <option value="MayThu">May Thu</option>
                        <option value="Thiri">Thiri</option>
                        <option value="SuSu">Su Su</option>
                      </optgroup>
                    </select>

                    <select
                      value={seg.playbackRate || project.voicePlaybackRate || 1.0}
                      onChange={(e) =>
                        handleUpdateSegment(seg.id, { playbackRate: parseFloat(e.target.value) })
                      }
                      className="px-2 py-1 rounded-lg bg-zinc-900 border border-white/10 text-xs text-cyan-400 font-mono focus:outline-none cursor-pointer"
                    >
                      <option value={0.75}>0.75x</option>
                      <option value={0.85}>0.85x</option>
                      <option value={0.95}>0.95x</option>
                      <option value={1.0}>1.00x</option>
                      <option value={1.1}>1.10x</option>
                      <option value={1.2}>1.20x</option>
                      <option value={1.25}>1.25x</option>
                      <option value={1.5}>1.50x</option>
                    </select>

                    <button
                      onClick={() => handleDeleteSegment(seg.id)}
                      className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Original dialogue (e.g. Chinese) */}
                {seg.originalText && (
                  <div className="mb-2 px-3 py-1.5 rounded-lg bg-zinc-900/60 border border-white/5 text-[11px] text-zinc-400 flex items-baseline gap-2">
                    <span className="text-[10px] font-semibold text-zinc-500 uppercase shrink-0">Original:</span>
                    <span className="font-sans text-zinc-300">{seg.originalText}</span>
                  </div>
                )}

                {/* Natural Spoken Burmese Dialogue Input & 5-Second Syllable Brevity Indicator */}
                {(() => {
                  const slotDur = Math.max(0.5, seg.endTime - seg.startTime);
                  const sylCount = countBurmeseSyllables(seg.myanmarTranslation || '');
                  const maxSyl = seg.maxAllowedSyllables || calculateMaxAllowedSyllables(slotDur);
                  const isTooLong = sylCount > maxSyl;

                  return (
                    <div className="space-y-1 mb-2">
                      <div className="flex items-center justify-between text-[10px] text-zinc-400 flex-wrap gap-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-myanmar font-semibold text-cyan-300">
                            သဘာဝကျသော မြန်မာစကားပြော (Dubbing Dialogue):
                          </span>
                          {seg.emotion && (
                            <span className="text-zinc-500 italic text-[9px]">({seg.emotion})</span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          {isTooLong ? (
                            <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 font-semibold font-myanmar text-[9px] flex items-center gap-1">
                              ⚠️ စကားလုံးရှည်နေပါသည် ({sylCount}/{maxSyl} syllables &gt; {slotDur.toFixed(1)}s)
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-[9px]">
                              ✓ 5s Timing Fit ({sylCount}/{maxSyl} syllables, {slotDur.toFixed(1)}s)
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleShortenSegment(seg)}
                            disabled={shorteningSegId === seg.id}
                            className="px-2 py-0.5 rounded-md bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1 disabled:opacity-50"
                            title="မူရင်းစကားပြောချိန်အတွင်း ဖတ်နိုင်ရန် AI ဖြင့် စာတိုအောင် ပြင်မည်"
                          >
                            {shorteningSegId === seg.id ? (
                              <RotateCw className="w-2.5 h-2.5 animate-spin" />
                            ) : (
                              <Scissors className="w-2.5 h-2.5 text-cyan-400" />
                            )}
                            <span>{shorteningSegId === seg.id ? 'ချုံ့နေသည်...' : 'AI စာတိုချုံ့မည်'}</span>
                          </button>
                        </div>
                      </div>
                      <input
                        type="text"
                        value={seg.myanmarTranslation}
                        onChange={(e) => handleUpdateSegment(seg.id, { myanmarTranslation: e.target.value })}
                        placeholder="သဘာဝကျသော လူပြောစကား မြန်မာစကားပြော..."
                        className="w-full px-3 py-1.5 glass-input rounded-lg text-xs font-myanmar text-white focus:ring-1 focus:ring-cyan-400"
                      />
                    </div>
                  );
                })()}

                {/* Subtitle text & lip-sync note */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <span className="text-zinc-500 block mb-0.5">မြန်မာစာတန်းထိုး Subtitle (&lt;35 chars, max 2 lines):</span>
                    <input
                      type="text"
                      value={seg.subtitleText !== undefined ? seg.subtitleText : seg.myanmarTranslation}
                      onChange={(e) => handleUpdateSegment(seg.id, { subtitleText: e.target.value })}
                      placeholder="စာတန်းထိုး စာသား..."
                      className="w-full px-2.5 py-1 bg-zinc-900/90 border border-white/10 rounded text-xs text-zinc-200 font-myanmar"
                    />
                  </div>
                  <div>
                    <span className="text-zinc-500 block mb-0.5">Lip-Sync & Timing Note:</span>
                    <input
                      type="text"
                      value={seg.lipSyncNote || 'Paced to match original duration'}
                      onChange={(e) => handleUpdateSegment(seg.id, { lipSyncNote: e.target.value })}
                      placeholder="နှုတ်ခမ်းလှုပ်ရှားမှုနှင့် အချိန်ကိုက် မှတ်ချက်..."
                      className="w-full px-2.5 py-1 bg-zinc-900/90 border border-white/10 rounded text-xs text-zinc-400 font-myanmar"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 10-Point Dubbing Plan Modal */}
      {showDubbingPlanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-5xl max-h-[90vh] bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-zinc-950/70">
              <div className="flex items-center gap-2.5">
                <FileText className="w-5 h-5 text-sky-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">Chinese to Burmese Dubbing Plan (10-Point Specification)</h3>
                  <p className="text-[11px] text-zinc-400 font-myanmar">
                    အချိန်ကိုက် မြန်မာစကားပြော အပြည့်အစုံ ဇယားနှင့် JSON အချက်အလက်များ
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyDubbingPlanJson}
                  className="px-3 py-1.5 rounded-lg bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy JSON</span>
                </button>
                <button
                  onClick={handleDownloadDubbingPlanJson}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download JSON</span>
                </button>
                <button
                  onClick={handleDownloadBurmeseSRT}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Download SRT</span>
                </button>
                <button
                  onClick={() => setShowDubbingPlanModal(false)}
                  className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Table Body */}
            <div className="flex-1 overflow-auto p-4">
              <table className="w-full text-left text-xs text-zinc-300 border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-[11px] text-zinc-400 bg-zinc-950/40">
                    <th className="p-2.5 font-bold"># / Time</th>
                    <th className="p-2.5 font-bold">Speaker</th>
                    <th className="p-2.5 font-bold">Original Dialogue</th>
                    <th className="p-2.5 font-bold">Natural Burmese Translation</th>
                    <th className="p-2.5 font-bold">Burmese Subtitle</th>
                    <th className="p-2.5 font-bold">Duration</th>
                    <th className="p-2.5 font-bold">Emotion & Lip-Sync</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {project.segments.map((s, i) => (
                    <tr key={s.id} className="hover:bg-white/5 transition-colors">
                      <td className="p-2.5 font-mono text-cyan-300 whitespace-nowrap">
                        <div className="font-bold">#{i + 1}</div>
                        <div className="text-[10px] text-zinc-400">
                          {formatMinSec(s.startTime)} - {formatMinSec(s.endTime)}
                        </div>
                      </td>
                      <td className="p-2.5 whitespace-nowrap">
                        <span className="font-semibold text-white">{s.speaker || 'Narrator (ဇာတ်ကြောင်းပြောသူ)'}</span>
                        <div className="text-[10px] text-zinc-400">{s.isOnScreen ? 'On-Screen' : 'Off-Screen'}</div>
                      </td>
                      <td className="p-2.5 text-zinc-300 font-sans max-w-xs">{s.originalText || '-'}</td>
                      <td className="p-2.5 text-sky-200 font-myanmar max-w-xs">{s.myanmarTranslation}</td>
                      <td className="p-2.5 text-emerald-300 font-myanmar max-w-xs">
                        {s.subtitleText || s.myanmarTranslation}
                      </td>
                      <td className="p-2.5 font-mono text-zinc-300 whitespace-nowrap">
                        {(s.duration || s.endTime - s.startTime).toFixed(2)}s
                      </td>
                      <td className="p-2.5 text-[11px] text-zinc-400 max-w-xs">
                        <div className="text-zinc-200">{s.emotion || 'Natural conversational'}</div>
                        <div className="text-[10px] text-zinc-500 italic">{s.lipSyncNote || 'Paced to match duration'}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation Card */}
      <div className="pt-4 border-t border-white/10 flex items-center justify-between gap-4">
        {onPrevStep ? (
          <button
            onClick={onPrevStep}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-semibold rounded-xl transition-all border border-white/10 flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>ရှေ့အဆင့်</span>
          </button>
        ) : (
          <div />
        )}

        <span className="text-xs text-zinc-400 font-myanmar hidden sm:inline">
          သဘာဝကျသော Narrator Script ထုတ်ယူပြီးပါက နောက်အဆင့် (TTS Studio) သို့ သွားပါ
        </span>

        {onNextStep && (
          <button
            onClick={onNextStep}
            className="px-6 py-3 bg-gradient-to-r from-sky-400 to-teal-400 hover:opacity-90 text-zinc-950 font-black text-xs rounded-xl transition-all flex items-center gap-2.5 shadow-xl shadow-sky-500/25 cursor-pointer active:scale-95 shrink-0"
          >
            <span>နောက်အဆင့် (TTS Studio) သို့</span>
            <ArrowRight className="w-4 h-4 stroke-[2.5]" />
          </button>
        )}
      </div>
    </div>
  );
};
