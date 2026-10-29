import { loadApiKeys } from './apiKeys';
import { TranscriptSegment } from '../types';
import { extractAudioFromVideo } from './audioExtractor';
import { callGeminiWithRotation } from './geminiPool';

export interface AssemblyAiUtterance {
  start: number; // in milliseconds
  end: number; // in milliseconds
  text: string;
  confidence?: number;
  speaker?: string;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function transcribeVideoWithAssemblyAi(
  videoSource: File | string,
  options?: {
    onProgress?: (msg: string) => void;
  }
): Promise<TranscriptSegment[]> {
  const { assemblyAiKey } = loadApiKeys();
  const cleanKey = (assemblyAiKey || '').replace(/[^\x21-\x7E]/g, '').trim();
  if (!cleanKey) {
    throw new Error('AssemblyAI API Key မတွေ့ရှိပါ။ Step 1 တွင် AssemblyAI Key (32-digit Token) ထည့်သွင်းပေးပါ။');
  }

  const onProgress = options?.onProgress || (() => {});

  // 1. Extract audio from video
  onProgress('🎙️ [AssemblyAI Whisper] - ဗီဒီယိုမှ အသံလှိုင်းကို 16kHz Speech Format ဖြင့် ထုတ်ယူနေပါသည်...');
  const { base64Wav } = await extractAudioFromVideo(videoSource, 600); // up to 10 mins

  const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  // 2. Upload audio to AssemblyAI
  onProgress('☁️ [AssemblyAI Whisper] - အသံဖိုင်ကို AssemblyAI Cloud သို့ လုံခြုံစွာ ပေးပို့နေပါသည်...');
  let uploadUrl = '';

  try {
    const binaryData = base64ToUint8Array(base64Wav);
    const directUploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: {
        Authorization: cleanKey,
        'Content-Type': 'application/octet-stream',
      },
      body: binaryData as unknown as BodyInit,
    });

