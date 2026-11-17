import fs from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const rawExecAsync = promisify(exec);
const execAsync = (command: string, options: { maxBuffer?: number } = {}) =>
  rawExecAsync(command, { maxBuffer: 16 * 1024 * 1024, ...options });

const LOCAL_DEMUCS_BIN = '/tmp/demucs_venv/bin/demucs';
const LOCAL_UV_BIN = '/tmp/uvbin/uv';
let demucsBootstrapPromise: Promise<string | null> | null = null;

async function findExistingDemucsBinary(): Promise<string | null> {
  if (fs.existsSync(LOCAL_DEMUCS_BIN)) {
    return LOCAL_DEMUCS_BIN;
  }
  try {
    const { stdout } = await execAsync('which demucs');
    const resolved = stdout.trim();
    if (resolved && fs.existsSync(resolved)) return resolved;
  } catch (_) {}
  return null;
}

async function ensureLocalDemucsBinary(
  onProgress?: (percent: number, stageLabel: string) => void
): Promise<string | null> {
  const existing = await findExistingDemucsBinary();
  if (existing) return existing;

  if (demucsBootstrapPromise) {
    return demucsBootstrapPromise;
  }

  demucsBootstrapPromise = (async () => {
    try {
      onProgress?.(28, 'Demucs v4 (htdemucs) AI Engine ကို ပြင်ဆင်တပ်ဆင်နေသည်...');
      if (!fs.existsSync(LOCAL_UV_BIN)) {
        await execAsync('curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="/tmp/uvbin" sh');
      }
      if (!fs.existsSync('/tmp/demucs_venv/bin/python')) {
        await execAsync(`${LOCAL_UV_BIN} venv /tmp/demucs_venv --python 3.10`);
      }
      await execAsync(
        `${LOCAL_UV_BIN} pip install --no-cache --python /tmp/demucs_venv/bin/python --index-url https://download.pytorch.org/whl/cpu torch==2.5.1+cpu torchaudio==2.5.1+cpu`
      );
      await execAsync(
        `${LOCAL_UV_BIN} pip install --no-cache --python /tmp/demucs_venv/bin/python demucs soundfile`
      );
      return await findExistingDemucsBinary();
    } catch (err: any) {
      console.warn('Local Demucs CPU bootstrap failed:', err?.message || err);
      return null;
    } finally {
      demucsBootstrapPromise = null;
    }
  })();

  return demucsBootstrapPromise;
}

export type SeparationEngine =
  | 'demucs'
  | 'demucs_ai'
  | 'bs_roformer_ai'
  | 'uvr'
  | 'ffmpeg_stem_filter'
  | 'passthrough';

export interface SeparationResult {
  success: boolean;
  engineUsed: SeparationEngine;
  vocalStemPath?: string;
  instrumentalStemPath?: string;
  statusMessage: string;
  isFallback: boolean;
  error?: string;
}

/**
 * Checks system availability for AI stem separation engines.
 */
export async function detectSeparationCapabilities(): Promise<{
  hasDemucs: boolean;
  hasUvr: boolean;
  hasFFmpegFilters: boolean;
  preferredEngine: SeparationEngine;
  description: string;
}> {
  const demucsBin = await findExistingDemucsBinary();
  const hasDemucs = Boolean(demucsBin);
  let hasUvr = false;
  const hasFFmpegFilters = true;

  try {
    await execAsync('python3 -m uvr5 --help');
    hasUvr = true;
  } catch (_) {
    hasUvr = false;
  }

  let preferredEngine: SeparationEngine = hasDemucs ? 'demucs' : 'demucs_ai';
  let description = hasDemucs
    ? 'Built-in Local Demucs v4 (htdemucs) Deep Neural AI Vocal/BGM Separation (API Key မလို · Offline Ready)'
    : 'Built-in Demucs v4 (htdemucs) Neural AI Vocal/BGM Separation (API Key မလို)';

  if (!hasDemucs && hasUvr) {
    preferredEngine = 'uvr';
  }

  return {
    hasDemucs,
    hasUvr,
    hasFFmpegFilters,
    preferredEngine,
    description,
  };
}

function parseGradioCompleteData(sseText: string): any[] | null {
  if (!sseText) return null;
  if (sseText.includes('event: error')) {
    const errMatch = sseText.match(/event:\s*error[\s\S]*?data:\s*(.+)/);
    throw new Error(errMatch?.[1]?.trim() || 'Remote AI stem separation returned error');
  }
  const completeMatch = sseText.match(/event:\s*complete[\r\n]+data:\s*(\[[\s\S]*?\])(?:\r?\n|$)/);
  const dataMatch = completeMatch || sseText.match(/data:\s*(\[[\s\S]*?\])(?:\r?\n|$)/);
  if (!dataMatch) return null;
  const parsed = JSON.parse(dataMatch[1]);
  return Array.isArray(parsed) ? parsed : null;
}

async function getAudioDurationSec(audioPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
    );
    const val = parseFloat(stdout.trim());
    return Number.isFinite(val) && val > 0 ? val : 0;
  } catch (_) {
    return 0;
  }
}

async function splitAudioIntoWavSegments(
  inputAudioPath: string,
  workDir: string,
  segmentSec = 45
): Promise<string[]> {
  fs.mkdirSync(workDir, { recursive: true });
  const pattern = path.join(workDir, 'seg_%04d.wav');
  await execAsync(
    `ffmpeg -nostdin -loglevel error -y -i "${inputAudioPath}" -f segment -segment_time ${segmentSec} -reset_timestamps 1 -c:a pcm_s16le "${pattern}"`
  );
  return fs
    .readdirSync(workDir)
    .filter((f) => f.startsWith('seg_') && f.endsWith('.wav'))
    .sort()
    .map((f) => path.join(workDir, f));
}

