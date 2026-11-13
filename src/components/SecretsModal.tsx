import React from 'react';
import { X, ShieldCheck, KeyRound, Sparkles, CheckCircle2, AlertCircle } from 'lucide-react';
import { ServerConfig } from '../types/narrator';

interface SecretsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ServerConfig | null;
}

export const SecretsModal: React.FC<SecretsModalProps> = ({ isOpen, onClose, config }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-xl bg-zinc-900/95 border border-white/10 rounded-3xl p-6 sm:p-7 shadow-2xl space-y-6 overflow-hidden">
        {/* Glow */}
        <div className="absolute -top-24 -right-24 w-60 h-60 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 flex items-center justify-center shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                API Secrets နှင့် လုံခြုံရေး လမ်းညွှန်
              </h3>
              <p className="text-xs text-zinc-400 font-myanmar mt-0.5">
                Google AI Studio Server-Side ပတ်ဝန်းကျင်မှ တိုက်ရိုက်ထိန်းချုပ်ခြင်း
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Security badge note */}
        <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 text-xs text-emerald-200 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1 font-myanmar">
            <p className="font-bold text-emerald-300">
              ဘရောက်ဆာတွင် API Key လုံးဝ မပြပါ (Strict Server-Side Security)
            </p>
            <p className="text-emerald-200/80 leading-relaxed text-[11px]">
              ဤအက်ပ်သည် API Key များကို ဝဘ်စာမျက်နှာပေါ်တွင် ရိုက်ထည့်ခိုင်းခြင်း သို့မဟုတ် Browser Storage တွင် သိမ်းဆည်းခြင်း လုံးဝ မပြုလုပ်ပါ။ အားလုံးကို ဆာဗာအတွင်း လုံခြုံစွာ သိမ်းဆည်းအလုပ်လုပ်ပါသည်။
            </p>
          </div>
        </div>

        {/* Configuration list */}
        <div className="space-y-4">
          {/* Gemini */}
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-bold text-white font-mono">GEMINI_API_KEY</span>
              </div>
              <span
                className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                  config?.geminiConfigured
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                }`}
              >
                {config?.geminiConfigured ? '✓ Connected' : 'Auto Server Managed'}
              </span>
            </div>
            <p className="text-xs text-zinc-300 font-myanmar leading-relaxed">
              Google AI Studio ၏ <span className="text-cyan-300 font-semibold">Settings &gt; Secrets</span> တွင်{' '}
              <code className="text-cyan-300 bg-black/40 px-1 py-0.5 rounded">GEMINI_API_KEY</code> အမည်ဖြင့် ရှိပါက
              Gemini 3.8 Flash ဗီဒီယို ဘာသာပြန်ခြင်းနှင့် Gemini TTS စနစ်များကို အလိုအလျောက် သုံးစွဲနိုင်ပါသည်။
            </p>
          </div>

          {/* Third-party CAMB */}
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-purple-400" />
                <span className="text-xs font-bold text-white font-mono">CAMB_API_KEY (Optional)</span>
              </div>
              <span
                className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                  config?.cambConfigured
                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                }`}
              >
                {config?.cambConfigured ? '✓ Connected' : 'Optional'}
              </span>
            </div>
            <p className="text-xs text-zinc-300 font-myanmar leading-relaxed">
              ပြင်ပ Third-party TTS အသုံးပြုလိုပါက Google AI Studio <span className="text-purple-300 font-semibold">Settings &gt; Secrets</span> တွင်{' '}
              <code className="text-purple-300 bg-black/40 px-1 py-0.5 rounded">CAMB_API_KEY</code> အမည်ဖြင့် ထည့်သွင်းနိုင်ပါသည်။
            </p>
          </div>

          {/* Native Studio Engine */}
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-teal-400" />
                <span className="text-xs font-bold text-white">Native Burmese Neural Voices (24kHz)</span>
              </div>
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/30">
                ✓ Built-in Always Active
              </span>
            </div>
            <p className="text-xs text-zinc-300 font-myanmar leading-relaxed">
              သီဟ (ကျား) နှင့် နီလာ (မ) အပါအဝင် မြန်မာစကားပြော အသံ ၈ မျိုးကို ဆာဗာတွင် တိုက်ရိုက် ထည့်သွင်းထားသဖြင့် မည်သည့်အခါမဆို အခမဲ့ အသုံးပြုနိုင်ပါသည်။
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 text-zinc-950 font-bold text-xs hover:opacity-90 transition-all cursor-pointer shadow-lg shadow-cyan-500/20"
          >
            နားလည်ပါပြီ (Close)
          </button>
        </div>
      </div>
    </div>
  );
};
