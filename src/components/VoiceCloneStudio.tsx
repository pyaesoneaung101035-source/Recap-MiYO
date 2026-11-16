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
  X,
  Search,
  Sliders,
  User,
  Lock,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Filter,
  ShieldCheck,
} from 'lucide-react';
import { ProjectState, TranscriptSegment, VoiceOption, VoiceToneOption, TtsEngineMode } from '../types';
import {
  synthesizeMyanmarVoice,
  VOICE_PROFILES,
  VOICE_TONE_PRESETS,
  VoiceStyle,
} from '../utils/edgeTtsClient';
import {
  shortenBurmeseTextForDuration,
  generateShortBridgeLineForSlot,
  countBurmeseSyllables,
} from '../utils/geminiPool';
import { registerPreviewAudio, stopAllPreviewAudio } from '../utils/audioPreviewManager';
import { stitchAudioPartsWithPause } from '../utils/audioStitcher';
import { VideoPlayerView } from './VideoPlayerView';
import { HumanReviewDubbingStudio } from './HumanReviewDubbingStudio';
import {
  getMinuteBlocks,
  getRecapSlots,
  RECAP_SLOT_SECONDS,
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

export const NARA_VOICES: VoiceOption[] = [
  'NaraKoBanyar', 'NaraHtetMyat', 'NaraShoon', 'NaraThazin'
];

export const MALE_VOICES: VoiceOption[] = [
  'Thiha', 'KyawKyaw', 'AungAung', 'MinThway',
  'NaraKoBanyar', 'NaraHtetMyat',
  'Titus', 'Perseus', 'Oberon', 'Atlas',
  'Schedar', 'Gacrux', 'Achird', 'Zubenelgenubi', 'Sadaltager'
];

export const FEMALE_VOICES: VoiceOption[] = [
  'Nilar', 'MayThu', 'Thiri', 'SuSu',
  'NaraShoon', 'NaraThazin',
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

  // Strict Single-Voice Lock State (guarantees zero double-voice output)
  const [singleVoice, setSingleVoice] = useState<VoiceOption>(
    project.lockedVoice || project.segments[0]?.voice || 'Thiha'
  );
  const [ttsEngine, setTtsEngine] = useState<TtsEngineMode>(
    project.ttsEngine || (VOICE_PROFILES[project.lockedVoice || project.segments[0]?.voice || 'Thiha']?.naraVoiceId ? 'nara' : 'auto')
  );
  const [voiceStyle, setVoiceStyle] = useState<VoiceStyle>(project.voiceStyle || 'recap');
  const [voiceTone, setVoiceTone] = useState<VoiceToneOption>(project.voiceTone || 'natural');
  const [voicePitch, setVoicePitch] = useState<number>(project.voicePitch ?? 0);

  // Flow Panels State
  const [isGeminiFlowOpen, setIsGeminiFlowOpen] = useState(false);

  // Flow Panel filters & search
  const [genderFilter, setGenderFilter] = useState<'all' | 'male' | 'female'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Generation & Audio state
  const [trimSilence, setTrimSilence] = useState<boolean>(false);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [isSyncFitting, setIsSyncFitting] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [voiceGenStage, setVoiceGenStage] = useState<4 | 5 | null>(null);
  const [voiceGenPercent, setVoiceGenPercent] = useState<number>(0);

  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  const [testingVoice, setTestingVoice] = useState<string | null>(null);
  const [testAudioUrls, setTestAudioUrls] = useState<Record<string, string>>({});
  const [selectedMinutePart, setSelectedMinutePart] = useState<number | 'all'>('all');

  useEffect(() => {
    return () => {
      stopAllPreviewAudio();
    };
  }, []);

  const isRecap30sProject =
    project.narrationMode === 'scene_recap_30s' ||
    project.segments.some((s) => s.slotMode === 'scene_recap_30s' || (s.endTime - s.startTime) >= 20);

  const minuteBlocks = isRecap30sProject
    ? getRecapSlots(project.videoDuration || 360, project.recapSlotSeconds || RECAP_SLOT_SECONDS)
    : getMinuteBlocks(project.videoDuration || MINUTE_BLOCK_SECONDS);
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
    stopAllPreviewAudio();
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
    // Pause main VideoPlayerView so preview and video dialogue/narration NEVER overlap
    setProject((prev) => (prev.isPlaying ? { ...prev, isPlaying: false } : prev));

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

    registerPreviewAudio(audio, () => setPlayingAudioId(null));

    audio.play().then(() => {
      setAudioElement(audio);
      setPlayingAudioId(clipId);
    }).catch((playErr) => {
      console.warn('Audio play error, retrying standard play:', playErr);
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

    stopAudio();
    setProject((prev) => (prev.isPlaying ? { ...prev, isPlaying: false } : prev));

    // Pre-unlock audio synchronously during user click handler
    const preAudio = new Audio();
    preAudio.play().catch(() => {});

    setTestingVoice(vKey);
    const profile = VOICE_PROFILES[vKey];
    const cacheKey = `${vKey}_${voiceStyle}_${voiceTone}_${voicePitch}`;
    setStatusText(`[Studio] ${profile.name} (${voiceTone}, ${voicePitch >= 0 ? `+${voicePitch}` : voicePitch}%) စမ်းသပ်နေသည်...`);

    const activeSpeed = project.voicePlaybackRate || 1.0;

    const testEngine: TtsEngineMode = profile.naraVoiceId ? 'nara' : (ttsEngine === 'nara' ? 'auto' : ttsEngine);

    try {
      const samplePhrase = profile.sampleGreeting;
      const result = await synthesizeMyanmarVoice(samplePhrase, {
        voice: vKey,
        style: voiceStyle,
        tone: voiceTone,
        pitchOffset: voicePitch,
        speed: activeSpeed,
        trimSilence: false,
        preferredEngine: testEngine,
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

  const handleEngineSwitch = (nextEngine: TtsEngineMode) => {
    setTtsEngine(nextEngine);
    let resolvedVoice = singleVoice;
    if (nextEngine === 'nara' && !VOICE_PROFILES[singleVoice]?.naraVoiceId) {
      resolvedVoice = VOICE_PROFILES[singleVoice]?.gender === 'female' ? 'NaraShoon' : 'NaraKoBanyar';
    } else if (nextEngine !== 'nara' && VOICE_PROFILES[singleVoice]?.naraVoiceId) {
      resolvedVoice = VOICE_PROFILES[singleVoice]?.gender === 'female' ? 'Nilar' : 'Thiha';
    }
    setSingleVoice(resolvedVoice);
    setProject((prev) => ({
      ...prev,
      ttsEngine: nextEngine,
      lockedVoice: resolvedVoice,
      segments: prev.segments.map((s) => ({
        ...s,
        voice: resolvedVoice,
        speaker: 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
      })),
    }));
    setStatusText(
      nextEngine === 'nara'
        ? `🤗 Nara Mini v1 Engine (${VOICE_PROFILES[resolvedVoice].name}) ကို Step 4 Voice Clone အတွက် ဖွင့်လှစ်ပြီးပါပြီ!`
        : `✨ Gemini / 24kHz Neural Engine (${VOICE_PROFILES[resolvedVoice].name}) သို့ ပြောင်းလဲပြီးပါပြီ။`
    );
  };

  const handleApplyVoiceAllocation = (overrideVoice?: VoiceOption) => {
    const selected = overrideVoice || singleVoice;
    const isNara = Boolean(VOICE_PROFILES[selected]?.naraVoiceId);
    const resolvedEngine: TtsEngineMode = isNara ? 'nara' : (ttsEngine === 'nara' ? 'auto' : ttsEngine);
    setSingleVoice(selected);
    setTtsEngine(resolvedEngine);
    setProject((prev) => ({
      ...prev,
      ttsEngine: resolvedEngine,
      lockedVoice: selected,
      segments: prev.segments.map((s) => ({
        ...s,
        voice: selected,
        speaker: 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
      })),
    }));
    setStatusText(`✓ Single Burmese Narrator (${VOICE_PROFILES[selected].name}) ကို Segments အားလုံးသို့ တစ်သံတည်း Lock ချပြီးပါပြီ။`);
  };

  const handleSegmentVoiceChange = (_segId: string, newVoice: VoiceOption) => {
    // Enforce single voice lock across all segments so double-voice output can never occur
    handleApplyVoiceAllocation(newVoice);
  };

  const handleToneChange = (newTone: VoiceToneOption) => {
    const preset = VOICE_TONE_PRESETS.find((p) => p.id === newTone);
    const nextPitch = preset ? preset.pitchPct : voicePitch;
    setVoiceTone(newTone);
    setVoicePitch(nextPitch);
    setProject((prev) => ({
      ...prev,
      voiceTone: newTone,
      voicePitch: nextPitch,
      segments: prev.segments.map((s) => ({
        ...s,
        tone: newTone,
        pitch: nextPitch,
      })),
    }));
    setStatusText(
      `✓ Voice Tone: "${preset?.label || newTone}" (${nextPitch >= 0 ? `+${nextPitch}` : nextPitch}%) သို့ ပြောင်းလဲပြီးပါပြီ။`
    );
  };

  const handlePitchChange = (newPitch: number) => {
    const clamped = Math.max(-15, Math.min(15, Math.round(newPitch)));
    setVoicePitch(clamped);
    setProject((prev) => ({
      ...prev,
      voicePitch: clamped,
      segments: prev.segments.map((s) => ({
        ...s,
        pitch: clamped,
      })),
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
          enforceSingleVoice: singleVoice,
          enforceSingleSpeakerLabel: true,
        }
      );
      return {
        ...prev,
        lockedVoice: singleVoice,
        segments: realigned,
      };
    });
    setStatusText(
      `✓ 0:30 Part Auto-Align ပြီးစီးပါပြီ: ၃၀ စက္ကန့်စာ အပိုင်း (${totalMinuteBlocks} Parts) တစ်ခုချင်းစီအတွင်း နောက်ပိုင်းအသံများ အချိန်မရွေ့စေရန် Gentle Speed (0.90x - 1.15x) ဖြင့် ပြန်ညှိပြီးပါပြီ။`
    );
  };

  const synthesizeSlotWithBridge = async (
    seg: TranscriptSegment,
    opts: {
      style: VoiceStyle;
      tone: VoiceToneOption;
      pitchOffset: number;
      preferredEngine: TtsEngineMode;
      onStatus?: (msg: string) => void;
    }
  ): Promise<{
    audioUrl: string;
    duration: number;
    engineUsed: 'gemini' | 'neural' | 'nara';
    mainNarration?: string;
    bridgeNarration?: string;
    pauseBetweenParts?: number;
    combinedText: string;
  }> => {
    const slotDur = Math.max(
      1.0,
      (seg.originalEndTime ?? seg.endTime) - (seg.originalStartTime ?? seg.startTime)
    );
    const isRecapSlot =
      seg.slotMode === 'scene_recap_30s' ||
      Boolean(seg.mainNarration) ||
      Boolean(seg.bridgeNarration) ||
      slotDur >= 15;

    if (!isRecapSlot) {
      const text = (seg.myanmarTranslation || seg.originalText || '').trim();
      const res = await synthesizeMyanmarVoice(text, {
        voice: singleVoice,
        style: opts.style,
        tone: opts.tone,
        pitchOffset: opts.pitchOffset,
        emotion: seg.emotion,
        speed: 1.0,
        trimSilence,
        preferredEngine: opts.preferredEngine,
        onStatusUpdate: opts.onStatus,
      });
      return {
        audioUrl: res.audioUrl,
        duration: res.duration,
        engineUsed: res.engineUsed,
        combinedText: text,
      };
    }

    const pauseGap = seg.pauseBetweenParts ?? 0.18;
    const mainText = (seg.mainNarration || seg.myanmarTranslation || seg.originalText || '').trim();
    const part1 = await synthesizeMyanmarVoice(mainText, {
      voice: singleVoice,
      style: opts.style,
      tone: opts.tone,
      pitchOffset: opts.pitchOffset,
      emotion: seg.emotion,
      speed: 1.0,
      trimSilence,
      preferredEngine: opts.preferredEngine,
      onStatusUpdate: opts.onStatus,
    });

    let bridgeText = (seg.bridgeNarration || '').trim();
    const remainingAfterPart1 = slotDur - part1.duration - pauseGap;

    // Auto-generate a scene-matching short bridge line if narration is too short for this slot
    if (!bridgeText && remainingAfterPart1 >= 3.5) {
      opts.onStatus?.(
        `✨ [${seg.sceneShotId || `${slotDur.toFixed(0)}s Slot`}] အချိန်တိုနေသဖြင့် မြင်ကွင်းနဲ့ကိုက်ညီတဲ့ ဆက်စကားတို (+0.18s Pause) ဖန်တီးဖြည့်စွက်နေသည်...`
      );
      bridgeText = await generateShortBridgeLineForSlot(
        mainText,
        Math.max(4.0, remainingAfterPart1 - 0.5),
        seg.originalText || seg.sceneTitle || ''
      );
    }

    if (!bridgeText) {
      return {
        audioUrl: part1.audioUrl,
        duration: part1.duration,
        engineUsed: part1.engineUsed,
        mainNarration: mainText,
        bridgeNarration: '',
        pauseBetweenParts: pauseGap,
        combinedText: mainText,
      };
    }

    // Always lock bridge synthesis to part1.engineUsed so zero double-voice occurs inside a slot
    let part2 = await synthesizeMyanmarVoice(bridgeText, {
      voice: singleVoice,
      style: opts.style,
      tone: opts.tone,
      pitchOffset: opts.pitchOffset,
      emotion: seg.emotion,
      speed: 1.0,
      trimSilence,
      preferredEngine: part1.engineUsed,
    });

    let stitched = await stitchAudioPartsWithPause(part1.audioUrl, part2.audioUrl, pauseGap);

    // If combined duration (Part 1 + 0.18s + Part 2) still leaves > 6.5s empty in a 30s slot, expand bridge once
    if (slotDur >= 20 && stitched.duration < slotDur * 0.72) {
      const missingSec = Math.max(4.5, slotDur - part1.duration - pauseGap - 0.8);
      opts.onStatus?.(
        `⏱️ Slot ${slotDur.toFixed(0)}s ပြည့်စေရန် ဆက်စကားတို (${missingSec.toFixed(1)}s စာ) ထပ်မံညှိနေသည်...`
      );
      const expandedBridge = await generateShortBridgeLineForSlot(
        mainText,
        missingSec,
        seg.originalText || seg.sceneTitle || '',
        bridgeText
      );
      if (expandedBridge && expandedBridge !== bridgeText) {
        bridgeText = expandedBridge;
        part2 = await synthesizeMyanmarVoice(bridgeText, {
          voice: singleVoice,
          style: opts.style,
          tone: opts.tone,
          pitchOffset: opts.pitchOffset,
          emotion: seg.emotion,
          speed: 1.0,
          trimSilence,
          preferredEngine: part1.engineUsed,
        });
        stitched = await stitchAudioPartsWithPause(part1.audioUrl, part2.audioUrl, pauseGap);
      }
    }

    const combinedText = `${mainText} ${bridgeText}`.trim();
    return {
      audioUrl: stitched.audioUrl,
      duration: stitched.duration,
      engineUsed: part1.engineUsed,
      mainNarration: mainText,
      bridgeNarration: bridgeText,
      pauseBetweenParts: pauseGap,
      combinedText,
    };
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
    const activeTone = voiceTone || seg.tone || project.voiceTone || 'natural';
    const activePitch = voicePitch ?? seg.pitch ?? project.voicePitch ?? 0;

    const effectiveEngine: TtsEngineMode = VOICE_PROFILES[singleVoice]?.naraVoiceId ? 'nara' : ttsEngine;

    try {
      const slotRes = await synthesizeSlotWithBridge(seg, {
        style: activeStyle,
        tone: activeTone,
        pitchOffset: activePitch,
        preferredEngine: effectiveEngine,
        onStatus: (msg) => setStatusText(msg),
      });
      const resultUrl = slotRes.audioUrl;
      const resultDuration = slotRes.duration;

      let resolvedRate = activeSpeed;
      setProject((prev) => {
        const updatedSegs = prev.segments.map((s) =>
          s.id === seg.id
            ? {
                ...s,
                audioUrl: resultUrl,
                audioDuration: resultDuration,
                mainNarration: slotRes.mainNarration ?? s.mainNarration,
                bridgeNarration: slotRes.bridgeNarration ?? s.bridgeNarration,
                pauseBetweenParts: slotRes.pauseBetweenParts ?? s.pauseBetweenParts,
                myanmarTranslation: slotRes.combinedText || s.myanmarTranslation,
                subtitleText: slotRes.combinedText || s.subtitleText,
                syllableCount: countBurmeseSyllables(slotRes.combinedText || s.myanmarTranslation),
                isGeneratingAudio: false,
                voiceProvider: (slotRes.engineUsed === 'nara' ? 'nara_mini_v1' : 'gemini') as 'nara_mini_v1' | 'gemini',
                voice: singleVoice,
                tone: activeTone,
                pitch: activePitch,
                speaker: 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
              }
            : s
        );
        const aligned = realignSegmentsByMinuteBlocks(
          updatedSegs,
          prev.videoDuration || MINUTE_BLOCK_SECONDS,
          {
            enforceSingleVoice: singleVoice,
            enforceSingleSpeakerLabel: true,
          }
        );
        const found = aligned.find((a) => a.id === seg.id);
        if (found?.playbackRate) resolvedRate = found.playbackRate;
        return {
          ...prev,
          lockedVoice: singleVoice,
          voiceTone: activeTone,
          voicePitch: activePitch,
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
    setVoiceGenStage(4);
    setVoiceGenPercent(4);
    setErrorMessage(null);
    setBatchProgress({ current: 0, total: targetSegs.length });

    const total = targetSegs.length;
    const generatedMap = new Map<
      string,
      {
        audioUrl: string;
        audioDuration: number;
        voice: VoiceOption;
        engineUsed: 'gemini' | 'neural' | 'nara';
        mainNarration?: string;
        bridgeNarration?: string;
        pauseBetweenParts?: number;
        combinedText: string;
      }
    >();
    const failedSegs: Array<{ idx: number; id: string; text: string; reason: string }> = [];
    let batchEngine: TtsEngineMode = VOICE_PROFILES[singleVoice]?.naraVoiceId ? 'nara' : ttsEngine;
    let switchedToNeuralMidBatch = false;

    const activeStyle = voiceStyle || project.voiceStyle || 'recap';
    const activeTone = voiceTone || project.voiceTone || 'natural';
    const activePitch = voicePitch ?? project.voicePitch ?? 0;

    for (let i = 0; i < total; i++) {
      const seg = targetSegs[i];
      const text = (seg.myanmarTranslation || seg.originalText || '').trim();
      if (!text) continue;

      const slotStep = isRecap30sProject ? (project.recapSlotSeconds || RECAP_SLOT_SECONDS) : MINUTE_BLOCK_SECONDS;
      const partNum = Math.floor(Math.max(0, seg.startTime) / slotStep) + 1;
      setBatchProgress({ current: i + 1, total });
      setVoiceGenPercent(Math.min(82, Math.round(5 + ((i + 1) / Math.max(1, total)) * 77)));
      setStatusText(
        `၄. [Part ${partNum}] ${VOICE_PROFILES[singleVoice].name} Narrator အသံဖန်တီး & ပြောနှုန်းညှိနေသည် (${i + 1}/${total}): "${text.substring(0, 22)}..."`
      );

      let succeeded = false;
      let lastErrMsg = 'Synthesis failed';

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const result = await synthesizeSlotWithBridge(seg, {
            style: activeStyle,
            tone: activeTone,
            pitchOffset: activePitch,
            preferredEngine: batchEngine,
            onStatus: (msg) => setStatusText(msg),
          });

          if (!result.audioUrl) {
            throw new Error('Empty audio URL returned');
          }

          if (batchEngine === 'auto') {
            batchEngine = result.engineUsed;
          } else if (batchEngine === 'gemini' && result.engineUsed === 'neural') {
            batchEngine = 'neural';
            switchedToNeuralMidBatch = true;
          }

          generatedMap.set(seg.id, {
            audioUrl: result.audioUrl,
            audioDuration: result.duration,
            voice: singleVoice,
            engineUsed: result.engineUsed,
            mainNarration: result.mainNarration,
            bridgeNarration: result.bridgeNarration,
            pauseBetweenParts: result.pauseBetweenParts,
            combinedText: result.combinedText,
          });

          setProject((prev) => ({
            ...prev,
            lockedVoice: singleVoice,
            segments: prev.segments.map((s) =>
              s.id === seg.id
                ? {
                    ...s,
                    audioUrl: result.audioUrl,
                    audioDuration: result.duration,
                    mainNarration: result.mainNarration ?? s.mainNarration,
                    bridgeNarration: result.bridgeNarration ?? s.bridgeNarration,
                    pauseBetweenParts: result.pauseBetweenParts ?? s.pauseBetweenParts,
                    myanmarTranslation: result.combinedText || s.myanmarTranslation,
                    subtitleText: result.combinedText || s.subtitleText,
                    syllableCount: countBurmeseSyllables(result.combinedText || s.myanmarTranslation),
                    voiceProvider: (result.engineUsed === 'nara' ? 'nara_mini_v1' : 'gemini') as 'nara_mini_v1' | 'gemini',
                    voice: singleVoice,
                    tone: activeTone,
                    pitch: activePitch,
                    speaker: 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
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

    // If Gemini quota ran out mid-batch and dropped to 'neural', harmonize any earlier 'gemini' segments
    // in this batch so 100% of clips share the exact same single engine timbre!
    if (switchedToNeuralMidBatch) {
      const geminiEntries = Array.from(generatedMap.entries()).filter(([, v]) => v.engineUsed === 'gemini');
      for (let k = 0; k < geminiEntries.length; k++) {
        const [segId, prevGen] = geminiEntries[k];
        const seg = targetSegs.find((s) => s.id === segId);
        if (!seg) continue;
        setStatusText(`🎯 အသံတစ်သံတည်း တူညီစေရန် Harmonize ပြုလုပ်နေသည် (${k + 1}/${geminiEntries.length})...`);
        try {
          const updatedSeg: TranscriptSegment = {
            ...seg,
            mainNarration: prevGen.mainNarration ?? seg.mainNarration,
            bridgeNarration: prevGen.bridgeNarration ?? seg.bridgeNarration,
            pauseBetweenParts: prevGen.pauseBetweenParts ?? seg.pauseBetweenParts,
            myanmarTranslation: prevGen.combinedText || seg.myanmarTranslation,
          };
          const uni = await synthesizeSlotWithBridge(updatedSeg, {
            style: activeStyle,
            tone: activeTone,
            pitchOffset: activePitch,
            preferredEngine: 'neural',
          });
          if (uni.audioUrl) {
            generatedMap.set(segId, {
              audioUrl: uni.audioUrl,
              audioDuration: uni.duration,
              voice: singleVoice,
              engineUsed: 'neural',
              mainNarration: uni.mainNarration,
              bridgeNarration: uni.bridgeNarration,
              pauseBetweenParts: uni.pauseBetweenParts,
              combinedText: uni.combinedText,
            });
          }
        } catch (_) {}
      }
    }

    // STAGE 5: Re-align all segments cleanly inside their 0:30 part windows (0:00-0:30, 0:30-1:00...) with gentle speed (0.90x-1.18x)
    setVoiceGenStage(5);
    setVoiceGenPercent(92);
    setStatusText(
      `၅. 0:30 Part Sync (${totalMinuteBlocks} Parts: 0:00-0:30, 0:30-1:00...) အတွင်း အသံ + Subtitle အချိန်မရွေ့စေရန် ပြန်ညှိနေပါသည်...`
    );

    setProject((prev) => {
      const merged = prev.segments.map((s) => {
        const gen = generatedMap.get(s.id);
        return gen
          ? {
              ...s,
              audioUrl: gen.audioUrl,
              audioDuration: gen.audioDuration,
              mainNarration: gen.mainNarration ?? s.mainNarration,
              bridgeNarration: gen.bridgeNarration ?? s.bridgeNarration,
              pauseBetweenParts: gen.pauseBetweenParts ?? s.pauseBetweenParts,
              myanmarTranslation: gen.combinedText || s.myanmarTranslation,
              subtitleText: gen.combinedText || s.subtitleText,
              syllableCount: countBurmeseSyllables(gen.combinedText || s.myanmarTranslation),
              voiceProvider: (gen.engineUsed === 'nara' ? 'nara_mini_v1' : 'gemini') as 'nara_mini_v1' | 'gemini',
              voice: singleVoice,
              tone: activeTone,
              pitch: activePitch,
              speaker: 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
            }
          : {
              ...s,
              voice: singleVoice,
              speaker: 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
            };
      });
      const aligned = realignSegmentsByMinuteBlocks(
        merged,
        prev.videoDuration || MINUTE_BLOCK_SECONDS,
        {
          enforceSingleVoice: singleVoice,
          enforceSingleSpeakerLabel: true,
        }
      );
      return {
        ...prev,
        lockedVoice: singleVoice,
        voiceTone: activeTone,
        voicePitch: activePitch,
        segments: aligned,
      };
    });

    setVoiceGenPercent(100);
    setIsBatchGenerating(false);
    setBatchProgress(null);
    setVoiceGenStage(null);

    if (failedSegs.length > 0) {
      setErrorMessage(
        `⚠️ စာကြောင်း ${failedSegs.length} ခု Voice Clone ထုတ်မရသေးပါ (ဥပမာ "${failedSegs[0].text}...": ${failedSegs[0].reason})။ "Retry Missing Voices" ခလုတ်ကို နှိပ်၍ ပြန်ထုတ်နိုင်ပါသည်။`
      );
      setStatusText(
        `✓ ${generatedMap.size}/${total} Segments အသံသွင်း + 0:30 Part Sync ညှိပြီးပါပြီ (${failedSegs.length} ခု မအောင်မြင်ပါ)`
      );
    } else {
      setStatusText(
        onlyMissing
          ? `✓ ကျန်ရှိနေသော Voice Clone ${generatedMap.size} ခုလုံး ထုတ်ယူပြီး 0:30 Part Sync ညှိပြီးပါပြီ!`
          : onlyPartNumber
            ? `✓ Part ${onlyPartNumber} (${generatedMap.size} Segments) အသံသွင်းပြီး 0:30 အချိန်ကွက်အတွင်း ပြန်ညှိပြီးပါပြီ!`
            : `✓ အဆင့် ၄ & ၅ ပြီးစီးပါပြီ: Single Narrator (${VOICE_PROFILES[singleVoice].name}) အသံ ${generatedMap.size} ခုလုံး + 0:30 Part Sync (${totalMinuteBlocks} Parts) ချိန်ညှိပြီးပါပြီ!`
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

    const activeStyle = voiceStyle || project.voiceStyle || 'recap';
    const activeTone = voiceTone || project.voiceTone || 'natural';
    const activePitch = voicePitch ?? project.voicePitch ?? 0;

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

        const activeEngine: TtsEngineMode = VOICE_PROFILES[singleVoice]?.naraVoiceId ? 'nara' : ttsEngine;
        const result = await synthesizeMyanmarVoice(textToSpeak, {
          voice: singleVoice,
          style: activeStyle,
          tone: activeTone,
          pitchOffset: activePitch,
          emotion: seg.emotion,
          speed: 1.0,
          trimSilence,
          preferredEngine: activeEngine,
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
                voice: singleVoice,
                tone: activeTone,
                pitch: activePitch,
              }
            : s;
        });
        const aligned = realignSegmentsByMinuteBlocks(
          merged,
          prev.videoDuration || MINUTE_BLOCK_SECONDS,
          {
            enforceSingleVoice: singleVoice,
            enforceSingleSpeakerLabel: true,
          }
        );
        return { ...prev, lockedVoice: singleVoice, segments: aligned };
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
  const currentVoiceProfile = VOICE_PROFILES[singleVoice];

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

          {/* ENGINE SELECTOR & NARA MINI v1 (HUGGING FACE) VOICE CLONE PANEL */}
          <div className="p-4 rounded-2xl bg-black/50 border border-amber-500/35 space-y-3 backdrop-blur-xl shadow-lg">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-base">🤗</span>
                <div>
                  <h3 className="text-xs font-black text-amber-300 font-display">
                    Voice Clone Engine & Nara Mini v1 (Kokoro Burmese 24kHz)
                  </h3>
                  <p className="text-[10px] text-zinc-400 font-myanmar">
                    100% Free Native Burmese TTS • YeeNyunn/nara-mini-v1 (HF Space)
                  </p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-[10px] font-mono text-amber-300">
                nara-mini-v1-tts
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleEngineSwitch('auto')}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  ttsEngine !== 'nara'
                    ? 'bg-emerald-500/20 border-emerald-400 text-white shadow ring-1 ring-emerald-400/40'
                    : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'
                }`}
              >
                <div className="text-[11px] font-black flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Gemini + Neural 24kHz</span>
                </div>
                <span className="text-[10px] text-zinc-400 block mt-0.5 font-myanmar">
                  အသံ ၂၅ မျိုး + Tone / Pitch
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleEngineSwitch('nara')}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  ttsEngine === 'nara'
                    ? 'bg-amber-500/25 border-amber-400 text-white shadow ring-1 ring-amber-400/40'
                    : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'
                }`}
              >
                <div className="text-[11px] font-black flex items-center gap-1.5">
                  <span>🤗</span>
                  <span>Nara Mini v1 (HF Free)</span>
                </div>
                <span className="text-[10px] text-amber-200/80 block mt-0.5 font-myanmar">
                  YeeNyunn/nara-mini-v1 Kokoro
                </span>
              </button>
            </div>

            {/* 4 Direct Nara Mini v1 Preset Voice Buttons */}
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              {NARA_VOICES.map((nVoice) => {
                const nProfile = VOICE_PROFILES[nVoice];
                const isSelected = singleVoice === nVoice;
                const cacheKey = `${nVoice}_${voiceStyle}_${voiceTone}_${voicePitch}`;
                const isTesting = testingVoice === nVoice;
                const isPlaying = playingAudioId === `test_${cacheKey}`;

                return (
                  <div
                    key={nVoice}
                    onClick={() => handleApplyVoiceAllocation(nVoice)}
                    className={`p-2 rounded-xl border flex items-center justify-between gap-1.5 cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-amber-500/20 border-amber-400 text-amber-100 ring-1 ring-amber-400/40'
                        : 'bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold truncate flex items-center gap-1">
                        <span>{nProfile.myanmarName}</span>
                        <span className="text-[9px] font-mono text-zinc-400">
                          ({nProfile.gender === 'male' ? 'M' : 'F'})
                        </span>
                      </div>
                      <div className="text-[9px] font-mono text-amber-300/80 truncate">
                        {nProfile.naraVoiceId}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (testAudioUrls[cacheKey]) {
                          playVoiceClip(`test_${cacheKey}`, testAudioUrls[cacheKey]);
                        } else {
                          handleTestVoice(nVoice);
                        }
                      }}
                      disabled={isTesting}
                      title="Nara Mini v1 အသံနမူနာ နားထောင်မည်"
                      className="p-1.5 rounded-lg bg-white/10 hover:bg-amber-400 hover:text-zinc-950 text-white transition-all shrink-0 cursor-pointer"
                    >
                      {isTesting ? (
                        <RotateCw className="w-3 h-3 animate-spin text-amber-300" />
                      ) : isPlaying ? (
                        <Pause className="w-3 h-3" />
                      ) : (
                        <Play className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* STRICT SINGLE VOICE LOCK BANNER & CHARACTER PICKER */}
          <div className="space-y-3">
            <div className="p-3 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="p-1.5 rounded-xl bg-emerald-400/20 text-emerald-300 border border-emerald-400/30 shrink-0">
                  <Lock className="w-3.5 h-3.5" />
                </span>
                <div>
                  <span className="text-xs font-black text-emerald-300 block font-display">
                    Single Voice Lock Active (တစ်သံတည်း သီးသန့်စနစ်)
                  </span>
                  <span className="text-[11px] text-zinc-400 font-myanmar block">
                    အသံနှစ်သံ မရောစေရန် Narrator တစ်ဦးတည်းအသံဖြင့်သာ ဗီဒီယိုတစ်ခုလုံးကို ထုတ်ပေးပါမည်
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleApplyVoiceAllocation(singleVoice)}
                className="px-2.5 py-1.5 rounded-xl bg-emerald-400/15 hover:bg-emerald-400/25 border border-emerald-400/40 text-emerald-300 text-[10px] font-bold shrink-0 cursor-pointer"
              >
                Sync All
              </button>
            </div>

            <div
              onClick={() => setIsGeminiFlowOpen(true)}
              className="p-4 rounded-2xl border border-emerald-400/80 bg-gradient-to-r from-emerald-500/20 via-teal-500/10 to-transparent hover:border-emerald-300 transition-all cursor-pointer group shadow-xl flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-400 to-teal-400 text-zinc-950 font-black flex items-center justify-center text-base shadow-md">
                  {currentVoiceProfile.name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-sm font-black text-white font-display">
                    {currentVoiceProfile.name} ({currentVoiceProfile.myanmarName} — {currentVoiceProfile.gender === 'male' ? 'Male' : 'Female'})
                  </h3>
                  <p className="text-xs text-emerald-300/90 font-medium mt-0.5">
                    {currentVoiceProfile.toneTitle}
                  </p>
                </div>
              </div>

              <span className="text-xs font-bold text-emerald-400 group-hover:translate-x-1 transition-transform flex items-center gap-1 shrink-0">
                <span>အသံပြောင်းရန်</span>
                <ChevronRight className="w-4 h-4" />
              </span>
            </div>
          </div>

          {/* VOICE TONE & FINE VOCAL PITCH CONTROLS */}
          <div className="p-4 rounded-2xl bg-black/50 border border-cyan-500/30 space-y-3.5 backdrop-blur-xl shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black text-cyan-300 flex items-center gap-2 font-display">
                <AudioLines className="w-4 h-4 text-cyan-400" />
                <span>Voice Tone & Vocal Pitch ချိန်ညှိခန်း</span>
              </span>
              <button
                type="button"
                onClick={() => handleTestVoice(singleVoice)}
                disabled={testingVoice !== null}
                className="px-3 py-1 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-zinc-950 text-[11px] font-black flex items-center gap-1.5 shadow cursor-pointer disabled:opacity-50"
              >
                {testingVoice ? (
                  <RotateCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Play className="w-3 h-3 fill-zinc-950" />
                )}
                <span>Test Tone</span>
              </button>
            </div>

            {/* Tone Presets Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {VOICE_TONE_PRESETS.map((preset) => {
                const isSelected = voiceTone === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleToneChange(preset.id)}
                    className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-gradient-to-br from-cyan-500/25 to-emerald-500/20 border-cyan-400 text-white shadow-md ring-1 ring-cyan-400/40'
                        : 'bg-white/5 border-white/10 text-zinc-300 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 text-[10px] font-bold">
                      <span className="truncate">{preset.label}</span>
                      <span className="font-mono text-cyan-300 shrink-0">{preset.badge}</span>
                    </div>
                    <span className="text-[10px] text-zinc-400 font-myanmar block truncate mt-0.5">
                      {preset.myanmarLabel}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Fine Tone Pitch Offset Slider (-15% to +15%) */}
            <div className="pt-2 border-t border-white/10 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[11px] font-bold text-zinc-200 font-myanmar">
                  အသံနိမ့် / အသံမြင့် Tone ချိန်ညှိမှု (Vocal Pitch Offset)
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-cyan-300 px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30">
                    {voicePitch > 0 ? `+${voicePitch}%` : `${voicePitch}%`}
                  </span>
                  {voicePitch !== 0 && (
                    <button
                      type="button"
                      onClick={() => handlePitchChange(0)}
                      className="text-[10px] text-zinc-400 hover:text-white underline cursor-pointer"
                    >
                      Reset 0%
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-[10px] font-mono text-zinc-400 font-bold">-15% (Deep)</span>
                <input
                  type="range"
                  min="-15"
                  max="15"
                  step="1"
                  value={voicePitch}
                  onChange={(e) => handlePitchChange(parseInt(e.target.value, 10))}
                  className="flex-1 accent-cyan-400 h-2 bg-white/10 rounded-lg cursor-pointer"
                />
                <span className="text-[10px] font-mono text-zinc-400 font-bold">+15% (Bright)</span>
              </div>
            </div>

            {/* Quick Delivery Style Selector */}
            <div className="pt-2 border-t border-white/10 flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-zinc-400 font-bold mr-1">Style:</span>
              {[
                { id: 'recap' as VoiceStyle, label: '🎬 Recap' },
                { id: 'conversational' as VoiceStyle, label: '🎙️ Natural' },
                { id: 'broadcast' as VoiceStyle, label: '📢 Broadcast' },
                { id: 'energetic' as VoiceStyle, label: '🔥 Energetic' },
                { id: 'soothing' as VoiceStyle, label: '☕ Calm' },
                { id: 'affectionate' as VoiceStyle, label: '💖 Warm' },
              ].map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => handleStyleChange(st.id)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                    voiceStyle === st.id
                      ? 'bg-emerald-400 text-zinc-950 font-black shadow'
                      : 'bg-white/5 text-zinc-300 hover:bg-white/10 border border-white/10'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

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
                title="0:30 စာ အပိုင်းတစ်ခုချင်းစီအတွင်း နောက်ပိုင်းအသံများ မရွေ့စေရန် အသာအယာ (0.90x-1.15x) ပြန်ညှိမည်"
              >
                <Zap className="w-3 h-3 text-emerald-400" />
                <span>⏱️ 0:30 Part Align (အချိန်ကွက် ညှိမည်)</span>
              </button>

              <span className="text-[10px] text-zinc-400 font-mono">
                Generated: {generatedCount} / {project.segments.length}
              </span>
            </div>
          </div>

          {/* Slot / 0:30 Part Selector & Drift Sync Monitor */}
          <div className="p-3.5 rounded-2xl bg-black/40 border border-cyan-500/25 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-cyan-300 flex items-center gap-1.5 font-myanmar">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                <span>
                  {isRecap30sProject
                    ? `၃၀ စက္ကန့် Scene Slots (${totalMinuteBlocks} Slots — 0.18s Pause)`
                    : `0:30 စာ အချိန်ကွက်များ (${totalMinuteBlocks} Parts · 0:00-0:30, 0:30-1:00...)`}
                </span>
              </span>
              <span className="text-[10px] font-mono text-zinc-400">
                {isRecap30sProject ? 'Scene-by-Scene 30s Lock' : 'Sync Lock / 0:30 Part'}
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
                    <span>
                      {isRecap30sProject ? `S${part.partNumber}` : `P${part.partNumber}`} ({formatMinSec(part.startSec)}–{formatMinSec(part.endSec)})
                    </span>
                    <span className={`px-1 rounded text-[9px] font-mono ${hasWarn ? 'bg-amber-500/30 text-amber-200' : 'bg-black/40 text-emerald-300'}`}>
                      {readyInPart}/{partSegs.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Action Buttons: Generate All (Stages 4 & 5), Retry Missing Voices, Auto Sync-Fit */}
          <div className="space-y-2.5">
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => handleGenerateAll()}
                disabled={isBatchGenerating || isSyncFitting || project.segments.length === 0}
                title="၄. Narrator အသံဖန်တီး & ပြောနှုန်းညှိ + ၅. 0:30 Part Sync (Anti-Drift) ကို တစ်ပါတည်း လုပ်ဆောင်မည်"
                className="flex-1 py-3.5 px-5 disabled:opacity-50 text-zinc-950 text-xs sm:text-sm font-black rounded-2xl transition-all flex items-center justify-center gap-2 shadow-2xl cursor-pointer bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 shadow-emerald-500/25 hover:scale-[1.01]"
              >
                {isBatchGenerating ? (
                  <>
                    <RotateCw className="w-4 h-4 animate-spin" />
                    <span>
                      {voiceGenStage === 5
                        ? '5. 0:30 Part Sync ညှိနေသည်...'
                        : `Generating Voices (${batchProgress?.current}/${batchProgress?.total})...`}
                    </span>
                  </>
                ) : (
                  <>
                    <Volume2 className="w-4 h-4 stroke-[2.5]" />
                    <span>Generate All Voices ({project.segments.length}) · +0:30 Sync</span>
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

            {isBatchGenerating && (
              <div className="space-y-2 p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30">
                <div className="grid grid-cols-2 gap-1.5 text-[10px] font-myanmar">
                  {[
                    { id: 4 as const, label: '၄. Narrator အသံညှိ' },
                    { id: 5 as const, label: '၅. 0:30 Part Sync' },
                  ].map((st) => {
                    const active = voiceGenStage === st.id;
                    const done = voiceGenStage !== null && voiceGenStage > st.id;
                    return (
                      <div
                        key={st.id}
                        className={`px-2.5 py-1.5 rounded-lg border flex items-center justify-between gap-1 ${
                          done
                            ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                            : active
                              ? 'bg-cyan-500/25 border-cyan-400 text-white font-bold animate-pulse'
                              : 'bg-black/35 border-white/10 text-zinc-400'
                        }`}
                      >
                        <span className="truncate">{st.label}</span>
                        {done && <Check className="w-3 h-3 text-emerald-400 shrink-0" />}
                      </div>
                    );
                  })}
                </div>
                <div className="w-full h-1.5 bg-zinc-900 rounded-full overflow-hidden border border-emerald-500/20">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 transition-all duration-300 rounded-full"
                    style={{ width: `${Math.max(5, Math.min(100, voiceGenPercent))}%` }}
                  />
                </div>
              </div>
            )}

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
                const segActiveVoice = singleVoice;
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
                      <div className="flex items-center gap-2 flex-wrap">
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
                        {seg.slotMode === 'scene_recap_30s' && (
                          <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-[9px] font-mono">
                            ⏸ {(seg.pauseBetweenParts ?? 0.18).toFixed(2)}s Pause
                          </span>
                        )}
                        {seg.sceneTitle && (
                          <span className="px-1.5 py-0.5 rounded bg-white/5 text-zinc-300 border border-white/10 text-[10px] font-myanmar max-w-[180px] truncate">
                            {seg.sceneTitle}
                          </span>
                        )}
                        {isMissingVoice && (
                          <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[9px] font-bold">
                            No Voice
                          </span>
                        )}
                      </div>

                      {/* SINGLE LOCKED VOICE INDICATOR & PLAYBACK CONTROLS */}
                      <div className="flex items-center gap-2">
                        <select
                          value={segActiveVoice}
                          onChange={(e) => handleSegmentVoiceChange(seg.id, e.target.value as VoiceOption)}
                          title="Single Narrator Voice (တစ်သံတည်း Lock)"
                          className="px-2.5 py-1 bg-zinc-900 border border-emerald-500/40 rounded-xl text-xs font-bold text-emerald-300 focus:outline-none focus:border-emerald-400 cursor-pointer max-w-[130px] truncate"
                        >
                          {ALL_VOICES.map((v) => (
                            <option key={v} value={v} className="bg-zinc-900 text-white font-sans">
                              {VOICE_PROFILES[v].name} ({VOICE_PROFILES[v].gender === 'male' ? 'M' : 'F'})
                            </option>
                          ))}
                        </select>

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

                    {seg.slotMode === 'scene_recap_30s' ? (
                      <div className="space-y-1.5">
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            value={seg.mainNarration ?? seg.myanmarTranslation}
                            onChange={(e) => {
                              const val = e.target.value;
                              const bridge = seg.bridgeNarration || '';
                              const combined = bridge ? `${val} ${bridge}`.trim() : val;
                              setProject((prev) => ({
                                ...prev,
                                segments: prev.segments.map((s) =>
                                  s.id === seg.id
                                    ? { ...s, mainNarration: val, myanmarTranslation: combined, subtitleText: combined }
                                    : s
                                ),
                              }));
                            }}
                            placeholder="Part 1 (ပင်မ ဇာတ်ကြောင်းအကျဉ်း)..."
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

                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-mono text-cyan-300 px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/25 shrink-0">
                            +{(seg.pauseBetweenParts ?? 0.18).toFixed(2)}s
                          </span>
                          <input
                            type="text"
                            value={seg.bridgeNarration || ''}
                            onChange={(e) => {
                              const bridge = e.target.value;
                              const main = seg.mainNarration ?? seg.myanmarTranslation;
                              const combined = bridge.trim() ? `${main} ${bridge}`.trim() : main;
                              setProject((prev) => ({
                                ...prev,
                                segments: prev.segments.map((s) =>
                                  s.id === seg.id
                                    ? { ...s, bridgeNarration: bridge, myanmarTranslation: combined, subtitleText: combined }
                                    : s
                                ),
                              }));
                            }}
                            placeholder="Part 2 ဆက်စကားတို (30s slot ပြည့်အောင် ဖြည့်ရန် — ဗလာဆို Auto ဖန်တီးမည်)..."
                            className="flex-1 px-3 py-1 bg-zinc-950/60 border border-cyan-500/20 rounded-xl text-[11px] font-myanmar text-cyan-100 focus:outline-none focus:border-cyan-400"
                          />
                        </div>
                      </div>
                    ) : (
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
                    )}

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
                    Gemini 24kHz Reality Voices — Single Narrator Flow Panel
                  </h3>
                  <p className="text-xs text-zinc-400 font-myanmar">
                    Tone: <span className="font-bold text-cyan-300 uppercase">{voiceTone}</span> ({voicePitch >= 0 ? `+${voicePitch}` : voicePitch}%) — တစ်သံတည်း သုံးစွဲရန် Voice Character ရွေးချယ်ပါ
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
                    const isSelected = singleVoice === vKey;
                    const cacheKey = `${vKey}_${voiceStyle}_${voiceTone}_${voicePitch}`;
                    const isPlaying = playingAudioId === `test_${cacheKey}`;
                    const isTesting = testingVoice === vKey;
                    const initialChar = profile.name.charAt(0).toUpperCase();

                    const handleSelectCharacter = () => {
                      handleApplyVoiceAllocation(vKey);
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
                              onPlay={(e) => {
                                setProject((prev) => (prev.isPlaying ? { ...prev, isPlaying: false } : prev));
                                registerPreviewAudio(e.currentTarget);
                              }}
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
                <span className="text-zinc-400">Locked Single Narrator:</span>
                <span className="font-bold text-emerald-300 font-display uppercase">
                  {currentVoiceProfile.name}
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

    </div>
  );
};
