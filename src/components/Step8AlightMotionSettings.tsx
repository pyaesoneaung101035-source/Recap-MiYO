import React, { useState } from 'react';
import {
  Sliders,
  Sparkles,
  MousePointer,
  MapPin,
  Clock,
  Play,
  RotateCcw,
  Volume2,
  Edit3,
  Check,
  ChevronDown,
  Layers,
  Activity,
  ZoomIn,
  Trash2,
  Plus,
  Type,
  Move,
  Film,
  Pin,
  Undo,
  Redo,
  FastForward,
  Zap,
} from 'lucide-react';
import { ProjectState, TranscriptSegment, AlightKeyframe } from '../types';
import { getMotionPresets } from '../utils/alightMotionRenderer';

export type AlightSettingsTab = 'audio_ttx' | 'motion_fx' | 'subtitle_style' | 'logo_config' | 'timeline_edit';

interface Step8AlightMotionSettingsProps {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  selectedSegmentId: string | null;
  setSelectedSegmentId: (id: string | null) => void;
  selectedKeyframeId: string | null;
  setSelectedKeyframeId: (id: string | null) => void;
  isCatchUpModeActive: boolean;
  setIsCatchUpModeActive: (active: boolean) => void;
  onSeekTo: (time: number) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onPushHistory?: () => void;
  activeTab?: AlightSettingsTab;
  onTabChange?: (tab: AlightSettingsTab) => void;
}

