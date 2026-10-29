/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { TEAMS_DATA, FORMATIONS } from '../game/constants.ts';
import { TeamFlag } from './TeamFlag.tsx';
import { STRINGS } from '../strings.ts';
import { X, Play, Shuffle, ArrowLeftRight, Users, Zap } from 'lucide-react';

interface QuickMatchModalProps {
  isOpen: boolean;
  mode: 'quick' | 'twoPlayer';
  onClose: () => void;
  onStartMatch: (homeTeamId: number, awayTeamId: number, isTwoPlayer: boolean) => void;
}

export const QuickMatchModal: React.FC<QuickMatchModalProps> = ({
  isOpen,
  mode,
  onClose,
  onStartMatch,
}) => {
  const [homeTeamId, setHomeTeamId] = useState<number>(16); // Türkiye
  const [awayTeamId, setAwayTeamId] = useState<number>(3); // Brezilya
  const [activeSlot, setActiveSlot] = useState<'home' | 'away'>('home');

  if (!isOpen) return null;

  const isTwoPlayer = mode === 'twoPlayer';
  const homeTeam = TEAMS_DATA[homeTeamId] || TEAMS_DATA[16];
  const awayTeam = TEAMS_DATA[awayTeamId] || TEAMS_DATA[3];

  const getTeamStars = (rating: number): number => {
    return Math.max(1, Math.min(5, Math.round((rating - 62) / 7)));
  };

  const homeForm =
    FORMATIONS.find((f) => f.id === homeTeam.preferredFormationId) || FORMATIONS[0];
  const awayForm =
    FORMATIONS.find((f) => f.id === awayTeam.preferredFormationId) || FORMATIONS[0];

  const handleRandomize = () => {
    const first = Math.floor(Math.random() * TEAMS_DATA.length);
    let second = Math.floor(Math.random() * TEAMS_DATA.length);
    if (second === first) {
      second = (first + 1) % TEAMS_DATA.length;
    }
    setHomeTeamId(first);
    setAwayTeamId(second);
  };

  const handleSwap = () => {
    setHomeTeamId(awayTeamId);
    setAwayTeamId(homeTeamId);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-match-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 select-none"
    >
      <div className="w-full max-w-xl max-h-[92vh] bg-stone-900 border-2 border-stone-700 rounded-3xl p-4 sm:p-5 shadow-2xl text-stone-100 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-stone-800 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
                isTwoPlayer
                  ? 'bg-cyan-950/80 border-cyan-700/60 text-cyan-400'
                  : 'bg-amber-950/80 border-amber-700/60 text-amber-400'
              }`}
            >
              {isTwoPlayer ? <Users className="w-5 h-5" /> : <Zap className="w-5 h-5" />}
            </div>
            <div>
              <h2 id="quick-match-modal-title" className="text-lg font-black text-white">
                {isTwoPlayer ? STRINGS.modes.twoPlayerTitle : STRINGS.modes.quickMatchTitle}
              </h2>
              <p className="text-[11px] text-stone-400">
                {isTwoPlayer ? STRINGS.modes.twoPlayerSubtitle : STRINGS.modes.quickMatchSubtitle}
              </p>
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

        {/* Selected Teams Matchup Banner */}
        <div className="bg-stone-950/90 p-3 rounded-2xl border border-stone-800 mb-3 shrink-0">
          <div className="grid grid-cols-2 gap-2.5">
            {/* Slot 1: Home / Player 1 */}
            <button
              type="button"
              onClick={() => setActiveSlot('home')}
              className={`p-2.5 rounded-xl border text-left transition-all flex items-center gap-2.5 min-h-[58px] ${
                activeSlot === 'home'
                  ? 'bg-emerald-950/60 border-emerald-500 ring-2 ring-emerald-500/40'
                  : 'bg-stone-900/90 border-stone-800 hover:border-stone-700'
              }`}
            >
              <TeamFlag flag={homeTeam.f} className="w-8 h-5.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <span className="text-[11px] text-emerald-400 font-bold block truncate">
                  {STRINGS.modes.selectHomeTeam}
                </span>
                <span className="text-sm font-black text-white block truncate">{homeTeam.n}</span>
                <span className="text-[11px] text-amber-400 block truncate">
                  {'★'.repeat(getTeamStars(homeTeam.r))} · {homeForm.shortLabel}
                </span>
              </div>
            </button>

            {/* Slot 2: Away / Player 2 */}
            <button
              type="button"
              onClick={() => setActiveSlot('away')}
              className={`p-2.5 rounded-xl border text-left transition-all flex items-center gap-2.5 min-h-[58px] ${
                activeSlot === 'away'
                  ? 'bg-amber-950/60 border-amber-500 ring-2 ring-amber-500/40'
                  : 'bg-stone-900/90 border-stone-800 hover:border-stone-700'
              }`}
            >
              <TeamFlag flag={awayTeam.f} className="w-8 h-5.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <span className="text-[11px] text-amber-400 font-bold block truncate">
                  {STRINGS.modes.selectAwayTeam}
                </span>
                <span className="text-sm font-black text-white block truncate">{awayTeam.n}</span>
                <span className="text-[11px] text-amber-400 block truncate">
                  {'★'.repeat(getTeamStars(awayTeam.r))} · {awayForm.shortLabel}
                </span>
              </div>
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 mt-2.5">
            <button
              type="button"
              onClick={handleSwap}
              className="flex-1 min-h-[44px] py-1.5 px-3 rounded-xl bg-stone-900 hover:bg-stone-800 border border-stone-800 text-xs font-bold text-stone-300 flex items-center justify-center gap-1.5 transition-colors"
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-emerald-400" />
              {STRINGS.modes.swapTeams}
            </button>
            <button
              type="button"
              onClick={handleRandomize}
              className="flex-1 min-h-[44px] py-1.5 px-3 rounded-xl bg-stone-900 hover:bg-stone-800 border border-stone-800 text-xs font-bold text-stone-300 flex items-center justify-center gap-1.5 transition-colors"
            >
              <Shuffle className="w-3.5 h-3.5 text-amber-400" />
              {STRINGS.modes.randomTeams}
            </button>
          </div>
        </div>

        {/* Team Picker Grid */}
        <div className="text-xs font-bold text-stone-400 mb-2 px-1 shrink-0">
          {activeSlot === 'home' ? STRINGS.modes.selectHomeTeam : STRINGS.modes.selectAwayTeam} Seçin:
        </div>

        <div className="flex-1 overflow-y-auto scrollable-view grid grid-cols-2 sm:grid-cols-4 gap-2 pr-1 mb-4">
          {TEAMS_DATA.map((t) => {
            const isSelected =
              (activeSlot === 'home' && t.id === homeTeamId) ||
              (activeSlot === 'away' && t.id === awayTeamId);
            const stars = getTeamStars(t.r);

            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  if (activeSlot === 'home') {
                    setHomeTeamId(t.id);
                    setActiveSlot('away');
                  } else {
                    setAwayTeamId(t.id);
                  }
                }}
                className={`min-h-[50px] p-2 rounded-xl border text-left transition-all flex items-center gap-2 ${
                  isSelected
                    ? 'bg-emerald-950/70 border-emerald-500 font-bold'
                    : 'bg-stone-950/70 border-stone-800 hover:border-stone-600'
                }`}
              >
                <TeamFlag flag={t.f} className="w-6 h-4.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-bold text-white truncate block">{t.n}</span>
                  <span className="text-[11px] text-amber-400 block">
                    {'★'.repeat(stars)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Start CTA */}
        <button
          type="button"
          onClick={() => onStartMatch(homeTeamId, awayTeamId, isTwoPlayer)}
          className="w-full min-h-[48px] py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 font-black text-base text-white shadow-lg shadow-emerald-950/60 transition-all flex items-center justify-center gap-2 shrink-0"
        >
          <Play className="w-5 h-5 fill-current" />
          {STRINGS.modes.startMatchBtn}
        </button>
      </div>
    </div>
  );
};
