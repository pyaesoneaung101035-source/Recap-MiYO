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
} from 'lucide-react';
import { ProjectState, TranscriptSegment, AiMode } from '../types';
import { generateTimestampedTranscript } from '../utils/geminiPool';
import { transcribeVideoWithAssemblyAi } from '../utils/assemblyAi';
import { loadApiKeys } from '../utils/apiKeys';

interface AiRecapStudioProps {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  onSeekTo: (time: number) => void;
  onPrevStep?: () => void;
  onNextStep?: () => void;
}

const AI_MODES: { id: AiMode; title: string; desc: string }[] = [
  { id: 'Recap', title: 'Recap', desc: 'ဇာတ်လမ်း အနှစ်ချုပ်' },
  { id: 'Dubbing', title: 'Dubbing', desc: 'အချိန်ကိုက် မြန်မာစကားပြော' },
  { id: 'Subtitle', title: 'Subtitle', desc: 'Timestamp ပါ စာတန်းထိုး' },
  { id: 'Long to Short', title: 'Long to Short', desc: '30-60s Viral Clips' },
  { id: 'Original Recap', title: 'Original Recap', desc: 'မူရင်း အသေးစိတ်' },
  { id: 'Gemini TTS', title: 'Gemini TTS', desc: 'အသံထွက်ဖတ်ရ လွယ်သောစာ' },
  { id: 'Dhamma AI background', title: 'Dhamma AI', desc: 'ဓမ္မအငွေ့အသက်' },
];

