import React from 'react';
import { Film, ShieldCheck, Key, Sparkles, Volume2 } from 'lucide-react';
import { ServerConfig } from '../types/narrator';

interface NavbarProps {
  serverConfig: ServerConfig | null;
  onOpenSecretsModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ serverConfig, onOpenSecretsModal }) => {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/10 bg-zinc-950/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-400 via-teal-400 to-sky-500 p-0.5 shadow-lg shadow-cyan-500/20 flex items-center justify-center">
            <div className="w-full h-full bg-zinc-950 rounded-[14px] flex items-center justify-center">
              <Film className="w-5 h-5 text-cyan-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-extrabold text-white tracking-tight">
                Burmese Video Narrator
              </h1>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                AI Studio
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 font-myanmar">
              မြန်မာ ဗီဒီယို ဇာတ်ကြောင်းပြောနှင့် စာတန်းထိုး စနစ်
            </p>
          </div>
        </div>

        {/* Server Status & Secrets Info */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="text-left font-myanmar">
              <span className="text-zinc-300 text-[11px]">Server AI လုံခြုံမှု:</span>{' '}
              <span className="text-emerald-400 font-semibold text-[11px]">
                {serverConfig?.geminiConfigured ? 'GEMINI_API_KEY အဆင်သင့်' : 'Server ချိတ်ဆက်ပြီး'}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenSecretsModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs font-semibold font-myanmar transition-all cursor-pointer shadow-sm active:scale-95"
            title="Google AI Studio Settings > Secrets လမ်းညွှန်"
          >
            <Key className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden md:inline">API Secrets လမ်းညွှန်</span>
            <span className="md:hidden">Secrets</span>
          </button>
        </div>
      </div>
    </header>
  );
};
