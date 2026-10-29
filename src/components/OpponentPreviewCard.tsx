/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Team, TacticalFormation } from '../game/constants.ts';
import { STRINGS } from '../strings.ts';
import { ShieldAlert, Layers, Star } from 'lucide-react';

interface OpponentPreviewCardProps {
  opponentTeam: Team;
  opponentFormation: TacticalFormation;
}

export const OpponentPreviewCard: React.FC<OpponentPreviewCardProps> = ({
  opponentTeam,
  opponentFormation,
}) => {
  const stars = Math.max(1, Math.min(5, Math.round((opponentTeam.r - 62) / 7)));
  const emptyStars = 5 - stars;

  return (
    <div className="bg-stone-950/80 rounded-xl p-3 border border-stone-800/90 mb-3">
      <div className="flex items-center justify-between text-[11px] text-stone-400 font-bold uppercase tracking-wider mb-2 pb-1.5 border-b border-stone-800/70">
        <span className="flex items-center gap-1.5 text-amber-400">
          <ShieldAlert className="w-3.5 h-3.5" />
          {STRINGS.tournamentHub.opponentPreviewTitle}: {opponentTeam.n}
        </span>
        <span className="font-mono text-stone-300">
          {STRINGS.tournamentHub.teamPowerLabel}: {opponentTeam.r}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 text-xs">
        <div className="bg-stone-900/90 p-2.5 rounded-xl border border-stone-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-stone-400 block">
              {STRINGS.tournamentHub.starRatingLabel}
            </span>
            <div className="flex items-center gap-1 mt-0.5" aria-label={`${stars} Yıldız`}>
              <span className="text-sm text-amber-400 tracking-tight font-bold">
                {'★'.repeat(stars)}
              </span>
              {emptyStars > 0 && (
                <span className="text-sm text-stone-700 tracking-tight font-bold">
                  {'★'.repeat(emptyStars)}
                </span>
              )}
              <span className="text-[11px] text-stone-300 font-mono ml-1">({stars}/5)</span>
            </div>
          </div>
          <Star className="w-4 h-4 text-amber-400 shrink-0" />
        </div>

        <div className="bg-stone-900/90 p-2.5 rounded-xl border border-stone-800 flex items-center justify-between">
          <div className="min-w-0">
            <span className="text-[11px] text-stone-400 block">
              {STRINGS.tournamentHub.formationLabel}
            </span>
            <span className="text-xs font-black text-emerald-400 block truncate mt-0.5">
              {opponentFormation.icon} {opponentFormation.name}
            </span>
          </div>
          <Layers className="w-4 h-4 text-emerald-400 shrink-0 ml-1" />
        </div>
      </div>
    </div>
  );
};
