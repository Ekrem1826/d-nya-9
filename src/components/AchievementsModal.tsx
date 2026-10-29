/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  AchievementId,
  CareerHistoryState,
  getBestResultLabel,
} from '../game/achievements.ts';
import { STRINGS } from '../strings.ts';
import { X, Trophy, Medal, Star, ShieldCheck, Flame, Award, Lock } from 'lucide-react';

interface AchievementsModalProps {
  isOpen: boolean;
  onClose: () => void;
  career: CareerHistoryState;
}

const ACHIEVEMENT_ITEMS: Array<{
  id: AchievementId;
  icon: string;
  title: string;
  desc: string;
}> = [
  {
    id: 'clean_sheet_champion',
    icon: '🛡️',
    title: STRINGS.achievements.list.clean_sheet_champion.title,
    desc: STRINGS.achievements.list.clean_sheet_champion.desc,
  },
  {
    id: 'turkey_champion',
    icon: '🇹🇷',
    title: STRINGS.achievements.list.turkey_champion.title,
    desc: STRINGS.achievements.list.turkey_champion.desc,
  },
  {
    id: 'first_win',
    icon: '⚡',
    title: STRINGS.achievements.list.first_win.title,
    desc: STRINGS.achievements.list.first_win.desc,
  },
  {
    id: 'score_5_goals',
    icon: '⚽',
    title: STRINGS.achievements.list.score_5_goals.title,
    desc: STRINGS.achievements.list.score_5_goals.desc,
  },
  {
    id: 'undefeated_group',
    icon: '👑',
    title: STRINGS.achievements.list.undefeated_group.title,
    desc: STRINGS.achievements.list.undefeated_group.desc,
  },
  {
    id: 'third_place_medal',
    icon: '🥉',
    title: STRINGS.achievements.list.third_place_medal.title,
    desc: STRINGS.achievements.list.third_place_medal.desc,
  },
];

export const AchievementsModal: React.FC<AchievementsModalProps> = ({
  isOpen,
  onClose,
  career,
}) => {
  if (!isOpen) return null;

  const bestLabel = getBestResultLabel(career.bestStageRank);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="achievements-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 select-none"
    >
      <div className="w-full max-w-lg max-h-[92vh] bg-stone-900 border-2 border-stone-700 rounded-3xl p-5 shadow-2xl text-stone-100 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-stone-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-950/80 border border-amber-700/60 flex items-center justify-center text-amber-400">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <h2 id="achievements-modal-title" className="text-lg font-black text-white">
                {STRINGS.achievements.modalTitle}
              </h2>
              <p className="text-[11px] text-stone-400">{STRINGS.achievements.modalSubtitle}</p>
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

        {/* Career Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 shrink-0">
          <div className="bg-stone-950/90 p-3 rounded-2xl border border-amber-800/50 text-center">
            <Trophy className="w-4 h-4 text-amber-400 mx-auto mb-1" />
            <span className="text-lg font-black text-amber-400 block font-mono">
              {career.totalChampionships}
            </span>
            <span className="text-[11px] text-stone-400 block">
              {STRINGS.achievements.totalChampionships}
            </span>
          </div>

          <div className="bg-stone-950/90 p-3 rounded-2xl border border-emerald-800/50 text-center">
            <Medal className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
            <span className="text-xs font-black text-emerald-300 block truncate mt-1">
              {bestLabel}
            </span>
            <span className="text-[11px] text-stone-400 block mt-0.5">
              {STRINGS.achievements.bestResult}
            </span>
          </div>

          <div className="bg-stone-950/90 p-3 rounded-2xl border border-stone-800 text-center">
            <ShieldCheck className="w-4 h-4 text-cyan-400 mx-auto mb-1" />
            <span className="text-lg font-black text-cyan-400 block font-mono">
              {career.totalWins}
            </span>
            <span className="text-[11px] text-stone-400 block">
              {STRINGS.achievements.totalWins}
            </span>
          </div>

          <div className="bg-stone-950/90 p-3 rounded-2xl border border-stone-800 text-center">
            <Flame className="w-4 h-4 text-rose-400 mx-auto mb-1" />
            <span className="text-lg font-black text-rose-400 block font-mono">
              {career.totalGoalsScored}
            </span>
            <span className="text-[11px] text-stone-400 block">
              {STRINGS.achievements.totalGoals}
            </span>
          </div>
        </div>

        {/* Badges List */}
        <div className="flex items-center justify-between mb-2 px-1 shrink-0">
          <h3 className="text-xs font-bold text-stone-400 uppercase tracking-wider flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-amber-400" />
            {STRINGS.achievements.badgesHeading} ({career.unlockedIds.length} / {ACHIEVEMENT_ITEMS.length})
          </h3>
        </div>

        <div className="flex-1 overflow-y-auto scrollable-view space-y-2 pr-1 mb-4">
          {ACHIEVEMENT_ITEMS.map((item) => {
            const isUnlocked = career.unlockedIds.includes(item.id);
            return (
              <div
                key={item.id}
                className={`p-3 rounded-2xl border flex items-center justify-between gap-3 transition-all ${
                  isUnlocked
                    ? 'bg-emerald-950/40 border-emerald-700/70'
                    : 'bg-stone-950/60 border-stone-800/80 opacity-75'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 border ${
                      isUnlocked
                        ? 'bg-emerald-900/60 border-emerald-500/70 shadow-md shadow-emerald-950/50'
                        : 'bg-stone-900 border-stone-800 grayscale'
                    }`}
                  >
                    {item.icon}
                  </div>
                  <div className="min-w-0">
                    <span
                      className={`text-xs font-black block ${
                        isUnlocked ? 'text-white' : 'text-stone-300'
                      }`}
                    >
                      {item.title}
                    </span>
                    <span className="text-[11px] text-stone-400 block leading-snug">
                      {item.desc}
                    </span>
                  </div>
                </div>

                <span
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold shrink-0 flex items-center gap-1 border ${
                    isUnlocked
                      ? 'bg-emerald-600/20 text-emerald-300 border-emerald-600/50'
                      : 'bg-stone-900 text-stone-500 border-stone-800'
                  }`}
                >
                  {!isUnlocked && <Lock className="w-3 h-3" />}
                  {isUnlocked ? STRINGS.achievements.unlocked : STRINGS.achievements.locked}
                </span>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <button
          type="button"
          onClick={onClose}
          className="w-full min-h-[44px] py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-black text-xs text-white transition-colors shrink-0"
        >
          {STRINGS.settings.close}
        </button>
      </div>
    </div>
  );
};
