import { AlightKeyframe, TranscriptSegment, SubtitleSettings } from '../types';

export interface InterpolatedMotionState {
  scale: number;
  posX: number;
  posY: number;
  rotation: number;
  opacity: number;
  blur: number;
  shakeIntensity: number;
  filter: string;
}

/**
 * Interpolates keyframe attributes at the given timestamp
 */
export function getInterpolatedKeyframe(
  keyframes: AlightKeyframe[],
  time: number
): InterpolatedMotionState {
  const defaultState: InterpolatedMotionState = {
    scale: 1,
    posX: 0,
    posY: 0,
    rotation: 0,
    opacity: 1,
    blur: 0,
    shakeIntensity: 0,
    filter: 'none',
  };

  if (!keyframes || keyframes.length === 0) {
    return defaultState;
  }

  // Sort keyframes chronologically
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  // If time is before first keyframe
  if (time <= sorted[0].time) {
    const k = sorted[0];
    return {
      scale: k.scale,
      posX: k.posX,
      posY: k.posY,
      rotation: k.rotation,
      opacity: k.opacity,
      blur: k.blur,
      shakeIntensity: k.shakeIntensity,
      filter: k.filter,
    };
  }

  // If time is after last keyframe
  if (time >= sorted[sorted.length - 1].time) {
    const k = sorted[sorted.length - 1];
    return {
      scale: k.scale,
      posX: k.posX,
      posY: k.posY,
      rotation: k.rotation,
      opacity: k.opacity,
      blur: k.blur,
      shakeIntensity: k.shakeIntensity,
      filter: k.filter,
    };
  }

  // Find surrounding keyframes
  let prev = sorted[0];
  let next = sorted[1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (time >= sorted[i].time && time <= sorted[i + 1].time) {
      prev = sorted[i];
      next = sorted[i + 1];
      break;
    }
  }

  const duration = next.time - prev.time;
  const factor = duration > 0 ? (time - prev.time) / duration : 0;
  // Smooth cubic ease-in-out curve
  const ease = factor < 0.5 ? 4 * factor * factor * factor : 1 - Math.pow(-2 * factor + 2, 3) / 2;

  return {
    scale: prev.scale + (next.scale - prev.scale) * ease,
    posX: prev.posX + (next.posX - prev.posX) * ease,
    posY: prev.posY + (next.posY - prev.posY) * ease,
    rotation: prev.rotation + (next.rotation - prev.rotation) * ease,
    opacity: prev.opacity + (next.opacity - prev.opacity) * ease,
    blur: prev.blur + (next.blur - prev.blur) * ease,
    shakeIntensity: prev.shakeIntensity + (next.shakeIntensity - prev.shakeIntensity) * ease,
    filter: factor > 0.5 ? next.filter : prev.filter,
  };
}

/**
 * Maps filter preset to CSS / Canvas filter string
 */
export function getFilterCss(filterName: string): string {
  switch (filterName) {
    case 'cinematic':
      return 'contrast(1.15) saturate(1.2) brightness(0.95)';
    case 'warm':
      return 'sepia(0.2) saturate(1.3) hue-rotate(-10deg)';
    case 'vintage':
      return 'sepia(0.4) contrast(0.9) brightness(1.05)';
    case 'cyber':
      return 'contrast(1.3) saturate(1.5) hue-rotate(180deg)';
    case 'dhamma_gold':
      return 'sepia(0.35) saturate(1.4) brightness(1.1) drop-shadow(0 0 10px rgba(234,179,8,0.3))';
    default:
      return 'none';
  }
}

/**
 * Returns preset keyframe animation packs
 */
