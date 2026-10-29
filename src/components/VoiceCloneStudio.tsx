import React, { useState } from 'react';
import {
  Volume2,
  Play,
  Pause,
  RotateCw,
  Sparkles,
  Scissors,
  AlertCircle,
  AudioLines,
  CheckCircle2,
  Mic,
  Zap,
  ExternalLink,
  X,
  Search,
  Sliders,
  User,
  Users,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { ProjectState, TranscriptSegment, VoiceOption } from '../types';
import { synthesizeMyanmarVoice, VOICE_PROFILES, VoiceStyle } from '../utils/edgeTtsClient';
import { synthesizeHuggingFaceVoice, HF_VOICE_MODELS, HF_MULTI_SPEAKERS } from '../utils/huggingFaceClient';
import { loadApiKeys } from '../utils/apiKeys';
import { VideoPlayerView } from './VideoPlayerView';

interface VoiceCloneStudioProps {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  onPrevStep?: () => void;
  onNextStep?: () => void;
}

export const MALE_VOICES: VoiceOption[] = [
  'Thiha', 'KyawKyaw', 'AungAung', 'MinThway',
  'Titus', 'Perseus', 'Oberon', 'Atlas',
  'Schedar', 'Gacrux', 'Achird', 'Zubenelgenubi', 'Sadaltager'
];

export const FEMALE_VOICES: VoiceOption[] = [
  'Nilar', 'MayThu', 'Thiri', 'SuSu',
  'Sulafat', 'Virgo', 'Minerva', 'Luna',
  'Lyra', 'Pulcherrima', 'Vindemiatrix', 'Sadachbia'
];

export const ALL_VOICES: VoiceOption[] = [...MALE_VOICES, ...FEMALE_VOICES];

export const VoiceCloneStudio: React.FC<VoiceCloneStudioProps> = ({
  project,
  setProject,
  onPrevStep,
  onNextStep,
}) => {
  const [voiceEngine, setVoiceEngine] = useState<'gemini' | 'huggingface'>('gemini');
  
  // Single vs Double Voice Mode State
  const [voiceMode, setVoiceMode] = useState<'single' | 'double'>('single');
  const [singleVoice, setSingleVoice] = useState<VoiceOption>('Thiha');
  const [speakerA, setSpeakerA] = useState<VoiceOption>('Thiha');
  const [speakerB, setSpeakerB] = useState<VoiceOption>('Nilar');

  const [selectedHfSpeaker, setSelectedHfSpeaker] = useState<string>('hf_male_thiha');
  const [hfSpeakerA, setHfSpeakerA] = useState<string>('hf_male_thiha');
  const [hfSpeakerB, setHfSpeakerB] = useState<string>('hf_female_nilar');

  const [targetSlot, setTargetSlot] = useState<'single' | 'speakerA' | 'speakerB'>('single');

  const [voiceStyle, setVoiceStyle] = useState<VoiceStyle>('conversational');

  // Flow Panels State
  const [isGeminiFlowOpen, setIsGeminiFlowOpen] = useState(false);
  const [isHfFlowOpen, setIsHfFlowOpen] = useState(false);

  // Flow Panel filters & search
  const [genderFilter, setGenderFilter] = useState<'all' | 'male' | 'female'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Hugging Face state
  const [hfModel, setHfModel] = useState<string>('coqui/XTTS-v2');
  const [customHfModel, setCustomHfModel] = useState<string>('');

  // Generation & Audio state
  const [trimSilence, setTrimSilence] = useState<boolean>(false);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  const [testingVoice, setTestingVoice] = useState<string | null>(null);
  const [testAudioUrls, setTestAudioUrls] = useState<Record<string, string>>({});

  // Active Subtitle for Video Player
  const activeSegment: TranscriptSegment | null =
    project.segments.find((s) => {
      const effectiveEnd = Math.max(s.endTime, s.startTime + (s.audioDuration || 0));
      return project.currentTime >= s.startTime && project.currentTime <= effectiveEnd;
    }) || null;

  const stopAudio = () => {
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
    setPlayingAudioId(null);
  };

  const playVoiceClip = (clipId: string, url: string, targetSpeed?: number, preAudio?: HTMLAudioElement) => {
    if (playingAudioId === clipId) {
      stopAudio();
      return;
    }

    stopAudio();
    const audio = preAudio || new Audio();
    audio.src = url;
    const speedToUse = targetSpeed || project.voicePlaybackRate || 1.0;
    try {
      audio.playbackRate = speedToUse;
      (audio as any).preservesPitch = true;
      (audio as any).webkitPreservesPitch = true;
    } catch (_) {}

    audio.onended = () => setPlayingAudioId(null);
    audio.onerror = (e) => {
      console.warn('Audio playback error:', e);
      setPlayingAudioId(null);
    };

    audio.play().then(() => {
      setAudioElement(audio);
      setPlayingAudioId(clipId);
    }).catch((playErr) => {
      console.warn('Audio play error, retrying standard play:', playErr);
      // Retry standard play without pitch preservation
      audio.playbackRate = 1.0;
      audio.play().then(() => {
        setAudioElement(audio);
        setPlayingAudioId(clipId);
      }).catch((err2) => {
        console.error('Playback failed:', err2);
        setErrorMessage('အသံဖွင့်ရန် စာမျက်နှာပေါ်တွင် မောက်စ်/လက်ဖြင့် Click နှိပ်ပေးပါ။ (' + (err2.message || 'Autoplay blocked') + ')');
        setPlayingAudioId(null);
      });
    });
  };

  const handleTestVoice = async (vKey: VoiceOption) => {
    if (testingVoice) return;

    // Pre-unlock audio synchronously during user click handler
    const preAudio = new Audio();
    preAudio.play().catch(() => {});

    setTestingVoice(vKey);
    const profile = VOICE_PROFILES[vKey];
    const cacheKey = `${vKey}_${voiceStyle}`;
    setStatusText(`[Gemini Studio] ${profile.name} voice preview testing...`);

    const activeSpeed = project.voicePlaybackRate || 1.0;

    try {
      const samplePhrase = profile.sampleGreeting;
      const result = await synthesizeMyanmarVoice(samplePhrase, {
        voice: vKey,
        style: voiceStyle,
        speed: activeSpeed,
        trimSilence: false,
      });

      setTestAudioUrls((prev) => ({ ...prev, [cacheKey]: result.audioUrl }));
      playVoiceClip(`test_${cacheKey}`, result.audioUrl, activeSpeed, preAudio);
      setStatusText(null);
    } catch (err: any) {
      console.error('Test voice failed:', err);
      setErrorMessage(`${vKey} test failed: ${err.message}`);
      setStatusText(null);
    } finally {
      setTestingVoice(null);
    }
  };

  const handleTestHfSpeaker = async (speakerId: string) => {
    if (testingVoice) return;

    // Pre-unlock audio synchronously during user click handler
    const preAudio = new Audio();
    preAudio.play().catch(() => {});

    setTestingVoice(speakerId);
    const speakerInfo = HF_MULTI_SPEAKERS.find((s) => s.id === speakerId) || HF_MULTI_SPEAKERS[0];
    setStatusText(`[Hugging Face] ${speakerInfo.name} preview testing...`);
    const activeSpeed = project.voicePlaybackRate || 1.0;
    const activeModel = hfModel === 'custom' ? (customHfModel.trim() || 'facebook/mms-tts-mya') : hfModel;

    try {
      const sampleText = 'မင်္ဂလာပါ၊ Hugging Face AI Voice Clone စနစ်ဖြင့် အသံ စမ်းသပ်ခြင်း ဖြစ်ပါသည်။';
      const result = await synthesizeHuggingFaceVoice(sampleText, {
        model: activeModel,
        speakerId,
        speed: activeSpeed,
        onStatusUpdate: (msg) => setStatusText(msg),
      });

      setTestAudioUrls((prev) => ({ ...prev, [speakerId]: result.audioUrl }));
      playVoiceClip(`test_${speakerId}`, result.audioUrl, activeSpeed, preAudio);
      setStatusText(null);
    } catch (err: any) {
      console.error('Test HF speaker failed:', err);
      setErrorMessage(`HF preview failed: ${err.message}`);
      setStatusText(null);
    } finally {
      setTestingVoice(null);
    }
  };

  const handleApplyVoiceAllocation = (overrideVoice?: VoiceOption) => {
    const selected = overrideVoice || singleVoice;
    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) => ({
        ...s,
        voice: selected,
      })),
    }));
    setStatusText(`✓ All segments allocated to single voice (${VOICE_PROFILES[selected].name}).`);
  };

  const handleApplyHfSpeakerAllocation = (overrideSpeaker?: string) => {
    const selected = overrideSpeaker || selectedHfSpeaker;
    const speakerInfo = HF_MULTI_SPEAKERS.find((s) => s.id === selected) || HF_MULTI_SPEAKERS[0];
    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) => ({
        ...s,
        hfSpeaker: selected,
      })),
    }));
    setStatusText(`✓ All segments allocated to HF Speaker (${speakerInfo.name}).`);
  };

  const handleAutoAlternateVoices = () => {
    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s, idx) => ({
        ...s,
        voice: idx % 2 === 0 ? speakerA : speakerB,
        hfSpeaker: idx % 2 === 0 ? hfSpeakerA : hfSpeakerB,
      })),
    }));
    if (voiceEngine === 'gemini') {
      setStatusText(`✓ Auto Double Voice: Odd Segments -> ${VOICE_PROFILES[speakerA].name}, Even Segments -> ${VOICE_PROFILES[speakerB].name}`);
    } else {
      const spA = HF_MULTI_SPEAKERS.find((s) => s.id === hfSpeakerA)?.name || 'Speaker A';
      const spB = HF_MULTI_SPEAKERS.find((s) => s.id === hfSpeakerB)?.name || 'Speaker B';
      setStatusText(`✓ Auto Double HF Voice: Odd Segments -> ${spA}, Even Segments -> ${spB}`);
    }
  };

  const handleSegmentVoiceChange = (segId: string, newVoice: VoiceOption) => {
    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) => (s.id === segId ? { ...s, voice: newVoice } : s)),
    }));
  };

  const handleSegmentHfSpeakerChange = (segId: string, newSpeaker: string) => {
    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) => (s.id === segId ? { ...s, hfSpeaker: newSpeaker } : s)),
    }));
  };

  const handleStyleChange = (newStyle: VoiceStyle) => {
    setVoiceStyle(newStyle);
    setProject((prev) => ({
      ...prev,
      voiceStyle: newStyle,
      segments: prev.segments.map((s) => ({ ...s, style: newStyle })),
    }));
    setStatusText(`✓ Voice style updated to "${newStyle}".`);
  };

  const handleUpdateSegmentRate = (segId: string, newRate: number) => {
    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) => (s.id === segId ? { ...s, playbackRate: newRate } : s)),
    }));
    setStatusText(`✓ Segment speed adjusted to ${newRate.toFixed(2)}x.`);
  };

  const handleAutoRetimeAll = () => {
    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) => {
        const slotDuration = Math.max(1.0, s.endTime - s.startTime);
        if (s.audioDuration && s.audioDuration > 0) {
          const autoRate = Math.min(2.0, Math.max(0.7, parseFloat((s.audioDuration / slotDuration).toFixed(2))));
          return { ...s, playbackRate: autoRate };
        }
        return s;
      }),
    }));
    setStatusText('✓ Auto-Fit Retime All: Segment playback rates adjusted to match original video dialogue duration window (atempo pitch-preserved).');
  };

  const handleGenerateSingle = async (seg: TranscriptSegment) => {
    const text = seg.myanmarTranslation || seg.originalText;
    if (!text) return;

    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) => (s.id === seg.id ? { ...s, isGeneratingAudio: true } : s)),
    }));

    const activeSpeed = seg.playbackRate || project.voicePlaybackRate || 1.0;
    const activeStyle = seg.style || voiceStyle || project.voiceStyle || 'conversational';

    try {
      let resultUrl = '';
      let resultDuration = 0;

      if (voiceEngine === 'huggingface') {
        const activeModel = hfModel === 'custom' ? (customHfModel.trim() || 'facebook/mms-tts-mya') : hfModel;
        const activeSpeaker = seg.hfSpeaker || (voiceMode === 'double' ? (project.segments.findIndex(s => s.id === seg.id) % 2 === 0 ? hfSpeakerA : hfSpeakerB) : selectedHfSpeaker);
        const hfResult = await synthesizeHuggingFaceVoice(text, {
          model: activeModel,
          speakerId: activeSpeaker,
          speed: activeSpeed,
          onStatusUpdate: (msg) => setStatusText(msg),
        });
        resultUrl = hfResult.audioUrl;
        resultDuration = hfResult.duration;
      } else {
        const activeVoice = seg.voice || (voiceMode === 'double' ? (project.segments.findIndex(s => s.id === seg.id) % 2 === 0 ? speakerA : speakerB) : singleVoice);
        const result = await synthesizeMyanmarVoice(text, {
          voice: activeVoice,
          style: activeStyle,
          speed: activeSpeed,
          trimSilence,
          onStatusUpdate: (msg) => setStatusText(msg),
        });
        resultUrl = result.audioUrl;
        resultDuration = result.duration;
      }

      setProject((prev) => ({
        ...prev,
        segments: prev.segments.map((s) =>
          s.id === seg.id
            ? {
                ...s,
                audioUrl: resultUrl,
                audioDuration: resultDuration,
                isGeneratingAudio: false,
              }
            : s
        ),
      }));

      playVoiceClip(seg.id, resultUrl, activeSpeed);
      setStatusText(null);
    } catch (err: any) {
      console.error('TTS error:', err);
      setErrorMessage(`Segment #${seg.id} synthesis failed: ${err.message}`);
      setStatusText(null);
      setProject((prev) => ({
        ...prev,
        segments: prev.segments.map((s) => (s.id === seg.id ? { ...s, isGeneratingAudio: false } : s)),
      }));
    }
  };

  const handleGenerateAll = async () => {
    if (project.segments.length === 0) {
      setErrorMessage('စာတန်းထိုး Segment များ မရှိသေးပါ။ အဆင့် 4 တွင် အရင် Generate လုပ်ပေးပါ။');
      return;
    }

    setIsBatchGenerating(true);
    setErrorMessage(null);
    setBatchProgress({ current: 0, total: project.segments.length });

    const total = project.segments.length;

    for (let i = 0; i < total; i++) {
      const seg = project.segments[i];
      const text = seg.myanmarTranslation || seg.originalText;
      if (!text) continue;

      setBatchProgress({ current: i + 1, total });
      setStatusText(`Synthesizing (${i + 1}/${total}): "${text.substring(0, 20)}..."`);

      const activeSpeed = seg.playbackRate || project.voicePlaybackRate || 1.0;
      const activeStyle = seg.style || voiceStyle || project.voiceStyle || 'conversational';

      try {
        let resultUrl = '';
        let resultDuration = 0;

        if (voiceEngine === 'huggingface') {
          const activeModel = hfModel === 'custom' ? (customHfModel.trim() || 'facebook/mms-tts-mya') : hfModel;
          const activeSpeaker = seg.hfSpeaker || (voiceMode === 'double' ? (i % 2 === 0 ? hfSpeakerA : hfSpeakerB) : selectedHfSpeaker);
          const hfResult = await synthesizeHuggingFaceVoice(text, {
            model: activeModel,
            speakerId: activeSpeaker,
            speed: activeSpeed,
          });
          resultUrl = hfResult.audioUrl;
          resultDuration = hfResult.duration;
        } else {
          const activeVoice = seg.voice || (voiceMode === 'double' ? (i % 2 === 0 ? speakerA : speakerB) : singleVoice);
          const result = await synthesizeMyanmarVoice(text, {
            voice: activeVoice,
            style: activeStyle,
            speed: activeSpeed,
            trimSilence,
          });
          resultUrl = result.audioUrl;
          resultDuration = result.duration;
        }

        setProject((prev) => ({
          ...prev,
          segments: prev.segments.map((s) =>
            s.id === seg.id
              ? {
                  ...s,
                  audioUrl: resultUrl,
                  audioDuration: resultDuration,
                }
              : s
          ),
        }));
      } catch (err: any) {
        console.warn(`Batch item ${i + 1} warning:`, err.message);
      }
    }

    setIsBatchGenerating(false);
    setBatchProgress(null);
    setStatusText(`✓ All ${total} segment audios synthesized successfully!`);
    setTimeout(() => setStatusText(null), 5000);
  };

  const generatedCount = project.segments.filter((s) => !!s.audioUrl).length;
  const currentHfKey = loadApiKeys().huggingFaceKey;

  const currentVoiceProfile = VOICE_PROFILES[singleVoice];
  const profileA = VOICE_PROFILES[speakerA];
  const profileB = VOICE_PROFILES[speakerB];

  const currentHfSpeakerInfo = HF_MULTI_SPEAKERS.find((s) => s.id === selectedHfSpeaker) || HF_MULTI_SPEAKERS[0];
  const hfInfoA = HF_MULTI_SPEAKERS.find((s) => s.id === hfSpeakerA) || HF_MULTI_SPEAKERS[0];
  const hfInfoB = HF_MULTI_SPEAKERS.find((s) => s.id === hfSpeakerB) || HF_MULTI_SPEAKERS[1] || HF_MULTI_SPEAKERS[0];

  // Filtered Voices for Flow Panel
  const filteredVoices = ALL_VOICES.filter((vKey) => {
    const p = VOICE_PROFILES[vKey];
    if (genderFilter === 'male' && p.gender !== 'male') return false;
    if (genderFilter === 'female' && p.gender !== 'female') return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return p.name.toLowerCase().includes(q) || p.toneTitle.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Step 5 Main Content Container: Video Player Preview (Left) + Voice Controls (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Custom Upload Video Player with Live Subtitles */}
        <div className="lg:col-span-7 space-y-3 sticky top-20">
          <div className="flex items-center justify-between px-4 py-2.5 rounded-2xl bg-black/40 border border-white/10 text-xs backdrop-blur-xl">
            <span className="font-bold text-white flex items-center gap-2 font-display">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Custom Video & Live Subtitle Preview</span>
            </span>
            <span className="text-[10px] text-zinc-400 font-myanmar">
              Voice Clone အသံနှင့် Subtitle အချိန်ကိုက် ကြည့်ရှုနိုင်ပါသည်
            </span>
          </div>

          <VideoPlayerView
            project={project}
            setProject={setProject}
            activeSegment={activeSegment}
          />
        </div>

        {/* RIGHT COLUMN: Voice Clone Studio Controls & Flow Panel Triggers */}
        <div className="lg:col-span-5 space-y-5">
          {/* Status & Notification Banner */}
          {statusText && (
            <div className="p-3.5 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 text-xs text-emerald-200 flex items-center gap-2.5 animate-fade-in shadow-lg">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="font-myanmar leading-relaxed">{statusText}</span>
            </div>
          )}

          {errorMessage && (
            <div className="p-3.5 rounded-2xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200 flex items-center gap-2.5 animate-fade-in shadow-lg">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span className="font-myanmar leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {/* SINGLE VS DOUBLE VOICE MODE SWITCHER */}
          <div className="p-1.5 rounded-2xl bg-black/60 border border-white/10 flex items-center gap-2 shadow-xl backdrop-blur-xl">
            <button
              type="button"
              onClick={() => {
                setVoiceMode('single');
                handleApplyVoiceAllocation(singleVoice);
              }}
              className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                voiceMode === 'single'
                  ? 'bg-gradient-to-r from-emerald-400 to-teal-400 text-zinc-950 shadow-md font-black'
                  : 'text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10'
              }`}
            >
              <User className="w-4 h-4" />
              <span>Single Voice Mode (၁ ယောက်တည်း)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setVoiceMode('double');
                handleAutoAlternateVoices();
              }}
              className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                voiceMode === 'double'
                  ? 'bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 text-zinc-950 shadow-md font-black'
                  : 'text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Double Voice Mode (၂ ယောက် ရောမည်)</span>
            </button>
          </div>

          {/* ENGINE TABS: GEMINI VS HUGGING FACE */}
          <div className="flex items-center gap-2 p-1 bg-white/5 rounded-2xl border border-white/10">
            <button
              type="button"
              onClick={() => setVoiceEngine('gemini')}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                voiceEngine === 'gemini'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-black shadow'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <AudioLines className="w-4 h-4 text-emerald-400" />
              <span>Gemini 24kHz Reality</span>
            </button>

            <button
              type="button"
              onClick={() => setVoiceEngine('huggingface')}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                voiceEngine === 'huggingface'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-black shadow'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <span>🤗 Hugging Face AI Clone</span>
            </button>
          </div>

          {/* VOICE CONFIGURATION CARDS BASED ON MODE */}
          {voiceMode === 'single' ? (
            /* SINGLE VOICE MODE CARD */
            <div className="space-y-3">
              <span className="text-xs font-black text-emerald-300 uppercase tracking-widest block font-display">
                Single Voice Character (နှိပ်၍ Flow Panel ဖွင့်ရန်)
              </span>

              {voiceEngine === 'gemini' ? (
                <div
                  onClick={() => {
                    setTargetSlot('single');
                    setIsGeminiFlowOpen(true);
                  }}
                  className="p-4 rounded-2xl border border-emerald-400/80 bg-gradient-to-r from-emerald-500/20 via-teal-500/10 to-transparent hover:border-emerald-300 transition-all cursor-pointer group shadow-xl flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-400 to-teal-400 text-zinc-950 font-black flex items-center justify-center text-base shadow-md">
                      {currentVoiceProfile.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-white font-display">
                        {currentVoiceProfile.name} ({currentVoiceProfile.gender === 'male' ? 'Male' : 'Female'})
                      </h3>
                      <p className="text-xs text-emerald-300/90 font-medium mt-0.5">
                        {currentVoiceProfile.toneTitle}
                      </p>
                    </div>
                  </div>

                  <span className="text-xs font-bold text-emerald-400 group-hover:translate-x-1 transition-transform flex items-center gap-1 shrink-0">
                    <span>Flow Panel</span>
                    <ChevronRight className="w-4 h-4" />
                  </span>
                </div>
              ) : (
                <div
                  onClick={() => {
                    setTargetSlot('single');
                    setIsHfFlowOpen(true);
                  }}
                  className="p-4 rounded-2xl border border-amber-400/80 bg-gradient-to-r from-amber-500/20 via-orange-500/10 to-transparent hover:border-amber-300 transition-all cursor-pointer group shadow-xl flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-400 to-orange-400 text-zinc-950 font-black flex items-center justify-center text-lg shadow-md">
                      🤗
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-white font-display">
                        {currentHfSpeakerInfo.name} ({currentHfSpeakerInfo.gender})
                      </h3>
                      <p className="text-xs text-amber-300/90 font-medium mt-0.5">
                        HF Model: {hfModel}
                      </p>
                    </div>
                  </div>

                  <span className="text-xs font-bold text-amber-400 group-hover:translate-x-1 transition-transform flex items-center gap-1 shrink-0">
                    <span>Flow Panel</span>
                    <ChevronRight className="w-4 h-4" />
                  </span>
                </div>
              )}
            </div>
          ) : (
            /* DOUBLE VOICE MODE CARDS (SPEAKER A & SPEAKER B) */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-cyan-300 uppercase tracking-widest block font-display">
                  Double Voice (Speaker A & B)
                </span>
                <button
                  type="button"
                  onClick={handleAutoAlternateVoices}
                  className="px-2.5 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 rounded-xl text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1 shadow"
                >
                  <Zap className="w-3 h-3 text-cyan-400" />
                  <span>⚡ Auto Alternate A/B</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* SPEAKER A CARD */}
                <div
                  onClick={() => {
                    setTargetSlot('speakerA');
                    if (voiceEngine === 'gemini') setIsGeminiFlowOpen(true);
                    else setIsHfFlowOpen(true);
                  }}
                  className="p-3.5 rounded-2xl border border-emerald-500/50 bg-emerald-950/30 hover:border-emerald-400 transition-all cursor-pointer group shadow-lg flex items-center justify-between"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-lg bg-emerald-400 text-zinc-950 font-black text-xs flex items-center justify-center shrink-0">
                      A
                    </span>
                    <div className="truncate">
                      <span className="text-[10px] text-emerald-400 font-bold block uppercase tracking-wider">Speaker A</span>
                      <span className="text-xs font-black text-white truncate block font-display">
                        {voiceEngine === 'gemini' ? profileA.name : hfInfoA.name}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-emerald-400 group-hover:translate-x-1 transition-transform shrink-0" />
                </div>

                {/* SPEAKER B CARD */}
                <div
                  onClick={() => {
                    setTargetSlot('speakerB');
                    if (voiceEngine === 'gemini') setIsGeminiFlowOpen(true);
                    else setIsHfFlowOpen(true);
                  }}
                  className="p-3.5 rounded-2xl border border-cyan-500/50 bg-cyan-950/30 hover:border-cyan-400 transition-all cursor-pointer group shadow-lg flex items-center justify-between"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-lg bg-cyan-400 text-zinc-950 font-black text-xs flex items-center justify-center shrink-0">
                      B
                    </span>
                    <div className="truncate">
                      <span className="text-[10px] text-cyan-400 font-bold block uppercase tracking-wider">Speaker B</span>
                      <span className="text-xs font-black text-white truncate block font-display">
                        {voiceEngine === 'gemini' ? profileB.name : hfInfoB.name}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-cyan-400 group-hover:translate-x-1 transition-transform shrink-0" />
                </div>
              </div>
            </div>
          )}

          {/* Speed & Silence Controls */}
          <div className="p-4 rounded-2xl bg-black/40 border border-white/10 space-y-3 backdrop-blur-xl">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-white flex items-center gap-2 font-display">
                <Zap className="w-4 h-4 text-emerald-400" />
                <span>Voice Clone Speed</span>
              </span>
              <span className="text-xs font-mono font-bold text-emerald-300 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                {(project.voicePlaybackRate || 1.0).toFixed(2)}x
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono text-zinc-400 font-bold">0.5x</span>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.05"
                value={project.voicePlaybackRate || 1.0}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setProject((prev) => ({
                    ...prev,
                    voicePlaybackRate: val,
                  }));
                }}
                className="flex-1 accent-emerald-400 h-2 bg-white/10 rounded-lg cursor-pointer"
              />
              <span className="text-[10px] font-mono text-zinc-400 font-bold">2.0x</span>
            </div>

            <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-2 flex-wrap">
              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={trimSilence}
                  onChange={(e) => setTrimSilence(e.target.checked)}
                  className="rounded bg-zinc-900 border-white/20 text-emerald-400 cursor-pointer w-3.5 h-3.5 accent-emerald-400"
                />
                <Scissors className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-medium text-[11px]">Silence Trimmer</span>
              </label>

              <button
                type="button"
                onClick={handleAutoRetimeAll}
                className="px-2.5 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded-xl text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1 shadow"
                title="Auto-adjust all generated segment audio speeds (atempo) to fit exact clip durations"
              >
                <Zap className="w-3 h-3 text-emerald-400" />
                <span>⚡ Auto-Fit All Retime Speeds</span>
              </button>

              <span className="text-[10px] text-zinc-400 font-mono">
                Generated: {generatedCount} / {project.segments.length}
              </span>
            </div>
          </div>

          {/* Action Button: Batch Generate All Voices */}
          <button
            onClick={handleGenerateAll}
            disabled={isBatchGenerating || project.segments.length === 0}
            className={`w-full py-3.5 px-6 disabled:opacity-50 text-zinc-950 text-xs sm:text-sm font-black rounded-2xl transition-all flex items-center justify-center gap-2.5 shadow-2xl cursor-pointer ${
              voiceEngine === 'huggingface'
                ? 'bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 shadow-amber-500/25 hover:scale-[1.01]'
                : 'bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 shadow-emerald-500/25 hover:scale-[1.01]'
            }`}
          >
            {isBatchGenerating ? (
              <>
                <RotateCw className="w-4 h-4 animate-spin" />
                <span>Generating ({batchProgress?.current}/{batchProgress?.total})...</span>
              </>
            ) : (
              <>
                <Volume2 className="w-4 h-4 stroke-[2.5]" />
                <span>Generate All Voices ({project.segments.length} Segments)</span>
              </>
            )}
          </button>

          {/* Subtitle & Segment Voice List */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <h3 className="text-xs font-bold text-white font-display">
                  Segment Timing & Voice Clone Selection
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  const last = project.segments[project.segments.length - 1];
                  const newStart = last ? last.endTime + 0.2 : 0;
                  const newSeg: TranscriptSegment = {
                    id: 'seg_' + Date.now(),
                    startTime: parseFloat(newStart.toFixed(1)),
                    endTime: parseFloat((newStart + 4).toFixed(1)),
                    originalText: 'New segment',
                    myanmarTranslation: 'စာသားအသစ် ထည့်ရန်...',
                    voice: singleVoice,
                  };
                  setProject((prev) => ({ ...prev, segments: [...prev.segments, newSeg] }));
                }}
                className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-emerald-300 border border-white/10 rounded-xl text-[10px] font-bold transition-all cursor-pointer"
              >
                + Add Segment
              </button>
            </div>

            <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1.5">
              {project.segments.map((seg, idx) => {
                const isSegPlaying = playingAudioId === seg.id;
                const segActiveVoice = seg.voice || (voiceMode === 'double' ? (idx % 2 === 0 ? speakerA : speakerB) : singleVoice);
                const segActiveHfSpeaker = seg.hfSpeaker || (voiceMode === 'double' ? (idx % 2 === 0 ? hfSpeakerA : hfSpeakerB) : selectedHfSpeaker);

                return (
                  <div
                    key={seg.id}
                    className="p-3 rounded-2xl bg-black/40 border border-white/10 space-y-2.5 hover:border-emerald-500/40 transition-all shadow-md"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center justify-center font-mono text-[10px] font-bold">
                          {idx + 1}
                        </span>
                        <span className="text-[11px] font-mono text-zinc-300">
                          {seg.startTime}s - {seg.endTime}s
                        </span>
                      </div>

                      {/* PER-SEGMENT VOICE CLONE DROPDOWN & QUICK A/B TOGGLE */}
                      <div className="flex items-center gap-2">
                        {voiceEngine === 'gemini' ? (
                          <select
                            value={segActiveVoice}
                            onChange={(e) => handleSegmentVoiceChange(seg.id, e.target.value as VoiceOption)}
                            className="px-2.5 py-1 bg-zinc-900 border border-emerald-500/40 rounded-xl text-xs font-bold text-emerald-300 focus:outline-none focus:border-emerald-400 cursor-pointer max-w-[130px] truncate"
                          >
                            {ALL_VOICES.map((v) => (
                              <option key={v} value={v} className="bg-zinc-900 text-white font-sans">
                                {VOICE_PROFILES[v].name} ({VOICE_PROFILES[v].gender === 'male' ? 'M' : 'F'})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <select
                            value={segActiveHfSpeaker}
                            onChange={(e) => handleSegmentHfSpeakerChange(seg.id, e.target.value)}
                            className="px-2.5 py-1 bg-zinc-900 border border-amber-500/40 rounded-xl text-xs font-bold text-amber-300 focus:outline-none focus:border-amber-400 cursor-pointer max-w-[130px] truncate"
                          >
                            {HF_MULTI_SPEAKERS.map((sp) => (
                              <option key={sp.id} value={sp.id} className="bg-zinc-900 text-white font-sans">
                                {sp.name} ({sp.gender})
                              </option>
                            ))}
                          </select>
                        )}

                        {/* Double Voice Mode Quick A/B Buttons */}
                        {voiceMode === 'double' && (
                          <div className="flex items-center gap-1 bg-white/5 p-0.5 rounded-lg border border-white/10 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                if (voiceEngine === 'gemini') handleSegmentVoiceChange(seg.id, speakerA);
                                else handleSegmentHfSpeakerChange(seg.id, hfSpeakerA);
                              }}
                              className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                                (voiceEngine === 'gemini' ? segActiveVoice === speakerA : segActiveHfSpeaker === hfSpeakerA)
                                  ? 'bg-emerald-400 text-zinc-950 shadow font-black'
                                  : 'text-zinc-400 hover:text-white'
                              }`}
                              title={`Speaker A (${voiceEngine === 'gemini' ? speakerA : hfInfoA.name})`}
                            >
                              A
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                if (voiceEngine === 'gemini') handleSegmentVoiceChange(seg.id, speakerB);
                                else handleSegmentHfSpeakerChange(seg.id, hfSpeakerB);
                              }}
                              className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                                (voiceEngine === 'gemini' ? segActiveVoice === speakerB : segActiveHfSpeaker === hfSpeakerB)
                                  ? 'bg-cyan-400 text-zinc-950 shadow font-black'
                                  : 'text-zinc-400 hover:text-white'
                              }`}
                              title={`Speaker B (${voiceEngine === 'gemini' ? speakerB : hfInfoB.name})`}
                            >
                              B
                            </button>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            if (seg.audioUrl) {
                              playVoiceClip(seg.id, seg.audioUrl, seg.playbackRate);
                            } else {
                              handleGenerateSingle(seg);
                            }
                          }}
                          disabled={seg.isGeneratingAudio}
                          className="px-2.5 py-1 bg-white/10 hover:bg-emerald-400 hover:text-zinc-950 text-white rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer"
                        >
                          {seg.isGeneratingAudio ? (
                            <RotateCw className="w-3 h-3 animate-spin text-emerald-400" />
                          ) : isSegPlaying ? (
                            <Pause className="w-3 h-3" />
                          ) : (
                            <Play className="w-3 h-3" />
                          )}
                          <span>{seg.audioUrl ? 'Play' : 'Gen'}</span>
                        </button>
                      </div>
                    </div>

                    <input
                      type="text"
                      value={seg.myanmarTranslation}
                      onChange={(e) => {
                        const val = e.target.value;
                        setProject((prev) => ({
                          ...prev,
                          segments: prev.segments.map((s) => (s.id === seg.id ? { ...s, myanmarTranslation: val } : s)),
                        }));
                      }}
                      placeholder="မြန်မာဘာသာပြန်..."
                      className="w-full px-3 py-1.5 bg-zinc-950/70 border border-white/10 rounded-xl text-xs font-myanmar text-white focus:outline-none focus:border-emerald-400"
                    />

                    {/* Duration Alignment & Auto-Retime Speed Control */}
                    <div className="flex items-center justify-between text-[10px] text-zinc-400 pt-1 border-t border-white/5 flex-wrap gap-1">
                      <div className="flex items-center gap-2 font-mono">
                        <span>Slot: {(seg.endTime - seg.startTime).toFixed(1)}s</span>
                        {seg.audioDuration ? (
                          <span className={seg.audioDuration > (seg.endTime - seg.startTime) ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold'}>
                            | Audio: {seg.audioDuration.toFixed(1)}s
                          </span>
                        ) : null}
                        <span className="text-zinc-500">
                          | Speed: {(seg.playbackRate || project.voicePlaybackRate || 1.0).toFixed(2)}x
                        </span>
                      </div>

                      {seg.audioDuration && (
                        <button
                          type="button"
                          onClick={() => {
                            const slotDur = Math.max(1.0, seg.endTime - seg.startTime);
                            const autoRate = Math.min(2.0, Math.max(0.7, parseFloat((seg.audioDuration! / slotDur).toFixed(2))));
                            handleUpdateSegmentRate(seg.id, autoRate);
                          }}
                          className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-lg hover:bg-emerald-500/30 transition-all font-bold cursor-pointer flex items-center gap-1"
                          title="Auto-Fit audio duration to original video dialogue duration window"
                        >
                          <Zap className="w-2.5 h-2.5 text-emerald-400" />
                          <span>⚡ Auto-Fit ({(seg.audioDuration / Math.max(1.0, seg.endTime - seg.startTime)).toFixed(2)}x)</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM NAVIGATION CARD */}
      <div className="ios-card p-5 flex items-center justify-between gap-4">
        {onPrevStep ? (
          <button
            onClick={onPrevStep}
            className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl transition-all border border-white/15 flex items-center gap-2 cursor-pointer active:scale-95 shadow-md"
          >
            <ArrowLeft className="w-4 h-4 stroke-[2.5]" />
            <span>အဆင့် 4 သို့</span>
          </button>
        ) : (
          <div />
        )}

        <span className="text-xs text-zinc-400 font-myanmar hidden sm:inline">
          Voice Clone ပြီးပါက အဆင့် 6 (Subtitle Studio) သို့ သွားပါ
        </span>

        {onNextStep && (
          <button
            onClick={onNextStep}
            className="px-6 py-3 bg-gradient-to-r from-emerald-400 to-teal-400 hover:opacity-90 text-zinc-950 font-black text-xs rounded-xl transition-all flex items-center gap-2.5 shadow-xl shadow-emerald-500/25 cursor-pointer active:scale-95 shrink-0"
          >
            <span>အဆင့် 6 သို့</span>
            <ArrowRight className="w-4 h-4 stroke-[2.5]" />
          </button>
        )}
      </div>

      {/* ========================================================================= */}
      {/* FLOW PANEL 1: GEMINI 24kHz REALITY VOICES (MODAL OVERLAY) */}
      {/* ========================================================================= */}
      {isGeminiFlowOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fade-in">
          <div className="w-full max-w-2xl bg-zinc-950 border border-emerald-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden relative">
            {/* Ambient Background Glow */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

            {/* Flow Panel Header */}
            <div className="flex items-center justify-between pb-4 border-b border-white/10 relative z-10">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <AudioLines className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white font-display">
                    Gemini 24kHz Reality Voices — Flow Panel
                  </h3>
                  <p className="text-xs text-zinc-400 font-myanmar">
                    Target: <span className="font-bold text-emerald-300 uppercase">{targetSlot}</span> — လူ ၂၅ ကျော်ပါသော Voice Clone characters များကို ရွေးချယ်၊ စမ်းသပ်ပါ
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsGeminiFlowOpen(false)}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Flow Panel Scrollable Content */}
            <div className="flex-1 overflow-y-auto space-y-5 py-4 pr-1 relative z-10">
              {/* Vocal Emotion Styles */}
              <div className="space-y-2.5">
                <span className="text-xs font-black text-emerald-300 uppercase tracking-widest block font-display">
                  1. Vocal Emotion & Presentation Style
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { id: 'conversational' as VoiceStyle, label: '🎙️ Conversational' },
                    { id: 'recap' as VoiceStyle, label: '🎬 Movie Recap' },
                    { id: 'broadcast' as VoiceStyle, label: '📢 Broadcast' },
                    { id: 'energetic' as VoiceStyle, label: '🔥 High Energy' },
                    { id: 'soothing' as VoiceStyle, label: '☕ Calm' },
                    { id: 'affectionate' as VoiceStyle, label: '💖 Warm' },
                  ].map((styleItem) => {
                    const isSelected = voiceStyle === styleItem.id;
                    return (
                      <button
                        key={styleItem.id}
                        type="button"
                        onClick={() => handleStyleChange(styleItem.id)}
                        className={`p-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer text-center ${
                          isSelected
                            ? 'bg-gradient-to-r from-emerald-500/30 to-teal-500/20 border-emerald-400 text-emerald-300 shadow-md ring-1 ring-emerald-400/40 font-black'
                            : 'bg-white/5 border-white/10 text-zinc-400 hover:text-zinc-200 hover:bg-white/10'
                        }`}
                      >
                        {styleItem.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Filters & Search */}
              <div className="space-y-2.5 pt-2 border-t border-white/10">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  {/* Gender Filter Tabs */}
                  <div className="flex items-center gap-1.5 p-1 bg-white/5 rounded-xl border border-white/10">
                    <button
                      type="button"
                      onClick={() => setGenderFilter('all')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        genderFilter === 'all'
                          ? 'bg-emerald-400 text-zinc-950 shadow-md'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      All ({ALL_VOICES.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setGenderFilter('male')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        genderFilter === 'male'
                          ? 'bg-emerald-400 text-zinc-950 shadow-md'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Male ({MALE_VOICES.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setGenderFilter('female')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        genderFilter === 'female'
                          ? 'bg-emerald-400 text-zinc-950 shadow-md'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Female ({FEMALE_VOICES.length})
                    </button>
                  </div>

                  {/* Search Input */}
                  <div className="relative flex-1 max-w-xs">
                    <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search character..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 bg-zinc-900 border border-white/10 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-400"
                    />
                  </div>
                </div>
              </div>

              {/* Character List */}
              <div className="space-y-2.5">
                <span className="text-xs font-black text-emerald-300 uppercase tracking-widest block font-display">
                  2. Voice Clone Characters List
                </span>

                <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                  {filteredVoices.map((vKey) => {
                    const profile = VOICE_PROFILES[vKey];
                    const activeVoiceTarget = targetSlot === 'speakerA' ? speakerA : targetSlot === 'speakerB' ? speakerB : singleVoice;
                    const isSelected = activeVoiceTarget === vKey;
                    const cacheKey = `${vKey}_${voiceStyle}`;
                    const isPlaying = playingAudioId === `test_${cacheKey}`;
                    const isTesting = testingVoice === vKey;
                    const initialChar = profile.name.charAt(0).toUpperCase();

                    const handleSelectCharacter = () => {
                      if (targetSlot === 'speakerA') {
                        setSpeakerA(vKey);
                        setStatusText(`✓ Speaker A set to (${profile.name}).`);
                      } else if (targetSlot === 'speakerB') {
                        setSpeakerB(vKey);
                        setStatusText(`✓ Speaker B set to (${profile.name}).`);
                      } else {
                        setSingleVoice(vKey);
                        handleApplyVoiceAllocation(vKey);
                      }
                      setIsGeminiFlowOpen(false);
                    };

                    return (
                      <div
                        key={vKey}
                        onClick={handleSelectCharacter}
                        className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between cursor-pointer group ${
                          isSelected
                            ? 'bg-gradient-to-r from-emerald-500/25 via-teal-500/10 to-transparent border-emerald-400 text-emerald-200 shadow-xl ring-1 ring-emerald-400/50'
                            : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shadow-md ${
                              isSelected
                                ? 'bg-gradient-to-tr from-emerald-400 to-teal-400 text-zinc-950 font-black'
                                : 'bg-white/10 text-white'
                            }`}
                          >
                            {initialChar}
                          </div>

                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-white font-display">
                                {profile.name}
                              </span>
                              <span className="text-[9px] font-mono px-2 py-0.2 rounded-full bg-white/10 text-zinc-300">
                                {profile.gender === 'male' ? 'Male' : 'Female'}
                              </span>
                            </div>
                            <span className="text-[11px] text-zinc-400 block mt-0.5">
                              {profile.toneTitle}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap justify-end">
                          {testAudioUrls[cacheKey] && (
                            <audio
                              src={testAudioUrls[cacheKey]}
                              controls
                              className="h-7 w-32 rounded-lg opacity-80 hover:opacity-100"
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}

                          {/* Test Voice Button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (testAudioUrls[cacheKey]) {
                                playVoiceClip(`test_${cacheKey}`, testAudioUrls[cacheKey]);
                              } else {
                                handleTestVoice(vKey);
                              }
                            }}
                            disabled={isTesting}
                            className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-emerald-400 hover:text-zinc-950 text-white transition-all text-xs font-bold flex items-center gap-1.5 shadow-md cursor-pointer"
                          >
                            {isPlaying ? (
                              <>
                                <Pause className="w-3.5 h-3.5" />
                                <span>Stop</span>
                              </>
                            ) : isTesting ? (
                              <>
                                <RotateCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                                <span>Loading...</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5" />
                                <span>Test Voice</span>
                              </>
                            )}
                          </button>

                          {/* Select / Active Indicator */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectCharacter();
                            }}
                            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-emerald-400 text-zinc-950 shadow-md flex items-center gap-1'
                                : 'bg-white/10 hover:bg-white/20 text-zinc-300'
                            }`}
                          >
                            {isSelected ? (
                              <>
                                <Check className="w-3.5 h-3.5 stroke-[3]" />
                                <span>Selected</span>
                              </>
                            ) : (
                              <span>Select</span>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Flow Panel Footer */}
            <div className="pt-4 border-t border-white/10 flex items-center justify-between relative z-10">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-zinc-400">Target Slot:</span>
                <span className="font-bold text-emerald-300 font-display uppercase">
                  {targetSlot} ({VOICE_PROFILES[targetSlot === 'speakerA' ? speakerA : targetSlot === 'speakerB' ? speakerB : singleVoice].name})
                </span>
              </div>

              <button
                type="button"
                onClick={() => setIsGeminiFlowOpen(false)}
                className="px-6 py-2.5 bg-gradient-to-r from-emerald-400 to-teal-400 text-zinc-950 font-black text-xs rounded-xl shadow-lg hover:opacity-90 transition-all cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* FLOW PANEL 2: HUGGING FACE AI CLONE (MODAL OVERLAY) */}
      {/* ========================================================================= */}
      {isHfFlowOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fade-in">
          <div className="w-full max-w-2xl bg-zinc-950 border border-amber-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden relative">
            <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-white/10 relative z-10">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 text-lg">
                  🤗
                </div>
                <div>
                  <h3 className="text-base font-black text-white font-display">
                    Hugging Face AI Clone — Flow Panel
                  </h3>
                  <p className="text-xs text-zinc-400 font-myanmar">
                    Target: <span className="font-bold text-amber-300 uppercase">{targetSlot}</span> — XTTS-v2 & Multi-Speaker Burmese AI Voice Models
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsHfFlowOpen(false)}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto space-y-5 py-4 pr-1 relative z-10">
              {!currentHfKey ? (
                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex items-center justify-between gap-4 shadow-lg">
                  <span>Hugging Face Token မထည့်ရသေးပါ။ Step 1 တွင် အရင်ထည့်သွင်းပေးပါ။</span>
                  <a
                    href="https://huggingface.co/settings/tokens"
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-zinc-950 rounded-xl font-bold text-xs shrink-0 flex items-center gap-1.5 shadow-md transition-all"
                  >
                    <span>Free Token ရယူရန်</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              ) : (
                <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between text-xs text-emerald-300">
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Hugging Face Access Token Connected</span>
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 font-bold uppercase">Ready</span>
                </div>
              )}

              {/* Models */}
              <div className="space-y-2.5">
                <span className="text-xs font-black text-amber-300 uppercase tracking-widest block font-display">
                  1. AI Voice Architecture Model
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {HF_VOICE_MODELS.map((m) => {
                    const isSelected = hfModel === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setHfModel(m.id)}
                        className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-gradient-to-br from-amber-500/20 to-orange-500/10 border-amber-400 text-amber-200 shadow-md ring-1 ring-amber-400/40 font-bold'
                            : 'bg-white/5 border-white/10 text-zinc-400 hover:text-zinc-200 hover:bg-white/10'
                        }`}
                      >
                        <span className="text-xs font-black block text-white font-display">{m.name}</span>
                        <span className="text-[10px] font-mono text-zinc-400 mt-0.5 block">{m.badge}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Multi-speaker Profiles */}
              <div className="space-y-2.5 pt-2 border-t border-white/10">
                <span className="text-xs font-black text-amber-300 uppercase tracking-widest block font-display">
                  2. Hugging Face Speaker Characters
                </span>

                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {HF_MULTI_SPEAKERS.map((sp) => {
                    const activeHfTarget = targetSlot === 'speakerA' ? hfSpeakerA : targetSlot === 'speakerB' ? hfSpeakerB : selectedHfSpeaker;
                    const isSelected = activeHfTarget === sp.id;
                    const isPlaying = playingAudioId === `test_${sp.id}`;
                    const isTesting = testingVoice === sp.id;

                    const handleSelectHfSpeaker = () => {
                      if (targetSlot === 'speakerA') {
                        setHfSpeakerA(sp.id);
                        setStatusText(`✓ HF Speaker A set to (${sp.name}).`);
                      } else if (targetSlot === 'speakerB') {
                        setHfSpeakerB(sp.id);
                        setStatusText(`✓ HF Speaker B set to (${sp.name}).`);
                      } else {
                        setSelectedHfSpeaker(sp.id);
                        handleApplyHfSpeakerAllocation(sp.id);
                      }
                      setIsHfFlowOpen(false);
                    };

                    return (
                      <div
                        key={sp.id}
                        onClick={handleSelectHfSpeaker}
                        className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between cursor-pointer group ${
                          isSelected
                            ? 'bg-gradient-to-r from-amber-500/25 via-orange-500/10 to-transparent border-amber-400 text-amber-200 shadow-xl ring-1 ring-amber-400/50'
                            : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shadow-md ${
                              isSelected
                                ? 'bg-gradient-to-tr from-amber-400 to-orange-400 text-zinc-950 font-black'
                                : 'bg-white/10 text-white'
                            }`}
                          >
                            {sp.gender === 'Male' ? '👨' : '👩'}
                          </div>

                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-white font-display">
                                {sp.name}
                              </span>
                              <span className="text-[9px] font-mono px-2 py-0.2 rounded-full bg-white/10 text-zinc-300">
                                {sp.gender}
                              </span>
                            </div>
                            <span className="text-[11px] text-zinc-400 block mt-0.5">
                              {sp.toneTitle}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap justify-end">
                          {testAudioUrls[sp.id] && (
                            <audio
                              src={testAudioUrls[sp.id]}
                              controls
                              className="h-7 w-32 rounded-lg opacity-80 hover:opacity-100"
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}

                          {/* Test Voice Button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (testAudioUrls[sp.id]) {
                                playVoiceClip(`test_${sp.id}`, testAudioUrls[sp.id]);
                              } else {
                                handleTestHfSpeaker(sp.id);
                              }
                            }}
                            disabled={isTesting}
                            className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-amber-400 hover:text-zinc-950 text-white transition-all text-xs font-bold flex items-center gap-1.5 shadow-md cursor-pointer"
                          >
                            {isPlaying ? (
                              <>
                                <Pause className="w-3.5 h-3.5" />
                                <span>Stop</span>
                              </>
                            ) : isTesting ? (
                              <>
                                <RotateCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                                <span>Loading...</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5" />
                                <span>Test Voice</span>
                              </>
                            )}
                          </button>

                          {/* Select Button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectHfSpeaker();
                            }}
                            className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-amber-400 text-zinc-950 shadow-md flex items-center gap-1'
                                : 'bg-white/10 hover:bg-white/20 text-zinc-300'
                            }`}
                          >
                            {isSelected ? (
                              <>
                                <Check className="w-3.5 h-3.5 stroke-[3]" />
                                <span>Selected</span>
                              </>
                            ) : (
                              <span>Select</span>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="pt-4 border-t border-white/10 flex items-center justify-between relative z-10">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-zinc-400">Target Slot:</span>
                <span className="font-bold text-amber-300 font-display uppercase">
                  {targetSlot} ({HF_MULTI_SPEAKERS.find(s => s.id === (targetSlot === 'speakerA' ? hfSpeakerA : targetSlot === 'speakerB' ? hfSpeakerB : selectedHfSpeaker))?.name})
                </span>
              </div>

              <button
                type="button"
                onClick={() => setIsHfFlowOpen(false)}
                className="px-6 py-2.5 bg-gradient-to-r from-amber-400 to-orange-400 text-zinc-950 font-black text-xs rounded-xl shadow-lg hover:opacity-90 transition-all cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
