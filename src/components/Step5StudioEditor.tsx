import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  FilePlus,
  FolderOpen,
  Save,
  Undo2,
  Redo2,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Mic,
  Type,
  Sparkles,
  Scissors,
  Copy,
  Trash2,
  Plus,
  PlusSquare,
  AlignJustify,
  ZoomOut,
  ZoomIn,
  Film,
  Music,
  Eye,
  EyeOff,
  Clapperboard,
  Check,
  Home,
  Settings,
  CheckCircle2,
  Zap,
  Heart,
  ArrowLeft,
  ArrowRight,
  Volume1,
  Wand2,
  ChevronUp,
  ChevronDown,
  Layers,
  Sliders,
  Layout,
  RotateCcw,
  Sparkles as SparklesIcon,
} from 'lucide-react';
import {
  ProjectState,
  TranscriptSegment,
  VoiceOption,
  Step3ScriptStyle,
  AlightKeyframe,
} from '../types';
import {
  findActiveSegmentForTime,
  realignSegmentsByMinuteBlocks,
  getMinuteBlocks,
  formatMinSec,
} from '../utils/timingSync';
import { inspectVideoFile } from '../utils/audioExtractor';
import { getInterpolatedKeyframe, getFilterCss } from '../utils/alightMotionRenderer';
import { stopAllPreviewAudio } from '../utils/audioPreviewManager';
import { UnifiedAudioMixer } from '../utils/audioMixerEngine';
import { Step8AlightMotionSettings } from './Step8AlightMotionSettings';
import { InteractiveBlurBox, InteractiveSubtitleOverlay } from './VideoPlayerView';

const DEMO_SCENE_SRC = '/src/assets/images/demo_scene_preview_1794717191923.jpg';

interface Step5StudioEditorProps {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  onSeekTo: (time: number) => void;
  onPrevStep: () => void;
  onNextStep: () => void;
  onJumpToStep: (step: number) => void;
  onOpenKeysModal: () => void;
  onOpenExportModal?: () => void;
}

const STEP5_DEMO_SUBTITLES: TranscriptSegment[] = [
  {
    id: 'step5_demo_1',
    startTime: 2.0,
    endTime: 48.0,
    originalText: '在这个世界上，你并不是孤单一人。',
    myanmarTranslation: 'ဒီကမ္ဘာမှာ မင်းတစ်ယောက်တည်းမဟုတ်ပါဘူး။',
    subtitleText: 'ဒီကမ္ဘာမှာ မင်းတစ်ယောက်တည်းမဟုတ်ပါဘူး။',
    voice: 'Thiha',
    speaker: 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
    scriptStyle: 'narrator',
  },
  {
    id: 'step5_demo_2',
    startTime: 56.0,
    endTime: 102.0,
    originalText: '我们将一起面对前方的所有危险。',
    myanmarTranslation: 'အန္တရာယ်တွေကို ရင်ဆိုင်ရမယ်။',
    subtitleText: 'အန္တရာယ်တွေကို ရင်ဆိုင်ရမယ်။',
    voice: 'Thiha',
    speaker: 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
    scriptStyle: 'narrator',
  },
  {
    id: 'step5_demo_3',
    startTime: 112.0,
    endTime: 155.0,
    originalText: '只要坚持下去，我们一定能取得胜利。',
    myanmarTranslation: 'အောင်မြင်မှုကို ရယူရမယ်။',
    subtitleText: 'အောင်မြင်မှုကို ရယူရမယ်။',
    voice: 'Thiha',
    speaker: 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
    scriptStyle: 'narrator',
  },
];

const formatFullTimecode = (sec: number): string => {
  const safe = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.floor((safe % 1) * 1000);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};

