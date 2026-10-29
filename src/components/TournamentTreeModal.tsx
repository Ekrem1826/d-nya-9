/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { TEAMS_DATA, ROUND_NAMES } from '../game/constants.ts';
import { TeamFlag } from './TeamFlag.tsx';
import { X, Trophy } from 'lucide-react';

export interface KnockoutMatchRecord {
  teamAId: number;
  teamBId: number;
  scoreA?: number;
  scoreB?: number;
  winnerId?: number;
}

interface TournamentTreeModalProps {
  isOpen: boolean;
  onClose: () => void;
  bracketHistory: KnockoutMatchRecord[][];
  activeRound: KnockoutMatchRecord[] | null;
  userTeamId: number;
  thirdPlaceMatch?: KnockoutMatchRecord | null;
}

export const TournamentTreeModal: React.FC<TournamentTreeModalProps> = ({
  isOpen,
  onClose,
  bracketHistory,
  activeRound,
  userTeamId,
  thirdPlaceMatch,
}) => {
  if (!isOpen) return null;

  // We have 4 rounds: Son 16 (8 matches), Çeyrek Final (4), Yarı Final (2), Final (1)
  const rounds = [8, 4, 2, 1];

  const getRoundMatches = (matchCount: number): KnockoutMatchRecord[] => {
    // Check in bracket history
    for (const h of bracketHistory) {
      if (h.length === matchCount) return h;
    }
    // Check if it's the current active round
    if (activeRound && activeRound.length === matchCount) {
      return activeRound;
    }
    // Placeholder matches
    return Array.from({ length: matchCount }, () => ({
      teamAId: -1,
      teamBId: -1,
    }));
  };

  // Resolve Third-Place Match (from prop, or derived from Semi-Final losers if available)
  const resolvedThirdPlaceMatch: KnockoutMatchRecord = (() => {
    if (thirdPlaceMatch) return thirdPlaceMatch;
    const semiMatches = getRoundMatches(2);
    if (
      semiMatches.length === 2 &&
      semiMatches[0].winnerId !== undefined &&
      semiMatches[1].winnerId !== undefined
    ) {
      const loserA =
        semiMatches[0].winnerId === semiMatches[0].teamAId
          ? semiMatches[0].teamBId
          : semiMatches[0].teamAId;
      const loserB =
        semiMatches[1].winnerId === semiMatches[1].teamAId
          ? semiMatches[1].teamBId
          : semiMatches[1].teamAId;
      return { teamAId: loserA, teamBId: loserB };
    }
    return { teamAId: -1, teamBId: -1 };
  })();

  const renderMatchCard = (m: KnockoutMatchRecord, key: string | number, badgeLabel?: string) => {
    const tA = m.teamAId >= 0 ? TEAMS_DATA[m.teamAId] : null;
    const tB = m.teamBId >= 0 ? TEAMS_DATA[m.teamBId] : null;
    const isUserMatch = m.teamAId === userTeamId || m.teamBId === userTeamId;
    const hasPlayed = m.scoreA !== undefined && m.scoreB !== undefined;

    return (
      <div
        key={key}
        className={`rounded-xl p-2.5 border transition-all text-xs ${
          isUserMatch
            ? 'bg-emerald-950/60 border-emerald-500 shadow-lg shadow-emerald-950/50'
            : 'bg-stone-950/60 border-stone-800/90'
        }`}
      >
        {badgeLabel && (
          <div className="text-[11px] font-black text-amber-400 uppercase tracking-wider mb-1.5 pb-1 border-b border-stone-800/80 text-center">
            {badgeLabel}
          </div>
        )}
        {/* Team A */}
        <div
          className={`flex items-center justify-between py-1 px-1.5 rounded-lg ${
            m.winnerId === m.teamAId && m.teamAId >= 0
              ? 'bg-stone-800/80 font-bold text-white'
              : 'text-stone-300'
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {tA ? <TeamFlag flag={tA.f} className="w-5 h-3.5" /> : <span className="text-sm">❔</span>}
            <span className="truncate font-medium">{tA ? tA.n : 'Belirlenmedi'}</span>
          </div>
          <span className="font-mono font-bold ml-2">{hasPlayed ? m.scoreA : '–'}</span>
        </div>

        {/* Divider */}
        <div className="border-t border-stone-800/60 my-1" />

        {/* Team B */}
        <div
          className={`flex items-center justify-between py-1 px-1.5 rounded-lg ${
            m.winnerId === m.teamBId && m.teamBId >= 0
              ? 'bg-stone-800/80 font-bold text-white'
              : 'text-stone-300'
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {tB ? <TeamFlag flag={tB.f} className="w-5 h-3.5" /> : <span className="text-sm">❔</span>}
            <span className="truncate font-medium">{tB ? tB.n : 'Belirlenmedi'}</span>
          </div>
          <span className="font-mono font-bold ml-2">{hasPlayed ? m.scoreB : '–'}</span>
        </div>
      </div>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tree-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-xs select-none"
    >
      <div className="relative w-full max-w-5xl max-h-[94vh] bg-stone-900 border-2 border-stone-700 text-stone-100 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-800 bg-stone-950/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-950/60 border border-amber-600/50 flex items-center justify-center text-amber-400">
              <Trophy className="w-5 h-5" />
            </div>
            <div>
              <h2 id="tree-modal-title" className="text-xl font-black tracking-tight text-white flex items-center gap-2">
                🏆 Dünya Kupası Eleme Ağacı (Son 16'dan Finale)
              </h2>
              <p className="text-xs text-stone-400">
                Şampiyonluğa giden yol: Son 16, Çeyrek Final, Yarı Final, Üçüncülük Maçı ve Büyük Final
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Kapat"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tree Bracket Columns */}
        <div className="overflow-x-auto p-4 sm:p-6 flex-1 scrollable-view">
          <div className="flex gap-4 sm:gap-6 min-w-[760px] justify-between pb-2">
            {rounds.map((roundSize) => {
              const matches = getRoundMatches(roundSize);
              const roundTitle = ROUND_NAMES[roundSize];

              return (
                <div key={roundSize} className="flex-1 flex flex-col">
                  {/* Round Header */}
                  <div className="text-center py-2 px-3 mb-3 rounded-xl bg-stone-950 border border-stone-800">
                    <span className="text-xs font-black text-amber-400 uppercase tracking-wider block">
                      {roundSize === 1 ? 'Final & Üçüncülük' : roundTitle}
                    </span>
                    <span className="text-[11px] text-stone-400">
                      {roundSize === 1 ? 'Kupa & Bronz Maçı' : `${roundSize} Eşleşme`}
                    </span>
                  </div>

                  {/* Matches Column */}
                  <div className="flex flex-col justify-around flex-1 gap-2.5">
                    {matches.map((m, mIdx) =>
                      renderMatchCard(
                        m,
                        mIdx,
                        roundSize === 1 ? '🏆 Büyük Final' : undefined
                      )
                    )}
                    {roundSize === 1 &&
                      renderMatchCard(resolvedThirdPlaceMatch, 'third-place', '🥉 Üçüncülük Maçı')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-stone-800 bg-stone-950/80 flex items-center justify-between text-xs text-stone-400">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            <span>Yeşil çerçeveli maçlar: Senin takımının maçları</span>
          </div>
          <button
            onClick={onClose}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-bold text-white transition-colors"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
