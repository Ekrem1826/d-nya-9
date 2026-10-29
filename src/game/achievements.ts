/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { STRINGS } from '../strings.ts';

export type AchievementId =
  | 'first_win'
  | 'score_5_goals'
  | 'turkey_champion'
  | 'clean_sheet_champion'
  | 'undefeated_group'
  | 'third_place_medal';

export type BestStageRank =
  | 0 // Henüz Yok
  | 1 // Grup Aşaması
  | 2 // Son 16
  | 3 // Çeyrek Final
  | 4 // Dünya Dördüncüsü
  | 5 // Dünya Üçüncüsü
  | 6 // Dünya İkincisi
  | 7; // Dünya Şampiyonu

export interface CareerHistoryState {
  unlockedIds: AchievementId[];
  totalChampionships: number;
  bestStageRank: BestStageRank;
  totalMatchesPlayed: number;
  totalWins: number;
  totalGoalsScored: number;
}

const ACHIEVEMENTS_STORAGE_KEY = 'worldcup_fiske_achievements';

const DEFAULT_CAREER_STATE: CareerHistoryState = {
  unlockedIds: [],
  totalChampionships: 0,
  bestStageRank: 0,
  totalMatchesPlayed: 0,
  totalWins: 0,
  totalGoalsScored: 0,
};

export function getBestResultLabel(rank: BestStageRank): string {
  switch (rank) {
    case 7:
      return STRINGS.achievements.bestResults.champion;
    case 6:
      return STRINGS.achievements.bestResults.runnerUp;
    case 5:
      return STRINGS.achievements.bestResults.third;
    case 4:
      return STRINGS.achievements.bestResults.fourth;
    case 3:
      return STRINGS.achievements.bestResults.qf;
    case 2:
      return STRINGS.achievements.bestResults.r16;
    case 1:
      return STRINGS.achievements.bestResults.group;
    default:
      return STRINGS.achievements.bestResults.none;
  }
}

export function loadCareerHistory(): CareerHistoryState {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_CAREER_STATE };
    const raw = localStorage.getItem(ACHIEVEMENTS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CAREER_STATE };
    const parsed = JSON.parse(raw);
    return {
      unlockedIds: Array.isArray(parsed.unlockedIds) ? parsed.unlockedIds : [],
      totalChampionships: Number(parsed.totalChampionships) || 0,
      bestStageRank: (Number(parsed.bestStageRank) || 0) as BestStageRank,
      totalMatchesPlayed: Number(parsed.totalMatchesPlayed) || 0,
      totalWins: Number(parsed.totalWins) || 0,
      totalGoalsScored: Number(parsed.totalGoalsScored) || 0,
    };
  } catch {
    return { ...DEFAULT_CAREER_STATE };
  }
}

export function saveCareerHistory(state: CareerHistoryState): CareerHistoryState {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ACHIEVEMENTS_STORAGE_KEY, JSON.stringify(state));
    }
  } catch {}
  return state;
}

/**
 * Evaluate and update achievements after a single match or tournament finish
 */
export function evaluateMatchAchievements(
  current: CareerHistoryState,
  params: {
    won: boolean;
    goalsScored: number;
    goalsConceded: number;
    userTeamId: number;
    tournamentGoalsScored?: number;
    tournamentGoalsConceded?: number;
    isChampion?: boolean;
    isThirdPlaceWinner?: boolean;
    undefeatedGroupComplete?: boolean;
    stageRankReached?: BestStageRank;
  }
): CareerHistoryState {
  const unlockedSet = new Set<AchievementId>(current.unlockedIds);

  if (params.won) {
    unlockedSet.add('first_win');
  }

  if (params.goalsScored >= 5 || (params.tournamentGoalsScored ?? 0) >= 5) {
    unlockedSet.add('score_5_goals');
  }

  if (params.undefeatedGroupComplete) {
    unlockedSet.add('undefeated_group');
  }

  if (params.isThirdPlaceWinner) {
    unlockedSet.add('third_place_medal');
  }

  if (params.isChampion) {
    if (params.userTeamId === 16) {
      // Türkiye (id: 16)
      unlockedSet.add('turkey_champion');
    }
    if ((params.tournamentGoalsConceded ?? 0) === 0) {
      unlockedSet.add('clean_sheet_champion');
    }
  }

  const nextBestRank = Math.max(
    current.bestStageRank,
    params.stageRankReached ?? 0,
    params.isChampion ? 7 : 0,
    params.isThirdPlaceWinner ? 5 : 0
  ) as BestStageRank;

  const updated: CareerHistoryState = {
    unlockedIds: Array.from(unlockedSet),
    totalChampionships: current.totalChampionships + (params.isChampion ? 1 : 0),
    bestStageRank: nextBestRank,
    totalMatchesPlayed: current.totalMatchesPlayed + 1,
    totalWins: current.totalWins + (params.won ? 1 : 0),
    totalGoalsScored: current.totalGoalsScored + Math.max(0, params.goalsScored),
  };

  return saveCareerHistory(updated);
}
