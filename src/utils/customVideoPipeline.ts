import {
  ProjectState,
  TranscriptSegment,
  VideoInspection,
  VoiceOption,
  VoiceToneOption,
} from '../types';
import { inspectVideoFile } from './audioExtractor';
import {
  generateTimestampedTranscript,
  countBurmeseSyllables,
} from './geminiPool';
import { autoGenerateAllNarratorVoices } from './edgeTtsClient';
import {
  MINUTE_BLOCK_SECONDS,
  getMinuteBlocks,
  realignSegmentsByMinuteBlocks,
  formatMinSec,
} from './timingSync';

export type FiveStageStepId = 1 | 2 | 3 | 4 | 5;

export interface FiveStageProgress {
  currentStage: FiveStageStepId;
  stageLabel: string;
  detailMessage: string;
  percent: number;
  inspection?: VideoInspection;
  minutePartsCount?: number;
}

export interface FiveStagePipelineOptions {
  project: ProjectState;
  customPrompt?: string;
  model?: string;
  narratorVoice?: VoiceOption;
  narratorTone?: VoiceToneOption;
  narratorPitch?: number;
  onProgress?: (progress: FiveStageProgress) => void;
}

export interface FiveStagePipelineResult {
  inspection: VideoInspection;
  segments: TranscriptSegment[];
  lockedVoice: VoiceOption;
  minuteParts: ReturnType<typeof getMinuteBlocks>;
}

/**
 * Executes the complete 5-Stage Custom Upload Video Workflow:
 * 1. Inspect original video (duration, resolution, audio track) + transcribe original audio to speech text
 * 2. Segment text with timestamps, translate sequentially, and track where each event happens in the video
 * 3. Write single-narrator Burmese storytelling script (without character voice splitting)
 * 4. Generate single Burmese narrator voice + apply gentle speech rate adjustment
 * 5. Split video into 1-minute blocks (Part 1..Part 6+), place narrator text/audio/subtitles, and re-align per block against drift
 */
