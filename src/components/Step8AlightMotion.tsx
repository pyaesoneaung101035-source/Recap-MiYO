import React, { useState } from 'react';
import {
  ArrowLeft,
  Download,
  Wand2,
  Check,
  ArrowRight,
  Sliders,
} from 'lucide-react';
import { ProjectState, TranscriptSegment } from '../types';
import { VideoPlayerView } from './VideoPlayerView';
import { AlightMotionTimeline } from './AlightMotionTimeline';
import { Step8AlightMotionSettings, AlightSettingsTab } from './Step8AlightMotionSettings';

interface Step8AlightMotionProps {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  onSeekTo: (time: number) => void;
  onPrevStep: () => void;
  onNextStep: () => void;
  onOpenExportModal: () => void;
}

export const Step8AlightMotion: React.FC<Step8AlightMotionProps> = ({
  project,
  setProject,
  onSeekTo,
  onPrevStep,
  onNextStep,
  onOpenExportModal,
}) => {
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    project.segments[0]?.id || null
  );
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(
    project.keyframes[0]?.id || null
  );
  const [isCatchUpModeActive, setIsCatchUpModeActive] = useState<boolean>(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<AlightSettingsTab>('audio_ttx');

  // Undo / Redo History Stack
  const [historyStack, setHistoryStack] = useState<TranscriptSegment[][]>([]);
  const [redoStack, setRedoStack] = useState<TranscriptSegment[][]>([]);

  const handlePushHistory = () => {
    setHistoryStack((prev) => [...prev, JSON.parse(JSON.stringify(project.segments))]);
    setRedoStack([]);
  };

  const handleUndo = () => {
    if (historyStack.length === 0) return;
    const previousSegments = historyStack[historyStack.length - 1];
    const newHistory = historyStack.slice(0, -1);
    setHistoryStack(newHistory);
    setRedoStack((prev) => [JSON.parse(JSON.stringify(project.segments)), ...prev]);
    setProject((prev) => ({ ...prev, segments: previousSegments }));
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const nextSegments = redoStack[0];
    const newRedo = redoStack.slice(1);
    setRedoStack(newRedo);
    setHistoryStack((prev) => [...prev, JSON.parse(JSON.stringify(project.segments))]);
    setProject((prev) => ({ ...prev, segments: nextSegments }));
  };

  const activeSegment: TranscriptSegment | null =
    project.segments.find(
      (s) => project.currentTime >= s.startTime && project.currentTime <= s.endTime
    ) || null;

  const selectedSegment =
    project.segments.find((s) => s.id === selectedSegmentId) ||
    project.segments[0] ||
    null;

  const handleCatchUpPlace = (targetTime: number) => {
    const targetId = selectedSegmentId || project.segments[0]?.id;
    if (!targetId) return;

    const seg = project.segments.find((s) => s.id === targetId);
    if (!seg || seg.isTimingFixed) return;

    handlePushHistory();

    const newStart = parseFloat(targetTime.toFixed(2));
    const dur = seg.audioDuration || (seg.endTime - seg.startTime) || 3;
    const newEnd = parseFloat((newStart + dur).toFixed(2));

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
  };

  return (
    <div className="space-y-6">
      {/* Glass Banner */}
      <div className="glass-panel rounded-2xl p-5 shadow-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-amber-400 text-zinc-950 flex items-center justify-center text-sm font-black font-mono shadow-lg shadow-amber-400/20">
            7
          </div>
          <div>
            <h2 className="text-base font-bold text-white font-display flex items-center gap-2">
              <span>Alight Motion Studio & Keyframes</span>
              <Wand2 className="w-4 h-4 text-amber-400" />
            </h2>
            <p className="text-xs text-zinc-400 font-myanmar mt-0.5">
              Catch-Up ချိန်ညှိမှုနှင့် Alight Motion Keyframe Animations (Scale, Shake, Rotate, Filter) တည်းဖြတ်ပါ။
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onPrevStep}
            className="px-3.5 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-semibold rounded-xl transition-all border border-white/10 flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>အဆင့် 6 သို့</span>
          </button>

          <button
            onClick={() => alert('Settings Saved!')}
            className="px-3.5 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-bold text-xs rounded-xl transition-all border border-emerald-500/30 flex items-center gap-1.5 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Save Settings</span>
          </button>

          <button
            onClick={onNextStep}
            className="px-5 py-2.5 bg-gradient-to-r from-amber-400 via-cyan-400 to-teal-400 hover:opacity-90 text-zinc-950 font-bold text-xs rounded-xl transition-all shadow-lg shadow-amber-500/20 flex items-center gap-2 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>အဆင့် 8 (Export MP4) သို့</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Custom Upload Video Viewport Only (No timeline under video) */}
        <div className="lg:col-span-5 space-y-4">
          <VideoPlayerView
            project={project}
            setProject={setProject}
            activeSegment={activeSegment}
            isCatchUpModeActive={isCatchUpModeActive}
            onCatchUpPlace={handleCatchUpPlace}
            selectedSegmentName={selectedSegment ? `Selected: #${project.segments.findIndex(s => s.id === selectedSegment.id) + 1} (${selectedSegment.voice})` : undefined}
          />
        </div>

        {/* RIGHT COLUMN: Alight Motion Editing & Audio/TTX Settings Panel with Edit Panel underneath */}
        <div className="lg:col-span-7 space-y-4">
          <Step8AlightMotionSettings
            project={project}
            setProject={setProject}
            selectedSegmentId={selectedSegmentId}
            setSelectedSegmentId={setSelectedSegmentId}
            selectedKeyframeId={selectedKeyframeId}
            setSelectedKeyframeId={setSelectedKeyframeId}
            isCatchUpModeActive={isCatchUpModeActive}
            setIsCatchUpModeActive={setIsCatchUpModeActive}
            onSeekTo={onSeekTo}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={historyStack.length > 0}
            canRedo={redoStack.length > 0}
            onPushHistory={handlePushHistory}
            activeTab={activeSettingsTab}
            onTabChange={setActiveSettingsTab}
          />

          {/* Edit Panel: appears directly underneath Alight Motion & Audio Settings Panel when Edit is clicked */}
          {activeSettingsTab === 'timeline_edit' && (
            <div className="space-y-2 border-2 border-amber-500/50 rounded-2xl p-1 bg-amber-500/5 shadow-2xl shadow-amber-500/10 transition-all">
              <div className="flex items-center justify-between px-3.5 py-2 bg-zinc-900/95 rounded-xl border border-amber-500/30 text-xs">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-amber-400 text-zinc-950 font-bold text-[10px]">
                    EDIT PANEL ACTIVE
                  </span>
                  <span className="font-semibold text-amber-300 font-myanmar">
                    🎬 Alight Motion Timeline & Keyframe Studio
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSettingsTab('audio_ttx')}
                  className="text-[11px] text-zinc-400 hover:text-white px-2.5 py-1 rounded-lg hover:bg-zinc-800 transition-colors flex items-center gap-1 cursor-pointer"
                  title="Close Edit Panel"
                >
                  <span>✕ ပိတ်မည် (Close Edit)</span>
                </button>
              </div>
              <AlightMotionTimeline
                project={project}
                setProject={setProject}
                onSeekTo={onSeekTo}
                selectedSegmentId={selectedSegmentId}
                onSelectSegment={(id) => setSelectedSegmentId(id)}
                selectedKeyframeId={selectedKeyframeId}
                onSelectKeyframe={(id) => setSelectedKeyframeId(id)}
                isCatchUpModeActive={isCatchUpModeActive}
                onCatchUpPlace={handleCatchUpPlace}
                onUndo={handleUndo}
                onRedo={handleRedo}
                canUndo={historyStack.length > 0}
                canRedo={redoStack.length > 0}
                onPushHistory={handlePushHistory}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
