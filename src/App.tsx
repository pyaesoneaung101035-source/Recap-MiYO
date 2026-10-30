import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { StepWizardNav, StepItem } from './components/StepWizardNav';
import { Step1GeminiKeys } from './components/Step1GeminiKeys';
import { Step3CanvasCrop } from './components/Step3CanvasCrop';
import { VideoPlayerView } from './components/VideoPlayerView';
import { AiRecapStudio } from './components/AiRecapStudio';
import { VoiceCloneStudio } from './components/VoiceCloneStudio';
import { SubtitleStyleEditor } from './components/SubtitleStyleEditor';
import { Step8AlightMotion } from './components/Step8AlightMotion';
import { Step8ExportStudio } from './components/Step8ExportStudio';
import { ApiKeyModal } from './components/ApiKeyModal';
import { ExportModal } from './components/ExportModal';
import { EdgePanel } from './components/EdgePanel';
import { NavigationDrawer } from './components/NavigationDrawer';
import { MenuDrawer } from './components/MenuDrawer';
import { PasscodeLockModal } from './components/PasscodeLockModal';
import { ProjectState, GeminiKeyInfo, TranscriptSegment } from './types';
import { loadGeminiKeys } from './utils/geminiPool';
import { ArrowRight, ArrowLeft, Sparkles, CheckCircle2, Video, Download } from 'lucide-react';

