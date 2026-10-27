import React from 'react';
import { Type, Sparkles, Plus, Trash2, Eye } from 'lucide-react';
import { SubtitleSettings, BlurBox } from '../types';

interface SubtitleStyleEditorProps {
  settings: SubtitleSettings;
  onChange: (settings: SubtitleSettings) => void;
  blurBoxes?: BlurBox[];
  onBlurBoxesChange?: (boxes: BlurBox[]) => void;
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
}

export const SubtitleStyleEditor: React.FC<SubtitleStyleEditorProps> = ({
  settings,
  onChange,
  blurBoxes = [],
  onBlurBoxesChange,
  playbackRate = 1.0,
  onPlaybackRateChange,
}) => {
  const handleAddBlurBox = () => {
    if (!onBlurBoxesChange) return;
    const newBox: BlurBox = {
      id: 'blur_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      x: 35,
      y: 35,
      width: 30,
      height: 20,
      blurAmount: 16,
      name: `Blur #${blurBoxes.length + 1}`,
    };
    onBlurBoxesChange([...blurBoxes, newBox]);
  };

  const handleUpdateBlurBox = (id: string, updates: Partial<BlurBox>) => {
    if (!onBlurBoxesChange) return;
    onBlurBoxesChange(blurBoxes.map((b) => (b.id === id ? { ...b, ...updates } : b)));
  };

  const handleDeleteBlurBox = (id: string) => {
    if (!onBlurBoxesChange) return;
    onBlurBoxesChange(blurBoxes.filter((b) => b.id !== id));
  };

  return (
    <div className="space-y-4">
      {/* Subtitle Styling Panel */}
      <div className="glass-panel rounded-2xl p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Type className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold text-white font-display">
              On-Video Subtitle Styling
            </h3>
          </div>
          <span className="text-[10px] font-mono text-cyan-300">Custom Typography</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {/* Font Family */}
          <div className="space-y-1">
            <label className="text-zinc-400 text-[11px] font-semibold">Font Family:</label>
            <select
              value={settings.fontFamily}
              onChange={(e) => onChange({ ...settings, fontFamily: e.target.value as any })}
              className="glass-input w-full px-3 py-1.5 rounded-xl text-xs font-semibold focus:outline-none cursor-pointer"
            >
              <option value="Pyidaungsu">Pyidaungsu</option>
              <option value="Noto Sans Myanmar">Noto Sans Myanmar</option>
              <option value="Plus Jakarta Sans">Plus Jakarta Sans</option>
            </select>
          </div>

          {/* Font Size */}
          <div className="space-y-1">
            <div className="flex justify-between text-zinc-400 text-[11px] font-semibold">
              <span>Size:</span>
              <span className="font-mono text-cyan-400 font-bold">{settings.fontSize}px</span>
            </div>
            <input
              type="range"
              min={1}
              max={72}
              step={1}
              value={settings.fontSize}
              onChange={(e) => onChange({ ...settings, fontSize: parseInt(e.target.value) || 1 })}
              className="w-full h-1.5 bg-white/10 rounded accent-cyan-400 cursor-pointer"
            />
          </div>

          {/* Text Color & Stroke Color */}
          <div className="space-y-1">
            <label className="text-zinc-400 text-[11px] font-semibold block">Colors:</label>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-400 font-medium">Text:</span>
                <input
                  type="color"
                  value={settings.color}
                  onChange={(e) => onChange({ ...settings, color: e.target.value })}
                  className="w-7 h-7 rounded-lg border border-white/20 bg-transparent cursor-pointer"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-400 font-medium">Outline:</span>
                <input
                  type="color"
                  value={settings.strokeColor}
                  onChange={(e) => onChange({ ...settings, strokeColor: e.target.value })}
                  className="w-7 h-7 rounded-lg border border-white/20 bg-transparent cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Position */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-semibold">
              <label className="text-zinc-400">Position:</label>
              {(!!settings.offsetX || !!settings.offsetY) && (
                <button
                  type="button"
                  onClick={() => onChange({ ...settings, offsetX: 0, offsetY: 0 })}
                  className="text-[10px] text-amber-400 hover:underline cursor-pointer"
                >
                  ↺ Reset Drag
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1">
              {(['top', 'center', 'bottom'] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => onChange({ ...settings, positionY: pos, offsetX: 0, offsetY: 0 })}
                  className={`py-1 text-[11px] rounded-lg capitalize transition-colors cursor-pointer ${
                    settings.positionY === pos
                      ? 'bg-cyan-400 text-zinc-950 font-bold shadow-md'
                      : 'bg-white/5 text-zinc-400 hover:text-white'
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Options Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/10 text-xs">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
              <input
                type="checkbox"
                checked={settings.backgroundColor !== 'transparent'}
                onChange={(e) =>
                  onChange({
                    ...settings,
                    backgroundColor: e.target.checked ? 'rgba(0,0,0,0.75)' : 'transparent',
                  })
                }
                className="rounded bg-zinc-900 border-white/20 text-cyan-400 cursor-pointer"
              />
              <span>Black Box Background</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
              <input
                type="checkbox"
                checked={settings.showKaraoke}
                onChange={(e) => onChange({ ...settings, showKaraoke: e.target.checked })}
                className="rounded bg-zinc-900 border-white/20 text-cyan-400 cursor-pointer"
              />
              <span>Karaoke Word Highlight</span>
            </label>
          </div>

          <div className="flex items-center gap-2 text-zinc-400">
            <span className="text-[11px]">Outline:</span>
            <input
              type="range"
              min={0}
              max={8}
              step={1}
              value={settings.strokeWidth}
              onChange={(e) => onChange({ ...settings, strokeWidth: parseInt(e.target.value) })}
              className="w-20 h-1.5 bg-white/10 rounded accent-cyan-400 cursor-pointer"
            />
            <span className="font-mono text-zinc-300 text-[11px] font-bold">{settings.strokeWidth}px</span>
          </div>
        </div>
      </div>

      {/* Video Blur Overlay Manager */}
      <div className="glass-panel rounded-2xl p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold text-white font-display">
              Video Blur Overlay Masks
            </h3>
          </div>
          <span className="text-xs font-mono font-bold text-amber-400">
            {blurBoxes.length} Blur Boxes Active
          </span>
        </div>

        <button
          type="button"
          onClick={handleAddBlurBox}
          className="w-full py-2.5 bg-gradient-to-r from-amber-400 to-orange-400 hover:opacity-90 text-zinc-950 font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add Blur Box</span>
        </button>

        {blurBoxes.length > 0 && (
          <div className="space-y-3 pt-1">
            {blurBoxes.map((box, idx) => (
              <div
                key={box.id}
                className="glass-card p-3.5 rounded-xl space-y-2.5 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-300 flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-amber-400" />
                    <span>Blur Box #{idx + 1}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeleteBlurBox(box.id)}
                    className="p-1 text-zinc-400 hover:text-rose-400 transition-colors flex items-center gap-1 text-xs cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-zinc-400">
                      <span>Intensity:</span>
                      <span className="font-mono text-amber-400 font-bold">{box.blurAmount}px</span>
                    </div>
                    <input
                      type="range"
                      min={4}
                      max={40}
                      step={2}
                      value={box.blurAmount}
                      onChange={(e) => handleUpdateBlurBox(box.id, { blurAmount: parseInt(e.target.value) })}
                      className="w-full h-1.5 bg-white/10 rounded accent-amber-400 cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-zinc-400">
                      <span>Size (W × H):</span>
                      <span className="font-mono text-zinc-300">{box.width}% × {box.height}%</span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="range"
                        min={10}
                        max={100}
                        step={2}
                        value={box.width}
                        onChange={(e) => handleUpdateBlurBox(box.id, { width: parseInt(e.target.value) })}
                        className="w-1/2 h-1.5 bg-white/10 rounded accent-white cursor-pointer"
                      />
                      <input
                        type="range"
                        min={10}
                        max={100}
                        step={2}
                        value={box.height}
                        onChange={(e) => handleUpdateBlurBox(box.id, { height: parseInt(e.target.value) })}
                        className="w-1/2 h-1.5 bg-white/10 rounded accent-white cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-zinc-400">
                      <span>Pos (X, Y):</span>
                      <span className="font-mono text-zinc-300">({box.x}%, {box.y}%)</span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="range"
                        min={0}
                        max={90}
                        step={2}
                        value={box.x}
                        onChange={(e) => handleUpdateBlurBox(box.id, { x: parseInt(e.target.value) })}
                        className="w-1/2 h-1.5 bg-white/10 rounded accent-cyan-400 cursor-pointer"
                      />
                      <input
                        type="range"
                        min={0}
                        max={90}
                        step={2}
                        value={box.y}
                        onChange={(e) => handleUpdateBlurBox(box.id, { y: parseInt(e.target.value) })}
                        className="w-1/2 h-1.5 bg-white/10 rounded accent-cyan-400 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