export const AiRecapStudio: React.FC<AiRecapStudioProps> = ({
  project,
  setProject,
  onSeekTo,
  onPrevStep,
  onNextStep,
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [customPrompt, setCustomPrompt] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editingSegId, setEditingSegId] = useState<string | null>(null);
  const [selectedPartFilter, setSelectedPartFilter] = useState<number | 'all'>('all');
  const [selectedEngine, setSelectedEngine] = useState<'assemblyai' | 'gemini'>('assemblyai');
  const [hasAssemblyAiKey, setHasAssemblyAiKey] = useState(false);
  const [selectedGeminiModel, setSelectedGeminiModel] = useState<string>('gemini-3.5-flash-lite');

  // Live progress simulation timer when generating
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isGenerating) {
      setProgressPercent(10);
      timer = setInterval(() => {
        setProgressPercent((prev) => {
          if (prev >= 98) return 98;
          return prev + 2;
        });
      }, 300);
    } else {
      setProgressPercent(100);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
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

  const totalParts = Math.max(1, Math.ceil((project.videoDuration || 180) / 180));

  const formatMinSec = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
  };

  const videoParts = Array.from({ length: totalParts }, (_, i) => {
    const startSec = i * 180;
    const endSec = Math.min((i + 1) * 180, project.videoDuration || (i + 1) * 180);
    return {
      partNumber: i + 1,
      startSec,
      endSec,
      label: `Part ${i + 1} (${formatMinSec(startSec)} - ${formatMinSec(endSec)})`,
    };
  });

  const displayedSegments = project.segments.filter((s) => {
    if (selectedPartFilter === 'all') return true;
    const part = videoParts[selectedPartFilter - 1];
    if (!part) return true;
    return s.startTime >= part.startSec && s.startTime < part.endSec;
  });

  const handleGenerateScript = async () => {
    if (!project.videoFile && !project.videoUrl) {
      setErrorMessage('ကျေးဇူးပြု၍ စာသားထုတ်ယူလိုသော Custom Video ကို အရင် တင်ပေးပါ။');
      return;
    }

    setIsGenerating(true);
    setProgressPercent(15);
    setStatusMessage('အသံလှိုင်း စစ်ဆေးနေပါသည်...');
    setErrorMessage(null);

    try {
      let rawSegments: TranscriptSegment[] = [];

      if (selectedEngine === 'assemblyai') {
        try {
          if (!hasAssemblyAiKey) {
            throw new Error('AssemblyAI Key မရှိသေးပါ။ Gemini သို့ အလိုအလျောက် ပြောင်းပါသည်...');
          }
          setStatusMessage('🎙️ [AssemblyAI Whisper Engine] အသံလှိုင်း စစ်ဆေးနေပါသည်...');
          rawSegments = await transcribeVideoWithAssemblyAi(
            project.videoFile || project.videoUrl!,
            {
              onProgress: (msg) => setStatusMessage(msg),
            }
          );
        } catch (assemblyErr: any) {
          console.warn('AssemblyAI fallback to Gemini STT:', assemblyErr);
          setStatusMessage('⚠️ Gemini STT သို့ အလိုအလျောက် ပြောင်းလဲ၍ ထုတ်ယူနေပါသည်...');
          setProgressPercent(40);
          rawSegments = await generateTimestampedTranscript(
            project.videoName || 'Uploaded Video',
            project.videoDuration || 30,
            project.selectedAiMode,
            customPrompt,
            project.videoFile,
            project.videoUrl,
            (msg) => setStatusMessage(`[Gemini STT] ${msg}`),
            selectedGeminiModel
          );
        }
      } else {
        setProgressPercent(35);
        rawSegments = await generateTimestampedTranscript(
          project.videoName || 'Uploaded Video',
          project.videoDuration || 30,
          project.selectedAiMode,
          customPrompt,
          project.videoFile,
          project.videoUrl,
          (msg) => setStatusMessage(msg),
          selectedGeminiModel
        );
      }

      setProgressPercent(90);
      const sorted = [...rawSegments].sort((a, b) => a.startTime - b.startTime);
      let curTime = 0;
      const segments = sorted.map((s) => {
        const duration = Math.max(2.0, s.endTime - s.startTime);
        const start = Math.max(curTime, s.startTime);
        const end = start + duration;
        curTime = end + 0.1;
        return {
          ...s,
          startTime: parseFloat(start.toFixed(1)),
          endTime: parseFloat(end.toFixed(1)),
        };
      });

      setProgressPercent(100);
      setProject((prev) => ({ ...prev, segments }));
      setStatusMessage(`အောင်မြင်ပါသည်! Segment စုစုပေါင်း ${segments.length} ခု ထုတ်ယူပြီးပါပြီ။`);
    } catch (err: any) {
      console.error('Failed to generate recap:', err);
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
            4
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white font-display tracking-tight flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <span>အဆင့် 4 — AI Speech-to-Text & Script Engine</span>
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 font-mono text-[10px] font-bold">
                Whisper + Gemini
              </span>
            </div>
            <p className="text-xs text-zinc-400 font-myanmar mt-0.5">
              ဗီဒီယိုမှ စကားပြောများကို Whisper / Gemini ဖြင့် မြန်မာစာတန်းထိုး Timestamp ထုတ်ယူပါ။
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
              <span>အဆင့် 3</span>
            </button>
          )}
          {onNextStep && (
            <button
              onClick={onNextStep}
              className="px-5 py-2.5 bg-gradient-to-r from-sky-400 to-teal-400 hover:opacity-90 text-zinc-950 font-black text-xs rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-sky-500/20 cursor-pointer active:scale-95"
            >
              <span>အဆင့် 5 သို့</span>
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          )}
        </div>
      </div>

      {/* AI Modes Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {AI_MODES.map((mode) => (
          <button
            key={mode.id}
            onClick={() => setProject((prev) => ({ ...prev, selectedAiMode: mode.id }))}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              project.selectedAiMode === mode.id
                ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200 shadow-md ring-1 ring-cyan-400/30'
                : 'bg-white/5 border-white/5 text-zinc-400 hover:text-zinc-200 hover:bg-white/10'
            }`}
          >
            <span className="text-xs font-bold block">{mode.title}</span>
            <span className="text-[10px] text-zinc-400 font-myanmar block mt-0.5 opacity-80">
              {mode.desc}
            </span>
          </button>
        ))}
      </div>

      {/* 3-Minute Part Breakdown Filter Pills */}
      <div className="glass-card rounded-xl p-3.5 space-y-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-white flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-cyan-400" />
            <span>Video 3-Min Parts ({totalParts} Chunks)</span>
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
            const segCount = project.segments.filter(
              (s) => s.startTime >= part.startSec && s.startTime < part.endSec
            ).length;

            return (
              <button
                key={part.partNumber}
                onClick={() => setSelectedPartFilter(part.partNumber)}
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              <span>AssemblyAI Whisper STT</span>
            </div>
            {hasAssemblyAiKey && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Connected
              </span>
            )}
          </div>
          <p className="text-[11px] text-zinc-400 font-myanmar">
            Whisper အသံလှိုင်း တိကျသော Timestamp ဖြင့် မြန်မာစကားပြော ပြန်ဆိုချက်
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
              <span>Gemini Multi-Key STT</span>
            </div>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              Rotation Pool
            </span>
          </div>
          <p className="text-[11px] text-zinc-400 font-myanmar">
            Google Gemini API Multimodal အသံလှိုင်း ခွဲခြားမှု
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
            <option value="gemini-3.5-flash-lite">⚡ Gemini 3.5 Flash Lite</option>
            <option value="gemini-2.5-flash">⚡ Gemini 2.5 Flash</option>
            <option value="gemini-3.1-pro-preview">🧠 Gemini 3.1 Pro Preview</option>
            <option value="gemini-1.5-flash">⚡ Gemini 1.5 Flash</option>
          </select>

          <button
            onClick={handleGenerateScript}
            disabled={isGenerating}
            className="px-5 py-2.5 bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 hover:opacity-90 disabled:opacity-50 text-zinc-950 font-bold text-xs rounded-xl transition-all shadow-lg shadow-cyan-500/20 flex items-center gap-2 shrink-0 cursor-pointer"
          >
            {isGenerating ? (
              <RotateCw className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 stroke-[2.5]" />
            )}
            <span>Transcribe & Translate</span>
          </button>
        </div>

        {/* Live Percentage Progress Bar & Speed Status (User Requested Feature) */}
        {isGenerating && (
          <div className="space-y-2 p-3.5 rounded-xl bg-cyan-950/40 border border-cyan-500/30 backdrop-blur-md animate-pulse">
            <div className="flex items-center justify-between text-xs font-mono font-bold">
              <span className="text-cyan-300 flex items-center gap-1.5 font-myanmar">
                <RotateCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                <span>{statusMessage || 'AI Processing Video Chunks...'}</span>
              </span>
              <span className="text-cyan-400">
                {Math.round(progressPercent)}% TTX
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
              <span>⚡ Flash Model Optimized (Fast 3-min Chunk Pipeline)</span>
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
          <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
            {displayedSegments.map((seg, idx) => (
              <div
                key={seg.id}
                className={`p-3.5 rounded-xl border transition-all ${
                  project.currentTime >= seg.startTime && project.currentTime <= seg.endTime
                    ? 'bg-cyan-500/15 border-cyan-400/60 ring-1 ring-cyan-400/30'
                    : 'glass-card'
                }`}
              >
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
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={seg.voice}
                      onChange={(e) =>
                        handleUpdateSegment(seg.id, { voice: e.target.value as any })
                      }
                      className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-white/10 text-xs text-emerald-400 font-semibold focus:outline-none cursor-pointer"
                    >
                      <optgroup label="Male Voices">
                        <option value="Thiha">Thiha</option>
                        <option value="KyawKyaw">Kyaw Kyaw</option>
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

                <input
                  type="text"
                  value={seg.myanmarTranslation}
                  onChange={(e) => handleUpdateSegment(seg.id, { myanmarTranslation: e.target.value })}
                  placeholder="မြန်မာဘာသာပြန်..."
                  className="w-full px-3 py-1.5 glass-input rounded-lg text-xs font-myanmar text-white"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Navigation Card */}
      <div className="pt-4 border-t border-white/10 flex items-center justify-between gap-4">
        {onPrevStep ? (
          <button
            onClick={onPrevStep}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-semibold rounded-xl transition-all border border-white/10 flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>အဆင့် 3 သို့</span>
          </button>
        ) : (
          <div />
        )}

        <span className="text-xs text-zinc-400 font-myanmar hidden sm:inline">
          Script & Subtitle ထုတ်ယူပြီးပါက အဆင့် 5 (Voice Clone Studio) သို့ သွားပါ
        </span>

        {onNextStep && (
          <button
            onClick={onNextStep}
            className="px-6 py-3 bg-gradient-to-r from-sky-400 to-teal-400 hover:opacity-90 text-zinc-950 font-black text-xs rounded-xl transition-all flex items-center gap-2.5 shadow-xl shadow-sky-500/25 cursor-pointer active:scale-95 shrink-0"
          >
            <span>အဆင့် 5 သို့</span>
            <ArrowRight className="w-4 h-4 stroke-[2.5]" />
          </button>
        )}
      </div>
    </div>
  );
};
