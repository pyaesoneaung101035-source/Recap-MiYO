import React, { useState } from 'react';
import {
  Sliders,
  Scissors,
  Plus,
  Trash2,
  Sparkles,
  Zap,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Activity,
  Layers,
  Clock,
  Undo,
  Redo,
} from 'lucide-react';
import { ProjectState, AlightKeyframe, TranscriptSegment } from '../types';
import { getMotionPresets } from '../utils/alightMotionRenderer';

interface AlightMotionTimelineProps {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  onSeekTo: (time: number) => void;
  selectedSegmentId?: string | null;
  onSelectSegment?: (id: string | null) => void;
  selectedKeyframeId?: string | null;
  onSelectKeyframe?: (id: string | null) => void;
  isCatchUpModeActive?: boolean;
  onCatchUpPlace?: (time: number) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onPushHistory?: () => void;
}

export const AlightMotionTimeline: React.FC<AlightMotionTimelineProps> = ({
  project,
  setProject,
  onSeekTo,
  selectedSegmentId: propSelectedSegmentId,
  onSelectSegment,
  selectedKeyframeId: propSelectedKeyframeId,
  onSelectKeyframe,
  isCatchUpModeActive = false,
  onCatchUpPlace,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onPushHistory,
}) => {
  const [timelineZoom, setTimelineZoom] = useState<number>(1); // 1 = normal, 2 = 2x, etc.
  const [internalKeyframeId, setInternalKeyframeId] = useState<string | null>(null);
  const [internalSegmentId, setInternalSegmentId] = useState<string | null>(null);

  const selectedKeyframeId = propSelectedKeyframeId !== undefined ? propSelectedKeyframeId : internalKeyframeId;
  const setSelectedKeyframeId = onSelectKeyframe || setInternalKeyframeId;

  const selectedSegmentId = propSelectedSegmentId !== undefined ? propSelectedSegmentId : internalSegmentId;
  const setSelectedSegmentId = onSelectSegment || setInternalSegmentId;

  const duration = Math.max(project.videoDuration || 30, 20);
  const pxPerSecond = 30 * timelineZoom;
  const totalWidth = duration * pxPerSecond;

  // Add keyframe at current playhead time
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

  const handleDeleteKeyframe = (id: string) => {
    setProject((prev) => ({
      ...prev,
      keyframes: prev.keyframes.filter((k) => k.id !== id),
    }));
    if (selectedKeyframeId === id) setSelectedKeyframeId(null);
  };

  const handleUpdateKeyframe = (id: string, updates: Partial<AlightKeyframe>) => {
    setProject((prev) => ({
      ...prev,
      keyframes: prev.keyframes.map((k) => (k.id === id ? { ...k, ...updates } : k)),
    }));
  };

  // Video Split Tool: splits the active transcript segment at current playhead
  const handleSplitSegment = () => {
    const t = project.currentTime;
    const targetIdx = project.segments.findIndex((s) => t > s.startTime && t < s.endTime);
    if (targetIdx === -1) return;

    onPushHistory?.();

    const target = project.segments[targetIdx];
    const seg1: TranscriptSegment = {
      ...target,
      endTime: parseFloat(t.toFixed(2)),
    };
    const seg2: TranscriptSegment = {
      id: 'seg_' + Date.now(),
      startTime: parseFloat((t + 0.1).toFixed(2)),
      endTime: target.endTime,
      originalText: target.originalText + ' (Part 2)',
      myanmarTranslation: target.myanmarTranslation + ' (အပိုင်း ၂)',
      voice: target.voice,
    };

    const newSegments = [...project.segments];
    newSegments.splice(targetIdx, 1, seg1, seg2);
    setProject((prev) => ({ ...prev, segments: newSegments }));
  };

  // Fine-Tune Nudge (Moved from Audio & TTX panel into Edit Panel)
  const handleNudgeSegment = (deltaSeconds: number) => {
    const targetId = selectedSegmentId || project.segments[0]?.id;
    if (!targetId) return;
    const targetSeg = project.segments.find((s) => s.id === targetId);
    if (!targetSeg) return;

    onPushHistory?.();
    const newStart = Math.max(0, parseFloat((targetSeg.startTime + deltaSeconds).toFixed(2)));
    const segDuration = targetSeg.audioDuration || (targetSeg.endTime - targetSeg.startTime) || 3;
    const newEnd = parseFloat((newStart + segDuration).toFixed(2));

    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) =>
        s.id === targetId
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

  const selectedKf = project.keyframes.find((k) => k.id === selectedKeyframeId);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-xl space-y-5">
      {/* Header and Presets Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              အဆင့် 7 & 8: Alight Motion Timeline & Smart Sync Precision
            </h2>
          </div>
          <p className="text-xs text-zinc-400 font-myanmar mt-0.5">
            Keyframe Animations (Scale, Shake, Pan, Glow) ဖြင့် ဗီဒီယို၊ မြန်မာစာတန်းထိုးနှင့် အသံကို ကွက်တိနေရာချခြင်း
          </p>
        </div>

        {/* Motion Presets */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleApplyPreset('smoothZoom')}
            className="px-2.5 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg transition-colors flex items-center gap-1"
            title="Add Smooth Zoom Keyframes"
          >
            <ZoomIn className="w-3 h-3 text-cyan-400" />
            <span>Smooth Zoom</span>
          </button>

          <button
            onClick={() => handleApplyPreset('impactShake')}
            className="px-2.5 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg transition-colors flex items-center gap-1"
            title="Add Camera Shake Keyframes"
          >
            <Activity className="w-3 h-3 text-rose-400" />
            <span>Impact Shake</span>
          </button>

          <button
            onClick={() => handleApplyPreset('dhammaAura')}
            className="px-2.5 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg transition-colors flex items-center gap-1"
            title="Add Dhamma Serene Gold Glow"
          >
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>Dhamma Aura</span>
          </button>

          <button
            onClick={handleAddKeyframe}
            className="px-3 py-1 text-xs font-medium bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-lg transition-colors flex items-center gap-1 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Keyframe</span>
          </button>

          <button
            onClick={handleSplitSegment}
            className="px-2.5 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors flex items-center gap-1"
            title="Split active segment at current time"
          >
            <Scissors className="w-3 h-3" />
            <span>Split Clip</span>
          </button>
        </div>
      </div>

      {/* USER REQUESTED FEATURE: PROMINENT UNDO & REDO BUTTONS FOR TTX & VOICE CLONE TIMELINE */}
      <div className="flex items-center justify-between px-3.5 py-2 bg-zinc-950/90 rounded-xl border border-cyan-800/60 shadow-lg text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-cyan-300 font-myanmar flex items-center gap-1.5">
            <span>↩️ Undo / ↪️ Redo Controls (TTX & Voice Clone Timeline တည်းဖြတ်မှု ပြန်ပြင်ရန်)</span>
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
              canUndo
                ? 'bg-cyan-500 hover:bg-cyan-400 text-zinc-950 cursor-pointer shadow-md shadow-cyan-500/20 active:scale-95'
                : 'bg-zinc-800/80 text-zinc-500 cursor-not-allowed border border-zinc-700/50'
            }`}
            title="Undo last edit (တစ်ခုချင်း နောက်ပြန်သွားမည်)"
          >
            <Undo className="w-3.5 h-3.5" />
            <span>↩️ Undo</span>
          </button>

          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
              canRedo
                ? 'bg-amber-500 hover:bg-amber-400 text-zinc-950 cursor-pointer shadow-md shadow-amber-500/20 active:scale-95'
                : 'bg-zinc-800/80 text-zinc-500 cursor-not-allowed border border-zinc-700/50'
            }`}
            title="Redo next edit (တစ်ခုချင်း ရှေ့သို့ပြန်သွားမည်)"
          >
            <Redo className="w-3.5 h-3.5" />
            <span>↪️ Redo</span>
          </button>
        </div>
      </div>

      {/* Fine-Tune Nudge (Moved from Audio & TTX Panel into Edit Panel) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-xl bg-zinc-950/90 border border-zinc-800 shadow-md">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0"></span>
          <span className="font-semibold text-xs text-zinc-200 font-myanmar">
            Fine-Tune Nudge (စာသား & အသံ ရှေ့တိုး/နောက်ဆုတ် ချိန်ညှိရန်):
          </span>
          <span className="text-[11px] text-cyan-300 font-mono">
            {project.segments.find((s) => s.id === selectedSegmentId)
              ? `(#${project.segments.findIndex((s) => s.id === selectedSegmentId) + 1}: ${project.segments.find((s) => s.id === selectedSegmentId)?.startTime.toFixed(2)}s)`
              : ''}
          </span>
        </div>

        <div className="grid grid-cols-6 gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => handleNudgeSegment(-1.0)}
            className="py-1 px-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-center font-mono text-xs transition-colors cursor-pointer"
            title="Nudge back 1 second"
          >
            -1.0s
          </button>
          <button
            type="button"
            onClick={() => handleNudgeSegment(-0.5)}
            className="py-1 px-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-center font-mono text-xs transition-colors cursor-pointer"
            title="Nudge back 0.5s"
          >
            -0.5s
          </button>
          <button
            type="button"
            onClick={() => handleNudgeSegment(-0.1)}
            className="py-1 px-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-center font-mono text-xs transition-colors cursor-pointer"
            title="Nudge back 0.1s"
          >
            -0.1s
          </button>
          <button
            type="button"
            onClick={() => handleNudgeSegment(0.1)}
            className="py-1 px-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-cyan-300 text-center font-mono text-xs transition-colors cursor-pointer"
            title="Nudge forward 0.1s"
          >
            +0.1s
          </button>
          <button
            type="button"
            onClick={() => handleNudgeSegment(0.5)}
            className="py-1 px-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-cyan-300 text-center font-mono text-xs transition-colors cursor-pointer"
            title="Nudge forward 0.5s"
          >
            +0.5s
          </button>
          <button
            type="button"
            onClick={() => handleNudgeSegment(1.0)}
            className="py-1 px-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-cyan-300 text-center font-mono text-xs transition-colors cursor-pointer"
            title="Nudge forward 1s"
          >
            +1.0s
          </button>
        </div>
      </div>

      {/* Timeline Controls (Zoom & Time) */}
      <div className="flex items-center justify-between text-xs px-2 py-1 bg-zinc-950/70 border border-zinc-800/80 rounded-lg">
        <div className="flex items-center gap-3">
          <span className="text-zinc-400 font-mono-num flex items-center gap-1">
            <Clock className="w-3 h-3 text-cyan-400" />
            Playhead: <strong className="text-zinc-200">{project.currentTime.toFixed(2)}s</strong>
          </span>
          <span className="text-zinc-600">|</span>
          <span className="text-zinc-400 font-mono-num">
            Duration: <strong className="text-zinc-200">{duration.toFixed(1)}s</strong>
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-500">Timeline Zoom:</span>
          <button
            onClick={() => setTimelineZoom((prev) => Math.max(0.5, prev - 0.25))}
            className="p-1 text-zinc-400 hover:text-zinc-200"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono-num text-zinc-300 text-[11px] w-8 text-center">{timelineZoom}x</span>
          <button
            onClick={() => setTimelineZoom((prev) => Math.min(3, prev + 0.25))}
            className="p-1 text-zinc-400 hover:text-zinc-200"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Multi-Track Timeline Canvas Area */}
      <div className="border border-zinc-800 rounded-xl overflow-x-auto bg-zinc-950/80 relative">
        <div
          className="relative min-w-full"
          style={{ width: `${Math.max(totalWidth, 800)}px`, height: '220px' }}
        >
          {/* Ruler Marks */}
          <div className="h-6 border-b border-zinc-800 flex items-center bg-zinc-900/60 sticky top-0 z-10 select-none">
            {Array.from({ length: Math.ceil(duration) + 1 }).map((_, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 border-l border-zinc-700/40 text-[10px] font-mono-num text-zinc-500 pl-1 pt-0.5 cursor-pointer"
                style={{ left: `${i * pxPerSecond}px` }}
                onClick={() => {
                  onSeekTo(i);
                  if (isCatchUpModeActive && onCatchUpPlace) {
                    onCatchUpPlace(i);
                  }
                }}
              >
                {i % 2 === 0 ? `${i}s` : ''}
              </div>
            ))}
          </div>

          {/* Vertical Playhead Cursor */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 z-30 pointer-events-none shadow-sm shadow-cyan-400"
            style={{ left: `${project.currentTime * pxPerSecond}px` }}
          >
            <div className="w-2.5 h-2.5 bg-cyan-400 -ml-1 -mt-1 rounded-full shadow" />
          </div>

          {/* TRACK 1: Video Track */}
          <div className="h-10 border-b border-zinc-800/80 relative flex items-center px-2 bg-zinc-900/20">
            <div className="absolute left-2 text-[10px] uppercase font-semibold text-zinc-500 tracking-wider z-10 pointer-events-none">
              Track 1: Video (Smart Sync 1.25x Frame Lock)
            </div>
            <div
              className="absolute top-1 bottom-1 rounded bg-zinc-800 border border-zinc-700 flex items-center px-3 text-xs text-zinc-300 font-mono-num truncate cursor-pointer hover:border-cyan-500/50"
              style={{
                left: 0,
                width: `${duration * pxPerSecond}px`,
              }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const clickedTime = parseFloat((clickX / pxPerSecond).toFixed(2));
                onSeekTo(clickedTime);
                if (isCatchUpModeActive && onCatchUpPlace) {
                  onCatchUpPlace(clickedTime);
                }
              }}
            >
              <span>{project.videoName || 'Source Video'}</span>
            </div>
          </div>

          {/* TRACK 2: Cloned Voice Track */}
          <div className="h-12 border-b border-zinc-800/80 relative flex items-center bg-zinc-900/10">
            <div className="absolute left-2 text-[10px] uppercase font-semibold text-emerald-500/70 tracking-wider z-10 pointer-events-none">
              Track 2: Voice Clone (Thiha & Nilar)
            </div>
            {project.segments.map((seg) => {
              const segLeft = seg.startTime * pxPerSecond;
              const segSpeed = seg.playbackRate || project.voicePlaybackRate || 1.0;
              const effectiveAudioDuration = seg.audioDuration ? (seg.audioDuration / segSpeed) : (seg.endTime - seg.startTime);
              const segWidth = Math.max(20, effectiveAudioDuration * pxPerSecond);
              const hasAudio = !!seg.audioUrl;
              const isSelected = selectedSegmentId === seg.id;

              return (
                <div
                  key={`audio_${seg.id}`}
                  onClick={() => {
                    setSelectedSegmentId(seg.id);
                    setSelectedKeyframeId(null);
                    onSeekTo(seg.startTime);
                  }}
                  className={`absolute top-1.5 bottom-1.5 rounded border px-2 flex items-center text-[11px] truncate cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-emerald-900 border-white text-white ring-2 ring-emerald-400 z-10 shadow-lg'
                      : hasAudio
                      ? 'bg-emerald-950/60 border-emerald-600/70 text-emerald-300 hover:bg-emerald-900/60'
                      : 'bg-zinc-800/60 border-dashed border-zinc-700 text-zinc-500'
                  }`}
                  style={{
                    left: `${segLeft}px`,
                    width: `${segWidth}px`,
                  }}
                  title={`Voice Clip: ${seg.myanmarTranslation} | Speed: ${segSpeed.toFixed(2)}x (Click to Edit)`}
                >
                  <span className="font-myanmar truncate flex items-center gap-1">
                    {seg.isTimingFixed && <span className="text-emerald-300 font-bold">📌</span>}
                    {hasAudio ? (
                      <>
                        <span>🔊 {seg.voice}</span>
                        <span className="font-mono text-[9px] px-1 py-0.2 bg-emerald-950 text-emerald-300 rounded border border-emerald-800/50">
                          {segSpeed.toFixed(2)}x
                        </span>
                        <span className="truncate">: {seg.myanmarTranslation}</span>
                      </>
                    ) : (
                      `(Pending: ${seg.voice})`
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          {/* TRACK 3: Subtitle Track */}
          <div className="h-12 border-b border-zinc-800/80 relative flex items-center bg-zinc-900/20">
            <div className="absolute left-2 text-[10px] uppercase font-semibold text-cyan-500/70 tracking-wider z-10 pointer-events-none">
              Track 3: Myanmar Subtitles
            </div>
            {project.segments.map((seg) => {
              const segLeft = seg.startTime * pxPerSecond;
              const segWidth = Math.max(20, (seg.endTime - seg.startTime) * pxPerSecond);
              const isActive = project.currentTime >= seg.startTime && project.currentTime <= seg.endTime;
              const isSelected = selectedSegmentId === seg.id;

              return (
                <div
                  key={`sub_${seg.id}`}
                  onClick={() => {
                    setSelectedSegmentId(seg.id);
                    setSelectedKeyframeId(null);
                    onSeekTo(seg.startTime);
                  }}
                  className={`absolute top-1.5 bottom-1.5 rounded border px-2 flex items-center text-[11px] truncate cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-cyan-900 border-white text-white ring-2 ring-cyan-400 z-10 shadow-lg'
                      : isActive
                      ? 'bg-cyan-950/80 border-cyan-400 text-cyan-200 ring-1 ring-cyan-400'
                      : 'bg-zinc-900 border-zinc-700/80 text-zinc-300 hover:border-zinc-500'
                  }`}
                  style={{
                    left: `${segLeft}px`,
                    width: `${segWidth}px`,
                  }}
                  title="Click to Edit Subtitle & Timestamps"
                >
                  <span className="font-myanmar truncate">
                    {seg.isTimingFixed && <span className="mr-1 text-cyan-300 font-bold">📌</span>}
                    {seg.myanmarTranslation}
                  </span>
                </div>
              );
            })}
          </div>

          {/* TRACK 4: Alight Motion Keyframe FX Track */}
          <div className="h-12 relative flex items-center bg-zinc-900/10">
            <div className="absolute left-2 text-[10px] uppercase font-semibold text-amber-500/70 tracking-wider z-10 pointer-events-none">
              Track 4: Alight Keyframe FX
            </div>
            {project.keyframes.map((kf) => {
              const kfLeft = kf.time * pxPerSecond;
              const isSelected = kf.id === selectedKeyframeId;

              return (
                <div
                  key={kf.id}
                  onClick={() => {
                    setSelectedKeyframeId(kf.id);
                    onSeekTo(kf.time);
                  }}
                  className={`absolute top-2 w-7 h-7 -ml-3.5 rotate-45 rounded-sm border cursor-pointer flex items-center justify-center transition-all ${
                    isSelected
                      ? 'bg-amber-400 border-white text-zinc-950 shadow-lg scale-110 z-20'
                      : 'bg-amber-950/70 border-amber-500/70 text-amber-300 hover:scale-105'
                  }`}
                  style={{ left: `${kfLeft}px` }}
                  title={`Keyframe at ${kf.time}s | Scale: ${kf.scale}x`}
                >
                  <span className="-rotate-45 text-[9px] font-bold font-mono">◆</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Selected Keyframe Inspector & Editor */}
      {selectedKf && (
        <div className="p-4 rounded-xl bg-zinc-950/80 border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
              <span>◆ Keyframe Properties ({selectedKf.time.toFixed(2)}s)</span>
            </span>
            <button
              onClick={() => handleDeleteKeyframe(selectedKf.id)}
              className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Keyframe</span>
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            {/* Scale */}
            <div className="space-y-1">
              <div className="flex justify-between text-zinc-400">
                <span>Scale (အနီးအဝေး):</span>
                <span className="font-mono-num text-zinc-200">{selectedKf.scale.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min={0.8}
                max={2.0}
                step={0.05}
                value={selectedKf.scale}
                onChange={(e) => handleUpdateKeyframe(selectedKf.id, { scale: parseFloat(e.target.value) })}
                className="w-full h-1.5 bg-zinc-800 rounded accent-amber-400"
              />
            </div>

            {/* Rotation */}
            <div className="space-y-1">
              <div className="flex justify-between text-zinc-400">
                <span>Rotation (အလှည့်ဒီဂရီ):</span>
                <span className="font-mono-num text-zinc-200">{selectedKf.rotation}°</span>
              </div>
              <input
                type="range"
                min={-180}
                max={180}
                step={5}
                value={selectedKf.rotation}
                onChange={(e) => handleUpdateKeyframe(selectedKf.id, { rotation: parseInt(e.target.value) })}
                className="w-full h-1.5 bg-zinc-800 rounded accent-amber-400"
              />
            </div>

            {/* Shake */}
            <div className="space-y-1">
              <div className="flex justify-between text-zinc-400">
                <span>Camera Shake (တုန်ခါမှု):</span>
                <span className="font-mono-num text-zinc-200">{selectedKf.shakeIntensity}</span>
              </div>
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={selectedKf.shakeIntensity}
                onChange={(e) => handleUpdateKeyframe(selectedKf.id, { shakeIntensity: parseInt(e.target.value) })}
                className="w-full h-1.5 bg-zinc-800 rounded accent-amber-400"
              />
            </div>

            {/* Filter */}
            <div className="space-y-1">
              <div className="flex justify-between text-zinc-400">
                <span>Color Grade (အရောင်စစ်):</span>
              </div>
              <select
                value={selectedKf.filter}
                onChange={(e) => handleUpdateKeyframe(selectedKf.id, { filter: e.target.value as any })}
                className="w-full px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-200 focus:outline-none"
              >
                <option value="none">Normal (မူလ)</option>
                <option value="cinematic">Cinematic Grade</option>
                <option value="warm">Warm Film Tone</option>
                <option value="vintage">Vintage Sepia</option>
                <option value="cyber">Cyberpunk Hue</option>
                <option value="dhamma_gold">Dhamma Serene Gold</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Selected Segment / Clip Inspector & Editor */}
      {(() => {
        const selectedSeg = project.segments.find((s) => s.id === selectedSegmentId);
        if (!selectedSeg) return null;

        return (
          <div className="p-4 rounded-xl bg-zinc-950/90 border border-cyan-800/60 space-y-3 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-cyan-300 flex items-center gap-1.5">
                <span>✏️ Edit Clip & Subtitle ({selectedSeg.startTime.toFixed(1)}s - {selectedSeg.endTime.toFixed(1)}s)</span>
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onUndo}
                  disabled={!canUndo}
                  className={`px-2 py-0.5 text-[11px] font-bold rounded transition-all flex items-center gap-1 ${
                    canUndo
                      ? 'bg-cyan-500 hover:bg-cyan-400 text-zinc-950 cursor-pointer shadow-sm active:scale-95'
                      : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                  }`}
                  title="Undo Edit"
                >
                  <Undo className="w-3 h-3" />
                  <span>Undo</span>
                </button>

                <button
                  type="button"
                  onClick={onRedo}
                  disabled={!canRedo}
                  className={`px-2 py-0.5 text-[11px] font-bold rounded transition-all flex items-center gap-1 ${
                    canRedo
                      ? 'bg-amber-500 hover:bg-amber-400 text-zinc-950 cursor-pointer shadow-sm active:scale-95'
                      : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                  }`}
                  title="Redo Edit"
                >
                  <Redo className="w-3 h-3" />
                  <span>Redo</span>
                </button>

                <button
                  onClick={() => {
                    onPushHistory?.();
                    setProject((prev) => ({
                      ...prev,
                      segments: prev.segments.filter((s) => s.id !== selectedSeg.id),
                    }));
                    setSelectedSegmentId(null);
                  }}
                  className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 ml-2"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Clip</span>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <textarea
                rows={2}
                value={selectedSeg.myanmarTranslation}
                onChange={(e) => {
                  const val = e.target.value;
                  setProject((prev) => ({
                    ...prev,
                    segments: prev.segments.map((s) =>
                      s.id === selectedSeg.id ? { ...s, myanmarTranslation: val } : s
                    ),
                  }));
                }}
                placeholder="မြန်မာစာတန်းထိုး ပြင်ဆင်ရန်..."
                className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs font-myanmar text-zinc-100 focus:outline-none focus:border-cyan-400"
              />

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="space-y-1">
                  <span className="text-zinc-400">Start Time (စတင်ချိန်):</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step={0.1}
                      value={selectedSeg.startTime}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setProject((prev) => ({
                          ...prev,
                          segments: prev.segments.map((s) =>
                            s.id === selectedSeg.id ? { ...s, startTime: val } : s
                          ),
                        }));
                      }}
                      className="w-full px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs font-mono-num text-zinc-200"
                    />
                    <button
                      onClick={() => onSeekTo(selectedSeg.startTime)}
                      className="px-2 py-1 rounded bg-zinc-800 text-cyan-400 font-mono text-[11px]"
                      title="Seek video to start"
                    >
                      ▶
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-zinc-400">End Time (ပြီးဆုံးချိန်):</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step={0.1}
                      value={selectedSeg.endTime}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        setProject((prev) => ({
                          ...prev,
                          segments: prev.segments.map((s) =>
                            s.id === selectedSeg.id ? { ...s, endTime: val } : s
                          ),
                        }));
                      }}
                      className="w-full px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs font-mono-num text-zinc-200"
                    />
                    <button
                      onClick={() => onSeekTo(selectedSeg.endTime)}
                      className="px-2 py-1 rounded bg-zinc-800 text-cyan-400 font-mono text-[11px]"
                      title="Seek video to end"
                    >
                      ▶
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-zinc-400">Voice Actor:</span>
                  <select
                    value={selectedSeg.voice}
                    onChange={(e) => {
                      const v = e.target.value as 'Thiha' | 'Nilar';
                      setProject((prev) => ({
                        ...prev,
                        segments: prev.segments.map((s) =>
                          s.id === selectedSeg.id ? { ...s, voice: v } : s
                        ),
                      }));
                    }}
                    className="w-full px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs text-emerald-300"
                  >
                    <option value="Thiha">Thiha (ကျား)</option>
                    <option value="Nilar">Nilar (မ)</option>
                  </select>
                </div>

                <div className="flex items-end gap-1.5">
                  <button
                    onClick={() => {
                      setProject((prev) => ({
                        ...prev,
                        segments: prev.segments.map((s) =>
                          s.id === selectedSeg.id
                            ? { ...s, startTime: parseFloat(project.currentTime.toFixed(2)) }
                            : s
                        ),
                      }));
                    }}
                    className="px-2 py-1 text-[10px] bg-zinc-800 hover:bg-zinc-700 text-cyan-300 rounded transition-colors"
                    title="Snap start time to current playhead"
                  >
                    Set Start to Playhead
                  </button>
                  <button
                    onClick={() => {
                      setProject((prev) => ({
                        ...prev,
                        segments: prev.segments.map((s) =>
                          s.id === selectedSeg.id
                            ? { ...s, endTime: parseFloat(project.currentTime.toFixed(2)) }
                            : s
                        ),
                      }));
                    }}
                    className="px-2 py-1 text-[10px] bg-zinc-800 hover:bg-zinc-700 text-cyan-300 rounded transition-colors"
                    title="Snap end time to current playhead"
                  >
                    Set End to Playhead
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