export default function App() {
  const [isUnlocked, setIsUnlocked] = useState<boolean>(
    () => sessionStorage.getItem('site_unlocked') === 'true'
  );
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isKeysModalOpen, setIsKeysModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isNavDrawerOpen, setIsNavDrawerOpen] = useState(false);
  const [isMenuDrawerOpen, setIsMenuDrawerOpen] = useState(false);
  const [theme, setTheme] = useState<'obsidian' | 'cyberpunk' | 'glass' | 'emerald' | 'sunset' | 'light'>('obsidian');

  const themeClasses = {
    obsidian: 'bg-zinc-950 text-zinc-100',
    cyberpunk: 'bg-neutral-950 text-yellow-100',
    glass: 'bg-gradient-to-br from-slate-900 via-indigo-950 to-purple-950 text-white',
    emerald: 'bg-slate-950 text-emerald-100',
    sunset: 'bg-stone-950 text-orange-50',
    light: 'bg-slate-100 text-slate-900',
  };

  // Gemini API Keys state
  const [geminiKeys, setGeminiKeys] = useState<GeminiKeyInfo[]>([]);

  // Main Project State
  const [project, setProject] = useState<ProjectState>({
    videoFile: null,
    videoUrl: null,
    videoName: '',
    videoDuration: 0,
    currentTime: 0,
    isPlaying: false,
    playbackRate: 1.0,
    voicePlaybackRate: 1.0,
    voiceStyle: 'conversational',
    smartSyncFrameLock: true,
    volume: 0,
    isMuted: true,
    aspectRatio: '9:16',
    frameCrop: {
      fitMode: 'contain',
      scale: 1.0,
      posX: 0,
      posY: 0,
      backgroundStyle: 'blur',
    },
    segments: [],
    keyframes: [
      {
        id: 'kf_static',
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
    subtitleSettings: {
      fontFamily: 'Pyidaungsu',
      fontSize: 26,
      color: '#ffffff',
      strokeColor: '#000000',
      strokeWidth: 3,
      backgroundColor: 'rgba(0,0,0,0.7)',
      positionY: 'bottom',
      showKaraoke: true,
    },
    blurBoxes: [],
    globalColorFilter: 'none',
  });

  // Load keys from storage on initial mount
  useEffect(() => {
    const savedGemini = loadGeminiKeys();
    setGeminiKeys(savedGemini);
  }, []);

  // Compute steps definition (8 Sequential Steps)
  const steps: StepItem[] = [
    {
      number: 1,
      id: 'step1',
      title: 'အဆင့် 1: Gemini Keys',
      subtitle: 'Multi-Key Rotation & 8 Modes',
      isComplete: geminiKeys.length > 0,
    },
    {
      number: 2,
      id: 'step2',
      title: 'အဆင့် 2: Upload Video',
      subtitle: project.videoName || 'Custom Video တင်ရန်',
      isComplete: !!(project.videoFile || project.videoUrl),
    },
    {
      number: 3,
      id: 'step3',
      title: 'အဆင့် 3: Size & Crop',
      subtitle: `TikTok/FB/YT (${project.aspectRatio || '9:16'})`,
      isComplete: true,
    },
    {
      number: 4,
      id: 'step4',
      title: 'အဆင့် 4: AI Transcript & Diarization',
      subtitle: project.segments.length > 0 ? `${project.segments.length} segments (5s Budgeted)` : 'Shot ခွဲခြမ်း + 5s စာတိုပြန်ဆိုချက်',
      isComplete: project.segments.length > 0,
    },
    {
      number: 5,
      id: 'step5',
      title: 'အဆင့် 5: Dubbing & 7-Stage Review',
      subtitle: 'Adult Male Narrator + atempo + LipSync',
      isComplete: project.segments.some((s) => !!s.audioUrl),
    },
    {
      number: 6,
      id: 'step6',
      title: 'အဆင့် 6: Subtitles',
      subtitle: `${project.subtitleSettings.fontFamily} (${project.subtitleSettings.fontSize}px)`,
      isComplete: true,
    },
    {
      number: 7,
      id: 'step7',
      title: 'အဆင့် 7: Video Editing',
      subtitle: 'Alight Motion Studio',
      isComplete: true,
    },
    {
      number: 8,
      id: 'step8',
      title: 'အဆင့် 8: Export MP4',
      subtitle: 'Download & History Log',
      isComplete: false,
    },
  ];

  // Active subtitle segment
  const activeSegment: TranscriptSegment | null =
    project.segments.find((s) => {
      const effectiveEnd = Math.max(s.endTime, s.startTime + (s.audioDuration || 0));
      return project.currentTime >= s.startTime && project.currentTime <= effectiveEnd;
    }) || null;

  const handleSeekTo = (time: number) => {
    setProject((prev) => ({ ...prev, currentTime: time }));
  };

  if (!isUnlocked) {
    return <PasscodeLockModal onUnlock={() => setIsUnlocked(true)} />;
  }

  return (
    <div className={`min-h-screen ${themeClasses[theme]} flex flex-col font-sans relative overflow-x-hidden transition-colors duration-500`}>
      {/* Ambient Radial Background Mesh Glows */}
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

      {/* Edge Panel */}
      <EdgePanel
        onToggleNavDrawer={() => setIsNavDrawerOpen(true)}
        onToggleMenuDrawer={() => setIsMenuDrawerOpen(true)}
        onOpenKeysModal={() => setIsKeysModalOpen(true)}
        onOpenExportModal={() => setIsExportModalOpen(true)}
        currentStep={currentStep}
        setCurrentStep={setCurrentStep}
      />

      {/* Navigation Drawer */}
      <NavigationDrawer
        isOpen={isNavDrawerOpen}
        onClose={() => setIsNavDrawerOpen(false)}
        steps={steps}
        currentStep={currentStep}
        onSelectStep={(num) => setCurrentStep(num)}
      />

      {/* Menu Drawer */}
      <MenuDrawer
        isOpen={isMenuDrawerOpen}
        onClose={() => setIsMenuDrawerOpen(false)}
        theme={theme}
        setTheme={setTheme}
        onOpenKeysModal={() => setIsKeysModalOpen(true)}
        onOpenExportModal={() => setIsExportModalOpen(true)}
      />

      {/* Main Guided Studio Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-8 space-y-6 relative z-10">
        {/* STEP 1: Gemini Keys Manager & 8 Modes */}
        {currentStep === 1 && (
          <Step1GeminiKeys
            geminiKeys={geminiKeys}
            setGeminiKeys={setGeminiKeys}
            onNextStep={() => setCurrentStep(2)}
          />
        )}

        {/* STEP 2: Custom Video Upload & Preview */}
        {currentStep === 2 && (
          <div className="glass-panel rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 backdrop-blur-2xl border border-white/10 relative overflow-hidden">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-full bg-gradient-to-tr from-sky-400 to-cyan-500 text-zinc-950 font-black flex items-center justify-center text-xs shadow-lg">
                  2
                </span>
                <div>
                  <h2 className="text-base font-bold text-white font-display tracking-tight">
                    အဆင့် 2 — Custom Video Upload & Playback
                  </h2>
                  <p className="text-xs text-zinc-400 font-myanmar mt-0.5">
                    သင့်ဖုန်း သို့မဟုတ် ကွန်ပျူတာမှ Video ဖိုင်ကို တင်ပါ သို့မဟုတ် Sample Video ရွေးချယ်ပါ။
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentStep(1)}
                  className="px-3.5 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-semibold rounded-xl transition-all border border-white/10 flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>အဆင့် 1</span>
                </button>
                <button
                  onClick={() => setCurrentStep(3)}
                  disabled={!project.videoFile && !project.videoUrl}
                  className="px-4 py-2 bg-gradient-to-r from-sky-400 to-teal-400 hover:opacity-90 disabled:opacity-50 text-zinc-950 font-bold text-xs rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-sky-500/20 cursor-pointer"
                >
                  <span>အဆင့် 3 သို့</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-8">
                <VideoPlayerView
                  project={project}
                  setProject={setProject}
                  activeSegment={activeSegment}
                />
              </div>

              <div className="lg:col-span-4 space-y-4">
                <div className="p-5 rounded-2xl bg-black/40 border border-white/10 space-y-4 backdrop-blur-xl shadow-lg">
                  <h3 className="text-xs font-black text-cyan-300 uppercase tracking-widest font-display">
                    Video Source Options
                  </h3>

                  <div className="space-y-3">
                    <label className="block w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500/20 to-teal-500/20 border border-cyan-500/40 text-cyan-300 font-bold text-xs text-center cursor-pointer hover:scale-[1.01] transition-all shadow-lg">
                      <span>📁 Select Video from Device</span>
                      <input
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const url = URL.createObjectURL(file);
                            setProject((prev) => ({
                              ...prev,
                              videoFile: file,
                              videoUrl: url,
                              videoName: file.name,
                            }));
                          }
                        }}
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => {
                        const sampleUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';
                        setProject((prev) => ({
                          ...prev,
                          videoUrl: sampleUrl,
                          videoName: 'Sample_Blazes_Video.mp4',
                        }));
                      }}
                      className="w-full py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 text-xs font-bold transition-all text-center cursor-pointer"
                    >
                      🎬 Load Sample Cinematic Video
                    </button>

                    {(project.videoFile || project.videoUrl) && (
                      <button
                        type="button"
                        onClick={() => setCurrentStep(4)}
                        className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 hover:opacity-95 text-zinc-950 font-black text-xs transition-all flex items-center justify-center gap-2 shadow-xl shadow-cyan-500/25 cursor-pointer active:scale-95"
                      >
                        <Sparkles className="w-4 h-4 stroke-[2.5]" />
                        <span>⚡ 1-Click Auto Dubbing သို့ တိုက်ရိုက်သွားမည်</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Canvas Crop & Aspect Ratio */}
        {currentStep === 3 && (
          <Step3CanvasCrop
            project={project}
            setProject={setProject}
            onPrevStep={() => setCurrentStep(2)}
            onNextStep={() => setCurrentStep(4)}
          />
        )}

        {/* STEP 4: AI Transcript & Gemini Flash 2.5 Analysis */}
        {currentStep === 4 && (
          <AiRecapStudio
            project={project}
            setProject={setProject}
            onSeekTo={handleSeekTo}
            onPrevStep={() => setCurrentStep(3)}
            onNextStep={() => setCurrentStep(5)}
          />
        )}

        {/* STEP 5: Voice Clone Studio (Vertical List Format & TTS) */}
        {currentStep === 5 && (
          <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-400 to-teal-500 text-zinc-950 font-black flex items-center justify-center text-xs shadow-lg">
                  5
                </span>
                <div>
                  <h2 className="text-base font-bold text-white font-display tracking-tight">
                    အဆင့် 5 — Voice Clone & Audio Studio
                  </h2>
                  <p className="text-xs text-zinc-400 font-myanmar mt-0.5">
                    လူ ၂၅ ကျော်ပါသော Voice Clone list မှ ရွေးချယ်ပြီး အသံများ ထုတ်လုပ်ပါ။
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentStep(4)}
                  className="px-3.5 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-semibold rounded-xl transition-all border border-white/10 flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>အဆင့် 4</span>
                </button>
                <button
                  onClick={() => setCurrentStep(6)}
                  className="px-4 py-2 bg-gradient-to-r from-emerald-400 to-teal-400 hover:opacity-90 text-zinc-950 font-bold text-xs rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20 cursor-pointer"
                >
                  <span>အဆင့် 6 သို့</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <VoiceCloneStudio
              project={project}
              setProject={setProject}
              onPrevStep={() => setCurrentStep(4)}
              onNextStep={() => setCurrentStep(6)}
            />
          </div>
        )}

        {/* STEP 6: Subtitle Style Editor */}
        {currentStep === 6 && (
          <div className="glass-panel rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 backdrop-blur-2xl border border-white/10 relative overflow-hidden">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-full bg-gradient-to-tr from-sky-400 to-teal-400 text-zinc-950 font-black flex items-center justify-center text-xs shadow-lg">
                  6
                </span>
                <div>
                  <h2 className="text-base font-bold text-white font-display tracking-tight">
                    အဆင့် 6 — On-Video Subtitles Studio
                  </h2>
                  <p className="text-xs text-zinc-400 font-myanmar mt-0.5">
                    မြန်မာဖောင့်၊ အရွယ်အစား၊ Outline Stroke နှင့် Subtitle ချိန်ညှိပါ။
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setCurrentStep(5)}
                  className="px-3.5 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-semibold rounded-xl transition-all border border-white/10 flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>အဆင့် 5</span>
                </button>
                <button
                  onClick={() => setCurrentStep(7)}
                  className="px-4 py-2 bg-gradient-to-r from-cyan-400 to-teal-400 hover:opacity-90 text-zinc-950 font-bold text-xs rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-cyan-500/20 cursor-pointer"
                >
                  <span>အဆင့် 7 သို့</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-8">
                <VideoPlayerView
                  project={project}
                  setProject={setProject}
                  activeSegment={activeSegment}
                />
              </div>
              <div className="lg:col-span-4">
                <SubtitleStyleEditor
                  settings={project.subtitleSettings}
                  onChange={(subtitleSettings) => setProject((prev) => ({ ...prev, subtitleSettings }))}
                  blurBoxes={project.blurBoxes}
                  onBlurBoxesChange={(blurBoxes) => setProject((prev) => ({ ...prev, blurBoxes }))}
                  playbackRate={project.playbackRate}
                  onPlaybackRateChange={(rate) =>
                    setProject((prev) => ({
                      ...prev,
                      playbackRate: rate,
                      segments: prev.segments.map((s) => ({ ...s, playbackRate: rate })),
                    }))
                  }
                />
              </div>
            </div>
          </div>
        )}

        {/* STEP 7: Video Editing Function & Alight Motion Studio */}
        {currentStep === 7 && (
          <Step8AlightMotion
            project={project}
            setProject={setProject}
            onSeekTo={handleSeekTo}
            onPrevStep={() => setCurrentStep(6)}
            onNextStep={() => setCurrentStep(8)}
            onOpenExportModal={() => setIsExportModalOpen(true)}
          />
        )}

        {/* STEP 8: Final MP4 Video, Direct Download & Download History */}
        {currentStep === 8 && (
          <Step8ExportStudio
            project={project}
            setProject={setProject}
            onPrevStep={() => setCurrentStep(7)}
          />
        )}
      </main>

      {/* Modals */}
      <ApiKeyModal
        isOpen={isKeysModalOpen}
        onClose={() => setIsKeysModalOpen(false)}
        geminiKeys={geminiKeys}
        setGeminiKeys={setGeminiKeys}
      />

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        project={project}
      />
    </div>
  );
}
