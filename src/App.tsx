/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Team,
  TEAMS_DATA,
  DIFFICULTY_NAMES,
  ROUND_NAMES,
  FORMATIONS,
} from './game/constants.ts';
import { PitchCanvas } from './components/PitchCanvas.tsx';
import { TacticsModal } from './components/TacticsModal.tsx';
import { FormationSelector } from './components/FormationSelector.tsx';
import { TournamentTreeModal, KnockoutMatchRecord } from './components/TournamentTreeModal.tsx';
import { TeamFlag } from './components/TeamFlag.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { AchievementsModal } from './components/AchievementsModal.tsx';
import { QuickMatchModal } from './components/QuickMatchModal.tsx';
import { OpponentPreviewCard } from './components/OpponentPreviewCard.tsx';
import {
  CareerHistoryState,
  BestStageRank,
  loadCareerHistory,
  evaluateMatchAchievements,
} from './game/achievements.ts';
import { STRINGS } from './strings.ts';
import {
  Trophy,
  Shield,
  Layers,
  GitBranch,
  Play,
  RefreshCw,
  BarChart3,
  Sparkles,
  Info,
  AlertTriangle,
  Settings,
  Award,
  Zap,
  Users,
} from 'lucide-react';

interface MatchRecord {
  opponentId: number;
  scoreA: number;
  scoreB: number;
  penalties?: [number, number];
  won: boolean;
}

interface TournamentResult {
  title: string;
  description: string;
  isChampion: boolean;
}

