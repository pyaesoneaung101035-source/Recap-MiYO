import React from 'react';
import { Menu, Navigation, Sparkles, Layers, Sliders, Download, KeyRound } from 'lucide-react';

interface EdgePanelProps {
  onToggleNavDrawer: () => void;
  onToggleMenuDrawer: () => void;
  onOpenKeysModal: () => void;
  onOpenExportModal: () => void;
  currentStep: number;
  setCurrentStep: (step: number) => void;
}

export const EdgePanel: React.FC<EdgePanelProps> = ({
  onToggleNavDrawer,
  onToggleMenuDrawer,
  onOpenKeysModal,
  onOpenExportModal,
  currentStep,
  setCurrentStep,
}) => {
  return (
    <aside aria-label="Quick Access Edge Panel" className="fixed right-4 top-1/2 -translate-y-1/2 z-40 hidden lg:flex flex-col items-center gap-3 p-2 bg-black/60 backdrop-blur-2xl border border-white/15 rounded-full shadow-2xl">
      <button
        onClick={onToggleNavDrawer}
        className="p-3 rounded-full bg-white/10 hover:bg-cyan-500 hover:text-zinc-950 text-white transition-all shadow-lg cursor-pointer group"
        title="Open Navigation Drawer"
      >
        <Navigation className="w-4 h-4 group-hover:rotate-45 transition-transform" />
      </button>

      <div className="w-6 h-[1px] bg-white/15 my-1" />

      <button
        onClick={() => setCurrentStep(1)}
        className={`p-3 rounded-full transition-all shadow-lg cursor-pointer ${
          currentStep === 1 ? 'bg-cyan-400 text-zinc-950 font-black' : 'bg-white/5 hover:bg-white/15 text-zinc-300'
        }`}
        title="Step 1: Gemini Keys"
      >
        <KeyRound className="w-4 h-4" />
      </button>

      <button
        onClick={() => setCurrentStep(4)}
        className={`p-3 rounded-full transition-all shadow-lg cursor-pointer ${
          currentStep === 4 ? 'bg-teal-400 text-zinc-950 font-black' : 'bg-white/5 hover:bg-white/15 text-zinc-300'
        }`}
        title="Step 4: AI Transcript"
      >
        <Sparkles className="w-4 h-4" />
      </button>

      <button
        onClick={() => setCurrentStep(5)}
        className={`p-3 rounded-full transition-all shadow-lg cursor-pointer ${
          currentStep === 5 ? 'bg-emerald-400 text-zinc-950 font-black' : 'bg-white/5 hover:bg-white/15 text-zinc-300'
        }`}
        title="Step 5: Voice Clone Studio"
      >
        <Layers className="w-4 h-4" />
      </button>

      <button
        onClick={() => setCurrentStep(7)}
        className={`p-3 rounded-full transition-all shadow-lg cursor-pointer ${
          currentStep === 7 ? 'bg-amber-400 text-zinc-950 font-black' : 'bg-white/5 hover:bg-white/15 text-zinc-300'
        }`}
        title="Step 7: Video Editing Studio"
      >
        <Sliders className="w-4 h-4" />
      </button>

      <div className="w-6 h-[1px] bg-white/15 my-1" />

      <button
        onClick={onOpenExportModal}
        className="p-3 rounded-full bg-gradient-to-tr from-cyan-400 to-teal-400 text-zinc-950 hover:opacity-90 transition-all shadow-lg cursor-pointer"
        title="Export Video"
      >
        <Download className="w-4 h-4 stroke-[2.5]" />
      </button>

      <div className="w-6 h-[1px] bg-white/15 my-1" />

      <button
        onClick={onToggleMenuDrawer}
        className="p-3 rounded-full bg-white/10 hover:bg-white/25 text-white transition-all shadow-lg cursor-pointer"
        title="Open Menu Drawer"
      >
        <Menu className="w-4 h-4" />
      </button>
    </aside>
  );
};