export async function runFiveStageCustomVideoPipeline(
  options: FiveStagePipelineOptions
): Promise<FiveStagePipelineResult> {
  const {
    project,
    customPrompt = '',
    model = 'gemini-3.1-flash-lite',
    narratorVoice = project.lockedVoice || 'Thiha',
    narratorTone = project.voiceTone || 'natural',
    narratorPitch = project.voicePitch ?? 0,
    onProgress,
  } = options;

  const videoSource = project.videoFile || project.videoUrl;
  if (!videoSource) {
    throw new Error('ဗီဒီယိုဖိုင် မတွေ့ရှိပါ။ Step 2 တွင် Custom Video ကို အရင်တင်ပေးပါ။');
  }

  // STAGE 1: Video Inspection (Duration, Resolution, Audio Track)
  onProgress?.({
    currentStage: 1,
    stageLabel: '၁. မူရင်းဗီဒီယို စစ်ဆေးခြင်း & စကားပြောစာသား ထုတ်ယူခြင်း',
    detailMessage: 'ကြာချိန်၊ ရုပ်ထွက်နှင့် အသံဖိုင် ပါဝင်မှုကို စစ်ဆေးနေပါသည်...',
    percent: 6,
  });

  const inspection = await inspectVideoFile(
    videoSource,
    project.videoName || 'custom_video.mp4'
  );
  const totalDuration = Math.max(
    inspection.duration || project.videoDuration || MINUTE_BLOCK_SECONDS,
    1
  );
  const minuteBlocks = getMinuteBlocks(totalDuration);

  onProgress?.({
    currentStage: 1,
    stageLabel: '၁. မူရင်းဗီဒီယို စစ်ဆေးပြီး · စကားပြောစာသား ပြောင်းထုတ်နေသည်',
    detailMessage: `ကြာချိန် ${formatMinSec(totalDuration)} · ရုပ်ထွက် ${inspection.resolution} · အသံဖိုင် ${inspection.hasAudio ? 'ပါရှိသည် ✓' : 'မပါ (Visual OCR)'}`,
    percent: 14,
    inspection,
    minutePartsCount: minuteBlocks.length,
  });

  // STAGES 1 (STT) + 2 (Timestamped Chronological Translation + Scene Tracking) + 3 (Single-Narrator Burmese Storytelling)
  const rawSegments = await generateTimestampedTranscript(
    project.videoName || 'Custom_Upload_Video',
    totalDuration,
    `${customPrompt ? customPrompt + ' | ' : ''}Single Burmese Narrator storytelling retelling across chronological 1-minute parts (no multi-character voice splitting).`,
    project.videoFile,
    project.videoUrl,
    (msg, pct = 20) => {
      const stage: FiveStageStepId = pct < 32 ? 1 : pct < 65 ? 2 : 3;
      const stageLabel =
        stage === 1
          ? '၁. မူရင်းအသံကို စကားပြောစာသားအဖြစ် ပြောင်းထုတ်နေသည်'
          : stage === 2
            ? '၂. စာသားကို အချိန်မှတ်တမ်း + ဖြစ်ရပ်အစဉ်လိုက် ဘာသာပြန်နေသည်'
            : '၃. Narrator တစ်သံတည်း ဇာတ်ကြောင်းပုံစံ မြန်မာစာသား ရေးသားနေသည်';

      onProgress?.({
        currentStage: stage,
        stageLabel,
        detailMessage: msg,
        percent: Math.min(62, Math.round(14 + (pct / 100) * 48)),
        inspection,
        minutePartsCount: minuteBlocks.length,
      });
    },
    model,
    'narrator'
  );

  // Enforce Stage 3 single-narrator retelling metadata cleanly
  const scriptSegments: TranscriptSegment[] = rawSegments.map((seg, idx) => {
    const start = Math.max(0, seg.startTime);
    const end = Math.max(start + 0.5, seg.endTime);
    const blockPart = Math.floor(start / MINUTE_BLOCK_SECONDS) + 1;
    return {
      ...seg,
      startTime: parseFloat(start.toFixed(2)),
      endTime: parseFloat(end.toFixed(2)),
      originalStartTime: seg.originalStartTime ?? parseFloat(start.toFixed(2)),
      originalEndTime: seg.originalEndTime ?? parseFloat(end.toFixed(2)),
      slotMode: 'dialogue_dub',
      scriptStyle: 'narrator',
      voice: narratorVoice,
      tone: narratorTone,
      pitch: narratorPitch,
      speaker: 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
      minutePartIndex: blockPart,
      sceneShotId: seg.sceneShotId || `Part ${blockPart} · Shot ${idx + 1}`,
      syllableCount: countBurmeseSyllables(seg.myanmarTranslation || ''),
    };
  });

  // STAGE 4: Generate Single Myanmar Narrator Voice + Gentle Rate Adjustment
  onProgress?.({
    currentStage: 4,
    stageLabel: '၄. Narrator တစ်သံတည်း ဖန်တီးခြင်း & ပြောနှုန်းညှိခြင်း',
    detailMessage: `${narratorVoice} မြန်မာ Narrator အသံဖြင့် အပိုင်း ${scriptSegments.length} ခုကို ဖန်တီးနေပါသည်...`,
    percent: 65,
    inspection,
    minutePartsCount: minuteBlocks.length,
  });

  const voicedSegments = await autoGenerateAllNarratorVoices(
    scriptSegments,
    (msg, current, total) => {
      const ttsPct = total > 0 ? 65 + Math.round((current / total) * 27) : 75;
      onProgress?.({
        currentStage: 4,
        stageLabel: `၄. Narrator အသံ ဖန်တီးနေသည် (${current}/${total})`,
        detailMessage: msg,
        percent: Math.min(92, ttsPct),
        inspection,
        minutePartsCount: minuteBlocks.length,
      });
    },
    narratorVoice,
    narratorTone,
    narratorPitch
  );

  // STAGE 5: Place Audio & Subtitles into 0:30 Parts (0:00-0:30, 0:30-1:00...) & Re-Align Per Part
  onProgress?.({
    currentStage: 5,
    stageLabel: '၅. 0:30 စီ အပိုင်းခွဲ၍ အသံ + Subtitle အချိန်ကွက် ပြန်ညှိနေသည်',
    detailMessage: `ဗီဒီယိုကို 0:30 စီ (${minuteBlocks.length} ပိုင်း) ခွဲ၍ နောက်ပိုင်းအသံ အချိန်မရွေ့စေရန် ပြန်ညှိနေပါသည်...`,
    percent: 95,
    inspection,
    minutePartsCount: minuteBlocks.length,
  });

  const alignedSegments = realignSegmentsByMinuteBlocks(voicedSegments, totalDuration, {
    enforceSingleVoice: narratorVoice,
    enforceSingleSpeakerLabel: true,
  });

  onProgress?.({
    currentStage: 5,
    stageLabel: '✓ အဆင့် (၁ မှ ၅) အားလုံး အောင်မြင်စွာ ပြီးစီးပါပြီ!',
    detailMessage: `0:30 စီ ${minuteBlocks.length} ပိုင်း (${alignedSegments.length} Segments) ကို Single Narrator အသံ + Subtitle နှင့်အတူ တိကျစွာ ချိန်ညှိပြီးပါပြီ။`,
    percent: 100,
    inspection,
    minutePartsCount: minuteBlocks.length,
  });

  return {
    inspection,
    segments: alignedSegments,
    lockedVoice: narratorVoice,
    minuteParts: minuteBlocks,
  };
}
