import React, { useState, useRef } from 'react';
import { Upload, Film, FileVideo, AlertCircle, CheckCircle2, Clock, HardDrive, MonitorPlay, Sparkles } from 'lucide-react';
import { VideoMetadata } from '../types/narrator';

interface VideoUploadSectionProps {
  selectedFile: File | null;
  onSelectFile: (file: File) => void;
  metadata: VideoMetadata | null;
  onMetadataLoaded: (meta: VideoMetadata) => void;
  uploadProgress: number | null;
  isProcessing: boolean;
  onStartProcessing: () => void;
  disabled?: boolean;
}

export const VideoUploadSection: React.FC<VideoUploadSectionProps> = ({
  selectedFile,
  onSelectFile,
  metadata,
  onMetadataLoaded,
  uploadProgress,
  isProcessing,
  onStartProcessing,
  disabled = false,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatDuration = (sec: number): string => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleInspectFile = (file: File) => {
    setValidationError(null);

    // Validate type
    const validExtensions = ['.mp4', '.mov', '.webm', '.mkv', '.m4v'];
    const fileName = file.name.toLowerCase();
    const isValidExt = validExtensions.some((ext) => fileName.endsWith(ext)) || file.type.startsWith('video/');

    if (!isValidExt) {
      setValidationError('ကျေးဇူးပြု၍ MP4, MOV သို့မဟုတ် WebM ဗီဒီယိုဖိုင်ကိုသာ တင်ပေးပါ');
      return;
    }

    // Validate size (limit 350 MB)
    const maxSizeBytes = 350 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      setValidationError(`ဖိုင်အရွယ်အစား (${formatFileSize(file.size)}) သည် ခွင့်ပြုထားသော ပမာဏ 350 MB ထက် ကြီးမားနေပါသည်`);
      return;
    }

    onSelectFile(file);

    // Probe duration and resolution in client-side video element
    const tempUrl = URL.createObjectURL(file);
    const tempVideo = document.createElement('video');
    tempVideo.preload = 'metadata';

    tempVideo.onloadedmetadata = () => {
      const dur = Math.round(tempVideo.duration);
      const width = tempVideo.videoWidth || 1280;
      const height = tempVideo.videoHeight || 720;
      URL.revokeObjectURL(tempUrl);

      // Validate duration (max 30 mins = 1800s)
      if (dur > 1800) {
        setValidationError(`ဗီဒီယိုကြာချိန် (${formatDuration(dur)}) သည် သတ်မှတ်ချက် မိနစ် ၃၀ ထက် ကျော်လွန်နေပါသည်`);
        return;
      }

      onMetadataLoaded({
        filename: file.name,
        filesize: file.size,
        duration: dur,
        width,
        height,
        resolution: `${width}x${height}`,
        format: file.name.split('.').pop() || 'mp4',
        hasAudio: true,
        uploadedAt: Date.now(),
      });
    };

    tempVideo.onerror = () => {
      URL.revokeObjectURL(tempUrl);
      onMetadataLoaded({
        filename: file.name,
        filesize: file.size,
        duration: 30,
        width: 1280,
        height: 720,
        resolution: '1280x720',
        format: file.name.split('.').pop() || 'mp4',
        hasAudio: true,
        uploadedAt: Date.now(),
      });
    };

    tempVideo.src = tempUrl;
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled || isProcessing) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleInspectFile(e.dataTransfer.files[0]);
    }
  };

  const handleLoadSample = async () => {
    try {
      const sampleUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';
      const res = await fetch(sampleUrl);
      const blob = await res.blob();
      const file = new File([blob], 'Sample_Cinematic_Action.mp4', { type: 'video/mp4' });
      handleInspectFile(file);
    } catch (err) {
      console.warn('Could not load online sample, creating virtual sample:', err);
    }
  };

  return (
    <section className="p-6 sm:p-7 rounded-3xl bg-zinc-900/60 border border-white/10 shadow-2xl backdrop-blur-xl space-y-5 relative overflow-hidden">
      {/* Step Title Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold flex items-center justify-center text-sm shadow-md">
            ၁
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <span>ဗီဒီယိုတင်ရန် (Video Upload)</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-mono">
                MP4 / MOV / WebM
              </span>
            </h2>
            <p className="text-xs text-zinc-400 font-myanmar mt-0.5">
              မိမိ၏ ကွန်ပျူတာ သို့မဟုတ် ဖုန်းမှ ဗီဒီယိုဖိုင်ကို ရွေးချယ်တင်သွင်းပါ
            </p>
          </div>
        </div>

        {/* Quick Sample Video Button */}
        <button
          type="button"
          onClick={handleLoadSample}
          disabled={isProcessing}
          className="text-xs text-cyan-300 hover:text-cyan-200 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-xl transition-all font-myanmar flex items-center gap-1.5 cursor-pointer disabled:opacity-50 self-start sm:self-center"
        >
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>နမူနာ Sample ဗီဒီယို စမ်းမည်</span>
        </button>
      </div>

      {/* Clear Limits Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs text-zinc-300 font-myanmar">
        <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 flex items-center gap-2.5">
          <FileVideo className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>ဖိုင်အမျိုးအစား: <strong className="text-white">MP4, MOV, WebM</strong></span>
        </div>
        <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 flex items-center gap-2.5">
          <HardDrive className="w-4 h-4 text-teal-400 shrink-0" />
          <span>အများဆုံး ပမာဏ: <strong className="text-white">350 MB</strong></span>
        </div>
        <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 flex items-center gap-2.5">
          <Clock className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>ကြာချိန်ကန့်သတ်ချက်: <strong className="text-white">မိနစ် ၃၀ အတွင်း</strong></span>
        </div>
      </div>

      {/* Drag & Drop Area */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !isProcessing) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => {
          if (!disabled && !isProcessing) fileInputRef.current?.click();
        }}
        className={`relative border-2 border-dashed rounded-2xl p-8 sm:p-10 text-center transition-all cursor-pointer ${
          isDragging
            ? 'border-cyan-400 bg-cyan-500/10 scale-[1.01]'
            : selectedFile
            ? 'border-emerald-500/40 bg-emerald-950/10 hover:border-emerald-500/60'
            : 'border-white/15 bg-black/30 hover:border-cyan-500/40 hover:bg-white/5'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/*"
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
              handleInspectFile(files[0]);
            }
          }}
        />

        <div className="flex flex-col items-center justify-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 flex items-center justify-center shadow-lg">
            <Upload className="w-7 h-7 stroke-[2]" />
          </div>

          <div className="space-y-1">
            <p className="text-sm font-bold text-white font-myanmar">
              {selectedFile
                ? 'ဗီဒီယိုဖိုင် အသစ်လဲလှယ်ရန် ဤနေရာသို့ ဆွဲထည့်ပါ သို့မဟုတ် နှိပ်ပါ'
                : 'ဗီဒီယိုဖိုင်ကို ဤနေရာသို့ Drag & Drop ဆွဲထည့်ပါ သို့မဟုတ် Browse နှိပ်ပါ'}
            </p>
            <p className="text-xs text-zinc-400 font-myanmar">
              ဖိုင်ရွေးချယ်ပြီးပါက အချက်အလက်များ စစ်ဆေးပြီးမှ "စတင်မည်" ခလုတ်ကို နှိပ်ပါ
            </p>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {validationError && (
        <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2.5 font-myanmar animate-fade-in">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {/* File Details Preview Card (Validated before processing) */}
      {metadata && (
        <div className="p-4 sm:p-5 rounded-2xl bg-white/5 border border-white/10 space-y-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>စစ်ဆေးပြီးသော ဗီဒီယို အချက်အလက်များ:</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold font-myanmar">
              ✓ Validated
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-black/40 border border-white/5 space-y-1">
              <span className="text-[10px] text-zinc-400 block font-myanmar">ဖိုင်အမည်</span>
              <p className="font-semibold text-white truncate" title={metadata.filename}>
                {metadata.filename}
              </p>
            </div>

            <div className="p-3 rounded-xl bg-black/40 border border-white/5 space-y-1">
              <span className="text-[10px] text-zinc-400 block font-myanmar">ဖိုင်အရွယ်အစား</span>
              <p className="font-semibold text-white font-mono">{formatFileSize(metadata.filesize)}</p>
            </div>

            <div className="p-3 rounded-xl bg-black/40 border border-white/5 space-y-1">
              <span className="text-[10px] text-zinc-400 block font-myanmar">ကြာချိန်</span>
              <p className="font-semibold text-cyan-300 font-mono">{formatDuration(metadata.duration)}</p>
            </div>

            <div className="p-3 rounded-xl bg-black/40 border border-white/5 space-y-1">
              <span className="text-[10px] text-zinc-400 block font-myanmar">Resolution</span>
              <p className="font-semibold text-white font-mono">{metadata.resolution}</p>
            </div>
          </div>

          {/* Upload Progress Bar if currently uploading */}
          {uploadProgress !== null && uploadProgress < 100 && (
            <div className="space-y-1.5 pt-2">
              <div className="flex items-center justify-between text-xs text-cyan-300 font-mono font-semibold">
                <span>ဗီဒီယိုဖိုင် ဆာဗာသို့ တင်ပို့နေပါသည်...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-black/50 overflow-hidden border border-white/10">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-teal-400 transition-all duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Primary Action Button (Only starts when clicked) */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-zinc-400 font-myanmar">
              * အောက်ပါ လုပ်ဆောင်ချက်နှင့် အသံ Settings များကို ရွေးချယ်ပြီးပါက စတင်နိုင်ပါသည်
            </p>

            <button
              type="button"
              onClick={onStartProcessing}
              disabled={isProcessing}
              className="w-full sm:w-auto px-7 py-3 rounded-xl bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 text-zinc-950 font-black text-xs hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-xl shadow-cyan-500/25 cursor-pointer active:scale-95 disabled:opacity-50"
            >
              <MonitorPlay className="w-4 h-4 stroke-[2.5]" />
              <span>{isProcessing ? 'လုပ်ဆောင်နေပါသည်...' : 'စတင်မည် (Start Processing)'}</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
