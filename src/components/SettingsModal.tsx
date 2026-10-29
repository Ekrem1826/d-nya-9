/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { GameSettings, loadSettings, saveSettings, subscribeSettings } from '../game/settings.ts';
import { sound } from '../game/sound.ts';
import { haptics } from '../game/haptics.ts';
import { STRINGS } from '../strings.ts';
import { X, Volume2, VolumeX, Smartphone, Settings } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [settings, setSettings] = useState<GameSettings>(() => loadSettings());

  useEffect(() => {
    setSettings(loadSettings());
    return subscribeSettings((next) => setSettings(next));
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleSound = () => {
    const nextSound = !settings.soundEnabled;
    const updated = saveSettings({ ...settings, soundEnabled: nextSound });
    setSettings(updated);
    if (nextSound) {
      sound.unlockAudio();
      sound.playSelection();
    }
  };

  const toggleVibration = () => {
    const nextVib = !settings.vibrationEnabled;
    const updated = saveSettings({ ...settings, vibrationEnabled: nextVib });
    setSettings(updated);
    if (nextVib) {
      haptics.vibrateTap();
    }
    sound.playSelection();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 select-none"
    >
      <div className="w-full max-w-md bg-stone-900 border-2 border-stone-700 rounded-3xl p-5 shadow-2xl text-stone-100">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-stone-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-950/80 border border-emerald-700/60 flex items-center justify-center text-emerald-400">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 id="settings-modal-title" className="text-lg font-black text-white">
                {STRINGS.settings.modalTitle}
              </h2>
              <p className="text-[11px] text-stone-400">{STRINGS.settings.modalSubtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={STRINGS.settings.close}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Controls */}
        <div className="space-y-3 mb-5">
          {/* Sound Toggle */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-stone-950/80 border border-stone-800">
            <div className="flex items-center gap-3 min-w-0 pr-2">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                  settings.soundEnabled
                    ? 'bg-emerald-950/80 border-emerald-700 text-emerald-400'
                    : 'bg-stone-900 border-stone-800 text-stone-500'
                }`}
              >
                {settings.soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
              </div>
              <div className="min-w-0">
                <span className="text-sm font-bold text-white block">{STRINGS.settings.soundTitle}</span>
                <span className="text-[11px] text-stone-400 block leading-snug">
                  {STRINGS.settings.soundDesc}
                </span>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.soundEnabled}
              aria-label={STRINGS.settings.soundTitle}
              onClick={toggleSound}
              className={`min-w-[78px] min-h-[44px] px-3.5 py-2 rounded-xl font-black text-xs transition-all shrink-0 border ${
                settings.soundEnabled
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-950/60'
                  : 'bg-stone-800 hover:bg-stone-700 text-stone-300 border-stone-700'
              }`}
            >
              {settings.soundEnabled ? STRINGS.settings.on : STRINGS.settings.off}
            </button>
          </div>

          {/* Vibration Toggle */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-stone-950/80 border border-stone-800">
            <div className="flex items-center gap-3 min-w-0 pr-2">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                  settings.vibrationEnabled
                    ? 'bg-amber-950/80 border-amber-700 text-amber-400'
                    : 'bg-stone-900 border-stone-800 text-stone-500'
                }`}
              >
                <Smartphone className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <span className="text-sm font-bold text-white block">{STRINGS.settings.vibrationTitle}</span>
                <span className="text-[11px] text-stone-400 block leading-snug">
                  {STRINGS.settings.vibrationDesc}
                </span>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.vibrationEnabled}
              aria-label={STRINGS.settings.vibrationTitle}
              onClick={toggleVibration}
              className={`min-w-[78px] min-h-[44px] px-3.5 py-2 rounded-xl font-black text-xs transition-all shrink-0 border ${
                settings.vibrationEnabled
                  ? 'bg-amber-600 hover:bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-950/60'
                  : 'bg-stone-800 hover:bg-stone-700 text-stone-300 border-stone-700'
              }`}
            >
              {settings.vibrationEnabled ? STRINGS.settings.on : STRINGS.settings.off}
            </button>
          </div>
        </div>

        {/* Footer */}
        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[44px] py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-black text-xs text-white transition-colors"
        >
          {STRINGS.settings.close}
        </button>
      </div>
    </div>
  );
};
