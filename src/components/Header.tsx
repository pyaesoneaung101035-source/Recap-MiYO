import React from 'react';
import { KeyRound, Sparkles, Layers, Sliders, Download, Video, ShieldCheck, Cpu, Palette } from 'lucide-react';
import { GeminiKeyInfo } from '../types';

interface HeaderProps {
  geminiKeys: GeminiKeyInfo[];
  theme: 'obsidian' | 'cyberpunk' | 'glass' | 'emerald' | 'sunset' | 'light';
  setTheme: (theme: 'obsidian' | 'cyberpunk' | 'glass' | 'emerald' | 'sunset' | 'light') => void;
  onOpenKeysModal: () => void;
  onOpenExportModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  geminiKeys,
  theme,
  setTheme,
  onOpenKeysModal,
  onOpenExportModal,
}) => {
  const activeGeminiCount = geminiKeys.filter((k) => k.status === 'active').length;

  const themes = [
    { id: 'obsidian', label: 'Obsidian Dark' },
    { id: 'cyberpunk', label: 'Cyberpunk Neon' },
    { id: 'glass', label: 'Glassmorphism' },
    { id: 'emerald', label: 'Emerald Glow' },
    { id: 'sunset', label: 'Sunset Amber' },
    { id: 'light', label: 'Clean Light' },
  ];

  return (
    <header className="sticky top-0 z-50 px-4 lg:px-8 pt-3 pb-2 backdrop-blur-2xl border-b border-white/10 bg-black/40">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        {/* iOS Glass Brand Badge */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-[14px] bg-gradient-to-tr from-sky-400 via-cyan-500 to-teal-400 flex items-center justify-center text-zinc-950 shadow-xl shadow-cyan-500/20 ring-1 ring-white/30 active:scale-95 transition-transform cursor-pointer">
            <Video className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display font-black text-base tracking-tight text-white">
                MotionRecap <span className="text-cyan-400 font-normal">Ultimate Studio</span>
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-white/10 text-cyan-300 border border-white/15 backdrop-blur-md">
                Pro v3.0
              </span>
            </div>
            <span className="text-[10px] text-zinc-400 block font-medium">
              Myanmar AI Video & Audio Production
            </span>
          </div>
        </div>

        {/* Theme Selector Dropdown */}
        <div className="hidden sm:flex items-center gap-2">
          <Palette className="w-4 h-4 text-cyan-400" />
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as any)}
            className="px-3 py-1.5 bg-white/10 border border-white/15 rounded-xl text-xs font-bold text-white cursor-pointer backdrop-blur-md focus:outline-none focus:ring-2 focus:ring-cyan-400"
          >
            {themes.map((t) => (
              <option key={t.id} value={t.id} className="bg-zinc-900 text-white">
                Theme: {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* iOS Glass Control Center Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onOpenKeysModal}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-full border transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 ${
              geminiKeys.length > 0
                ? 'border-sky-400/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25'
                : 'border-amber-400/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5 text-sky-400" />
            <span>Keys ({activeGeminiCount}/{geminiKeys.length || 0})</span>
          </button>

          <button
            onClick={onOpenExportModal}
            className="px-4 py-1.5 text-xs bg-gradient-to-r from-cyan-400 to-teal-400 hover:opacity-90 text-zinc-950 font-black rounded-full flex items-center gap-1.5 cursor-pointer shadow-lg shadow-cyan-500/20 active:scale-95 transition-all"
          >
            <Download className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Export</span>
          </button>
        </div>
      </div>
    </header>
  );
};
