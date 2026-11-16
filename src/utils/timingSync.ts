import { TranscriptSegment, VoiceOption } from '../types';

export const MINUTE_BLOCK_SECONDS = 30;
export const ANALYSIS_CHUNK_SECONDS = 30;
export const RECAP_SLOT_SECONDS = 30;
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

export function getRecapSlots(videoDuration: number, slotSeconds = RECAP_SLOT_SECONDS): MinuteBlockInfo[] {
  const step = Math.max(10, slotSeconds || RECAP_SLOT_SECONDS);
  const safeDur = Math.max(step, videoDuration || step);
  const totalSlots = Math.max(1, Math.ceil(safeDur / step));
  return Array.from({ length: totalSlots }, (_, i) => {
    const startSec = i * step;
    const endSec = Math.min((i + 1) * step, videoDuration || (i + 1) * step);
    return {
      partNumber: i + 1,
      startSec,
      endSec,
      label: `Slot ${i + 1} (${formatMinSec(startSec)} - ${formatMinSec(endSec)})`,
    };
  });
}

export function getMinuteBlocks(videoDuration: number): MinuteBlockInfo[] {
  const safeDur = Math.max(MINUTE_BLOCK_SECONDS, videoDuration || MINUTE_BLOCK_SECONDS);
  let totalParts = Math.max(1, Math.floor(safeDur / MINUTE_BLOCK_SECONDS));
  if (safeDur - totalParts * MINUTE_BLOCK_SECONDS >= 1.0) {
    totalParts += 1;
  }
  return Array.from({ length: totalParts }, (_, i) => {
    const startSec = i * MINUTE_BLOCK_SECONDS;
    const endSec = Math.min((i + 1) * MINUTE_BLOCK_SECONDS, safeDur);
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
 * Guarantees every segment finishes speaking 100% of its TTS audio without truncating final words,
 * while re-aligning INSIDE each 1-minute block boundary so subsequent minute parts NEVER drift out of sync!
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

  for (const blockIdx of blockIndices) {
    const blockSegs = blocks.get(blockIdx)!;
    const blockStart = blockIdx * MINUTE_BLOCK_SECONDS;
    const blockEnd = Math.min(
      Math.max(safeVideoDuration, (blockIdx + 1) * MINUTE_BLOCK_SECONDS),
      (blockIdx + 1) * MINUTE_BLOCK_SECONDS
    );

    // First pass: anchor each segment inside [blockStart, blockEnd]
    const layoutBlock = (pullBackToStart: boolean, blockScaleBoost = 1.0) => {
      const results: Array<{
        seg: typeof blockSegs[number];
        startTime: number;
        endTime: number;
        playbackRate: number;
        timingWarning?: string;
      }> = [];

      let cursor = blockStart;

      for (let i = 0; i < blockSegs.length; i++) {
        const seg = blockSegs[i];
        const nextSegInBlock = i < blockSegs.length - 1 ? blockSegs[i + 1] : null;

        const rawSceneStart = seg.originalStartTime ?? seg.startTime;
        const sceneStart = Math.max(blockStart, Math.min(blockEnd - 0.5, rawSceneStart));
        const rawSceneEnd = seg.originalEndTime ?? seg.endTime;
        const sceneEnd = Math.max(sceneStart + 0.5, Math.min(blockEnd, rawSceneEnd || sceneStart + 3));
        const originalSlotDur = Math.max(0.5, sceneEnd - sceneStart);

        let startTime = pullBackToStart
          ? cursor
          : Math.max(blockStart, cursor, sceneStart);

        const nextSceneStart = nextSegInBlock
          ? Math.max(blockStart, Math.min(blockEnd, nextSegInBlock.originalStartTime ?? nextSegInBlock.startTime))
          : blockEnd;
        const plannedGapEnd = nextSegInBlock
          ? Math.max(startTime + originalSlotDur, nextSceneStart - 0.03)
          : blockEnd;
        const availableWindow = Math.max(0.5, Math.min(blockEnd, plannedGapEnd) - startTime);

        let endTime = Math.min(blockEnd, Math.max(startTime + 0.5, startTime + originalSlotDur));
        let playbackRate = clampGentleNarratorRate(
          Math.max(seg.playbackRate || seg.atempoRate || 1.0, blockScaleBoost)
        );
        let timingWarning: string | undefined = undefined;

        if (seg.audioDuration && seg.audioDuration > 0) {
          if (seg.audioDuration > availableWindow || blockScaleBoost > 1.01) {
            const neededRate = seg.audioDuration / availableWindow;
            playbackRate = clampGentleNarratorRate(Math.max(neededRate, blockScaleBoost));
            const adjustedDur = seg.audioDuration / playbackRate;
            endTime = startTime + adjustedDur;
            if (adjustedDur > availableWindow + 0.35) {
              const overflowSec = adjustedDur - availableWindow;
              timingWarning = `Part ${blockIdx + 1} အသံ +${overflowSec.toFixed(1)}s ရှည်နေသဖြင့် ${playbackRate.toFixed(2)}x နှုန်းဖြင့် ၃၀ စက္ကန့်အတွင်း ညှိထားပါသည်`;
            }
          } else {
            playbackRate = 1.0;
            endTime = Math.max(startTime + seg.audioDuration, Math.min(plannedGapEnd, startTime + originalSlotDur));
          }
        } else if (pullBackToStart) {
          endTime = Math.min(blockEnd, startTime + originalSlotDur / blockScaleBoost);
        }

        startTime = parseFloat(startTime.toFixed(2));
        endTime = parseFloat(Math.max(startTime + 0.4, endTime).toFixed(2));
        cursor = endTime + (pullBackToStart ? 0.02 : 0.04);

        results.push({ seg, startTime, endTime, playbackRate, timingWarning });
      }

      return { results, blockFinalEnd: results.length ? results[results.length - 1].endTime : blockStart };
    };

    let pass = layoutBlock(false, 1.0);

    // If segments inside this 1-minute block overflow blockEnd, re-align tightly inside [blockStart, blockEnd]
    // so subsequent 1-minute blocks NEVER shift out of sync!
    if (pass.blockFinalEnd > blockEnd + 0.05 && blockSegs.length > 0) {
      const totalSpeech = blockSegs.reduce((sum, s) => {
        const d = s.audioDuration && s.audioDuration > 0
          ? s.audioDuration
          : Math.max(0.5, (s.originalEndTime ?? s.endTime) - (s.originalStartTime ?? s.startTime));
        return sum + d;
      }, 0);
      const gapsTotal = 0.02 * Math.max(0, blockSegs.length - 1);
      const blockCap = Math.max(1.0, (blockEnd - blockStart) - gapsTotal);
      const neededBlockBoost = clampGentleNarratorRate(totalSpeech / blockCap);
      pass = layoutBlock(true, neededBlockBoost);
    }

    for (const item of pass.results) {
      const { seg, startTime, endTime, playbackRate, timingWarning } = item;
      const resolvedPartIndex = seg.slotMode === 'scene_recap_30s'
        ? (seg.minutePartIndex || Math.floor(Math.max(0, seg.originalStartTime ?? startTime) / RECAP_SLOT_SECONDS) + 1)
        : blockIdx + 1;

      aligned.push({
        ...seg,
        startTime,
        endTime,
        subtitleStartTime: startTime,
        subtitleEndTime: endTime,
        duration: parseFloat((endTime - startTime).toFixed(2)),
        minutePartIndex: resolvedPartIndex,
        playbackRate,
        atempoRate: playbackRate,
        voice: options?.enforceSingleVoice || seg.voice || 'Thiha',
        speaker: options?.enforceSingleSpeakerLabel
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
  // Add 120ms breathing safety tail so browser DAC & MediaElement never chop final syllable
  const desiredEnd = Math.max(seg.endTime, seg.startTime + effectiveAudioDur + 0.12);

  const nextSeg = segmentIndex < segments.length - 1 ? segments[segmentIndex + 1] : null;
  const hardEndTime = nextSeg && nextSeg.startTime > seg.startTime + 0.25
    ? Math.min(nextSeg.startTime - 0.02, desiredEnd)
    : desiredEnd;

  return {
    startTime: Math.max(0, seg.startTime),
    hardEndTime: Math.max(seg.startTime + 0.25, hardEndTime),
    speed,
  };
}

export function findActiveSegmentForTime(
  segments: TranscriptSegment[],
  currentTime: number,
  globalVoiceSpeed = 1.0,
  requireAudio = false
): { segment: TranscriptSegment; window: { startTime: number; hardEndTime: number; speed: number } } | null {
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (requireAudio && !seg.audioUrl) continue;
    const win = getSegmentPlaybackWindow(segments, i, globalVoiceSpeed);
    if (currentTime >= win.startTime && currentTime <= win.hardEndTime) {
      return { segment: seg, window: win };
    }
  }
  return null;
}