    if (directUploadRes.ok) {
      const directUploadData = await directUploadRes.json();
      uploadUrl = directUploadData.upload_url || '';
    } else {
      const errText = await directUploadRes.text().catch(() => '');
      console.warn('Direct AssemblyAI upload error:', directUploadRes.status, errText);
    }
  } catch (directUploadErr) {
    console.warn('Direct AssemblyAI upload exception:', directUploadErr);
  }

  // Server proxy upload fallback (only on localhost Express)
  if (!uploadUrl && isLocalhost) {
    try {
      const uploadRes = await fetch('/api/assemblyai/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: cleanKey,
          base64Audio: base64Wav,
        }),
      });

      if (uploadRes.ok) {
        const uploadData = await uploadRes.json();
        uploadUrl = uploadData.upload_url || '';
      }
    } catch (serverUploadErr) {
      console.warn('Server AssemblyAI upload notice:', serverUploadErr);
    }
  }

  if (!uploadUrl) {
    throw new Error('AssemblyAI သို့ အသံဖိုင် ပေးပို့မှု မအောင်မြင်ပါ။ ကျေးဇူးပြု၍ API Key သို့မဟုတ် ကွန်ရက် ချိတ်ဆက်မှုကို စစ်ဆေးပေးပါ။');
  }

  // 3. Request transcription with accurate punctuation & timestamps
  onProgress('⚡ [AssemblyAI Whisper] - Speech-to-Text Model စတင် အလုပ်လုပ်နေပါသည်...');
  let transcriptId = '';

  try {
    const directTranscribRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        Authorization: cleanKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: uploadUrl,
        punctuate: true,
        format_text: true,
      }),
    });

    if (directTranscribRes.ok) {
      const directTranscribData = await directTranscribRes.json();
      transcriptId = directTranscribData.id || '';
    }
  } catch (directTranscribErr) {
    console.warn('Direct AssemblyAI transcript notice:', directTranscribErr);
  }

  // Server proxy transcript fallback (only on localhost Express)
  if (!transcriptId && isLocalhost) {
    try {
      const transcriptRes = await fetch('/api/assemblyai/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: cleanKey,
          endpoint: 'transcript',
          method: 'POST',
          body: {
            audio_url: uploadUrl,
            punctuate: true,
            format_text: true,
            speech_models: ['universal-3-5-pro', 'universal-2'],
          },
        }),
      });

      if (transcriptRes.ok) {
        const transcriptData = await transcriptRes.json();
        transcriptId = transcriptData.id || '';
      }
    } catch (serverTranscribErr) {
      console.warn('Server AssemblyAI proxy transcript notice:', serverTranscribErr);
    }
  }

  if (!transcriptId) {
    throw new Error('AssemblyAI transcription စတင်၍ မရပါ။ ကျေးဇူးပြု၍ API Key ကို စစ်ဆေးပေးပါ။');
  }

  // 4. Poll until completed
  let pollAttempts = 0;
  let finalResult: any = null;

  while (pollAttempts < 90) {
    pollAttempts++;
    await new Promise((r) => setTimeout(r, 2500));

    onProgress(`⏳ [AssemblyAI Whisper] - စကားသံများကို ခွဲခြမ်းစိပ်ဖြာနေပါသည်... (${pollAttempts * 2}s)`);

    let pollData: any = null;

    if (isLocalhost) {
      try {
        const pollRes = await fetch('/api/assemblyai/proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: cleanKey,
            endpoint: `transcript/${transcriptId}`,
            method: 'GET',
          }),
        });

        if (pollRes.ok) {
          pollData = await pollRes.json();
        }
      } catch {}
    }

    if (!pollData) {
      try {
        const directPollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
          method: 'GET',
          headers: {
            Authorization: cleanKey,
          },
        });
        if (directPollRes.ok) {
          pollData = await directPollRes.json();
        }
      } catch {}
    }

    if (pollData) {
      if (pollData.status === 'completed') {
        finalResult = pollData;
        break;
      }
      if (pollData.status === 'error') {
        throw new Error(pollData.error || 'AssemblyAI transcription error occurred');
      }
    }
  }

  if (!finalResult) {
    throw new Error('AssemblyAI processing timed out. Please try again with a shorter video clip.');
  }

  // 5. Extract sentences/utterances with exact start and end timestamps
  onProgress('📝 [Whisper Output] - Timestamps များနှင့် မူရင်းစကားများကို စုစည်းနေပါသည်...');

  interface RawItem {
    start: number;
    end: number;
    text: string;
  }

  let items: RawItem[] = [];

  // Try sentences first
  if (Array.isArray(finalResult.sentences) && finalResult.sentences.length > 0) {
    items = finalResult.sentences.map((s: any) => ({
      start: Math.max(0, s.start / 1000),
      end: Math.max(s.start / 1000 + 1.5, s.end / 1000),
      text: s.text.trim(),
    }));
  } else if (Array.isArray(finalResult.utterances) && finalResult.utterances.length > 0) {
    items = finalResult.utterances.map((u: any) => ({
      start: Math.max(0, u.start / 1000),
      end: Math.max(u.start / 1000 + 1.5, u.end / 1000),
      text: u.text.trim(),
    }));
  } else if (Array.isArray(finalResult.words) && finalResult.words.length > 0) {
    // Group words into 4-6 second chunks
    let currentChunk: any[] = [];
    let chunkStart = 0;

    for (const w of finalResult.words) {
      if (currentChunk.length === 0) chunkStart = w.start / 1000;
      currentChunk.push(w.text);
      if (w.text.match(/[.!?]$/) || (w.end / 1000 - chunkStart) >= 4.0) {
        items.push({
          start: chunkStart,
          end: w.end / 1000,
          text: currentChunk.join(' '),
        });
        currentChunk = [];
      }
    }
    if (currentChunk.length > 0) {
      const lastWord = finalResult.words[finalResult.words.length - 1];
      items.push({
        start: chunkStart,
        end: lastWord.end / 1000,
        text: currentChunk.join(' '),
      });
    }
  }

  if (items.length === 0) {
    // Fallback if no words/sentences detected
    items.push({
      start: 0,
      end: 5,
      text: finalResult.text || 'Dialogue',
    });
  }

  // 6. Translate directly to natural Myanmar conversation (NO narrator style)
  onProgress('🇲🇲 [Direct Myanmar Translation] - သဘာဝကျသော လူပြောစကား မြန်မာစကားပြောအဖြစ် တိုက်ရိုက် ဘာသာပြန်ဆိုနေပါသည် (Narrator ပုံစံမသုံးပါ)...');

  const translationPrompt = `
You are a professional film dubbing translator. Translate the following transcribed video speech sentences line-by-line directly into natural, conversational Burmese dialogue (မြန်မာစကားပြော).

CRITICAL DUBBING TRANSLATION INSTRUCTIONS:
1. TRANSLATE EACH LINE FAITHFULLY according to the spoken meaning in the original video sentence.
2. DO NOT WRITE IN NARRATOR STYLE (narrator ပုံစံဖြင့် လုံးဝမရေးရ). Use direct spoken dialogue or authentic movie dubbing style.
3. Keep each Burmese line concise (<12-18 words) so the spoken TTS audio fits the exact video timestamp slot.
4. Do NOT add extraneous summary facts or commentary. Translate line #1 to line #1, line #2 to line #2.
5. Return ONLY a valid JSON array matching this exact format:
[
  { "id": 1, "translation": "မြန်မာစကားပြောစာသား" }
]

SPOKEN LINES FROM CUSTOM VIDEO TO TRANSLATE:
${JSON.stringify(items.map((it, idx) => ({ id: idx + 1, original_spoken_text: it.text })), null, 2)}
`;

  let translationsMap: Record<number, string> = {};

  try {
    onProgress('✨ [Gemini AI Engine] - Google Gemini ဖြင့် သဘာဝကျသော မြန်မာစကားပြောအဖြစ် တိုက်ရိုက် ဘာသာပြန်နေပါသည်...');
    const { text: geminiRes } = await callGeminiWithRotation(
      translationPrompt,
      'You are an expert bilingual subtitle translator. Translate English speech directly into authentic, conversational Burmese dialogue. Never use narrator framing.'
    );
    const cleanJson = geminiRes.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJson);
    if (Array.isArray(parsed)) {
      parsed.forEach((p: any) => {
        if (p.id && (p.translation || p.text)) {
          translationsMap[p.id] = p.translation || p.text;
        }
      });
    }
  } catch (geminiErr: any) {
    console.warn('Gemini translation notice:', geminiErr);
    if (onProgress) {
      onProgress('💡 [AssemblyAI Whisper Completed] - Subtitle Segments များကို တိကျသော Timestamp များဖြင့် ထုတ်ယူပေးထားပါသည်။ (Gemini Key ထည့်သွင်းပါက မြန်မာစကားပြော ပိုမိုပြည့်စုံစွာ ပြန်ဆိုပေးပါမည်)');
    }
  }

  // 7. Assemble segments
  const segments: TranscriptSegment[] = items.map((it, idx) => {
    const burmeseText = translationsMap[idx + 1] || it.text;
    return {
      id: `assembly_${idx + 1}_${Date.now()}`,
      startTime: parseFloat(it.start.toFixed(2)),
      endTime: parseFloat(it.end.toFixed(2)),
      originalText: it.text,
      myanmarTranslation: burmeseText,
      voice: idx % 2 === 0 ? 'Thiha' : 'Nilar',
    };
  });

  onProgress(`✅ [ပြီးစီးပါပြီ] - AssemblyAI Whisper ဖြင့် တိကျသော Subtitle Segment စုစုပေါင်း ${segments.length} ခုကို တိုက်ရိုက် ဘာသာပြန်ပြီးပါပြီ!`);
  return segments;
}
