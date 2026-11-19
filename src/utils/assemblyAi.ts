import { loadApiKeys } from './apiKeys';
import { TranscriptSegment, Step3ScriptStyle } from '../types';
import { extractAudioFromVideo } from './audioExtractor';
import { callGeminiWithRotation, countBurmeseSyllables, calculateMaxAllowedSyllables } from './geminiPool';
import { MINUTE_BLOCK_SECONDS, realignSegmentsByMinuteBlocks } from './timingSync';

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
    scriptStyle?: Step3ScriptStyle;
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

  // 6. Gemini Timeline Re-segmentation & Duration-Budgeted Burmese Translation
  const scriptStyle: Step3ScriptStyle = options?.scriptStyle || 'narrator';
  const speakerLabel =
    scriptStyle === 'translation'
      ? 'Translator (ဘာသာပြန်)'
      : scriptStyle === 'story'
        ? 'Storyteller (ဇာတ်လမ်းပြောသူ)'
        : 'Narrator (ဇာတ်ကြောင်းပြောသူ)';

  const styleDirective =
    scriptStyle === 'translation'
      ? `TRANSLATION MODE ("3. TRANSLATION"):
- Translate EVERY source line directly, accurately, and faithfully into natural Burmese.
- Do NOT rewrite as a third-person commentator or summary storyteller. Translate the dialogue/voice lines faithfully word-for-word and intent-for-intent.`
      : scriptStyle === 'story'
        ? `STORYTELLING MODE ("2. STORY"):
- Retell the sequence of events as an engaging oral storyteller ("လူတစ်ယောက် Story ပြောပြနေသလို ဇာတ်လမ်းဆန်ဆန်").
- Build suspense, hooks, and dramatic narrative flow between scenes.`
        : `REFERENCE SHORT-DRAMA NARRATOR MODE ("1. NARRATOR — BLENDED RECAP & INLINE DIALOGUE"):
- Jump straight into the visual/action hook with ZERO greeting filler ("မင်္ဂလာပါ/ဒီဇာတ်လမ်းမှာ" မထည့်ရ).
- Blend 3rd-person recap ("...ဆိုတာ သူ နားလည်သွားတယ်", "သူ အလွတ်မပေးဘူး") seamlessly with crisp inline character quotes/thoughts ("၁ ကီလို ရွှေတုံး ရှိလား?", "ရှိပါတယ်။ ခဏစောင့်ပါ။") voiced by ONE single narrator in short 1.8s–4.5s micro-clauses (~3.6 syllables/sec).
- BAN repetitive "...ပါတယ်။ / ...နေပါတယ်။ / ...ဖြစ်ပါတယ်။" textbook suffixes (except inside polite character replies). Use varied endings ("...သွားတယ်", "...နိုင်ပြီ", "...မယ်", "...ဘူး", "...ပဲ", "...လား?", "...နော်!").`;

  onProgress(`🇲🇲 [Gemini Timeline Engine] - မူရင်း video timeline အတိုင်း ${scriptStyle.toUpperCase()} စာသားများကို Gemini ဖြင့် ပြင်ဆင်နေပါသည်...`);

  const translationPrompt = `
You are a senior Burmese dubbing & storytelling director.
Active Mode: ${scriptStyle.toUpperCase()}
Speaker: "${speakerLabel}"

${styleDirective}

CRITICAL INSTRUCTIONS (MUST FOLLOW STRICTLY):
1. SEQUENTIAL CHRONOLOGICAL TRANSLATION & SCENE ALIGNMENT: Follow the exact sequence of spoken lines and events at their real timestamps. Do NOT skip dialogue or invent unseen facts.
2. BAN REPETITIVE "တယ် / ပါတယ်" ENDINGS (တယ်တယ် များမနေစေရ):
   - NEVER end every line with textbook "...ပါတယ်။", "...နေပါတယ်။", "...ဖြစ်ပါတယ်။", "...သွားပါတယ်။".
   - Write natural spoken Burmese mixing varied crisp endings.
3. EXPRESSIVE VOCAL EMOTION TAGS & PUNCTUATION:
   - Put "!" on surprising/shocking/threatening lines and "?" on questions so Voice Clone varies vocal pitch naturally!
   - Set specific "emotion" tag per segment: "surprised, amazed" | "curious, questioning" | "mocking, smug" | "determined, fierce" | "urgent, tense" | "sad, heartfelt" | "calm storytelling".
4. EXACT TIMESTAMPS & CONCISE BREVITY: Preserve "startTime" and "endTime" (in seconds) and keep Burmese concise (~Math.floor(duration * 3.5) syllables).
5. Speaker label: "${speakerLabel}".
6. Clean Burmese subtitles: max 2 lines, <=35 Burmese characters per line, NO Chinese or foreign characters.
7. Return ONLY a valid JSON array matching this exact format:
[
  {
    "id": 1,
    "startTime": 0.0,
    "endTime": 4.2,
    "originalText": "exact dialogue from video",
    "myanmarTranslation": "ရေဘူးတွေ အများကြီး ပေါ်လာတော့ သူ အံ့ဩသွားတယ်!",
    "subtitleText": "ရေဘူးတွေ အများကြီး ပေါ်လာတော့\\nသူ အံ့ဩသွားတယ်!",
    "speaker": "${speakerLabel}",
    "emotion": "surprised, amazed"
  }
]
(JSON ONLY, NO MARKDOWN)

RAW SPOKEN UTTERANCES TO TRANSLATE & RETELL SEQUENTIALLY:
${JSON.stringify(items.map((it, idx) => ({ id: idx + 1, start: it.start, end: it.end, text: it.text })), null, 2)}
`;

  let processedSegments: TranscriptSegment[] = [];

  try {
    onProgress(`✨ [Gemini AI Engine] - အချိန်မှတ်တမ်းအလိုက် ${speakerLabel} စာသားများကို Gemini မှ တည်ဆောက်နေပါသည်...`);
    const { text: geminiRes } = await callGeminiWithRotation(
      translationPrompt,
      'You are a professional Myanmar dubbing and storytelling specialist. Output pure valid JSON.',
      'gemini-3.1-flash-lite',
      undefined,
      { responseMimeType: 'application/json' }
    );
    const jsonMatch = geminiRes.match(/\[[\s\S]*\]/);
    const cleanJson = jsonMatch ? jsonMatch[0] : geminiRes.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJson);

    if (Array.isArray(parsed) && parsed.length > 0) {
      processedSegments = parsed.map((item: any, idx: number) => {
        const startSec = Math.max(0, parseFloat(item.startTime ?? item.start ?? 0));
        const endSec = Math.max(startSec + 0.5, parseFloat(item.endTime ?? item.end ?? (startSec + 3)));
        const dur = parseFloat((endSec - startSec).toFixed(2));
        const burmeseText = (item.myanmarTranslation || item.translation || item.text || '').trim();
        const sylCount = countBurmeseSyllables(burmeseText);
        const maxSyl = calculateMaxAllowedSyllables(dur);

        return {
          id: `assembly_seg_${idx + 1}_${Date.now()}`,
          startTime: startSec,
          endTime: endSec,
          duration: dur,
          originalText: item.originalText || item.text || '',
          myanmarTranslation: burmeseText,
          subtitleText: (item.subtitleText || burmeseText).replace(/[\u4e00-\u9fa5]/g, '').trim(),
          speaker: speakerLabel,
          emotion: item.emotion || 'Storytelling narrator',
          voice: 'Thiha', // Single Adult Male Narrator
          syllableCount: sylCount,
          maxAllowedSyllables: maxSyl,
          atempoRate: 1.0,
          playbackRate: 1.0,
          pauseLead: 0.1,
          pauseTrail: 0.15,
          sceneShotId: `shot_${idx + 1}`,
          minutePartIndex: Math.floor(startSec / MINUTE_BLOCK_SECONDS) + 1,
          isHumanReviewed: false,
        };
      });
    }
  } catch (geminiErr: any) {
    console.warn('Gemini timeline refinement notice, fallback to item mapping:', geminiErr);
  }

  // Fallback if Gemini parse failed: map items directly with single narrator label
  if (processedSegments.length === 0) {
    processedSegments = items.map((it, idx) => {
      const dur = parseFloat((it.end - it.start).toFixed(2));
      const sylCount = countBurmeseSyllables(it.text);
      const maxSyl = calculateMaxAllowedSyllables(dur);
      return {
        id: `assembly_${idx + 1}_${Date.now()}`,
        startTime: parseFloat(it.start.toFixed(2)),
        endTime: parseFloat(it.end.toFixed(2)),
        duration: dur,
        originalText: it.text,
        myanmarTranslation: it.text,
        subtitleText: it.text,
        speaker: 'Narrator (ဇာတ်ကြောင်းပြောသူ)',
        voice: 'Thiha',
        syllableCount: sylCount,
        maxAllowedSyllables: maxSyl,
        atempoRate: 1.0,
        playbackRate: 1.0,
        pauseLead: 0.1,
        pauseTrail: 0.15,
        sceneShotId: `shot_${idx + 1}`,
        minutePartIndex: Math.floor(it.start / MINUTE_BLOCK_SECONDS) + 1,
        isHumanReviewed: false,
      };
    });
  }

  const maxDur = processedSegments.reduce((m, s) => Math.max(m, s.endTime), 60);
  const aligned = realignSegmentsByMinuteBlocks(processedSegments, maxDur, {
    enforceSingleVoice: 'Thiha',
    enforceSingleSpeakerLabel: true,
  });

  onProgress(`✅ [ပြီးစီးပါပြီ] - 0:30 Part Timeline အတိုင်း Narrator စာသား ${aligned.length} ခု ပြင်ဆင်ပြီးပါပြီ!`);
  return aligned;
}
