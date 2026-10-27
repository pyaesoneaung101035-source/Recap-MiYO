import React from 'react';
import { X, Palette, KeyRound, Download, Sparkles, Shield, Cpu, RefreshCcw } from 'lucide-react';

interface MenuDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  theme: string;
  setTheme: (theme: any) => void;
  onOpenKeysModal: () => void;
  onOpenExportModal: () => void;
}

export const MenuDrawer: React.FC<MenuDrawerProps> = ({
  isOpen,
  onClose,
  theme,
  setTheme,
  onOpenKeysModal,
  onOpenExportModal,
}) => {
  if (!isOpen) return null;

  const themes = [
    { id: 'obsidian', label: 'Obsidian Dark', color: 'bg-zinc-950 border-zinc-800' },
    { id: 'cyberpunk', label: 'Cyberpunk Neon', color: 'bg-neutral-950 border-yellow-500/40' },
    { id: 'glass', label: 'Glassmorphism', color: 'bg-indigo-950 border-indigo-500/40' },
    { id: 'emerald', label: 'Emerald Glow', color: 'bg-slate-950 border-emerald-500/40' },
    { id: 'sunset', label: 'Sunset Amber', color: 'bg-stone-950 border-orange-500/40' },
    { id: 'light', label: 'Clean Light', color: 'bg-slate-100 border-slate-300' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-md h-full bg-zinc-950 border-l border-white/15 p-6 flex flex-col justify-between shadow-2xl relative overflow-y-auto">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="space-y-6 relative z-10">
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <Palette className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-white font-display">Control Center</h3>
                <p className="text-xs text-zinc-400">Themes & API Integrations</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Theme Switcher */}
          <div className="space-y-3">
            <span className="text-xs font-black text-zinc-300 uppercase tracking-widest block font-display">
              App Appearance & Themes
            </span>
            <div className="grid grid-cols-2 gap-2.5">
              {themes.map((t) => {
                const isSelected = theme === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={`p-3 rounded-2xl border text-xs font-bold transition-all flex items-center justify-between cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-lg ring-1 ring-emerald-400/40 font-black'
                        : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <span>{t.label}</span>
                    {isSelected && <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-md" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="space-y-3 pt-4 border-t border-white/10">
            <span className="text-xs font-black text-zinc-300 uppercase tracking-widest block font-display">
              API & Cloud Integrations
            </span>

            <button
              onClick={() => {
                onOpenKeysModal();
                onClose();
              }}
              className="w-full p-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-left flex items-center justify-between transition-all cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30">
                  <KeyRound className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-xs font-black block text-white font-display">Gemini API Keys</span>
                  <span className="text-[10px] text-zinc-400">Multi-Key Rotation Pool</span>
                </div>
              </div>
              <span className="text-xs font-bold text-sky-400 group-hover:translate-x-1 transition-transform">Configure →</span>
            </button>

            <button
              onClick={() => {
                onOpenExportModal();
                onClose();
              }}
              className="w-full p-4 rounded-2xl bg-gradient-to-r from-cyan-500/20 to-teal-500/20 border border-cyan-500/30 text-left flex items-center justify-between transition-all cursor-pointer group"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-cyan-400 text-zinc-950 font-black">
                  <Download className="w-4 h-4 stroke-[2.5]" />
                </div>
                <div>
                  <span className="text-xs font-black block text-white font-display">Export Studio</span>
                  <span className="text-[10px] text-cyan-300">Download MP4 & History Log</span>
                </div>
              </div>
              <span className="text-xs font-bold text-cyan-300 group-hover:translate-x-1 transition-transform">Export →</span>
            </button>
          </div>
        </div>

        <div className="pt-6 border-t border-white/10 text-center text-xs text-zinc-500 font-mono relative z-10">
          Secure LocalStorage & Proxy Enabled
        </div>
      </div>
    </div>
  );
};
