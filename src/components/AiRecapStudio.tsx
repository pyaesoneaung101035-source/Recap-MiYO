import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Plus,
  Trash2,
  Edit3,
  Clock,
  Play,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
  Radio,
  Zap,
  Check,
  ArrowRight,
  ArrowLeft,
  Copy,
  Download,
  FileText,
  Eye,
  X,
  Volume2,
  Scissors,
  Mic,
  BookOpen,
  Languages,
  Layers,
  Upload,
  ScanText,
} from 'lucide-react';
import { ProjectState, TranscriptSegment, Step3ScriptStyle, VoiceOption } from '../types';
import {
  generateTimestampedTranscript,
  generateShortBridgeLineForSlot,
  exportToDubbingPlanJSON,
  generateBurmeseDubbingSRT,
  shortenBurmeseTextForDuration,
  countBurmeseSyllables,
  calculateMaxAllowedSyllables,
  polishBurmeseNarrationStyle,
} from '../utils/geminiPool';
import { transcribeVideoWithAssemblyAi } from '../utils/assemblyAi';
import { loadApiKeys } from '../utils/apiKeys';
import { downloadFile } from '../utils/alightMotionRenderer';
import {
  getMinuteBlocks,
  getRecapSlots,
  RECAP_SLOT_SECONDS,
  formatMinSec,
  realignSegmentsByMinuteBlocks,
  MINUTE_BLOCK_SECONDS,
} from '../utils/timingSync';
import { registerPreviewAudio } from '../utils/audioPreviewManager';
import { inspectVideoFile } from '../utils/audioExtractor';
import { VOICE_PROFILES } from '../utils/edgeTtsClient';

interface AiRecapStudioProps {
  project: ProjectState;
  setProject: React.Dispatch<React.SetStateAction<ProjectState>>;
  onSeekTo: (time: number) => void;
  onPrevStep?: () => void;
  onNextStep?: () => void;
  onJumpToStep?: (step: number) => void;
  stepNumber?: number;
}

