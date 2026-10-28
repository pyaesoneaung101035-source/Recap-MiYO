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
} from 'lucide-react';
import { ProjectState, SubtitleSettings, TranscriptSegment, AlightKeyframe, BlurBox, AspectRatioType } from '../types';
import { getInterpolatedKeyframe, getFilterCss } from '../utils/alightMotionRenderer';

interface VideoPlayerViewProps {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  activeSegment: TranscriptSegment | null;
  isCatchUpModeActive?: boolean;
  onCatchUpPlace?: (time: number) => void;
  selectedSegmentName?: string;
}

export const VideoPlayerView: React.FC<VideoPlayerViewProps> = ({
  project,
  setProject,
  activeSegment,
  isCatchUpModeActive = false,
  onCatchUpPlace,
  selectedSegmentName,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const clonedAudioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMuted = project.isMuted ?? false;
  const videoVolume = project.volume !== undefined ? project.volume : 0.8;
  const clonedVolume = project.voiceVolume !== undefined ? project.voiceVolume : 1.0;
  const [isDragging, setIsDragging] = useState(false);
  const [editingText, setEditingText] = useState('');

  // Update inline editing text when active segment changes
  useEffect(() => {
    if (activeSegment) {
      setEditingText(activeSegment.myanmarTranslation || activeSegment.originalText);
    } else {
      setEditingText('');
    }
  }, [activeSegment?.id]);

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

  // Synchronize cloned voice audio with active segment and apply ONLY to Voice Clone Speed (independent of video speed)
  useEffect(() => {
    if (!clonedAudioRef.current) return;
    const audio = clonedAudioRef.current;
    // Cap HTMLMediaElement volume safely between 0.0 and 1.0
    audio.volume = Math.max(0, Math.min(1.0, project.isVoiceMuted ? 0 : clonedVolume));

    // Apply global voice clone speed (independent of video speed)
    const voiceSpeed = project.voicePlaybackRate || 1.0;

    // Strict alignment: Find segment covering current playhead with cloned voice
    const playingSegment = project.segments.find((s) => {
      const segSpeed = s.playbackRate || voiceSpeed;
      const effectiveAudioDuration = (s.audioDuration || (s.endTime - s.startTime)) / segSpeed;
      const effectiveEnd = Math.max(s.endTime, s.startTime + effectiveAudioDuration);
      return project.currentTime >= s.startTime && project.currentTime <= effectiveEnd && !!s.audioUrl;
    });

    if (playingSegment && playingSegment.audioUrl && project.isPlaying) {
      const expectedOffset = Math.max(0, project.currentTime - playingSegment.startTime);
      const segSpeed = playingSegment.playbackRate || voiceSpeed;
      if (audio.playbackRate !== segSpeed) {
        audio.playbackRate = segSpeed;
        (audio as any).preservesPitch = true;
        (audio as any).webkitPreservesPitch = true;
      }

      if (audio.src !== playingSegment.audioUrl) {
        audio.src = playingSegment.audioUrl;
        // CRITICAL FIX: If near the start of the segment (within 350ms), start at exact 0 to ensure the initial letter/word is 100% complete
        audio.currentTime = expectedOffset < 0.35 ? 0 : expectedOffset;
        audio.play().catch(() => {});
      } else {
        const clipDuration = audio.duration || playingSegment.audioDuration || 0;
        if (audio.ended || (clipDuration > 0 && expectedOffset >= clipDuration - 0.05)) {
          if (!audio.paused) {
            audio.pause();
          }
          return;
        }

        if (audio.paused) {
          audio.currentTime = expectedOffset < 0.35 ? 0 : expectedOffset;
          audio.play().catch(() => {});
        } else if (Math.abs(audio.currentTime - expectedOffset) > 0.35) {
          audio.currentTime = expectedOffset;
        }
      }
    } else {
      if (!audio.paused) {
        audio.pause();
      }
    }
  }, [project.currentTime, project.isPlaying, project.segments, project.voicePlaybackRate, clonedVolume, project.isVoiceMuted]);

  // Sync video element volume
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = isMuted ? 0 : videoVolume;
    }
  }, [videoVolume, isMuted]);

  // Handle video seek with immediate audio alignment
  const handleSeek = (newTime: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = newTime;
    setProject((prev) => ({ ...prev, currentTime: newTime }));

    if (clonedAudioRef.current) {
      const segAtTime = project.segments.find((s) => {
        const effectiveEnd = Math.max(s.endTime, s.startTime + (s.audioDuration || 0));
        return newTime >= s.startTime && newTime <= effectiveEnd && !!s.audioUrl;
      });
      if (segAtTime && segAtTime.audioUrl) {
        if (clonedAudioRef.current.src !== segAtTime.audioUrl) {
          clonedAudioRef.current.src = segAtTime.audioUrl;
        }
        const offset = Math.max(0, newTime - segAtTime.startTime);
        clonedAudioRef.current.currentTime = offset;
        if (project.isPlaying) {
          clonedAudioRef.current.play().catch(() => {});
        }
      } else {
        clonedAudioRef.current.pause();
        clonedAudioRef.current.currentTime = 0;
      }
    }

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

  // Handle Video File Upload
  const handleFileUpload = (file: File) => {
    if (!file || !file.type.startsWith('video/')) return;
    const url = URL.createObjectURL(file);
    setProject((prev) => ({
      ...prev,
      videoFile: file,
      videoUrl: url,
      videoName: file.name,
      currentTime: 0,
      isPlaying: false,
    }));
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
    const demoUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';
    setProject((prev) => ({
      ...prev,
      videoFile: null,
      videoUrl: demoUrl,
      videoName: 'Sample_Action_Trailer.mp4',
      videoDuration: 15,
      currentTime: 0,
      isPlaying: false,
    }));
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
        return 'aspect-[9/16] max-h-[520px] mx-auto shadow-2xl rounded-2xl border border-zinc-800';
      case '1:1':
        return 'aspect-square max-h-[460px] mx-auto shadow-2xl rounded-2xl border border-zinc-800';
      case '4:5':
        return 'aspect-[4/5] max-h-[480px] mx-auto shadow-2xl rounded-2xl border border-zinc-800';
      case '16:9':
      default:
        return 'aspect-video w-full max-w-4xl mx-auto rounded-xl border border-zinc-800';
    }
  };

  return (
    <div className="glass-panel rounded-2xl overflow-hidden flex flex-col shadow-2xl relative z-10">
      {/* Hidden audio element for synchronized cloned voice playback */}
      <audio ref={clonedAudioRef} />

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
      <div
        className={`relative bg-black w-full flex items-center justify-center overflow-hidden select-none ${getContainerAspectClass()} ${
          isDragging ? 'ring-2 ring-cyan-500 ring-inset' : ''
        }`}
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
                className={`w-full h-full cursor-pointer ${
                  crop.fitMode === 'cover' ? 'object-cover' : 'object-contain'
                }`}
                style={{
                  filter: [filterCss, getFilterCss(project.globalColorFilter), kf.blur > 0 ? `blur(${kf.blur}px)` : ''].filter(f => f !== 'none' && f !== '').join(' ') || 'none',
                }}
                playsInline
                onClick={() => setProject((prev) => ({ ...prev, isPlaying: !prev.isPlaying }))}
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

                    setProject((prev) => ({
                      ...prev,
                      videoDuration: v.duration || 0,
                      aspectRatio: detectedRatio,
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
            onClick={() => setProject((prev) => ({ ...prev, isPlaying: !prev.isPlaying }))}
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


        {/* Dual Audio Volume Mix (Video Sound vs. Cloned Voice) */}
        <div className="flex items-center gap-4 bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-800 text-xs">
          {/* Video Audio Volume */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setProject((prev) => ({ ...prev, isMuted: !isMuted }))}
              className="text-zinc-400 hover:text-zinc-200 cursor-pointer"
              title={isMuted ? 'မူရင်းအသံ ပြန်ဖွင့်မည် (Unmute)' : 'မူရင်းအသံ ပိတ်မည် (Mute)'}
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <span className="text-[11px] text-zinc-400">Video Vol:</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : videoVolume}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setProject((prev) => ({
                  ...prev,
                  volume: val,
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

interface InteractiveBlurBoxProps {
  blurBox: BlurBox;
  onUpdate: (updated: BlurBox) => void;
  onDelete: () => void;
}

const InteractiveBlurBox: React.FC<InteractiveBlurBoxProps> = ({ blurBox, onUpdate, onDelete }) => {
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

interface InteractiveSubtitleOverlayProps {
  text: string;
  settings: SubtitleSettings;
  onUpdateOffset: (offsetX: number, offsetY: number) => void;
}

const InteractiveSubtitleOverlay: React.FC<InteractiveSubtitleOverlayProps> = ({
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
      className={`absolute left-0 right-0 px-6 text-center z-20 flex items-center justify-center pointer-events-auto ${basePositionYClass}`}
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
        }}
        className={`relative px-4 py-1.5 rounded-lg font-semibold font-myanmar max-w-3xl leading-relaxed select-none inline-block shadow-lg cursor-grab active:cursor-grabbing transition-all ${
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
