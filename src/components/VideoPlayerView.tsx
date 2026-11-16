import React, { useRef, useEffect, useState } from 'react';
import {
  Play,
  Pause,
  Upload,
  RotateCcw,
  Volume2,
  VolumeX,
  Lock,
  FastForward,
  SkipBack,
  SkipForward,
  Film,
  Sparkles,
  Scissors,
  Edit3,
  Check,
  Volume1,
  Trash2,
  Zap,
  Music,
  Loader2,
  Download,
} from 'lucide-react';
import { ProjectState, SubtitleSettings, TranscriptSegment, AlightKeyframe, BlurBox, AspectRatioType } from '../types';
import { getInterpolatedKeyframe, getFilterCss } from '../utils/alightMotionRenderer';
import { extractBackgroundMusicFromVideo, extractBgmWithProgress } from '../utils/bgmExtractorClient';
import { inspectVideoFile } from '../utils/audioExtractor';
import { PREVIEW_AUDIO_STARTED_EVENT, stopAllPreviewAudio } from '../utils/audioPreviewManager';
import { UnifiedAudioMixer } from '../utils/audioMixerEngine';

interface VideoPlayerViewProps {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  activeSegment: TranscriptSegment | null;
  isCatchUpModeActive?: boolean;
  onCatchUpPlace?: (time: number) => void;
  selectedSegmentName?: string;
  showLalalBgmGenerator?: boolean;
}

