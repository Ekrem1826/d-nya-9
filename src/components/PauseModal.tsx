/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { STRINGS } from '../strings.ts';
import { Play, LogOut, Info, PauseCircle } from 'lucide-react';

interface PauseModalProps {
  isOpen: boolean;
  onResume: () => void;
  onQuitMatch: () => void;
  onOpenTactics: () => void;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  isOpen,
  onResume,
  onQuitMatch,
  onOpenTactics,
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-modal-title"
      className="absolute inset-0 z-40 bg-black/85 flex flex-col items-center justify-center p-4 select-none"
    >
      <div className="w-full max-w-xs bg-stone-900 border-2 border-stone-700 rounded-3xl p-6 text-center shadow-2xl">
        <div className="w-12 h-12 rounded-2xl bg-amber-950/80 border border-amber-700/60 flex items-center justify-center text-amber-400 mx-auto mb-3">
          <PauseCircle className="w-6 h-6" />
        </div>
        <h3 id="pause-modal-title" className="text-2xl font-black text-white mb-1">
          {STRINGS.pause.title}
        </h3>
        <p className="text-xs text-stone-400 mb-5">{STRINGS.pause.subtitle}</p>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onResume}
            className="w-full min-h-[44px] py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-black text-white text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/60 transition-colors"
          >
            <Play className="w-4 h-4 fill-current" />
            {STRINGS.pause.resume}
          </button>

          <button
            type="button"
            onClick={onOpenTactics}
            className="w-full min-h-[44px] py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 border border-stone-700 font-bold text-stone-200 text-xs flex items-center justify-center gap-2 transition-colors"
          >
            <Info className="w-4 h-4 text-emerald-400" />
            {STRINGS.pause.tacticsInfo}
          </button>

          <button
            type="button"
            onClick={onQuitMatch}
            className="w-full min-h-[44px] py-3 rounded-xl bg-rose-900/90 hover:bg-rose-800 border border-rose-700/70 font-black text-rose-100 text-sm flex items-center justify-center gap-2 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            {STRINGS.pause.quitMatch}
          </button>
        </div>
      </div>
    </div>
  );
};