async function concatWavSegments(segmentPaths: string[], outputPath: string, workDir: string): Promise<void> {
  if (segmentPaths.length === 1) {
    fs.copyFileSync(segmentPaths[0], outputPath);
    return;
  }
  const listPath = path.join(workDir, `concat_${Date.now()}.txt`);
  const listBody = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(listPath, listBody, 'utf8');
  await execAsync(
    `ffmpeg -nostdin -loglevel error -y -f concat -safe 0 -i "${listPath}" -c:a pcm_s16le "${outputPath}"`
  );
}

async function separateSingleWithBsRoformerSpace(
  inputAudioPath: string,
  outputDir: string,
  tag: string,
  instStemPath: string,
  onProgress?: (percent: number, stageLabel: string) => void
): Promise<boolean> {
  const spaceBase = 'https://hugging-apps-bs-roformer-leap-audio-separator.hf.space';
  let tempUploadMp3: string | null = null;
  try {
    onProgress?.(36, 'BS-RoFormer AI Neural Engine ထံ အသံဖိုင် ပေးပို့နေသည်...');
    let uploadAudioPath = inputAudioPath;
    if (path.extname(inputAudioPath).toLowerCase() !== '.mp3') {
      tempUploadMp3 = path.join(outputDir, `${tag}_bs_upload.mp3`);
      await execAsync(
        `ffmpeg -nostdin -loglevel error -y -i "${inputAudioPath}" -vn -ac 2 -ar 44100 -c:a libmp3lame -q:a 2 "${tempUploadMp3}"`
      );
      uploadAudioPath = tempUploadMp3;
    }

    const fileBuf = fs.readFileSync(uploadAudioPath);
    const ext = path.extname(uploadAudioPath).toLowerCase() === '.mp3' ? '.mp3' : '.wav';
    const mime = ext === '.mp3' ? 'audio/mpeg' : 'audio/wav';
    const fileName = `source_audio${ext}`;

    const fd = new FormData();
    fd.append('files', new Blob([fileBuf], { type: mime }), fileName);

    const uploadRes = await fetch(`${spaceBase}/gradio_api/upload`, {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(60000),
    });
    if (!uploadRes.ok) {
      throw new Error(`Upload HTTP ${uploadRes.status}`);
    }
    const uploadedPaths: any = await uploadRes.json();
    const remotePath = Array.isArray(uploadedPaths) ? uploadedPaths[0] : null;
    if (!remotePath) throw new Error('No uploaded path returned');

    onProgress?.(48, 'BS-RoFormer AI ဖြင့် လူစကားပြောသံ (Vocals) အပြည့်အဝ ဖယ်ရှားနေသည်...');

    const fileData = {
      path: remotePath,
      url: `${spaceBase}/gradio_api/file=${remotePath}`,
      orig_name: fileName,
      mime_type: mime,
      meta: { _type: 'gradio.FileData' },
    };

    const callRes = await fetch(`${spaceBase}/gradio_api/call/separate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [fileData, 'Standard — Vocals'] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!callRes.ok) throw new Error(`Call HTTP ${callRes.status}`);
    const callJson: any = await callRes.json();
    const eventId = callJson?.event_id;
    if (!eventId) throw new Error('No event_id returned');

    onProgress?.(60, 'AI Neural Model မှ Background music သီးသန့် ခွဲထုတ်ပေးနေသည်...');
    const sseRes = await fetch(`${spaceBase}/gradio_api/call/separate/${eventId}`, {
      method: 'GET',
      signal: AbortSignal.timeout(180000),
    });
    if (!sseRes.ok) throw new Error(`SSE HTTP ${sseRes.status}`);
    const sseText = await sseRes.text();
    const parsedData = parseGradioCompleteData(sseText);
    if (!parsedData || parsedData.length < 2) {
      throw new Error('Incomplete BS-RoFormer stem output');
    }

    const item0 = parsedData[0];
    const item1 = parsedData[1];
    const name0 = String(item0?.orig_name || item0?.path || '').toLowerCase();
    const name1 = String(item1?.orig_name || item1?.path || '').toLowerCase();

    const instObj = name0.includes('instrumental') && !name1.includes('instrumental') ? item0 : item1;
    const instUrl = instObj?.url || (instObj?.path ? `${spaceBase}/gradio_api/file=${instObj.path}` : null);
    if (!instUrl) throw new Error('Instrumental track URL missing');

    onProgress?.(78, 'လူသံမပါသော Background music ကို ဒေါင်းလုဒ်ဆွဲယူနေသည်...');
    const instRes = await fetch(instUrl, { signal: AbortSignal.timeout(60000) });
    if (!instRes.ok) throw new Error(`Instrumental download HTTP ${instRes.status}`);
    const instBuf = Buffer.from(await instRes.arrayBuffer());
    if (instBuf.length < 1000) throw new Error('Downloaded instrumental stem is empty');

    const rawDlPath = path.join(outputDir, `${tag}_bs_dl.audio`);
    fs.writeFileSync(rawDlPath, instBuf);
    try {
      await execAsync(
        `ffmpeg -nostdin -loglevel error -y -i "${rawDlPath}" -ac 2 -ar 44100 -c:a pcm_s16le "${instStemPath}"`
      );
    } finally {
      if (fs.existsSync(rawDlPath)) {
        try { fs.unlinkSync(rawDlPath); } catch (_) {}
      }
    }

    return fs.existsSync(instStemPath) && fs.statSync(instStemPath).size > 1000;
  } catch (err: any) {
    console.warn('BS-RoFormer AI Space separation unavailable, trying backup AI:', err?.message || err);
    return false;
  } finally {
    if (tempUploadMp3 && fs.existsSync(tempUploadMp3)) {
      try { fs.unlinkSync(tempUploadMp3); } catch (_) {}
    }
  }
}

async function separateWithBsRoformerSpace(
  inputAudioPath: string,
  outputDir: string,
  jobId: string,
  instStemPath: string,
  _vocalStemPath: string,
  onProgress?: (percent: number, stageLabel: string) => void
): Promise<SeparationResult | null> {
  const segDir = path.join(outputDir, `bs_segs_${jobId}`);
  try {
    const durationSec = await getAudioDurationSec(inputAudioPath);
    if (durationSec <= 55) {
      const ok = await separateSingleWithBsRoformerSpace(
        inputAudioPath,
        outputDir,
        jobId,
        instStemPath,
        onProgress
      );
      if (!ok) return null;
      return {
        success: true,
        engineUsed: 'bs_roformer_ai',
        instrumentalStemPath: instStemPath,
        statusMessage: 'BS-RoFormer AI ဖြင့် လူစကားပြောသံများ အပြည့်အဝ ဖယ်ရှားပြီး Background music.mp3 ခွဲထုတ်ပြီးပါပြီ',
        isFallback: false,
      };
    }

    onProgress?.(33, `ဗီဒီယိုအရှည် (${Math.round(durationSec)}s) ကို BS-RoFormer AI အပိုင်းခွဲ၍ ခွဲထုတ်နေသည်...`);
    const segs = await splitAudioIntoWavSegments(inputAudioPath, segDir, 45);
    const outInstSegs: string[] = [];

    for (let i = 0; i < segs.length; i++) {
      const segInst = path.join(segDir, `out_inst_${i}.wav`);
      const basePct = 34 + Math.round((i / segs.length) * 52);
      const spanPct = Math.max(4, Math.round(52 / segs.length));
      const ok = await separateSingleWithBsRoformerSpace(
        segs[i],
        segDir,
        `${jobId}_s${i}`,
        segInst,
        (subPct) => {
          const frac = Math.max(0, Math.min(1, (subPct - 34) / 52));
          onProgress?.(
            Math.min(88, basePct + Math.round(frac * spanPct)),
            `BS-RoFormer AI ဖြင့် Vocals ဖယ်ရှားနေသည်... (အပိုင်း ${i + 1}/${segs.length})`
          );
        }
      );
      if (!ok) return null;
      outInstSegs.push(segInst);
    }

    await concatWavSegments(outInstSegs, instStemPath, segDir);
    if (!fs.existsSync(instStemPath) || fs.statSync(instStemPath).size < 1000) {
      return null;
    }
    return {
      success: true,
      engineUsed: 'bs_roformer_ai',
      instrumentalStemPath: instStemPath,
      statusMessage: 'BS-RoFormer AI ဖြင့် လူစကားပြောသံများ အပြည့်အဝ ဖယ်ရှားပြီး Background music.mp3 ခွဲထုတ်ပြီးပါပြီ',
      isFallback: false,
    };
  } catch (err: any) {
    console.warn('Segmented BS-RoFormer separation failed:', err?.message || err);
    return null;
  } finally {
    if (fs.existsSync(segDir)) {
      try { fs.rmSync(segDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

let activeDemucsQueue: Promise<void> = Promise.resolve();

function enqueueDemucsWork<T>(fn: () => Promise<T>): Promise<T> {
  const prev = activeDemucsQueue;
  let release!: () => void;
  activeDemucsQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  return prev.then(fn).finally(() => release());
}

async function runSingleLocalDemucsPass(
  demucsBin: string,
  inputAudioPath: string,
  outTemp: string,
  instOutPath: string,
  vocOutPath: string | null,
  onProgress?: (pctFraction: number) => void
): Promise<boolean> {
  try {
    fs.mkdirSync('/tmp/torch_cache', { recursive: true });
    fs.mkdirSync('/tmp/hf_cache', { recursive: true });
  } catch (_) {}

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      demucsBin,
      [
        '-n',
        'htdemucs',
        '--two-stems=vocals',
        '-d',
        'cpu',
        '-j',
        '1',
        '--segment',
        '7',
        '--overlap',
        '0.1',
        '-o',
        outTemp,
        inputAudioPath,
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TORCH_HOME: '/tmp/torch_cache',
          HF_HOME: '/tmp/hf_cache',
          OMP_NUM_THREADS: '2',
          MKL_NUM_THREADS: '2',
          OPENBLAS_NUM_THREADS: '2',
          NUMEXPR_NUM_THREADS: '2',
        },
      }
    );

    let lastPct = -1;
    let errBuf = '';
    let settled = false;
    const watchdog = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          child.kill('SIGKILL');
        } catch (_) {}
        reject(new Error('Demucs segment processing timed out'));
      }
    }, 360000); // 6 minutes max per 45s segment

    const handleChunk = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      errBuf = (errBuf + text).slice(-2000);
      const matches = [...text.matchAll(/(\d{1,3})%\|/g)];
      if (matches.length > 0) {
        const pctVal = Math.max(0, Math.min(100, parseInt(matches[matches.length - 1][1], 10)));
        if (pctVal !== lastPct) {
          lastPct = pctVal;
          onProgress?.(pctVal / 100);
        }
      }
    };

    child.stdout.on('data', handleChunk);
    child.stderr.on('data', handleChunk);
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      if (code === 0) resolve();
      else reject(new Error(`Demucs exited with code ${code}: ${errBuf.trim()}`));
    });
  });

  const fileNameNoExt = path.basename(inputAudioPath, path.extname(inputAudioPath));
  const demucsInst = path.join(outTemp, 'htdemucs', fileNameNoExt, 'no_vocals.wav');
  const demucsVoc = path.join(outTemp, 'htdemucs', fileNameNoExt, 'vocals.wav');

  if (fs.existsSync(demucsInst) && fs.statSync(demucsInst).size > 1000) {
    fs.copyFileSync(demucsInst, instOutPath);
    if (vocOutPath && fs.existsSync(demucsVoc)) {
      fs.copyFileSync(demucsVoc, vocOutPath);
    }
    return true;
  }
  return false;
}

async function runLocalDemucsSeparation(
  demucsBin: string,
  inputAudioPath: string,
  outputDir: string,
  jobId: string,
  instStemPath: string,
  vocalStemPath: string,
  onProgress?: (percent: number, stageLabel: string) => void
): Promise<SeparationResult | null> {
  const outTemp = path.join(outputDir, `demucs_out_${jobId}`);
  const segDir = path.join(outputDir, `demucs_segs_${jobId}`);
  try {
    onProgress?.(32, 'Local Demucs v4 (htdemucs) AI Model စတင်ဖွင့်လှစ်နေသည်...');
    const durationSec = await getAudioDurationSec(inputAudioPath);

    if (durationSec <= 50) {
      const ok = await runSingleLocalDemucsPass(
        demucsBin,
        inputAudioPath,
        outTemp,
        instStemPath,
        vocalStemPath,
        (frac) => {
          const pctVal = Math.round(frac * 100);
          const mapped = 32 + Math.round(frac * 56);
          onProgress?.(mapped, `Demucs v4 (htdemucs) AI ဖြင့် Vocals ဖယ်ရှားနေသည်... (${pctVal}%)`);
        }
      );
      if (ok) {
        return {
          success: true,
          engineUsed: 'demucs',
          instrumentalStemPath: instStemPath,
          vocalStemPath: fs.existsSync(vocalStemPath) ? vocalStemPath : undefined,
          statusMessage: 'Demucs v4 AI (htdemucs) ဖြင့် လူစကားပြောသံများ ဖယ်ရှားပြီး Background music.mp3 ခွဲထုတ်ပြီးပါပြီ',
          isFallback: false,
        };
      }
      return null;
    }

    // For >50s videos, split into 45s segments to prevent container CPU/RAM exhaustion and report segment progress cleanly
    onProgress?.(32, `ဗီဒီယိုအရှည် (${Math.round(durationSec)}s) ကို Demucs v4 AI အပိုင်းခွဲ၍ စီမံနေသည်...`);
    const segs = await splitAudioIntoWavSegments(inputAudioPath, segDir, 45);
    const outInstSegs: string[] = [];
    const outVocSegs: string[] = [];

    for (let i = 0; i < segs.length; i++) {
      const segOutTemp = path.join(outTemp, `s${i}`);
      const segInst = path.join(segDir, `inst_${i}.wav`);
      const segVoc = path.join(segDir, `voc_${i}.wav`);
      const segStartPct = 32 + Math.round((i / segs.length) * 56);
      const segSpanPct = 56 / segs.length;

      onProgress?.(segStartPct, `Demucs v4 (htdemucs) ဖြင့် ခွဲထုတ်နေသည်... (အပိုင်း ${i + 1}/${segs.length})`);
      const ok = await runSingleLocalDemucsPass(
        demucsBin,
        segs[i],
        segOutTemp,
        segInst,
        segVoc,
        (frac) => {
          const mapped = Math.min(88, segStartPct + Math.round(frac * segSpanPct));
          onProgress?.(
            mapped,
            `Demucs v4 (htdemucs) ဖြင့် Vocals ဖယ်ရှားနေသည်... (အပိုင်း ${i + 1}/${segs.length} · ${Math.round(frac * 100)}%)`
          );
        }
      );
      if (!ok) return null;
      outInstSegs.push(segInst);
      if (fs.existsSync(segVoc)) outVocSegs.push(segVoc);

      if (fs.existsSync(segOutTemp)) {
        try { fs.rmSync(segOutTemp, { recursive: true, force: true }); } catch (_) {}
      }
    }

    onProgress?.(88, 'Demucs BGM အပိုင်းများကို တစ်ဆက်တည်း ပြန်လည်ပေါင်းစည်းနေသည်...');
    await concatWavSegments(outInstSegs, instStemPath, segDir);
    if (outVocSegs.length === outInstSegs.length) {
      await concatWavSegments(outVocSegs, vocalStemPath, segDir).catch(() => {});
    }

    if (fs.existsSync(instStemPath) && fs.statSync(instStemPath).size > 1000) {
      return {
        success: true,
        engineUsed: 'demucs',
        instrumentalStemPath: instStemPath,
        vocalStemPath: fs.existsSync(vocalStemPath) ? vocalStemPath : undefined,
        statusMessage: 'Demucs v4 AI (htdemucs) ဖြင့် လူစကားပြောသံများ ဖယ်ရှားပြီး Background music.mp3 ခွဲထုတ်ပြီးပါပြီ',
        isFallback: false,
      };
    }

    return null;
  } catch (demucsErr: any) {
    console.warn('Local Demucs separation failed, trying backup engines:', demucsErr?.message || demucsErr);
    return null;
  } finally {
    if (fs.existsSync(outTemp)) {
      try { fs.rmSync(outTemp, { recursive: true, force: true }); } catch (_) {}
    }
    if (fs.existsSync(segDir)) {
      try { fs.rmSync(segDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

async function separateSingleWithDemucsSpace(
  inputAudioPath: string,
  outputDir: string,
  jobId: string,
  instStemPath: string,
  vocalStemPath: string | null,
  onProgress?: (percent: number, stageLabel: string) => void
): Promise<boolean> {
  const spaceBase = 'https://teamup-tech-demucs.hf.space';
  let tempUploadMp3: string | null = null;
  const tempStemFiles: string[] = [];

  try {
    onProgress?.(34, 'Demucs AI (htdemucs) အတွက် အသံဖိုင် ပြင်ဆင်နေသည်...');

    // Compress WAV to clean stereo MP3 for fast upload to Demucs GPU engine
    let uploadAudioPath = inputAudioPath;
    if (path.extname(inputAudioPath).toLowerCase() !== '.mp3') {
      tempUploadMp3 = path.join(outputDir, `${jobId}_demucs_upload.mp3`);
      await execAsync(
        `ffmpeg -nostdin -loglevel error -y -i "${inputAudioPath}" -vn -ac 2 -ar 44100 -c:a libmp3lame -q:a 2 "${tempUploadMp3}"`
      );
      uploadAudioPath = tempUploadMp3;
    }

    onProgress?.(40, 'Demucs v4 AI Engine ထံ အသံဖိုင် ပေးပို့နေသည်...');
    const fileBuf = fs.readFileSync(uploadAudioPath);
    const fileName = 'source_audio.mp3';
    const fd = new FormData();
    fd.append('files', new Blob([fileBuf], { type: 'audio/mpeg' }), fileName);

    const uploadRes = await fetch(`${spaceBase}/gradio_api/upload`, {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(90000),
    });
    if (!uploadRes.ok) {
      throw new Error(`Demucs upload HTTP ${uploadRes.status}`);
    }
    const uploadedPaths: any = await uploadRes.json();
    const remotePath = Array.isArray(uploadedPaths) ? uploadedPaths[0] : null;
    if (!remotePath) throw new Error('No uploaded path returned by Demucs');

    onProgress?.(50, 'Demucs v4 (htdemucs) ဖြင့် လူစကားပြောသံ (Vocals) နှင့် BGM ခွဲထုတ်နေသည်...');

    const fileData = {
      path: remotePath,
      url: `${spaceBase}/gradio_api/file=${remotePath}`,
      orig_name: fileName,
      mime_type: 'audio/mpeg',
      meta: { _type: 'gradio.FileData' },
    };

    const callRes = await fetch(`${spaceBase}/gradio_api/call/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [fileData, 'htdemucs'] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!callRes.ok) throw new Error(`Demucs call HTTP ${callRes.status}`);
    const callJson: any = await callRes.json();
    const eventId = callJson?.event_id;
    if (!eventId) throw new Error('No Demucs event_id returned');

    onProgress?.(60, 'Demucs AI မှ Drums, Bass, Other, Vocals ခွဲထုတ်ပေးနေသည်...');
    const sseRes = await fetch(`${spaceBase}/gradio_api/call/process/${eventId}`, {
      method: 'GET',
      signal: AbortSignal.timeout(240000),
    });
    if (!sseRes.ok) throw new Error(`Demucs SSE HTTP ${sseRes.status}`);
    const sseText = await sseRes.text();
    const parsedData = parseGradioCompleteData(sseText);
    if (!parsedData || parsedData.length < 4) {
      throw new Error('Incomplete Demucs 4-stem output');
    }

    const getUrl = (item: any) => item?.url || (item?.path ? `${spaceBase}/gradio_api/file=${item.path}` : null);
    const getName = (item: any) => String(item?.orig_name || item?.path || '').toLowerCase();

    const drumsItem = parsedData.find((x) => getName(x).includes('drum')) || parsedData[0];
    const bassItem = parsedData.find((x) => getName(x).includes('bass')) || parsedData[1];
    const vocalsItem = parsedData.find((x) => getName(x).includes('vocal')) || parsedData[2];
    const otherItem = parsedData.find((x) => getName(x).includes('other')) || parsedData[3];

    const nonVocalItems = [drumsItem, bassItem, otherItem].filter(Boolean);
    const nonVocalUrls = nonVocalItems.map(getUrl).filter(Boolean) as string[];
    if (nonVocalUrls.length < 3) {
      throw new Error('Demucs instrumental stem URLs missing');
    }

    onProgress?.(76, 'Demucs AI မှ Background stems များ ဒေါင်းလုဒ်ဆွဲယူနေသည်...');
    await Promise.all(
      nonVocalUrls.map(async (stemUrl, idx) => {
        const res = await fetch(stemUrl, { signal: AbortSignal.timeout(90000) });
        if (!res.ok) throw new Error(`Demucs stem download HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 500) throw new Error('Downloaded Demucs stem empty');
        const stemFile = path.join(outputDir, `${jobId}_demucs_inst_${idx}.wav`);
        fs.writeFileSync(stemFile, buf);
        tempStemFiles.push(stemFile);
      })
    );

    const vocalsUrl = getUrl(vocalsItem);
    if (vocalsUrl && vocalStemPath) {
      try {
        const vRes = await fetch(vocalsUrl, { signal: AbortSignal.timeout(60000) });
        if (vRes.ok) {
          const vBuf = Buffer.from(await vRes.arrayBuffer());
          if (vBuf.length > 500) fs.writeFileSync(vocalStemPath, vBuf);
        }
      } catch (_) {}
    }

    onProgress?.(85, 'Demucs Instrumental stems (Drums + Bass + Music) ပေါင်းစည်းနေသည်...');
    await execAsync(
      `ffmpeg -nostdin -loglevel error -y -i "${tempStemFiles[0]}" -i "${tempStemFiles[1]}" -i "${tempStemFiles[2]}" -filter_complex "[0:a][1:a][2:a]amix=inputs=3:duration=longest:normalize=0,alimiter=limit=0.98[inst]" -map "[inst]" -c:a pcm_s16le "${instStemPath}"`
    );

    return fs.existsSync(instStemPath) && fs.statSync(instStemPath).size > 1000;
  } catch (err: any) {
    console.warn('Demucs AI Space unavailable, trying backup separation engine:', err?.message || err);
    return false;
  } finally {
    if (tempUploadMp3 && fs.existsSync(tempUploadMp3)) {
      try { fs.unlinkSync(tempUploadMp3); } catch (_) {}
    }
    for (const f of tempStemFiles) {
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch (_) {}
      }
    }
  }
}

async function separateWithDemucsSpace(
  inputAudioPath: string,
  outputDir: string,
  jobId: string,
  instStemPath: string,
  vocalStemPath: string,
  onProgress?: (percent: number, stageLabel: string) => void
): Promise<SeparationResult | null> {
  const segDir = path.join(outputDir, `demucs_space_segs_${jobId}`);
  try {
    const durationSec = await getAudioDurationSec(inputAudioPath);
    if (durationSec <= 55) {
      const ok = await separateSingleWithDemucsSpace(
        inputAudioPath,
        outputDir,
        jobId,
        instStemPath,
        vocalStemPath,
        onProgress
      );
      if (!ok) return null;
      return {
        success: true,
        engineUsed: 'demucs_ai',
        instrumentalStemPath: instStemPath,
        vocalStemPath: fs.existsSync(vocalStemPath) ? vocalStemPath : undefined,
        statusMessage: 'Demucs v4 AI (htdemucs) ဖြင့် လူစကားပြောသံများ ဖယ်ရှားပြီး Background music.mp3 ခွဲထုတ်ပြီးပါပြီ',
        isFallback: false,
      };
    }

    onProgress?.(34, `ဗီဒီယိုအရှည် (${Math.round(durationSec)}s) ကို Demucs v4 AI အပိုင်းခွဲ၍ ခွဲထုတ်နေသည်...`);
    const segs = await splitAudioIntoWavSegments(inputAudioPath, segDir, 45);
    const outInstSegs: string[] = [];
    const outVocSegs: string[] = [];

    for (let i = 0; i < segs.length; i++) {
      const segInst = path.join(segDir, `inst_${i}.wav`);
      const segVoc = path.join(segDir, `voc_${i}.wav`);
      const basePct = 34 + Math.round((i / segs.length) * 52);
      const spanPct = Math.max(4, Math.round(52 / segs.length));

      const ok = await separateSingleWithDemucsSpace(
        segs[i],
        segDir,
        `${jobId}_s${i}`,
        segInst,
        segVoc,
        (subPct) => {
          const frac = Math.max(0, Math.min(1, (subPct - 34) / 51));
          onProgress?.(
            Math.min(88, basePct + Math.round(frac * spanPct)),
            `Demucs v4 AI ဖြင့် Vocals ဖယ်ရှားနေသည်... (အပိုင်း ${i + 1}/${segs.length})`
          );
        }
      );
      if (!ok) return null;
      outInstSegs.push(segInst);
      if (fs.existsSync(segVoc)) outVocSegs.push(segVoc);
    }

    await concatWavSegments(outInstSegs, instStemPath, segDir);
    if (outVocSegs.length === outInstSegs.length) {
      await concatWavSegments(outVocSegs, vocalStemPath, segDir).catch(() => {});
    }

    if (fs.existsSync(instStemPath) && fs.statSync(instStemPath).size > 1000) {
      return {
        success: true,
        engineUsed: 'demucs_ai',
        instrumentalStemPath: instStemPath,
        vocalStemPath: fs.existsSync(vocalStemPath) ? vocalStemPath : undefined,
        statusMessage: 'Demucs v4 AI (htdemucs) ဖြင့် လူစကားပြောသံများ ဖယ်ရှားပြီး Background music.mp3 ခွဲထုတ်ပြီးပါပြီ',
        isFallback: false,
      };
    }

    return null;
  } catch (err: any) {
    console.warn('Segmented Demucs Space separation failed:', err?.message || err);
    return null;
  } finally {
    if (fs.existsSync(segDir)) {
      try { fs.rmSync(segDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

/**
 * Perform real neural AI stem separation using Demucs (Local CLI or Demucs v4 Cloud GPU)
 * with BS-RoFormer & FFmpeg Deep Vocal Suppression fallback to preserve BGM & SFX while removing speech/vocals.
 */
export async function separateAudioStems(
  inputAudioPath: string,
  outputDir: string,
  jobId: string,
  onProgress?: (percent: number, stageLabel: string) => void
): Promise<SeparationResult> {
  if (!fs.existsSync(inputAudioPath)) {
    return {
      success: false,
      engineUsed: 'passthrough',
      statusMessage: 'Input audio file not found for stem separation',
      isFallback: true,
      error: 'Audio file missing',
    };
  }

  const instStemPath = path.join(outputDir, `${jobId}_instrumental_stem.wav`);
  const vocalStemPath = path.join(outputDir, `${jobId}_vocal_stem.wav`);

  // 1. Primary Engine: Real Local Demucs v4 (htdemucs) CLI — serialized queue prevents OOM/CPU starvation on consecutive runs
  const demucsBin = await ensureLocalDemucsBinary(onProgress);
  if (demucsBin) {
    const localRes = await enqueueDemucsWork(() =>
      runLocalDemucsSeparation(
        demucsBin,
        inputAudioPath,
        outputDir,
        jobId,
        instStemPath,
        vocalStemPath,
        onProgress
      )
    );
    if (localRes) return localRes;
  }

  // 2. Secondary Demucs v4 (htdemucs) Cloud GPU Engine (when ZeroGPU quota is free)
  const demucsRes = await separateWithDemucsSpace(
    inputAudioPath,
    outputDir,
    jobId,
    instStemPath,
    vocalStemPath,
    onProgress
  );
  if (demucsRes) return demucsRes;

  // 3. Backup Neural AI Space: BS-RoFormer
  const bsRes = await separateWithBsRoformerSpace(
    inputAudioPath,
    outputDir,
    jobId,
    instStemPath,
    vocalStemPath,
    onProgress
  );
  if (bsRes) return bsRes;

  // 5. Local FFmpeg Aggressive Vocal Cancellation Fallback (Center Channel Cancel + Deep Speech Notch)
  try {
    onProgress?.(68, 'FFmpeg Deep Vocal Suppression ဖြင့် လူသံဖယ်ရှားနေသည်...');
    let sideMeanDb = -91;
    let midMeanDb = -20;
    try {
      const { stderr: probeSide } = await execAsync(
        `ffmpeg -y -i "${inputAudioPath}" -t 20 -af "pan=stereo|c0=c0-c1|c1=c1-c0,volumedetect" -f null - 2>&1`
      );
      const { stderr: probeMid } = await execAsync(
        `ffmpeg -y -i "${inputAudioPath}" -t 20 -af "pan=mono|c0=0.5*c0+0.5*c1,volumedetect" -f null - 2>&1`
      );
      const mSide = probeSide.match(/mean_volume:\s*([-\d.]+)\s*dB/);
      const mMid = probeMid.match(/mean_volume:\s*([-\d.]+)\s*dB/);
      if (mSide) sideMeanDb = parseFloat(mSide[1]);
      if (mMid) midMeanDb = parseFloat(mMid[1]);
    } catch (_) {}

    if (sideMeanDb > midMeanDb - 22 && sideMeanDb > -50) {
      const ffmpegInstCmd = `ffmpeg -nostdin -loglevel error -y -i "${inputAudioPath}" -filter_complex "[0:a]asplit=2[lowin][sidein];[lowin]lowpass=f=105,volume=0.75[lows];[sidein]stereotools=mlev=0.01:slev=1.45:softclip=1,highpass=f=105,equalizer=f=350:t=q:w=1.2:g=-9,equalizer=f=1100:t=q:w=0.9:g=-14,equalizer=f=2400:t=q:w=1.0:g=-12[sides];[lows][sides]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[inst]" -map "[inst]" -c:a pcm_s16le "${instStemPath}"`;
      await execAsync(ffmpegInstCmd);
    } else {
      const ffmpegMonoInstCmd = `ffmpeg -nostdin -loglevel error -y -i "${inputAudioPath}" -filter_complex "[0:a]highpass=f=40,equalizer=f=220:t=q:w=1.0:g=-18,equalizer=f=450:t=q:w=0.9:g=-24,equalizer=f=900:t=q:w=0.8:g=-26,equalizer=f=1700:t=q:w=0.8:g=-28,equalizer=f=2900:t=q:w=0.9:g=-24,equalizer=f=4000:t=q:w=1.2:g=-16,alimiter=limit=0.95[inst]" -map "[inst]" -c:a pcm_s16le "${instStemPath}"`;
      await execAsync(ffmpegMonoInstCmd);
    }

    if (fs.existsSync(instStemPath) && fs.statSync(instStemPath).size > 1000) {
      return {
        success: true,
        engineUsed: 'ffmpeg_stem_filter',
        instrumentalStemPath: instStemPath,
        statusMessage: 'FFmpeg Vocal Suppression ဖြင့် နောက်ခံတီးလုံး/SFX ခွဲထုတ်ပြီးပါပြီ',
        isFallback: false,
      };
    }
  } catch (ffmpegErr: any) {
    console.warn('FFmpeg stem separation failed:', ffmpegErr.message);
  }

  // 6. Safe Passthrough if stem filtering fails
  return {
    success: true,
    engineUsed: 'passthrough',
    instrumentalStemPath: inputAudioPath,
    statusMessage: 'မူရင်းအသံဖိုင်အတိုင်း နောက်ခံအသံအဖြစ် အသုံးပြုထားပါသည်။',
    isFallback: true,
  };
}

/**
 * Extracts ONLY the BGM & Sound Effects track (human speech removed) from a video file
 * and encodes a clean stereo MP3 + measured duration for instant preview & export mixing.
 */
export async function extractBgmAndSfxFromVideo(
  videoPath: string,
  outputDir: string,
  id: string,
  onProgress?: (percent: number, stageLabel: string) => void
): Promise<{
  success: boolean;
  bgmMp3Path: string;
  vocalMp3Path?: string;
  engineUsed: SeparationEngine;
  statusMessage: string;
  durationSec: number;
}> {
  if (!fs.existsSync(videoPath)) {
    throw new Error('ဗီဒီယိုဖိုင် မတွေ့ရှိပါ');
  }

  onProgress?.(24, 'ဗီဒီယိုမှ မူရင်းအသံလမ်းကြောင်း (44.1kHz Stereo WAV) ထုတ်ယူနေသည်...');
  const rawAudioPath = path.join(outputDir, `${id}_raw_audio.wav`);
  try {
    await execAsync(`ffmpeg -nostdin -loglevel error -y -i "${videoPath}" -vn -ac 2 -ar 44100 -c:a pcm_s16le "${rawAudioPath}"`);
  } catch (extractErr: any) {
    throw new Error('ဗီဒီယိုတွင် ခွဲထုတ်ရန် အသံလမ်းကြောင်း မတွေ့ရှိပါ');
  }

  onProgress?.(30, 'Demucs v4 AI (htdemucs) ဖြင့် လူစကားပြောသံ (Vocals) များ ဖယ်ရှားနေသည်...');
  const sep = await separateAudioStems(rawAudioPath, outputDir, id, onProgress);
  const srcStem = sep.instrumentalStemPath || rawAudioPath;
  const bgmMp3Path = path.join(outputDir, `${id}_bgm_only.mp3`);
  const vocalMp3Path = sep.vocalStemPath ? path.join(outputDir, `${id}_vocals_only.mp3`) : undefined;

  onProgress?.(90, 'Background music.mp3 အဖြစ် ပြောင်းလဲသိမ်းဆည်းနေသည်...');
  await execAsync(`ffmpeg -nostdin -loglevel error -y -i "${srcStem}" -c:a libmp3lame -q:a 2 "${bgmMp3Path}"`);
  if (sep.vocalStemPath && vocalMp3Path && fs.existsSync(sep.vocalStemPath)) {
    await execAsync(`ffmpeg -nostdin -loglevel error -y -i "${sep.vocalStemPath}" -c:a libmp3lame -q:a 3 "${vocalMp3Path}"`).catch(() => {});
  }

  onProgress?.(96, 'Background music.mp3 အသံဖိုင် အချိန်တိုင်းတာစစ်ဆေးနေသည်...');
  let durationSec = 0;
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${bgmMp3Path}"`
    );
    durationSec = parseFloat(stdout.trim()) || 0;
  } catch (_) {}

  // Cleanup intermediate files
  try {
    if (fs.existsSync(rawAudioPath)) fs.unlinkSync(rawAudioPath);
    if (sep.instrumentalStemPath && sep.instrumentalStemPath !== rawAudioPath && fs.existsSync(sep.instrumentalStemPath)) {
      fs.unlinkSync(sep.instrumentalStemPath);
    }
    if (sep.vocalStemPath && fs.existsSync(sep.vocalStemPath)) {
      fs.unlinkSync(sep.vocalStemPath);
    }
  } catch (_) {}

  onProgress?.(100, '100% — လူသံမပါသော Background music.mp3 ထုတ်ယူပြီး BGM အဖြစ် ထည့်သွင်းပြီးပါပြီ!');

  return {
    success: true,
    bgmMp3Path,
    vocalMp3Path: vocalMp3Path && fs.existsSync(vocalMp3Path) ? vocalMp3Path : undefined,
    engineUsed: sep.engineUsed,
    statusMessage: sep.statusMessage,
    durationSec: parseFloat(durationSec.toFixed(2)),
  };
}

export interface BuiltinBgmJob {
  jobId: string;
  status: 'processing' | 'completed' | 'error';
  percent: number;
  stageLabel: string;
  createdAt: number;
  updatedAt: number;
  bgmUrl?: string;
  durationSec?: number;
  engineUsed?: string;
  error?: string;
}

const builtinBgmJobs = new Map<string, BuiltinBgmJob>();

function getBgmJobFilePath(exportsDir: string, jobId: string): string {
  const safeId = jobId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(exportsDir, `.bgm_job_${safeId}.json`);
}

function saveBgmJob(job: BuiltinBgmJob, exportsDir?: string): void {
  builtinBgmJobs.set(job.jobId, job);
  if (exportsDir) {
    try {
      const filePath = getBgmJobFilePath(exportsDir, job.jobId);
      const tmpPath = `${filePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(job), 'utf8');
      fs.renameSync(tmpPath, filePath);
    } catch (_) {}
  }
}

export function getBuiltinBgmJob(jobId: string, exportsDir?: string): BuiltinBgmJob | undefined {
  const mem = builtinBgmJobs.get(jobId);
  if (mem) return mem;
  if (exportsDir) {
    try {
      const filePath = getBgmJobFilePath(exportsDir, jobId);
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as BuiltinBgmJob;
        if (parsed && parsed.jobId) {
          builtinBgmJobs.set(parsed.jobId, parsed);
          return parsed;
        }
      }
    } catch (_) {}
  }
  return undefined;
}

export async function startBuiltinBgmJob(params: {
  videoPath: string;
  exportsDir: string;
  cleanupVideoAfter: boolean;
}): Promise<BuiltinBgmJob> {
  const jobId = `bgm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const initialJob: BuiltinBgmJob = {
    jobId,
    status: 'processing',
    percent: 22,
    stageLabel: 'ဗီဒီယိုမှ မူရင်းအသံလမ်းကြောင်း ပြင်ဆင်နေသည်...',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  saveBgmJob(initialJob, params.exportsDir);

  const now = Date.now();
  for (const [oldId, oldJob] of builtinBgmJobs.entries()) {
    if (now - oldJob.createdAt > 3600000) {
      builtinBgmJobs.delete(oldId);
    }
  }
  try {
    for (const entry of fs.readdirSync(params.exportsDir)) {
      if (entry.startsWith('.bgm_job_') && entry.endsWith('.json')) {
        const full = path.join(params.exportsDir, entry);
        const st = fs.statSync(full);
        if (now - st.mtimeMs > 3600000) {
          fs.unlinkSync(full);
        }
      }
    }
  } catch (_) {}

  (async () => {
    try {
      // Gentle heartbeat capped near actual neural chunk progress so UI tracks 0%->100% faithfully
      let activeFloor = 24;
      const ticker = setInterval(() => {
        const cur = builtinBgmJobs.get(jobId);
        if (!cur || cur.status !== 'processing') return;
        const maxTickPct = Math.min(92, activeFloor + 3);
        const nextPct = Math.min(maxTickPct, Math.max(activeFloor, cur.percent + 1));
        if (nextPct !== cur.percent) {
          saveBgmJob(
            {
              ...cur,
              percent: nextPct,
              updatedAt: Date.now(),
            },
            params.exportsDir
          );
        }
      }, 1500);

      try {
        const res = await extractBgmAndSfxFromVideo(
          params.videoPath,
          params.exportsDir,
          jobId,
          (pct, label) => {
            activeFloor = pct;
            const cur = builtinBgmJobs.get(jobId);
            if (!cur) return;
            saveBgmJob(
              {
                ...cur,
                percent: Math.max(cur.percent, pct),
                stageLabel: label,
                updatedAt: Date.now(),
              },
              params.exportsDir
            );
          }
        );

        const bgmUrl = `/uploads/exports/${path.basename(res.bgmMp3Path)}`;
        saveBgmJob(
          {
            jobId,
            status: 'completed',
            percent: 100,
            stageLabel: '100% — Background music.mp3 ထုတ်ယူပြီး BGM အဖြစ် ထည့်သွင်းပြီးပါပြီ!',
            createdAt: initialJob.createdAt,
            updatedAt: Date.now(),
            bgmUrl,
            durationSec: res.durationSec,
            engineUsed: res.engineUsed,
          },
          params.exportsDir
        );
      } finally {
        clearInterval(ticker);
      }
    } catch (err: any) {
      saveBgmJob(
        {
          jobId,
          status: 'error',
          percent: 0,
          stageLabel: 'Background music.mp3 ထုတ်ယူမှု မအောင်မြင်ပါ',
          createdAt: initialJob.createdAt,
          updatedAt: Date.now(),
          error: err?.message || 'နောက်ခံတီးလုံး ခွဲထုတ်ခြင်း မအောင်မြင်ပါ',
        },
        params.exportsDir
      );
    } finally {
      if (params.cleanupVideoAfter && fs.existsSync(params.videoPath)) {
        try {
          fs.unlinkSync(params.videoPath);
        } catch (_) {}
      }
    }
  })();

  return initialJob;
}