export const Step8AlightMotionSettings: React.FC<Step8AlightMotionSettingsProps> = ({
  project,
  setProject,
  selectedSegmentId,
  setSelectedSegmentId,
  selectedKeyframeId,
  setSelectedKeyframeId,
  isCatchUpModeActive,
  setIsCatchUpModeActive,
  onSeekTo,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onPushHistory,
  activeTab: propActiveTab,
  onTabChange,
}) => {
  const [internalActiveTab, setInternalActiveTab] = useState<AlightSettingsTab>('audio_ttx');
  const activeTab = propActiveTab !== undefined ? propActiveTab : internalActiveTab;
  const setActiveTab = (tab: AlightSettingsTab) => {
    if (onTabChange) {
      onTabChange(tab);
    } else {
      setInternalActiveTab(tab);
    }
  };
  const [fixFeedback, setFixFeedback] = useState<boolean>(false);

  // Currently selected segment (Audio clip & TTX subtitle)
  const currentSeg =
    project.segments.find((s) => s.id === selectedSegmentId) ||
    project.segments[0] ||
    null;

  // Currently selected keyframe
  const currentKf =
    project.keyframes.find((k) => k.id === selectedKeyframeId) ||
    project.keyframes[0] ||
    null;

  // Move selected Audio + TTX segment to current video playhead time (Catch-Up)
  const handleCatchUpToPlayhead = () => {
    if (!currentSeg) return;
    onPushHistory?.();
    const newStart = parseFloat(project.currentTime.toFixed(2));
    const duration = currentSeg.audioDuration || (currentSeg.endTime - currentSeg.startTime) || 3;
    const newEnd = parseFloat((newStart + duration).toFixed(2));

    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) =>
        s.id === currentSeg.id
          ? {
              ...s,
              originalStartTime: s.originalStartTime ?? s.startTime,
              originalEndTime: s.originalEndTime ?? s.endTime,
              startTime: newStart,
              endTime: newEnd,
              isTimingFixed: false,
            }
          : s
      ),
      videoDuration: Math.max(prev.videoDuration, newEnd),
    }));
  };

  // Nudge audio and TTX timing forward or backward
  const handleNudgeSegment = (deltaSeconds: number) => {
    if (!currentSeg) return;
    onPushHistory?.();
    const newStart = Math.max(0, parseFloat((currentSeg.startTime + deltaSeconds).toFixed(2)));
    const duration = currentSeg.audioDuration || (currentSeg.endTime - currentSeg.startTime) || 3;
    const newEnd = parseFloat((newStart + duration).toFixed(2));

    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) =>
        s.id === currentSeg.id
          ? {
              ...s,
              originalStartTime: s.originalStartTime ?? s.startTime,
              originalEndTime: s.originalEndTime ?? s.endTime,
              startTime: newStart,
              endTime: newEnd,
              isTimingFixed: false,
            }
          : s
      ),
      videoDuration: Math.max(prev.videoDuration, newEnd),
    }));
    onSeekTo(newStart);
  };

  // Lock and fix current placed position for selected Audio & TTX segment
  const handleFixTiming = () => {
    if (!currentSeg) return;
    onPushHistory?.();
    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) =>
        s.id === currentSeg.id
          ? {
              ...s,
              originalStartTime: s.originalStartTime ?? s.startTime,
              originalEndTime: s.originalEndTime ?? s.endTime,
              isTimingFixed: true,
            }
          : s
      ),
    }));
    setFixFeedback(true);
    setTimeout(() => setFixFeedback(false), 2500);
  };

  // Restart / Reset segment timing back to original timestamps
  const handleRestartTiming = () => {
    if (!currentSeg) return;
    onPushHistory?.();
    const origStart =
      currentSeg.originalStartTime !== undefined ? currentSeg.originalStartTime : currentSeg.startTime;
    const origEnd =
      currentSeg.originalEndTime !== undefined ? currentSeg.originalEndTime : currentSeg.endTime;

    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) =>
        s.id === currentSeg.id
          ? {
              ...s,
              startTime: origStart,
              endTime: origEnd,
              isTimingFixed: false,
            }
          : s
      ),
    }));
    onSeekTo(origStart);
  };

  // Add keyframe at playhead
  const handleAddKeyframe = () => {
    const newKf: AlightKeyframe = {
      id: 'kf_' + Math.random().toString(36).substring(2, 8),
      time: parseFloat(project.currentTime.toFixed(2)),
      scale: 1.15,
      posX: 0,
      posY: 0,
      rotation: 0,
      opacity: 1,
      blur: 0,
      shakeIntensity: 0,
      filter: 'none',
    };

    setProject((prev) => ({
      ...prev,
      keyframes: [...prev.keyframes, newKf].sort((a, b) => a.time - b.time),
    }));
    setSelectedKeyframeId(newKf.id);
  };

  const handleUpdateKeyframe = (id: string, updates: Partial<AlightKeyframe>) => {
    setProject((prev) => ({
      ...prev,
      keyframes: prev.keyframes.map((k) => (k.id === id ? { ...k, ...updates } : k)),
    }));
  };

  const handleDeleteKeyframe = (id: string) => {
    setProject((prev) => ({
      ...prev,
      keyframes: prev.keyframes.filter((k) => k.id !== id),
    }));
    if (selectedKeyframeId === id) setSelectedKeyframeId(null);
  };

  const handleApplyPreset = (presetName: 'smoothZoom' | 'impactShake' | 'dhammaAura') => {
    const presets = getMotionPresets(project.currentTime);
    const selected = presets[presetName];
    if (selected) {
      setProject((prev) => ({
        ...prev,
        keyframes: [...prev.keyframes, ...selected].sort((a, b) => a.time - b.time),
      }));
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl flex flex-col h-full">
      {/* Settings Header with Tab Navigation */}
      <div className="p-3 bg-zinc-950/90 border-b border-zinc-800 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider font-display">
              Alight Motion & Audio/TTX Settings
            </h3>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
            {project.currentTime.toFixed(2)}s
          </span>
        </div>

        {/* 5 Main Setting Tabs including Logo Watermark & Edit Timeline */}
        <div className="grid grid-cols-5 gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('audio_ttx')}
            className={`py-1.5 px-1 rounded text-[11px] font-medium transition-all flex items-center justify-center gap-1 ${
              activeTab === 'audio_ttx'
                ? 'bg-emerald-600 text-white font-semibold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <MapPin className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
            <span className="truncate">အသံ & TTX</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('motion_fx')}
            className={`py-1.5 px-1 rounded text-[11px] font-medium transition-all flex items-center justify-center gap-1 ${
              activeTab === 'motion_fx'
                ? 'bg-amber-600 text-white font-semibold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span className="truncate">Alight FX</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('subtitle_style')}
            className={`py-1.5 px-1 rounded text-[11px] font-medium transition-all flex items-center justify-center gap-1 ${
              activeTab === 'subtitle_style'
                ? 'bg-cyan-600 text-white font-semibold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Type className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
            <span className="truncate">စာတန်းထိုး</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('logo_config')}
            className={`py-1.5 px-1 rounded text-[11px] font-medium transition-all flex items-center justify-center gap-1 ${
              activeTab === 'logo_config'
                ? 'bg-rose-600 text-white font-semibold shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Film className="w-3.5 h-3.5 text-rose-300 shrink-0" />
            <span className="truncate">Logo 🏷️</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('timeline_edit')}
            className={`py-1.5 px-1 rounded text-[11px] font-medium transition-all flex items-center justify-center gap-1 ${
              activeTab === 'timeline_edit'
                ? 'bg-gradient-to-r from-amber-500 to-cyan-500 text-zinc-950 font-bold shadow-sm'
                : 'text-zinc-400 hover:text-amber-300'
            }`}
            title="Alight Motion Timeline & Keyframes Editor (Photo Function)"
          >
            <Sliders className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="truncate font-semibold">Edit 🎬</span>
          </button>
        </div>
      </div>

      {/* Tab 1: Audio & TTX Catch-Up & Placement Controls */}
      {activeTab === 'audio_ttx' && (
        <div className="p-4 space-y-4 overflow-y-auto max-h-[580px] text-xs">
          {/* USER REQUESTED FEATURE: UNDO & REDO BUTTONS ABOVE TTX & VOICE CLONE AREA */}
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950 border border-cyan-800/60 shadow-md">
            <span className="text-zinc-300 font-semibold text-[11px] font-myanmar">
              ↩️ Undo / ↪️ Redo (TTX & Voice Clone တည်းဖြတ်မှု):
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onUndo}
                disabled={!canUndo}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1 ${
                  canUndo
                    ? 'bg-cyan-500 hover:bg-cyan-400 text-zinc-950 cursor-pointer shadow-sm active:scale-95'
                    : 'bg-zinc-800 text-zinc-600 cursor-not-allowed border border-zinc-700/50'
                }`}
                title="Undo last edit (တစ်ခုချင်း ပြန်သွားမည်)"
              >
                <Undo className="w-3.5 h-3.5" />
                <span>Undo</span>
              </button>

              <button
                type="button"
                onClick={onRedo}
                disabled={!canRedo}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1 ${
                  canRedo
                    ? 'bg-amber-500 hover:bg-amber-400 text-zinc-950 cursor-pointer shadow-sm active:scale-95'
                    : 'bg-zinc-800 text-zinc-600 cursor-not-allowed border border-zinc-700/50'
                }`}
                title="Redo next edit (တစ်ခုချင်း ရှေ့သို့ပြန်သွားမည်)"
              >
                <Redo className="w-3.5 h-3.5" />
                <span>Redo</span>
              </button>
            </div>
          </div>

          {/* USER REQUESTED FEATURE: VIDEO SPEED ONLY CONTROL (ADJUST VIDEO PLAYBACK SPEED WITHOUT AFFECTING VOICE AUDIO) */}

          <div className="p-3.5 rounded-xl bg-gradient-to-r from-cyan-950/70 via-zinc-950 to-blue-950/50 border border-cyan-500/60 space-y-2.5 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs text-cyan-300 flex items-center gap-1.5">
                <FastForward className="w-4 h-4 text-cyan-400" />
                <span>🎬 Video Speed Only (ဗီဒီယို အရှိန် သီးသန့် ချိန်ညှိရန်)</span>
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-900/80 border border-cyan-500/60 text-cyan-200 font-mono font-bold">
                Video: {project.playbackRate.toFixed(2)}x
              </span>
            </div>

            <p className="text-[11px] text-zinc-300 font-myanmar leading-relaxed">
              ဗီဒီယို ရွေ့လျားမှုကို အနှေး (Slow Motion) သို့မဟုတ် အမြန် (Fast) ချိန်ညှိနိုင်ပါသည်။ <strong>အသံ (Voice Clone) အရှိန် မပြောင်းဘဲ သီးသန့် ပုံသေ ထိန်းသိမ်းပေးပါသည်။</strong>
            </p>

            <div className="space-y-1 pt-1">
              <input
                type="range"
                min={0.25}
                max={2.5}
                step={0.05}
                value={project.playbackRate}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setProject((prev) => ({ ...prev, playbackRate: val }));
                }}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
              <div className="flex justify-between text-[10px] font-mono text-zinc-400">
                <span>0.25x (Slow)</span>
                <span>1.0x (Normal)</span>
                <span>2.5x (Fast)</span>
              </div>
            </div>

            <div className="grid grid-cols-6 gap-1 pt-0.5">
              {[0.5, 0.75, 0.9, 1.0, 1.25, 1.5].map((spd) => (
                <button
                  key={spd}
                  type="button"
                  onClick={() => setProject((prev) => ({ ...prev, playbackRate: spd }))}
                  className={`py-1 rounded text-[11px] font-bold font-mono transition-all cursor-pointer ${
                    project.playbackRate === spd
                      ? 'bg-cyan-500 text-zinc-950 shadow-md ring-1 ring-cyan-300'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  {spd}x
                </button>
              ))}
            </div>

            <div className="p-2 rounded bg-zinc-900/80 border border-zinc-800 text-[10px] text-emerald-300 font-myanmar flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>အသံအရှိန် (Voice Audio Speed) သည် 1.0x မူရင်းအတိုင်း တည်ရှိနေပြီး ဗီဒီယို တစ်ခုတည်းသာ အနှေး/အမြန် ပြောင်းပါမည်။</span>
            </div>
          </div>

          {/* Segment Selector Dropdown */}
          <div className="space-y-1.5">
            <label className="text-zinc-300 font-medium flex items-center justify-between">
              <span>ရွေးချယ်ထားသော စာသား & အသံအပိုင်း:</span>
              <span className="text-[11px] text-emerald-400 font-mono-num">
                {currentSeg ? `${currentSeg.startTime.toFixed(2)}s - ${currentSeg.endTime.toFixed(2)}s` : 'None'}
              </span>
            </label>
            <select
              value={currentSeg?.id || ''}
              onChange={(e) => {
                setSelectedSegmentId(e.target.value);
                const s = project.segments.find((seg) => seg.id === e.target.value);
                if (s) onSeekTo(s.startTime);
              }}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs font-myanmar text-zinc-100 focus:outline-none focus:border-emerald-500"
            >
              {project.segments.map((seg, idx) => (
                <option key={seg.id} value={seg.id}>
                  #{idx + 1} [{seg.startTime.toFixed(1)}s - {seg.endTime.toFixed(1)}s] {seg.voice} voice: {seg.myanmarTranslation?.slice(0, 32)}...
                </option>
              ))}
            </select>
          </div>

          {currentSeg ? (
            <>
              {/* PRIMARY CATCH-UP ACTION: Move to Playhead */}
              <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/60 space-y-2.5 shadow-md">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-emerald-300 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Catch-Up: Video နေရာသို့ ကွက်တိရွှေ့မည်</span>
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-900 border border-emerald-700 text-emerald-200 font-mono">
                    Playhead: {project.currentTime.toFixed(2)}s
                  </span>
                </div>

                <p className="text-[11px] text-zinc-300 font-myanmar leading-relaxed">
                  ဗီဒီယိုကို လိုချင်သည့် အချိန်နေရာသို့ ရွှေ့ပြီး ဤခလုတ်ကို နှိပ်ပါက အသံနှင့် မြန်မာစာတန်းထိုး (TTX) သည် ထိုနေရာသို့ ချက်ချင်း ကွက်တိ ပြောင်းရွှေ့ရောက်ရှိပါမည်။
                </p>

                <button
                  onClick={handleCatchUpToPlayhead}
                  className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold rounded-lg transition-all flex items-center justify-center gap-2 shadow-md shadow-emerald-500/20"
                >
                  <MapPin className="w-4 h-4" />
                  <span>Move Audio & TTX to {project.currentTime.toFixed(2)}s</span>
                </button>
              </div>

              {/* Quick switch to Edit tab for Fine-Tune Nudge */}
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between">
                <span className="text-[11px] text-amber-300 font-myanmar">
                  အသံနှင့် စာတန်းထိုး ရှေ့တိုး/နောက်ဆုတ် အသေးစိတ်ချိန်ရန် (Fine-Tune Nudge)
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTab('timeline_edit')}
                  className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-bold text-[11px] transition-all flex items-center gap-1 shadow-sm cursor-pointer"
                >
                  <Sliders className="w-3 h-3" />
                  <span>Edit 🎬 သို့ သွားမည်</span>
                </button>
              </div>

              {/* EDIT BURMESE SUBTITLE TEXT */}
              <div className="space-y-1.5">
                <label className="text-zinc-300 font-medium">
                  မြန်မာစာတန်းထိုး ပြင်ဆင်ရန် (Edit TTX Subtitle):
                </label>
                <textarea
                  rows={2}
                  value={currentSeg.myanmarTranslation}
                  onChange={(e) => {
                    const val = e.target.value;
                    setProject((prev) => ({
                      ...prev,
                      segments: prev.segments.map((s) =>
                        s.id === currentSeg.id ? { ...s, myanmarTranslation: val } : s
                      ),
                    }));
                  }}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs font-myanmar text-zinc-100 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* SUBTITLE SCREEN POSITION ON VIDEO */}
              <div className="space-y-1.5">
                <span className="text-zinc-300 font-medium">ဗီဒီယိုပေါ် စာတန်းထိုး တင်မည့်နေရာ (Screen Position):</span>
                <div className="grid grid-cols-3 gap-2">
                  {(['top', 'center', 'bottom'] as const).map((pos) => (
                    <button
                      key={pos}
                      onClick={() =>
                        setProject((prev) => ({
                          ...prev,
                          subtitleSettings: { ...prev.subtitleSettings, positionY: pos },
                        }))
                      }
                      className={`py-1.5 rounded-lg border text-xs font-medium capitalize transition-all ${
                        project.subtitleSettings.positionY === pos
                          ? 'bg-cyan-950 border-cyan-400 text-cyan-200'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {pos === 'top' ? 'အပေါ် (Top)' : pos === 'center' ? 'အလယ် (Center)' : 'အောက် (Bottom)'}
                    </button>
                  ))}
                </div>
              </div>

              {/* TEST PLAY BUTTON */}
              <button
                onClick={() => {
                  onSeekTo(currentSeg.startTime);
                  setProject((prev) => ({ ...prev, isPlaying: true }));
                }}
                className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-cyan-300 font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 border border-zinc-700/60"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Test Play Segment ({currentSeg.startTime.toFixed(1)}s - {currentSeg.endTime.toFixed(1)}s)</span>
              </button>
            </>
          ) : (
            <div className="p-4 text-center text-zinc-500 font-myanmar">
              စာသားများ မရှိသေးပါ။ အဆင့် 4 တွင် Transcript ထုတ်ယူပေးပါ။
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Alight Motion Keyframe FX Controls */}
      {activeTab === 'motion_fx' && (
        <div className="p-4 space-y-4 overflow-y-auto max-h-[580px] text-xs">
          {/* Global Color Grade */}
          <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
            <label className="text-zinc-300 font-semibold block text-[11px]">Global Video Color Grade (ဗီဒီယို တစ်ခုလုံး):</label>
            <select
              value={project.globalColorFilter}
              onChange={(e) => setProject((prev) => ({ ...prev, globalColorFilter: e.target.value as any }))}
              className="w-full px-2.5 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none"
            >
              <option value="none">Normal (မူလအရောင်)</option>
              <option value="cinematic">Cinematic Grade</option>
              <option value="warm">Warm Film Tone</option>
              <option value="vintage">Vintage Sepia</option>
              <option value="cyber">Cyberpunk Hue</option>
              <option value="dhamma_gold">Dhamma Serene Gold</option>
            </select>
          </div>

          {/* Add Keyframe Action & Selector */}
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={handleAddKeyframe}
              className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/20"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Keyframe at {project.currentTime.toFixed(2)}s</span>
            </button>

            {currentKf && (
              <button
                onClick={() => handleDeleteKeyframe(currentKf.id)}
                className="p-2 bg-zinc-800 hover:bg-rose-950/60 text-zinc-400 hover:text-rose-300 rounded-lg transition-colors border border-zinc-700"
                title="Delete current keyframe"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Keyframe Selector */}
          <div className="space-y-1">
            <label className="text-zinc-400 text-[11px]">Selected Keyframe:</label>
            <select
              value={currentKf?.id || ''}
              onChange={(e) => {
                setSelectedKeyframeId(e.target.value);
                const k = project.keyframes.find((kf) => kf.id === e.target.value);
                if (k) onSeekTo(k.time);
              }}
              className="w-full px-2.5 py-1.5 bg-zinc-950 border border-zinc-700 rounded-lg text-xs font-mono text-zinc-100 focus:outline-none"
            >
              {project.keyframes.map((k, idx) => (
                <option key={k.id} value={k.id}>
                  Keyframe #{idx + 1} at {k.time.toFixed(2)}s (Scale: {k.scale}x, Shake: {k.shakeIntensity})
                </option>
              ))}
            </select>
          </div>

          {currentKf && (
            <div className="space-y-3.5 p-3 rounded-xl bg-zinc-950/70 border border-zinc-800">
              {/* Scale / Zoom */}
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-zinc-300 font-medium">Scale (အနီးအဝေး Zoom):</span>
                  <span className="font-mono text-amber-400 font-bold">{currentKf.scale.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min={0.8}
                  max={2.5}
                  step={0.05}
                  value={currentKf.scale}
                  onChange={(e) => handleUpdateKeyframe(currentKf.id, { scale: parseFloat(e.target.value) })}
                  className="w-full h-1.5 bg-zinc-800 rounded accent-amber-400"
                />
                <div className="flex gap-1.5 pt-0.5">
                  {[1.0, 1.2, 1.5, 2.0].map((s) => (
                    <button
                      key={s}
                      onClick={() => handleUpdateKeyframe(currentKf.id, { scale: s })}
                      className={`flex-1 py-0.5 rounded text-[10px] font-mono border ${
                        currentKf.scale === s
                          ? 'bg-amber-950 border-amber-500 text-amber-300'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>

              {/* Camera Shake Intensity */}
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-zinc-300 font-medium">Camera Shake (တုန်ခါမှု):</span>
                  <span className="font-mono text-rose-400 font-bold">{currentKf.shakeIntensity}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={1}
                  value={currentKf.shakeIntensity}
                  onChange={(e) => handleUpdateKeyframe(currentKf.id, { shakeIntensity: parseInt(e.target.value) })}
                  className="w-full h-1.5 bg-zinc-800 rounded accent-rose-400"
                />
                <div className="flex gap-1.5 pt-0.5">
                  {[0, 2, 5, 8].map((lvl) => (
                    <button
                      key={lvl}
                      onClick={() => handleUpdateKeyframe(currentKf.id, { shakeIntensity: lvl })}
                      className={`flex-1 py-0.5 rounded text-[10px] font-mono border ${
                        currentKf.shakeIntensity === lvl
                          ? 'bg-rose-950 border-rose-500 text-rose-300'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                      }`}
                    >
                      {lvl === 0 ? 'Off' : `Lvl ${lvl}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Rotation Angle */}
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-zinc-300 font-medium">Rotation (အလှည့်ဒီဂရီ):</span>
                  <span className="font-mono text-cyan-400 font-bold">{currentKf.rotation}°</span>
                </div>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={5}
                  value={currentKf.rotation}
                  onChange={(e) => handleUpdateKeyframe(currentKf.id, { rotation: parseInt(e.target.value) })}
                  className="w-full h-1.5 bg-zinc-800 rounded accent-cyan-400"
                />
              </div>

              {/* Pan Offset X & Y */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Pan X:</span>
                    <span className="font-mono">{currentKf.posX}px</span>
                  </div>
                  <input
                    type="range"
                    min={-150}
                    max={150}
                    step={5}
                    value={currentKf.posX}
                    onChange={(e) => handleUpdateKeyframe(currentKf.id, { posX: parseInt(e.target.value) })}
                    className="w-full h-1.5 bg-zinc-800 rounded accent-zinc-400"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Pan Y:</span>
                    <span className="font-mono">{currentKf.posY}px</span>
                  </div>
                  <input
                    type="range"
                    min={-150}
                    max={150}
                    step={5}
                    value={currentKf.posY}
                    onChange={(e) => handleUpdateKeyframe(currentKf.id, { posY: parseInt(e.target.value) })}
                    className="w-full h-1.5 bg-zinc-800 rounded accent-zinc-400"
                  />
                </div>
              </div>

              {/* Color Grade Filters */}
              <div className="space-y-1.5">
                <span className="text-zinc-300 font-medium">Color Grade (အရောင်စစ် Filters):</span>
                <select
                  value={currentKf.filter}
                  onChange={(e) => handleUpdateKeyframe(currentKf.id, { filter: e.target.value as any })}
                  className="w-full px-2.5 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none"
                >
                  <option value="none">Normal (မူလအရောင်)</option>
                  <option value="cinematic">Cinematic Grade</option>
                  <option value="warm">Warm Film Tone</option>
                  <option value="vintage">Vintage Sepia</option>
                  <option value="cyber">Cyberpunk Hue</option>
                  <option value="dhamma_gold">Dhamma Serene Gold</option>
                </select>
              </div>
            </div>
          )}

          {/* Quick 1-Click Presets */}
          <div className="space-y-1.5">
            <span className="text-zinc-400 font-medium text-[11px]">Quick Motion Presets:</span>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => handleApplyPreset('smoothZoom')}
                className="py-1.5 px-2 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-[11px] text-cyan-300 transition-colors flex items-center justify-center gap-1"
              >
                <ZoomIn className="w-3 h-3" />
                <span>Zoom</span>
              </button>
              <button
                onClick={() => handleApplyPreset('impactShake')}
                className="py-1.5 px-2 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-[11px] text-rose-300 transition-colors flex items-center justify-center gap-1"
              >
                <Activity className="w-3 h-3" />
                <span>Shake</span>
              </button>
              <button
                onClick={() => handleApplyPreset('dhammaAura')}
                className="py-1.5 px-2 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-[11px] text-amber-300 transition-colors flex items-center justify-center gap-1"
              >
                <Sparkles className="w-3 h-3" />
                <span>Aura</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Subtitle Styling & Appearance */}
      {activeTab === 'subtitle_style' && (
        <div className="p-4 space-y-4 overflow-y-auto max-h-[580px] text-xs">
          {/* Font Family */}
          <div className="space-y-1.5">
            <label className="text-zinc-300 font-medium">မြန်မာဖောင့် (Font Family):</label>
            <div className="grid grid-cols-2 gap-2">
              {(['Pyidaungsu', 'Noto Sans Myanmar'] as const).map((font) => (
                <button
                  key={font}
                  onClick={() =>
                    setProject((prev) => ({
                      ...prev,
                      subtitleSettings: { ...prev.subtitleSettings, fontFamily: font },
                    }))
                  }
                  className={`py-2 px-2.5 rounded-lg border text-xs font-medium font-myanmar transition-all ${
                    project.subtitleSettings.fontFamily === font
                      ? 'bg-cyan-950 border-cyan-400 text-cyan-200 shadow-sm'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                  }`}
                >
                  {font}
                </button>
              ))}
            </div>
          </div>

          {/* Font Size */}
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-zinc-300">စာလုံးအရွယ်အစား (Font Size):</span>
              <span className="font-mono text-cyan-400 font-bold">{project.subtitleSettings.fontSize}px</span>
            </div>
            <input
              type="range"
              min={1}
              max={72}
              step={1}
              value={project.subtitleSettings.fontSize}
              onChange={(e) =>
                setProject((prev) => ({
                  ...prev,
                  subtitleSettings: {
                    ...prev.subtitleSettings,
                    fontSize: parseInt(e.target.value) || 1,
                  },
                }))
              }
              className="w-full h-1.5 bg-zinc-800 rounded accent-cyan-400"
            />
          </div>

          {/* Colors */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <span className="text-zinc-400">စာလုံးအရောင် (Color):</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={project.subtitleSettings.color}
                  onChange={(e) =>
                    setProject((prev) => ({
                      ...prev,
                      subtitleSettings: { ...prev.subtitleSettings, color: e.target.value },
                    }))
                  }
                  className="w-8 h-8 rounded bg-transparent cursor-pointer border border-zinc-700"
                />
                <span className="font-mono text-[11px] text-zinc-300">{project.subtitleSettings.color}</span>
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-zinc-400">ဘောင်အရောင် (Stroke):</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={project.subtitleSettings.strokeColor}
                  onChange={(e) =>
                    setProject((prev) => ({
                      ...prev,
                      subtitleSettings: { ...prev.subtitleSettings, strokeColor: e.target.value },
                    }))
                  }
                  className="w-8 h-8 rounded bg-transparent cursor-pointer border border-zinc-700"
                />
                <span className="font-mono text-[11px] text-zinc-300">{project.subtitleSettings.strokeColor}</span>
              </div>
            </div>
          </div>

          {/* Background Box */}
          <div className="space-y-1.5">
            <span className="text-zinc-300 font-medium">နောက်ခံအကွက် (Background Box):</span>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'None', val: 'transparent' },
                { label: 'Semi-Dark', val: 'rgba(0,0,0,0.7)' },
                { label: 'Black Box', val: 'rgba(0,0,0,0.92)' },
              ].map((bg) => (
                <button
                  key={bg.label}
                  onClick={() =>
                    setProject((prev) => ({
                      ...prev,
                      subtitleSettings: {
                        ...prev.subtitleSettings,
                        backgroundColor: bg.val,
                      },
                    }))
                  }
                  className={`py-1.5 rounded-lg border text-xs transition-all ${
                    project.subtitleSettings.backgroundColor === bg.val
                      ? 'bg-cyan-950 border-cyan-400 text-cyan-200'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                  }`}
                >
                  {bg.label}
                </button>
              ))}
            </div>
          </div>

          {/* Karaoke Highlight */}
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-950 border border-zinc-800">
            <span className="text-zinc-300 font-medium">Karaoke Highlight Mode</span>
            <input
              type="checkbox"
              checked={project.subtitleSettings.showKaraoke}
              onChange={(e) =>
                setProject((prev) => ({
                  ...prev,
                  subtitleSettings: {
                    ...prev.subtitleSettings,
                    showKaraoke: e.target.checked,
                  },
                }))
              }
              className="rounded bg-zinc-800 border-zinc-700 text-cyan-500 focus:ring-0 cursor-pointer"
            />
          </div>
        </div>
      )}

      {/* Tab 4: Logo Watermark Configuration (User Requested Feature) */}
      {activeTab === ('logo_config' as any) && (
        <div className="p-4 space-y-4 overflow-y-auto max-h-[580px] text-xs">
          <div className="p-3.5 rounded-xl bg-zinc-950 border border-rose-800/60 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-rose-300 flex items-center gap-1.5">
                <Film className="w-4 h-4 text-rose-400" />
                <span>Custom Logo Watermark (အမှတ်တံဆိပ် လိုဂို)</span>
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-rose-950 text-rose-300 font-mono">
                Fixed Watermark
              </span>
            </div>

            <p className="text-[11px] text-zinc-400 font-myanmar leading-relaxed">
              ဗီဒီယိုပေါ်တွင် တင်မည့် Logo ပုံကို ရွေးချယ်ပါ။ အဝိုင်း (Circle) သို့မဟုတ် လေးထောင့်စတုရန်း (Square) ပုံစံ ညှပ်၍ အရွယ်အစားနှင့် နေရာကို စိတ်ကြိုက် ချိန်ညှိနိုင်ပါသည်။ "OK / Fix" နှိပ်လိုက်ပါက နောက်အဆင့်များနှင့် Export အထိ အမြဲတမ်း တပ်ဆင်ပြီးသား Fixed ဖြစ်သွားပါမည်။
            </p>

            {/* Upload Logo Button */}
            <div>
              <label className="block text-[11px] font-semibold text-zinc-300 mb-1.5">
                📁 Custom Logo Image Upload:
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      const dataUrl = event.target?.result as string;
                      setProject((prev) => ({
                        ...prev,
                        logoConfig: {
                          imageUrl: dataUrl,
                          shape: prev.logoConfig?.shape || 'circle',
                          x: prev.logoConfig?.x ?? 80,
                          y: prev.logoConfig?.y ?? 5,
                          size: prev.logoConfig?.size ?? 72,
                          opacity: prev.logoConfig?.opacity ?? 1,
                          textWatermark: prev.logoConfig?.textWatermark,
                          textWatermarkSize: prev.logoConfig?.textWatermarkSize,
                          textWatermarkSpeed: prev.logoConfig?.textWatermarkSpeed,
                        },
                      }));
                    };
                    reader.readAsDataURL(file);
                  }
                }}
                className="w-full text-xs text-zinc-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-rose-600 file:text-white hover:file:bg-rose-500 cursor-pointer"
              />
            </div>

            {/* TEXT WATERMARK INPUT BOX (USER REQUESTED FEATURE) */}
            <div className="pt-2 border-t border-zinc-800 space-y-2.5">
              <label className="block text-[11px] font-semibold text-rose-300">
                ✍️ ရေစာစာသား (Running Text Watermark):
              </label>
              <input
                type="text"
                value={project.logoConfig?.textWatermark || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setProject((prev) => ({
                    ...prev,
                    logoConfig: {
                      imageUrl: prev.logoConfig?.imageUrl || null,
                      shape: prev.logoConfig?.shape || 'circle',
                      x: prev.logoConfig?.x ?? 80,
                      y: prev.logoConfig?.y ?? 5,
                      size: prev.logoConfig?.size ?? 72,
                      opacity: prev.logoConfig?.opacity ?? 1,
                      textWatermark: val,
                      textWatermarkSize: prev.logoConfig?.textWatermarkSize ?? 24,
                      textWatermarkSpeed: prev.logoConfig?.textWatermarkSpeed ?? 30,
                    },
                  }));
                }}
                placeholder="ဥပမာ- 'Motion Recap Studio' သို့မဟုတ် Channel Name..."
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-zinc-100 font-myanmar focus:outline-none focus:border-rose-500"
              />

              {project.logoConfig?.textWatermark && (
                <div className="space-y-2 pt-1">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-zinc-400">
                      <span>Text Size (စာလုံးအရွယ်အစား):</span>
                      <span className="font-mono text-rose-400 font-bold">{project.logoConfig.textWatermarkSize || 24}px</span>
                    </div>
                    <input
                      type="range"
                      min={12}
                      max={64}
                      step={2}
                      value={project.logoConfig.textWatermarkSize || 24}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 24;
                        setProject((prev) => ({
                          ...prev,
                          logoConfig: prev.logoConfig ? { ...prev.logoConfig, textWatermarkSize: val } : null,
                        }));
                      }}
                      className="w-full h-1.5 bg-zinc-800 rounded accent-rose-400"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-zinc-400">
                      <span>Running Speed (အမြန်နှုန်း):</span>
                      <span className="font-mono text-cyan-400 font-bold">{project.logoConfig.textWatermarkSpeed || 30}x</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      step={5}
                      value={project.logoConfig.textWatermarkSpeed || 30}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 30;
                        setProject((prev) => ({
                          ...prev,
                          logoConfig: prev.logoConfig ? { ...prev.logoConfig, textWatermarkSpeed: val } : null,
                        }));
                      }}
                      className="w-full h-1.5 bg-zinc-800 rounded accent-cyan-400"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {project.logoConfig && project.logoConfig.imageUrl ? (
            <div className="space-y-3.5 p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800">
              {/* Preview Box */}
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <span className="text-zinc-300 font-medium">Logo Preview:</span>
                <button
                  onClick={() =>
                    setProject((prev) => ({
                      ...prev,
                      logoConfig: null,
                    }))
                  }
                  className="px-2 py-1 text-[11px] bg-rose-950/80 hover:bg-rose-900 text-rose-300 rounded border border-rose-800 transition-colors flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Remove Logo</span>
                </button>
              </div>



              {/* Size Slider */}
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-zinc-300">Size (အကြီးအသေး ချုံချဲ့ရန်):</span>
                  <span className="font-mono text-rose-400 font-bold">{project.logoConfig.size}px</span>
                </div>
                <input
                  type="range"
                  min={32}
                  max={200}
                  step={4}
                  value={project.logoConfig.size}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 64;
                    setProject((prev) => ({
                      ...prev,
                      logoConfig: prev.logoConfig ? { ...prev.logoConfig, size: val } : null,
                    }));
                  }}
                  className="w-full h-1.5 bg-zinc-800 rounded accent-rose-400"
                />
              </div>

              {/* Position X & Y */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Position X:</span>
                    <span className="font-mono">{project.logoConfig.x}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={90}
                    step={2}
                    value={project.logoConfig.x}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setProject((prev) => ({
                        ...prev,
                        logoConfig: prev.logoConfig ? { ...prev.logoConfig, x: val } : null,
                      }));
                    }}
                    className="w-full h-1.5 bg-zinc-800 rounded accent-zinc-400"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Position Y:</span>
                    <span className="font-mono">{project.logoConfig.y}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={90}
                    step={2}
                    value={project.logoConfig.y}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setProject((prev) => ({
                        ...prev,
                        logoConfig: prev.logoConfig ? { ...prev.logoConfig, y: val } : null,
                      }));
                    }}
                    className="w-full h-1.5 bg-zinc-800 rounded accent-zinc-400"
                  />
                </div>
              </div>

              {/* OK / Fixed Confirmation Button */}
              <button
                type="button"
                onClick={() => {
                  alert('✓ Logo ကို ဗီဒီယိုပေါ်တွင် အောင်မြင်စွာ Fixed တပ်ဆင်ပြီးပါပြီ။ နောက်အဆင့်များနှင့် Export တွင် ဆက်လက်ပါဝင်မည် ဖြစ်ပါသည်။');
                }}
                className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg transition-all shadow-md shadow-rose-600/30 flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>OK / Fix Logo Watermark (အတည်ပြုမည်)</span>
              </button>
            </div>
          ) : (
            <div className="p-6 text-center border border-dashed border-zinc-800 rounded-xl text-zinc-500 font-myanmar">
              Logo ပုံ တင်ထားခြင်း မရှိသေးပါ။ အထပါ "Custom Logo Image Upload" တွင် ပုံ အရင် ရွေးချယ်ပါ။
            </div>
          )}
        </div>
      )}

      {/* Tab 5: Edit Button Click -> Fine-Tune Nudge & Timeline Controls */}
      {activeTab === 'timeline_edit' && (
        <div className="p-4 space-y-4 overflow-y-auto max-h-[580px] text-xs">
          {/* Header indicator with Undo & Redo */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-950 border border-amber-500/40 shadow-md">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                <Sliders className="w-4 h-4" />
              </div>
              <div>
                <span className="font-bold text-amber-300 text-xs block font-display tracking-wide">
                  Fine-Tune Nudge & Edit Studio
                </span>
                <span className="text-[11px] text-zinc-400 font-myanmar">
                  အသံ & TTX စာတန်းထိုး Timing အတိအကျ ရှေ့တိုး/နောက်ဆုတ် ချိန်ညှိရန်
                </span>
              </div>
            </div>

            {/* Undo & Redo Controls */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onUndo}
                disabled={!canUndo}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                  canUndo
                    ? 'bg-cyan-500 hover:bg-cyan-400 text-zinc-950 cursor-pointer shadow-sm active:scale-95'
                    : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                }`}
                title="Undo Nudge Edit"
              >
                <Undo className="w-3.5 h-3.5" />
                <span>Undo</span>
              </button>
              <button
                type="button"
                onClick={onRedo}
                disabled={!canRedo}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                  canRedo
                    ? 'bg-amber-500 hover:bg-amber-400 text-zinc-950 cursor-pointer shadow-sm active:scale-95'
                    : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                }`}
                title="Redo Nudge Edit"
              >
                <Redo className="w-3.5 h-3.5" />
                <span>Redo</span>
              </button>
            </div>
          </div>

          {/* Segment Selector Dropdown */}
          <div className="space-y-1.5">
            <label className="text-zinc-300 font-medium flex items-center justify-between">
              <span>ချိန်ညှိမည့် အပိုင်း ရွေးချယ်ပါ (Select Segment):</span>
              <span className="text-[11px] text-amber-400 font-mono-num font-bold">
                {currentSeg ? `${currentSeg.startTime.toFixed(2)}s - ${currentSeg.endTime.toFixed(2)}s` : 'None'}
              </span>
            </label>
            <select
              value={currentSeg?.id || ''}
              onChange={(e) => {
                setSelectedSegmentId(e.target.value);
                const s = project.segments.find((seg) => seg.id === e.target.value);
                if (s) onSeekTo(s.startTime);
              }}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs font-myanmar text-zinc-100 focus:outline-none focus:border-amber-500"
            >
              {project.segments.map((seg, idx) => (
                <option key={seg.id} value={seg.id}>
                  #{idx + 1} [{seg.startTime.toFixed(1)}s - {seg.endTime.toFixed(1)}s] {seg.voice} voice: {seg.myanmarTranslation?.slice(0, 32)}...
                </option>
              ))}
            </select>
          </div>

          {currentSeg ? (
            <div className="space-y-3 p-3.5 rounded-xl bg-zinc-950/90 border border-amber-500/30 shadow-lg">
              {/* Active Segment Preview */}
              <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-between">
                <div className="truncate pr-2">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider block">Current Myanmar TTX Subtitle</span>
                  <span className="text-xs text-amber-200 font-myanmar truncate block">
                    "{currentSeg.myanmarTranslation}"
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onSeekTo(currentSeg.startTime)}
                  className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-cyan-300 text-[11px] font-mono shrink-0 flex items-center gap-1.5 cursor-pointer border border-zinc-700 hover:border-cyan-500/50 transition-all"
                  title="Seek playhead to segment start"
                >
                  <MapPin className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Seek ({currentSeg.startTime.toFixed(1)}s)</span>
                </button>
              </div>

              {/* Nudge Header */}
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
                <span className="text-zinc-200 font-semibold text-xs flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-amber-400" />
                  <span>Fine-Tune Nudge (စာသား & အသံ ရှေ့တိုး/နောက်ဆုတ် ချိန်ညှိရန်):</span>
                </span>
                <span className="text-[11px] font-mono text-cyan-400 font-bold">
                  {currentSeg.startTime.toFixed(2)}s - {currentSeg.endTime.toFixed(2)}s
                </span>
              </div>

              {/* 6 Nudge Buttons */}
              <div className="grid grid-cols-6 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleNudgeSegment(-1.0)}
                  className="py-2 px-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-center font-mono text-xs font-semibold hover:border-zinc-700 transition-colors shadow-sm cursor-pointer"
                  title="Nudge back 1.0 second"
                >
                  -1.0s
                </button>
                <button
                  type="button"
                  onClick={() => handleNudgeSegment(-0.5)}
                  className="py-2 px-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-center font-mono text-xs font-semibold hover:border-zinc-700 transition-colors shadow-sm cursor-pointer"
                  title="Nudge back 0.5 second"
                >
                  -0.5s
                </button>
                <button
                  type="button"
                  onClick={() => handleNudgeSegment(-0.1)}
                  className="py-2 px-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-center font-mono text-xs font-semibold hover:border-zinc-700 transition-colors shadow-sm cursor-pointer"
                  title="Nudge back 0.1 second"
                >
                  -0.1s
                </button>
                <button
                  type="button"
                  onClick={() => handleNudgeSegment(0.1)}
                  className="py-2 px-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-cyan-300 text-center font-mono text-xs font-semibold hover:border-cyan-500/50 transition-colors shadow-sm cursor-pointer"
                  title="Nudge forward 0.1 second"
                >
                  +0.1s
                </button>
                <button
                  type="button"
                  onClick={() => handleNudgeSegment(0.5)}
                  className="py-2 px-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-cyan-300 text-center font-mono text-xs font-semibold hover:border-cyan-500/50 transition-colors shadow-sm cursor-pointer"
                  title="Nudge forward 0.5 second"
                >
                  +0.5s
                </button>
                <button
                  type="button"
                  onClick={() => handleNudgeSegment(1.0)}
                  className="py-2 px-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-cyan-300 text-center font-mono text-xs font-semibold hover:border-cyan-500/50 transition-colors shadow-sm cursor-pointer"
                  title="Nudge forward 1.0 second"
                >
                  +1.0s
                </button>
              </div>

              {/* Status indicator bar */}
              <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px]">
                <div className="flex items-center gap-1.5 truncate">
                  {currentSeg.isTimingFixed || fixFeedback ? (
                    <span className="flex items-center gap-1 text-emerald-400 font-medium">
                      <Pin className="w-3.5 h-3.5 fill-current shrink-0" />
                      <span>✓ နေရာကွက်တိ Fix အတည်ပြုထားပါသည် ({currentSeg.startTime.toFixed(2)}s - {currentSeg.endTime.toFixed(2)}s)</span>
                    </span>
                  ) : (
                    <span className="text-zinc-400 font-myanmar truncate">
                      {currentSeg.originalStartTime !== undefined && currentSeg.startTime !== currentSeg.originalStartTime
                        ? `နေရာရွှေ့ထားသည် (မူရင်း: ${currentSeg.originalStartTime.toFixed(2)}s) — Fix နှိပ်၍ အတည်ပြုပါ`
                        : 'စာသားနှင့်အသံကို ရွှေ့ပြီးပါက Fix နှိပ်၍ သတ်မှတ်ပါ'}
                    </span>
                  )}
                </div>
                {currentSeg.originalStartTime !== undefined && (
                  <span className="text-zinc-500 font-mono text-[10px] shrink-0 ml-2">
                    Original: {currentSeg.originalStartTime.toFixed(2)}s
                  </span>
                )}
              </div>

              {/* FIX BUTTON & RESTART BUTTON */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                {/* FIX BUTTON */}
                <button
                  type="button"
                  onClick={handleFixTiming}
                  className={`py-2 px-3 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1.5 shadow-md cursor-pointer ${
                    currentSeg.isTimingFixed || fixFeedback
                      ? 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950 ring-2 ring-emerald-300 shadow-emerald-500/30'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/40'
                  }`}
                  title="Lock & Fix this placed timing for audio and subtitle"
                >
                  <Pin className="w-3.5 h-3.5" />
                  <span>{fixFeedback ? '✓ Fix အတည်ပြုပြီးပါပြီ' : currentSeg.isTimingFixed ? '📌 Fix နေရာအတည်ပြုပြီး' : '📌 Fix Position (အတည်ပြုမည်)'}</span>
                </button>

                {/* RESTART BUTTON */}
                <button
                  type="button"
                  onClick={handleRestartTiming}
                  className="py-2 px-3 rounded-lg font-medium text-xs bg-zinc-900 hover:bg-amber-950/70 hover:border-amber-500/70 border border-zinc-700 text-zinc-300 hover:text-amber-300 transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                  title="Reset timing back to original position"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                  <span>↺ Restart (မူရင်းပြန်ထားမည်)</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center border border-dashed border-zinc-800 rounded-xl text-zinc-500 font-myanmar">
              ချိန်ညှိရန် စာသား သို့မဟုတ် အသံအပိုင်းကို အထက်တွင် အရင် ရွေးချယ်ပါ။
            </div>
          )}
        </div>
      )}
    </div>
  );
};