export function getMotionPresets(currentTime: number): { [key: string]: AlightKeyframe[] } {
  const t = Math.max(0, currentTime);
  return {
    smoothZoom: [
      {
        id: 'kf_' + Math.random().toString(36).substring(2, 7),
        time: t,
        scale: 1.0,
        posX: 0,
        posY: 0,
        rotation: 0,
        opacity: 1,
        blur: 0,
        shakeIntensity: 0,
        filter: 'none',
      },
      {
        id: 'kf_' + Math.random().toString(36).substring(2, 7),
        time: t + 1.5,
        scale: 1.25,
        posX: 0,
        posY: 0,
        rotation: 0,
        opacity: 1,
        blur: 0,
        shakeIntensity: 0,
        filter: 'cinematic',
      },
      {
        id: 'kf_' + Math.random().toString(36).substring(2, 7),
        time: t + 3.0,
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
    impactShake: [
      {
        id: 'kf_' + Math.random().toString(36).substring(2, 7),
        time: t,
        scale: 1.0,
        posX: 0,
        posY: 0,
        rotation: 0,
        opacity: 1,
        blur: 0,
        shakeIntensity: 0,
        filter: 'none',
      },
      {
        id: 'kf_' + Math.random().toString(36).substring(2, 7),
        time: t + 0.15,
        scale: 1.12,
        posX: 0,
        posY: 0,
        rotation: 2,
        opacity: 1,
        blur: 1,
        shakeIntensity: 8,
        filter: 'cyber',
      },
      {
        id: 'kf_' + Math.random().toString(36).substring(2, 7),
        time: t + 0.8,
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
    dhammaAura: [
      {
        id: 'kf_' + Math.random().toString(36).substring(2, 7),
        time: t,
        scale: 1.0,
        posX: 0,
        posY: 0,
        rotation: 0,
        opacity: 0.9,
        blur: 0,
        shakeIntensity: 0,
        filter: 'none',
      },
      {
        id: 'kf_' + Math.random().toString(36).substring(2, 7),
        time: t + 2.5,
        scale: 1.06,
        posX: 0,
        posY: -10,
        rotation: 0,
        opacity: 1,
        blur: 0,
        shakeIntensity: 0,
        filter: 'dhamma_gold',
      },
    ],
  };
}

/**
 * Generate formatted .SRT subtitle file from segments
 */
export function generateSrtContent(segments: TranscriptSegment[]): string {
  function formatTime(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  function formatBurmeseLines(text: string): string {
    const cleaned = text.replace(/[\u4e00-\u9fa5\u3000-\u303f\uff01-\uff5e]/g, '').trim();
    if (!cleaned) return '';

    const explicit = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (explicit.length > 0 && explicit.length <= 2 && explicit.every((l) => l.length <= 40)) {
      return explicit.join('\n');
    }

    if (cleaned.length <= 35) {
      return cleaned;
    }

    const tokens = cleaned.split(/(\s+|(?<=[၊။]))/);
    let line1 = '';
    let line2 = '';
    const mid = Math.floor(cleaned.length / 2);

    for (const t of tokens) {
      if ((line1 + t).length <= mid || !line1) {
        line1 += t;
      } else {
        line2 += t;
      }
    }

    const t1 = line1.trim();
    const t2 = line2.trim();
    return t2 ? `${t1}\n${t2}` : t1;
  }

  return segments
    .filter((seg) => (seg.subtitleText || seg.myanmarTranslation || seg.originalText || '').trim().length > 0)
    .map((seg, idx) => {
      const start = formatTime(seg.startTime);
      const end = formatTime(seg.endTime);
      const text = formatBurmeseLines(seg.subtitleText || seg.myanmarTranslation || seg.originalText);
      return `${idx + 1}\n${start} --> ${end}\n${text}\n`;
    })
    .join('\n');
}

/**
 * Download file helper with delayed URL revocation for reliable downloads
 */
export function downloadFile(content: string | Blob, filename: string, type: string) {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // Delay revokeObjectURL by 60 seconds so browser download manager can finish reading the stream
  setTimeout(() => {
    try {
      if (document.body.contains(a)) {
        document.body.removeChild(a);
      }
      URL.revokeObjectURL(url);
    } catch {}
  }, 60000);
}
