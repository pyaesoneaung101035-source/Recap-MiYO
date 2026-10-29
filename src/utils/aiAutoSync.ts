import { TranscriptSegment } from '../types';
import { callGeminiWithRotation } from './geminiPool';

export type SyncSpeedMode = 'fitDuration' | 'speedWarp' | 'timelineCutSnap';

export interface AutoSyncResult {
  segments: TranscriptSegment[];
  summary: string;
}

/**
 * Pure mathematical Auto-Sync:
 * Adjusts videoPlaybackRate and/or timeline cut boundaries (startTime / endTime)
 * so that Voice Clone and Subtitles match 100% with the video without overlap or drift.
 */
export function calculateAutoSyncSpeedAndCuts(
  segments: TranscriptSegment[],
  mode: SyncSpeedMode = 'fitDuration',
  breathPause = 0.12
): AutoSyncResult {
  if (!segments || segments.length === 0) {
    return { segments, summary: 'No segments to synchronize.' };
  }

  let runningTime = 0;
  let adjustedCount = 0;

  const updatedSegments: TranscriptSegment[] = segments.map((seg, idx) => {
    const rawVoiceDuration = seg.audioDuration || (seg.endTime - seg.startTime);
    const voiceSpeed = seg.playbackRate || 1.0;
    // Effective audio duration in seconds
    const effectiveAudioDuration = parseFloat((rawVoiceDuration / voiceSpeed).toFixed(2));
    
    // Original timeline duration planned for this video scene
    const originalDuration = Math.max(0.4, (seg.originalEndTime || seg.endTime) - (seg.originalStartTime || seg.startTime));

    let videoSpeed = seg.videoPlaybackRate || 1.0;
    let newStart = seg.startTime;
    let newEnd = seg.endTime;

    if (mode === 'fitDuration') {
      // FIT DURATION MODE:
      // If voice is longer than scene (audio > orig), slow down video (e.g. 0.7x) so video scene lasts long enough to cover speech.
      // If voice is shorter than scene (audio < orig), speed up video (e.g. 1.4x) so video moves to the next scene without dead air.
      const ratio = originalDuration / effectiveAudioDuration;
      videoSpeed = parseFloat(Math.max(0.5, Math.min(2.5, ratio)).toFixed(2));

      // Also snap subtitle timeline to exact voice duration
      if (idx === 0) {
        newStart = Math.max(0, seg.startTime);
      } else {
        newStart = parseFloat((runningTime + breathPause).toFixed(2));
      }
      newEnd = parseFloat((newStart + effectiveAudioDuration + 0.1).toFixed(2));
      runningTime = newEnd;
      adjustedCount++;
    } else if (mode === 'speedWarp') {
      // DYNAMIC ACTION SPEED WARP:
      // If voice is long, speed up video to keep recap snappy. If voice is short, slow down video.
      const ratio = effectiveAudioDuration / originalDuration;
      videoSpeed = parseFloat(Math.max(0.5, Math.min(2.5, ratio)).toFixed(2));

      newStart = idx === 0 ? seg.startTime : parseFloat((runningTime + breathPause).toFixed(2));
      newEnd = parseFloat((newStart + effectiveAudioDuration + 0.1).toFixed(2));
      runningTime = newEnd;
      adjustedCount++;
    } else if (mode === 'timelineCutSnap') {
      // TIMELINE CUT & SNAP (100% Subtitle & Voice Lock):
      // Keeps base video speed at 1.0x, but perfectly chains every subtitle & video cut segment
      // exactly to the voice duration so subtitles never disappear early or overlap.
      videoSpeed = 1.0;
      newStart = idx === 0 ? Math.max(0, seg.startTime) : parseFloat((runningTime + breathPause).toFixed(2));
      newEnd = parseFloat((newStart + effectiveAudioDuration + 0.1).toFixed(2));
      runningTime = newEnd;
      adjustedCount++;
    }

    return {
      ...seg,
      startTime: newStart,
      endTime: newEnd,
      videoPlaybackRate: videoSpeed,
      isTimingFixed: true,
    };
  });

  const summary = `✓ Segments ${adjustedCount} ခုလုံးကို Voice Clone နှင့် Subtitle ကွက်တိဖြစ်အောင် Auto-Speed နှင့် Timeline Cut ချိတ်ဆက်ပေးလိုက်ပါပြီ။`;
  return { segments: updatedSegments, summary };
}

/**
 * AI API Auto System (Google Gemini API):
 * Analyzes speech pacing, sentence emotions, punctuation, and video rhythm.
 * Generates frame-accurate video cut timestamps and dynamic speed factors.
 */
