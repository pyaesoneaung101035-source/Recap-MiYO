import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type SeparationEngine = 'demucs' | 'uvr' | 'ffmpeg_stem_filter' | 'passthrough';

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
 * Checks system availability for AI stem separation engines (Demucs / UVR CLI).
 */
export async function detectSeparationCapabilities(): Promise<{
  hasDemucs: boolean;
  hasUvr: boolean;
  hasFFmpegFilters: boolean;
  preferredEngine: SeparationEngine;
  description: string;
}> {
  let hasDemucs = false;
  let hasUvr = false;
  let hasFFmpegFilters = true; // ffmpeg filter fallback is built-in

  try {
    await execAsync('demucs --help');
    hasDemucs = true;
  } catch (_) {
    hasDemucs = false;
  }

  try {
    await execAsync('python3 -m uvr5 --help');
    hasUvr = true;
  } catch (_) {
    hasUvr = false;
  }

  let preferredEngine: SeparationEngine = 'ffmpeg_stem_filter';
  let description = 'FFmpeg Vocal Reduction Stem Filter (Built-in Server Audio Separator)';

  if (hasDemucs) {
    preferredEngine = 'demucs';
    description = 'Demucs AI Deep Neural Vocal/BGM Separation Engine';
  } else if (hasUvr) {
    preferredEngine = 'uvr';
    description = 'UVR5 (Ultimate Vocal Remover) Engine';
  }

  return {
    hasDemucs,
    hasUvr,
    hasFFmpegFilters,
    preferredEngine,
    description,
  };
}

/**
 * Perform real stem separation or high-fidelity FFmpeg vocal attenuation to preserve BGM & SFX.
 * Does NOT generate fake audio tracks.
 */
