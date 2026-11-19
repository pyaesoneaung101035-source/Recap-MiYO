import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { StepWizardNav, StepItem } from './components/StepWizardNav';
import { Step1GeminiKeys } from './components/Step1GeminiKeys';
import { Step3CanvasCrop } from './components/Step3CanvasCrop';
import { AiRecapStudio } from './components/AiRecapStudio';
import { VoiceCloneStudio } from './components/VoiceCloneStudio';
import { Step5StudioEditor } from './components/Step5StudioEditor';
import { Step8ExportStudio } from './components/Step8ExportStudio';
import { VideoPlayerView } from './components/VideoPlayerView';
import { EdgePanel } from './components/EdgePanel';
import { NavigationDrawer } from './components/NavigationDrawer';
import { MenuDrawer } from './components/MenuDrawer';
import { ApiKeyModal } from './components/ApiKeyModal';
import { ExportModal } from './components/ExportModal';
import { PasscodeLockModal } from './components/PasscodeLockModal';
import {
  ProjectState,
  TranscriptSegment,
  AlightKeyframe,
  GeminiKeyInfo,
} from './types';
import { loadGeminiKeys, saveGeminiKeys } from './utils/geminiPool';
import { ArrowLeft, ArrowRight, Play, Film, Sparkles, CheckCircle2 } from 'lucide-react';

const defaultSegments: TranscriptSegment[] = [
  {
    id: 'seg_demo_1',
    startTime: 0.5,
    endTime: 3.8,
    originalText: '修仙界？本精灵给你的第一个任务很简单。',
    myanmarTranslation: 'ကျင့်ကြံရေးလောကကြီးထဲမှာ သူ့ကိုပေးလိုက်တဲ့ ပထမဆုံးတာဝန်က အရမ်းရိုးရှင်းတယ်လို့ ဆိုပါတယ်။',
    subtitleText: 'ပထမဆုံးတာဝန်က အရမ်းရိုးရှင်းတယ်လို့ ဆိုပါတယ်။',
    voice: 'RecapPro',
    speaker: 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
    emotion: 'Storytelling',
    isOnScreen: false,
    style: 'recap',
    atempoRate: 1.0,
    playbackRate: 1.0,
    minutePartIndex: 1,
    isHumanReviewed: true,
  },
  {
    id: 'seg_demo_2',
    startTime: 4.1,
    endTime: 8.5,
    originalText: '所以，不要害怕，勇往直前吧！',
    myanmarTranslation: 'ဒါကြောင့် မကြောက်ဘဲ ရှေ့ကို ရဲရဲဝံ့ဝံ့သာ တက်လှမ်းဖို့ တိုက်တွန်းလိုက်ပါတော့တယ်။',
    subtitleText: 'မကြောက်ဘဲ ရှေ့ကို ရဲရဲဝံ့ဝံ့ တက်လှမ်းဖို့ တိုက်တွန်းလိုက်တယ်။',
    voice: 'RecapPro',
    speaker: 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
    emotion: 'Storytelling',
    isOnScreen: false,
    style: 'recap',
    atempoRate: 1.0,
    playbackRate: 1.0,
    minutePartIndex: 1,
    isHumanReviewed: true,
  },
];

const defaultKeyframes: AlightKeyframe[] = [
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
];

const initialProjectState: ProjectState = {
  videoFile: null,
  videoUrl: null,
  videoName: 'Untitled_Project',
  videoDuration: 0,
  currentTime: 0,
  isPlaying: false,
  playbackRate: 1.0,
  voicePlaybackRate: 1.0,
  narrationMode: 'dialogue_dub',
  step3ScriptStyle: 'narrator',
  recapSlotSeconds: 30,
  voiceStyle: 'recap',
  voiceTone: 'recap_pro',
  voicePitch: -5,
  lockedVoice: 'RecapPro',
  smartSyncFrameLock: true,
  volume: 0.8,
  isMuted: false,
  voiceVolume: 1.0,
  isVoiceMuted: false,
  aspectRatio: '9:16',
  frameCrop: {
    fitMode: 'cover',
    scale: 1.0,
    posX: 0,
    posY: 0,
    backgroundStyle: 'blur',
  },
  segments: defaultSegments,
  keyframes: defaultKeyframes,
  subtitleSettings: {
    fontFamily: 'Pyidaungsu',
    fontSize: 28,
    color: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 4,
    backgroundColor: 'rgba(0,0,0,0.4)',
    positionY: 'bottom',
    showKaraoke: true,
  },
  blurBoxes: [],
  logoConfig: null,
  globalColorFilter: 'none',
  extractedBgmUrl: null,
  useExtractedBgm: false,
  bgmVolume: 0.35,
  bgmEngineUsed: null,
};

