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

export type AlightSettingsTab = 'motion_fx' | 'subtitle_style' | 'logo_config' | 'timeline_edit';

interface Step8AlightMotionSettingsProps {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  selectedSegmentId: string | null;
  setSelectedSegmentId: (id: string | null) => void;
  selectedKeyframeId?: string | null;
  setSelectedKeyframeId?: (id: string | null) => void;
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
  const [internalActiveTab, setInternalActiveTab] = useState<AlightSettingsTab>('motion_fx');
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

  // Base motion FX state
  const activeMotion: AlightKeyframe = project.keyframes[0] || {
    id: 'kf_0',
    time: 0,
    scale: 1.0,
    posX: 0,
    posY: 0,
    rotation: 0,
    opacity: 1,
    blur: 0,
    shakeIntensity: 0,
    filter: 'none',
  };

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

  const handleUpdateMotion = (updates: Partial<AlightKeyframe>) => {
    setProject((prev) => {
      if (!prev.keyframes || prev.keyframes.length === 0) {
        return {
          ...prev,
          keyframes: [{ ...activeMotion, ...updates }],
        };
      }
      return {
        ...prev,
        keyframes: prev.keyframes.map((k) => ({ ...k, ...updates })),
      };
    });
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

        {/* 4 Main Setting Tabs */}
        <div className="grid grid-cols-4 gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-lg">

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

          <div className="space-y-3.5 p-3 rounded-xl bg-zinc-950/70 border border-zinc-800">
            {/* Color Grade Filters */}
            <div className="space-y-1.5">
              <span className="text-zinc-300 font-medium">Color Grade (အရောင်စစ် Filters):</span>
              <select
                value={activeMotion.filter}
                onChange={(e) => handleUpdateMotion({ filter: e.target.value as any })}
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

          {/* Quick 1-Click Presets */}
          <div className="space-y-1.5">
            <span className="text-zinc-400 font-medium text-[11px]">Quick Motion Presets:</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleApplyPreset('smoothZoom')}
                className="py-1.5 px-2 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-[11px] text-cyan-300 transition-colors flex items-center justify-center gap-1"
              >
                <ZoomIn className="w-3 h-3" />
                <span>Zoom</span>
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
              <span className="font-mono text-cyan-400 font-bold">{Math.max(12, project.subtitleSettings.fontSize)}px</span>
            </div>
            <input
              type="range"
              min={12}
              max={72}
              step={1}
              value={Math.max(12, project.subtitleSettings.fontSize)}
              onChange={(e) =>
                setProject((prev) => ({
                  ...prev,
                  subtitleSettings: {
                    ...prev.subtitleSettings,
                    fontSize: Math.max(12, parseInt(e.target.value) || 28),
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

          {/* Subtitle Free Positioning (OffsetX / OffsetY) */}
          <div className="space-y-3 pt-2 border-t border-zinc-800">
            <div className="flex items-center justify-between">
              <span className="text-zinc-300 font-semibold text-[11px]">
                📍 Subtitle Free Position (စာတန်းထိုး လွတ်လပ်စွာ ရွှေ့ရန်):
              </span>
              <button
                type="button"
                onClick={() =>
                  setProject((prev) => ({
                    ...prev,
                    subtitleSettings: {
                      ...prev.subtitleSettings,
                      offsetX: 0,
                      offsetY: 0,
                    },
                  }))
                }
                className="px-2 py-0.5 text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition-colors"
              >
                Reset Position
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-400">Position X (ဘယ်/ညာ):</span>
                  <span className="font-mono text-cyan-400">{project.subtitleSettings.offsetX || 0}px</span>
                </div>
                <input
                  type="range"
                  min={-150}
                  max={150}
                  step={2}
                  value={project.subtitleSettings.offsetX || 0}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setProject((prev) => ({
                      ...prev,
                      subtitleSettings: { ...prev.subtitleSettings, offsetX: val },
                    }));
                  }}
                  className="w-full h-1 bg-zinc-800 rounded accent-cyan-400"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-400">Position Y (အပေါ်/အောက်):</span>
                  <span className="font-mono text-cyan-400">{project.subtitleSettings.offsetY || 0}px</span>
                </div>
                <input
                  type="range"
                  min={-250}
                  max={250}
                  step={2}
                  value={project.subtitleSettings.offsetY || 0}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    setProject((prev) => ({
                      ...prev,
                      subtitleSettings: { ...prev.subtitleSettings, offsetY: val },
                    }));
                  }}
                  className="w-full h-1 bg-zinc-800 rounded accent-cyan-400"
                />
              </div>
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
              Logo ပုံ မရှိသေးပါ
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
              <span className="font-bold text-amber-300 text-xs block font-display tracking-wide">
                Fine-Tune Nudge & Edit Studio
              </span>
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
                      <span>✓ Fixed ({currentSeg.startTime.toFixed(2)}s - {currentSeg.endTime.toFixed(2)}s)</span>
                    </span>
                  ) : (
                    <span className="text-zinc-400 font-mono truncate">
                      {currentSeg.startTime.toFixed(2)}s - {currentSeg.endTime.toFixed(2)}s
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
              Segment မရှိသေးပါ
            </div>
          )}
        </div>
      )}
    </div>
  );
};