interface TournamentState {
  userTeamId: number;
  userFormationId: string;
  groups: number[][]; // 8 groups of 4 teams
  table: Array<{ p: number; w: number; d: number; l: number; gf: number; ga: number }>;
  matchDay: number; // 0, 1, 2
  userGroupIndex: number;
  knockoutRound: KnockoutMatchRecord[] | null; // active round matches
  bracketHistory: KnockoutMatchRecord[][];
  thirdPlaceMatch?: KnockoutMatchRecord | null;
  isPlayingThirdPlace?: boolean;
  matchLog: MatchRecord[];
  result?: TournamentResult;
}

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDanger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Evet',
  cancelLabel = 'Vazgeç',
  isDanger = true,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs select-none"
    >
      <div className="w-full max-w-sm bg-stone-900 border-2 border-stone-700 rounded-2xl p-5 shadow-2xl text-stone-100">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-rose-950/80 border border-rose-700/60 flex items-center justify-center text-rose-400 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h3 id="confirm-dialog-title" className="text-base font-black text-white">
            {title}
          </h3>
        </div>
        <p className="text-xs text-stone-300 leading-relaxed mb-5">
          {message}
        </p>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 min-h-[44px] py-2.5 px-4 rounded-xl bg-stone-800 hover:bg-stone-700 border border-stone-700 font-bold text-xs text-stone-200 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 min-h-[44px] py-2.5 px-4 rounded-xl font-black text-xs text-white transition-colors ${
              isDanger
                ? 'bg-rose-600 hover:bg-rose-500 shadow-lg shadow-rose-950/60'
                : 'bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-950/60'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

const GROUP_SCHEDULE = [
  [[0, 1], [2, 3]],
  [[0, 2], [3, 1]],
  [[3, 0], [1, 2]],
];

/**
 * Unbiased Fisher-Yates shuffle
 */
function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Weighted random tie-breaker based on team rating (TEAMS_DATA[].r)
 */
function pickWinnerByStrength(teamAId: number, teamBId: number): number {
  const rA = Math.max(1, TEAMS_DATA[teamAId]?.r ?? 75);
  const rB = Math.max(1, TEAMS_DATA[teamBId]?.r ?? 75);
  // Amplify rating difference slightly with power of 3 so stronger teams have a realistic edge
  const weightA = Math.pow(rA, 3);
  const weightB = Math.pow(rB, 3);
  return Math.random() * (weightA + weightB) < weightA ? teamAId : teamBId;
}

/**
 * Deterministic group standing comparator:
 * 1. Points (p)
 * 2. Goal difference (gf - ga)
 * 3. Goals scored (gf)
 * 4. Team strength rating (TEAMS_DATA[].r)
 * 5. Team ID (ascending)
 */
function compareGroupTeams(
  a: number,
  b: number,
  table: Array<{ p: number; w: number; d: number; l: number; gf: number; ga: number }>
): number {
  const tA = table[a];
  const tB = table[b];
  const diffA = tA.gf - tA.ga;
  const diffB = tB.gf - tB.ga;
  return (
    tB.p - tA.p ||
    diffB - diffA ||
    tB.gf - tA.gf ||
    TEAMS_DATA[b].r - TEAMS_DATA[a].r ||
    a - b
  );
}

export default function App() {
  const [difficulty, setDifficulty] = useState<number>(1); // 0: Kolay, 1: Normal, 2: Zor
  const [tournament, setTournament] = useState<TournamentState | null>(null);
  const [career, setCareer] = useState<CareerHistoryState>(() => loadCareerHistory());
  const [currentMatch, setCurrentMatch] = useState<{
    teamA: Team;
    teamB: Team;
    isKnockout: boolean;
    roundLabel: string;
    isTwoPlayer?: boolean;
    isQuickMatch?: boolean;
  } | null>(null);
  const [quickMatchSummary, setQuickMatchSummary] = useState<{
    teamA: Team;
    teamB: Team;
    scoreA: number;
    scoreB: number;
    penalties?: [number, number];
    isTwoPlayer: boolean;
  } | null>(null);

  // Modals
  const [showTacticsModal, setShowTacticsModal] = useState<boolean>(false);
  const [showFormationModal, setShowFormationModal] = useState<boolean>(false);
  const [showTreeModal, setShowTreeModal] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [showAchievementsModal, setShowAchievementsModal] = useState<boolean>(false);
  const [quickMatchModalMode, setQuickMatchModalMode] = useState<'quick' | 'twoPlayer' | null>(null);
  const [showResetConfirmModal, setShowResetConfirmModal] = useState<boolean>(false);
  const [showForfeitConfirmModal, setShowForfeitConfirmModal] = useState<boolean>(false);

  // Load saved tournament or handle autostart
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const autostart = urlParams.get('autostart');

    if (autostart === '1') {
      startNewTournament(16); // Türkiye
      return;
    }

    try {
      const saved = localStorage.getItem('worldcup_fiske_save');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.tournament) {
          setTournament(parsed.tournament);
          setDifficulty(parsed.difficulty ?? 1);
        }
      }
    } catch {}
  }, []);

  // Save tournament state on change
  useEffect(() => {
    if (tournament) {
      try {
        localStorage.setItem(
          'worldcup_fiske_save',
          JSON.stringify({ tournament, difficulty })
        );
      } catch {}
    }
  }, [tournament, difficulty]);

  // Sync document body state for ultra-mode checks
  useEffect(() => {
    if (currentMatch) {
      document.body.dataset.state = 'playing';
    } else if (tournament?.result) {
      document.body.dataset.state = 'gameover';
    } else {
      document.body.dataset.state = 'title';
    }
  }, [currentMatch, tournament?.result]);

  const getTeamStars = (rating: number): number => {
    return Math.max(1, Math.min(5, Math.round((rating - 62) / 7)));
  };

  // Start new tournament with chosen team
  const startNewTournament = (userTeamId: number) => {
    const sortedIndices = TEAMS_DATA.map((_, i) => i).sort(
      (a, b) => TEAMS_DATA[b].r - TEAMS_DATA[a].r || a - b
    );

    const groups: number[][] = Array.from({ length: 8 }, () => []);
    for (let pot = 0; pot < 4; pot++) {
      const potTeams = shuffleArray(sortedIndices.slice(pot * 8, pot * 8 + 8));
      potTeams.forEach((teamId, gIdx) => groups[gIdx].push(teamId));
    }

    const userGroupIndex = groups.findIndex((g) => g.includes(userTeamId));
    const initialTable = TEAMS_DATA.map(() => ({
      p: 0,
      w: 0,
      d: 0,
      l: 0,
      gf: 0,
      ga: 0,
    }));

    const userTeam = TEAMS_DATA[userTeamId];

    const newTournamentState: TournamentState = {
      userTeamId,
      userFormationId: userTeam.preferredFormationId || 'classic',
      groups,
      table: initialTable,
      matchDay: 0,
      userGroupIndex,
      knockoutRound: null,
      bracketHistory: [],
      thirdPlaceMatch: null,
      isPlayingThirdPlace: false,
      matchLog: [],
    };

    setTournament(newTournamentState);
  };

  // Simulate non-player matches
  const simulateBotMatch = (teamAId: number, teamBId: number): [number, number] => {
    const diff = TEAMS_DATA[teamAId].r - TEAMS_DATA[teamBId].r;
    const lambdaA = Math.max(0.2, 1.35 * Math.pow(1.045, diff));
    const lambdaB = Math.max(0.2, 1.35 * Math.pow(1.045, -diff));

    const poisson = (mean: number) => {
      const L = Math.exp(-mean);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= Math.random();
      } while (p > L && k < 8);
      return k - 1;
    };

    return [poisson(lambdaA), poisson(lambdaB)];
  };

  const applyMatchResultToTable = (
    tableCopy: Array<{ p: number; w: number; d: number; l: number; gf: number; ga: number }>,
    teamAId: number,
    teamBId: number,
    scoreA: number,
    scoreB: number
  ) => {
    const rowA = tableCopy[teamAId];
    const rowB = tableCopy[teamBId];

    rowA.gf += scoreA;
    rowA.ga += scoreB;
    rowB.gf += scoreB;
    rowB.ga += scoreA;

    if (scoreA > scoreB) {
      rowA.w += 1;
      rowA.p += 3;
      rowB.l += 1;
    } else if (scoreA < scoreB) {
      rowB.w += 1;
      rowB.p += 3;
      rowA.l += 1;
    } else {
      rowA.d += 1;
      rowA.p += 1;
      rowB.d += 1;
      rowB.p += 1;
    }
  };

  const getNextMatchInfo = (): { opponentId: number; label: string } | null => {
    if (!tournament || tournament.result) return null;
    const me = tournament.userTeamId;

    if (!tournament.knockoutRound) {
      const scheduleForDay = GROUP_SCHEDULE[tournament.matchDay];
      if (!scheduleForDay) return null;
      const myGroup = tournament.groups[tournament.userGroupIndex];
      const matchPair = scheduleForDay
        .map(([i, j]) => [myGroup[i], myGroup[j]])
        .find((p) => p.includes(me));

      if (!matchPair) return null;
      const opponentId = matchPair[0] === me ? matchPair[1] : matchPair[0];
      const groupLetter = 'ABCDEFGH'[tournament.userGroupIndex];
      return {
        opponentId,
        label: `Grup ${groupLetter} · ${tournament.matchDay + 1}. Maç`,
      };
    } else {
      const myMatch = tournament.knockoutRound.find(
        (m) => m.teamAId === me || m.teamBId === me
      );
      if (!myMatch) return null;
      const opponentId = myMatch.teamAId === me ? myMatch.teamBId : myMatch.teamAId;
      const roundTitle = tournament.isPlayingThirdPlace
        ? STRINGS.tournamentHub.thirdPlaceRoundName
        : ROUND_NAMES[tournament.knockoutRound.length] || 'Eleme Turu';
      return {
        opponentId,
        label: roundTitle,
      };
    }
  };

  const handleStartMatch = () => {
    const nextFixture = getNextMatchInfo();
    if (!tournament || tournament.result || !nextFixture) return;

    setCurrentMatch({
      teamA: TEAMS_DATA[tournament.userTeamId],
      teamB: TEAMS_DATA[nextFixture.opponentId],
      isKnockout: !!tournament.knockoutRound,
      roundLabel: nextFixture.label,
      isTwoPlayer: false,
      isQuickMatch: false,
    });
  };

  const handleStartQuickOrTwoPlayerMatch = (
    homeTeamId: number,
    awayTeamId: number,
    isTwoPlayer: boolean
  ) => {
    setQuickMatchModalMode(null);
    setQuickMatchSummary(null);
    setCurrentMatch({
      teamA: TEAMS_DATA[homeTeamId],
      teamB: TEAMS_DATA[awayTeamId],
      isKnockout: true,
      roundLabel: isTwoPlayer ? STRINGS.modes.twoPlayer : STRINGS.modes.quickMatch,
      isTwoPlayer,
      isQuickMatch: true,
    });
  };

  const simulateKnockoutPairing = (teamAId: number, teamBId: number): KnockoutMatchRecord => {
    const [sA, sB] = simulateBotMatch(teamAId, teamBId);
    const wId =
      sA > sB
        ? teamAId
        : sB > sA
        ? teamBId
        : pickWinnerByStrength(teamAId, teamBId);
    return {
      teamAId,
      teamBId,
      scoreA: sA,
      scoreB: sB,
      winnerId: wId,
    };
  };

  const handleMatchFinish = (result: {
    scoreA: number;
    scoreB: number;
    penalties?: [number, number];
  }) => {
    if (!currentMatch) return;

    // Handle Quick Match / 2-Player Match finish outside tournament
    if (currentMatch.isQuickMatch || !tournament) {
      const won =
        result.scoreA > result.scoreB ||
        (result.scoreA === result.scoreB &&
          result.penalties !== undefined &&
          result.penalties[0] > result.penalties[1]);
      setCareer((prev) =>
        evaluateMatchAchievements(prev, {
          won,
          goalsScored: result.scoreA,
          goalsConceded: result.scoreB,
          userTeamId: currentMatch.teamA.id,
        })
      );
      setQuickMatchSummary({
        teamA: currentMatch.teamA,
        teamB: currentMatch.teamB,
        scoreA: result.scoreA,
        scoreB: result.scoreB,
        penalties: result.penalties,
        isTwoPlayer: Boolean(currentMatch.isTwoPlayer),
      });
      setCurrentMatch(null);
      return;
    }

    const me = tournament.userTeamId;
    const op = currentMatch.teamB.id;

    let isWon = false;
    if (result.scoreA > result.scoreB) {
      isWon = true;
    } else if (result.scoreA < result.scoreB) {
      isWon = false;
    } else if (result.penalties) {
      if (result.penalties[0] !== result.penalties[1]) {
        isWon = result.penalties[0] > result.penalties[1];
      } else {
        isWon = pickWinnerByStrength(me, op) === me;
      }
    } else if (tournament.knockoutRound) {
      // Knockout tie without penalties: weighted random selection based on team rating
      isWon = pickWinnerByStrength(me, op) === me;
    }

    const updatedLog: MatchRecord[] = [
      ...tournament.matchLog,
      {
        opponentId: op,
        scoreA: result.scoreA,
        scoreB: result.scoreB,
        penalties: result.penalties,
        won: isWon,
      },
    ];

    const totalGoalsScored = updatedLog.reduce((sum, m) => sum + m.scoreA, 0);
    const totalGoalsConceded = updatedLog.reduce((sum, m) => sum + m.scoreB, 0);

    if (!tournament.knockoutRound) {
      // Group Stage Match: clone table without mutating state directly
      const nextTable = structuredClone(tournament.table);
      applyMatchResultToTable(nextTable, me, op, result.scoreA, result.scoreB);

      tournament.groups.forEach((group, gIdx) => {
        GROUP_SCHEDULE[tournament.matchDay].forEach(([i, j]) => {
          const tA = group[i];
          const tB = group[j];
          if (gIdx === tournament.userGroupIndex && (tA === me || tB === me)) {
            return;
          }
          const [simScoreA, simScoreB] = simulateBotMatch(tA, tB);
          applyMatchResultToTable(nextTable, tA, tB, simScoreA, simScoreB);
        });
      });

      const nextDay = tournament.matchDay + 1;

      if (nextDay < 3) {
        setCareer((prev) =>
          evaluateMatchAchievements(prev, {
            won: isWon,
            goalsScored: result.scoreA,
            goalsConceded: result.scoreB,
            userTeamId: me,
            tournamentGoalsScored: totalGoalsScored,
            tournamentGoalsConceded: totalGoalsConceded,
            stageRankReached: 1,
          })
        );
        setTournament({
          ...tournament,
          table: nextTable,
          matchDay: nextDay,
          matchLog: updatedLog,
        });
        setCurrentMatch(null);
      } else {
        const myGroup = tournament.groups[tournament.userGroupIndex];
        const sortedMyGroup = [...myGroup].sort((a, b) => compareGroupTeams(a, b, nextTable));

        const qualifies = sortedMyGroup.slice(0, 2).includes(me);
        const undefeatedGroup = nextTable[me].l === 0 && sortedMyGroup[0] === me;

        if (!qualifies) {
          setCareer((prev) =>
            evaluateMatchAchievements(prev, {
              won: isWon,
              goalsScored: result.scoreA,
              goalsConceded: result.scoreB,
              userTeamId: me,
              tournamentGoalsScored: totalGoalsScored,
              tournamentGoalsConceded: totalGoalsConceded,
              stageRankReached: 1,
            })
          );
          setTournament({
            ...tournament,
            table: nextTable,
            matchDay: 3,
            matchLog: updatedLog,
            result: {
              title: STRINGS.endScreen.groupEliminatedTitle,
              description: `${TEAMS_DATA[me].n} grubu ilk 2 sırada tamamlayamadı ve turnuvaya veda etti.`,
              isChampion: false,
            },
          });
          setCurrentMatch(null);
        } else {
          // Generate Round of 16
          const allGroupRankings = tournament.groups.map((group) =>
            [...group].sort((a, b) => compareGroupTeams(a, b, nextTable))
          );

          const roundOf16Pairs = [
            [0, 1], [2, 3], [4, 5], [6, 7],
            [1, 0], [3, 2], [5, 4], [7, 6],
          ];

          const roundOf16Matches: KnockoutMatchRecord[] = roundOf16Pairs.map(([g1, g2]) => ({
            teamAId: allGroupRankings[g1][0],
            teamBId: allGroupRankings[g2][1],
          }));

          setCareer((prev) =>
            evaluateMatchAchievements(prev, {
              won: isWon,
              goalsScored: result.scoreA,
              goalsConceded: result.scoreB,
              userTeamId: me,
              tournamentGoalsScored: totalGoalsScored,
              tournamentGoalsConceded: totalGoalsConceded,
              undefeatedGroupComplete: undefeatedGroup,
              stageRankReached: 2,
            })
          );

          setTournament({
            ...tournament,
            table: nextTable,
            matchDay: 3,
            knockoutRound: roundOf16Matches,
            matchLog: updatedLog,
          });
          setCurrentMatch(null);
        }
      }
    } else if (tournament.isPlayingThirdPlace) {
      // User just played the Third-Place Match!
      const currentThird = tournament.knockoutRound[0];
      const isUserTeamA = currentThird.teamAId === me;
      const completedThirdPlace: KnockoutMatchRecord = {
        teamAId: currentThird.teamAId,
        teamBId: currentThird.teamBId,
        scoreA: isUserTeamA ? result.scoreA : result.scoreB,
        scoreB: isUserTeamA ? result.scoreB : result.scoreA,
        winnerId: isWon ? me : op,
      };

      setCareer((prev) =>
        evaluateMatchAchievements(prev, {
          won: isWon,
          goalsScored: result.scoreA,
          goalsConceded: result.scoreB,
          userTeamId: me,
          tournamentGoalsScored: totalGoalsScored,
          tournamentGoalsConceded: totalGoalsConceded,
          isThirdPlaceWinner: isWon,
          stageRankReached: isWon ? 5 : 4,
        })
      );

      setTournament({
        ...tournament,
        knockoutRound: null,
        isPlayingThirdPlace: false,
        thirdPlaceMatch: completedThirdPlace,
        matchLog: updatedLog,
        result: {
          title: isWon ? STRINGS.endScreen.thirdPlaceWonTitle : STRINGS.endScreen.fourthPlaceTitle,
          description: isWon
            ? STRINGS.endScreen.thirdPlaceWonDesc
            : STRINGS.endScreen.fourthPlaceDesc,
          isChampion: false,
        },
      });
      setCurrentMatch(null);
    } else {
      // Regular Knockout match handling (R16, QF, SF, Final)
      const currentRound = tournament.knockoutRound;
      const updatedRoundMatches: KnockoutMatchRecord[] = currentRound.map((m) => {
        if (m.teamAId === me || m.teamBId === me) {
          const isUserTeamA = m.teamAId === me;
          return {
            teamAId: m.teamAId,
            teamBId: m.teamBId,
            scoreA: isUserTeamA ? result.scoreA : result.scoreB,
            scoreB: isUserTeamA ? result.scoreB : result.scoreA,
            winnerId: isWon ? me : op,
          };
        } else {
          return simulateKnockoutPairing(m.teamAId, m.teamBId);
        }
      });

      const updatedHistory = [...tournament.bracketHistory, updatedRoundMatches];

      // Check Semi-Final (currentRound.length === 2) -> generate Final & Third-Place Match!
      if (currentRound.length === 2) {
        const semi0 = updatedRoundMatches[0];
        const semi1 = updatedRoundMatches[1];
        const winner0 = semi0.winnerId!;
        const winner1 = semi1.winnerId!;
        const loser0 = semi0.winnerId === semi0.teamAId ? semi0.teamBId : semi0.teamAId;
        const loser1 = semi1.winnerId === semi1.teamAId ? semi1.teamBId : semi1.teamAId;

        if (!isWon) {
          // User lost in Semi-Final -> User plays the Third-Place Match!
          // Also simulate the bot Final so the bracket tree is complete
          const simulatedFinal = simulateKnockoutPairing(winner0, winner1);
          const historyWithFinal = [...updatedHistory, [simulatedFinal]];
          const thirdPlaceFixture: KnockoutMatchRecord = {
            teamAId: loser0,
            teamBId: loser1,
          };

          setCareer((prev) =>
            evaluateMatchAchievements(prev, {
              won: false,
              goalsScored: result.scoreA,
              goalsConceded: result.scoreB,
              userTeamId: me,
              tournamentGoalsScored: totalGoalsScored,
              tournamentGoalsConceded: totalGoalsConceded,
              stageRankReached: 4,
            })
          );

          setTournament({
            ...tournament,
            knockoutRound: [thirdPlaceFixture],
            isPlayingThirdPlace: true,
            thirdPlaceMatch: thirdPlaceFixture,
            bracketHistory: historyWithFinal,
            matchLog: updatedLog,
          });
          setCurrentMatch(null);
          return;
        } else {
          // User won in Semi-Final -> User advances to Final, simulate bot Third-Place Match!
          const simulatedThirdPlace = simulateKnockoutPairing(loser0, loser1);
          const finalFixture: KnockoutMatchRecord = {
            teamAId: winner0,
            teamBId: winner1,
          };

          setCareer((prev) =>
            evaluateMatchAchievements(prev, {
              won: true,
              goalsScored: result.scoreA,
              goalsConceded: result.scoreB,
              userTeamId: me,
              tournamentGoalsScored: totalGoalsScored,
              tournamentGoalsConceded: totalGoalsConceded,
              stageRankReached: 6,
            })
          );

          setTournament({
            ...tournament,
            knockoutRound: [finalFixture],
            isPlayingThirdPlace: false,
            thirdPlaceMatch: simulatedThirdPlace,
            bracketHistory: updatedHistory,
            matchLog: updatedLog,
          });
          setCurrentMatch(null);
          return;
        }
      }

      if (!isWon) {
        const eliminatedRank: BestStageRank =
          currentRound.length === 1 ? 6 : currentRound.length === 4 ? 3 : 2;

        setCareer((prev) =>
          evaluateMatchAchievements(prev, {
            won: false,
            goalsScored: result.scoreA,
            goalsConceded: result.scoreB,
            userTeamId: me,
            tournamentGoalsScored: totalGoalsScored,
            tournamentGoalsConceded: totalGoalsConceded,
            stageRankReached: eliminatedRank,
          })
        );

        setTournament({
          ...tournament,
          knockoutRound: null,
          bracketHistory: updatedHistory,
          matchLog: updatedLog,
          result: {
            title:
              currentRound.length === 1
                ? STRINGS.endScreen.runnerUpTitle
                : 'Turnuvaya Veda Ettin',
            description:
              currentRound.length === 1
                ? STRINGS.endScreen.runnerUpDesc
                : `${ROUND_NAMES[currentRound.length]} aşamasında elendin.`,
            isChampion: false,
          },
        });
        setCurrentMatch(null);
      } else if (currentRound.length === 1) {
        // User won the Final -> World Champion!
        setCareer((prev) =>
          evaluateMatchAchievements(prev, {
            won: true,
            goalsScored: result.scoreA,
            goalsConceded: result.scoreB,
            userTeamId: me,
            tournamentGoalsScored: totalGoalsScored,
            tournamentGoalsConceded: totalGoalsConceded,
            isChampion: true,
            stageRankReached: 7,
          })
        );

        setTournament({
          ...tournament,
          knockoutRound: null,
          bracketHistory: updatedHistory,
          matchLog: updatedLog,
          result: {
            title: STRINGS.endScreen.championTitle,
            description: `${TEAMS_DATA[me].n} ile Dünya Kupasını kaldırdınız! Tarih yazdın Şampiyon!`,
            isChampion: true,
          },
        });
        setCurrentMatch(null);
      } else {
        const nextRoundMatches: KnockoutMatchRecord[] = [];
        for (let i = 0; i < updatedRoundMatches.length; i += 2) {
          nextRoundMatches.push({
            teamAId: updatedRoundMatches[i].winnerId!,
            teamBId: updatedRoundMatches[i + 1].winnerId!,
          });
        }

        const nextStageRank: BestStageRank = currentRound.length === 8 ? 3 : 4;
        setCareer((prev) =>
          evaluateMatchAchievements(prev, {
            won: true,
            goalsScored: result.scoreA,
            goalsConceded: result.scoreB,
            userTeamId: me,
            tournamentGoalsScored: totalGoalsScored,
            tournamentGoalsConceded: totalGoalsConceded,
            stageRankReached: nextStageRank,
          })
        );

        setTournament({
          ...tournament,
          knockoutRound: nextRoundMatches,
          bracketHistory: updatedHistory,
          matchLog: updatedLog,
        });
        setCurrentMatch(null);
      }
    }
  };

  // Render match canvas
  if (currentMatch) {
    const isExhibition = Boolean(currentMatch.isQuickMatch);
    return (
      <>
        <PitchCanvas
          teamA={currentMatch.teamA}
          teamB={currentMatch.teamB}
          isKnockout={currentMatch.isKnockout}
          roundLabel={currentMatch.roundLabel}
          difficulty={difficulty}
          initialUserFormationId={
            isExhibition
              ? currentMatch.teamA.preferredFormationId || 'classic'
              : tournament?.userFormationId || 'classic'
          }
          isTwoPlayer={Boolean(currentMatch.isTwoPlayer)}
          onMatchFinish={handleMatchFinish}
          onQuitToTournament={() => setShowForfeitConfirmModal(true)}
        />
        <ConfirmDialog
          isOpen={showForfeitConfirmModal}
          title={STRINGS.dialogs.quitMatchTitle}
          message={
            isExhibition
              ? STRINGS.dialogs.quitQuickMatchMessage
              : STRINGS.dialogs.quitTournamentMessage
          }
          confirmLabel={
            isExhibition
              ? STRINGS.dialogs.quitQuickMatchConfirm
              : STRINGS.dialogs.quitTournamentConfirm
          }
          cancelLabel={STRINGS.dialogs.confirmCancel}
          isDanger={true}
          onCancel={() => setShowForfeitConfirmModal(false)}
          onConfirm={() => {
            setShowForfeitConfirmModal(false);
            if (isExhibition) {
              setCurrentMatch(null);
            } else {
              handleMatchFinish({ scoreA: 0, scoreB: 3 });
            }
          }}
        />
      </>
    );
  }

  // Render Tournament End Screen (Victory or Elimination with Trophy Animation & Stats)
  if (tournament?.result) {
    const endResult = tournament.result;
    const userTeam = TEAMS_DATA[tournament.userTeamId];
    const totalMatches = tournament.matchLog.length;
    const wins = tournament.matchLog.filter((m) => m.won).length;
    const goalsFor = tournament.matchLog.reduce((acc, m) => acc + m.scoreA, 0);
    const goalsAgainst = tournament.matchLog.reduce((acc, m) => acc + m.scoreB, 0);
    const cleanSheets = tournament.matchLog.filter((m) => m.scoreB === 0).length;

    return (
      <div className="h-dvh overflow-y-auto scrollable-view safe-area-container bg-stone-950 text-stone-100 flex flex-col items-center justify-center p-4 select-none relative">
        {/* Animated Trophy Aura for Champion */}
        {endResult.isChampion && (
          <div className="fixed inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-[500px] h-[500px] rounded-full bg-amber-500/15 blur-3xl animate-pulse" />
          </div>
        )}

        <div className="relative w-full max-w-lg my-auto bg-stone-900 border-2 border-stone-800 rounded-3xl p-6 text-center shadow-2xl z-10">
          {/* Animated Trophy or Ball */}
          <div className="relative inline-block my-2">
            {endResult.isChampion ? (
              <div className="relative animate-bounce">
                <span className="text-8xl drop-shadow-[0_0_35px_rgba(250,204,21,0.8)] inline-block">
                  🏆
                </span>
                <Sparkles className="w-8 h-8 text-amber-300 absolute -top-2 -right-2 animate-spin" />
              </div>
            ) : (
              <span className="text-7xl inline-block mb-1">⚽</span>
            )}
          </div>

          <h1 className="text-2xl sm:text-3xl font-black text-white mb-2">
            {endResult.title}
          </h1>
          <p className="text-sm text-stone-300 mb-5 leading-relaxed">
            {endResult.description}
          </p>

          {/* Detailed Tournament Statistics (Turnuva İstatistikleri) */}
          <div className="bg-stone-950/80 rounded-2xl p-4 border border-stone-800 mb-5 text-left">
            <div className="flex items-center justify-between mb-3 border-b border-stone-800/80 pb-2">
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <BarChart3 className="w-4 h-4" />
                Detaylı Turnuva İstatistikleri
              </span>
              <span className="text-xs font-bold text-stone-200 flex items-center gap-1.5">
                <TeamFlag flag={userTeam.f} className="w-5 h-3.5" />
                {userTeam.n}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs mb-3">
              <div className="bg-stone-900 p-2 rounded-xl border border-stone-800">
                <span className="text-base font-black text-emerald-400 block">{wins} / {totalMatches}</span>
                <span className="text-[11px] text-stone-400">Galibiyet</span>
              </div>
              <div className="bg-stone-900 p-2 rounded-xl border border-stone-800">
                <span className="text-base font-black text-amber-400 block">{goalsFor}</span>
                <span className="text-[11px] text-stone-400">Atılan Gol</span>
              </div>
              <div className="bg-stone-900 p-2 rounded-xl border border-stone-800">
                <span className="text-base font-black text-rose-400 block">{goalsAgainst}</span>
                <span className="text-[11px] text-stone-400">Yenen Gol</span>
              </div>
              <div className="bg-stone-900 p-2 rounded-xl border border-stone-800">
                <span className="text-base font-black text-blue-400 block">{cleanSheets}</span>
                <span className="text-[11px] text-stone-400">Gol Yemeden</span>
              </div>
            </div>

            {/* Match History list */}
            <div className="max-h-36 overflow-y-auto scrollable-view space-y-1 pr-1 text-xs">
              {tournament.matchLog.map((log, idx) => {
                const op = TEAMS_DATA[log.opponentId];
                return (
                  <div
                    key={idx}
                    className="p-1.5 px-2 rounded-lg bg-stone-900/60 border border-stone-800/60 flex items-center justify-between"
                  >
                    <span className="flex items-center gap-1.5">
                      <span>{idx + 1}. Maç: vs</span>
                      <TeamFlag flag={op.f} className="w-4 h-3" />
                      <span>{op.n}</span>
                    </span>
                    <span className="font-mono font-bold text-emerald-400">
                      {log.scoreA} – {log.scoreB} {log.penalties ? `(p. ${log.penalties[0]}-${log.penalties[1]})` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowTreeModal(true)}
              className="flex-1 min-h-[44px] py-3 rounded-2xl bg-stone-800 hover:bg-stone-700 font-bold text-xs text-stone-200 border border-stone-700 transition-colors flex items-center justify-center gap-1.5"
            >
              <GitBranch className="w-4 h-4 text-amber-400" />
              Eleme Ağacını Gör
            </button>
            <button
              data-start="true"
              onClick={() => {
                setTournament(null);
                try {
                  localStorage.removeItem('worldcup_fiske_save');
                } catch {}
              }}
              className="flex-1 min-h-[44px] py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 font-black text-sm text-white shadow-lg transition-all"
            >
              Yeni Turnuva
            </button>
          </div>
        </div>

        <TournamentTreeModal
          isOpen={showTreeModal}
          onClose={() => setShowTreeModal(false)}
          bracketHistory={tournament.bracketHistory}
          activeRound={tournament.knockoutRound}
          userTeamId={tournament.userTeamId}
          thirdPlaceMatch={tournament.thirdPlaceMatch}
        />
      </div>
    );
  }

  // Render Tournament Hub
  if (tournament) {
    const userTeam = TEAMS_DATA[tournament.userTeamId];
    const userForm = FORMATIONS.find((f) => f.id === tournament.userFormationId) || FORMATIONS[0];
    const nextFixture = getNextMatchInfo();
    const opponentTeam = nextFixture ? TEAMS_DATA[nextFixture.opponentId] : null;
    const opponentForm = opponentTeam
      ? FORMATIONS.find((f) => f.id === opponentTeam.preferredFormationId) || FORMATIONS[0]
      : FORMATIONS[0];

    const myGroup = tournament.groups[tournament.userGroupIndex];
    const sortedGroup = [...myGroup].sort((a, b) =>
      compareGroupTeams(a, b, tournament.table)
    );

    return (
      <div className="h-dvh overflow-y-auto scrollable-view safe-area-container bg-stone-950 text-stone-100 flex flex-col items-center p-3 sm:p-5 select-none">
        <div className="w-full max-w-xl flex flex-col gap-3.5 pb-4">
          {/* Header */}
          <header className="flex items-center justify-between bg-stone-900/90 p-3.5 px-4 rounded-2xl border border-stone-800">
            <div className="flex items-center gap-3 min-w-0">
              <TeamFlag flag={userTeam.f} className="w-9 h-6 shrink-0" />
              <div className="min-w-0">
                <h1 className="text-base font-black text-white truncate">{userTeam.n}</h1>
                <span className="text-xs text-emerald-400 font-semibold block truncate">
                  {nextFixture?.label || STRINGS.tournamentHub.centerTitle}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setShowFormationModal(true)}
                className="min-h-[44px] flex items-center gap-1 px-2.5 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-xs font-bold text-stone-200 border border-stone-700 transition-colors"
                title="Diziliş Seçimi"
              >
                <Layers className="w-3.5 h-3.5 text-amber-400" />
                {userForm.shortLabel}
              </button>
              <button
                onClick={() => setShowTacticsModal(true)}
                className="min-h-[44px] flex items-center gap-1 px-2.5 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-xs font-bold text-stone-200 border border-stone-700 transition-colors"
              >
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                {STRINGS.tournamentHub.rolesAndPassBtn}
              </button>
              <button
                onClick={() => setShowSettingsModal(true)}
                aria-label={STRINGS.settings.buttonLabel}
                title={STRINGS.settings.buttonLabel}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-stone-800 hover:bg-stone-700 text-xs font-bold text-stone-200 border border-stone-700 transition-colors"
              >
                <Settings className="w-4 h-4 text-stone-300" />
              </button>
            </div>
          </header>

          {/* Next Match Card with Formations & Opponent Preview */}
          {opponentTeam && (
            <section className="bg-gradient-to-br from-emerald-950/40 via-stone-900 to-stone-900 p-4 rounded-2xl border border-emerald-800/60 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Play className="w-3.5 h-3.5 fill-current" />
                  {STRINGS.tournamentHub.nextMatchHeading}
                </span>
                <span className="text-xs text-stone-400 font-medium">
                  {STRINGS.tournamentHub.durationTag}
                </span>
              </div>

              <div className="flex items-center justify-between py-2.5 px-3 bg-stone-950/60 rounded-xl border border-stone-800/80 mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <TeamFlag flag={userTeam.f} className="w-8 h-5.5" />
                  <div className="min-w-0">
                    <span className="text-sm font-bold text-white block truncate">{userTeam.n}</span>
                    <span className="text-[11px] text-emerald-400 font-medium block truncate">
                      {userForm.name}
                    </span>
                  </div>
                </div>

                <span className="text-base font-black text-stone-400 px-3 font-mono">VS</span>

                <div className="flex items-center gap-2.5 text-right min-w-0">
                  <div className="min-w-0">
                    <span className="text-sm font-bold text-white block truncate">{opponentTeam.n}</span>
                    <span className="text-[11px] text-amber-400 font-medium block truncate">
                      {'★'.repeat(getTeamStars(opponentTeam.r))} · {opponentForm.name}
                    </span>
                  </div>
                  <TeamFlag flag={opponentTeam.f} className="w-8 h-5.5" />
                </div>
              </div>

              {/* Opponent Preview Card: Stars & Formation */}
              <OpponentPreviewCard
                opponentTeam={opponentTeam}
                opponentFormation={opponentForm}
              />

              {/* Formation switcher prompt */}
              <div className="flex items-center justify-between text-xs text-stone-300 px-1 mb-3">
                <span>
                  {STRINGS.tournamentHub.yourFormation}{' '}
                  <b className="text-emerald-400">{userForm.name}</b>
                </span>
                <button
                  onClick={() => setShowFormationModal(true)}
                  className="min-h-[44px] px-2 text-xs text-amber-400 hover:underline font-bold flex items-center"
                >
                  {STRINGS.tournamentHub.changeFormation}
                </button>
              </div>

              <button
                data-start="true"
                onClick={handleStartMatch}
                className="w-full min-h-[48px] py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-black text-base text-white shadow-lg shadow-emerald-950/60 transition-all flex items-center justify-center gap-2"
              >
                <Play className="w-5 h-5 fill-current" />
                {STRINGS.tournamentHub.playMatchBtn}
              </button>
            </section>
          )}

          {/* Group Table or Knockout Round */}
          {!tournament.knockoutRound ? (
            <section className="bg-stone-900 p-4 rounded-2xl border border-stone-800">
              <div className="flex items-center justify-between mb-2.5">
                <h2 className="text-xs font-bold text-stone-400 uppercase tracking-wider">
                  Grup {'ABCDEFGH'[tournament.userGroupIndex]} {STRINGS.tournamentHub.standingsSuffix}
                </h2>
                <button
                  onClick={() => setShowTreeModal(true)}
                  className="min-h-[44px] px-2 text-xs text-amber-400 hover:underline font-bold flex items-center gap-1"
                >
                  <GitBranch className="w-3.5 h-3.5" />
                  {STRINGS.tournamentHub.bracketBtn}
                </button>
              </div>
              <div className="overflow-x-auto scrollable-view">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-stone-400 border-b border-stone-800">
                      <th className="py-2 px-1 text-center w-6">#</th>
                      <th className="py-2 px-2">Takım</th>
                      <th className="py-2 px-1 text-center">O</th>
                      <th className="py-2 px-1 text-center">G</th>
                      <th className="py-2 px-1 text-center">B</th>
                      <th className="py-2 px-1 text-center">M</th>
                      <th className="py-2 px-1 text-center">Av</th>
                      <th className="py-2 px-1 text-center font-bold text-white">P</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedGroup.map((teamId, rank) => {
                      const t = TEAMS_DATA[teamId];
                      const s = tournament.table[teamId];
                      const isMe = teamId === tournament.userTeamId;
                      const diff = s.gf - s.ga;

                      return (
                        <tr
                          key={teamId}
                          className={`border-b border-stone-800/50 ${
                            isMe ? 'bg-emerald-950/40 font-bold' : ''
                          }`}
                        >
                          <td className="py-2 px-1 text-center text-stone-400">
                            {rank + 1}
                          </td>
                          <td className="py-2 px-2 flex items-center gap-2 truncate">
                            <TeamFlag flag={t.f} className="w-5 h-3.5" />
                            <span className={isMe ? 'text-emerald-300' : 'text-stone-200'}>
                              {t.n}
                            </span>
                          </td>
                          <td className="py-2 px-1 text-center text-stone-300">
                            {s.w + s.d + s.l}
                          </td>
                          <td className="py-2 px-1 text-center text-stone-300">{s.w}</td>
                          <td className="py-2 px-1 text-center text-stone-300">{s.d}</td>
                          <td className="py-2 px-1 text-center text-stone-300">{s.l}</td>
                          <td className="py-2 px-1 text-center text-stone-300">
                            {diff > 0 ? `+${diff}` : diff}
                          </td>
                          <td className="py-2 px-1 text-center font-bold text-amber-300">
                            {s.p}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-stone-400 mt-2">
                {STRINGS.tournamentHub.groupQualifyNote}
              </p>
            </section>
          ) : (
            <section className="bg-stone-900 p-4 rounded-2xl border border-stone-800">
              <div className="flex items-center justify-between mb-2.5">
                <h2 className="text-xs font-bold text-stone-400 uppercase tracking-wider">
                  Eleme Aşaması (
                  {tournament.isPlayingThirdPlace
                    ? STRINGS.tournamentHub.thirdPlaceRoundName
                    : ROUND_NAMES[tournament.knockoutRound.length]}
                  )
                </h2>
                <button
                  onClick={() => setShowTreeModal(true)}
                  className="min-h-[44px] px-2 text-xs text-amber-400 hover:underline font-bold flex items-center gap-1"
                >
                  <GitBranch className="w-3.5 h-3.5" />
                  {STRINGS.tournamentHub.fullBracketBtn}
                </button>
              </div>
              <div className="grid gap-2">
                {tournament.knockoutRound.map((m, idx) => {
                  const tA = TEAMS_DATA[m.teamAId];
                  const tB = TEAMS_DATA[m.teamBId];
                  const isMyMatch = m.teamAId === tournament.userTeamId || m.teamBId === tournament.userTeamId;

                  return (
                    <div
                      key={idx}
                      className={`p-2.5 rounded-xl border flex items-center justify-between text-xs ${
                        isMyMatch
                          ? 'bg-emerald-950/40 border-emerald-600 font-bold shadow-md shadow-emerald-950/40'
                          : 'bg-stone-950/50 border-stone-800 text-stone-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 flex-1 truncate">
                        <TeamFlag flag={tA.f} className="w-5 h-3.5" />
                        <span className="truncate">{tA.n}</span>
                      </div>
                      <span className="px-2 font-mono text-stone-400">VS</span>
                      <div className="flex items-center gap-2 flex-1 justify-end truncate">
                        <span className="truncate">{tB.n}</span>
                        <TeamFlag flag={tB.f} className="w-5 h-3.5" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Quick Buttons Bar */}
          <div className="flex gap-2">
            <button
              onClick={() => setShowTreeModal(true)}
              className="flex-1 min-h-[44px] py-2.5 px-3 rounded-xl bg-stone-900 hover:bg-stone-800 border border-stone-800 text-xs font-bold text-stone-300 hover:text-white flex items-center justify-center gap-1.5 transition-colors"
            >
              <GitBranch className="w-4 h-4 text-amber-400" />
              {STRINGS.tournamentHub.treeBtn}
            </button>
            <button
              onClick={() => setShowFormationModal(true)}
              className="flex-1 min-h-[44px] py-2.5 px-3 rounded-xl bg-stone-900 hover:bg-stone-800 border border-stone-800 text-xs font-bold text-stone-300 hover:text-white flex items-center justify-center gap-1.5 transition-colors"
            >
              <Layers className="w-4 h-4 text-emerald-400" />
              {STRINGS.tournamentHub.tacticsBtn}
            </button>
            <button
              onClick={() => setShowSettingsModal(true)}
              className="min-h-[44px] py-2.5 px-3.5 rounded-xl bg-stone-900 hover:bg-stone-800 border border-stone-800 text-xs font-bold text-stone-300 hover:text-white flex items-center justify-center gap-1.5 transition-colors"
            >
              <Settings className="w-4 h-4 text-stone-300" />
              {STRINGS.settings.buttonLabel}
            </button>
          </div>

          {/* Reset Tournament button */}
          <button
            onClick={() => setShowResetConfirmModal(true)}
            className="min-h-[44px] py-2.5 text-xs text-stone-400 hover:text-stone-200 flex items-center justify-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {STRINGS.tournamentHub.resetTournamentBtn}
          </button>
        </div>

        {/* Modals */}
        <TacticsModal
          isOpen={showTacticsModal}
          onClose={() => setShowTacticsModal(false)}
        />
        <FormationSelector
          isOpen={showFormationModal}
          onClose={() => setShowFormationModal(false)}
          selectedFormationId={tournament.userFormationId}
          onSelectFormation={(fid) => {
            setTournament({ ...tournament, userFormationId: fid });
            setShowFormationModal(false);
          }}
          teamColor={userTeam.c}
        />
        <TournamentTreeModal
          isOpen={showTreeModal}
          onClose={() => setShowTreeModal(false)}
          bracketHistory={tournament.bracketHistory}
          activeRound={tournament.knockoutRound}
          userTeamId={tournament.userTeamId}
          thirdPlaceMatch={tournament.thirdPlaceMatch}
        />
        <SettingsModal
          isOpen={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
        />
        <ConfirmDialog
          isOpen={showResetConfirmModal}
          title={STRINGS.dialogs.resetTitle}
          message={STRINGS.dialogs.resetMessage}
          confirmLabel={STRINGS.dialogs.resetConfirm}
          cancelLabel={STRINGS.dialogs.confirmCancel}
          isDanger={true}
          onCancel={() => setShowResetConfirmModal(false)}
          onConfirm={() => {
            setShowResetConfirmModal(false);
            setTournament(null);
            try {
              localStorage.removeItem('worldcup_fiske_save');
            } catch {}
          }}
        />
      </div>
    );
  }

  // Render Title Screen
  return (
    <div className="h-dvh overflow-y-auto scrollable-view safe-area-container bg-stone-950 text-stone-100 flex flex-col items-center justify-between p-4 select-none">
      <div className="w-full max-w-xl flex flex-col gap-3.5">
        {/* Title Lockup */}
        <header className="text-center pt-1 pb-1">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-950/80 border border-emerald-700/60 shadow-xl mb-1.5 text-2xl">
            🏆
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            {STRINGS.app.title}
          </h1>
          <p className="text-xs sm:text-sm text-stone-400 mt-1">
            {STRINGS.app.subtitle}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
            <button
              type="button"
              onClick={() => setQuickMatchModalMode('quick')}
              className="min-h-[44px] px-3.5 py-2 rounded-full bg-amber-950/80 border border-amber-700 hover:bg-amber-900/80 text-amber-300 hover:text-white text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              {STRINGS.modes.quickMatch}
            </button>
            <button
              type="button"
              onClick={() => setQuickMatchModalMode('twoPlayer')}
              className="min-h-[44px] px-3.5 py-2 rounded-full bg-cyan-950/80 border border-cyan-700 hover:bg-cyan-900/80 text-cyan-300 hover:text-white text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <Users className="w-3.5 h-3.5 text-cyan-400" />
              {STRINGS.modes.twoPlayer}
            </button>
            <button
              type="button"
              onClick={() => setShowAchievementsModal(true)}
              className="min-h-[44px] px-3.5 py-2 rounded-full bg-stone-900 border border-stone-700 hover:border-amber-500 text-stone-200 hover:text-white text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <Award className="w-3.5 h-3.5 text-amber-400" />
              {STRINGS.achievements.buttonLabel}
            </button>
            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              className="min-h-[44px] px-3.5 py-2 rounded-full bg-stone-900 border border-stone-700 hover:border-emerald-600 text-stone-200 hover:text-white text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <Settings className="w-3.5 h-3.5 text-emerald-400" />
              {STRINGS.settings.buttonLabel}
            </button>
            <button
              type="button"
              onClick={() => setShowFormationModal(true)}
              className="min-h-[44px] px-3.5 py-2 rounded-full bg-stone-900 border border-stone-700 hover:border-emerald-600 text-stone-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              {STRINGS.tournamentHub.formationsBtn}
            </button>
            <button
              type="button"
              onClick={() => setShowTacticsModal(true)}
              className="min-h-[44px] px-3.5 py-2 rounded-full bg-stone-900 border border-stone-700 hover:border-emerald-600 text-stone-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Info className="w-3.5 h-3.5 text-emerald-400" />
              {STRINGS.tournamentHub.rolesAndPassBtn}
            </button>
          </div>
        </header>

        {/* Quick Match / 2-Player Result Banner (if just finished an exhibition match) */}
        {quickMatchSummary && (
          <section className="bg-stone-900/95 p-3.5 rounded-2xl border border-emerald-700/70 flex items-center justify-between gap-3 shadow-lg">
            <div className="flex items-center gap-2.5 min-w-0">
              <TeamFlag flag={quickMatchSummary.teamA.f} className="w-6 h-4.5" />
              <span className="text-xs font-bold text-white truncate">
                {quickMatchSummary.teamA.n}
              </span>
              <span className="font-mono font-black text-sm text-emerald-400 px-1.5">
                {quickMatchSummary.scoreA} – {quickMatchSummary.scoreB}
              </span>
              <span className="text-xs font-bold text-white truncate">
                {quickMatchSummary.teamB.n}
              </span>
              <TeamFlag flag={quickMatchSummary.teamB.f} className="w-6 h-4.5" />
            </div>
            <button
              type="button"
              onClick={() =>
                handleStartQuickOrTwoPlayerMatch(
                  quickMatchSummary.teamA.id,
                  quickMatchSummary.teamB.id,
                  quickMatchSummary.isTwoPlayer
                )
              }
              className="min-h-[44px] px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-black text-white shrink-0"
            >
              Tekrar Oyna
            </button>
          </section>
        )}

        {/* Difficulty Selector */}
        <section className="bg-stone-900/80 p-3 rounded-2xl border border-stone-800 flex items-center justify-between">
          <span className="text-xs font-bold text-stone-300">{STRINGS.app.difficultyLabel}</span>
          <div className="flex gap-1.5">
            {DIFFICULTY_NAMES.map((name, idx) => (
              <button
                key={idx}
                onClick={() => setDifficulty(idx)}
                className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                  difficulty === idx
                    ? 'bg-emerald-600 text-white shadow-md'
                    : 'bg-stone-800 text-stone-400 hover:text-stone-200'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </section>

        {/* Team Selection Grid */}
        <main className="bg-stone-900/60 p-3.5 rounded-3xl border border-stone-800">
          <h2 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-3 px-1">
            {STRINGS.app.selectTeamHeading}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-[48vh] overflow-y-auto scrollable-view pr-1">
            {TEAMS_DATA.map((t) => {
              const stars = getTeamStars(t.r);
              const form = FORMATIONS.find((f) => f.id === t.preferredFormationId) || FORMATIONS[0];

              return (
                <button
                  key={t.id}
                  onClick={() => startNewTournament(t.id)}
                  className="min-h-[54px] p-2.5 rounded-2xl bg-stone-900 hover:bg-emerald-950/60 border border-stone-800 hover:border-emerald-500 text-left transition-all hover:scale-[1.02] flex items-center gap-2.5 shadow-sm group"
                >
                  <TeamFlag flag={t.f} className="w-7 h-5 group-hover:scale-110 transition-transform" />
                  <div className="min-w-0 flex-1">
                    <span className="font-bold text-xs text-stone-100 truncate block">
                      {t.n}
                    </span>
                    <div className="flex items-center justify-between mt-0.5 gap-1">
                      <span className="text-[11px] text-amber-400 tracking-tighter">
                        {'★'.repeat(stars)}
                      </span>
                      <span className="text-[11px] text-stone-400 font-mono truncate">
                        {form.shortLabel}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </main>
      </div>

      <footer className="text-center text-[11px] text-stone-400 py-3">
        {STRINGS.app.footerHint}
      </footer>

      {/* Modals */}
      <TacticsModal
        isOpen={showTacticsModal}
        onClose={() => setShowTacticsModal(false)}
      />
      <FormationSelector
        isOpen={showFormationModal}
        onClose={() => setShowFormationModal(false)}
        selectedFormationId="classic"
        onSelectFormation={() => setShowFormationModal(false)}
      />
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
      />
      <AchievementsModal
        isOpen={showAchievementsModal}
        onClose={() => setShowAchievementsModal(false)}
        career={career}
      />
      <QuickMatchModal
        isOpen={quickMatchModalMode !== null}
        mode={quickMatchModalMode || 'quick'}
        onClose={() => setQuickMatchModalMode(null)}
        onStartMatch={handleStartQuickOrTwoPlayerMatch}
      />
    </div>
  );
}