export default function App() {
  // Passcode lock check
  const [isUnlocked, setIsUnlocked] = useState<boolean>(() => {
    return sessionStorage.getItem('site_unlocked') === 'true';
  });

  // Theme
  const [theme, setTheme] = useState<'obsidian' | 'cyberpunk' | 'glass' | 'emerald' | 'sunset' | 'light'>('obsidian');

  // Step Wizard State (1 to 8)
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Modals & Drawers
  const [isKeysModalOpen, setIsKeysModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isNavDrawerOpen, setIsNavDrawerOpen] = useState(false);
  const [isMenuDrawerOpen, setIsMenuDrawerOpen] = useState(false);

  // Gemini Keys
  const [geminiKeys, setGeminiKeys] = useState<GeminiKeyInfo[]>(() => loadGeminiKeys());

  // Project Master State
  const [project, setProject] = useState<ProjectState>(() => {
    try {
      const saved = localStorage.getItem('motion_recap_project_state');
      const sessionVideoUrl = typeof window !== 'undefined' ? sessionStorage.getItem('motion_recap_session_video_url') : null;
      const sessionBgmUrl = typeof window !== 'undefined' ? sessionStorage.getItem('motion_recap_session_bgm_url') : null;
      if (saved) {
        const parsed = JSON.parse(saved);
        const resolvedVideoUrl = parsed.videoUrl && !parsed.videoUrl.startsWith('blob:') ? parsed.videoUrl : (sessionVideoUrl || parsed.videoUrl || null);
        const hasValidSessionOrServerVideo = Boolean(resolvedVideoUrl && !resolvedVideoUrl.startsWith('blob:')) || Boolean(sessionVideoUrl && sessionVideoUrl === resolvedVideoUrl);
        const resolvedBgmUrl = hasValidSessionOrServerVideo
          ? (parsed.extractedBgmUrl && !parsed.extractedBgmUrl.startsWith('blob:') ? parsed.extractedBgmUrl : (sessionBgmUrl || parsed.extractedBgmUrl || null))
          : null;
        const hasDeadBlobVideo = !resolvedVideoUrl && typeof parsed.videoUrl === 'string' && parsed.videoUrl.startsWith('blob:');
        const cleanedSegments = Array.isArray(parsed.segments)
          ? parsed.segments.map((s: any) => ({
              ...s,
              audioUrl:
                !hasValidSessionOrServerVideo ||
                (typeof s?.audioUrl === 'string' && s.audioUrl.startsWith('blob:'))
                  ? undefined
                  : s?.audioUrl,
            }))
          : initialProjectState.segments;
        const rawKeyframes = Array.isArray(parsed.keyframes) ? parsed.keyframes : defaultKeyframes;
        const cleanedKeyframes = rawKeyframes
          .filter((kf: any) => !(kf?.id === 'kf_1' && Number(kf?.time) === 4 && Number(kf?.shakeIntensity) === 0.5))
          .map((kf: any) => ({
            ...kf,
            shakeIntensity: 0,
          }));
        return {
          ...initialProjectState,
          ...parsed,
          videoFile: null, // File object cannot be serialized
          videoUrl: resolvedVideoUrl,
          videoDuration: hasDeadBlobVideo ? 0 : (parsed.videoDuration ?? 0),
          playbackRate: hasValidSessionOrServerVideo ? (parsed.playbackRate || 1.0) : 1.0,
          extractedBgmUrl: resolvedBgmUrl,
          useExtractedBgm: hasValidSessionOrServerVideo ? Boolean(resolvedBgmUrl && parsed.useExtractedBgm) : false,
          bgmEngineUsed: resolvedBgmUrl ? parsed.bgmEngineUsed : null,
          segments: cleanedSegments,
          keyframes: cleanedKeyframes.length > 0 ? cleanedKeyframes : defaultKeyframes,
        };
      } else if (sessionVideoUrl) {
        return {
          ...initialProjectState,
          videoUrl: sessionVideoUrl,
          extractedBgmUrl: sessionBgmUrl,
        };
      }
    } catch (e) {
      console.warn('Failed to parse saved project state:', e);
    }
    return initialProjectState;
  });

  // Save videoUrl and extractedBgmUrl to sessionStorage whenever they update (and clear when reset)
  useEffect(() => {
    try {
      if (project.videoUrl && project.videoUrl.startsWith('blob:')) {
        sessionStorage.setItem('motion_recap_session_video_url', project.videoUrl);
      } else if (!project.videoUrl) {
        sessionStorage.removeItem('motion_recap_session_video_url');
      }
    } catch (_) {}
  }, [project.videoUrl]);

  useEffect(() => {
    try {
      if (project.extractedBgmUrl && project.extractedBgmUrl.startsWith('blob:')) {
        sessionStorage.setItem('motion_recap_session_bgm_url', project.extractedBgmUrl);
      } else if (!project.extractedBgmUrl) {
        sessionStorage.removeItem('motion_recap_session_bgm_url');
      }
    } catch (_) {}
  }, [project.extractedBgmUrl]);

  // Save project state to localStorage on modification
  useEffect(() => {
    try {
      const toSave = {
        ...project,
        videoFile: null,
      };
      localStorage.setItem('motion_recap_project_state', JSON.stringify(toSave));
    } catch (e) {
      console.warn('Failed to cache project state:', e);
    }
  }, [project.videoName, project.aspectRatio, project.frameCrop, project.segments, project.keyframes, project.subtitleSettings, project.blurBoxes, project.logoConfig, project.globalColorFilter, project.extractedBgmUrl, project.useExtractedBgm, project.bgmVolume, project.bgmEngineUsed]);

  // Auto-enable extracted BGM across Steps 3, 4, 5, 6 when extractedBgmUrl exists
  const prevStepRef = useRef<number>(currentStep);
  useEffect(() => {
    const enteringStudioSteps =
      currentStep >= 3 && (prevStepRef.current < 3 || (prevStepRef.current === currentStep && !project.useExtractedBgm));
    prevStepRef.current = currentStep;

    if (enteringStudioSteps && project.extractedBgmUrl) {
      setProject((prev) => {
        const nextVol = prev.bgmVolume && prev.bgmVolume > 0 ? prev.bgmVolume : 0.55;
        if (prev.useExtractedBgm === true && prev.bgmVolume === nextVol) {
          return prev;
        }
        return {
          ...prev,
          useExtractedBgm: true,
          bgmVolume: nextVol,
        };
      });
    }
  }, [currentStep, project.extractedBgmUrl]);

  // Handle Seek
  const handleSeekTo = (time: number) => {
    setProject((prev) => ({
      ...prev,
      currentTime: time,
    }));
  };

  // Active Segment for Video Player View
  const activeSegment = project.segments.find(
    (s) => project.currentTime >= s.startTime && project.currentTime <= s.endTime
  ) || project.segments[0] || null;

  // 6 Steps configuration (removed Step 6 Alight Motion slide; Pro Edition is built into Step 5)
  const steps: StepItem[] = [
    {
      number: 1,
      id: 'keys',
      title: 'အဆင့် ၁',
      subtitle: 'Gemini & AI Engines',
      isComplete: geminiKeys.length > 0,
    },
    {
      number: 2,
      id: 'video',
      title: 'အဆင့် ၂',
      subtitle: 'ဗီဒီယို တင်ရန် & Player',
      isComplete: Boolean(project.videoUrl),
    },
    {
      number: 3,
      id: 'recap',
      title: 'အဆင့် ၃',
      subtitle: 'Video Analyzing & Narrator TTX',
      isComplete: project.segments.length > 0,
    },
    {
      number: 4,
      id: 'voice',
      title: 'အဆင့် ၄',
      subtitle: 'TTS Voice Studio',
      isComplete: project.segments.some((s) => !!s.audioUrl),
    },
    {
      number: 5,
      id: 'review',
      title: 'အဆင့် ၅',
      subtitle: 'Video Editor & Pro Edition',
      isComplete: project.segments.some((s) => !!s.audioUrl || s.isHumanReviewed),
    },
    {
      number: 6,
      id: 'export',
      title: 'အဆင့် ၆',
      subtitle: 'Export Studio (MP4)',
      isComplete: false,
    },
  ];

  if (!isUnlocked) {
    return <PasscodeLockModal onUnlock={() => setIsUnlocked(true)} />;
  }

  return (
    <div className={`min-h-screen text-zinc-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200 relative overflow-x-hidden ${theme === 'cyberpunk' ? 'bg-[#080703]' : theme === 'glass' ? 'bg-[#040612]' : theme === 'emerald' ? 'bg-[#030c08]' : theme === 'sunset' ? 'bg-[#0e0705]' : theme === 'light' ? 'bg-slate-100 text-zinc-900' : 'bg-[#050508]'}`}>
      {/* Ambient Radial Mesh Glows */}
      <div className="ambient-glow-cyan" />
      <div className="ambient-glow-violet" />

      {/* Top Header */}
      <Header
        geminiKeys={geminiKeys}
        theme={theme}
        setTheme={setTheme}
        onOpenKeysModal={() => setIsKeysModalOpen(true)}
        onOpenExportModal={() => setIsExportModalOpen(true)}
      />

      {/* Edge Quick Navigation Panel */}
      <EdgePanel
        onToggleNavDrawer={() => setIsNavDrawerOpen((prev) => !prev)}
        onToggleMenuDrawer={() => setIsMenuDrawerOpen((prev) => !prev)}
        onOpenKeysModal={() => setIsKeysModalOpen(true)}
        onOpenExportModal={() => setIsExportModalOpen(true)}
        currentStep={currentStep}
        setCurrentStep={setCurrentStep}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-5 space-y-6 relative z-10">
        {/* Step Wizard Bar */}
        <StepWizardNav
          currentStep={currentStep}
          onSelectStep={setCurrentStep}
          steps={steps}
        />

        {/* Step Views */}
        {currentStep === 1 && (
          <Step1GeminiKeys
            geminiKeys={geminiKeys}
            setGeminiKeys={(k) => {
              setGeminiKeys(k);
              saveGeminiKeys(k);
            }}
            onNextStep={() => setCurrentStep(2)}
          />
        )}

        {currentStep === 2 && (
          <div className="space-y-6">
            <div className="ios-card p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-full bg-cyan-400/20 text-cyan-300 border border-cyan-400/40 flex items-center justify-center text-xs font-bold font-mono shadow-sm">
                  2
                </span>
                <h2 className="text-lg font-bold text-white font-display tracking-tight flex items-center gap-2">
                  <Film className="w-5 h-5 text-cyan-400" />
                  <span>ဗီဒီယို တင်ရန် & Live Player Studio</span>
                </h2>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => setCurrentStep(1)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>ရှေ့အဆင့်</span>
                </button>
                <button
                  onClick={() => setCurrentStep(3)}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 text-zinc-950 text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer shadow-lg shadow-cyan-500/20 hover:opacity-90 active:scale-95"
                >
                  <span>နောက်အဆင့် (AI Narrator Script)</span>
                  <ArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
                </button>
              </div>
            </div>

            {/* Video Player & Upload Zone */}
            <div className="glass-panel p-4 sm:p-6 rounded-3xl shadow-2xl">
              <VideoPlayerView
                project={project}
                setProject={setProject}
                activeSegment={activeSegment}
                selectedSegmentName={activeSegment ? activeSegment.myanmarTranslation : undefined}
                showLalalBgmGenerator={true}
              />
            </div>
          </div>
        )}

        {currentStep === 3 && (
          <AiRecapStudio
            project={project}
            setProject={setProject}
            onSeekTo={handleSeekTo}
            onNextStep={() => setCurrentStep(4)}
            onPrevStep={() => setCurrentStep(2)}
            onJumpToStep={(st) => setCurrentStep(st)}
            stepNumber={3}
          />
        )}

        {currentStep === 4 && (
          <VoiceCloneStudio
            project={project}
            setProject={setProject}
            onNextStep={() => setCurrentStep(5)}
            onPrevStep={() => setCurrentStep(3)}
          />
        )}

        {currentStep === 5 && (
          <Step5StudioEditor
            project={project}
            setProject={setProject}
            onSeekTo={handleSeekTo}
            onPrevStep={() => setCurrentStep(4)}
            onNextStep={() => setCurrentStep(6)}
            onJumpToStep={(st) => setCurrentStep(st)}
            onOpenKeysModal={() => setIsKeysModalOpen(true)}
          />
        )}

        {currentStep === 6 && (
          <Step8ExportStudio
            project={project}
            setProject={setProject}
            onPrevStep={() => setCurrentStep(5)}
          />
        )}
      </main>

      {/* Modals & Drawers */}
      <ApiKeyModal
        isOpen={isKeysModalOpen}
        onClose={() => setIsKeysModalOpen(false)}
        geminiKeys={geminiKeys}
        setGeminiKeys={(k) => {
          setGeminiKeys(k);
          saveGeminiKeys(k);
        }}
      />

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        project={project}
      />

      <NavigationDrawer
        isOpen={isNavDrawerOpen}
        onClose={() => setIsNavDrawerOpen(false)}
        steps={steps}
        currentStep={currentStep}
        onSelectStep={(st) => setCurrentStep(st)}
      />

      <MenuDrawer
        isOpen={isMenuDrawerOpen}
        onClose={() => setIsMenuDrawerOpen(false)}
        theme={theme}
        setTheme={setTheme}
        onOpenKeysModal={() => setIsKeysModalOpen(true)}
        onOpenExportModal={() => setIsExportModalOpen(true)}
      />
    </div>
  );
}