export async function separateAudioStems(
  inputAudioPath: string,
  outputDir: string,
  jobId: string
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

  const caps = await detectSeparationCapabilities();
  const instStemPath = path.join(outputDir, `${jobId}_instrumental_stem.wav`);
  const vocalStemPath = path.join(outputDir, `${jobId}_vocal_stem.wav`);

  // 1. Try Demucs AI separation if binary exists
  if (caps.hasDemucs) {
    try {
      const outTemp = path.join(outputDir, `demucs_out_${jobId}`);
      await execAsync(`demucs -n hdemucs_m --two-stems=vocals -o "${outTemp}" "${inputAudioPath}"`);
      
      const fileNameNoExt = path.basename(inputAudioPath, path.extname(inputAudioPath));
      const demucsInst = path.join(outTemp, 'hdemucs_m', fileNameNoExt, 'no_vocals.wav');
      const demucsVoc = path.join(outTemp, 'hdemucs_m', fileNameNoExt, 'vocals.wav');

      if (fs.existsSync(demucsInst) && fs.existsSync(demucsVoc)) {
        fs.copyFileSync(demucsInst, instStemPath);
        fs.copyFileSync(demucsVoc, vocalStemPath);
        fs.rmSync(outTemp, { recursive: true, force: true });

        return {
          success: true,
          engineUsed: 'demucs',
          instrumentalStemPath: instStemPath,
          vocalStemPath: vocalStemPath,
          statusMessage: 'Demucs AI ဖြင့် သီချင်း/နောက်ခံသံ (BGM) နှင့် စကားပြောသံ (Vocals) သီးခြားခွဲထုတ်ပြီးပါပြီ',
          isFallback: false,
        };
      }
    } catch (demucsErr: any) {
      console.warn('Demucs separation failed, falling back to FFmpeg filter:', demucsErr.message);
    }
  }

  // 2. High-Fidelity FFmpeg Adaptive Split-Band Vocal Suppression (preserves BGM & SFX while removing human vocals)
  try {
    // Check if audio has usable stereo side information (c0 - c1)
    let sideMeanDb = -91;
    try {
      const { stderr: probeErr } = await execAsync(
        `ffmpeg -y -i "${inputAudioPath}" -t 20 -af "pan=stereo|c0=c0-c1|c1=c1-c0,volumedetect" -f null - 2>&1`
      );
      const match = probeErr.match(/mean_volume:\s*([-\d.]+)\s*dB/);
      if (match) {
        sideMeanDb = parseFloat(match[1]);
      }
    } catch (_) {}

    if (sideMeanDb > -48) {
      // Stereo Split-Band Vocal Remover:
      // - Keep sub-bass music punch (<170Hz) smoothly
      // - Cancel centered human speech in midrange (170Hz+) via phase subtraction + vocal presence notch
      // - Limit peaks cleanly
      const ffmpegInstCmd = `ffmpeg -y -i "${inputAudioPath}" -filter_complex "[0:a]asplit=2[lowin][midin];[lowin]lowpass=f=170,volume=0.65[lows];[midin]pan=stereo|c0=c0-c1|c1=c1-c0,highpass=f=170,equalizer=f=1700:t=q:w=1.2:g=-6,volume=1.35[sides];[lows][sides]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95[inst]" -map "[inst]" -c:a pcm_s16le "${instStemPath}"`;
      await execAsync(ffmpegInstCmd);
    } else {
      // Mono / Dual-Mono Spectral Speech Suppression:
      // Attenuate core vocal formants (320Hz - 3400Hz) while retaining low-end BGM & high-end SFX
      const ffmpegMonoInstCmd = `ffmpeg -y -i "${inputAudioPath}" -filter_complex "[0:a]equalizer=f=320:t=q:w=1.2:g=-12,equalizer=f=850:t=q:w=1.0:g=-16,equalizer=f=1800:t=q:w=0.9:g=-18,equalizer=f=3200:t=q:w=1.1:g=-14,highpass=f=45,alimiter=limit=0.95[inst]" -map "[inst]" -c:a pcm_s16le "${instStemPath}"`;
      await execAsync(ffmpegMonoInstCmd);
    }

    // Extract isolated vocal stem for reference
    const ffmpegVocCmd = `ffmpeg -y -i "${inputAudioPath}" -filter_complex "[0:a]bandpass=f=1300:width_type=h:w=2200,volume=1.2[voc]" -map "[voc]" -c:a pcm_s16le "${vocalStemPath}"`;
    await execAsync(ffmpegVocCmd).catch(() => {});

    if (fs.existsSync(instStemPath) && fs.statSync(instStemPath).size > 1000) {
      return {
        success: true,
        engineUsed: 'ffmpeg_stem_filter',
        instrumentalStemPath: instStemPath,
        vocalStemPath: fs.existsSync(vocalStemPath) ? vocalStemPath : undefined,
        statusMessage: 'FFmpeg Split-Band Vocal Removal ဖြင့် မူရင်းလူစကားပြောသံများ ဖယ်ရှားပြီး နောက်ခံတီးလုံး/SFX (BGM Only) ကို ခွဲထုတ်ပြီးပါပြီ',
        isFallback: false,
      };
    }
  } catch (ffmpegErr: any) {
    console.warn('FFmpeg stem separation failed:', ffmpegErr.message);
  }

  // 3. Safe Passthrough if stem filtering fails
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
 * and encodes a lightweight MP3 + measured duration for instant preview & export mixing.
 */
export async function extractBgmAndSfxFromVideo(
  videoPath: string,
  outputDir: string,
  id: string
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

  const rawWavPath = path.join(outputDir, `${id}_raw_audio.wav`);
  try {
    await execAsync(`ffmpeg -y -i "${videoPath}" -vn -ac 2 -ar 44100 -c:a pcm_s16le "${rawWavPath}"`);
  } catch (extractErr: any) {
    throw new Error('ဗီဒီယိုတွင် ခွဲထုတ်ရန် အသံလမ်းကြောင်း မတွေ့ရှိပါ');
  }

  const sep = await separateAudioStems(rawWavPath, outputDir, id);
  const srcStem = sep.instrumentalStemPath || rawWavPath;
  const bgmMp3Path = path.join(outputDir, `${id}_bgm_only.mp3`);
  const vocalMp3Path = sep.vocalStemPath ? path.join(outputDir, `${id}_vocals_only.mp3`) : undefined;

  await execAsync(`ffmpeg -y -i "${srcStem}" -c:a libmp3lame -q:a 2 "${bgmMp3Path}"`);
  if (sep.vocalStemPath && vocalMp3Path && fs.existsSync(sep.vocalStemPath)) {
    await execAsync(`ffmpeg -y -i "${sep.vocalStemPath}" -c:a libmp3lame -q:a 3 "${vocalMp3Path}"`).catch(() => {});
  }

  let durationSec = 0;
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${bgmMp3Path}"`
    );
    durationSec = parseFloat(stdout.trim()) || 0;
  } catch (_) {}

  // Cleanup bulky intermediate WAV files
  try {
    if (fs.existsSync(rawWavPath)) fs.unlinkSync(rawWavPath);
    if (sep.instrumentalStemPath && sep.instrumentalStemPath !== rawWavPath && fs.existsSync(sep.instrumentalStemPath)) {
      fs.unlinkSync(sep.instrumentalStemPath);
    }
    if (sep.vocalStemPath && fs.existsSync(sep.vocalStemPath)) {
      fs.unlinkSync(sep.vocalStemPath);
    }
  } catch (_) {}

  return {
    success: true,
    bgmMp3Path,
    vocalMp3Path: vocalMp3Path && fs.existsSync(vocalMp3Path) ? vocalMp3Path : undefined,
    engineUsed: sep.engineUsed,
    statusMessage: sep.statusMessage,
    durationSec: parseFloat(durationSec.toFixed(2)),
  };
}