export const VideoPlayerView: React.FC<VideoPlayerViewProps> = ({
  project,
  setProject,
  activeSegment,
  isCatchUpModeActive = false,
  onCatchUpPlace,
  selectedSegmentName,
  showLalalBgmGenerator = false,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioMixerRef = useRef<UnifiedAudioMixer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const isMuted = project.isMuted ?? false;
  const videoVolume = project.volume !== undefined ? project.volume : 0.8;
  const clonedVolume = project.voiceVolume !== undefined ? project.voiceVolume : 1.0;
  const bgmVolume = project.bgmVolume !== undefined ? project.bgmVolume : 0.35;
  const [isDragging, setIsDragging] = useState(false);
  const [editingText, setEditingText] = useState('');
  const [isExtractingBgm, setIsExtractingBgm] = useState(false);
  const [bgmError, setBgmError] = useState<string | null>(null);
  const [isGeneratingLalalBgm, setIsGeneratingLalalBgm] = useState(false);
  const [lalalPercent, setLalalPercent] = useState<number>(0);
  const [lalalStageLabel, setLalalStageLabel] = useState<string>('');
  const [showLalalBar, setShowLalalBar] = useState<boolean>(false);
  const [lalalError, setLalalError] = useState<string | null>(null);

  // Update inline editing text when active segment changes
  useEffect(() => {
    if (activeSegment) {
      setEditingText(activeSegment.myanmarTranslation || activeSegment.originalText);
    } else {
      setEditingText('');
    }
  }, [activeSegment?.id]);

  // Pause main player automatically if user clicks a preview clip anywhere in the studio
  useEffect(() => {
    const onPreviewStarted = () => {
      if (videoRef.current && !videoRef.current.paused) {
        videoRef.current.pause();
      }
      audioMixerRef.current?.stopAll();
      setProject((prev) => (prev.isPlaying ? { ...prev, isPlaying: false } : prev));
    };
    window.addEventListener(PREVIEW_AUDIO_STARTED_EVENT, onPreviewStarted);
    return () => window.removeEventListener(PREVIEW_AUDIO_STARTED_EVENT, onPreviewStarted);
  }, []);

  // Stop any stray preview clip when main VideoPlayerView starts playing
  useEffect(() => {
    if (project.isPlaying) {
      stopAllPreviewAudio();
    }
  }, [project.isPlaying]);

  // Dynamic Video playback speed based on project.playbackRate and active segment's videoPlaybackRate
  useEffect(() => {
    if (!videoRef.current) return;
    const v = videoRef.current;

    // Check if current playhead is inside a segment with specific videoPlaybackRate
    const curSeg = project.segments.find(
      (s) => project.currentTime >= s.startTime && project.currentTime <= s.endTime
    );
    const baseVideoSpeed = project.playbackRate || 1.0;
    const segSpeedMultiplier = curSeg?.videoPlaybackRate || 1.0;
    const targetVideoSpeed = parseFloat(Math.max(0.25, Math.min(3.0, baseVideoSpeed * segSpeedMultiplier)).toFixed(2));

    if (Math.abs(v.playbackRate - targetVideoSpeed) > 0.02) {
      v.playbackRate = targetVideoSpeed;
    }

    if (project.isPlaying && v.paused) {
      v.play().catch(() => {});
    } else if (!project.isPlaying && !v.paused) {
      v.pause();
    }
  }, [project.isPlaying, project.playbackRate, project.currentTime, project.segments]);

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

  // Unified Web Audio Mixer: combines Vocal-Removed BGM + Voice Clone into ONE glitch-free hardware bus
  const hasClonedVoices = project.segments.some((s) => Boolean(s.audioUrl));
  const shouldMuteOriginalVocals = Boolean(
    isMuted || (project.useExtractedBgm && project.extractedBgmUrl) || (hasClonedVoices && !project.isVoiceMuted)
  );

  useEffect(() => {
    const useBgm = Boolean(project.useExtractedBgm && project.extractedBgmUrl);
    if (videoRef.current) {
      videoRef.current.muted = shouldMuteOriginalVocals;
      videoRef.current.volume = shouldMuteOriginalVocals ? 0 : videoVolume;
    }

    const mixer = getMixer();
    mixer.sync({
      isPlaying: project.isPlaying,
      currentTime: project.currentTime,
      playbackRate: videoRef.current?.playbackRate || project.playbackRate || 1.0,
      isMuted,
      bgmUrl: project.extractedBgmUrl,
      isBgmEnabled: useBgm,
      bgmVolume,
      segments: project.segments,
      voiceSpeed: project.voicePlaybackRate || 1.0,
      isVoiceEnabled: !project.isVoiceMuted,
      voiceVolume: clonedVolume,
    });
  }, [
    project.useExtractedBgm,
    project.extractedBgmUrl,
    project.currentTime,
    project.isPlaying,
    project.playbackRate,
    project.segments,
    project.voicePlaybackRate,
    project.isVoiceMuted,
    videoVolume,
    bgmVolume,
    clonedVolume,
    isMuted,
    shouldMuteOriginalVocals,
  ]);

  const handleTogglePlay = () => {
    const willPlay = !project.isPlaying;
    const mixer = getMixer();
    setProject((prev) => ({ ...prev, isPlaying: willPlay }));
    if (willPlay) {
      stopAllPreviewAudio();
      mixer.unlock();
      mixer.sync(
        {
          isPlaying: true,
          currentTime: project.currentTime,
          playbackRate: videoRef.current?.playbackRate || project.playbackRate || 1.0,
          isMuted,
          bgmUrl: project.extractedBgmUrl,
          isBgmEnabled: Boolean(project.useExtractedBgm && project.extractedBgmUrl),
          bgmVolume,
          segments: project.segments,
          voiceSpeed: project.voicePlaybackRate || 1.0,
          isVoiceEnabled: !project.isVoiceMuted,
          voiceVolume: clonedVolume,
        },
        true
      );
    } else {
      mixer.stopAll();
    }
  };

  // Handle video seek with immediate audio alignment
  const handleSeek = (newTime: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = newTime;
    setProject((prev) => ({ ...prev, currentTime: newTime }));

    const mixer = getMixer();
    mixer.unlock();
    mixer.sync(
      {
        isPlaying: project.isPlaying,
        currentTime: newTime,
        playbackRate: videoRef.current?.playbackRate || project.playbackRate || 1.0,
        isMuted,
        bgmUrl: project.extractedBgmUrl,
        isBgmEnabled: Boolean(project.useExtractedBgm && project.extractedBgmUrl),
        bgmVolume,
        segments: project.segments,
        voiceSpeed: project.voicePlaybackRate || 1.0,
        isVoiceEnabled: !project.isVoiceMuted,
        voiceVolume: clonedVolume,
      },
      true
    );

    if (isCatchUpModeActive && onCatchUpPlace) {
      onCatchUpPlace(newTime);
    }
  };

  // Video time update loop
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    setProject((prev) => ({
      ...prev,
      currentTime: videoRef.current?.currentTime || 0,
      videoDuration: videoRef.current?.duration || prev.videoDuration,
    }));
  };

  // Handle Video File Upload + Automatic Video Inspection (Duration, Resolution, Audio Track)
  const handleFileUpload = (file: File) => {
    if (!file || !file.type.startsWith('video/')) return;
    const url = URL.createObjectURL(file);
    audioMixerRef.current?.stopAll();
    setBgmError(null);
    setLalalError(null);
    setLalalPercent(0);
    setLalalStageLabel('');
    setShowLalalBar(false);
    setProject((prev) => ({
      ...prev,
      videoFile: file,
      videoUrl: url,
      videoName: file.name,
      currentTime: 0,
      isPlaying: false,
      extractedBgmUrl: null,
      useExtractedBgm: false,
      bgmEngineUsed: null,
      videoInspection: null,
    }));
    inspectVideoFile(file, file.name)
      .then((info) => {
        setProject((prev) => ({
          ...prev,
          videoDuration: info.duration || prev.videoDuration,
          videoInspection: info,
        }));
      })
      .catch(() => {});
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  // Load sample demo video for instant testing
  const handleLoadDemo = () => {
    const demoUrl = '/api/narrator/sample-video';
    audioMixerRef.current?.stopAll();
    setBgmError(null);
    setLalalError(null);
    setLalalPercent(0);
    setLalalStageLabel('');
    setShowLalalBar(false);
    setProject((prev) => ({
      ...prev,
      videoFile: null,
      videoUrl: demoUrl,
      videoName: 'Sample_Action_Trailer.mp4',
      videoDuration: 12,
      currentTime: 0,
      isPlaying: false,
      extractedBgmUrl: null,
      useExtractedBgm: false,
      bgmEngineUsed: null,
    }));
  };

  // Extract vocal-removed Background music.mp3 using built-in server stem separator -> live 0%-100% progress -> attach as BGM
  const handleGenerateLalalBgm = async () => {
    if ((!project.videoFile && !project.videoUrl) || isGeneratingLalalBgm) return;
    setIsGeneratingLalalBgm(true);
    setShowLalalBar(true);
    setLalalError(null);
    setLalalPercent(1);
    setLalalStageLabel('Custom upload video မှ Background music.mp3 စတင်ခွဲထုတ်နေသည်...');

    try {
      const res = await extractBgmWithProgress(
        project.videoFile,
        project.videoUrl,
        project.videoName,
        (pct, label) => {
          setLalalPercent(pct);
          setLalalStageLabel(label);
        }
      );

      setLalalPercent(100);
      setLalalStageLabel('100% — Background music.mp3 ရရှိပြီး BGM အဖြစ် ထည့်သွင်းပြီးပါပြီ!');
      setProject((prev) => ({
        ...prev,
        extractedBgmUrl: res.bgmUrl,
        useExtractedBgm: true,
        bgmVolume: Math.max(0.45, prev.bgmVolume ?? 0.45),
        bgmEngineUsed: res.engineUsed,
      }));
    } catch (err: any) {
      setLalalError(err?.message || 'Background music.mp3 ထုတ်ယူမှု မအောင်မြင်ပါ');
    } finally {
      setIsGeneratingLalalBgm(false);
    }
  };

  // Extract Background Music / SFX Only (Built-in fallback / quick toolbar toggle)
  const handleExtractBgmOnly = async () => {
    if ((!project.videoFile && !project.videoUrl) || isExtractingBgm) return;
    setIsExtractingBgm(true);
    setBgmError(null);
    setLalalError(null);
    try {
      const res = await extractBackgroundMusicFromVideo(
        project.videoFile,
        project.videoUrl,
        project.videoName
      );
      setLalalPercent(100);
      setShowLalalBar(true);
      setLalalStageLabel('100% — Background music.mp3 ကို BGM အဖြစ် ထည့်သွင်းပြီးပါပြီ!');
      setProject((prev) => ({
        ...prev,
        extractedBgmUrl: res.bgmUrl,
        useExtractedBgm: true,
        bgmVolume: Math.max(0.45, prev.bgmVolume ?? 0.45),
        bgmEngineUsed: res.engineUsed,
      }));
    } catch (err: any) {
      setBgmError(err.message || 'နောက်ခံတီးလုံး ထုတ်ယူမှု မအောင်မြင်ပါ');
    } finally {
      setIsExtractingBgm(false);
    }
  };

  const formatSeconds = (sec: number): string => {
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${ms}`;
  };

  // Save inline edited subtitle
  const handleSaveInlineSubtitle = () => {
    if (!activeSegment) return;
    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) =>
        s.id === activeSegment.id ? { ...s, myanmarTranslation: editingText } : s
      ),
    }));
  };

  // Split video at playhead
  const handleSplitAtPlayhead = () => {
    const t = project.currentTime;
    if (activeSegment && t > activeSegment.startTime && t < activeSegment.endTime) {
      const seg1: TranscriptSegment = {
        ...activeSegment,
        endTime: parseFloat(t.toFixed(2)),
      };
      const seg2: TranscriptSegment = {
        id: 'seg_' + Date.now(),
        startTime: parseFloat((t + 0.05).toFixed(2)),
        endTime: activeSegment.endTime,
        originalText: activeSegment.originalText + ' (Part 2)',
        myanmarTranslation: activeSegment.myanmarTranslation + ' (အပိုင်း ၂)',
        voice: activeSegment.voice,
      };

      const newSegments = [...project.segments];
      const targetIdx = newSegments.findIndex((s) => s.id === activeSegment.id);
      if (targetIdx !== -1) {
        newSegments.splice(targetIdx, 1, seg1, seg2);
        setProject((prev) => ({ ...prev, segments: newSegments }));
      }
    }
  };

  // Interpolated Alight Motion keyframe properties
  const kf = getInterpolatedKeyframe(project.keyframes, project.currentTime);
  const filterCss = getFilterCss(kf.filter);
  const shakeOffsetX = kf.shakeIntensity > 0 ? (Math.random() - 0.5) * kf.shakeIntensity * 4 : 0;
  const shakeOffsetY = kf.shakeIntensity > 0 ? (Math.random() - 0.5) * kf.shakeIntensity * 4 : 0;

  const ratio = project.aspectRatio || '9:16';
  const crop = project.frameCrop || {
    fitMode: 'cover',
    scale: 1.0,
    posX: 0,
    posY: 0,
    backgroundStyle: 'blur',
  };

  const getContainerAspectClass = () => {
    switch (ratio) {
      case '9:16':
        return 'rounded-2xl border border-zinc-800 shadow-2xl';
      case '1:1':
        return 'rounded-2xl border border-zinc-800 shadow-2xl';
      case '4:5':
        return 'rounded-2xl border border-zinc-800 shadow-2xl';
      case '16:9':
      default:
        return 'rounded-xl border border-zinc-800 shadow-2xl';
    }
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
          maxHeight: '440px',
        };
    }
  };

  return (
    <div className="glass-panel rounded-2xl overflow-hidden flex flex-col shadow-2xl relative z-10">

      {/* Viewport Top Bar */}
      <div className="px-4 py-3 bg-white/5 backdrop-blur-md border-b border-white/10 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 truncate">
          <Film className="w-4 h-4 text-cyan-400 shrink-0" />
          <span className="font-bold text-white truncate max-w-xs font-display">
            {project.videoName || 'No Video Loaded'}
          </span>
          <span className="px-2 py-0.5 rounded-full text-[10px] bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 shrink-0 font-mono font-bold">
            {ratio}
          </span>
          {project.videoInspection && (
            <span
              className="px-2 py-0.5 rounded-full text-[10px] bg-indigo-500/15 border border-indigo-400/30 text-indigo-200 shrink-0 font-mono flex items-center gap-1.5"
              title="မူရင်းဗီဒီယို စစ်ဆေးမှုရလဒ် (ကြာချိန် / ရုပ်ထွက် / အသံဖိုင်)"
            >
              <span>{project.videoInspection.resolution}</span>
              <span className="text-zinc-500">·</span>
              <span>{Math.floor(project.videoInspection.duration / 60)}:{String(Math.floor(project.videoInspection.duration % 60)).padStart(2, '0')}</span>
              <span className="text-zinc-500">·</span>
              <span className={project.videoInspection.hasAudio ? 'text-emerald-300' : 'text-amber-300'}>
                {project.videoInspection.hasAudio ? 'Audio OK' : 'Silent'}
              </span>
            </span>
          )}
          {project.smartSyncFrameLock && (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 flex items-center gap-1 shrink-0 font-medium">
              <Lock className="w-2.5 h-2.5" />
              <span>Frame Lock</span>
            </span>
          )}
          {activeSegment?.videoPlaybackRate && Math.abs(activeSegment.videoPlaybackRate - 1.0) > 0.03 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/10 border border-amber-500/30 text-amber-300 font-mono font-bold flex items-center gap-1 shrink-0 animate-pulse">
              <Zap className="w-2.5 h-2.5 text-amber-400" />
              <span>{activeSegment.videoPlaybackRate.toFixed(2)}x</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3.5 py-1.5 text-xs font-bold text-zinc-950 bg-gradient-to-r from-cyan-400 to-teal-400 hover:opacity-90 rounded-xl transition-all flex items-center gap-1.5 shadow-md shadow-cyan-500/20 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Video</span>
          </button>
          {!project.videoUrl && (
            <button
              onClick={handleLoadDemo}
              className="px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:text-cyan-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all flex items-center gap-1 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>Sample</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
          />
        </div>
      </div>

      {/* Real Video Viewport with Live Platform Aspect Ratio & Frame Crop */}
      <div className="w-full flex items-center justify-center p-3 bg-zinc-950/70 border-b border-zinc-800/60 overflow-hidden">
        <div
          className={`relative bg-black flex items-center justify-center overflow-hidden select-none transition-all ${getContainerAspectClass()} ${
            isDragging ? 'ring-2 ring-cyan-500 ring-inset' : ''
          }`}
          style={getContainerViewportStyle()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
        {project.videoUrl ? (
          <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
            {/* Blurred Video Backdrop when Letterboxed Contain */}
            {crop.fitMode === 'contain' && crop.backgroundStyle === 'blur' && (
              <video
                src={project.videoUrl}
                className="absolute inset-0 w-full h-full object-cover filter blur-xl opacity-40 scale-110 pointer-events-none"
                muted
              />
            )}

            {/* Catch-Up Mode Active Overlay Banner */}
            {isCatchUpModeActive && (
              <div className="absolute top-2 left-2 right-2 z-30 bg-emerald-950/95 border border-emerald-500/80 px-3 py-1.5 rounded-lg text-xs text-emerald-200 flex items-center justify-between shadow-2xl backdrop-blur-md animate-pulse">
                <div className="flex items-center gap-2 truncate">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0"></span>
                  <span className="font-myanmar truncate font-medium">
                    🎯 Catch-Up Mode: ဗီဒီယို Scrub Bar သို့မဟုတ် ဗီဒီယိုပေါ်တွင် Click နှိပ်လိုက်သည့် အချိန်သို့ အသံ & TTX ကွက်တိ ရောက်သွားပါမည်။
                  </span>
                </div>
                {selectedSegmentName && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-900 border border-emerald-600 font-myanmar text-white font-semibold shrink-0 ml-2">
                    {selectedSegmentName}
                  </span>
                )}
              </div>
            )}

            {/* Direct Visible HTML5 Video with Platform Crop & Fit Transform */}
            <div
              className="w-full h-full flex items-center justify-center transition-transform duration-75 overflow-hidden"
              style={{
                transform: `scale(${kf.scale * (crop.scale || 1.0)}) translate(${(kf.posX + shakeOffsetX) + (crop.posX || 0)}px, ${(kf.posY + shakeOffsetY) + (crop.posY || 0)}px) rotate(${kf.rotation}deg)`,
                opacity: Math.max(0, Math.min(1, kf.opacity)),
              }}
            >
              <video
                ref={videoRef}
                src={project.videoUrl}
                muted={shouldMuteOriginalVocals}
                className={`w-full h-full cursor-pointer ${
                  crop.fitMode === 'cover' ? 'object-cover' : 'object-contain'
                }`}
                style={{
                  filter: [filterCss, getFilterCss(project.globalColorFilter), kf.blur > 0 ? `blur(${kf.blur}px)` : ''].filter(f => f !== 'none' && f !== '').join(' ') || 'none',
                }}
                playsInline
                onClick={handleTogglePlay}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={() => {
                  if (videoRef.current) {
                    const v = videoRef.current;
                    const vw = v.videoWidth || 1;
                    const vh = v.videoHeight || 1;
                    const ratioVal = vw / vh;
                    let detectedRatio: AspectRatioType = '9:16';
                    if (ratioVal > 1.25) {
                      detectedRatio = '16:9';
                    } else if (ratioVal >= 0.88 && ratioVal <= 1.15) {
                      detectedRatio = '1:1';
                    } else if (ratioVal > 0.68 && ratioVal < 0.88) {
                      detectedRatio = '4:5';
                    } else {
                      detectedRatio = '9:16';
                    }

                    const anyVid = v as any;
                    const detectedHasAudio =
                      typeof anyVid.mozHasAudio === 'boolean'
                        ? anyVid.mozHasAudio
                        : anyVid.audioTracks && typeof anyVid.audioTracks.length === 'number'
                          ? anyVid.audioTracks.length > 0
                          : (project.videoInspection?.hasAudio ?? true);

                    setProject((prev) => ({
                      ...prev,
                      videoDuration: v.duration || 0,
                      aspectRatio: detectedRatio,
                      videoInspection: prev.videoInspection
                        ? {
                            ...prev.videoInspection,
                            duration: v.duration || prev.videoInspection.duration,
                            width: vw,
                            height: vh,
                            resolution: `${vw}x${vh}`,
                          }
                        : {
                            duration: v.duration || 0,
                            width: vw,
                            height: vh,
                            resolution: `${vw}x${vh}`,
                            hasAudio: detectedHasAudio,
                            format: (prev.videoName.split('.').pop() || 'mp4').toLowerCase(),
                            filesize: prev.videoFile?.size || 0,
                            inspectedAt: Date.now(),
                          },
                    }));
                  }
                }}
                onEnded={() => setProject((prev) => ({ ...prev, isPlaying: false }))}
              />
            </div>

            {/* INTERACTIVE BLUR BOX OVERLAYS (USER REQUESTED FEATURE) */}
            {project.blurBoxes && project.blurBoxes.map((b) => (
              <InteractiveBlurBox
                key={b.id}
                blurBox={b}
                onUpdate={(updated) => {
                  setProject((prev) => ({
                    ...prev,
                    blurBoxes: prev.blurBoxes.map((box) => (box.id === b.id ? updated : box)),
                  }));
                }}
                onDelete={() => {
                  setProject((prev) => ({
                    ...prev,
                    blurBoxes: prev.blurBoxes.filter((box) => box.id !== b.id),
                  }));
                }}
              />
            ))}

            {/* FIXED LOGO OVERLAY (USER REQUESTED FEATURE) */}
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

            {/* ANIMATED TEXT WATERMARK OVERLAY (USER REQUESTED FEATURE) */}
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

            {/* Live On-Video Myanmar Subtitle Overlay (Step 6) - DRAGGABLE */}
            {activeSegment && (
              <>
                {/* Lip-Sync Sync Engine HUD Badge */}
                <div className="absolute top-3 left-3 z-30 pointer-events-none flex items-center gap-2 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-full border border-cyan-500/30 text-[10px] shadow-lg animate-fade-in">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  <span className="font-bold text-white font-mono">
                    🎙️ {activeSegment.speaker || 'Adult Male (သီဟ)'}
                  </span>
                  <span className="text-zinc-400 font-mono">
                    | {(activeSegment.atempoRate || 1.0).toFixed(2)}x atempo
                  </span>
                  <span className="text-cyan-300 font-mono">
                    | Lip-Sync: Active
                  </span>
                </div>

                <InteractiveSubtitleOverlay
                  text={activeSegment.myanmarTranslation || activeSegment.originalText}
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
              </>
            )}
          </div>
        ) : (
          /* Empty / Upload Dropzone State */
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center p-8 text-center cursor-pointer group"
          >
            <div className="w-14 h-14 rounded-2xl bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-center text-zinc-400 group-hover:text-cyan-400 group-hover:border-cyan-500/40 group-hover:scale-105 transition-all mb-3 shadow-lg">
              <Upload className="w-7 h-7" />
            </div>
            <h3 className="text-sm font-semibold text-zinc-100 mb-1">
              Custom Upload Video ထည့်သွင်းရန် (Click or Drag File Here)
            </h3>
            <p className="text-xs text-zinc-400 max-w-sm font-myanmar leading-relaxed">
              MP4, WebM, MOV ဖိုင်များကို တင်လိုက်သည်နှင့် ဗီဒီယို ပေါ်လာမည်ဖြစ်ပြီး အသံနှင့် စာတန်းထိုးများကို ကွက်တိ တိုက်ဆိုင်ပြင်ဆင်နိုင်ပါမည်။
            </p>
            <div className="mt-4 flex items-center gap-2">
              <span className="text-[11px] text-zinc-500">သို့မဟုတ် ချက်ချင်း စမ်းသပ်ရန်</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleLoadDemo();
                }}
                className="px-2.5 py-1 text-xs text-cyan-400 bg-cyan-950/60 border border-cyan-800/60 rounded-md hover:bg-cyan-900/60 transition-colors"
              >
                Sample Action Video စမ်းတင်မည်
              </button>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Step 2: Under-Video Built-in BGM Generator & Live 0%-100% Percentage Bar */}
      {showLalalBgmGenerator && project.videoUrl && (
        <div className="px-4 py-3.5 bg-zinc-950/95 border-b border-zinc-800/80 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500/20 to-emerald-500/20 border border-cyan-500/30 flex items-center justify-center shrink-0">
                <Music className="w-4 h-4 text-cyan-300" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-white font-display">
                    Auto Background Music (.mp3) Generator
                  </span>
                  {project.useExtractedBgm && project.extractedBgmUrl && (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-[10px] font-bold text-emerald-300">
                      ✓ BGM.mp3 Active
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-zinc-400 font-myanmar mt-0.5">
                  Custom Upload Video ထဲမှ လူစကားပြောသံ (Vocals) များကို Demucs v4 AI (htdemucs) ဖြင့် ဖယ်ရှားပြီး Background music.mp3 ကို BGM အဖြစ် ထည့်သွင်းပေးပါမည် (API Key မလိုပါ)။
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleGenerateLalalBgm}
                disabled={isGeneratingLalalBgm || isExtractingBgm}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 hover:opacity-95 disabled:opacity-60 text-zinc-950 text-xs font-black shadow-lg shadow-cyan-500/25 flex items-center gap-2 cursor-pointer transition-all active:scale-95"
              >
                {isGeneratingLalalBgm ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                <span>
                  {isGeneratingLalalBgm
                    ? `Generating... (${lalalPercent}%)`
                    : project.extractedBgmUrl
                    ? 'Generate Again'
                    : 'Generate'}
                </span>
              </button>
            </div>
          </div>

          {/* Live 0% - 100% Percentage Bar directly below Generate button */}
          {(showLalalBar || isGeneratingLalalBgm || Boolean(project.extractedBgmUrl)) && (
            <div className="p-3 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-cyan-200 font-myanmar truncate">
                  {lalalStageLabel ||
                    (project.extractedBgmUrl
                      ? '100% — Background music.mp3 ကို BGM အဖြစ် ထည့်သွင်းပြီးပါပြီ!'
                      : 'Background music.mp3 ထုတ်ယူနေသည်...')}
                </span>
                <span
                  className={`font-mono font-black tabular-nums shrink-0 ${
                    (project.extractedBgmUrl && !isGeneratingLalalBgm ? 100 : lalalPercent) >= 100
                      ? 'text-emerald-400'
                      : 'text-cyan-300'
                  }`}
                >
                  {project.extractedBgmUrl && !isGeneratingLalalBgm ? 100 : lalalPercent}%
                </span>
              </div>

              <div className="w-full h-2.5 bg-zinc-950 rounded-full overflow-hidden border border-zinc-800">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    (project.extractedBgmUrl && !isGeneratingLalalBgm ? 100 : lalalPercent) >= 100
                      ? 'bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400'
                      : 'bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400'
                  }`}
                  style={{
                    width: `${Math.max(
                      2,
                      Math.min(100, project.extractedBgmUrl && !isGeneratingLalalBgm ? 100 : lalalPercent)
                    )}%`,
                  }}
                />
              </div>

              {project.extractedBgmUrl && !isGeneratingLalalBgm && (
                <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold font-myanmar">
                      🎵 Background music.mp3 ({project.bgmEngineUsed === 'demucs' || project.bgmEngineUsed === 'demucs_ai' ? 'Demucs v4 AI · Vocals Removed' : project.bgmEngineUsed === 'bs_roformer_ai' ? 'BS-RoFormer AI · Vocals Removed' : 'BGM Active'})
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setProject((prev) => ({
                          ...prev,
                          useExtractedBgm: !prev.useExtractedBgm,
                        }))
                      }
                      className={`px-2 py-0.5 rounded border text-[10px] font-bold cursor-pointer transition-colors ${
                        project.useExtractedBgm
                          ? 'bg-emerald-500 text-zinc-950 border-emerald-400'
                          : 'bg-zinc-800 text-zinc-300 border-zinc-700'
                      }`}
                    >
                      {project.useExtractedBgm ? 'BGM: ON (Original Vocals Muted)' : 'BGM: OFF'}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <audio
                      controls
                      src={project.extractedBgmUrl}
                      className="h-7 max-w-[210px]"
                    />
                    <a
                      href={project.extractedBgmUrl}
                      download={`${(project.videoName || 'video').replace(/\.[^/.]+$/, '')}_background_music.mp3`}
                      className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-cyan-300 text-[10px] font-bold flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" />
                      <span>MP3</span>
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}

          {lalalError && (
            <div className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-500/35 text-[11px] text-rose-200 font-myanmar">
              <span>⚠️ {lalalError}</span>
            </div>
          )}
        </div>
      )}

      {/* Scrub Bar & Time Display */}
      <div className="px-4 pt-3 pb-1 bg-zinc-950/90 border-t border-zinc-800/80">
        <div className="relative group flex items-center">
          <input
            type="range"
            min={0}
            max={project.videoDuration || 100}
            step={0.01}
            value={project.currentTime}
            onChange={(e) => handleSeek(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-between text-[11px] font-mono-num text-zinc-400 mt-1">
          <span>{formatSeconds(project.currentTime)}</span>
          <span>{formatSeconds(project.videoDuration)}</span>
        </div>
      </div>

      {/* Playback Controls & Dual Audio Volume Balance */}
      <div className="px-4 py-3 bg-zinc-950 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80">
        {/* Playback Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => handleSeek(Math.max(0, project.currentTime - 1))}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
            title="Step Back 1s"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            onClick={handleTogglePlay}
            className="w-9 h-9 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-zinc-950 flex items-center justify-center font-bold transition-all shadow-md shadow-cyan-500/20"
          >
            {project.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>

          <button
            onClick={() => handleSeek(Math.min(project.videoDuration, project.currentTime + 1))}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
            title="Step Forward 1s"
          >
            <SkipForward className="w-4 h-4" />
          </button>

          <button
            onClick={() => handleSeek(0)}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors ml-1"
            title="Restart"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={handleSplitAtPlayhead}
            className="ml-2 px-2.5 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg transition-colors flex items-center gap-1"
            title="Split active segment at playhead"
          >
            <Scissors className="w-3 h-3 text-cyan-400" />
            <span>Split Clip</span>
          </button>
        </div>

        {/* Video Speed Only Controls (Video Only - Audio Unaffected) */}
        <div className="flex items-center gap-2.5 bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-1.5">
            <FastForward className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-medium text-zinc-300">Video Speed:</span>
            <span className="text-xs font-mono-num text-cyan-400 font-semibold">
              {project.playbackRate.toFixed(2)}x
            </span>
          </div>

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
            className="w-20 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            title="Video Speed Only Adjustment: Scales video playback without altering voice audio speed"
          />

          <button
            onClick={() =>
              setProject((prev) => ({
                ...prev,
                smartSyncFrameLock: !prev.smartSyncFrameLock,
              }))
            }
            className={`px-2 py-0.5 text-[10px] rounded transition-colors flex items-center gap-1 font-medium ${
              project.smartSyncFrameLock
                ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/60'
                : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
            title="Frame lock: Keeps video frames strictly synced without drift"
          >
            <Lock className="w-2.5 h-2.5" />
            <span>Frame Lock</span>
          </button>
        </div>


        {/* Dual Audio Volume Mix & Vocal-Removed BGM Extractor */}
        <div className="flex flex-wrap items-center gap-3 bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800 text-xs">
          {/* Original / BGM Audio Toggle */}
          <button
            type="button"
            onClick={handleExtractBgmOnly}
            disabled={isExtractingBgm || !project.videoUrl}
            className={`px-2.5 py-1 rounded-md border text-[11px] font-bold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 ${
              project.useExtractedBgm && project.extractedBgmUrl
                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                : 'bg-cyan-500/15 hover:bg-cyan-500/25 border-cyan-500/40 text-cyan-300'
            }`}
            title="Custom Video ထဲမှ လူစကားပြောသံများ ဖယ်ရှားပြီး နောက်ခံတီးလုံး/SFX သီးသန့် ပြန်ထုတ်သုံးမည်"
          >
            {isExtractingBgm ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
            ) : (
              <Music className="w-3.5 h-3.5" />
            )}
            <span>
              {isExtractingBgm
                ? 'တီးလုံးခွဲထုတ်နေသည်...'
                : project.extractedBgmUrl
                ? '🔄 BGM ပြန်ထုတ်မည်'
                : '🎵 BGM Only ထုတ်သုံးမည်'}
            </span>
          </button>

          {project.extractedBgmUrl && (
            <>
              <button
                type="button"
                onClick={() =>
                  setProject((prev) => ({
                    ...prev,
                    useExtractedBgm: !prev.useExtractedBgm,
                  }))
                }
                className={`px-2 py-1 rounded-md text-[10px] font-bold border transition-all cursor-pointer ${
                  project.useExtractedBgm
                    ? 'bg-emerald-500 text-zinc-950 border-emerald-400'
                    : 'bg-zinc-800 text-zinc-300 border-zinc-700'
                }`}
              >
                {project.useExtractedBgm ? '✓ BGM Only (No Vocals)' : 'Original Audio'}
              </button>

              <a
                href={project.extractedBgmUrl}
                download={`${(project.videoName || 'video').replace(/\.[^/.]+$/, '')}_bgm_only.mp3`}
                className="p-1 text-cyan-300 hover:text-cyan-200 bg-zinc-800 hover:bg-zinc-700 rounded border border-zinc-700"
                title="Extracted BGM (.mp3) Download"
              >
                <Download className="w-3.5 h-3.5" />
              </a>
            </>
          )}

          {/* Video or BGM Volume */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setProject((prev) => ({ ...prev, isMuted: !isMuted }))}
              className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
              title={isMuted ? 'အသံ ပြန်ဖွင့်မည် (Unmute)' : 'အသံ ပိတ်မည် (Mute)'}
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <span className="text-[11px] text-zinc-400">
              {project.useExtractedBgm && project.extractedBgmUrl ? 'BGM Vol:' : 'Video Vol:'}
            </span>
            {hasClonedVoices && !project.useExtractedBgm && !project.isVoiceMuted && (
              <span
                className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[9px] text-emerald-300 font-myanmar"
                title="Voice Clone အသံနှင့် မထပ်စေရန် မူရင်း Video လူအသံကို အလိုအလျောက် ပိတ်ထားပါသည်"
              >
                🔇 Original Muted
              </span>
            )}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : (project.useExtractedBgm && project.extractedBgmUrl ? bgmVolume : videoVolume)}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setProject((prev) => ({
                  ...prev,
                  ...(prev.useExtractedBgm && prev.extractedBgmUrl ? { bgmVolume: val } : { volume: val }),
                  isMuted: val === 0,
                }));
              }}
              className="w-16 h-1 bg-zinc-800 rounded appearance-none accent-zinc-400"
            />
          </div>

          <span className="text-zinc-700">|</span>

          {/* Cloned Voice Volume */}
          <div className="flex items-center gap-1.5">
            <Volume1 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[11px] text-emerald-300">Voice Vol:</span>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={clonedVolume}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setProject((prev) => ({ ...prev, voiceVolume: val }));
              }}
              className="w-16 h-1 bg-zinc-800 rounded appearance-none accent-emerald-400"
            />
          </div>
        </div>
      </div>

      {bgmError && (
        <div className="px-4 py-1.5 bg-rose-950/60 border-b border-rose-500/30 text-[11px] text-rose-300 font-myanmar">
          ⚠️ {bgmError}
        </div>
      )}

      {/* Inline Subtitle Quick Editor Bar */}
      {activeSegment && (
        <div className="px-4 py-2.5 bg-zinc-950 flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Edit3 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="text-[11px] text-zinc-400 shrink-0">
              Active Subtitle ({activeSegment.startTime.toFixed(1)}s - {activeSegment.endTime.toFixed(1)}s):
            </span>
          </div>

          <div className="flex items-center gap-2 w-full sm:flex-1">
            <input
              type="text"
              value={editingText}
              onChange={(e) => setEditingText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveInlineSubtitle()}
              placeholder="မြန်မာစာတန်းထိုး ပြင်ဆင်ရန်..."
              className="flex-1 px-3 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs font-myanmar text-zinc-100 focus:outline-none focus:border-cyan-500"
            />
            <button
              onClick={handleSaveInlineSubtitle}
              className="px-3 py-1 bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-medium rounded transition-colors flex items-center gap-1 shrink-0"
            >
              <Check className="w-3 h-3" />
              <span>Save Edit</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export interface InteractiveBlurBoxProps {
  blurBox: BlurBox;
  onUpdate: (updated: BlurBox) => void;
  onDelete: () => void;
}

export const InteractiveBlurBox: React.FC<InteractiveBlurBoxProps> = ({ blurBox, onUpdate, onDelete }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [showDeleteMenu, setShowDeleteMenu] = useState(false);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Mouse & Touch Dragging State
  const [isDraggingMove, setIsDraggingMove] = useState(false);
  const [isDraggingResize, setIsDraggingResize] = useState(false);
  const startPosRef = useRef<{ mouseX: number; mouseY: number; boxX: number; boxY: number; boxW: number; boxH: number }>({
    mouseX: 0,
    mouseY: 0,
    boxX: blurBox.x,
    boxY: blurBox.y,
    boxW: blurBox.width,
    boxH: blurBox.height,
  });

  const handlePressStart = () => {
    longPressTimerRef.current = setTimeout(() => {
      setShowDeleteMenu(true);
    }, 400);
  };

  const handlePressEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
  };

  const handleMoveStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    handlePressStart();
    setIsDraggingMove(true);

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    startPosRef.current = {
      mouseX: clientX,
      mouseY: clientY,
      boxX: blurBox.x,
      boxY: blurBox.y,
      boxW: blurBox.width,
      boxH: blurBox.height,
    };
  };

  const handleResizeStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setIsDraggingResize(true);

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    startPosRef.current = {
      mouseX: clientX,
      mouseY: clientY,
      boxX: blurBox.x,
      boxY: blurBox.y,
      boxW: blurBox.width,
      boxH: blurBox.height,
    };
  };

  useEffect(() => {
    if (!isDraggingMove && !isDraggingResize) return;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      const deltaX = clientX - startPosRef.current.mouseX;
      const deltaY = clientY - startPosRef.current.mouseY;

      let pxToPercentX = 0.2;
      let pxToPercentY = 0.2;
      const parentEl = boxRef.current?.parentElement;
      if (parentEl) {
        const rect = parentEl.getBoundingClientRect();
        if (rect.width > 0) pxToPercentX = 100 / rect.width;
        if (rect.height > 0) pxToPercentY = 100 / rect.height;
      }

      if (isDraggingMove) {
        const newX = Math.max(0, Math.min(100 - blurBox.width, startPosRef.current.boxX + deltaX * pxToPercentX));
        const newY = Math.max(0, Math.min(100 - blurBox.height, startPosRef.current.boxY + deltaY * pxToPercentY));
        onUpdate({ ...blurBox, x: parseFloat(newX.toFixed(1)), y: parseFloat(newY.toFixed(1)) });
      } else if (isDraggingResize) {
        const newW = Math.max(5, Math.min(100 - blurBox.x, startPosRef.current.boxW + deltaX * pxToPercentX));
        const newH = Math.max(5, Math.min(100 - blurBox.y, startPosRef.current.boxH + deltaY * pxToPercentY));
        onUpdate({ ...blurBox, width: parseFloat(newW.toFixed(1)), height: parseFloat(newH.toFixed(1)) });
      }
    };

    const handlePointerUp = () => {
      setIsDraggingMove(false);
      setIsDraggingResize(false);
      handlePressEnd();
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove);
    window.addEventListener('touchend', handlePointerUp);

    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
    };
  }, [isDraggingMove, isDraggingResize, blurBox]);

  return (
    <div
      ref={boxRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseDown={handleMoveStart}
      onTouchStart={handleMoveStart}
      onClick={(e) => {
        e.stopPropagation();
        setShowDeleteMenu(!showDeleteMenu);
      }}
      className={`absolute z-20 cursor-move select-none rounded-md transition-all ${
        isHovered || showDeleteMenu || isDraggingMove || isDraggingResize
          ? 'border-2 border-dashed border-amber-400 bg-amber-500/10 shadow-xl ring-2 ring-amber-400/40'
          : 'border border-amber-400/50 bg-black/10'
      }`}
      style={{
        left: `${blurBox.x}%`,
        top: `${blurBox.y}%`,
        width: `${blurBox.width}%`,
        height: `${blurBox.height}%`,
        backdropFilter: `blur(${blurBox.blurAmount}px)`,
        WebkitBackdropFilter: `blur(${blurBox.blurAmount}px)`,
      }}
    >
      {/* Resize Corner Handle at Bottom-Right */}
      <div
        onMouseDown={handleResizeStart}
        onTouchStart={handleResizeStart}
        className="absolute bottom-0 right-0 w-5 h-5 bg-amber-400 hover:bg-amber-300 rounded-tl cursor-nwse-resize flex items-center justify-center text-zinc-950 shadow-md transition-transform"
        title="လက်ဖြင့် ဆွဲ၍ အတိုအရှည် အနိမ့်အမြင့် ချိန်ရန် (Drag Corner to Resize)"
      >
        <span className="text-[10px] font-bold">↘</span>
      </div>

      {/* Floating Delete Button (On Long-Press or Click) */}
      {(showDeleteMenu || isHovered) && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute -top-3 -right-3 z-30 px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] rounded-full shadow-2xl border border-rose-300 flex items-center gap-1 cursor-pointer"
          title="Blur အကွက်ကို ဖျက်မည်"
        >
          <Trash2 className="w-3 h-3" />
          <span>ဖျက်မည်</span>
        </button>
      )}
    </div>
  );
};

export interface InteractiveSubtitleOverlayProps {
  text: string;
  settings: SubtitleSettings;
  onUpdateOffset: (offsetX: number, offsetY: number) => void;
}

export const InteractiveSubtitleOverlay: React.FC<InteractiveSubtitleOverlayProps> = ({
  text,
  settings,
  onUpdateOffset,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const startRef = useRef({ mouseX: 0, mouseY: 0, startOffsetX: 0, startOffsetY: 0 });

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setIsDragging(true);

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    startRef.current = {
      mouseX: clientX,
      mouseY: clientY,
      startOffsetX: settings.offsetX || 0,
      startOffsetY: settings.offsetY || 0,
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      const deltaX = clientX - startRef.current.mouseX;
      const deltaY = clientY - startRef.current.mouseY;

      onUpdateOffset(
        startRef.current.startOffsetX + deltaX,
        startRef.current.startOffsetY + deltaY
      );
    };

    const handlePointerUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove);
    window.addEventListener('touchend', handlePointerUp);

    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
    };
  }, [isDragging]);

  const basePositionYClass =
    settings.positionY === 'top'
      ? 'top-6'
      : settings.positionY === 'center'
      ? 'top-1/2 -translate-y-1/2'
      : 'bottom-8';

  return (
    <div
      className={`absolute left-0 right-0 px-3 text-center z-20 flex items-center justify-center pointer-events-auto ${basePositionYClass}`}
    >
      <div
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onMouseDown={handlePointerDown}
        onTouchStart={handlePointerDown}
        style={{
          fontFamily: `'${settings.fontFamily}', 'Pyidaungsu', 'Noto Sans Myanmar', sans-serif`,
          fontSize: `${settings.fontSize}px`,
          color: settings.color,
          textShadow: `
            -${settings.strokeWidth}px -${settings.strokeWidth}px 0 ${settings.strokeColor},
            ${settings.strokeWidth}px -${settings.strokeWidth}px 0 ${settings.strokeColor},
            -${settings.strokeWidth}px ${settings.strokeWidth}px 0 ${settings.strokeColor},
            ${settings.strokeWidth}px ${settings.strokeWidth}px 0 ${settings.strokeColor},
            0 2px 4px rgba(0,0,0,0.85)
          `,
          backgroundColor: settings.backgroundColor,
          transform: `translate(${settings.offsetX || 0}px, ${settings.offsetY || 0}px)`,
          maxWidth: '88%',
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
        }}
        className={`relative px-4 py-1.5 rounded-lg font-semibold font-myanmar text-center whitespace-pre-wrap leading-relaxed select-none inline-block shadow-lg cursor-grab active:cursor-grabbing transition-all ${
          isHovered || isDragging
            ? 'ring-2 ring-cyan-400 ring-offset-2 ring-offset-black/60 shadow-cyan-500/30'
            : ''
        }`}
        title="လက်ဖြင့် Mouse ဖြင့် ဖိဆွဲ၍ စာတန်းထိုး နေရာ စိတ်ကြိုက်ရွှေ့ပါ (Drag to Reposition Subtitle)"
      >
        {text}
        {(isHovered || isDragging) && (
          <span className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-cyan-950/90 border border-cyan-400 text-[10px] text-cyan-200 font-sans font-medium whitespace-nowrap shadow pointer-events-none">
            🖐️ Drag Subtitle Position
          </span>
        )}
      </div>
    </div>
  );
};