export async function aiAnalyzeAutoSync(
  segments: TranscriptSegment[],
  videoDuration: number,
  aiMode = 'Recap'
): Promise<AutoSyncResult> {
  if (!segments || segments.length === 0) {
    throw new Error('စာသား segments များ မရှိသေးပါ။ အဆင့် ၄ တွင် အရင်ထုတ်လုပ်ပေးပါ။');
  }

  const segmentData = segments.map((s, idx) => ({
    id: s.id,
    index: idx + 1,
    text: s.myanmarTranslation || s.originalText,
    audioDuration: s.audioDuration ? parseFloat(s.audioDuration.toFixed(2)) : parseFloat((s.endTime - s.startTime).toFixed(2)),
    currentStart: s.startTime,
    currentEnd: s.endTime,
  }));

  const prompt = `
YOU ARE AN ELITE AI VIDEO EDITOR AND RHYTHM PACER FOR MYANMAR CONTENT.
Task: Synchronize Video Segments, Voice Clone audio clips, and Subtitles with frame-perfect precision.

Video Total Duration: ${videoDuration || 60} seconds.
Content Mode: ${aiMode}.
Number of Segments: ${segments.length}.

Input Segments:
${JSON.stringify(segmentData, null, 2)}

REQUIREMENTS:
1. Every segment MUST start after the previous segment finishes (no overlapping timestamps!).
2. For each segment, the duration (endTime - startTime) must accommodate the audioDuration plus a clean 0.10s-0.25s breathing pause at sentence ends.
3. Calculate an optimal "videoPlaybackRate" (between 0.60 and 2.00) for each segment:
   - If audioDuration is long and content is exciting recap, use speed 1.10 - 1.50 to keep the visuals dynamic.
   - If audioDuration requires more visual time or is emotional/soothing, use speed 0.70 - 0.95.
   - For normal speech, use 1.00.
4. Output MUST be ONLY a valid JSON array of objects with keys: "id", "startTime", "endTime", "videoPlaybackRate", and "pacingReason".

Example JSON format:
[
  {
    "id": "p1_1_123",
    "startTime": 0.0,
    "endTime": 3.85,
    "videoPlaybackRate": 1.15,
    "pacingReason": "Intro hook with dynamic pace"
  }
]
`;

  const systemInstruction = 'You are an expert AI video timeline synchronizer. Output ONLY pure valid JSON, no markdown codeblocks, no explanations.';
  let rawRes = '';
  let usedKeyName = 'Gemini AI';

  const res = await callGeminiWithRotation(
    prompt,
    systemInstruction,
    'gemini-2.0-flash'
  );
  rawRes = res.text;
  usedKeyName = res.usedKeyName;

  const cleaned = rawRes.replace(/```json/gi, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('AI API did not return valid pacing array.');
  }

  const lookupMap = new Map<string, any>();
  parsed.forEach((p) => {
    if (p.id) lookupMap.set(p.id, p);
  });

  let runningStart = 0;
  const updatedSegments = segments.map((seg, idx) => {
    const aiItem = lookupMap.get(seg.id) || parsed[idx];
    const audioDur = seg.audioDuration || (seg.endTime - seg.startTime);
    const voiceSpeed = seg.playbackRate || 1.0;
    const effectiveAudio = audioDur / voiceSpeed;

    let sTime = aiItem && typeof aiItem.startTime === 'number' ? aiItem.startTime : runningStart;
    // Prevent backward jump
    if (sTime < runningStart) sTime = runningStart;

    let eTime = aiItem && typeof aiItem.endTime === 'number' ? aiItem.endTime : sTime + effectiveAudio + 0.15;
    if (eTime <= sTime + effectiveAudio) {
      eTime = parseFloat((sTime + effectiveAudio + 0.15).toFixed(2));
    }

    const vSpeed = aiItem && typeof aiItem.videoPlaybackRate === 'number'
      ? Math.max(0.5, Math.min(2.5, parseFloat(aiItem.videoPlaybackRate.toFixed(2))))
      : 1.0;

    runningStart = parseFloat((eTime + 0.05).toFixed(2));

    return {
      ...seg,
      startTime: parseFloat(sTime.toFixed(2)),
      endTime: parseFloat(eTime.toFixed(2)),
      videoPlaybackRate: vSpeed,
      isTimingFixed: true,
    };
  });

  return {
    segments: updatedSegments,
    summary: `🎉 Gemini AI API (${usedKeyName}) ဖြင့် ဗီဒီယိုအမြန်နှုန်းနှင့် Subtitle Timeline ကို 100% ကွက်တိ အလိုအလျောက် ချိန်ညှိပြီးပါပြီ!`,
  };
}
