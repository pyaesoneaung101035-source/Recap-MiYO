import React, { useState } from 'react';
import {
  Volume2,
  VolumeX,
  Sliders,
  Download,
  FileText,
  Subtitles,
  Film,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { NarratorJob } from '../types/narrator';
import { exportFinalPackage } from '../utils/narratorApi';

interface AudioSyncExportSectionProps {
  job: NarratorJob | null;
  onJobUpdated: (updatedJob: NarratorJob) => void;
  disabled?: boolean;
}

export const AudioSyncExportSection: React.FC<AudioSyncExportSectionProps> = ({
  job,
  onJobUpdated,
  disabled = false,
}) => {
  const [muteOriginal, setMuteOriginal] = useState<boolean>(job?.muteOriginal !== undefined ? job.muteOriginal : true);
  const [originalVolume, setOriginalVolume] = useState<number>(job?.originalVolume !== undefined ? job.originalVolume : 0.0);
  const [narrationVolume, setNarrationVolume] = useState<number>(job?.narrationVolume !== undefined ? job.narrationVolume : 1.0);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  if (!job) return null;

  const handleExport = async () => {
    setIsExporting(true);
    setExportMessage('အသံလှိုင်းများကို ညှိနှိုင်းပြီး MP4 ဗီဒီယိုနှင့် စာတန်းထိုးများကို ထုတ်ပေးနေပါသည်...');
    try {
      const res = await exportFinalPackage(job.id, {
        muteOriginal,
        originalVolume,
        narrationVolume,
      });
      if (res.exportUrls) {
        onJobUpdated({
          ...job,
          exportUrls: res.exportUrls,
          stage: 'completed',
          overallPercent: 100,
        });
        setExportMessage('Export အားလုံး အောင်မြင်စွာ ပြီးစီးပါပြီ!');
      }
    } catch (err: any) {
      console.error('Export failed:', err);
      setExportMessage(`Export မအောင်မြင်ပါ: ${err.message || 'Error'}`);
    } finally {
      setIsExporting(false);
    }
  };

  const readySegmentsCount = job.segments.filter((s) => Boolean(s.audioUrl)).length;
  const totalSegments = job.segments.length;

  return (
    <section className="p-6 sm:p-7 rounded-3xl bg-zinc-900/60 border border-white/10 shadow-2xl backdrop-blur-xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold flex items-center justify-center text-sm shadow-md">
            ၆
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <span>အသံနှင့် Sync ချိန်ညှိမှု (Audio & Sync Controls)</span>
            </h2>
            <p className="text-xs text-zinc-400 font-myanmar mt-0.5">
              မူရင်းအသံ ပိတ်/ဖွင့်၊ အသံအတိုးအကျယ်နှင့် အချိန်ကိုက် ဇာတ်ကြောင်းပြော ဗီဒီယို ထုတ်ယူပါ
            </p>
          </div>
        </div>

        <span className="text-xs px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-bold font-myanmar self-start sm:self-center">
          အသံအသင့်ဖြစ်မှု: {readySegmentsCount} / {totalSegments} အပိုင်း
        </span>
      </div>

      {/* Rules Notice */}
      <div className="p-4 rounded-2xl bg-cyan-950/30 border border-cyan-500/30 text-xs text-cyan-200 space-y-1 font-myanmar">
        <p className="font-bold text-cyan-300 flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4 text-cyan-400" />
          <span>အချိန်ကိုက် ညှိနှိုင်းမှု စည်းမျဉ်းများ (Timing Fit Standards):</span>
        </p>
        <p className="text-cyan-200/80 leading-relaxed text-[11px]">
          အသံကြာချိန်က သတ်မှတ်အချိန်ထက် ကျော်လွန်နေပါက ပုံမှန်ထက် အလွန်အမင်းမြန်အောင် မလုပ်ဘဲ (အများဆုံး ၁၀% ထက် ပိုမမြန်စေဘဲ)၊
          စာသားကို ပိုမိုတိုတိုနှင့် လိုရင်းဖြစ်အောင် ဦးစွာ ပြင်ဆင်ပြီးမှသာ ဇာတ်ကွက်အတွင်း အံဝင်ခွင်ကျ ထည့်သွင်းထားပါသည်။
        </p>
      </div>

      {/* Volume & Audio Mixing Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Original Video Audio Controls */}
        <div className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white font-myanmar flex items-center gap-2">
              <Film className="w-4 h-4 text-cyan-400" />
              <span>မူရင်းဗီဒီယို အသံ (Original Audio)</span>
            </span>

            <button
              type="button"
              onClick={() => setMuteOriginal(!muteOriginal)}
              className={`px-3 py-1 rounded-xl text-xs font-bold font-myanmar flex items-center gap-1.5 transition-all cursor-pointer ${
                muteOriginal
                  ? 'bg-rose-500/20 border border-rose-500/40 text-rose-300'
                  : 'bg-white/10 text-zinc-300 hover:text-white'
              }`}
            >
              {muteOriginal ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              <span>{muteOriginal ? 'မူရင်းအသံ ပိတ်ထားသည် (Muted)' : 'မူရင်းအသံ ဖွင့်ထားသည်'}</span>
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-myanmar">
              <span className="text-zinc-400">မူရင်းအသံ အတိုးအကျယ်:</span>
              <span className="font-mono text-zinc-300 font-bold">
                {muteOriginal ? '0%' : `${Math.round(originalVolume * 100)}%`}
              </span>
            </div>

            <input
              type="range"
              min="0.0"
              max="1.0"
              step="0.05"
              value={muteOriginal ? 0 : originalVolume}
              disabled={muteOriginal || disabled}
              onChange={(e) => {
                setOriginalVolume(parseFloat(e.target.value));
                if (muteOriginal) setMuteOriginal(false);
              }}
              className="w-full accent-cyan-400 h-1.5 bg-zinc-800 rounded-lg cursor-pointer disabled:opacity-40"
            />
            <p className="text-[11px] text-zinc-500 font-myanmar">
              * မူရင်းစကားပြောများကို အသံပိတ်ထားပြီး နောက်ခံတီးလုံးကို အနည်းငယ်သာထားလိုပါက 10% - 20% ထားနိုင်ပါသည်
            </p>
          </div>
        </div>

        {/* Narrator Voiceover Volume Controls */}
        <div className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white font-myanmar flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-emerald-400" />
              <span>မြန်မာ ဇာတ်ကြောင်းပြော အသံ (Burmese Narration)</span>
            </span>

            <span className="text-xs font-mono font-bold text-emerald-300 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
              {Math.round(narrationVolume * 100)}%
            </span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-myanmar">
              <span className="text-zinc-400">ဇာတ်ကြောင်းပြောသူ အသံအတိုးအကျယ်:</span>
              <span className="font-mono text-emerald-400 font-bold">{narrationVolume.toFixed(2)}x</span>
            </div>

            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={narrationVolume}
              disabled={disabled}
              onChange={(e) => setNarrationVolume(parseFloat(e.target.value))}
              className="w-full accent-emerald-400 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
            />

            <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
              <span>0.5x (တိုး)</span>
              <span>1.0x (စံနှုန်း)</span>
              <span>1.5x (ကျယ်)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Primary Export Action */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-zinc-900 to-cyan-950/40 border border-emerald-500/30 space-y-4 shadow-xl">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="space-y-1 text-center sm:text-left">
            <h3 className="text-sm font-bold text-white font-myanmar flex items-center gap-2 justify-center sm:justify-start">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>Final Sync & Video Export ပြုလုပ်မည်</span>
            </h3>
            <p className="text-xs text-zinc-400 font-myanmar">
              အချိန်ကိုက် ဇာတ်ကြောင်းပြောပါဝင်သော ဗီဒီယို (MP4) နှင့် စာတန်းထိုး (.SRT) ဖိုင်များကို ထုတ်ယူပါ
            </p>
          </div>

          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting || disabled || readySegmentsCount === 0}
            className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 text-zinc-950 font-black text-xs hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-xl shadow-emerald-500/20 cursor-pointer active:scale-95 disabled:opacity-50"
          >
            {isExporting ? (
              <RotateCw className="w-4 h-4 animate-spin stroke-[2.5]" />
            ) : (
              <Download className="w-4 h-4 stroke-[2.5]" />
            )}
            <span className="font-myanmar">
              {isExporting ? 'Export ထုတ်လုပ်နေပါသည်...' : 'ဗီဒီယိုအသစ် (MP4) နှင့် ဖိုင်များ ထုတ်ယူမည်'}
            </span>
          </button>
        </div>

        {exportMessage && (
          <p className="text-xs text-emerald-300 font-myanmar bg-black/40 p-3 rounded-xl border border-white/5 text-center sm:text-left">
            {exportMessage}
          </p>
        )}

        {/* Download Links Cards if completed */}
        {job.exportUrls && (
          <div className="pt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-fade-in">
            {job.exportUrls.videoMp4 && (
              <a
                href={job.exportUrls.videoMp4}
                download={`${job.videoMetadata.filename.replace(/\.[^.]+$/, '')}_narrated.mp4`}
                className="p-3.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 text-xs font-bold font-myanmar flex items-center justify-between transition-all"
              >
                <div className="flex items-center gap-2">
                  <Film className="w-4 h-4 text-cyan-400" />
                  <span>ဗီဒီယို (MP4) ဒေါင်းလုဒ်</span>
                </div>
                <Download className="w-4 h-4" />
              </a>
            )}

            {job.exportUrls.subtitleSrt && (
              <a
                href={job.exportUrls.subtitleSrt}
                download={`${job.videoMetadata.filename.replace(/\.[^.]+$/, '')}_subtitles.srt`}
                className="p-3.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-200 text-xs font-bold font-myanmar flex items-center justify-between transition-all"
              >
                <div className="flex items-center gap-2">
                  <Subtitles className="w-4 h-4 text-purple-400" />
                  <span>စာတန်းထိုး (.SRT)</span>
                </div>
                <Download className="w-4 h-4" />
              </a>
            )}

            {job.exportUrls.scriptTxt && (
              <a
                href={job.exportUrls.scriptTxt}
                download={`${job.videoMetadata.filename.replace(/\.[^.]+$/, '')}_script.txt`}
                className="p-3.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs font-bold font-myanmar flex items-center justify-between transition-all"
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-zinc-300" />
                  <span>ဇာတ်ညွှန်း (.TXT)</span>
                </div>
                <Download className="w-4 h-4" />
              </a>
            )}

            {job.exportUrls.audioWav && (
              <a
                href={job.exportUrls.audioWav}
                download={`${job.videoMetadata.filename.replace(/\.[^.]+$/, '')}_narrator_audio.wav`}
                className="p-3.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-xs font-bold font-myanmar flex items-center justify-between transition-all"
              >
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-emerald-400" />
                  <span>အသံသီးသန့် (.WAV)</span>
                </div>
                <Download className="w-4 h-4" />
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