export const AiRecapStudio: React.FC<AiRecapStudioProps> = ({
  project,
  setProject,
  onSeekTo,
  onPrevStep,
  onNextStep,
  onJumpToStep,
  stepNumber = 3,
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [customPrompt, setCustomPrompt] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editingSegId, setEditingSegId] = useState<string | null>(null);
  const [shorteningSegId, setShorteningSegId] = useState<string | null>(null);
  const [bridgingSegId, setBridgingSegId] = useState<string | null>(null);
  const [isPolishing, setIsPolishing] = useState(false);
  const [selectedPartFilter, setSelectedPartFilter] = useState<number | 'all'>('all');
  const narrationMode = project.narrationMode || 'scene_recap_30s';
  const scriptStyle: Step3ScriptStyle = project.step3ScriptStyle || 'narrator';
  const slotSeconds = project.recapSlotSeconds || RECAP_SLOT_SECONDS;
  const [selectedEngine, setSelectedEngine] = useState<'assemblyai' | 'videosubfinder_paddleocr' | 'faster_whisper' | 'gemini'>('videosubfinder_paddleocr');
  const [hasAssemblyAiKey, setHasAssemblyAiKey] = useState(false);
  const [selectedGeminiModel, setSelectedGeminiModel] = useState<string>('gemini-3.1-flash-lite');
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [showDubbingPlanModal, setShowDubbingPlanModal] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [generateStage, setGenerateStage] = useState<1 | 2 | 3 | 4 | 5 | null>(null);

  // Auto-inspect uploaded custom video when entering Step 3 if metadata missing
  useEffect(() => {
    const source = project.videoFile || project.videoUrl;
    if (!source || project.videoInspection) return;
    let cancelled = false;
    inspectVideoFile(source, project.videoName || 'custom_video.mp4')
      .then((info) => {
        if (cancelled) return;
        setProject((prev) => ({
          ...prev,
          videoDuration: prev.videoDuration > 1 ? prev.videoDuration : info.duration,
          videoInspection: info,
        }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project.videoFile, project.videoUrl, project.videoInspection, project.videoName, setProject]);

  const handleManualRealignMinuteBlocks = () => {
    if (!project.segments.length) return;
    const aligned = realignSegmentsByMinuteBlocks(
      project.segments,
      project.videoDuration || project.videoInspection?.duration || 360,
      {
        enforceSingleVoice: project.lockedVoice || 'Thiha',
        enforceSingleSpeakerLabel: true,
      }
    );
    setProject((prev) => ({
      ...prev,
      narrationMode: 'dialogue_dub',
      segments: aligned,
    }));
    setStatusMessage(
      `✓ ၃၀ စက္ကန့်စီ (0:00-0:30, 0:30-1:00...) အပိုင်းအလိုက် (${getMinuteBlocks(project.videoDuration || 360).length} Parts) အသံ + Subtitle အချိန်ကွက် ပြန်ညှိပြီးပါပြီ (No Drift)!`
    );
  };

  const selectStep3Style = (style: Step3ScriptStyle) => {
    setSelectedPartFilter('all');
    setProject((prev) => ({
      ...prev,
      step3ScriptStyle: style,
    }));
  };

  const handlePolishNarrationStyle = async () => {
    if (!project.segments.length || isPolishing || isGenerating) return;
    setIsPolishing(true);
    setErrorMessage(null);
    try {
      const polished = await polishBurmeseNarrationStyle(project.segments, (msg) =>
        setStatusMessage(msg)
      );
      setProject((prev) => ({
        ...prev,
        segments: polished,
      }));
      setStatusMessage(
        '✓ နမူနာ Video ပုံစံအတိုင်း "တယ်/ပါတယ်" ထပ်နေမှုများ လျှော့ချပြီး စိတ်ခံစားချက် (အံ့ဩ/မာန်ပါ/မေးခွန်း) Tag များ ညှိပြီးပါပြီ! အဆင့် ၄ တွင် Voice Clone ပြန်ထုတ်နိုင်ပါသည်။'
      );
    } catch (err: any) {
      setErrorMessage(`Style Polish error: ${err?.message || 'Failed to polish narration style'}`);
    } finally {
      setIsPolishing(false);
    }
  };

  const handleShortenSegment = async (seg: TranscriptSegment) => {
    if (!seg.myanmarTranslation || shorteningSegId) return;
    const slotDur = Math.max(1.0, seg.endTime - seg.startTime);
    setShorteningSegId(seg.id);
    try {
      const shortened = await shortenBurmeseTextForDuration(
        seg.myanmarTranslation,
        slotDur,
        seg.originalText
      );
      if (shortened && shortened !== seg.myanmarTranslation) {
        handleUpdateSegment(seg.id, {
          myanmarTranslation: shortened,
          subtitleText: shortened,
        });
      }
    } catch (err) {
      console.warn('Failed to shorten segment:', err);
    } finally {
      setShorteningSegId(null);
    }
  };

  const handleCopyDubbingPlanJson = () => {
    if (!project.segments.length) return;
    const jsonStr = exportToDubbingPlanJSON(project.segments);
    navigator.clipboard.writeText(jsonStr);
    setCopyFeedback('Dubbing Plan (JSON) ကူးယူပြီးပါပြီ!');
    setTimeout(() => setCopyFeedback(null), 3000);
  };

  const handleDownloadDubbingPlanJson = () => {
    if (!project.segments.length) return;
    const jsonStr = exportToDubbingPlanJSON(project.segments);
    downloadFile(jsonStr, `${project.videoName || 'video'}_dubbing_plan.json`, 'application/json');
  };

  const handleDownloadBurmeseSRT = () => {
    if (!project.segments.length) return;
    const srtStr = generateBurmeseDubbingSRT(project.segments);
    downloadFile(srtStr, `${project.videoName || 'video'}_burmese_subtitles.srt`, 'text/plain;charset=utf-8');
  };

  const parseSRTTimeToSeconds = (timeStr: string): number => {
    try {
      const clean = timeStr.replace(',', '.');
      const parts = clean.split(':');
      if (parts.length === 3) {
        const hrs = parseFloat(parts[0]);
        const mins = parseFloat(parts[1]);
        const secs = parseFloat(parts[2]);
        return hrs * 3600 + mins * 60 + secs;
      }
      return parseFloat(clean) || 0;
    } catch {
      return 0;
    }
  };

  const handleImportDubbingPlanJson = () => {
    const inputJson = prompt('တရုတ်/အင်္ဂလိပ်-မြန်မာ Dubbing Plan JSON စာသားကို ဤနေရာတွင် Paste လုပ်ပါ:');
    if (!inputJson || !inputJson.trim()) return;
    try {
      const parsed = JSON.parse(inputJson);
      if (!Array.isArray(parsed)) {
        throw new Error('Invalid JSON array format');
      }
      const importedSegments: TranscriptSegment[] = parsed.map((item: any, idx: number) => {
        const startSec = parseSRTTimeToSeconds(item.start_timestamp || '00:00:00,000');
        const endSec = parseSRTTimeToSeconds(item.end_timestamp || '00:00:05,000');
        return {
          id: String(item.segment_index || idx + 1),
          startTime: startSec,
          endTime: endSec,
          duration: item.target_duration_seconds || parseFloat((endSec - startSec).toFixed(2)),
          speaker: item.speaker_identity || 'Translator (ဘာသာပြန်)',
          originalText: item.original_chinese_dialogue || '',
          myanmarTranslation: item.natural_conversational_burmese || '',
          subtitleText: item.burmese_subtitle_text || item.natural_conversational_burmese || '',
          emotion: item.speaking_emotion_and_delivery || 'Natural conversational',
          isOnScreen: item.is_speaker_on_screen !== false,
          lipSyncNote: item.lip_sync_note || 'Imported from translation plan',
          scriptStyle: 'translation' as const,
          voice: project.lockedVoice || 'Thiha',
          tone: project.voiceTone || 'natural',
          pitch: project.voicePitch ?? 0,
        };
      });
      setProject((prev) => ({
        ...prev,
        segments: importedSegments,
        step3ScriptStyle: 'translation',
      }));
      setCopyFeedback('Dubbing Plan JSON အောင်မြင်စွာ Import လုပ်ပြီးပါပြီ!');
      setTimeout(() => setCopyFeedback(null), 3500);
    } catch (err: any) {
      alert('JSON format မမှန်ကန်ပါ။ ကျေးဇူးပြု၍ JSON array အမှန်ကို ထည့်သွင်းပါ။ (' + err.message + ')');
    }
  };

  // Track live elapsed seconds while Step 3 pipeline is running
  useEffect(() => {
    if (!isGenerating) {
      setElapsedSeconds(0);
      return;
    }
    const startAt = Date.now();
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isGenerating]);

  const handleGenerateShortBridge = async (seg: TranscriptSegment) => {
    if (bridgingSegId) return;
    const mainText = (seg.mainNarration || seg.myanmarTranslation || '').trim();
    if (!mainText) return;

    const slotDur = Math.max(8, seg.endTime - seg.startTime);
    const estMainSec = countBurmeseSyllables(mainText) / 3.5;
    const remainingSec = Math.max(4.0, slotDur - estMainSec - (seg.pauseBetweenParts ?? 0.18));

    setBridgingSegId(seg.id);
    setStatusMessage(`✨ Slot (${formatMinSec(seg.startTime)}–${formatMinSec(seg.endTime)}) အတွက် 0.18s Pause နောက်ဆက်တွဲ ဆက်စကားတို ဖန်တီးနေသည်...`);
    try {
      const bridge = await generateShortBridgeLineForSlot(
        mainText,
        remainingSec,
        seg.originalText || seg.sceneTitle || '',
        seg.bridgeNarration || ''
      );
      const combined = bridge ? `${mainText} ${bridge}`.trim() : mainText;
      handleUpdateSegment(seg.id, {
        slotMode: 'scene_recap_30s',
        mainNarration: mainText,
        bridgeNarration: bridge,
        pauseBetweenParts: seg.pauseBetweenParts ?? 0.18,
        myanmarTranslation: combined,
        subtitleText: combined,
        syllableCount: countBurmeseSyllables(combined),
        audioUrl: undefined,
        audioDuration: undefined,
      });
      setStatusMessage('✓ မြင်ကွင်းနှင့်ကိုက်ညီသော ဆက်စကားတို (0.18s Pause) ထပ်ဖြည့်ပြီးပါပြီ!');
    } catch (err) {
      console.warn('Bridge generation error:', err);
    } finally {
      setBridgingSegId(null);
    }
  };

  const getEngineShortLabel = (eng: 'assemblyai' | 'videosubfinder_paddleocr' | 'faster_whisper' | 'gemini') => {
    switch (eng) {
      case 'assemblyai':
        return 'Assembly';
      case 'videosubfinder_paddleocr':
        return 'Vd+OCR';
      case 'faster_whisper':
        return 'Faster whisper';
      case 'gemini':
        return 'Gemini';
      default:
        return 'Vd+OCR';
    }
  };

  const getEngineFullLabel = (eng: 'assemblyai' | 'videosubfinder_paddleocr' | 'faster_whisper' | 'gemini') => {
    switch (eng) {
      case 'assemblyai':
        return 'Assembly Generate';
      case 'videosubfinder_paddleocr':
        return 'VideoSubFinder + PaddleOCR';
      case 'faster_whisper':
        return 'Faster-Whisper Generate';
      case 'gemini':
        return 'Gemini Engine';
      default:
        return 'VideoSubFinder + PaddleOCR';
    }
  };

  useEffect(() => {
    const keys = loadApiKeys();
    setHasAssemblyAiKey(Boolean(keys.assemblyAiKey));
  }, []);

  const videoParts = narrationMode === 'scene_recap_30s'
    ? getRecapSlots(project.videoDuration || 360, slotSeconds)
    : getMinuteBlocks(project.videoDuration || 60);
  const totalParts = videoParts.length;

  const displayedSegments = project.segments.filter((s) => {
    if (selectedPartFilter === 'all') return true;
    const part = videoParts[selectedPartFilter - 1];
    if (!part) return true;
    const isLastPart = part.partNumber === totalParts;
    return isLastPart
      ? s.startTime >= part.startSec && s.startTime <= part.endSec + 0.5
      : s.startTime >= part.startSec && s.startTime < part.endSec;
  });

  const handleGenerateScript = async (
    overrideStyle?: Step3ScriptStyle,
    overrideEngine?: 'assemblyai' | 'videosubfinder_paddleocr' | 'faster_whisper' | 'gemini'
  ) => {
    const activeStyle: Step3ScriptStyle = overrideStyle || scriptStyle;
    const activeEngine = overrideEngine || selectedEngine;

    if (overrideStyle) {
      setSelectedPartFilter('all');
      setProject((prev) => ({
        ...prev,
        step3ScriptStyle: activeStyle,
      }));
    }

    if (overrideEngine) {
      setSelectedEngine(overrideEngine);
    }

    const videoSource = project.videoFile || project.videoUrl;
    if (!videoSource) {
      setErrorMessage('ကျေးဇူးပြု၍ စာသားထုတ်ယူလိုသော Custom Video ကို အရင် တင်ပေးပါ။');
      return;
    }

    if (activeEngine === 'assemblyai' && !hasAssemblyAiKey) {
      const msg = 'AssemblyAI API Key မတွေ့ရှိပါ။ ကျေးဇူးပြု၍ Step 1 တွင် AssemblyAI Key (32-digit Token) ကို ထည့်သွင်းပေးပါ။';
      setErrorMessage(msg);
      return;
    }

    const styleName =
      activeStyle === 'narrator'
        ? 'Narrator'
        : activeStyle === 'story'
          ? 'Story'
          : 'Translation';

    const engineName = getEngineShortLabel(activeEngine);
    const engineFull = getEngineFullLabel(activeEngine);

    setIsGenerating(true);
    setGenerateStage(1);
    setProgressPercent(4);
    setStatusMessage(`၁. [${engineName}] မူရင်းဗီဒီယို ကြာချိန်၊ ရုပ်ထွက်နှင့် အသံလှိုင်းကို စစ်ဆေးနေပါသည်...`);
    setErrorMessage(null);

    const lockedVoice = project.lockedVoice || 'Thiha';
    const narratorTone = project.voiceTone || 'natural';
    const narratorPitch = project.voicePitch ?? 0;

    try {
      const inspection = await inspectVideoFile(
        videoSource,
        project.videoName || 'custom_video.mp4'
      );
      const totalDuration = Math.max(
        inspection.duration || project.videoDuration || MINUTE_BLOCK_SECONDS,
        1
      );
      setProject((prev) => ({
        ...prev,
        videoDuration: totalDuration,
        videoInspection: inspection,
      }));

      setProgressPercent(12);
      setStatusMessage(
        `၁. [${engineName}] Video စစ်ပြီး (${inspection.resolution} · ${formatMinSec(totalDuration)}) — စာသား စတင်ထုတ်ယူနေပါသည်...`
      );

      let rawSegments: TranscriptSegment[] = [];

      if (activeEngine === 'assemblyai') {
        setGenerateStage(1);
        setStatusMessage('၁. [Assembly] အသံဖိုင်မှ Speech-to-Text စတင် ထုတ်ယူနေပါသည်...');
        setProgressPercent(25);
        rawSegments = await transcribeVideoWithAssemblyAi(
          project.videoFile || project.videoUrl!,
          {
            onProgress: (msg) => {
              setStatusMessage(msg);
              if (activeStyle === 'translation') {
                if (msg.includes('Gemini') || msg.includes('ဘာသာပြန်') || msg.includes('JSON')) {
                  setGenerateStage(2);
                  setProgressPercent(65);
                }
              } else {
                if (msg.includes('Gemini')) {
                  setGenerateStage(2);
                  setProgressPercent(40);
                } else if (msg.includes('Timeline') || msg.includes('အခိုက်အတန့်')) {
                  setGenerateStage(3);
                  setProgressPercent(60);
                } else if (msg.includes('ချိန်ညှိ') || msg.includes('realign')) {
                  setGenerateStage(4);
                  setProgressPercent(80);
                }
              }
            },
            scriptStyle: activeStyle,
          }
        );
      } else {
        const customPromptContext =
          activeEngine === 'gemini'
            ? customPrompt.trim()
            : activeEngine === 'videosubfinder_paddleocr'
              ? `${customPrompt ? customPrompt + ' | ' : ''}VideoSubFinder + PaddleOCR Hardsub Extraction: Perform OCR-level text detection on all on-screen burnt-in subtitles, captions, and text overlays in the video frames. Extract the exact text shown on screen with frame timestamps (start/end), transcribe original subtitle text into originalText, and translate into Burmese in text.`
              : `${customPrompt ? customPrompt + ' | ' : ''}Faster-Whisper high-speed STT: Transcribe all spoken speech quickly and accurately with precise start/end timestamps.`;

        rawSegments = await generateTimestampedTranscript(
          project.videoName || 'Uploaded Video',
          totalDuration,
          customPromptContext,
          project.videoFile,
          project.videoUrl,
          (msg, pct = 20) => {
            if (activeStyle === 'translation') {
              const st: 1 | 2 = pct < 50 ? 1 : 2;
              setGenerateStage(st);
            } else {
              const st: 1 | 2 | 3 | 4 | 5 =
                pct < 20 ? 1 : pct < 45 ? 2 : pct < 70 ? 3 : pct < 90 ? 4 : 5;
              setGenerateStage(st);
            }
            setStatusMessage(msg);
            setProgressPercent(Math.min(92, Math.round(12 + (pct / 100) * 80)));
          },
          selectedGeminiModel,
          activeStyle,
          activeEngine
        );
      }

      setGenerateStage(activeStyle === 'translation' ? 2 : 5);
      setProgressPercent(96);
      const sorted = [...rawSegments].sort((a, b) => a.startTime - b.startTime);
      const scriptSegments: TranscriptSegment[] = sorted.map((s, idx) => {
        const start = Math.max(0, s.startTime);
        const end = Math.max(start + 0.5, s.endTime);
        const dur = parseFloat((end - start).toFixed(2));
        const blockPart = Math.floor(start / MINUTE_BLOCK_SECONDS) + 1;
        return {
          ...s,
          startTime: parseFloat(start.toFixed(2)),
          endTime: parseFloat(end.toFixed(2)),
          originalStartTime: s.originalStartTime ?? parseFloat(start.toFixed(2)),
          originalEndTime: s.originalEndTime ?? parseFloat(end.toFixed(2)),
          duration: s.duration || dur,
          slotMode: 'dialogue_dub' as const,
          scriptStyle: activeStyle,
          voice: lockedVoice,
          tone: narratorTone,
          pitch: narratorPitch,
          speaker:
            activeStyle === 'translation'
              ? (s.speaker || 'Translator (ဘာသာပြန်)')
              : activeStyle === 'story'
                ? 'Storyteller (ဇာတ်လမ်းပြောသူ)'
                : 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
          minutePartIndex: blockPart,
          sceneShotId: s.sceneShotId || `Part ${blockPart} · Shot ${idx + 1}`,
          syllableCount: countBurmeseSyllables(s.myanmarTranslation || ''),
          audioUrl: undefined,
          audioDuration: undefined,
        };
      });

      setProgressPercent(100);
      setProject((prev) => ({
        ...prev,
        narrationMode: 'dialogue_dub',
        step3ScriptStyle: activeStyle,
        lockedVoice,
        segments: scriptSegments,
      }));

      const minuteBlocks = getMinuteBlocks(totalDuration);
      setStatusMessage(
        `🎉 [${styleName} + ${engineFull}] အဆင့်များ အောင်မြင်စွာ ပြီးစီးပါပြီ! 0:30 Parts ${minuteBlocks.length} ပိုင်း (${scriptSegments.length} Segments) စာသား ထုတ်ယူပြီးပါပြီ — အဆင့် ၄ (Generate All Voices) တွင် အသံ + 0:30 Sync ဆက်လုပ်ပါ။`
      );
    } catch (err: any) {
      console.error('Failed to generate script:', err);
      setErrorMessage(err.message || 'AI စာသားထုတ်လုပ်မှု မအောင်မြင်ပါ။ API Key ကို စစ်ဆေးပါ။');
    } finally {
      setProgressPercent(100);
      setIsGenerating(false);
      setGenerateStage(null);
    }
  };

  const handleAddSegment = () => {
    const lastSeg = project.segments[project.segments.length - 1];
    const newStart = lastSeg ? lastSeg.endTime : 0;
    const newEnd = narrationMode === 'scene_recap_30s' ? newStart + slotSeconds : newStart + 4;

    const newSeg: TranscriptSegment = {
      id: `seg_${Date.now()}`,
      startTime: parseFloat(newStart.toFixed(1)),
      endTime: parseFloat(newEnd.toFixed(1)),
      originalStartTime: parseFloat(newStart.toFixed(1)),
      originalEndTime: parseFloat(newEnd.toFixed(1)),
      originalText: narrationMode === 'scene_recap_30s' ? 'မြင်ကွင်းအပိုင်းသစ်' : 'New dialogue',
      myanmarTranslation: 'စာသားအသစ် ထည့်ရန်...',
      mainNarration: narrationMode === 'scene_recap_30s' ? 'စာသားအသစ် ထည့်ရန်...' : undefined,
      bridgeNarration: narrationMode === 'scene_recap_30s' ? '' : undefined,
      pauseBetweenParts: narrationMode === 'scene_recap_30s' ? 0.18 : undefined,
      slotMode: narrationMode,
      scriptStyle,
      voice: project.lockedVoice || 'Thiha',
      speaker:
        scriptStyle === 'story'
          ? 'Storyteller (ဇာတ်လမ်းပြောသူ)'
          : scriptStyle === 'translation'
            ? 'Translator (ဘာသာပြန်)'
            : 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
    };

    setProject((prev) => ({
      ...prev,
      segments: [...prev.segments, newSeg],
    }));
    setEditingSegId(newSeg.id);
  };

  const handleUpdateSegment = (id: string, updates: Partial<TranscriptSegment>) => {
    setProject((prev) => ({
      ...prev,
      segments: prev.segments.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    }));
  };

  const handleDeleteSegment = (id: string) => {
    setProject((prev) => ({
      ...prev,
      segments: prev.segments.filter((s) => s.id !== id),
    }));
  };

  return (
    <div className="glass-panel rounded-2xl p-6 shadow-2xl space-y-6">
      {/* Title Header with Step Navigation Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-400 to-teal-400 text-zinc-950 font-black flex items-center justify-center text-xs shadow-lg">
            {stepNumber}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white font-display tracking-tight flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <span>အဆင့် {stepNumber} — AI Narrator Script & Dubbing Engine (Gemini API)</span>
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 font-mono text-[10px] font-bold">
                Gemini API Natural Localization
              </span>
            </div>
            <p className="text-xs text-zinc-400 font-myanmar mt-0.5">
              Custom Upload Video ကို အဆင့် (၁ မှ ၃) အတိုင်း စစ်ဆေး + 0:30 AI/Whisper Parts ဖြင့် တိကျစွာ ဘာသာပြန် + Single Narrator စာသား ထုတ်ပေးပါမည်။ (Narrator အသံညှိ & 0:30 Part Sync ကို အဆင့် ၄ Generate All Voices တွင် ဆက်လုပ်ပါမည်။)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {onPrevStep && (
            <button
              onClick={onPrevStep}
              className="px-3.5 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-semibold rounded-xl transition-all border border-white/10 flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>ရှေ့အဆင့်</span>
            </button>
          )}
          {onNextStep && (
            <button
              onClick={onNextStep}
              className="px-5 py-2.5 bg-gradient-to-r from-sky-400 to-teal-400 hover:opacity-90 text-zinc-950 font-black text-xs rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-sky-500/20 cursor-pointer active:scale-95"
            >
              <span>နောက်အဆင့် (TTS Studio)</span>
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          )}
        </div>
      </div>

      {/* 3 CORE USER-DEFINED STEPS IN STEP 3:
          ၁။ ထုတ်ချင်တဲ့ ပုံစံရွေး (Narrator, Story, Translation)
          ၂။ Video TTS ထုတ်မည့် Engine (Assembly, Vd+OCR, Faster whisper)
          ၃။ Generate မည် (Prompt, Settings, Generate Button)
      */}
      <div className="space-y-4">
        {/* ၁။ ထုတ်ချင်တဲ့ ပုံစံရွေး */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-cyan-400 text-zinc-950 flex items-center justify-center text-xs font-black shadow">
                ၁
              </span>
              <h3 className="text-sm font-black text-white font-display flex items-center gap-2">
                <span>ထုတ်ချင်တဲ့ ပုံစံရွေး</span>
                <span className="text-xs font-normal text-zinc-400 font-myanmar">(Narrator / Story / Translation)</span>
              </h3>
            </div>
            <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-bold">
              Active: {scriptStyle.toUpperCase()}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* 1. NARRATOR */}
            <div
              onClick={() => selectStep3Style('narrator')}
              className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                scriptStyle === 'narrator'
                  ? 'bg-gradient-to-br from-cyan-500/20 via-teal-500/10 to-black/60 border-cyan-400 shadow-xl ring-2 ring-cyan-400/50'
                  : 'bg-black/40 border-white/10 hover:border-white/25 hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                    scriptStyle === 'narrator' ? 'bg-cyan-400 text-zinc-950 font-black shadow-md' : 'bg-cyan-400/20 text-cyan-300 border border-cyan-400/40'
                  }`}>
                    <Mic className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white font-display">1. Narrator</h4>
                    <span className="text-[10px] text-cyan-300 font-mono">Spoken Voiceover</span>
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                  scriptStyle === 'narrator' ? 'bg-cyan-400 border-cyan-400 text-zinc-950' : 'border-white/30'
                }`}>
                  {scriptStyle === 'narrator' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>
              </div>
              <p className="text-[11px] text-zinc-300 font-myanmar leading-relaxed">
                Video ကို စာအုပ်ဆန်ဆန် စာသားမဟုတ်ဘဲ အပြင်မှာ စကားပြောနေတဲ့အတိုင်း တကယ့် Narrator အသံထွက်စေမည့် သဘာဝစကားပြော စာသားထုတ်ပေးပါမည်။
              </p>
              <div className="pt-1">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  scriptStyle === 'narrator' ? 'bg-cyan-400/30 text-cyan-200 border border-cyan-400/50' : 'bg-white/5 text-zinc-400'
                }`}>
                  {scriptStyle === 'narrator' ? '✓ ရွေးချယ်ထားသည်' : 'ရွေးချယ်ရန် နှိပ်ပါ'}
                </span>
              </div>
            </div>

            {/* 2. STORY */}
            <div
              onClick={() => selectStep3Style('story')}
              className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                scriptStyle === 'story'
                  ? 'bg-gradient-to-br from-emerald-500/20 via-teal-500/10 to-black/60 border-emerald-400 shadow-xl ring-2 ring-emerald-400/50'
                  : 'bg-black/40 border-white/10 hover:border-white/25 hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                    scriptStyle === 'story' ? 'bg-emerald-400 text-zinc-950 font-black shadow-md' : 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/40'
                  }`}>
                    <BookOpen className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white font-display">2. Story</h4>
                    <span className="text-[10px] text-emerald-300 font-mono">Storytelling Narrative</span>
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                  scriptStyle === 'story' ? 'bg-emerald-400 border-emerald-400 text-zinc-950' : 'border-white/30'
                }`}>
                  {scriptStyle === 'story' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>
              </div>
              <p className="text-[11px] text-zinc-300 font-myanmar leading-relaxed">
                Video တစ်ခုလုံးကို လူတစ်ယောက် Story ပြောပြနေသလိုမျိုး ဇာတ်အိမ်ဖွဲ့ပြီး ဆွဲဆောင်မှုရှိတဲ့ ဇာတ်လမ်းဆန်ဆန် စာသားထုတ်ပေးပါမည်။
              </p>
              <div className="pt-1">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  scriptStyle === 'story' ? 'bg-emerald-400/30 text-emerald-200 border border-emerald-400/50' : 'bg-white/5 text-zinc-400'
                }`}>
                  {scriptStyle === 'story' ? '✓ ရွေးချယ်ထားသည်' : 'ရွေးချယ်ရန် နှိပ်ပါ'}
                </span>
              </div>
            </div>

            {/* 3. TRANSLATION */}
            <div
              onClick={() => selectStep3Style('translation')}
              className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                scriptStyle === 'translation'
                  ? 'bg-gradient-to-br from-amber-500/20 via-orange-500/10 to-black/60 border-amber-400 shadow-xl ring-2 ring-amber-400/50'
                  : 'bg-black/40 border-white/10 hover:border-white/25 hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                    scriptStyle === 'translation' ? 'bg-amber-400 text-zinc-950 font-black shadow-md' : 'bg-amber-400/20 text-amber-300 border border-amber-400/40'
                  }`}>
                    <Languages className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white font-display">3. Translation</h4>
                    <span className="text-[10px] text-amber-300 font-mono">Direct Subtitle & Speech</span>
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                  scriptStyle === 'translation' ? 'bg-amber-400 border-amber-400 text-zinc-950' : 'border-white/30'
                }`}>
                  {scriptStyle === 'translation' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>
              </div>
              <p className="text-[11px] text-zinc-300 font-myanmar leading-relaxed">
                Video ထဲက Chinese/English Subtitle နှင့် Voice အသံတွေကို အကုန်အစင် ဖတ်ယူပြီး မူရင်းအတိုင်း တိကျတဲ့ မြန်မာဘာသာပြန် စာသားထုတ်ပေးပါမည်။
              </p>
              <div className="pt-1">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  scriptStyle === 'translation' ? 'bg-amber-400/30 text-amber-200 border border-amber-400/50' : 'bg-white/5 text-zinc-400'
                }`}>
                  {scriptStyle === 'translation' ? '✓ ရွေးချယ်ထားသည်' : 'ရွေးချယ်ရန် နှိပ်ပါ'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ၂။ Video TTS ထုတ်မည့် Engine */}
        <div className="space-y-2.5 pt-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-teal-400 text-zinc-950 flex items-center justify-center text-xs font-black shadow">
                ၂
              </span>
              <h3 className="text-sm font-black text-white font-display flex items-center gap-2">
                <span>Video TTS ထုတ်မည့် Engine</span>
                <span className="text-xs font-normal text-zinc-400 font-myanmar">(Assembly, Vd+OCR, Faster whisper, Gemini)</span>
              </h3>
            </div>
            <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-teal-500/15 text-teal-300 border border-teal-500/30 font-bold">
              Engine: {getEngineShortLabel(selectedEngine)}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {/* 1. Assembly */}
            <div
              onClick={() => setSelectedEngine('assemblyai')}
              className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                selectedEngine === 'assemblyai'
                  ? 'bg-blue-500/20 border-blue-400 shadow-xl ring-2 ring-blue-400/50'
                  : 'bg-black/40 border-white/10 hover:border-white/25 hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                    selectedEngine === 'assemblyai' ? 'bg-blue-400 text-zinc-950 font-black shadow-md' : 'bg-blue-400/20 text-blue-300 border border-blue-400/40'
                  }`}>
                    <Radio className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white font-display">Assembly</h4>
                    <span className="text-[10px] text-blue-300 font-mono">Assembly Generate</span>
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                  selectedEngine === 'assemblyai' ? 'bg-blue-400 border-blue-400 text-zinc-950' : 'border-white/30'
                }`}>
                  {selectedEngine === 'assemblyai' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>
              </div>
              <p className="text-[11px] text-zinc-300 font-myanmar leading-relaxed">
                AssemblyAI API ဖြင့် Speech-to-Text ပြုလုပ်ပြီး Gemini API မှ မြန်မာဘာသာပြန်ဆို၍ စာသား ထုတ်ပေးပါမည်။
              </p>
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  selectedEngine === 'assemblyai' ? 'bg-blue-400/30 text-blue-200 border border-blue-400/50' : 'bg-white/5 text-zinc-400'
                }`}>
                  {selectedEngine === 'assemblyai' ? '✓ ရွေးချယ်ထားသည်' : 'ရွေးချယ်ရန် နှိပ်ပါ'}
                </span>
                {hasAssemblyAiKey ? (
                  <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                    Connected
                  </span>
                ) : (
                  <span className="text-[9px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                    Requires Token
                  </span>
                )}
              </div>
            </div>

            {/* 2. Vd+OCR */}
            <div
              onClick={() => setSelectedEngine('videosubfinder_paddleocr')}
              className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                selectedEngine === 'videosubfinder_paddleocr'
                  ? 'bg-cyan-500/20 border-cyan-400 shadow-xl ring-2 ring-cyan-400/50'
                  : 'bg-black/40 border-white/10 hover:border-white/25 hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                    selectedEngine === 'videosubfinder_paddleocr' ? 'bg-cyan-400 text-zinc-950 font-black shadow-md' : 'bg-cyan-400/20 text-cyan-300 border border-cyan-400/40'
                  }`}>
                    <ScanText className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white font-display">Vd+OCR</h4>
                    <span className="text-[10px] text-cyan-300 font-mono">VideoSubFinder + PaddleOCR</span>
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                  selectedEngine === 'videosubfinder_paddleocr' ? 'bg-cyan-400 border-cyan-400 text-zinc-950' : 'border-white/30'
                }`}>
                  {selectedEngine === 'videosubfinder_paddleocr' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>
              </div>
              <p className="text-[11px] text-zinc-300 font-myanmar leading-relaxed">
                Custom Upload Video မှ Subtitle စာတန်းထိုးများကို Hardsub OCR ဖြင့် ရှာဖွေဖတ်ယူပြီး Transcript နှင့် မြန်မာဘာသာပြန် ထုတ်ပေးပါမည်။
              </p>
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  selectedEngine === 'videosubfinder_paddleocr' ? 'bg-cyan-400/30 text-cyan-200 border border-cyan-400/50' : 'bg-white/5 text-zinc-400'
                }`}>
                  {selectedEngine === 'videosubfinder_paddleocr' ? '✓ ရွေးချယ်ထားသည်' : 'ရွေးချယ်ရန် နှိပ်ပါ'}
                </span>
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold">
                  ★ Subtitle OCR (Recommended)
                </span>
              </div>
            </div>

            {/* 3. Faster whisper */}
            <div
              onClick={() => setSelectedEngine('faster_whisper')}
              className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                selectedEngine === 'faster_whisper'
                  ? 'bg-emerald-500/20 border-emerald-400 shadow-xl ring-2 ring-emerald-400/50'
                  : 'bg-black/40 border-white/10 hover:border-white/25 hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                    selectedEngine === 'faster_whisper' ? 'bg-emerald-400 text-zinc-950 font-black shadow-md' : 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/40'
                  }`}>
                    <Zap className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white font-display">Faster whisper</h4>
                    <span className="text-[10px] text-emerald-300 font-mono">Faster-Whisper Generate</span>
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                  selectedEngine === 'faster_whisper' ? 'bg-emerald-400 border-emerald-400 text-zinc-950' : 'border-white/30'
                }`}>
                  {selectedEngine === 'faster_whisper' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>
              </div>
              <p className="text-[11px] text-zinc-300 font-myanmar leading-relaxed">
                Faster-whisper (CPU mode int8) ဖြင့် အသံဖိုင်မှ Speech-to-Text အမြန် ပြုလုပ်ပြီး Gemini ဖြင့် မြန်မာဘာသာပြန်ဆို စာသားထုတ်ပေးပါမည်။
              </p>
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  selectedEngine === 'faster_whisper' ? 'bg-emerald-400/30 text-emerald-200 border border-emerald-400/50' : 'bg-white/5 text-zinc-400'
                }`}>
                  {selectedEngine === 'faster_whisper' ? '✓ ရွေးချယ်ထားသည်' : 'ရွေးချယ်ရန် နှိပ်ပါ'}
                </span>
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                  High-Speed CPU
                </span>
              </div>
            </div>

            {/* 4. Gemini */}
            <div
              onClick={() => setSelectedEngine('gemini')}
              className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                selectedEngine === 'gemini'
                  ? 'bg-violet-500/20 border-violet-400 shadow-xl ring-2 ring-violet-400/50'
                  : 'bg-black/40 border-white/10 hover:border-white/25 hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                    selectedEngine === 'gemini' ? 'bg-violet-400 text-zinc-950 font-black shadow-md' : 'bg-violet-400/20 text-violet-300 border border-violet-400/40'
                  }`}>
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white font-display">Gemini</h4>
                    <span className="text-[10px] text-violet-300 font-mono">Gemini Engine (Visual Sync)</span>
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                  selectedEngine === 'gemini' ? 'bg-violet-400 border-violet-400 text-zinc-950' : 'border-white/30'
                }`}>
                  {selectedEngine === 'gemini' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>
              </div>
              <p className="text-[11px] text-zinc-300 font-myanmar leading-relaxed">
                Video ထဲက Action ပြောင်းလဲမှု + မျက်နှာအမူအရာအတိုင်း ကွက်တိကိုက်ညီသော Scene-by-Scene မြန်မာ Narrator Script (Prompt အသေ) ဖြင့် ထုတ်ပေးပါမည်။
              </p>
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  selectedEngine === 'gemini' ? 'bg-violet-400/30 text-violet-200 border border-violet-400/50' : 'bg-white/5 text-zinc-400'
                }`}>
                  {selectedEngine === 'gemini' ? '✓ ရွေးချယ်ထားသည်' : 'ရွေးချယ်ရန် နှိပ်ပါ'}
                </span>
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30 font-bold">
                  Action-Synced Prompt
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ၃။ Generate မည် */}
        <div className="p-4 rounded-2xl bg-black/60 border border-cyan-500/30 space-y-3 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-gradient-to-tr from-sky-400 to-teal-400 text-zinc-950 flex items-center justify-center text-xs font-black shadow">
                ၃
              </span>
              <div>
                <h3 className="text-sm font-black text-white font-display">
                  Generate မည်
                </h3>
                <span className="text-[11px] text-zinc-400 font-myanmar">
                  ၁၊ ၂ ရွေးထားသည့်အတိုင်း အတိအကျ စတင်ထုတ်ယူပါမည်
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-bold font-myanmar">
                ၁. {scriptStyle === 'narrator' ? 'Narrator' : scriptStyle === 'story' ? 'Story' : 'Translation'}
              </span>
              <span className="text-zinc-500">+</span>
              <span className="px-2.5 py-1 rounded-lg bg-teal-500/10 border border-teal-500/30 text-teal-300 text-xs font-bold font-myanmar">
                ၂. {getEngineShortLabel(selectedEngine)}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <input
              type="text"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="အထူး ညွှန်ကြားချက်များ (ဥပမာ- ဟာသဆန်ဆန် ပြန်ဆိုပေးပါ / ရင်ခုန်ဖွယ် ဇာတ်လမ်းဆန်ဆန်)..."
              className="glass-input flex-1 min-w-[200px] px-4 py-2.5 rounded-xl text-xs font-myanmar placeholder-zinc-500"
            />

            {/* Single Narrator Voice Selector right beside Generate */}
            <select
              value={project.lockedVoice || 'Thiha'}
              onChange={(e) =>
                setProject((prev) => ({ ...prev, lockedVoice: e.target.value as VoiceOption }))
              }
              className="px-3 py-2.5 bg-zinc-900 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 font-semibold focus:outline-none cursor-pointer shrink-0"
              title="Single Burmese Narrator Voice"
            >
              {Object.keys(VOICE_PROFILES).map((vKey) => {
                const prof = VOICE_PROFILES[vKey as VoiceOption];
                return (
                  <option key={vKey} value={vKey} className="bg-zinc-900 text-white">
                    🎙️ {prof.myanmarName} ({prof.name})
                  </option>
                );
              })}
            </select>

            <select
              value={selectedGeminiModel}
              onChange={(e) => setSelectedGeminiModel(e.target.value)}
              className="px-3 py-2.5 bg-zinc-900 border border-cyan-500/30 rounded-xl text-xs text-cyan-300 font-mono font-semibold focus:outline-none cursor-pointer shrink-0"
              title="Gemini Model Selection"
            >
              <option value="gemini-3.1-flash-lite">⚡ Gemini 3.1 Flash Lite (Ultra Fast &amp; Recommended)</option>
              <option value="gemini-3.5-flash-lite">⚡ Gemini 3.5 Flash Lite (Fast &amp; Low Latency)</option>
              <option value="gemini-4-hydrogen">🧠 Gemini 4 Hydrogen (High Accuracy Reasoning)</option>
            </select>

            <button
              onClick={() => handleGenerateScript()}
              disabled={isGenerating}
              className="px-6 py-2.5 bg-gradient-to-r from-sky-400 via-cyan-400 to-teal-400 hover:opacity-90 disabled:opacity-50 text-zinc-950 font-black text-xs rounded-xl transition-all shadow-xl shadow-cyan-500/25 flex items-center gap-2 cursor-pointer active:scale-95 shrink-0"
              title="၁။ ပုံစံ + ၂။ Engine အတိုင်း အတိအကျ Generate လုပ်မည်"
            >
              {isGenerating ? (
                <RotateCw className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 text-zinc-950 stroke-[2.5]" />
              )}
              <span>
                ✨ Generate (၁. {scriptStyle === 'narrator' ? 'Narrator' : scriptStyle === 'story' ? 'Story' : 'Translation'} + ၂. {getEngineShortLabel(selectedEngine)})
              </span>
            </button>
          </div>
        </div>

        {/* Live Percentage Progress Bar & Stage Tracker */}
        {isGenerating && (
          <div className="space-y-2.5 p-3.5 rounded-xl bg-cyan-950/40 border border-cyan-500/30 backdrop-blur-md">
            <div className="flex items-center justify-between text-xs font-mono font-bold gap-2">
              <span className="text-cyan-300 flex items-center gap-1.5 font-myanmar">
                <RotateCw className="w-3.5 h-3.5 animate-spin text-cyan-400 shrink-0" />
                <span>{statusMessage || 'AI Processing Video Chunks...'}</span>
              </span>
              <span className="text-cyan-400 shrink-0">
                {Math.round(progressPercent)}% ({elapsedSeconds}s)
              </span>
            </div>

            {/* Inline Stage Indicators inside Step 3 Generate Progress */}
            <div className={`grid grid-cols-1 ${scriptStyle === 'translation' ? 'sm:grid-cols-2' : 'sm:grid-cols-5'} gap-1.5 text-[10px] font-myanmar`}>
              {(scriptStyle === 'translation'
                ? [
                    { id: 1 as const, label: `၁. ${getEngineFullLabel(selectedEngine)}` },
                    { id: 2 as const, label: '၂. Gemini Translate' },
                  ]
                : [
                    { id: 1 as const, label: `၁. ${getEngineFullLabel(selectedEngine)}` },
                    { id: 2 as const, label: '၂. Gemini Translate' },
                    { id: 3 as const, label: '၃. Video & STT' },
                    { id: 4 as const, label: '၄. အချိန်ခွဲ ဘာသာပြန်' },
                    { id: 5 as const, label: scriptStyle === 'story' ? '၅. Story စာသား' : '၅. Narrator စာသား' },
                  ]
              ).map((st) => {
                const active = generateStage === st.id;
                const done = generateStage !== null && generateStage > st.id;
                return (
                  <div
                    key={st.id}
                    className={`px-2 py-1 rounded-lg border flex items-center justify-between gap-1 ${
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

            {/* Progress Bar Track */}
            <div className="w-full h-2 bg-zinc-900 rounded-full overflow-hidden border border-cyan-500/20">
              <div
                className="h-full bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 transition-all duration-300 rounded-full shadow-lg shadow-cyan-400/50"
                style={{ width: `${Math.max(5, Math.min(100, progressPercent))}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono">
              <span>⚡ {selectedGeminiModel} · {getEngineFullLabel(selectedEngine)} ({scriptStyle.toUpperCase()})</span>
              <span>100% ရောက်ရှိလျှင် ပြီးဆုံးပါမည်</span>
            </div>
          </div>
        )}

        {statusMessage && !isGenerating && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-myanmar">{statusMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="font-myanmar">{errorMessage}</span>
          </div>
        )}
      </div>

      {/* TTX Success & Proceed Card */}
      {project.segments.length > 0 && !isGenerating && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-zinc-900/60 to-cyan-950/40 border border-emerald-500/30 text-xs">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <span className="font-bold text-white font-myanmar text-sm block">
                ✓ {scriptStyle === 'story' ? 'Story' : scriptStyle === 'translation' ? 'Translation' : 'Narrator'} စာသား + 0:30 စီ {totalParts} ပိုင်း ({project.segments.length} Segments) အောင်မြင်စွာ ထွက်ရှိပါပြီ
              </span>
              <span className="text-[11px] text-zinc-300 font-myanmar">
                {project.videoInspection
                  ? `Video: ${project.videoInspection.resolution} · ${formatMinSec(project.videoInspection.duration)} · အဆင့် ၄ (Generate All Voices) တွင် အသံ + 0:30 Sync ထုတ်နိုင်ပါသည်`
                  : 'အသံထုတ်ရန်နှင့် 0:30 Part Sync ညှိရန် အဆင့် ၄ (TTS Studio) သို့ သွားပါ'}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onNextStep && (
              <button
                onClick={onNextStep}
                className="px-4 py-2.5 bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 hover:opacity-90 text-zinc-950 font-black rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-500/25 active:scale-95"
              >
                <span>အဆင့် ၄ (TTS Studio)</span>
                <ArrowRight className="w-4 h-4 stroke-[2.5]" />
              </button>
            )}
            {onJumpToStep && (
              <button
                onClick={() => onJumpToStep(5)}
                className="px-4 py-2.5 bg-violet-500 hover:bg-violet-400 text-white font-black rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-lg shadow-violet-500/25 active:scale-95"
              >
                <span>အဆင့် ၅ (Video Editor)</span>
                <ArrowRight className="w-4 h-4 stroke-[2.5]" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 0:30 Parts Filter & Timing Structure */}
      <div className="glass-card rounded-xl p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-cyan-400" />
              <span>Video 0:30 Parts ({totalParts} Parts × 30s — 0:00-0:30, 0:30-1:00...)</span>
            </span>
            <span className="text-[11px] font-mono text-cyan-300">
              {Math.floor((project.videoDuration || 0) / 60)}m {Math.floor((project.videoDuration || 0) % 60)}s
            </span>
          </div>

          {project.segments.length > 0 && (
            <button
              type="button"
              onClick={handleManualRealignMinuteBlocks}
              className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-200 text-[11px] font-bold cursor-pointer flex items-center gap-1"
              title="၃၀ စက္ကန့်စီ (0:00-0:30) အပိုင်းအတွင်း နောက်ပိုင်းအသံ အချိန်မရွေ့စေရန် ပြန်ညှိမည်"
            >
              <Layers className="w-3 h-3" />
              <span>Re-Align 0:30</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSelectedPartFilter('all')}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              selectedPartFilter === 'all'
                ? 'bg-cyan-400 text-zinc-950 shadow-md shadow-cyan-400/20'
                : 'bg-white/5 text-zinc-400 hover:text-zinc-200 border border-white/5'
            }`}
          >
            All ({project.segments.length})
          </button>

          {videoParts.map((part) => {
            const isLastPart = part.partNumber === totalParts;
            const segCount = project.segments.filter((s) =>
              isLastPart
                ? s.startTime >= part.startSec && s.startTime <= part.endSec + 0.5
                : s.startTime >= part.startSec && s.startTime < part.endSec
            ).length;

            return (
              <button
                key={part.partNumber}
                onClick={() => {
                  setSelectedPartFilter(part.partNumber);
                  onSeekTo(part.startSec);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                  selectedPartFilter === part.partNumber
                    ? 'bg-cyan-400 text-zinc-950 font-bold shadow-md shadow-cyan-400/20'
                    : 'bg-white/5 text-zinc-300 hover:bg-white/10 border border-white/5'
                }`}
              >
                <span>{part.label}</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/40 text-cyan-300">
                  {segCount}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Dubbing Plan & Subtitle Actions Toolbar */}
      {project.segments.length > 0 && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-950/60 via-zinc-900 to-indigo-950/50 border border-sky-500/30 shadow-xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-sky-400" />
              <span className="text-xs font-bold text-white font-myanmar">
                {'Burmese Script & Subtitles Plan'}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30 font-mono">
                {project.segments.length} Segments
              </span>
            </div>

            {copyFeedback && (
              <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1.5 animate-pulse bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                <Check className="w-3.5 h-3.5" />
                {copyFeedback}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            <button
              onClick={handlePolishNarrationStyle}
              disabled={isPolishing || isGenerating}
              className="px-3 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-50 text-amber-200 text-xs font-bold flex items-center justify-center gap-1.5 border border-amber-400/40 transition-colors cursor-pointer active:scale-95"
              title="နမူနာ Video စံနှုန်းအတိုင်း တယ်/ပါတယ် ထပ်နေမှုလျှော့ပြီး အသံနိမ့်မြင့် စိတ်ခံစားချက် Tag များ ထည့်သွင်းပြင်ဆင်မည်"
            >
              <Sparkles className={`w-3.5 h-3.5 text-amber-300 ${isPolishing ? 'animate-spin' : ''}`} />
              <span>{isPolishing ? 'ညှိနေသည်...' : '✨ Style Polish (တယ်လျှော့)'}</span>
            </button>

            <button
              onClick={handleCopyDubbingPlanJson}
              className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sky-300 text-xs font-semibold flex items-center justify-center gap-1.5 border border-white/10 transition-colors cursor-pointer active:scale-95"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copy JSON Plan</span>
            </button>

            <button
              onClick={handleDownloadDubbingPlanJson}
              className="px-3 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 text-xs font-semibold flex items-center justify-center gap-1.5 border border-sky-500/30 transition-colors cursor-pointer active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download JSON</span>
            </button>

            <button
              onClick={handleDownloadBurmeseSRT}
              className="px-3 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 text-xs font-semibold flex items-center justify-center gap-1.5 border border-emerald-500/30 transition-colors cursor-pointer active:scale-95"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Download .SRT</span>
            </button>

            <button
              onClick={handleImportDubbingPlanJson}
              className="px-3 py-2 rounded-xl bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 text-xs font-semibold flex items-center justify-center gap-1.5 border border-violet-500/30 transition-colors cursor-pointer active:scale-95"
              title="Dubbing Plan JSON များကို Paste လုပ်၍ Segments များအဖြစ် တိုက်ရိုက်တင်သွင်းမည်"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>📥 Import JSON</span>
            </button>

            <button
              onClick={() => setShowDubbingPlanModal(true)}
              className="px-3 py-2 rounded-xl bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-200 text-xs font-semibold flex items-center justify-center gap-1.5 border border-indigo-500/30 transition-colors cursor-pointer active:scale-95"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>View 10-Point Plan</span>
            </button>
          </div>
        </div>
      )}

      {/* Segment List & Timestamp Editor */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-white">
              Segments ({displayedSegments.length} of {project.segments.length})
            </span>
          </div>
          <button
            onClick={handleAddSegment}
            className="px-3 py-1.5 text-xs font-bold text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 rounded-xl transition-all flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Segment</span>
          </button>
        </div>

        {displayedSegments.length === 0 ? (
          <div className="glass-card rounded-xl p-8 text-center text-xs text-zinc-400 space-y-1">
            <p className="font-myanmar">စာသားအပိုင်းများ မရှိသေးပါ။ Transcribe & Translate ခလုတ်ကို နှိပ်ပါ။</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[32rem] overflow-y-auto pr-1">
            {displayedSegments.map((seg, idx) => (
              <div
                key={seg.id}
                className={`p-3.5 rounded-xl border transition-all ${
                  project.currentTime >= seg.startTime && project.currentTime <= seg.endTime
                    ? 'bg-cyan-500/15 border-cyan-400/60 ring-1 ring-cyan-400/30'
                    : 'glass-card'
                }`}
              >
                {/* Header: Segment number, time, duration, and controls */}
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-zinc-500 text-xs font-bold">#{idx + 1}</span>
                    <button
                      onClick={() => onSeekTo(seg.startTime)}
                      className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-cyan-300 font-mono-num text-xs flex items-center gap-1 border border-white/10 transition-colors cursor-pointer"
                    >
                      <Play className="w-2.5 h-2.5 text-cyan-400" />
                      <span>
                        {formatMinSec(seg.startTime)} - {formatMinSec(seg.endTime)}
                      </span>
                    </button>
                    <span className="px-2 py-0.5 rounded-md bg-zinc-800/80 text-[10px] text-zinc-400 font-mono">
                      {(seg.duration || seg.endTime - seg.startTime).toFixed(2)}s
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-sky-500/10 text-sky-300 text-[10px] font-semibold border border-sky-500/20">
                      {seg.speaker || 'Narrator (ဇာတ်ကြောင်းပြောသူ)'}
                    </span>
                    {seg.scriptStyle && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                          seg.scriptStyle === 'story'
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : seg.scriptStyle === 'translation'
                              ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                              : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                        }`}
                      >
                        {seg.scriptStyle === 'story'
                          ? '📖 Story'
                          : seg.scriptStyle === 'translation'
                            ? '🌐 Translation'
                            : '🎙️ Narrator'}
                      </span>
                    )}
                    {seg.isOnScreen !== undefined && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-zinc-800 text-zinc-400">
                        {seg.isOnScreen ? '👁️ On Screen' : '🎙️ Off Screen'}
                      </span>
                    )}

                    {seg.audioUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          setProject((prev) => (prev.isPlaying ? { ...prev, isPlaying: false } : prev));
                          const audio = new Audio(seg.audioUrl);
                          audio.playbackRate = seg.atempoRate || seg.playbackRate || 1.0;
                          (audio as any).preservesPitch = true;
                          (audio as any).webkitPreservesPitch = true;
                          registerPreviewAudio(audio);
                          audio.play().catch(() => {});
                        }}
                        className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold flex items-center gap-1 cursor-pointer hover:bg-emerald-500/30 transition-all"
                        title="ဖတ်ပြထားသော မြန်မာယောက်ျားသံ (သီဟ) ကို နားဆင်ရန်"
                      >
                        <Volume2 className="w-3 h-3 text-emerald-400" />
                        <span>အသံနားဆင်မည် ({seg.audioDuration ? seg.audioDuration.toFixed(1) + 's' : 'TTS'})</span>
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={seg.voice}
                      onChange={(e) =>
                        handleUpdateSegment(seg.id, { voice: e.target.value as any })
                      }
                      className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-white/10 text-xs text-emerald-400 font-semibold focus:outline-none cursor-pointer"
                    >
                      <optgroup label="Male Voices (Adult Burmese)">
                        <option value="Thiha">Thiha (Adult Male)</option>
                        <option value="KyawKyaw">Kyaw Kyaw (Adult Male)</option>
                        <option value="AungAung">Aung Aung</option>
                        <option value="MinThway">Min Thway</option>
                      </optgroup>
                      <optgroup label="Female Voices">
                        <option value="Nilar">Nilar</option>
                        <option value="MayThu">May Thu</option>
                        <option value="Thiri">Thiri</option>
                        <option value="SuSu">Su Su</option>
                      </optgroup>
                    </select>

                    <select
                      value={seg.playbackRate || project.voicePlaybackRate || 1.0}
                      onChange={(e) =>
                        handleUpdateSegment(seg.id, { playbackRate: parseFloat(e.target.value) })
                      }
                      className="px-2 py-1 rounded-lg bg-zinc-900 border border-white/10 text-xs text-cyan-400 font-mono focus:outline-none cursor-pointer"
                    >
                      <option value={0.75}>0.75x</option>
                      <option value={0.85}>0.85x</option>
                      <option value={0.95}>0.95x</option>
                      <option value={1.0}>1.00x</option>
                      <option value={1.1}>1.10x</option>
                      <option value={1.2}>1.20x</option>
                      <option value={1.25}>1.25x</option>
                      <option value={1.5}>1.50x</option>
                    </select>

                    <button
                      onClick={() => handleDeleteSegment(seg.id)}
                      className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Original scene note / plot summary */}
                {seg.originalText && (
                  <div className="mb-2 px-3 py-1.5 rounded-lg bg-zinc-900/60 border border-white/5 text-[11px] text-zinc-400 flex items-baseline gap-2 flex-wrap">
                    <span className="text-[10px] font-semibold text-zinc-500 uppercase shrink-0">
                      {seg.slotMode === 'scene_recap_30s' ? 'Scene Beat:' : 'Original:'}
                    </span>
                    {seg.sceneTitle && (
                      <span className="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 font-myanmar font-bold text-[10px]">
                        {seg.sceneTitle}
                      </span>
                    )}
                    <span className="font-sans text-zinc-300">{seg.originalText}</span>
                  </div>
                )}

                {/* Natural Spoken Burmese Narration + 0.18s Pause Bridge Editor */}
                {(() => {
                  const slotDur = Math.max(0.5, seg.endTime - seg.startTime);
                  const sylCount = countBurmeseSyllables(seg.myanmarTranslation || '');
                  const maxSyl = seg.maxAllowedSyllables || calculateMaxAllowedSyllables(slotDur);
                  const isRecapSlot = seg.slotMode === 'scene_recap_30s' || slotDur >= 15;
                  const minRecapSyl = Math.max(8, Math.floor(slotDur * 2.75));
                  const isTooShortRecap = isRecapSlot && sylCount < minRecapSyl;
                  const isTooLong = sylCount > maxSyl;

                  if (isRecapSlot) {
                    const mainVal = seg.mainNarration ?? seg.myanmarTranslation;
                    const bridgeVal = seg.bridgeNarration ?? '';
                    const pauseGap = seg.pauseBetweenParts ?? 0.18;

                    return (
                      <div className="space-y-2 mb-2">
                        <div className="flex items-center justify-between text-[10px] text-zinc-400 flex-wrap gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-myanmar font-semibold text-cyan-300">
                              ဇာတ်လမ်းဖြစ်စဉ် Narration (Main + {pauseGap.toFixed(2)}s Pause + ဆက်စကားတို):
                            </span>
                            {seg.emotion && (
                              <span className="text-zinc-500 italic text-[9px]">({seg.emotion})</span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            {isTooShortRecap ? (
                              <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 font-semibold font-myanmar text-[9px]">
                                ⏱️ စာတိုနေပါသည် ({sylCount}/{minRecapSyl}–{maxSyl} syls for {slotDur.toFixed(0)}s)
                              </span>
                            ) : isTooLong ? (
                              <span className="px-2 py-0.5 rounded-md bg-rose-500/15 border border-rose-500/30 text-rose-300 font-semibold font-myanmar text-[9px]">
                                ⚠️ ရှည်နေသည် ({sylCount}/{maxSyl} syls)
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-[9px]">
                                ✓ {slotDur.toFixed(0)}s Slot Fit ({sylCount}/{maxSyl} syls)
                              </span>
                            )}

                            <button
                              type="button"
                              onClick={() => handleGenerateShortBridge(seg)}
                              disabled={bridgingSegId === seg.id}
                              className="px-2 py-0.5 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-200 text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1 disabled:opacity-50"
                              title="မြင်ကွင်းနဲ့ကိုက်ညီတဲ့ ဆက်စကားတိုတစ်ခု ဖန်တီးပြီး 0.18s Pause ခြား၍ Slot ပြည့်အောင် ဖြည့်ပေးမည်"
                            >
                              {bridgingSegId === seg.id ? (
                                <RotateCw className="w-2.5 h-2.5 animate-spin" />
                              ) : (
                                <Sparkles className="w-2.5 h-2.5 text-emerald-300" />
                              )}
                              <span>{bridgingSegId === seg.id ? 'ဖြည့်နေသည်...' : '✨ ဆက်စကားတို ဖြည့် (+0.18s)'}</span>
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <textarea
                            rows={2}
                            value={mainVal}
                            onChange={(e) => {
                              const nextMain = e.target.value;
                              const combined = bridgeVal.trim() ? `${nextMain.trim()} ${bridgeVal.trim()}` : nextMain.trim();
                              handleUpdateSegment(seg.id, {
                                slotMode: 'scene_recap_30s',
                                mainNarration: nextMain,
                                myanmarTranslation: combined,
                                subtitleText: combined,
                              });
                            }}
                            placeholder="Part 1: ဤ 30s မြင်ကွင်းအပိုင်း၏ အဓိက ဇာတ်လမ်းဖြစ်စဉ် Narration..."
                            className="w-full px-3 py-1.5 glass-input rounded-lg text-xs font-myanmar text-white focus:ring-1 focus:ring-cyan-400"
                          />

                          <div className="flex items-center gap-2">
                            <span className="px-2 py-1 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-[10px] font-mono font-bold text-cyan-300 shrink-0">
                              ⏸ {pauseGap.toFixed(2)}s Pause
                            </span>
                            <input
                              type="text"
                              value={bridgeVal}
                              onChange={(e) => {
                                const nextBridge = e.target.value;
                                const combined = nextBridge.trim() ? `${mainVal.trim()} ${nextBridge.trim()}` : mainVal.trim();
                                handleUpdateSegment(seg.id, {
                                  slotMode: 'scene_recap_30s',
                                  mainNarration: mainVal,
                                  bridgeNarration: nextBridge,
                                  pauseBetweenParts: pauseGap,
                                  myanmarTranslation: combined,
                                  subtitleText: combined,
                                });
                              }}
                              placeholder="Part 2: မြင်ကွင်းနဲ့ကိုက်ညီတဲ့ ဆက်စကားတို (Slot 30s ပြည့်ရန်)..."
                              className="flex-1 px-3 py-1.5 bg-zinc-950/80 border border-emerald-500/30 rounded-lg text-xs font-myanmar text-emerald-100 focus:outline-none focus:border-emerald-400"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-1 mb-2">
                      <div className="flex items-center justify-between text-[10px] text-zinc-400 flex-wrap gap-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-myanmar font-semibold text-cyan-300">
                            သဘာဝကျသော မြန်မာစကားပြော (Dubbing Dialogue):
                          </span>
                          {seg.emotion && (
                            <span className="text-zinc-500 italic text-[9px]">({seg.emotion})</span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          {isTooLong ? (
                            <span className="px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 font-semibold font-myanmar text-[9px] flex items-center gap-1">
                              ⚠️ စကားလုံးရှည်နေပါသည် ({sylCount}/{maxSyl} syllables &gt; {slotDur.toFixed(1)}s)
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-[9px]">
                              ✓ Timing Fit ({sylCount}/{maxSyl} syllables, {slotDur.toFixed(1)}s)
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleShortenSegment(seg)}
                            disabled={shorteningSegId === seg.id}
                            className="px-2 py-0.5 rounded-md bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 text-[10px] font-bold transition-all cursor-pointer flex items-center gap-1 disabled:opacity-50"
                            title="မူရင်းစကားပြောချိန်အတွင်း ဖတ်နိုင်ရန် AI ဖြင့် စာတိုအောင် ပြင်မည်"
                          >
                            {shorteningSegId === seg.id ? (
                              <RotateCw className="w-2.5 h-2.5 animate-spin" />
                            ) : (
                              <Scissors className="w-2.5 h-2.5 text-cyan-400" />
                            )}
                            <span>{shorteningSegId === seg.id ? 'ချုံ့နေသည်...' : 'AI စာတိုချုံ့မည်'}</span>
                          </button>
                        </div>
                      </div>
                      <input
                        type="text"
                        value={seg.myanmarTranslation}
                        onChange={(e) => handleUpdateSegment(seg.id, { myanmarTranslation: e.target.value })}
                        placeholder="သဘာဝကျသော လူပြောစကား မြန်မာစကားပြော..."
                        className="w-full px-3 py-1.5 glass-input rounded-lg text-xs font-myanmar text-white focus:ring-1 focus:ring-cyan-400"
                      />
                    </div>
                  );
                })()}

                {/* Subtitle text & lip-sync note */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <span className="text-zinc-500 block mb-0.5">မြန်မာစာတန်းထိုး Subtitle (&lt;35 chars, max 2 lines):</span>
                    <input
                      type="text"
                      value={seg.subtitleText !== undefined ? seg.subtitleText : seg.myanmarTranslation}
                      onChange={(e) => handleUpdateSegment(seg.id, { subtitleText: e.target.value })}
                      placeholder="စာတန်းထိုး စာသား..."
                      className="w-full px-2.5 py-1 bg-zinc-900/90 border border-white/10 rounded text-xs text-zinc-200 font-myanmar"
                    />
                  </div>
                  <div>
                    <span className="text-zinc-500 block mb-0.5">Lip-Sync & Timing Note:</span>
                    <input
                      type="text"
                      value={seg.lipSyncNote || 'Paced to match original duration'}
                      onChange={(e) => handleUpdateSegment(seg.id, { lipSyncNote: e.target.value })}
                      placeholder="နှုတ်ခမ်းလှုပ်ရှားမှုနှင့် အချိန်ကိုက် မှတ်ချက်..."
                      className="w-full px-2.5 py-1 bg-zinc-900/90 border border-white/10 rounded text-xs text-zinc-400 font-myanmar"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 10-Point Dubbing Plan Modal */}
      {showDubbingPlanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-5xl max-h-[90vh] bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-zinc-950/70">
              <div className="flex items-center gap-2.5">
                <FileText className="w-5 h-5 text-sky-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">Chinese to Burmese Dubbing Plan (10-Point Specification)</h3>
                  <p className="text-[11px] text-zinc-400 font-myanmar">
                    အချိန်ကိုက် မြန်မာစကားပြော အပြည့်အစုံ ဇယားနှင့် JSON အချက်အလက်များ
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyDubbingPlanJson}
                  className="px-3 py-1.5 rounded-lg bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy JSON</span>
                </button>
                <button
                  onClick={handleDownloadDubbingPlanJson}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download JSON</span>
                </button>
                <button
                  onClick={handleDownloadBurmeseSRT}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Download SRT</span>
                </button>
                <button
                  onClick={() => setShowDubbingPlanModal(false)}
                  className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Table Body */}
            <div className="flex-1 overflow-auto p-4">
              <table className="w-full text-left text-xs text-zinc-300 border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-[11px] text-zinc-400 bg-zinc-950/40">
                    <th className="p-2.5 font-bold"># / Time</th>
                    <th className="p-2.5 font-bold">Speaker</th>
                    <th className="p-2.5 font-bold">Original Dialogue</th>
                    <th className="p-2.5 font-bold">Natural Burmese Translation</th>
                    <th className="p-2.5 font-bold">Burmese Subtitle</th>
                    <th className="p-2.5 font-bold">Duration</th>
                    <th className="p-2.5 font-bold">Emotion & Lip-Sync</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {project.segments.map((s, i) => (
                    <tr key={s.id} className="hover:bg-white/5 transition-colors">
                      <td className="p-2.5 font-mono text-cyan-300 whitespace-nowrap">
                        <div className="font-bold">#{i + 1}</div>
                        <div className="text-[10px] text-zinc-400">
                          {formatMinSec(s.startTime)} - {formatMinSec(s.endTime)}
                        </div>
                      </td>
                      <td className="p-2.5 whitespace-nowrap">
                        <span className="font-semibold text-white">{s.speaker || 'Narrator (ဇာတ်ကြောင်းပြောသူ)'}</span>
                        <div className="text-[10px] text-zinc-400">{s.isOnScreen ? 'On-Screen' : 'Off-Screen'}</div>
                      </td>
                      <td className="p-2.5 text-zinc-300 font-sans max-w-xs">{s.originalText || '-'}</td>
                      <td className="p-2.5 text-sky-200 font-myanmar max-w-xs">{s.myanmarTranslation}</td>
                      <td className="p-2.5 text-emerald-300 font-myanmar max-w-xs">
                        {s.subtitleText || s.myanmarTranslation}
                      </td>
                      <td className="p-2.5 font-mono text-zinc-300 whitespace-nowrap">
                        {(s.duration || s.endTime - s.startTime).toFixed(2)}s
                      </td>
                      <td className="p-2.5 text-[11px] text-zinc-400 max-w-xs">
                        <div className="text-zinc-200">{s.emotion || 'Natural conversational'}</div>
                        <div className="text-[10px] text-zinc-500 italic">{s.lipSyncNote || 'Paced to match duration'}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation Card */}
      <div className="pt-4 border-t border-white/10 flex items-center justify-between gap-4">
        {onPrevStep ? (
          <button
            onClick={onPrevStep}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-semibold rounded-xl transition-all border border-white/10 flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>ရှေ့အဆင့်</span>
          </button>
        ) : (
          <div />
        )}

        <span className="text-xs text-zinc-400 font-myanmar hidden sm:inline">
          သဘာဝကျသော Narrator Script ထုတ်ယူပြီးပါက နောက်အဆင့် (TTS Studio) သို့ သွားပါ
        </span>

        {onNextStep && (
          <button
            onClick={onNextStep}
            className="px-6 py-3 bg-gradient-to-r from-sky-400 to-teal-400 hover:opacity-90 text-zinc-950 font-black text-xs rounded-xl transition-all flex items-center gap-2.5 shadow-xl shadow-sky-500/25 cursor-pointer active:scale-95 shrink-0"
          >
            <span>နောက်အဆင့် (TTS Studio) သို့</span>
            <ArrowRight className="w-4 h-4 stroke-[2.5]" />
          </button>
        )}
      </div>
    </div>
  );
};
