import React, { useState, useEffect } from 'react';
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
  ShieldCheck,
} from 'lucide-react';
import { ProjectState, TranscriptSegment, VoiceOption } from '../types';
import { synthesizeMyanmarVoice, VOICE_PROFILES, VoiceStyle } from '../utils/edgeTtsClient';
import { synthesizeHuggingFaceVoice, HF_VOICE_MODELS, HF_MULTI_SPEAKERS } from '../utils/huggingFaceClient';
import { loadApiKeys } from '../utils/apiKeys';
import {
  fetchElevenLabsVoices,
  cloneElevenLabsVoice,
  cloneElevenLabsFromSampleVideo,
  synthesizeElevenLabsVoice,
  ElevenLabsVoiceItem,
} from '../utils/elevenLabsHumeClient';
import { shortenBurmeseTextForDuration } from '../utils/geminiPool';
import { VideoPlayerView } from './VideoPlayerView';
import { HumanReviewDubbingStudio } from './HumanReviewDubbingStudio';
import {
  getMinuteBlocks,
  formatMinSec,
  clampGentleNarratorRate,
  realignSegmentsByMinuteBlocks,
  findActiveSegmentForTime,
  MINUTE_BLOCK_SECONDS,
} from '../utils/timingSync';

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
  const [studioTab, setStudioTab] = useState<'generation' | 'review'>('generation');
  const [voiceEngine, setVoiceEngine] = useState<'gemini' | 'huggingface' | 'elevenlabs'>('gemini');
  
  const [elevenLabsVoices, setElevenLabsVoices] = useState<ElevenLabsVoiceItem[]>([]);
  const [selectedElevenLabsVoiceId, setSelectedElevenLabsVoiceId] = useState<string>('');
  const [isElevenLabsFlowOpen, setIsElevenLabsFlowOpen] = useState(false);
  const [isCloningVoice, setIsCloningVoice] = useState(false);
  const [isCloningSampleVideo, setIsCloningSampleVideo] = useState(false);
  const [cloneAudioFile, setCloneAudioFile] = useState<File | null>(null);
  const [cloneVoiceName, setCloneVoiceName] = useState('My Burmese Clone');

  const handleApplyElevenLabsAllocation = (voiceId: string, voiceName?: string) => {
    setSelectedElevenLabsVoiceId(voiceId);
    const targetName = voiceName || elevenLabsVoices.find((v) => v.voice_id === voiceId)?.name || 'Cloned Voice';
    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) => ({
        ...s,
        voiceProvider: 'elevenlabs',
        elevenLabsVoiceId: voiceId,
        speaker: `ElevenLabs (${targetName})`,
      })),
    }));
    setStatusText(`✓ ElevenLabs Voice Clone (${targetName}) ကို TTX Segments အားလုံးသို့ သတ်မှတ်ပြီးပါပြီ!`);
  };

  useEffect(() => {
    if (voiceEngine === 'elevenlabs') {
      fetchElevenLabsVoices().then((v) => {
        setElevenLabsVoices(v);
        if (v.length > 0) {
          const vId = selectedElevenLabsVoiceId || v[0].voice_id;
          if (!selectedElevenLabsVoiceId) {
            setSelectedElevenLabsVoiceId(vId);
          }
          const chosenName = v.find((x) => x.voice_id === vId)?.name;
          setProject((prev) => ({
            ...prev,
            segments: prev.segments.map((s) => ({
              ...s,
              voiceProvider: 'elevenlabs',
              elevenLabsVoiceId: s.elevenLabsVoiceId || vId,
              speaker: s.speaker?.includes('ElevenLabs') ? s.speaker : `ElevenLabs (${chosenName || 'Cloned Voice'})`,
            })),
          }));
        }
      }).catch(() => {});
    }
  }, [voiceEngine]);
  
  // Single vs Double Voice Mode State
  const [voiceMode, setVoiceMode] = useState<'single' | 'double'>('single');
  const [singleVoice, setSingleVoice] = useState<VoiceOption>('Thiha');
  const [speakerA, setSpeakerA] = useState<VoiceOption>('Thiha');
  const [speakerB, setSpeakerB] = useState<VoiceOption>('Nilar');

  const [selectedHfSpeaker, setSelectedHfSpeaker] = useState<string>('hf_male_thiha');
  const [hfSpeakerA, setHfSpeakerA] = useState<string>('hf_male_thiha');
  const [hfSpeakerB, setHfSpeakerB] = useState<string>('hf_female_nilar');

  const [targetSlot, setTargetSlot] = useState<'single' | 'speakerA' | 'speakerB'>('single');

  const [voiceStyle, setVoiceStyle] = useState<VoiceStyle>(project.voiceStyle || 'recap');

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
  const [isSyncFitting, setIsSyncFitting] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  const [testingVoice, setTestingVoice] = useState<string | null>(null);
  const [testAudioUrls, setTestAudioUrls] = useState<Record<string, string>>({});
  const [selectedMinutePart, setSelectedMinutePart] = useState<number | 'all'>('all');

  const minuteBlocks = getMinuteBlocks(project.videoDuration || MINUTE_BLOCK_SECONDS);
  const totalMinuteBlocks = minuteBlocks.length;

  const displayedSegments = project.segments.filter((s) => {
    if (selectedMinutePart === 'all') return true;
    const part = minuteBlocks[selectedMinutePart - 1];
    if (!part) return true;
    const isLast = part.partNumber === totalMinuteBlocks;
    return isLast
      ? s.startTime >= part.startSec && s.startTime <= part.endSec + 0.5
      : s.startTime >= part.startSec && s.startTime < part.endSec;
  });

  // Active Subtitle for Video Player (strictly clamped inside segment & minute boundary)
  const activeSegment: TranscriptSegment | null =
    findActiveSegmentForTime(
      project.segments,
      project.currentTime,
      project.voicePlaybackRate || 1.0,
      false
    )?.segment || null;

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
        speaker: 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
      })),
    }));
    setStatusText(`✓ Single Burmese Narrator (${VOICE_PROFILES[selected].name}) ကို Segments အားလုံးသို့ သတ်မှတ်ပြီးပါပြီ။`);
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

  const handleSegmentEmotionChange = (segId: string, newEmotion: string) => {
    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) =>
        s.id === segId
          ? { ...s, emotion: newEmotion || undefined, audioUrl: undefined, audioDuration: undefined }
          : s
      ),
    }));
    setStatusText('✓ အသံလေယူလေသိမ်း (Emotion) ပြောင်းပြီးပါပြီ — Gen နှိပ်၍ အသံအသစ် ထုတ်နိုင်ပါသည်။');
  };

  const handleUpdateSegmentRate = (segId: string, newRate: number) => {
    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) => (s.id === segId ? { ...s, playbackRate: newRate } : s)),
    }));
    setStatusText(`✓ Segment speed adjusted to ${newRate.toFixed(2)}x.`);
  };

  const [shorteningSegId, setShorteningSegId] = useState<string | null>(null);

  const handleShortenSegmentInVoiceStudio = async (seg: TranscriptSegment) => {
    if (!seg.myanmarTranslation || shorteningSegId) return;
    const slotDur = Math.max(1.0, seg.endTime - seg.startTime);
    setShorteningSegId(seg.id);
    setStatusText(`✂️ Segment #${seg.id} အတွက် မူရင်းအချိန် (${slotDur.toFixed(1)}s) အတွင်း ဖတ်နိုင်ရန် AI ဖြင့် စာတိုချုံ့နေပါသည်...`);
    try {
      const shortened = await shortenBurmeseTextForDuration(
        seg.myanmarTranslation,
        slotDur,
        seg.originalText
      );
      if (shortened && shortened !== seg.myanmarTranslation) {
        setProject((prev) => ({
          ...prev,
          segments: prev.segments.map((s) =>
            s.id === seg.id ? { ...s, myanmarTranslation: shortened, subtitleText: shortened, audioUrl: undefined } : s
          ),
        }));
        setStatusText(`✓ Segment #${seg.id} စာသားကို တိုအောင် ချုံ့ပြီးပါပြီ။ Voice ပြန်ထုတ်နိုင်ပါပြီ။`);
      }
    } catch (err: any) {
      console.warn('Failed to shorten segment:', err);
    } finally {
      setShorteningSegId(null);
    }
  };

  const handleAutoRetimeAll = () => {
    setProject((prev) => {
      const realigned = realignSegmentsByMinuteBlocks(
        prev.segments,
        prev.videoDuration || MINUTE_BLOCK_SECONDS,
        {
          enforceSingleVoice: voiceMode === 'single' ? singleVoice : undefined,
          enforceSingleSpeakerLabel: voiceMode === 'single',
        }
      );
      return {
        ...prev,
        segments: realigned,
      };
    });
    setStatusText(
      `✓ 1-Minute Block Auto-Align ပြီးစီးပါပြီ: ၁ မိနစ်စာ အပိုင်း (${totalMinuteBlocks} Parts) တစ်ခုချင်းစီအတွင်း နောက်ပိုင်းအသံများ အချိန်မရွေ့စေရန် Gentle Speed (0.90x - 1.15x) ဖြင့် ပြန်ညှိပြီးပါပြီ။`
    );
  };

  const handleGenerateSingle = async (seg: TranscriptSegment) => {
    const text = seg.myanmarTranslation || seg.originalText;
    if (!text) return;

    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) => (s.id === seg.id ? { ...s, isGeneratingAudio: true } : s)),
    }));

    const activeSpeed = clampGentleNarratorRate(seg.playbackRate || project.voicePlaybackRate || 1.0);
    const activeStyle = voiceStyle || seg.style || project.voiceStyle || 'recap';

    try {
      let resultUrl = '';
      let resultDuration = 0;

      if (voiceEngine === 'elevenlabs') {
        const vId = seg.elevenLabsVoiceId || selectedElevenLabsVoiceId || elevenLabsVoices[0]?.voice_id;
        if (!vId) {
          throw new Error('ElevenLabs Voice ID မရှိသေးပါ။ ကျေးဇူးပြု၍ Voice တစ်ခု ရွေးချယ်ပါ သို့မဟုတ် Voice Clone ဖန်တီးပါ။');
        }
        const elResult = await synthesizeElevenLabsVoice(text, {
          voiceId: vId,
          emotion: seg.emotion,
          onStatusUpdate: (msg) => setStatusText(msg),
        });
        resultUrl = elResult.audioUrl;
        resultDuration = elResult.duration;
      } else if (voiceEngine === 'huggingface') {
        const activeModel = hfModel === 'custom' ? (customHfModel.trim() || 'facebook/mms-tts-mya') : hfModel;
        const activeSpeaker = seg.hfSpeaker || (voiceMode === 'double' ? (project.segments.findIndex(s => s.id === seg.id) % 2 === 0 ? hfSpeakerA : hfSpeakerB) : selectedHfSpeaker);
        const hfResult = await synthesizeHuggingFaceVoice(text, {
          model: activeModel,
          speakerId: activeSpeaker,
          speed: 1.0,
          onStatusUpdate: (msg) => setStatusText(msg),
        });
        resultUrl = hfResult.audioUrl;
        resultDuration = hfResult.duration;
      } else {
        const activeVoice = voiceMode === 'single'
          ? singleVoice
          : (seg.voice || (project.segments.findIndex(s => s.id === seg.id) % 2 === 0 ? speakerA : speakerB));
        const result = await synthesizeMyanmarVoice(text, {
          voice: activeVoice,
          style: activeStyle,
          emotion: seg.emotion,
          speed: 1.0,
          trimSilence,
          onStatusUpdate: (msg) => setStatusText(msg),
        });
        resultUrl = result.audioUrl;
        resultDuration = result.duration;
      }

      let resolvedRate = activeSpeed;
      setProject((prev) => {
        const vId = seg.elevenLabsVoiceId || selectedElevenLabsVoiceId || elevenLabsVoices[0]?.voice_id;
        const elevenLabsName = elevenLabsVoices.find((v) => v.voice_id === vId)?.name || 'Cloned Voice';
        const updatedSegs = prev.segments.map((s) =>
          s.id === seg.id
            ? {
                ...s,
                audioUrl: resultUrl,
                audioDuration: resultDuration,
                isGeneratingAudio: false,
                voiceProvider: voiceEngine,
                elevenLabsVoiceId: voiceEngine === 'elevenlabs' ? vId : s.elevenLabsVoiceId,
                voice: voiceMode === 'single' ? singleVoice : s.voice,
                speaker:
                  voiceEngine === 'elevenlabs'
                    ? `ElevenLabs (${elevenLabsName})`
                    : voiceMode === 'single'
                    ? 'Narrator (ဇာတ်ကြောင်းပြောသူ)'
                    : s.speaker,
              }
            : s
        );
        const aligned = realignSegmentsByMinuteBlocks(
          updatedSegs,
          prev.videoDuration || MINUTE_BLOCK_SECONDS,
          {
            enforceSingleVoice: voiceEngine === 'gemini' && voiceMode === 'single' ? singleVoice : undefined,
            enforceSingleSpeakerLabel: voiceEngine === 'gemini' && voiceMode === 'single',
          }
        );
        const found = aligned.find((a) => a.id === seg.id);
        if (found?.playbackRate) resolvedRate = found.playbackRate;
        return {
          ...prev,
          segments: aligned,
        };
      });

      playVoiceClip(seg.id, resultUrl, resolvedRate);
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

  const handleGenerateAll = async (onlyPartNumber?: number, onlyMissing: boolean = false) => {
    let targetSegs = onlyPartNumber
      ? project.segments.filter((s) => {
          const part = minuteBlocks[onlyPartNumber - 1];
          if (!part) return false;
          const isLast = part.partNumber === totalMinuteBlocks;
          return isLast
            ? s.startTime >= part.startSec && s.startTime <= part.endSec + 0.5
            : s.startTime >= part.startSec && s.startTime < part.endSec;
        })
      : project.segments;

    if (onlyMissing) {
      targetSegs = targetSegs.filter((s) => !s.audioUrl);
    }

    if (targetSegs.length === 0) {
      if (onlyMissing) {
        setStatusText('✓ Segments အားလုံး Voice Clone အသံ ထုတ်ပြီးသား ဖြစ်ပါသည်။');
      } else {
        setErrorMessage('အသံသွင်းရန် Segment များ မရှိသေးပါ။ အဆင့် ၃ တွင် အရင် Generate လုပ်ပေးပါ။');
      }
      return;
    }

    setIsBatchGenerating(true);
    setErrorMessage(null);
    setBatchProgress({ current: 0, total: targetSegs.length });

    const total = targetSegs.length;
    const generatedMap = new Map<string, { audioUrl: string; audioDuration: number; voice?: VoiceOption }>();
    const failedSegs: Array<{ idx: number; id: string; text: string; reason: string }> = [];

    for (let i = 0; i < total; i++) {
      const seg = targetSegs[i];
      const text = (seg.myanmarTranslation || seg.originalText || '').trim();
      if (!text) continue;

      const partNum = Math.floor(Math.max(0, seg.startTime) / MINUTE_BLOCK_SECONDS) + 1;
      setBatchProgress({ current: i + 1, total });
      setStatusText(`🔊 [Part ${partNum}] Narrator အသံသွင်းနေသည် (${i + 1}/${total}): "${text.substring(0, 22)}..."`);

      const activeStyle = voiceStyle || seg.style || project.voiceStyle || 'recap';
      let succeeded = false;
      let lastErrMsg = 'Synthesis failed';

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          let resultUrl = '';
          let resultDuration = 0;
          let usedVoice: VoiceOption | undefined = undefined;

          if (voiceEngine === 'elevenlabs') {
            const vId = seg.elevenLabsVoiceId || selectedElevenLabsVoiceId || elevenLabsVoices[0]?.voice_id;
            if (!vId) throw new Error('ElevenLabs Voice ID missing');
            const elResult = await synthesizeElevenLabsVoice(text, {
              voiceId: vId,
              emotion: seg.emotion,
            });
            resultUrl = elResult.audioUrl;
            resultDuration = elResult.duration;
          } else if (voiceEngine === 'huggingface') {
            const activeModel = hfModel === 'custom' ? (customHfModel.trim() || 'facebook/mms-tts-mya') : hfModel;
            const activeSpeaker = seg.hfSpeaker || (voiceMode === 'double' ? (i % 2 === 0 ? hfSpeakerA : hfSpeakerB) : selectedHfSpeaker);
            const hfResult = await synthesizeHuggingFaceVoice(text, {
              model: activeModel,
              speakerId: activeSpeaker,
              speed: 1.0,
            });
            resultUrl = hfResult.audioUrl;
            resultDuration = hfResult.duration;
          } else {
            const activeVoice = voiceMode === 'single'
              ? singleVoice
              : (seg.voice || (i % 2 === 0 ? speakerA : speakerB));
            usedVoice = activeVoice;
            const result = await synthesizeMyanmarVoice(text, {
              voice: activeVoice,
              style: activeStyle,
              emotion: seg.emotion,
              speed: 1.0,
              trimSilence,
            });
            resultUrl = result.audioUrl;
            resultDuration = result.duration;
          }

          if (!resultUrl) {
            throw new Error('Empty audio URL returned');
          }

          generatedMap.set(seg.id, {
            audioUrl: resultUrl,
            audioDuration: resultDuration,
            voice: usedVoice,
          });

          const targetVId = voiceEngine === 'elevenlabs' ? (seg.elevenLabsVoiceId || selectedElevenLabsVoiceId || elevenLabsVoices[0]?.voice_id) : undefined;
          setProject((prev) => ({
            ...prev,
            segments: prev.segments.map((s) =>
              s.id === seg.id
                ? {
                    ...s,
                    audioUrl: resultUrl,
                    audioDuration: resultDuration,
                    voiceProvider: voiceEngine,
                    elevenLabsVoiceId: targetVId || s.elevenLabsVoiceId,
                    voice: usedVoice || s.voice,
                    speaker: voiceEngine === 'elevenlabs' ? 'ElevenLabs Cloned Narrator' : s.speaker,
                    isGeneratingAudio: false,
                  }
                : s
            ),
          }));
          succeeded = true;
          break;
        } catch (err: any) {
          lastErrMsg = err?.message || 'TTS error';
          console.warn(`Batch item ${i + 1} (attempt ${attempt}/2) warning:`, lastErrMsg);
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 250));
          }
        }
      }

      if (!succeeded) {
        failedSegs.push({
          idx: i + 1,
          id: seg.id,
          text: text.substring(0, 28),
          reason: lastErrMsg,
        });
      }

      if (i < total - 1) {
        await new Promise((r) => setTimeout(r, 120));
      }
    }

    // Re-align all segments cleanly inside each 1-minute video block with gentle speed (0.90x-1.18x) so later parts never drift
    setProject((prev) => {
      const merged = prev.segments.map((s) => {
        const gen = generatedMap.get(s.id);
        return gen
          ? {
              ...s,
              audioUrl: gen.audioUrl,
              audioDuration: gen.audioDuration,
              voiceProvider: voiceEngine,
              voice: gen.voice || s.voice,
            }
          : s;
      });
      const aligned = realignSegmentsByMinuteBlocks(
        merged,
        prev.videoDuration || MINUTE_BLOCK_SECONDS,
        {
          enforceSingleVoice: voiceEngine === 'gemini' && voiceMode === 'single' ? singleVoice : undefined,
          enforceSingleSpeakerLabel: voiceEngine === 'gemini' && voiceMode === 'single',
        }
      );
      return {
        ...prev,
        segments: aligned,
      };
    });

    setIsBatchGenerating(false);
    setBatchProgress(null);

    if (failedSegs.length > 0) {
      setErrorMessage(
        `⚠️ စာကြောင်း ${failedSegs.length} ခု Voice Clone ထုတ်မရသေးပါ (ဥပမာ "${failedSegs[0].text}...": ${failedSegs[0].reason})။ "Retry Missing Voices" ခလုတ်ကို နှိပ်၍ ပြန်ထုတ်နိုင်ပါသည်။`
      );
      setStatusText(
        `✓ ${generatedMap.size}/${total} Segments အသံသွင်းပြီးပါပြီ (${failedSegs.length} ခု မအောင်မြင်ပါ)`
      );
    } else {
      setStatusText(
        onlyMissing
          ? `✓ ကျန်ရှိနေသော Voice Clone ${generatedMap.size} ခုလုံးကို အောင်မြင်စွာ ပြန်လည်ထုတ်ယူပြီးပါပြီ!`
          : onlyPartNumber
            ? `✓ Part ${onlyPartNumber} (${generatedMap.size} Segments) အသံသွင်းပြီး ၁ မိနစ်အချိန်ကွက်အတွင်း ပြန်ညှိပြီးပါပြီ!`
            : `✓ Single Narrator အသံ ${generatedMap.size} ခုလုံး ထုတ်ယူပြီး ၁ မိနစ်အပိုင်း (${totalMinuteBlocks} Blocks) အလိုက် အချိန်ကွက် ပြန်ညှိပြီးပါပြီ!`
      );
      setTimeout(() => setStatusText(null), 6000);
    }
  };

  const handleAutoSyncFitAll = async () => {
    const overflowingSegs = project.segments.filter((s) => {
      const slot = Math.max(0.5, (s.originalEndTime ?? s.endTime) - (s.originalStartTime ?? s.startTime));
      return Boolean(s.narratorTimingWarning) || Boolean(s.audioDuration && s.audioDuration / 1.18 > slot + 0.35);
    });

    if (overflowingSegs.length === 0) {
      handleAutoRetimeAll();
      return;
    }

    setIsSyncFitting(true);
    setErrorMessage(null);
    const updatedMap = new Map<string, { text: string; audioUrl: string; audioDuration: number }>();

    try {
      for (let i = 0; i < overflowingSegs.length; i++) {
        const seg = overflowingSegs[i];
        const slotDur = Math.max(1.0, (seg.originalEndTime ?? seg.endTime) - (seg.originalStartTime ?? seg.startTime));
        setStatusText(`⚡ Sync-Fit (${i + 1}/${overflowingSegs.length}): ဗီဒီယိုအချိန် (${slotDur.toFixed(1)}s) နှင့် ကွက်တိဝင်ရန် စာတိုချုံ့ + အသံပြန်သွင်းနေသည်...`);

        const condensed = await shortenBurmeseTextForDuration(
          seg.myanmarTranslation || seg.originalText,
          slotDur,
          seg.originalText
        );
        const textToSpeak = condensed || seg.myanmarTranslation || seg.originalText;
        const activeVoice = voiceMode === 'single' ? singleVoice : (seg.voice || speakerA);
        const activeStyle = voiceStyle || seg.style || project.voiceStyle || 'recap';

        const result = await synthesizeMyanmarVoice(textToSpeak, {
          voice: activeVoice,
          style: activeStyle,
          emotion: seg.emotion,
          speed: 1.0,
          trimSilence,
        });

        updatedMap.set(seg.id, {
          text: textToSpeak,
          audioUrl: result.audioUrl,
          audioDuration: result.duration,
        });
      }

      setProject((prev) => {
        const merged = prev.segments.map((s) => {
          const hit = updatedMap.get(s.id);
          return hit
            ? {
                ...s,
                myanmarTranslation: hit.text,
                subtitleText: hit.text,
                audioUrl: hit.audioUrl,
                audioDuration: hit.audioDuration,
              }
            : s;
        });
        const aligned = realignSegmentsByMinuteBlocks(
          merged,
          prev.videoDuration || MINUTE_BLOCK_SECONDS,
          {
            enforceSingleVoice: voiceMode === 'single' ? singleVoice : undefined,
            enforceSingleSpeakerLabel: voiceMode === 'single',
          }
        );
        return { ...prev, segments: aligned };
      });

      setStatusText(`✓ Sync-Fit ပြီးစီးပါပြီ: အချိန်ကျော်နေသော စာကြောင်း ${updatedMap.size} ခုကို Video Scene နှင့် ကွက်တိကိုက်အောင် ပြန်ညှိပြီးပါပြီ!`);
      setTimeout(() => setStatusText(null), 6000);
    } catch (err: any) {
      setErrorMessage(`Auto Sync-Fit error: ${err?.message || 'Failed to sync-fit lines'}`);
    } finally {
      setIsSyncFitting(false);
    }
  };

  const generatedCount = project.segments.filter((s) => !!s.audioUrl).length;
  const missingCount = project.segments.filter((s) => !s.audioUrl && !!(s.myanmarTranslation || s.originalText)).length;
  const overflowCount = project.segments.filter((s) => !!s.narratorTimingWarning).length;
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
      {/* Step Header */}
      <div className="ios-card p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-400 to-teal-400 text-zinc-950 font-black flex items-center justify-center text-xs shadow-lg">
              4
            </span>
            <h2 className="text-base font-bold text-white font-display tracking-tight flex items-center gap-2">
              <Mic className="w-4 h-4 text-emerald-400" />
              <span>အဆင့် ၄ — Voice Clone Studio (Step 3 TTX စာသားများအား အသံသွင်းခြင်း)</span>
            </h2>
          </div>
          <p className="text-xs text-zinc-400 font-myanmar mt-1">
            အဆင့် ၃ မှ Video Analyzing ဖြင့် ထွက်ရှိလာသော Narrator TTX စာသား ({project.segments.length} Segments) များအား သဘာဝကျသော မြန်မာ Narrator အသံဖြင့် Voice Clone ပြုလုပ်ပါမည်။
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {onPrevStep && (
            <button
              onClick={onPrevStep}
              className="px-3.5 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-semibold rounded-xl transition-all border border-white/10 flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>အဆင့် ၃ (TTX စာသား) သို့</span>
            </button>
          )}
          {onNextStep && (
            <button
              onClick={onNextStep}
              className="px-5 py-2.5 bg-gradient-to-r from-emerald-400 to-teal-400 hover:opacity-90 text-zinc-950 font-black text-xs rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20 cursor-pointer active:scale-95"
            >
              <span>အဆင့် ၅ (Human Review) သို့</span>
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          )}
        </div>
      </div>

      {/* 7-STAGE DUBBING WORKFLOW TOP TAB SELECTOR */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-2xl bg-black/60 border border-white/10 backdrop-blur-xl shadow-xl">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStudioTab('generation')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              studioTab === 'generation'
                ? 'bg-gradient-to-r from-emerald-400 to-teal-400 text-zinc-950 font-black shadow-lg shadow-emerald-500/20'
                : 'text-zinc-400 hover:text-white bg-white/5'
            }`}
          >
            <Mic className="w-4 h-4" />
            <span>အသံသွင်းခြင်း (Voice Generation)</span>
          </button>

          <button
            type="button"
            onClick={() => setStudioTab('review')}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              studioTab === 'review'
                ? 'bg-gradient-to-r from-cyan-400 to-teal-400 text-zinc-950 font-black shadow-lg shadow-cyan-500/20'
                : 'text-zinc-400 hover:text-white bg-white/5'
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
            <span>၇ ဆင့် လူကိုယ်တိုင် စစ်ဆေးခန်း (7-Stage Review Studio)</span>
            <span className="px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono text-[10px] font-bold">
              {project.segments.filter((s) => s.isHumanReviewed).length}/{project.segments.length}
            </span>
          </button>
        </div>

        <div className="text-[11px] text-zinc-400 font-myanmar pr-2 hidden sm:block">
          ✨ Single Adult Male Voice (သီဟ / Adult Male) + atempo Retiming
        </div>
      </div>

      {studioTab === 'review' ? (
        /* 7-STAGE HUMAN-IN-THE-LOOP REVIEW WORKBENCH WITH VIDEO SYNC */
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-6 space-y-3 sticky top-20">
              <div className="flex items-center justify-between px-4 py-2.5 rounded-2xl bg-black/40 border border-white/10 text-xs backdrop-blur-xl">
                <span className="font-bold text-white flex items-center gap-2 font-display">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
                  <span>Video & Voiceover Lip-Sync Sync Preview</span>
                </span>
                <span className="text-[10px] text-zinc-400 font-myanmar">
                  မူရင်းအသံ 100% Mute ဖြင့် စစ်ဆေးခြင်း
                </span>
              </div>
              <VideoPlayerView
                project={project}
                setProject={setProject}
                activeSegment={activeSegment}
              />
            </div>
            <div className="lg:col-span-6">
              <HumanReviewDubbingStudio
                project={project}
                setProject={setProject}
                onSeekTo={(t) => setProject((prev) => ({ ...prev, currentTime: t }))}
              />
            </div>
          </div>
        </div>
      ) : (
        /* Regular generation grid */
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

            <button
              type="button"
              onClick={() => setVoiceEngine('elevenlabs')}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                voiceEngine === 'elevenlabs'
                  ? 'bg-violet-500/20 text-violet-300 border border-violet-500/40 font-black shadow'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <span>🎙️ ElevenLabs Clone</span>
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
              ) : voiceEngine === 'huggingface' ? (
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
              ) : (
                <div
                  onClick={() => {
                    setTargetSlot('single');
                    setIsElevenLabsFlowOpen(true);
                  }}
                  className="p-4 rounded-2xl border border-violet-400/80 bg-gradient-to-r from-violet-500/20 via-purple-500/10 to-transparent hover:border-violet-300 transition-all cursor-pointer group shadow-xl flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-violet-500 to-purple-500 text-white font-black flex items-center justify-center text-sm shadow-md">
                      🎙️
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-white font-display flex items-center gap-2">
                        <span>{elevenLabsVoices.find((v) => v.voice_id === selectedElevenLabsVoiceId)?.name || 'ElevenLabs Burmese Clone'}</span>
                        <span className="px-2 py-0.5 rounded-full bg-violet-500/30 text-violet-300 text-[10px] font-mono">
                          {selectedElevenLabsVoiceId ? 'Active' : 'Select Voice'}
                        </span>
                      </h3>
                      <p className="text-xs text-violet-300/90 font-medium mt-0.5 font-myanmar">
                        ID: <span className="font-mono text-[11px] text-zinc-300">{selectedElevenLabsVoiceId || 'None'}</span> — အသံပြောင်းရန် / အသံနမူနာသွင်းရန် နှိပ်ပါ
                      </p>
                    </div>
                  </div>

                  <span className="text-xs font-bold text-violet-400 group-hover:translate-x-1 transition-transform flex items-center gap-1 shrink-0">
                    <span>Voice Studio</span>
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

          {/* Speed & Gentle 1-Minute Block Alignment Controls */}
          <div className="p-4 rounded-2xl bg-black/40 border border-white/10 space-y-3 backdrop-blur-xl">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-white flex items-center gap-2 font-display">
                <Zap className="w-4 h-4 text-emerald-400" />
                <span>Gentle Narrator Speed (0.90x – 1.15x)</span>
              </span>
              <span className="text-xs font-mono font-bold text-emerald-300 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                {(project.voicePlaybackRate || 1.0).toFixed(2)}x
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono text-zinc-400 font-bold">0.90x</span>
              <input
                type="range"
                min="0.90"
                max="1.15"
                step="0.01"
                value={clampGentleNarratorRate(project.voicePlaybackRate || 1.0)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setProject((prev) => ({
                    ...prev,
                    voicePlaybackRate: val,
                  }));
                }}
                className="flex-1 accent-emerald-400 h-2 bg-white/10 rounded-lg cursor-pointer"
              />
              <span className="text-[10px] font-mono text-zinc-400 font-bold">1.15x</span>
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
                title="၁ မိနစ်စာ အပိုင်းတစ်ခုချင်းစီအတွင်း နောက်ပိုင်းအသံများ မရွေ့စေရန် အသာအယာ (0.90x-1.15x) ပြန်ညှိမည်"
              >
                <Zap className="w-3 h-3 text-emerald-400" />
                <span>⏱️ 1-Min Block Align (အချိန်ကွက် ညှိမည်)</span>
              </button>

              <span className="text-[10px] text-zinc-400 font-mono">
                Generated: {generatedCount} / {project.segments.length}
              </span>
            </div>
          </div>

          {/* 1-Minute Block Selector & Drift Sync Monitor */}
          <div className="p-3.5 rounded-2xl bg-black/40 border border-cyan-500/25 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-cyan-300 flex items-center gap-1.5 font-myanmar">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                <span>၁ မိနစ်စာ အချိန်ကွက်များ ({totalMinuteBlocks} Blocks)</span>
              </span>
              <span className="text-[10px] font-mono text-zinc-400">
                Sync Lock / Minute
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedMinutePart('all')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  selectedMinutePart === 'all'
                    ? 'bg-cyan-400 text-zinc-950 shadow'
                    : 'bg-white/5 text-zinc-400 hover:text-white border border-white/10'
                }`}
              >
                All ({project.segments.length})
              </button>

              {minuteBlocks.map((part) => {
                const isLast = part.partNumber === totalMinuteBlocks;
                const partSegs = project.segments.filter((s) =>
                  isLast
                    ? s.startTime >= part.startSec && s.startTime <= part.endSec + 0.5
                    : s.startTime >= part.startSec && s.startTime < part.endSec
                );
                const readyInPart = partSegs.filter((s) => !!s.audioUrl).length;
                const hasWarn = partSegs.some((s) => !!s.narratorTimingWarning);

                return (
                  <button
                    key={part.partNumber}
                    type="button"
                    onClick={() => {
                      setSelectedMinutePart(part.partNumber);
                      setProject((prev) => ({ ...prev, currentTime: part.startSec }));
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                      selectedMinutePart === part.partNumber
                        ? 'bg-cyan-400 text-zinc-950 font-bold shadow'
                        : 'bg-white/5 text-zinc-300 hover:bg-white/10 border border-white/10'
                    }`}
                  >
                    <span>P{part.partNumber} ({formatMinSec(part.startSec)}–{formatMinSec(part.endSec)})</span>
                    <span className={`px-1 rounded text-[9px] font-mono ${hasWarn ? 'bg-amber-500/30 text-amber-200' : 'bg-black/40 text-emerald-300'}`}>
                      {readyInPart}/{partSegs.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Action Buttons: Generate All, Retry Missing Voices, Auto Sync-Fit */}
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => handleGenerateAll()}
                disabled={isBatchGenerating || isSyncFitting || project.segments.length === 0}
                className={`flex-1 py-3.5 px-5 disabled:opacity-50 text-zinc-950 text-xs sm:text-sm font-black rounded-2xl transition-all flex items-center justify-center gap-2 shadow-2xl cursor-pointer ${
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
                    <span>Generate All Voices ({project.segments.length})</span>
                  </>
                )}
              </button>

              {selectedMinutePart !== 'all' && (
                <button
                  type="button"
                  onClick={() => handleGenerateAll(selectedMinutePart)}
                  disabled={isBatchGenerating || isSyncFitting || displayedSegments.length === 0}
                  className="py-3.5 px-4 disabled:opacity-50 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-400/50 text-xs font-bold rounded-2xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Zap className="w-3.5 h-3.5 text-cyan-300" />
                  <span>Part {selectedMinutePart} Only ({displayedSegments.length})</span>
                </button>
              )}
            </div>

            {(missingCount > 0 || overflowCount > 0) && (
              <div className="flex flex-wrap gap-2">
                {missingCount > 0 && (
                  <button
                    type="button"
                    onClick={() => handleGenerateAll(selectedMinutePart === 'all' ? undefined : selectedMinutePart, true)}
                    disabled={isBatchGenerating || isSyncFitting}
                    className="flex-1 py-2.5 px-3.5 disabled:opacity-50 bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-400/50 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RotateCw className={`w-3.5 h-3.5 text-rose-300 ${isBatchGenerating ? 'animate-spin' : ''}`} />
                    <span>Retry Missing Voices ({missingCount} ခုကျန်)</span>
                  </button>
                )}

                {overflowCount > 0 && (
                  <button
                    type="button"
                    onClick={handleAutoSyncFitAll}
                    disabled={isBatchGenerating || isSyncFitting}
                    className="flex-1 py-2.5 px-3.5 disabled:opacity-50 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-400/50 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    title="ဗီဒီယိုအချိန်ထက် ကျော်နေသော စာကြောင်းများကို AI ဖြင့် တိုချုံ့ပြီး Voice ပြန်ထုတ်၍ ဗီဒီယိုနှင့် ကွက်တိကိုက်ညှိပေးပါမည်"
                  >
                    <Zap className={`w-3.5 h-3.5 text-amber-300 ${isSyncFitting ? 'animate-spin' : ''}`} />
                    <span>
                      {isSyncFitting
                        ? 'Sync-Fitting...'
                        : `⚡ Auto Sync-Fit (${overflowCount} ခု ညှိရန်)`}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Subtitle & Segment Voice List */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <h3 className="text-xs font-bold text-white font-display">
                  Segment Timing & Single Narrator Clips ({displayedSegments.length})
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
                    speaker: 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
                    minutePartIndex: Math.floor(newStart / MINUTE_BLOCK_SECONDS) + 1,
                  };
                  setProject((prev) => ({ ...prev, segments: [...prev.segments, newSeg] }));
                }}
                className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-emerald-300 border border-white/10 rounded-xl text-[10px] font-bold transition-all cursor-pointer"
              >
                + Add Segment
              </button>
            </div>

            <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1.5">
              {displayedSegments.map((seg, idx) => {
                const isSegPlaying = playingAudioId === seg.id;
                const segActiveVoice = seg.voice || (voiceMode === 'double' ? (idx % 2 === 0 ? speakerA : speakerB) : singleVoice);
                const segActiveHfSpeaker = seg.hfSpeaker || (voiceMode === 'double' ? (idx % 2 === 0 ? hfSpeakerA : hfSpeakerB) : selectedHfSpeaker);
                const isMissingVoice = !seg.audioUrl;

                return (
                  <div
                    key={seg.id}
                    className={`p-3 rounded-2xl bg-black/40 border space-y-2.5 transition-all shadow-md ${
                      isMissingVoice
                        ? 'border-rose-500/40 hover:border-rose-400/70'
                        : 'border-white/10 hover:border-emerald-500/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className={`w-5 h-5 rounded-full border flex items-center justify-center font-mono text-[10px] font-bold ${
                          isMissingVoice
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                            : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        }`}>
                          {idx + 1}
                        </span>
                        <span className="text-[11px] font-mono text-zinc-300">
                          {seg.startTime}s - {seg.endTime}s
                        </span>
                        {isMissingVoice && (
                          <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[9px] font-bold">
                            No Voice
                          </span>
                        )}
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
                        ) : voiceEngine === 'elevenlabs' ? (
                          <select
                            value={seg.elevenLabsVoiceId || selectedElevenLabsVoiceId || elevenLabsVoices[0]?.voice_id || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              const voiceObj = elevenLabsVoices.find((v) => v.voice_id === val);
                              setProject((prev) => ({
                                ...prev,
                                segments: prev.segments.map((s) =>
                                  s.id === seg.id
                                    ? {
                                        ...s,
                                        voiceProvider: 'elevenlabs',
                                        elevenLabsVoiceId: val,
                                        speaker: `ElevenLabs (${voiceObj?.name || 'Cloned Voice'})`,
                                      }
                                    : s
                                ),
                              }));
                            }}
                            className="px-2.5 py-1 bg-zinc-900 border border-violet-500/40 rounded-xl text-xs font-bold text-violet-300 focus:outline-none focus:border-violet-400 cursor-pointer max-w-[140px] truncate"
                          >
                            {elevenLabsVoices.map((v) => (
                              <option key={v.voice_id} value={v.voice_id} className="bg-zinc-900 text-white font-sans">
                                {v.name}
                              </option>
                            ))}
                            {elevenLabsVoices.length === 0 && (
                              <option value="" className="bg-zinc-900 text-zinc-400">
                                No Voice Found
                              </option>
                            )}
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

                        {seg.audioUrl && (
                          <button
                            type="button"
                            onClick={() => handleGenerateSingle(seg)}
                            disabled={seg.isGeneratingAudio}
                            title="စာသား / Emotion အသစ်ဖြင့် Voice Clone ပြန်ထုတ်မည်"
                            className="p-1 bg-white/5 hover:bg-amber-400/20 text-zinc-300 hover:text-amber-300 border border-white/10 rounded-lg transition-all cursor-pointer"
                          >
                            <RotateCw className={`w-3 h-3 ${seg.isGeneratingAudio ? 'animate-spin text-amber-400' : ''}`} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
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
                        className="flex-1 px-3 py-1.5 bg-zinc-950/70 border border-white/10 rounded-xl text-xs font-myanmar text-white focus:outline-none focus:border-emerald-400"
                      />

                      <select
                        value={seg.emotion || ''}
                        onChange={(e) => handleSegmentEmotionChange(seg.id, e.target.value)}
                        title="အသံနိမ့်မြင့် / ခံစားချက် (Vocal Emotion)"
                        className="px-2 py-1.5 bg-zinc-900 border border-cyan-500/30 rounded-xl text-[11px] font-myanmar font-semibold text-cyan-200 focus:outline-none focus:border-cyan-400 cursor-pointer sm:w-48"
                      >
                        <option value="" className="bg-zinc-900 text-white">🎭 Auto (သဘာဝ စကားပြော)</option>
                        <option value="happy, cheerful, warm" className="bg-zinc-900 text-white">😊 ပျော်ရွှင်နွေးထွေး (Happiness)</option>
                        <option value="sad, gentle, sincere" className="bg-zinc-900 text-white">😢 ဝမ်းနည်းကြင်နာ (Sadness)</option>
                        <option value="excited, energetic, enthusiastic" className="bg-zinc-900 text-white">⚡ တက်ကြွစိတ်လှုပ်ရှား (Excitement)</option>
                        <option value="curious, questioning" className="bg-zinc-900 text-white">❓ စူးစမ်းမေးမြန်း (Curiosity)</option>
                        <option value="empathetic, caring, comforting" className="bg-zinc-900 text-white">💛 စာနာနှစ်သိမ့် (Empathy)</option>
                        <option value="surprised, amazed" className="bg-zinc-900 text-white">😮 အံ့ဩတုန်လှုပ် (Surprise)</option>
                        <option value="mocking, smug" className="bg-zinc-900 text-white">😏 လှောင်ပြောင် (Mocking)</option>
                        <option value="determined, fierce" className="bg-zinc-900 text-white">🔥 မာန်ပါ / ခိုင်မာ (Fierce)</option>
                      </select>
                    </div>

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

                      <div className="flex items-center gap-1.5">
                        {seg.audioDuration && seg.audioDuration > (seg.endTime - seg.startTime) && (
                          <button
                            type="button"
                            onClick={() => handleShortenSegmentInVoiceStudio(seg)}
                            disabled={shorteningSegId === seg.id}
                            className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-lg hover:bg-amber-500/30 transition-all font-bold cursor-pointer flex items-center gap-1"
                            title="စာသားကို အဓိပ္ပါယ်မပျက်ဘဲ မူရင်းစကားပြောချိန်အတွင်း ဝင်အောင် AI ဖြင့် စာတိုချုံ့မည်"
                          >
                            <Scissors className="w-2.5 h-2.5 text-amber-400" />
                            <span>{shorteningSegId === seg.id ? 'ချုံ့နေသည်...' : '✂️ AI စာတိုချုံ့မည်'}</span>
                          </button>
                        )}

                        {seg.audioDuration && (
                          <button
                            type="button"
                            onClick={() => {
                              const slotDur = Math.max(0.5, seg.endTime - seg.startTime);
                              const autoRate = seg.audioDuration! > slotDur
                                ? clampGentleNarratorRate(seg.audioDuration! / slotDur)
                                : 1.0;
                              handleUpdateSegmentRate(seg.id, autoRate);
                            }}
                            className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-lg hover:bg-emerald-500/30 transition-all font-bold cursor-pointer flex items-center gap-1"
                            title="Gentle Auto-Fit (0.90x - 1.15x max)"
                          >
                            <Zap className="w-2.5 h-2.5 text-emerald-400" />
                            <span>⚡ Gentle Fit</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {seg.narratorTimingWarning && (
                      <div className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-[10px] text-amber-300 font-myanmar">
                        ⚠️ {seg.narratorTimingWarning}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    )}

      {/* BOTTOM NAVIGATION CARD */}
      <div className="ios-card p-5 flex items-center justify-between gap-4">
        {onPrevStep ? (
          <button
            onClick={onPrevStep}
            className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl transition-all border border-white/15 flex items-center gap-2 cursor-pointer active:scale-95 shadow-md"
          >
            <ArrowLeft className="w-4 h-4 stroke-[2.5]" />
            <span>အဆင့် ၃ သို့ (AI Script)</span>
          </button>
        ) : (
          <div />
        )}

        <span className="text-xs text-zinc-400 font-myanmar hidden sm:inline">
          TTS အသံထုတ်ယူပြီးပါက အဆင့် ၅ (Human Review & Retiming) သို့ သွားပါ
        </span>

        {onNextStep && (
          <button
            onClick={onNextStep}
            className="px-6 py-3 bg-gradient-to-r from-emerald-400 to-teal-400 hover:opacity-90 text-zinc-950 font-black text-xs rounded-xl transition-all flex items-center gap-2.5 shadow-xl shadow-emerald-500/25 cursor-pointer active:scale-95 shrink-0"
          >
            <span>အဆင့် ၅ သို့ (Human Review)</span>
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

      {/* ========================================================================= */}
      {/* FLOW PANEL 3: ELEVENLABS VOICE CLONE STUDIO (MODAL OVERLAY) */}
      {/* ========================================================================= */}
      {isElevenLabsFlowOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fade-in">
          <div className="w-full max-w-2xl bg-zinc-950 border border-violet-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden relative">
            <div className="absolute top-0 right-0 w-64 h-64 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-white/10 relative z-10">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-violet-500/20 text-violet-300 border border-violet-500/30 font-black">
                  II
                </div>
                <div>
                  <h3 className="text-base font-black text-white font-display">
                    ElevenLabs Voice Clone Studio
                  </h3>
                  <p className="text-xs text-zinc-400 font-myanmar">
                    ElevenLabs API ဖြင့် အသံဖိုင်တင်ပြီး Instant Voice Clone ဖန်တီးခြင်း သို့မဟုတ် Premade Voices ရွေးချယ်ခြင်း
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsElevenLabsFlowOpen(false)}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto space-y-6 py-4 pr-1 relative z-10">
              {/* 1-Click Clone directly from User's Attached Sample Video */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-violet-950/70 via-purple-950/40 to-zinc-950 border border-violet-500/50 space-y-3 shadow-xl">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-xl bg-gradient-to-tr from-violet-500 to-fuchsia-500 text-white flex items-center justify-center font-bold text-sm shadow">
                    🎬
                  </span>
                  <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-wider font-display">
                      နမူနာ Video မှ Voice Clone တိုက်ရိုက်ရယူမည် (1-Click Instant Clone)
                    </h4>
                    <p className="text-[11px] text-zinc-400 font-myanmar mt-0.5">
                      ပေးပို့ထားသော နမူနာဗီဒီယို (Sample Video) မှ စကားပြောသံကို ElevenLabs သို့ တိုက်ရိုက် Voice Clone ပြုလုပ်ပါမည်။
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isCloningSampleVideo}
                  onClick={async () => {
                    setIsCloningSampleVideo(true);
                    setStatusText('🎙️ နမူနာဗီဒီယိုမှ အသံလှိုင်းကို ElevenLabs သို့ ပေးပို့ပြီး Instant Voice Clone ပြုလုပ်နေပါသည်...');
                    try {
                      const res = await cloneElevenLabsFromSampleVideo('Sample Video Burmese Narrator');
                      handleApplyElevenLabsAllocation(res.voice_id, res.name);
                      setStatusText(`✓ နမူနာ Video မှ ElevenLabs Voice Clone အောင်မြင်စွာ ဖန်တီးပြီး TTX စာကြောင်းများသို့ သတ်မှတ်ပြီးပါပြီ! (${res.name})`);
                      const updatedVoices = await fetchElevenLabsVoices();
                      setElevenLabsVoices(updatedVoices);
                    } catch (err: any) {
                      setErrorMessage(`Sample Video Voice Clone မအောင်မြင်ပါ: ${err.message}`);
                    } finally {
                      setIsCloningSampleVideo(false);
                    }
                  }}
                  className="w-full py-2.5 px-4 bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-400 hover:to-fuchsia-400 text-white font-black text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isCloningSampleVideo ? (
                    <>
                      <RotateCw className="w-4 h-4 animate-spin text-white" />
                      <span>နမူနာ Video မှ Clone နေပါသည်...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-amber-300" />
                      <span>🎬 နမူနာ Video မှ Voice Clone ရယူမည် (1-Click Clone)</span>
                    </>
                  )}
                </button>
              </div>

              {/* Instant Voice Clone Upload Box */}
              <div className="p-4 rounded-2xl bg-violet-950/40 border border-violet-500/40 space-y-3">
                <h4 className="text-xs font-black text-violet-300 uppercase tracking-wider font-display">
                  ➕ Instant Voice Clone (အသံနမူနာ ဖိုင်တင်ပြီး အသံအသစ်ဖန်တီးရန်)
                </h4>
                <div className="space-y-2.5">
                  <input
                    type="text"
                    value={cloneVoiceName}
                    onChange={(e) => setCloneVoiceName(e.target.value)}
                    placeholder="Voice Name (ဥပမာ- My Burmese Narrator Voice)"
                    className="w-full px-3.5 py-2 bg-zinc-900 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-violet-400 font-myanmar"
                  />

                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(e) => setCloneAudioFile(e.target.files?.[0] || null)}
                      className="text-xs text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-violet-600 file:text-white hover:file:bg-violet-500 cursor-pointer"
                    />

                    <button
                      type="button"
                      disabled={isCloningVoice || !cloneAudioFile}
                      onClick={async () => {
                        if (!cloneAudioFile) return;
                        setIsCloningVoice(true);
                        setStatusText('🎙️ ElevenLabs သို့ အသံဖိုင်တင်ပြီး Instant Voice Clone ပြုလုပ်နေပါသည်...');
                        try {
                          const res = await cloneElevenLabsVoice(cloneVoiceName, cloneAudioFile);
                          handleApplyElevenLabsAllocation(res.voice_id, res.name);
                          setStatusText(`✓ Voice Clone အောင်မြင်ပါသည်! (${res.name}) - TTX Segments အားလုံးသို့ သတ်မှတ်ပြီးပါပြီ`);
                          const updatedVoices = await fetchElevenLabsVoices();
                          setElevenLabsVoices(updatedVoices);
                          setCloneAudioFile(null);
                        } catch (err: any) {
                          setErrorMessage(`Voice Clone failed: ${err.message}`);
                        } finally {
                          setIsCloningVoice(false);
                        }
                      }}
                      className="px-4 py-2 bg-gradient-to-r from-violet-500 to-purple-500 hover:opacity-90 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer shrink-0"
                    >
                      {isCloningVoice ? 'Cloning...' : '🚀 Clone Voice'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Available Voices List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black text-violet-300 uppercase tracking-wider font-display">
                    Voices List ({elevenLabsVoices.length} available)
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      fetchElevenLabsVoices().then((v) => setElevenLabsVoices(v)).catch(() => {});
                    }}
                    className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-lg text-[10px] font-bold cursor-pointer"
                  >
                    🔄 Refresh
                  </button>
                </div>

                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                  {elevenLabsVoices.map((v) => {
                    const isSelected = selectedElevenLabsVoiceId === v.voice_id;
                    return (
                      <div
                        key={v.voice_id}
                        onClick={() => handleApplyElevenLabsAllocation(v.voice_id, v.name)}
                        className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between cursor-pointer ${
                          isSelected
                            ? 'bg-gradient-to-r from-violet-500/25 to-purple-500/10 border-violet-400 text-violet-200 shadow-lg ring-1 ring-violet-400/50'
                            : 'bg-white/5 border-white/10 hover:bg-white/10 text-zinc-300'
                        }`}
                      >
                        <div>
                          <span className="text-xs font-black text-white block font-display">{v.name}</span>
                          <span className="text-[10px] text-zinc-400 font-mono">Category: {v.category} | ID: {v.voice_id}</span>
                        </div>

                        <div className="flex items-center gap-2">
                          {v.preview_url && (
                            <audio src={v.preview_url} controls className="h-6 w-28 opacity-75 hover:opacity-100" onClick={(e) => e.stopPropagation()} />
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleApplyElevenLabsAllocation(v.voice_id, v.name);
                            }}
                            className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${isSelected ? 'bg-violet-400 text-zinc-950 font-black shadow' : 'bg-white/10 hover:bg-white/20 text-zinc-200'}`}
                          >
                            {isSelected ? '✓ Active Voice' : 'TTX အားလုံးတွင် သုံးမည်'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {elevenLabsVoices.length === 0 && (
                    <p className="text-xs text-zinc-500 text-center py-6 font-myanmar">
                      ElevenLabs voices မတွေ့ရသေးပါ။ Step 1 တွင် ElevenLabs API Key ထည့်သွင်းထားခြင်း ရှိမရှိ စစ်ဆေးပါ။
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="pt-4 border-t border-white/10 flex items-center justify-between relative z-10">
              <span className="text-xs text-zinc-400 font-myanmar">
                Selected Voice: <strong className="text-violet-300 font-mono">{elevenLabsVoices.find((v) => v.voice_id === selectedElevenLabsVoiceId)?.name || selectedElevenLabsVoiceId || 'None'}</strong>
              </span>
              <button
                type="button"
                onClick={() => {
                  if (selectedElevenLabsVoiceId) {
                    handleApplyElevenLabsAllocation(selectedElevenLabsVoiceId);
                  }
                  setIsElevenLabsFlowOpen(false);
                }}
                className="px-6 py-2.5 bg-gradient-to-r from-violet-500 to-purple-500 text-white font-black text-xs rounded-xl shadow-lg hover:opacity-90 transition-all cursor-pointer"
              >
                Done (အတည်ပြုမည်)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