const formatRulerTick = (sec: number): string => {
  const mins = Math.floor(sec / 60);
  const secs = Math.floor(sec % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const VideoFilmstripTrack = React.memo(({ thumbnails }: { thumbnails: string[] }) => (
  <div className="w-full h-full rounded overflow-hidden border border-[#2F2D46] grid grid-cols-12 bg-black">
    {Array.from({ length: 12 }).map((_, i) => (
      <img
        key={i}
        src={thumbnails[i] || DEMO_SCENE_SRC}
        alt=""
        referrerPolicy="no-referrer"
        className="w-full h-full object-cover border-r border-black/40 last:border-r-0 pointer-events-none"
      />
    ))}
  </div>
));

const BgmWaveformTrack = React.memo(({ bars }: { bars: number[] }) => (
  <div className="w-full h-full rounded bg-emerald-950/35 border border-emerald-500/25 px-1 flex items-center justify-between gap-[1px] pointer-events-none">
    {bars.map((h, i) => (
      <span
        key={i}
        style={{ height: `${h}%` }}
        className="flex-1 bg-gradient-to-b from-emerald-300 via-emerald-500 to-teal-500 rounded-full opacity-90"
      />
    ))}
  </div>
));

const VoiceCloneClipBars = React.memo(({ bars, clipIndex }: { bars: number[]; clipIndex: number }) => (
  <div className="flex-1 h-full flex items-center justify-between gap-[1px] pointer-events-none opacity-85">
    {bars.slice(0, 28).map((h, bIdx) => (
      <span
        key={bIdx}
        style={{ height: `${Math.max(20, ((h + clipIndex * 17) % 85) + 12)}%` }}
        className="flex-1 bg-gradient-to-b from-cyan-300 via-indigo-400 to-violet-500 rounded-full"
      />
    ))}
  </div>
));

export const Step5StudioEditor: React.FC<Step5StudioEditorProps> = ({
  project,
  setProject,
  onSeekTo,
  onPrevStep,
  onNextStep,
  onJumpToStep,
  onOpenKeysModal,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const audioMixerRef = useRef<UnifiedAudioMixer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTimeUpdateMsRef = useRef<number>(0);

  const getMixer = () => {
    if (!audioMixerRef.current) {
      audioMixerRef.current = new UnifiedAudioMixer();
    }
    return audioMixerRef.current;
  };

  useEffect(() => {
    return () => {
      audioMixerRef.current?.dispose();
      audioMixerRef.current = null;
    };
  }, []);

  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    project.segments[0]?.id || null
  );
  const [editingSegId, setEditingSegId] = useState<string | null>(null);
  const [editingSubText, setEditingSubText] = useState('');
  const [statusMessage, setStatusMessage] = useState('Ready to edit · Recap-MiYO v2.0');

  const [trackVisible, setTrackVisible] = useState({
    video: true,
    bgm: true,
    narrator: true,
    subtitle: true,
  });
  const [timelineZoom, setTimelineZoom] = useState<number>(1);
  const [videoThumbnails, setVideoThumbnails] = useState<string[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<{
    segId: string;
    track: 'voice' | 'subtitle';
  } | null>(null);
  const sliderHistorySavedRef = useRef<boolean>(false);
  const [isProPanelOpen, setIsProPanelOpen] = useState(false);
  const [isBlurPanelOpen, setIsBlurPanelOpen] = useState(false);

  const handleAddBlurBox = () => {
    pushHistory();
    const newBox = {
      id: 'blur_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      x: 20,
      y: 68,
      width: 60,
      height: 14,
      blurAmount: 24,
      name: `Blur #${(project.blurBoxes?.length || 0) + 1}`,
    };
    setProject((prev) => ({
      ...prev,
      blurBoxes: [...(prev.blurBoxes || []), newBox],
    }));
  };

  const handleUpdateBlurBox = (id: string, updates: Partial<any>) => {
    setProject((prev) => ({
      ...prev,
      blurBoxes: (prev.blurBoxes || []).map((b) => (b.id === id ? { ...b, ...updates } : b)),
    }));
  };

  const handleDeleteBlurBox = (id: string) => {
    pushHistory();
    setProject((prev) => ({
      ...prev,
      blurBoxes: (prev.blurBoxes || []).filter((b) => b.id !== id),
    }));
  };

  // Local Undo / Redo Stacks
  const [undoStack, setUndoStack] = useState<{ segments: TranscriptSegment[]; keyframes: AlightKeyframe[] }[]>([]);
  const [redoStack, setRedoStack] = useState<{ segments: TranscriptSegment[]; keyframes: AlightKeyframe[] }[]>([]);

  const pushHistory = () => {
    setUndoStack((prev) => [
      ...prev.slice(-19),
      { segments: project.segments, keyframes: project.keyframes },
    ]);
    setRedoStack([]);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const prevSnap = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, { segments: project.segments, keyframes: project.keyframes }]);
    setUndoStack((u) => u.slice(0, -1));
    setProject((prev) => ({
      ...prev,
      segments: prevSnap.segments,
      keyframes: prevSnap.keyframes,
    }));
    setStatusMessage('Undo applied');
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const nextSnap = redoStack[redoStack.length - 1];
    setUndoStack((u) => [...u, { segments: project.segments, keyframes: project.keyframes }]);
    setRedoStack((r) => r.slice(0, -1));
    setProject((prev) => ({
      ...prev,
      segments: nextSnap.segments,
      keyframes: nextSnap.keyframes,
    }));
    setStatusMessage('Redo applied');
  };

  const lockedVoice: VoiceOption = project.lockedVoice || 'Thiha';
  const voiceSpeed = project.voicePlaybackRate || 1.0;
  const scriptStyle: Step3ScriptStyle = project.step3ScriptStyle || 'narrator';

  const displaySegments = project.segments.length > 0 ? project.segments : STEP5_DEMO_SUBTITLES;
  const totalDuration = Math.max(project.videoDuration || 165, 30);

  const hasAutoEnabledBgmRef = useRef<boolean>(false);
  const isBgmActive = Boolean(
    project.extractedBgmUrl &&
    trackVisible.bgm &&
    project.useExtractedBgm !== false
  );
  const hasClonedAudio = project.segments.some((s) => Boolean(s.audioUrl));
  const shouldMuteOrig = true;

  // Auto-activate extracted BGM once when entering Step 5 if an extracted BGM MP3 is available
  useEffect(() => {
    if (project.extractedBgmUrl && !hasAutoEnabledBgmRef.current) {
      hasAutoEnabledBgmRef.current = true;
      if (!project.useExtractedBgm || !project.bgmVolume || project.bgmVolume <= 0) {
        setProject((prev) => ({
          ...prev,
          useExtractedBgm: true,
          bgmVolume: prev.bgmVolume && prev.bgmVolume > 0 ? prev.bgmVolume : 0.65,
        }));
      }
    }
  }, [project.extractedBgmUrl, project.useExtractedBgm, project.bgmVolume, setProject]);

  const activeSegment: TranscriptSegment | null = useMemo(() => {
    const match = findActiveSegmentForTime(
      displaySegments,
      project.currentTime,
      voiceSpeed,
      false
    );
    return (
      match?.segment ||
      displaySegments.find(
        (s) => project.currentTime >= s.startTime && project.currentTime <= s.endTime
      ) ||
      null
    );
  }, [displaySegments, project.currentTime, voiceSpeed]);

  const activeSubtitleSegment: TranscriptSegment | null = useMemo(() => {
    return (
      displaySegments.find((s) => {
        const subS = s.subtitleStartTime ?? s.startTime;
        const subE = s.subtitleEndTime ?? s.endTime;
        return project.currentTime >= subS && project.currentTime <= subE;
      }) || null
    );
  }, [displaySegments, project.currentTime]);

  // Smooth demo playback ticker when no real video loaded
  useEffect(() => {
    if (!project.isPlaying || project.videoUrl) return;
    const interval = setInterval(() => {
      setProject((prev) => {
        const maxDur = prev.videoDuration || 165;
        const nextTime = prev.currentTime + 0.1 * (prev.playbackRate || 1);
        if (nextTime >= maxDur) {
          return { ...prev, currentTime: 0, isPlaying: false };
        }
        return { ...prev, currentTime: parseFloat(nextTime.toFixed(2)) };
      });
    }, 100);
    return () => clearInterval(interval);
  }, [project.isPlaying, project.videoUrl, setProject]);

  // Sync HTML5 Video playback when real video is loaded
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !project.videoUrl) return;
    const rate = Math.max(0.25, Math.min(2.5, project.playbackRate || 1.0));
    if (Math.abs(v.playbackRate - rate) > 0.02) {
      v.playbackRate = rate;
    }
    if (project.isPlaying && v.paused) {
      stopAllPreviewAudio();
      v.play().catch(() => {});
    } else if (!project.isPlaying && !v.paused) {
      v.pause();
    }
  }, [project.isPlaying, project.playbackRate, project.videoUrl]);

  // Preload & decode BGM MP3 + all Voice Clone clips in memory so playback never stutters
  useEffect(() => {
    const mixer = getMixer();
    if (project.extractedBgmUrl) {
      mixer.preloadBgm(project.extractedBgmUrl);
    }
    if (project.segments.length > 0) {
      mixer.preloadVoices(project.segments);
    }
  }, [project.extractedBgmUrl, project.segments]);

  const syncMixerAtTime = (timeSec: number, forceReseek = false, overrideIsPlaying?: boolean) => {
    const rate = Math.max(0.25, Math.min(2.5, project.playbackRate || 1.0));
    getMixer().sync(
      {
        isPlaying: overrideIsPlaying !== undefined ? overrideIsPlaying : project.isPlaying,
        currentTime: timeSec,
        playbackRate: videoRef.current?.playbackRate || rate,
        isMuted: Boolean(project.isMuted),
        bgmUrl: project.extractedBgmUrl,
        isBgmEnabled: isBgmActive,
        bgmVolume: project.bgmVolume ?? 0.65,
        segments: project.segments,
        voiceSpeed,
        isVoiceEnabled: !project.isVoiceMuted && trackVisible.narrator,
        voiceVolume: project.voiceVolume ?? 1.0,
      },
      forceReseek
    );
  };

  // Unified Web Audio Mixer: combines BGM MP3 + Voice Clone into ONE glitch-free hardware audio bus
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.defaultMuted = true;
      videoRef.current.muted = true;
      videoRef.current.volume = 0;
    }
    syncMixerAtTime(project.currentTime, false);
  }, [
    isBgmActive,
    shouldMuteOrig,
    project.volume,
    project.isMuted,
    project.useExtractedBgm,
    project.extractedBgmUrl,
    project.bgmVolume,
    project.isPlaying,
    project.currentTime,
    project.playbackRate,
    project.segments,
    voiceSpeed,
    project.voiceVolume,
    project.isVoiceMuted,
    trackVisible.bgm,
    trackVisible.narrator,
    trackVisible.video,
  ]);

  // Extract filmstrip thumbnails when a video is uploaded, then immediately release the hardware decoder
  useEffect(() => {
    if (!project.videoUrl) {
      setVideoThumbnails([]);
      return;
    }
    let cancelled = false;
    const tempVid = document.createElement('video');
    tempVid.preload = 'auto';
    tempVid.src = project.videoUrl;
    tempVid.muted = true;
    tempVid.playsInline = true;
    tempVid.crossOrigin = 'anonymous';

    const releaseTempVid = () => {
      try {
        tempVid.onloadedmetadata = null;
        tempVid.pause();
        tempVid.removeAttribute('src');
        tempVid.load();
      } catch (_) {}
    };

    tempVid.onloadedmetadata = async () => {
      try {
        const dur = tempVid.duration || 30;
        const count = 12;
        const frames: string[] = [];
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        for (let i = 0; i < count; i++) {
          if (cancelled) return;
          const targetTime = Math.min(dur - 0.1, (dur / count) * (i + 0.5));
          await new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              tempVid.removeEventListener('seeked', onSeeked);
              resolve();
            };
            const onSeeked = () => {
              try {
                ctx.drawImage(tempVid, 0, 0, canvas.width, canvas.height);
                frames.push(canvas.toDataURL('image/jpeg', 0.6));
              } catch {}
              finish();
            };
            const timer = setTimeout(finish, 1500);
            tempVid.addEventListener('seeked', onSeeked);
            tempVid.currentTime = Math.max(0, targetTime);
          });
        }
        if (!cancelled && frames.length > 0) {
          setVideoThumbnails(frames);
        }
      } finally {
        releaseTempVid();
      }
    };

    return () => {
      cancelled = true;
      releaseTempVid();
    };
  }, [project.videoUrl]);

  const handleFileSelected = (file: File) => {
    if (!file || !file.type.startsWith('video/')) return;
    const url = URL.createObjectURL(file);
    audioMixerRef.current?.stopAll();
    try {
      sessionStorage.removeItem('motion_recap_session_bgm_url');
    } catch (_) {}
    setProject((prev) => ({
      ...prev,
      videoFile: file,
      videoUrl: url,
      videoName: file.name,
      videoDuration: 0,
      currentTime: 0,
      isPlaying: false,
      playbackRate: 1.0,
      voicePlaybackRate: 1.0,
      volume: 0.8,
      isMuted: false,
      voiceVolume: 1.0,
      isVoiceMuted: false,
      segments: [],
      extractedBgmUrl: null,
      useExtractedBgm: false,
      bgmEngineUsed: null,
      videoInspection: null,
      frameCrop: {
        fitMode: 'cover',
        scale: 1.0,
        posX: 0,
        posY: 0,
        backgroundStyle: 'blur',
      },
      keyframes: [
        {
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
        },
      ],
    }));
    setStatusMessage(`Loaded video: ${file.name}`);
    inspectVideoFile(file, file.name)
      .then((inspection) => {
        setProject((prev) => ({
          ...prev,
          videoDuration: inspection.duration || prev.videoDuration,
          videoInspection: inspection,
        }));
      })
      .catch(() => {});
  };

  const handleRealignOneMinuteBlocks = () => {
    if (!displaySegments.length) return;
    pushHistory();
    const aligned = realignSegmentsByMinuteBlocks(displaySegments, totalDuration, {
      enforceSingleVoice: lockedVoice,
      enforceSingleSpeakerLabel: true,
    });
    setProject((prev) => ({
      ...prev,
      narrationMode: 'dialogue_dub',
      segments: aligned,
    }));
    setStatusMessage(
      `✓ 0:30 စီ ${getMinuteBlocks(totalDuration).length} ပိုင်းအတွင်း အသံ + Subtitle အချိန်ကွက် ပြန်ညှိပြီးပါပြီ (No Drift)!`
    );
  };

  const handleSeek = (newTime: number) => {
    const clamped = Math.max(0, Math.min(totalDuration, newTime));
    lastTimeUpdateMsRef.current = 0;
    if (videoRef.current && project.videoUrl) {
      videoRef.current.currentTime = clamped;
    }
    const mixer = getMixer();
    mixer.unlock();
    syncMixerAtTime(clamped, true);
    onSeekTo(clamped);
  };

  const handleTogglePlay = () => {
    const willPlay = !project.isPlaying;
    const mixer = getMixer();
    lastTimeUpdateMsRef.current = 0;
    setProject((prev) => ({ ...prev, isPlaying: willPlay }));

    if (willPlay) {
      stopAllPreviewAudio();
      mixer.unlock();
      const rate = Math.max(0.25, Math.min(2.5, project.playbackRate || 1.0));
      if (videoRef.current && videoRef.current.paused) {
        videoRef.current.defaultMuted = true;
        videoRef.current.muted = true;
        videoRef.current.volume = 0;
        if (Math.abs(videoRef.current.playbackRate - rate) > 0.02) {
          videoRef.current.playbackRate = rate;
        }
        if (videoRef.current.readyState >= 1 && Math.abs(videoRef.current.currentTime - project.currentTime) > 0.25) {
          videoRef.current.currentTime = Math.max(0, project.currentTime);
        }
        videoRef.current.play().catch(() => {});
      }
      syncMixerAtTime(videoRef.current ? videoRef.current.currentTime : project.currentTime, true, true);
    } else {
      if (videoRef.current && !videoRef.current.paused) {
        videoRef.current.pause();
      }
      mixer.stopAll();
    }
  };

  // Timeline Tools
  const handleSplitAtPlayhead = () => {
    const t = project.currentTime;
    const idx = displaySegments.findIndex((s) => t > s.startTime + 0.2 && t < s.endTime - 0.2);
    if (idx === -1) {
      setStatusMessage('Place playhead inside a subtitle block to split.');
      return;
    }
    pushHistory();
    const target = displaySegments[idx];
    const seg1: TranscriptSegment = { ...target, endTime: parseFloat(t.toFixed(2)) };
    const seg2: TranscriptSegment = {
      ...target,
      id: `seg_${Date.now()}`,
      startTime: parseFloat((t + 0.05).toFixed(2)),
      audioUrl: undefined,
      audioDuration: undefined,
      myanmarTranslation: `${target.myanmarTranslation} (အပိုင်း ၂)`,
    };
    const next = [...displaySegments];
    next.splice(idx, 1, seg1, seg2);
    setProject((prev) => ({ ...prev, segments: next }));
    setStatusMessage('Split subtitle segment at playhead.');
  };

  const handleDuplicateSelected = () => {
    const seg =
      displaySegments.find((s) => s.id === selectedSegmentId) ||
      activeSegment ||
      displaySegments[displaySegments.length - 1];
    if (!seg) return;
    pushHistory();
    const dur = Math.max(2, seg.endTime - seg.startTime);
    const newStart = parseFloat((seg.endTime + 0.5).toFixed(2));
    const newEnd = parseFloat(Math.min(totalDuration, newStart + dur).toFixed(2));
    const copySeg: TranscriptSegment = {
      ...seg,
      id: `seg_${Date.now()}`,
      startTime: newStart,
      endTime: Math.max(newStart + 1, newEnd),
    };
    setProject((prev) => ({
      ...prev,
      segments: [...displaySegments, copySeg].sort((a, b) => a.startTime - b.startTime),
    }));
    setSelectedSegmentId(copySeg.id);
    setStatusMessage('Duplicated subtitle segment.');
  };

  const handleDeleteSelected = () => {
    const targetId = selectedTarget?.segId || selectedSegmentId || activeSegment?.id;
    if (!targetId) return;
    pushHistory();
    setProject((prev) => ({
      ...prev,
      segments: displaySegments.filter((s) => s.id !== targetId),
    }));
    setSelectedSegmentId(null);
    setSelectedTarget(null);
    setStatusMessage('Deleted selected block.');
  };

  const handleAddSubtitleSegment = () => {
    pushHistory();
    const start = parseFloat(project.currentTime.toFixed(2));
    const end = parseFloat(Math.min(totalDuration, start + 12).toFixed(2));
    const newSeg: TranscriptSegment = {
      id: `seg_${Date.now()}`,
      startTime: start,
      endTime: Math.max(start + 2, end),
      originalText: 'New Dialogue',
      myanmarTranslation: 'စာတန်းထိုးအသစ် ထည့်ရန်...',
      voice: lockedVoice,
      speaker: 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
      scriptStyle,
    };
    setProject((prev) => ({
      ...prev,
      segments: [...displaySegments, newSeg].sort((a, b) => a.startTime - b.startTime),
    }));
    setSelectedSegmentId(newSeg.id);
    setEditingSegId(newSeg.id);
    setEditingSubText(newSeg.myanmarTranslation);
  };

  // Selected target item info for the volume-slider timing controller
  const selectedTargetDetails = useMemo(() => {
    if (!selectedTarget) return null;
    const idx = displaySegments.findIndex((s) => s.id === selectedTarget.segId);
    if (idx === -1) return null;
    const seg = displaySegments[idx];
    const start =
      selectedTarget.track === 'voice'
        ? seg.startTime
        : seg.subtitleStartTime ?? seg.startTime;
    const end =
      selectedTarget.track === 'voice'
        ? seg.endTime
        : seg.subtitleEndTime ?? seg.endTime;
    const duration = Math.max(0.5, end - start);
    const maxStart = Math.max(0, parseFloat((totalDuration - duration).toFixed(2)));
    return {
      seg,
      index: idx + 1,
      track: selectedTarget.track,
      start: Math.max(0, Math.min(maxStart, start)),
      end,
      duration,
      maxStart,
    };
  }, [selectedTarget, displaySegments, totalDuration]);

  const selectTimelineItem = (seg: TranscriptSegment, track: 'voice' | 'subtitle') => {
    sliderHistorySavedRef.current = false;
    setSelectedSegmentId(seg.id);
    setSelectedTarget({ segId: seg.id, track });
    const targetStart = track === 'voice' ? seg.startTime : seg.subtitleStartTime ?? seg.startTime;
    handleSeek(targetStart);
    setStatusMessage(
      track === 'voice'
        ? `🎙️ Selected Voice Clone (${formatRulerTick(targetStart)}) — Slider ဖြင့် ရှေ့နောက်ရွှေ့ပြီး Done နှိပ်ပါ`
        : `💬 Selected Subtitle (${formatRulerTick(targetStart)}) — Slider ဖြင့် ရှေ့နောက်ရွှေ့ပြီး Done နှိပ်ပါ`
    );
  };

  // Move ONLY the selected item (Voice Clone OR Subtitle) — never both together
  const moveSelectedItemToStart = (targetStartSec: number, pushUndoSnapshot = false) => {
    if (!selectedTarget) return;
    if (pushUndoSnapshot) {
      pushHistory();
    }
    let nextClampedStart = 0;
    let nextClampedEnd = 0;

    setProject((prev) => {
      const base = prev.segments.length > 0 ? prev.segments : STEP5_DEMO_SUBTITLES;
      return {
        ...prev,
        segments: base.map((s) => {
          if (s.id !== selectedTarget.segId) return s;

          if (selectedTarget.track === 'voice') {
            const dur = Math.max(0.5, s.endTime - s.startTime);
            const nextStart = parseFloat(
              Math.max(0, Math.min(totalDuration - dur, targetStartSec)).toFixed(2)
            );
            const nextEnd = parseFloat((nextStart + dur).toFixed(2));
            nextClampedStart = nextStart;
            nextClampedEnd = nextEnd;
            // Snapshot subtitle start/end so moving Voice Clone NEVER moves Subtitle
            const preservedSubStart = s.subtitleStartTime ?? s.startTime;
            const preservedSubEnd = s.subtitleEndTime ?? s.endTime;
            return {
              ...s,
              startTime: nextStart,
              endTime: nextEnd,
              subtitleStartTime: preservedSubStart,
              subtitleEndTime: preservedSubEnd,
              isTimingFixed: true,
            };
          } else {
            const origSubStart = s.subtitleStartTime ?? s.startTime;
            const origSubEnd = s.subtitleEndTime ?? s.endTime;
            const dur = Math.max(0.5, origSubEnd - origSubStart);
            const nextSubStart = parseFloat(
              Math.max(0, Math.min(totalDuration - dur, targetStartSec)).toFixed(2)
            );
            const nextSubEnd = parseFloat((nextSubStart + dur).toFixed(2));
            nextClampedStart = nextSubStart;
            nextClampedEnd = nextSubEnd;
            // Only Subtitle moves; Voice Clone startTime/endTime stay untouched
            return {
              ...s,
              subtitleStartTime: nextSubStart,
              subtitleEndTime: nextSubEnd,
              isTimingFixed: true,
            };
          }
        }),
      };
    });

    handleSeek(nextClampedStart);
    setStatusMessage(
      `${selectedTarget.track === 'voice' ? '🎙️ Voice Clone' : '💬 Subtitle'}: ${formatRulerTick(nextClampedStart)} → ${formatRulerTick(nextClampedEnd)}`
    );
  };

  const nudgeSelectedItem = (deltaSec: number) => {
    if (!selectedTargetDetails) return;
    moveSelectedItemToStart(selectedTargetDetails.start + deltaSec, true);
  };

  const handleDoneSelection = () => {
    if (!selectedTarget) return;
    setProject((prev) => {
      const base = prev.segments.length > 0 ? prev.segments : STEP5_DEMO_SUBTITLES;
      return {
        ...prev,
        segments: base.map((s) =>
          s.id === selectedTarget.segId ? { ...s, isTimingFixed: true } : s
        ),
      };
    });
    const label = selectedTarget.track === 'voice' ? 'Voice Clone' : 'Subtitle';
    setSelectedTarget(null);
    sliderHistorySavedRef.current = false;
    setStatusMessage(`✓ ${label} နေရာချိန်ညှိမှု အတည်ပြုပြီးပါပြီ (Done)`);
  };

  const bgmVolVal = project.isMuted || !isBgmActive ? 0 : project.bgmVolume ?? 0.65;
  const bgmVolPct = bgmVolVal * 100;
  const voiceVolVal = project.isMuted || project.isVoiceMuted || !trackVisible.narrator ? 0 : Math.min(1.5, project.voiceVolume ?? 1.0);
  const voiceVolPct = Math.min(100, (voiceVolVal / 1.5) * 100);

  const rulerStepSec = totalDuration <= 90 ? 15 : 30;
  const rulerTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let t = 0; t <= totalDuration; t += rulerStepSec) {
      ticks.push(t);
    }
    return ticks;
  }, [totalDuration, rulerStepSec]);

  const playheadPct = Math.max(0, Math.min(100, (project.currentTime / totalDuration) * 100));

  const bgmWaveformBars = useMemo(
    () =>
      Array.from({ length: 120 }, (_, i) => {
        const wave = Math.abs(Math.sin(i * 0.42) * 0.5 + Math.cos(i * 0.19) * 0.35 + Math.sin(i * 1.1) * 0.15);
        return Math.max(18, Math.min(95, Math.round(wave * 95)));
      }),
    []
  );

  const narratorWaveformBars = useMemo(
    () =>
      Array.from({ length: 120 }, (_, i) => {
        const t = (i / 120) * totalDuration;
        const inside = displaySegments.some((s) => t >= s.startTime && t <= s.endTime);
        const amp = inside ? Math.abs(Math.sin(i * 0.7) * 0.6 + Math.cos(i * 0.3) * 0.35) : 0.16;
        return Math.max(14, Math.min(94, Math.round(amp * 92)));
      }),
    [displaySegments, totalDuration]
  );

  const kf = getInterpolatedKeyframe(project.keyframes, project.currentTime);
  const filterCss = getFilterCss(kf.filter);
  const ratio = project.aspectRatio || '9:16';
  const crop = project.frameCrop || {
    fitMode: 'cover' as const,
    scale: 1.0,
    posX: 0,
    posY: 0,
    backgroundStyle: 'blur' as const,
  };

  const getContainerViewportStyle = (): React.CSSProperties => {
    switch (ratio) {
      case '9:16':
        return {
          aspectRatio: '9 / 16',
          height: '520px',
          maxHeight: '520px',
          maxWidth: '100%',
        };
      case '1:1':
        return {
          aspectRatio: '1 / 1',
          height: '460px',
          maxHeight: '460px',
          maxWidth: '100%',
        };
      case '4:5':
        return {
          aspectRatio: '4 / 5',
          height: '480px',
          maxHeight: '480px',
          maxWidth: '100%',
        };
      case '16:9':
      default:
        return {
          aspectRatio: '16 / 9',
          width: '100%',
          maxWidth: '780px',
          maxHeight: '460px',
        };
    }
  };

  const sidebarItems = [
    { id: 'home', label: 'Home', icon: Home, onClick: () => onJumpToStep(1) },
    { id: 'editor', label: 'Video Editor', icon: Clapperboard, active: true, onClick: () => {} },
    { id: 'keyframes', label: 'Pro FX', icon: Sparkles, onClick: () => setIsProPanelOpen((prev) => !prev) },
    { id: 'blur', label: 'Blur Box', icon: EyeOff, onClick: () => setIsBlurPanelOpen((prev) => !prev) },
  ];

  return (
    <div className="rounded-2xl overflow-hidden bg-[#0E0D17] border border-[#252339] shadow-2xl flex flex-col select-none">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) handleFileSelected(e.target.files[0]);
          e.target.value = '';
        }}
      />

      {/* STEP 5 TOP BAR (Recap-MiYO Branding + Mode Pill + Step Nav) */}
      <div className="px-4 py-2.5 bg-[#12111C] border-b border-[#242238] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#6366F1] via-[#7C3AED] to-[#A855F7] flex items-center justify-center shadow-lg shadow-violet-600/30">
            <Play className="w-3.5 h-3.5 text-white fill-white ml-0.5" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-extrabold text-white font-display tracking-tight">
              Recap-MiYO
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenKeysModal}
          className="px-3 py-1 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-[11px] font-semibold text-emerald-300 flex items-center gap-1.5 cursor-pointer"
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>Offline / Studio Mode</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPrevStep}
            className="px-3 py-1.5 rounded-lg bg-[#1A1828] hover:bg-[#252339] border border-[#2C2A44] text-xs font-semibold text-zinc-300 flex items-center gap-1 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>အဆင့် ၄</span>
          </button>
          <button
            type="button"
            onClick={onNextStep}
            className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] hover:brightness-110 text-xs font-bold text-white flex items-center gap-1 cursor-pointer shadow-md shadow-violet-600/25"
          >
            <span>အဆင့် ၆ (Export MP4)</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* STUDIO BODY: LEFT SIDEBAR + WORKSPACE */}
      <div className="flex flex-1 min-h-0">
        {/* LEFT SIDEBAR (Matches Mockup) */}
        <aside className="hidden lg:flex w-44 shrink-0 bg-[#12111C] border-r border-[#242238] flex-col p-2 gap-1">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={item.onClick}
                className={`w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2.5 transition-all cursor-pointer whitespace-nowrap ${
                  item.active
                    ? 'bg-gradient-to-r from-[#5B4BD6] to-[#7C3AED] text-white shadow-md shadow-violet-600/25'
                    : 'text-zinc-300 hover:text-white hover:bg-[#1C1A2B]'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${item.active ? 'text-white' : 'text-zinc-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </aside>

        {/* WORKSPACE CANVAS */}
        <div className="flex-1 p-3 flex flex-col gap-2.5 min-w-0">
          {/* TOP ROW: FULL-WIDTH VIDEO EDITOR PREVIEW */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
            {/* VIDEO TOOLBAR + PREVIEW + TRANSPORT */}
            <div className="lg:col-span-12 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    pushHistory();
                    audioMixerRef.current?.stopAll();
                    try {
                      sessionStorage.removeItem('motion_recap_session_bgm_url');
                    } catch (_) {}
                    setProject((prev) => ({
                      ...prev,
                      videoFile: null,
                      videoUrl: null,
                      videoName: 'Recap-MiYO_Project.mp4',
                      videoDuration: 0,
                      currentTime: 0,
                      isPlaying: false,
                      playbackRate: 1.0,
                      voicePlaybackRate: 1.0,
                      isMuted: false,
                      isVoiceMuted: false,
                      extractedBgmUrl: null,
                      useExtractedBgm: false,
                      bgmEngineUsed: null,
                      segments: STEP5_DEMO_SUBTITLES,
                    }));
                    setStatusMessage('Created new project');
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-[#191827] hover:bg-[#232136] border border-[#2B2942] text-xs font-semibold text-zinc-200 flex items-center gap-1.5 cursor-pointer"
                >
                  <FilePlus className="w-3.5 h-3.5" />
                  <span>New Project</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2.5 py-1.5 rounded-lg bg-[#191827] hover:bg-[#232136] border border-[#2B2942] text-xs font-semibold text-zinc-200 flex items-center gap-1.5 cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Open</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    try {
                      localStorage.setItem(
                        'motion_recap_project_state',
                        JSON.stringify({ ...project, videoFile: null })
                      );
                      setStatusMessage('✓ Project saved');
                    } catch {}
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-[#191827] hover:bg-[#232136] border border-[#2B2942] text-xs font-semibold text-zinc-200 flex items-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save</span>
                </button>

                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={undoStack.length === 0}
                  className="px-2.5 py-1.5 rounded-lg bg-[#191827] hover:bg-[#232136] disabled:opacity-40 border border-[#2B2942] text-xs font-semibold text-zinc-300 flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  <span>Undo</span>
                </button>

                <button
                  type="button"
                  onClick={handleRedo}
                  disabled={redoStack.length === 0}
                  className="px-2.5 py-1.5 rounded-lg bg-[#191827] hover:bg-[#232136] disabled:opacity-40 border border-[#2B2942] text-xs font-semibold text-zinc-300 flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                >
                  <Redo2 className="w-3.5 h-3.5" />
                  <span>Redo</span>
                </button>
              </div>

              {/* VIDEO PREVIEW FRAME */}
              <div className="w-full flex items-center justify-center p-2.5 sm:p-3 bg-zinc-950/75 rounded-xl border border-[#28263D] shadow-xl overflow-hidden">
                <div
                  ref={previewContainerRef}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files?.[0]) handleFileSelected(e.dataTransfer.files[0]);
                  }}
                  style={getContainerViewportStyle()}
                  className="relative rounded-2xl overflow-hidden bg-black border border-zinc-800 shadow-2xl flex items-center justify-center group select-none transition-all"
                >
                  {project.videoUrl ? (
                    <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
                      {crop.fitMode === 'contain' && crop.backgroundStyle === 'blur' && (
                        <video
                          src={project.videoUrl}
                          preload="metadata"
                          className="absolute inset-0 w-full h-full object-cover filter blur-xl opacity-40 scale-110 pointer-events-none"
                          muted
                        />
                      )}
                      {(() => {
                        const s = kf.scale * (crop.scale || 1.0);
                        const px = kf.posX + (crop.posX || 0);
                        const py = kf.posY + (crop.posY || 0);
                        const hasT =
                          Math.abs(s - 1) > 0.001 ||
                          Math.abs(px) > 0.01 ||
                          Math.abs(py) > 0.01 ||
                          Math.abs(kf.rotation) > 0.01;
                        return (
                          <div
                            className="w-full h-full flex items-center justify-center overflow-hidden"
                            style={{
                              ...(hasT
                                ? { transform: `scale(${s}) translate(${px}px, ${py}px) rotate(${kf.rotation}deg)` }
                                : {}),
                              opacity: Math.max(0, Math.min(1, kf.opacity)),
                            }}
                          >
                        <video
                          ref={videoRef}
                          src={project.videoUrl}
                          preload="auto"
                          muted
                          playsInline
                          onClick={handleTogglePlay}
                          onPlay={() => {
                            if (videoRef.current) {
                              const rate = Math.max(0.25, Math.min(2.5, project.playbackRate || 1.0));
                              videoRef.current.defaultMuted = true;
                              videoRef.current.muted = true;
                              videoRef.current.volume = 0;
                              if (Math.abs(videoRef.current.playbackRate - rate) > 0.02) {
                                videoRef.current.playbackRate = rate;
                              }
                            }
                          }}
                          onVolumeChange={() => {
                            if (videoRef.current && (!videoRef.current.muted || videoRef.current.volume > 0)) {
                              videoRef.current.defaultMuted = true;
                              videoRef.current.muted = true;
                              videoRef.current.volume = 0;
                            }
                          }}
                          onTimeUpdate={() => {
                            const v = videoRef.current;
                            if (!v) return;
                            const t = v.currentTime || 0;
                            syncMixerAtTime(t, false, !v.paused && !v.ended && project.isPlaying);
                            const now = performance.now();
                            if (!v.paused && !v.ended && now - lastTimeUpdateMsRef.current < 90) {
                              return;
                            }
                            lastTimeUpdateMsRef.current = now;
                            setProject((prev) => ({
                              ...prev,
                              currentTime: t,
                              videoDuration: v.duration || prev.videoDuration,
                            }));
                          }}
                          onLoadedMetadata={() => {
                            if (!videoRef.current) return;
                            const v = videoRef.current;
                            const rate = Math.max(0.25, Math.min(2.5, project.playbackRate || 1.0));
                            v.defaultMuted = true;
                            v.muted = true;
                            v.volume = 0;
                            if (Math.abs(v.playbackRate - rate) > 0.02) {
                              v.playbackRate = rate;
                            }
                            if (project.currentTime > 0.1 && Math.abs(v.currentTime - project.currentTime) > 0.25) {
                              try {
                                v.currentTime = Math.min(project.currentTime, v.duration || project.currentTime);
                              } catch (_) {}
                            }
                            const vw = v.videoWidth || 1;
                            const vh = v.videoHeight || 1;
                            const ratioVal = vw / vh;
                            let detectedRatio: '9:16' | '16:9' | '1:1' | '4:5' = '9:16';
                            if (ratioVal > 1.25) {
                              detectedRatio = '16:9';
                            } else if (ratioVal >= 0.88 && ratioVal <= 1.15) {
                              detectedRatio = '1:1';
                            } else if (ratioVal > 0.68 && ratioVal < 0.88) {
                              detectedRatio = '4:5';
                            }
                            const anyV = v as any;
                            const hasAudioTrack =
                              typeof anyV.mozHasAudio === 'boolean'
                                ? anyV.mozHasAudio
                                : anyV.audioTracks && typeof anyV.audioTracks.length === 'number'
                                  ? anyV.audioTracks.length > 0
                                  : true;
                            setProject((prev) => ({
                              ...prev,
                              videoDuration: v.duration || prev.videoDuration,
                              aspectRatio: detectedRatio,
                              videoInspection: prev.videoInspection || {
                                duration: parseFloat((v.duration || prev.videoDuration || 1).toFixed(2)),
                                width: vw,
                                height: vh,
                                resolution: `${vw}x${vh}`,
                                hasAudio: hasAudioTrack,
                                format: (prev.videoName.split('.').pop() || 'mp4').toLowerCase(),
                                filesize: prev.videoFile?.size || 0,
                                inspectedAt: Date.now(),
                              },
                            }));
                          }}
                          onEnded={() => setProject((prev) => ({ ...prev, isPlaying: false }))}
                          className={`w-full h-full cursor-pointer ${
                            crop.fitMode === 'cover' ? 'object-cover' : 'object-contain'
                          }`}
                          style={{
                            filter:
                              [
                                filterCss,
                                getFilterCss(project.globalColorFilter),
                                kf.blur > 0 ? `blur(${kf.blur}px)` : '',
                              ]
                                .filter((x) => x !== 'none' && x !== '')
                                .join(' ') || 'none',
                          }}
                        />
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <div onClick={handleTogglePlay} className="relative w-full h-full cursor-pointer">
                      <img
                        src={DEMO_SCENE_SRC}
                        alt="Preview Video Frame"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/15 pointer-events-none" />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-black/75 border border-white/15 text-[11px] font-medium text-zinc-200 flex items-center gap-1.5 cursor-pointer"
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-violet-400" />
                        <span>Open Video</span>
                      </button>
                    </div>
                  )}

                  {/* INTERACTIVE BLUR BOX OVERLAYS */}
                  {project.blurBoxes && project.blurBoxes.map((b) => (
                    <InteractiveBlurBox
                      key={b.id}
                      blurBox={b}
                      onUpdate={(updated) => handleUpdateBlurBox(b.id, updated)}
                      onDelete={() => handleDeleteBlurBox(b.id)}
                    />
                  ))}

                  {/* FIXED LOGO OVERLAY */}
                  {project.logoConfig && project.logoConfig.imageUrl && (
                    <div
                      className="absolute z-20 pointer-events-none select-none flex items-center justify-center overflow-hidden transition-all shadow-lg"
                      style={{
                        left: `${project.logoConfig.x}%`,
                        top: `${project.logoConfig.y}%`,
                        width: `${project.logoConfig.size}px`,
                        height: `${project.logoConfig.size}px`,
                        borderRadius: project.logoConfig.shape === 'circle' ? '9999px' : '8px',
                        opacity: project.logoConfig.opacity ?? 1,
                      }}
                    >
                      <img
                        src={project.logoConfig.imageUrl}
                        alt="Custom Watermark Logo"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}

                  {/* ANIMATED TEXT WATERMARK OVERLAY */}
                  {project.logoConfig && project.logoConfig.textWatermark && (
                    <div className="absolute inset-0 z-20 pointer-events-none select-none overflow-hidden">
                      <div
                        className="absolute whitespace-nowrap text-white/30 font-bold font-myanmar animate-marquee"
                        style={{
                          fontSize: `${project.logoConfig.textWatermarkSize || 24}px`,
                          top: `${(project.currentTime * (project.logoConfig.textWatermarkSpeed || 30)) % 100}%`,
                          left: '10%',
                          textShadow: '0 2px 4px rgba(0,0,0,0.8)',
                          transform: 'translateY(-50%)',
                          animation: 'marqueeVertical 10s linear infinite',
                        }}
                      >
                        {project.logoConfig.textWatermark}
                      </div>
                    </div>
                  )}

                  {trackVisible.subtitle && activeSubtitleSegment && (
                    <InteractiveSubtitleOverlay
                      text={activeSubtitleSegment.myanmarTranslation || activeSubtitleSegment.subtitleText || ''}
                      settings={project.subtitleSettings}
                      onUpdateOffset={(offsetX, offsetY) => {
                        setProject((prev) => ({
                          ...prev,
                          subtitleSettings: {
                            ...prev.subtitleSettings,
                            offsetX,
                            offsetY,
                          },
                        }));
                      }}
                    />
                  )}
                </div>
              </div>

              {/* TRANSPORT BAR */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 px-1">
                <div className="text-xs font-mono-num text-zinc-200 whitespace-nowrap">
                  <span>{formatFullTimecode(project.currentTime)}</span>
                  <span className="text-zinc-500"> / {formatFullTimecode(totalDuration)}</span>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleSeek(Math.max(0, project.currentTime - 5))}
                    className="p-1 text-zinc-300 hover:text-white cursor-pointer"
                  >
                    <SkipBack className="w-4 h-4 fill-current" />
                  </button>
                  <button
                    type="button"
                    onClick={handleTogglePlay}
                    className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#6366F1] to-[#8B5CF6] hover:brightness-110 text-white flex items-center justify-center shadow-lg shadow-violet-600/35 cursor-pointer"
                  >
                    {project.isPlaying ? (
                      <Pause className="w-4 h-4 fill-current" />
                    ) : (
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSeek(Math.min(totalDuration, project.currentTime + 5))}
                    className="p-1 text-zinc-300 hover:text-white cursor-pointer"
                  >
                    <SkipForward className="w-4 h-4 fill-current" />
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Video Speed indicator / 1.00x Quick Reset */}
                  {Math.abs((project.playbackRate || 1.0) - 1.0) > 0.02 && (
                    <button
                      type="button"
                      onClick={() => {
                        setProject((prev) => ({ ...prev, playbackRate: 1.0 }));
                        setStatusMessage('✓ Video Speed ကို 1.00x ပုံမှန်နှုန်းသို့ ပြန်ညှိပြီးပါပြီ');
                      }}
                      className="px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-amber-200 text-[11px] font-bold font-mono-num flex items-center gap-1 cursor-pointer"
                      title="Video Speed နှေး/မြန်နေသဖြင့် 1.00x ပုံမှန်သို့ ပြန်ထားရန် နှိပ်ပါ"
                    >
                      <span>{(project.playbackRate || 1.0).toFixed(2)}x → 1.0x</span>
                    </button>
                  )}

                  {/* BGM MP3 Volume & Mute Control */}
                  <div
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] ${
                      project.extractedBgmUrl
                        ? isBgmActive && bgmVolVal > 0
                          ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                          : 'bg-[#191827] border-[#2B2942] text-zinc-400'
                        : 'bg-[#151420] border-[#242238] text-zinc-500 opacity-60'
                    }`}
                    title={project.extractedBgmUrl ? 'BGM MP3 အသံအတိုးအကျယ်' : 'Step 2 တွင် BGM ထုတ်ပေးပါ'}
                  >
                    <button
                      type="button"
                      disabled={!project.extractedBgmUrl}
                      onClick={() => {
                        setProject((prev) => {
                          const nextActive = !(prev.useExtractedBgm !== false && trackVisible.bgm);
                          return {
                            ...prev,
                            useExtractedBgm: nextActive,
                            bgmVolume: nextActive ? (prev.bgmVolume && prev.bgmVolume > 0 ? prev.bgmVolume : 0.65) : prev.bgmVolume,
                            isMuted: nextActive ? false : prev.isMuted,
                          };
                        });
                        setTrackVisible((prev) => ({ ...prev, bgm: true }));
                      }}
                      className="flex items-center gap-1 font-semibold cursor-pointer disabled:cursor-not-allowed"
                    >
                      <Music className="w-3.5 h-3.5 text-emerald-400" />
                      <span>BGM</span>
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      disabled={!project.extractedBgmUrl}
                      value={bgmVolVal}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setTrackVisible((prev) => ({ ...prev, bgm: true }));
                        setProject((prev) => ({
                          ...prev,
                          bgmVolume: val,
                          useExtractedBgm: val > 0,
                          isMuted: val > 0 ? false : prev.isMuted,
                        }));
                      }}
                      style={{
                        touchAction: 'pan-y',
                        background: `linear-gradient(to right, #10B981 0%, #34D399 ${bgmVolPct}%, #2B2842 ${bgmVolPct}%, #2B2842 100%)`,
                      }}
                      className="studio-slider w-14 sm:w-16"
                    />
                  </div>

                  {/* Voice Clone Volume & Mute Control */}
                  <div
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] ${
                      hasClonedAudio
                        ? !project.isVoiceMuted && trackVisible.narrator && voiceVolVal > 0
                          ? 'bg-violet-950/45 border-violet-500/45 text-violet-200'
                          : 'bg-[#191827] border-[#2B2942] text-zinc-400'
                        : 'bg-[#151420] border-[#242238] text-zinc-500 opacity-60'
                    }`}
                    title={hasClonedAudio ? 'Voice Clone အသံအတိုးအကျယ်' : 'Step 4 တွင် Voice Clone ထုတ်ပေးပါ'}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setTrackVisible((prev) => ({ ...prev, narrator: true }));
                        setProject((prev) => ({
                          ...prev,
                          isVoiceMuted: !prev.isVoiceMuted,
                          voiceVolume: prev.isVoiceMuted ? (prev.voiceVolume && prev.voiceVolume > 0 ? prev.voiceVolume : 1.0) : prev.voiceVolume,
                          isMuted: prev.isVoiceMuted ? false : prev.isMuted,
                        }));
                      }}
                      className="flex items-center gap-1 font-semibold cursor-pointer"
                    >
                      <Mic className="w-3.5 h-3.5 text-violet-400" />
                      <span>Voice</span>
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1.5}
                      step={0.05}
                      value={voiceVolVal}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setTrackVisible((prev) => ({ ...prev, narrator: true }));
                        setProject((prev) => ({
                          ...prev,
                          voiceVolume: val,
                          isVoiceMuted: val === 0,
                          isMuted: val > 0 ? false : prev.isMuted,
                        }));
                      }}
                      style={{
                        touchAction: 'pan-y',
                        background: `linear-gradient(to right, #7C3AED 0%, #A855F7 ${voiceVolPct}%, #2B2842 ${voiceVolPct}%, #2B2842 100%)`,
                      }}
                      className="studio-slider w-14 sm:w-16"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setTrackVisible((prev) => ({ ...prev, narrator: true }));
                        setProject((prev) => ({
                          ...prev,
                          voiceVolume: 1.0,
                          isVoiceMuted: false,
                          isMuted: false,
                        }));
                      }}
                      className="text-[10px] font-mono-num text-violet-200 hover:text-white cursor-pointer"
                      title="Voice 100% သို့ ပြန်ထားရန် နှိပ်ပါ"
                    >
                      {Math.round(voiceVolVal * 100)}%
                    </button>
                  </div>

                  {/* Master Mute & Fullscreen */}
                  <button
                    type="button"
                    onClick={() => setProject((prev) => ({ ...prev, isMuted: !prev.isMuted }))}
                    title={project.isMuted ? 'အသံအားလုံးပြန်ဖွင့်မည်' : 'အသံအားလုံးပိတ်မည်'}
                    className="p-1 text-zinc-300 hover:text-white cursor-pointer"
                  >
                    {project.isMuted ? (
                      <VolumeX className="w-4 h-4 text-rose-400" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => previewContainerRef.current?.requestFullscreen?.().catch(() => {})}
                    className="p-1 text-zinc-400 hover:text-white cursor-pointer"
                  >
                    <Maximize2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

          </div>

          {/* BOTTOM ROW: FULL-WIDTH MULTI-TRACK TIMELINE */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 min-h-[250px]">
            {/* TIMELINE */}
            <div className="lg:col-span-12 studio-panel rounded-xl flex flex-col overflow-hidden">
              <div className="px-3 py-1.5 border-b border-[#252339] flex flex-wrap items-center justify-between gap-2 bg-[#161522]">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleSplitAtPlayhead}
                    className="p-1.5 rounded-md text-zinc-300 hover:text-white hover:bg-[#252339] cursor-pointer"
                    title="Split at Playhead"
                  >
                    <Scissors className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleDuplicateSelected}
                    className="p-1.5 rounded-md text-zinc-300 hover:text-white hover:bg-[#252339] cursor-pointer"
                    title="Duplicate Block"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    className="p-1.5 rounded-md text-zinc-300 hover:text-rose-400 hover:bg-[#252339] cursor-pointer"
                    title="Delete Block"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <span className="h-4 w-px bg-[#2B2942] mx-1" />
                  <button
                    type="button"
                    onClick={handleAddSubtitleSegment}
                    className="p-1.5 rounded-md text-zinc-300 hover:text-white hover:bg-[#252339] cursor-pointer"
                    title="Add Subtitle"
                  >
                    <PlusSquare className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsProPanelOpen((prev) => !prev)}
                    className="p-1.5 rounded-md text-zinc-300 hover:text-white hover:bg-[#252339] cursor-pointer"
                    title="Pro Edition (Alight Motion & Subtitle Settings)"
                  >
                    <AlignJustify className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimelineZoom((z) => Math.max(1, parseFloat((z - 0.5).toFixed(1))))}
                    className="p-1.5 rounded-md text-zinc-300 hover:text-white hover:bg-[#252339] cursor-pointer"
                    title="Zoom Out"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimelineZoom((z) => Math.min(3, parseFloat((z + 0.5).toFixed(1))))}
                    className="p-1.5 rounded-md text-zinc-300 hover:text-white hover:bg-[#252339] cursor-pointer"
                    title="Zoom In"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>

                  <span className="h-4 w-px bg-[#2B2942] mx-1" />

                  {/* PRO EDITION BUTTON */}
                  <button
                    type="button"
                    onClick={() => setIsProPanelOpen((prev) => !prev)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-lg ${
                      isProPanelOpen
                        ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-zinc-950 shadow-orange-500/30 ring-2 ring-amber-400/50 scale-105'
                        : 'bg-gradient-to-r from-amber-500/25 to-orange-500/25 hover:from-amber-500/35 hover:to-orange-500/35 border border-amber-500/50 text-amber-300 animate-pulse'
                    }`}
                  >
                    <Wand2 className="w-4 h-4 text-amber-400 animate-spin-slow" />
                    <span>Pro Edition</span>
                    {isProPanelOpen ? <ChevronDown className="w-3.5 h-3.5 ml-0.5" /> : <ChevronUp className="w-3.5 h-3.5 ml-0.5" />}
                  </button>

                  {/* BLUR EDITION BUTTON */}
                  <button
                    type="button"
                    onClick={() => setIsBlurPanelOpen((prev) => !prev)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-lg ${
                      isBlurPanelOpen
                        ? 'bg-cyan-500 text-zinc-950 shadow-cyan-500/30 ring-2 ring-cyan-400/50 scale-105'
                        : 'bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300'
                    }`}
                  >
                    <EyeOff className="w-4 h-4 text-cyan-400" />
                    <span>Blur Edition</span>
                    {isBlurPanelOpen ? <ChevronDown className="w-3.5 h-3.5 ml-0.5" /> : <ChevronUp className="w-3.5 h-3.5 ml-0.5" />}
                  </button>
                </div>

                {editingSegId ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={editingSubText}
                      onChange={(e) => setEditingSubText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          pushHistory();
                          setProject((prev) => ({
                            ...prev,
                            segments: displaySegments.map((s) =>
                              s.id === editingSegId
                                ? { ...s, myanmarTranslation: editingSubText, subtitleText: editingSubText }
                                : s
                            ),
                          }));
                          setEditingSegId(null);
                        }
                      }}
                      className="studio-input px-2 py-0.5 rounded text-[11px] font-myanmar w-48"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        pushHistory();
                        setProject((prev) => ({
                          ...prev,
                          segments: displaySegments.map((s) =>
                            s.id === editingSegId
                              ? { ...s, myanmarTranslation: editingSubText, subtitleText: editingSubText }
                              : s
                          ),
                        }));
                        setEditingSegId(null);
                      }}
                      className="p-1 rounded bg-violet-600 text-white cursor-pointer"
                    >
                      <Check className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <span className="text-[10px] text-zinc-400 font-mono">
                    {selectedTargetDetails
                      ? `Selected: ${selectedTargetDetails.track === 'voice' ? 'Voice Clone' : 'Subtitle'} #${selectedTargetDetails.index}`
                      : `${timelineZoom.toFixed(1)}x`}
                  </span>
                )}
              </div>

              {/* 0:30 Part Quick Navigator & Anti-Drift Re-Align Bar */}
              <div className="px-3 py-1.5 border-b border-[#252339] bg-[#12111C] flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-bold text-cyan-300 font-myanmar mr-1">
                    ⏱️ 0:30 အပိုင်းများ:
                  </span>
                  {getMinuteBlocks(totalDuration).map((part) => {
                    const isCurrentPart =
                      project.currentTime >= part.startSec &&
                      project.currentTime < part.endSec + (part.partNumber === getMinuteBlocks(totalDuration).length ? 1 : 0);
                    return (
                      <button
                        key={part.partNumber}
                        type="button"
                        onClick={() => handleSeek(part.startSec)}
                        className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-bold transition-all cursor-pointer ${
                          isCurrentPart
                            ? 'bg-cyan-500 text-zinc-950 shadow'
                            : 'bg-[#1D1B2E] hover:bg-[#2A2742] text-zinc-300 border border-[#2F2C4A]'
                        }`}
                        title={`${part.label} သို့ ခုန်မည်`}
                      >
                        P{part.partNumber} ({formatMinSec(part.startSec)}-{formatMinSec(part.endSec)})
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {project.videoInspection && (
                    <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/40 border border-white/10 text-[10px] font-mono text-zinc-300">
                      {project.videoInspection.resolution} · {project.videoInspection.hasAudio ? 'Audio ✓' : 'Visual'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleRealignOneMinuteBlocks}
                    className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-200 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-all"
                    title="နောက်ပိုင်းအသံများ အချိန်ရွေ့မသွားအောင် 0:30 စီ အပိုင်းအတွင်း ပြန်ညှိမည်"
                  >
                    <Layers className="w-3 h-3 text-emerald-300" />
                    <span>Re-Align 0:30 Parts</span>
                  </button>
                </div>
              </div>

              {/* Volume-Style Position Slider Bar (Appears ONLY when a Voice Clone or Subtitle clip is selected) */}
              {selectedTargetDetails && (
                <div className="px-3 py-2 border-b border-[#2D2A4A] bg-gradient-to-r from-[#1A1632] via-[#1F1A3D] to-[#1A1632] flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold flex items-center gap-1 shrink-0 ${
                        selectedTargetDetails.track === 'voice'
                          ? 'bg-cyan-500/20 border border-cyan-400/40 text-cyan-200'
                          : 'bg-violet-500/25 border border-violet-400/45 text-violet-200'
                      }`}
                    >
                      {selectedTargetDetails.track === 'voice' ? (
                        <>
                          <Mic className="w-3 h-3" />
                          <span>Voice Clone #{selectedTargetDetails.index}</span>
                        </>
                      ) : (
                        <>
                          <Type className="w-3 h-3" />
                          <span>Subtitle #{selectedTargetDetails.index}</span>
                        </>
                      )}
                    </span>
                    <span className="text-[10px] text-zinc-300 font-mono-num shrink-0">
                      {formatRulerTick(selectedTargetDetails.start)} → {formatRulerTick(selectedTargetDetails.end)}
                    </span>
                  </div>

                  {/* Volume-Slider Style Position Controller (Decreasing = Move Backward, Increasing = Move Forward) */}
                  <div className="flex-1 min-w-[200px] flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => nudgeSelectedItem(-0.5)}
                      title="အနောက်သို့ -0.5s ရွှေ့မည်"
                      className="px-2 py-1 rounded-lg bg-[#25223E] hover:bg-[#322E54] border border-[#3A3563] text-[10px] font-semibold text-zinc-200 flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <Volume1 className="w-3.5 h-3.5 text-zinc-300" />
                      <span>နောက်</span>
                    </button>

                    <input
                      type="range"
                      min={0}
                      max={Math.max(0.5, selectedTargetDetails.maxStart)}
                      step={0.05}
                      value={selectedTargetDetails.start}
                      onPointerDown={() => {
                        if (!sliderHistorySavedRef.current) {
                          pushHistory();
                          sliderHistorySavedRef.current = true;
                        }
                      }}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!sliderHistorySavedRef.current) {
                          pushHistory();
                          sliderHistorySavedRef.current = true;
                        }
                        moveSelectedItemToStart(val, false);
                      }}
                      style={
                        {
                          '--slider-pct': `${
                            selectedTargetDetails.maxStart > 0
                              ? (selectedTargetDetails.start / selectedTargetDetails.maxStart) * 100
                              : 0
                          }%`,
                        } as React.CSSProperties
                      }
                      aria-label="Position slider"
                      className="studio-slider flex-1"
                    />

                    <button
                      type="button"
                      onClick={() => nudgeSelectedItem(0.5)}
                      title="အရှေ့သို့ +0.5s တိုးမည်"
                      className="px-2 py-1 rounded-lg bg-[#25223E] hover:bg-[#322E54] border border-[#3A3563] text-[10px] font-semibold text-zinc-200 flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <span>ရှေ့</span>
                      <Volume2 className="w-3.5 h-3.5 text-violet-300" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleDoneSelection}
                    className="px-3.5 py-1 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 hover:brightness-110 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-600/25 cursor-pointer shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Done</span>
                  </button>
                </div>
              )}

              <div className="flex-1 flex overflow-hidden relative">
                {/* Track Labels */}
                <div className="w-24 shrink-0 border-r border-[#252339] bg-[#12111C] flex flex-col pt-6">
                  {[
                    { key: 'video' as const, label: 'Video', icon: Film },
                    { key: 'bgm' as const, label: 'BGM', icon: Music },
                    { key: 'narrator' as const, label: 'Voice Clone', icon: Mic },
                    { key: 'subtitle' as const, label: 'Subtitle', icon: Type },
                  ].map((tr) => {
                    const Icon = tr.icon;
                    const vis = trackVisible[tr.key];
                    return (
                      <div
                        key={tr.key}
                        className="h-10 px-2 flex items-center justify-between border-b border-[#1E1C2E]/80 text-[11px] text-zinc-200"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <Icon className="w-3 h-3 text-zinc-400 shrink-0" />
                          <span className="font-medium truncate">{tr.label}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setTrackVisible((prev) => ({ ...prev, [tr.key]: !prev[tr.key] }))}
                          className="text-zinc-400 hover:text-white cursor-pointer"
                        >
                          {vis ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-zinc-600" />}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Tracks Canvas */}
                <div className="flex-1 overflow-x-auto relative bg-[#0F0E18]">
                  <div
                    style={{ width: `${Math.max(100, timelineZoom * 100)}%` }}
                    className="min-w-full relative h-full flex flex-col"
                  >
                    {/* Ruler (Click to seek video frame) */}
                    <div
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                        handleSeek(parseFloat((pct * totalDuration).toFixed(2)));
                      }}
                      className="h-6 border-b border-[#252339] relative cursor-pointer bg-[#141320]"
                    >
                      {rulerTicks.map((tick) => (
                        <span
                          key={tick}
                          style={{ left: `${(tick / totalDuration) * 100}%` }}
                          className="absolute top-1 -translate-x-1/2 text-[10px] font-mono-num text-zinc-400 pointer-events-none"
                        >
                          {formatRulerTick(tick)}
                        </span>
                      ))}
                    </div>

                    {/* Video Track */}
                    <div
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        handleSeek(((e.clientX - rect.left) / rect.width) * totalDuration);
                      }}
                      className={`h-10 p-1 border-b border-[#1E1C2E]/80 cursor-pointer ${trackVisible.video ? 'opacity-100' : 'opacity-30'}`}
                    >
                      <VideoFilmstripTrack thumbnails={videoThumbnails} />
                    </div>

                    {/* BGM Waveform */}
                    <div
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        handleSeek(((e.clientX - rect.left) / rect.width) * totalDuration);
                      }}
                      className={`h-10 p-1 border-b border-[#1E1C2E]/80 cursor-pointer ${trackVisible.bgm ? 'opacity-100' : 'opacity-30'}`}
                    >
                      <BgmWaveformTrack bars={bgmWaveformBars} />
                    </div>

                    {/* Tap-to-Select Voice Clone Clips Track */}
                    <div
                      className={`h-10 p-1 border-b border-[#1E1C2E]/80 relative flex items-center ${
                        trackVisible.narrator ? 'opacity-100' : 'opacity-30'
                      }`}
                    >
                      {displaySegments.map((seg, idx) => {
                        const leftPct = Math.max(0, (seg.startTime / totalDuration) * 100);
                        const widthPct = Math.max(
                          4,
                          Math.min(100 - leftPct, ((seg.endTime - seg.startTime) / totalDuration) * 100)
                        );
                        const isTargetSelected =
                          selectedTarget?.segId === seg.id && selectedTarget?.track === 'voice';
                        const isPlayheadActive = activeSegment?.id === seg.id;

                        return (
                          <button
                            key={`vc_${seg.id}`}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              selectTimelineItem(seg, 'voice');
                            }}
                            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                            title="ထိ၍ Select လုပ်ပြီး Slider ဖြင့် Voice Clone နေရာရွှေ့ပါ"
                            className={`absolute top-1 bottom-1 rounded-md overflow-hidden cursor-pointer flex items-center px-1.5 transition-all ${
                              isTargetSelected
                                ? 'bg-[#362C7A] border-2 border-cyan-300 ring-2 ring-cyan-400/35 shadow-lg shadow-cyan-500/30 z-10'
                                : isPlayheadActive
                                  ? 'bg-[#2A225E] border border-[#8B5CF6] shadow-md shadow-violet-600/25'
                                  : 'bg-[#201A48] border border-[#4D3FA8]/80 hover:border-cyan-400/70'
                            }`}
                          >
                            <VoiceCloneClipBars bars={narratorWaveformBars} clipIndex={idx} />

                            <span className="absolute left-2 top-0.5 text-[9px] font-mono-num font-bold text-cyan-200 pointer-events-none drop-shadow">
                              🎙️ {formatRulerTick(seg.startTime)}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Tap-to-Select Subtitle Track */}
                    <div
                      className={`h-10 p-1 relative flex items-center ${
                        trackVisible.subtitle ? 'opacity-100' : 'opacity-30'
                      }`}
                    >
                      {displaySegments.map((seg) => {
                        const subStart = seg.subtitleStartTime ?? seg.startTime;
                        const subEnd = seg.subtitleEndTime ?? seg.endTime;
                        const leftPct = Math.max(0, (subStart / totalDuration) * 100);
                        const widthPct = Math.max(
                          4,
                          Math.min(100 - leftPct, ((subEnd - subStart) / totalDuration) * 100)
                        );
                        const isTargetSelected =
                          selectedTarget?.segId === seg.id && selectedTarget?.track === 'subtitle';
                        const isPlayheadActive = activeSubtitleSegment?.id === seg.id;

                        return (
                          <div
                            key={seg.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              selectTimelineItem(seg, 'subtitle');
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              setEditingSegId(seg.id);
                              setEditingSubText(seg.myanmarTranslation || '');
                            }}
                            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                            title="ထိ၍ Select လုပ်ပြီး Slider ဖြင့် Subtitle နေရာရွှေ့ပါ · Double-click ဖြင့် စာသားပြင်ပါ"
                            className={`absolute top-1 bottom-1 px-2.5 rounded-lg text-[10px] font-myanmar flex items-center cursor-pointer transition-all ${
                              isTargetSelected
                                ? 'bg-[#3C2F85] border-2 border-violet-300 ring-2 ring-violet-400/35 text-white shadow-lg shadow-violet-500/30 z-10'
                                : isPlayheadActive
                                  ? 'bg-[#2E2564] border border-[#8B5CF6] text-white'
                                  : 'bg-[#1E1A3B] border border-[#3B3370] text-zinc-200 hover:border-[#8B5CF6]'
                            }`}
                          >
                            <span className="truncate pointer-events-none select-none w-full">
                              {seg.myanmarTranslation}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Red Playhead */}
                    <div
                      style={{ left: `${playheadPct}%` }}
                      className="absolute top-0 bottom-0 pointer-events-none z-30"
                    >
                      <div className="w-[2px] h-full bg-[#EF4444]" />
                      <div className="absolute -top-0.5 -translate-x-1/2 px-1.5 py-0.5 rounded-full bg-[#EF4444] text-white text-[9px] font-mono-num font-bold shadow-md whitespace-nowrap">
                        {formatRulerTick(project.currentTime)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* BLUR EDITION PANEL */}
          {isBlurPanelOpen && (
            <div className="ios-card rounded-2xl overflow-hidden border border-cyan-500/40 shadow-2xl animate-fade-in mt-1">
              <div className="px-4 py-2.5 bg-gradient-to-r from-cyan-500/20 via-blue-500/15 to-[#1A1828] border-b border-cyan-500/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-cyan-500/30 text-cyan-300 border border-cyan-500/50 flex items-center justify-center font-bold text-xs">
                    BLUR
                  </div>
                  <span className="text-xs font-black text-white font-display">
                    BLUR EDITION PANEL (Video Privacy &amp; Blur Controls)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAddBlurBox}
                    className="px-3 py-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-zinc-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Blur Box</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsBlurPanelOpen(false)}
                    className="px-3 py-1 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-xs font-bold text-cyan-200 cursor-pointer shadow-sm transition-all"
                  >
                    Close Panel ✕
                  </button>
                </div>
              </div>

              <div className="p-3 bg-[#110F1B] max-h-[360px] overflow-y-auto space-y-3">
                {(!project.blurBoxes || project.blurBoxes.length === 0) ? (
                  <div className="text-center py-6 text-zinc-400 text-xs font-myanmar">
                    Blur box မရှိသေးပါ
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {project.blurBoxes.map((box, idx) => (
                      <div key={box.id} className="glass-card p-3 rounded-xl space-y-2 border border-white/10 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-cyan-300 flex items-center gap-1.5">
                            <EyeOff className="w-3.5 h-3.5 text-cyan-400" />
                            <span>Blur Box #{idx + 1}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteBlurBox(box.id)}
                            className="text-zinc-400 hover:text-rose-400 p-1 flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <div className="flex justify-between text-[11px] text-zinc-400">
                              <span>Intensity (အလင်းဝါး ပမာဏ):</span>
                              <span className="font-mono text-cyan-400 font-bold">{box.blurAmount}px</span>
                            </div>
                            <input
                              type="range"
                              min={4}
                              max={50}
                              step={1}
                              value={box.blurAmount}
                              onChange={(e) => handleUpdateBlurBox(box.id, { blurAmount: parseInt(e.target.value) })}
                              className="w-full h-2.5 bg-zinc-700 rounded-lg accent-cyan-400 cursor-pointer shadow-inner"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <div className="flex justify-between text-[10px] text-zinc-400">
                                <span>Width (အကျယ် %):</span>
                                <span className="font-mono text-zinc-300">{box.width}%</span>
                              </div>
                              <input
                                type="range"
                                min={10}
                                max={100}
                                step={1}
                                value={box.width}
                                onChange={(e) => handleUpdateBlurBox(box.id, { width: parseInt(e.target.value) })}
                                className="w-full h-2.5 bg-zinc-700 rounded-lg accent-cyan-400 cursor-pointer shadow-inner"
                              />
                            </div>
                            <div>
                              <div className="flex justify-between text-[10px] text-zinc-400">
                                <span>Height (အမြင့် %):</span>
                                <span className="font-mono text-zinc-300">{box.height}%</span>
                              </div>
                              <input
                                type="range"
                                min={5}
                                max={80}
                                step={1}
                                value={box.height}
                                onChange={(e) => handleUpdateBlurBox(box.id, { height: parseInt(e.target.value) })}
                                className="w-full h-2.5 bg-zinc-700 rounded-lg accent-cyan-400 cursor-pointer shadow-inner"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PRO EDITION PANEL: Step 8 ALIGHT MOTION & AUDIO/TTX SETTINGS (Appears below timeline when Pro Edition is toggled) */}
          {isProPanelOpen && (
            <div className="ios-card rounded-2xl overflow-hidden border border-amber-500/40 shadow-2xl animate-fade-in mt-1">
              <div className="px-4 py-2.5 bg-gradient-to-r from-amber-500/20 via-orange-500/15 to-[#1A1828] border-b border-amber-500/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-amber-500/30 text-amber-300 border border-amber-500/50 flex items-center justify-center font-bold text-xs">
                    PRO
                  </div>
                  <span className="text-xs font-black text-white font-display">
                    ALIGHT MOTION &amp; AUDIO / TTX SETTINGS (Pro Edition Panel)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsProPanelOpen(false)}
                  className="px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-xs font-bold text-amber-200 cursor-pointer shadow-sm transition-all"
                >
                  Close Panel ✕
                </button>
              </div>

              <div className="p-3 bg-[#110F1B] max-h-[420px] overflow-y-auto">
                <Step8AlightMotionSettings
                  project={project}
                  setProject={setProject}
                  selectedSegmentId={selectedSegmentId}
                  setSelectedSegmentId={setSelectedSegmentId}
                  isCatchUpModeActive={false}
                  setIsCatchUpModeActive={() => {}}
                  onSeekTo={handleSeek}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                  canUndo={undoStack.length > 0}
                  canRedo={redoStack.length > 0}
                  onPushHistory={pushHistory}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM STATUS FOOTER BAR */}
      <div className="px-4 py-2 bg-[#0B0A12] border-t border-[#222034] flex items-center justify-between text-[11px] text-zinc-400">
        <div className="flex items-center gap-2 truncate">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="text-zinc-200 truncate">{statusMessage}</span>
        </div>
      </div>
    </div>
  );
};
