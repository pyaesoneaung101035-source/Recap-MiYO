import { SubtitleSettings } from '../types';

/**
 * Intelligent subtitle text wrapping helper.
 * Accurately segments long Myanmar (Burmese), English, and multilingual text
 * into multiple readable lines that fit within maxWidth without clipping off-screen.
 */
export function wrapSubtitleLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  if (!text || !text.trim()) return [];

  // Preserve explicit newlines from user editing
  const paragraphs = text.split(/\r?\n/);
  const finalLines: string[] = [];

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;

    // Fast path: if paragraph already fits in one line, keep as is
    if (ctx.measureText(trimmedPara).width <= maxWidth) {
      finalLines.push(trimmedPara);
      continue;
    }

    // Segment paragraph into word/syllable units
    let tokens: string[] = [];

    // Use Intl.Segmenter if supported by browser for natural Burmese/CJK/Latin word breaking
    if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
      try {
        const segmenter = new (Intl as any).Segmenter(['my', 'en', 'zh', 'ja'], {
          granularity: 'word',
        });
        tokens = Array.from(segmenter.segment(trimmedPara), (s: any) => s.segment);
      } catch {
        tokens = [];
      }
    }

    // Fallback if Intl.Segmenter is unavailable or returned empty:
    // Split by spaces, Burmese punctuation marks (၊ , ။), commas, periods
    if (tokens.length === 0) {
      tokens = trimmedPara.split(/(\s+|(?<=[၊။?!,\.\s]))/);
    }

    let currentLine = '';

    for (const token of tokens) {
      if (!token) continue;

      const candidateLine = currentLine ? currentLine + token : token;
      const lineWidth = ctx.measureText(candidateLine).width;

      if (lineWidth <= maxWidth) {
        currentLine = candidateLine;
      } else {
        // Line would exceed maxWidth.
        // If we have content accumulated in currentLine, push it to lines.
        if (currentLine.trim()) {
          finalLines.push(currentLine.trim());
          currentLine = '';
        }

        // Now check if this single token by itself is larger than maxWidth:
        // (e.g. an unbroken long Burmese compound phrase or long word)
        if (ctx.measureText(token).width > maxWidth) {
          // Break token into smaller sub-chunks
          let subLine = '';
          const graphemes = Array.from(token);
          for (const ch of graphemes) {
            const testChunk = subLine + ch;
            if (ctx.measureText(testChunk).width <= maxWidth) {
              subLine = testChunk;
            } else {
              if (subLine.trim()) {
                finalLines.push(subLine.trim());
              }
              subLine = ch;
            }
          }
          currentLine = subLine;
        } else {
          currentLine = token;
        }
      }
    }

    if (currentLine.trim()) {
      finalLines.push(currentLine.trim());
    }
  }

  return finalLines.length > 0 ? finalLines : [text];
}

export interface DrawSubtitleParams {
  ctx: CanvasRenderingContext2D;
  text: string;
  settings: SubtitleSettings;
  canvasWidth: number;
  canvasHeight: number;
  scaleFactor: number;
}

/**
 * Draws wrapped multi-line subtitles on canvas with background pill and stroke.
 */
export function drawCanvasSubtitle({
  ctx,
  text,
  settings,
  canvasWidth,
  canvasHeight,
  scaleFactor,
}: DrawSubtitleParams): void {
  if (!text || !text.trim()) return;

  ctx.save();

  const baseFontSize = Math.max(26, settings.fontSize || 28);
  const targetFontSize = Math.round(baseFontSize * scaleFactor);
  const cleanFont = (settings.fontFamily || 'Pyidaungsu').replace(/['"]/g, '').trim();

  // Set font
  ctx.font = `bold ${targetFontSize}px "${cleanFont}", "Noto Sans Myanmar", sans-serif`;
  if (ctx.font.startsWith('10px') || ctx.font.includes('10px sans-serif')) {
    ctx.font = `bold ${targetFontSize}px sans-serif`;
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Subtitle maximum width before wrapping into the next line:
  // In portrait (9:16), use 84% of canvas width to leave comfortable safe margins.
  // In landscape (16:9), limit to ~75% of canvas width.
  const isLandscape = canvasWidth > canvasHeight;
  const maxSubtitleWidth = Math.round(
    canvasWidth * (isLandscape ? 0.75 : 0.84)
  );

  // Wrap text into multiple lines
  const lines = wrapSubtitleLines(ctx, text, maxSubtitleWidth);
  const numLines = lines.length;

  // Line height proportional to font size
  const lineHeight = Math.round(targetFontSize * 1.38);
  const totalTextHeight = numLines * lineHeight;

  // Determine Y anchor
  let posY = canvasHeight * 0.85;
  if (settings.positionY === 'center') {
    posY = canvasHeight * 0.5;
  } else if (settings.positionY === 'top') {
    posY = canvasHeight * 0.12;
  }

  const textX = canvasWidth / 2 + (settings.offsetX || 0) * scaleFactor;
  const textY = posY + (settings.offsetY || 0) * scaleFactor;

  // Calculate bounding box for background
  let maxLineWidth = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w > maxLineWidth) maxLineWidth = w;
  }

  const padX = Math.round(24 * scaleFactor);
  const padY = Math.round(14 * scaleFactor);
  const bgWidth = Math.min(canvasWidth - 20, maxLineWidth + padX * 2);
  const bgHeight = totalTextHeight + padY * 2;
  const radius = Math.round(12 * scaleFactor);

  // Background Box
  if (settings.backgroundColor && settings.backgroundColor !== 'transparent') {
    ctx.fillStyle = settings.backgroundColor;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(
        textX - bgWidth / 2,
        textY - bgHeight / 2,
        bgWidth,
        bgHeight,
        radius
      );
    } else {
      ctx.rect(
        textX - bgWidth / 2,
        textY - bgHeight / 2,
        bgWidth,
        bgHeight
      );
    }
    ctx.fill();
  }

  // Calculate starting Y for the first line so all lines are centered around textY
  const startY = textY - ((numLines - 1) * lineHeight) / 2;

  const strokeWidth = Math.max(2.5, (settings.strokeWidth || 3) * scaleFactor);

  // Render each line
  lines.forEach((line, idx) => {
    const lineY = startY + idx * lineHeight;

    if (strokeWidth > 0) {
      ctx.strokeStyle = settings.strokeColor || '#000000';
      ctx.lineWidth = strokeWidth * 2;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeText(line, textX, lineY);
    }

    ctx.fillStyle = settings.color || '#ffffff';
    ctx.fillText(line, textX, lineY);
  });

  ctx.restore();
}
