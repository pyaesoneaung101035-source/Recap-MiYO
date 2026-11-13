import { TranscriptSegment, VoiceOption } from '../types';

export const MINUTE_BLOCK_SECONDS = 60;
export const MIN_GENTLE_NARRATOR_RATE = 0.90;
export const MAX_GENTLE_NARRATOR_RATE = 1.18;

export interface MinuteBlockInfo {
  partNumber: number; // 1-based
  startSec: number;
  endSec: number;
  label: string;
}

export function formatMinSec(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function getMinuteBlocks(videoDuration: number): MinuteBlockInfo[] {
  const safeDur = Math.max(MINUTE_BLOCK_SECONDS, videoDuration || MINUTE_BLOCK_SECONDS);
  const totalParts = Math.max(1, Math.ceil(safeDur / MINUTE_BLOCK_SECONDS));
  return Array.from({ length: totalParts }, (_, i) => {
    const startSec = i * MINUTE_BLOCK_SECONDS;
    const endSec = Math.min((i + 1) * MINUTE_BLOCK_SECONDS, videoDuration || (i + 1) * MINUTE_BLOCK_SECONDS);
    return {
      partNumber: i + 1,
      startSec,
      endSec,
      label: `Part ${i + 1} (${formatMinSec(startSec)} - ${formatMinSec(endSec)})`,
    };
  });
}

export function clampGentleNarratorRate(rawRate: number): number {
  if (!isFinite(rawRate) || rawRate <= 0) return 1.0;
  return parseFloat(
    Math.min(MAX_GENTLE_NARRATOR_RATE, Math.max(MIN_GENTLE_NARRATOR_RATE, rawRate)).toFixed(2)
  );
}

/**
 * Re-aligns every segment cleanly inside its 1-minute video time block [m*60, (m+1)*60].
 * Guarantees every segment finishes speaking 100% of its TTS audio without EVER truncating
 * final words, while anchoring back to each scene's originalStartTime whenever natural gaps exist
 * so subsequent scenes NEVER drift cumulatively out of sync with the video!
 */
export function realignSegmentsByMinuteBlocks(
  segments: TranscriptSegment[],
  videoDuration: number,
  options?: {
    enforceSingleVoice?: VoiceOption;
    enforceSingleSpeakerLabel?: boolean;
  }
): TranscriptSegment[] {
  if (!segments || segments.length === 0) return [];

  const safeVideoDuration = Math.max(
    videoDuration || 0,
    ...segments.map((s) => s.endTime || 0),
    MINUTE_BLOCK_SECONDS
  );

  // Preserve original scene anchor timestamps on first alignment pass
  const withAnchors = segments.map((s) => ({
    ...s,
    originalStartTime: s.originalStartTime !== undefined ? s.originalStartTime : s.startTime,
    originalEndTime: s.originalEndTime !== undefined ? s.originalEndTime : s.endTime,
  }));

  const sorted = [...withAnchors].sort(
    (a, b) => (a.originalStartTime ?? a.startTime) - (b.originalStartTime ?? b.startTime)
  );

  // Group into 1-minute blocks by true scene originalStartTime
  const blocks = new Map<number, typeof sorted>();
  for (const seg of sorted) {
    const baseStart = seg.originalStartTime ?? seg.startTime;
    const safeStart = Math.max(0, Math.min(safeVideoDuration - 0.5, baseStart));
    const blockIdx = Math.max(0, Math.floor(safeStart / MINUTE_BLOCK_SECONDS));
    if (!blocks.has(blockIdx)) blocks.set(blockIdx, []);
    blocks.get(blockIdx)!.push(seg);
  }

  const aligned: TranscriptSegment[] = [];
  const blockIndices = Array.from(blocks.keys()).sort((a, b) => a - b);
  let globalCursor = 0;

  for (const blockIdx of blockIndices) {
    const blockSegs = blocks.get(blockIdx)!;
    const blockStart = blockIdx * MINUTE_BLOCK_SECONDS;
    const blockEnd = Math.min(safeVideoDuration, (blockIdx + 1) * MINUTE_BLOCK_SECONDS);

    let blockCursor = Math.max(blockStart, globalCursor);

    for (let i = 0; i < blockSegs.length; i++) {
      const seg = blockSegs[i];
      const nextSegInBlock = i < blockSegs.length - 1 ? blockSegs[i + 1] : null;

      const sceneStart = seg.originalStartTime ?? seg.startTime;
      const sceneEnd = seg.originalEndTime ?? seg.endTime;
      const originalSlotDur = Math.max(0.5, (sceneEnd || sceneStart + 3) - sceneStart);

      // Snap back to sceneStart unless previous clip is still finishing
      let startTime = Math.max(blockStart, blockCursor, sceneStart);

      const nextSceneStart = nextSegInBlock
        ? (nextSegInBlock.originalStartTime ?? nextSegInBlock.startTime)
        : blockEnd;
      const plannedGapEnd = nextSegInBlock
        ? Math.max(startTime + originalSlotDur, nextSceneStart - 0.04)
        : Math.max(startTime + originalSlotDur, blockEnd);
      const availableWindow = Math.max(0.5, plannedGapEnd - startTime);

      let endTime = Math.max(startTime + 0.5, startTime + originalSlotDur);
      let playbackRate = clampGentleNarratorRate(seg.playbackRate || seg.atempoRate || 1.0);
      let timingWarning: string | undefined = undefined;

      if (seg.audioDuration && seg.audioDuration > 0) {
        if (seg.audioDuration > availableWindow) {
          const neededRate = seg.audioDuration / availableWindow;
          playbackRate = clampGentleNarratorRate(neededRate);
          const adjustedDur = seg.audioDuration / playbackRate;

          // NEVER truncate endTime below startTime + adjustedDur
          endTime = startTime + adjustedDur;
          if (adjustedDur > availableWindow + 0.3) {
            const overflowSec = adjustedDur - availableWindow;
            timingWarning = `အသံ +${overflowSec.toFixed(1)}s ရှည်နေသဖြင့် စကားအဆုံးထိ အပြည့်ဖတ်နိုင်ရန် ${playbackRate.toFixed(2)}x ညှိထားပါသည် (Sync-Fit နှိပ်၍ စာတိုချုံ့နိုင်သည်)`;
          }
        } else {
          playbackRate = 1.0;
          endTime = Math.max(startTime + seg.audioDuration, Math.min(plannedGapEnd, startTime + originalSlotDur));
        }
      }

      startTime = parseFloat(startTime.toFixed(2));
      endTime = parseFloat(Math.max(startTime + 0.4, endTime).toFixed(2));
      blockCursor = endTime + 0.04;
      globalCursor = blockCursor;

      aligned.push({
        ...seg,
        startTime,
        endTime,
        duration: parseFloat((endTime - startTime).toFixed(2)),
        minutePartIndex: blockIdx + 1,
        playbackRate,
        atempoRate: playbackRate,
        voice: seg.voiceProvider === 'elevenlabs' ? seg.voice : (options?.enforceSingleVoice || seg.voice || 'Thiha'),
        speaker: seg.voiceProvider === 'elevenlabs'
          ? (seg.speaker || 'ElevenLabs Cloned Voice')
          : options?.enforceSingleSpeakerLabel
          ? 'Narrator (ဇာတ်ကြောင်းပြောသူ)'
          : (seg.speaker || 'Narrator (ဇာတ်ကြောင်းပြောသူ)'),
        narratorTimingWarning: timingWarning,
      });
    }
  }

  return aligned;
}

/**
 * Computes playback window for each segment.
 * NEVER truncates active speech mid-word before audioDuration / speed completes!
 */
export function getSegmentPlaybackWindow(
  segments: TranscriptSegment[],
  segmentIndex: number,
  globalVoiceSpeed = 1.0
): { startTime: number; hardEndTime: number; speed: number } {
  const seg = segments[segmentIndex];
  const speed = clampGentleNarratorRate(seg.playbackRate || seg.atempoRate || globalVoiceSpeed || 1.0);
  const effectiveAudioDur = (seg.audioDuration || Math.max(0.5, seg.endTime - seg.startTime)) / speed;
  // Add 150ms breathing safety tail so browser DAC & MediaElement never chop final syllable
  const desiredEnd = Math.max(seg.endTime, seg.startTime + effectiveAudioDur + 0.15);

  const nextSeg = segmentIndex < segments.length - 1 ? segments[segmentIndex + 1] : null;
  // Only cap at nextSeg.startTime if nextSeg starts AFTER our full speech finishes
  const hardEndTime = nextSeg && nextSeg.startTime > desiredEnd
    ? Math.min(nextSeg.startTime - 0.02, desiredEnd)
    : desiredEnd;

  return {
    startTime: Math.max(0, seg.startTime),
    hardEndTime: Math.max(seg.startTime + 0.3, hardEndTime),
    speed,
  };
}

export function findActiveSegmentForTime(
  segments: TranscriptSegment[],
  currentTime: number,
  globalVoiceSpeed = 1.0,
  requireAudio = false
): { segment: TranscriptSegment; window: { startTime: number; hardEndTime: number; speed: number } } | null {
  let fallbackMatch: { segment: TranscriptSegment; window: { startTime: number; hardEndTime: number; speed: number } } | null = null;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (requireAudio && !seg.audioUrl) continue;
    const win = getSegmentPlaybackWindow(segments, i, globalVoiceSpeed);
    if (currentTime >= win.startTime && currentTime <= win.hardEndTime) {
      fallbackMatch = { segment: seg, window: win };
    }
  }
  return fallbackMatch;
}
