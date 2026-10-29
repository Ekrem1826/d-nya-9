/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CENTER_X,
  CENTER_Y,
  DEFENDER_CHASE_SPEEDS,
  DIFFICULTY_NAMES,
  EXTRA_TIME_SECONDS,
  FORMATIONS,
  GOAL_LEFT,
  GOAL_RIGHT,
  INTERACTION_RADIUS,
  MATCH_DURATION_SECONDS,
  PHYSICS_DT,
  PITCH_BOTTOM,
  PITCH_TOP,
  PLAYERS_PER_TEAM,
  PASS_MAX_DISTANCE,
  PLAYER_CAPTURE_RADIUS,
  ROLES,
  SHOT_CLOCK_SECONDS,
  TEAMS_DATA,
  Team,
} from './constants.ts';
import {
  Disk,
  ShotActionType,
  ShotTrackingContext,
  TurnMode,
  areDisksMoving,
  calculateShotPower,
   calculateTrajectoryForecast,
  canPlayerControlBall,
  checkDefenderInterception,
  checkMatchEnd,
  checkPassSuccess,
  checkTurnTimeout,
  distancePointToSegment,
  findClosestPlayerToBall,
  findValidPassTarget,
  formatFootballMatchMinute,
  isPlayerSelectable,
  physicsStep,
  resetDisks,
  simulatePenaltyShootout,
  stepDefenderClosing,
} from './rules.ts';
import { CommentaryController, CommentaryEventType } from './commentary.ts';

export interface AIDecision {
  diskIdx: number;
  playerIndex: number;
  vx: number;
  vy: number;
  powerRatio: number;
  angle: number;
  targetTeammateIdx: number; // disk index or -1
  shotType: ShotActionType;
  thinkTime: number;
  aimTime: number;
  trajPoints: { x: number; y: number }[];
}

/**
 * Shared AI decision engine for both Team 0 and Team 1.
 * Scales precision, power, reaction speed, and tactical passing by difficulty (0: Kolay, 1: Normal, 2: Zor).
 */
export function computeAIDecision(
  disks: Disk[],
  activeTeam: number, // 0 or 1
  difficulty: number, // 0, 1, 2
  teamRating: number,
  turnMode: TurnMode,
  passReceiverPlayerIndex: number | null,
  simDisksPool?: Disk[]
): AIDecision {
  const ball = disks[disks.length - 1];
  const teamOffset = activeTeam === 1 ? PLAYERS_PER_TEAM : 0;
  const opponentOffset = activeTeam === 1 ? 0 : PLAYERS_PER_TEAM;
  const targetGoalY = activeTeam === 0 ? PITCH_TOP : PITCH_BOTTOM;
  const clampedDiff = Math.min(2, Math.max(0, difficulty));
  const skillFactor = Math.min(1, Math.max(0.2, 0.38 + clampedDiff * 0.26 + (teamRating - 72) / 90));

  // 1. Player Selection
  let candIdx = -1;
  if (turnMode === 'PASS_RECEIVER_ONLY' && passReceiverPlayerIndex !== null) {
    candIdx = teamOffset + passReceiverPlayerIndex;
  } else {
    let bestPlayerScore = -Infinity;
    for (let i = 0; i < PLAYERS_PER_TEAM; i++) {
      const diskIdx = teamOffset + i;
      const d = disks[diskIdx];
      if (!d) continue;
      const distToBall = Math.hypot(d.x - ball.x, d.y - ball.y);
      const role = ROLES[d.playerIndex || 0] || ROLES[0];
      let pScore = 650 - distToBall * 1.15;
      if (role.id === 7 || role.id === 6) pScore += 65;
      const isInAttackHalf = activeTeam === 0 ? d.y < CENTER_Y : d.y > CENTER_Y;
      if (isInAttackHalf) pScore += 55;
      // Bonus if player is on own-goal side of the ball (good shooting angle towards opponent goal)
      const isBehindBall = activeTeam === 0 ? d.y > ball.y - 10 : d.y < ball.y + 10;
      if (isBehindBall) pScore += 90;
      if (pScore > bestPlayerScore) {
        bestPlayerScore = pScore;
        candIdx = diskIdx;
      }
    }
  }

  if (candIdx === -1 || !disks[candIdx]) {
    const closest = findClosestPlayerToBall(disks, activeTeam);
    candIdx = closest ? closest.diskIndex : teamOffset + 6;
  }

  const playerDisk = disks[candIdx];
  const playerIndex = playerDisk.playerIndex ?? (candIdx - teamOffset);
  const role = ROLES[playerIndex] || ROLES[0];

  // Check if direct line from ball to opponent goal is blocked
  let isGoalShotBlocked = false;
  for (let u = 0; u < PLAYERS_PER_TEAM; u++) {
    const oppDisk = disks[opponentOffset + u];
    if (!oppDisk) continue;
    const isBetweenBallAndGoal =
      activeTeam === 0 ? oppDisk.y < ball.y : oppDisk.y > ball.y;
    if (isBetweenBallAndGoal) {
      const lineDist = distancePointToSegment(
        oppDisk.x,
        oppDisk.y,
        ball.x,
        ball.y,
        CENTER_X,
        targetGoalY
      );
      if (lineDist < oppDisk.r + ball.r + 12) {
        isGoalShotBlocked = true;
        break;
      }
    }
  }

  // 2. Tactical Pass Check (ONLY if shooter is within INTERACTION_RADIUS of the ball!)
  let passOption: { teammateDiskIdx: number; vx: number; vy: number } | null = null;
  const shooterInInteractionRadius = canPlayerControlBall(playerDisk, ball, INTERACTION_RADIUS);

  if (shooterInInteractionRadius && (clampedDiff >= 1 || isGoalShotBlocked)) {
    for (let i = 0; i < PLAYERS_PER_TEAM; i++) {
      if (i === playerIndex) continue;
      const tmDiskIdx = teamOffset + i;
      const tm = disks[tmDiskIdx];
      if (!tm) continue;

      const isForwardProgress =
        activeTeam === 0 ? tm.y < ball.y - 18 : tm.y > ball.y + 18;
      if (!isForwardProgress) continue;

      const aimAngle = Math.atan2(tm.y - playerDisk.y, tm.x - playerDisk.x);
      const aimDirX = Math.cos(aimAngle);
      const aimDirY = Math.sin(aimAngle);

      // Verify using strict findValidPassTarget helper
      const validTarget = findValidPassTarget(
        disks,
        activeTeam,
        playerIndex,
        aimDirX,
        aimDirY,
        PASS_MAX_DISTANCE,
        INTERACTION_RADIUS
      );

      if (validTarget && validTarget.diskIndex === tmDiskIdx) {
        let laneBlocked = false;
        for (let u = 0; u < PLAYERS_PER_TEAM; u++) {
          const oppDisk = disks[opponentOffset + u];
          const laneDist = distancePointToSegment(
            oppDisk.x,
            oppDisk.y,
            ball.x,
            ball.y,
            tm.x,
            tm.y
          );
          if (laneDist < oppDisk.r + ball.r + 10) {
            laneBlocked = true;
            break;
          }
        }

        if (!laneBlocked) {
          const shotPower = calculateShotPower(48, role.id, playerDisk.y, activeTeam);
          passOption = {
            teammateDiskIdx: tmDiskIdx,
            vx: aimDirX * shotPower * 0.68,
            vy: aimDirY * shotPower * 0.68,
          };
          break;
        }
      }
    }
  }

  // 3. Direct Shot Simulation
  const angleToBall = Math.atan2(ball.y - playerDisk.y, ball.x - playerDisk.x);
  const candidateJitters =
    clampedDiff === 0
      ? [-0.24, 0, 0.24]
      : clampedDiff === 1
      ? [-0.12, -0.05, 0, 0.05, 0.12]
      : [-0.08, -0.04, -0.015, 0, 0.015, 0.04, 0.08];

  const simDisks =
    simDisksPool && simDisksPool.length === disks.length
      ? simDisksPool
      : disks.map((d) => ({ ...d }));

  let bestShot: { vx: number; vy: number; score: number } | null = null;
  let bestScore = -Infinity;

  for (const jitter of candidateJitters) {
    const errorNoise = (1 - skillFactor) * (clampedDiff === 0 ? 0.16 : clampedDiff === 1 ? 0.06 : 0.015);
    const angle = angleToBall + jitter + errorNoise;
    const basePull = clampedDiff === 0 ? 52 : clampedDiff === 1 ? 74 : 94;
    const shotPower = calculateShotPower(basePull, role.id, playerDisk.y, activeTeam);
    const vx = Math.cos(angle) * shotPower;
    const vy = Math.sin(angle) * shotPower;

    for (let k = 0; k < disks.length; k++) {
      simDisks[k].x = disks[k].x;
      simDisks[k].y = disks[k].y;
      simDisks[k].vx = 0;
      simDisks[k].vy = 0;
      simDisks[k].m = disks[k].m;
      simDisks[k].r = disks[k].r;
      simDisks[k].k = disks[k].k;
      simDisks[k].f = disks[k].f;
      simDisks[k].ball = disks[k].ball;
      simDisks[k].roleId = disks[k].roleId;
      simDisks[k].teamIndex = disks[k].teamIndex;
      simDisks[k].playerIndex = disks[k].playerIndex;
    }
    simDisks[candIdx].vx = vx;
    simDisks[candIdx].vy = vy;

    let goalResult = 0;
    let touchedBall = false;
    for (let step = 0; step < 18; step++) {
      const res = physicsStep(simDisks, PHYSICS_DT);
      if (res.ballContactTeam === activeTeam) touchedBall = true;
      if (res.goal > 0) {
        goalResult = res.goal;
        break;
      }
      if (!areDisksMoving(simDisks, 120)) break;
    }

    const simBall = simDisks[simDisks.length - 1];
    const desiredGoalCode = activeTeam === 0 ? 1 : 2;
    const ownGoalCode = activeTeam === 0 ? 2 : 1;

    let evalScore = 0;
    if (goalResult === desiredGoalCode) evalScore += 12000;
    else if (goalResult === ownGoalCode) evalScore -= 15000;
    else {
      if (touchedBall) evalScore += 300;
      const progressY = activeTeam === 0 ? ball.y - simBall.y : simBall.y - ball.y;
      evalScore += progressY * 8;
      const distToGoalCenter = Math.abs(simBall.x - CENTER_X);
      evalScore -= distToGoalCenter * 1.3;
    }

    if (evalScore > bestScore) {
      bestScore = evalScore;
      bestShot = { vx, vy, score: evalScore };
    }
  }

  let chosenVx = bestShot ? bestShot.vx : Math.cos(angleToBall) * 440;
  let chosenVy = bestShot ? bestShot.vy : Math.sin(angleToBall) * 440;
  let targetTeammateIdx = -1;
  let shotType: ShotActionType = role.id === 1 ? 'clearance' : 'shot';

  if (passOption && (isGoalShotBlocked || bestScore < 8500)) {
    chosenVx = passOption.vx;
    chosenVy = passOption.vy;
    targetTeammateIdx = passOption.teammateDiskIdx;
    shotType = 'pass';
  }

  const thinkTime = clampedDiff === 0 ? 0.75 : clampedDiff === 1 ? 0.52 : 0.36;
  const aimTime = clampedDiff === 0 ? 0.62 : clampedDiff === 1 ? 0.48 : 0.35;

  const trajPoints = calculateTrajectoryForecast(
    playerDisk.x,
    playerDisk.y,
    chosenVx,
    chosenVy,
    playerDisk.r,
    12
  );

  return {
    diskIdx: candIdx,
    playerIndex,
    vx: chosenVx,
    vy: chosenVy,
    powerRatio: Math.min(1, Math.hypot(chosenVx, chosenVy) / 600),
    angle: Math.atan2(chosenVy, chosenVx),
    targetTeammateIdx,
    shotType,
    thinkTime,
    aimTime,
    trajPoints,
  };
}

export interface AutotestViolationCounters {
  outsideInteractionRadiusPassOrExtraTurn: number;
  falsePassOnOpponentShot: number;
  passOverMaxDistance: number;
  negativeTurnCounterOrDoubleGrant: number;
  deadlockOver10s: number;
  doubleGoalOrInconsistentScore: number;
  repeatedOrMismatchedCommentary: number;
  invalidMatchDuration: number;
}

export interface SingleMatchSimResult {
  matchIndex: number;
  teamAName: string;
  teamBName: string;
  difficulty: number;
  isKnockout: boolean;
  scoreA: number;
  scoreB: number;
  penalties?: [number, number];
  elapsedDurationSeconds: number;
  passesCompleted: number;
  shotsTaken: number;
  deadlocked: boolean;
  violations: AutotestViolationCounters;
}

export interface AutotestSummaryReport {
  totalMatches: number;
  totalGoals: number;
  averageGoalsPerMatch: number;
  deadlockedMatches: number;
  totalPassesCompleted: number;
  totalViolations: number;
  violationsByRule: AutotestViolationCounters;
  matches: SingleMatchSimResult[];
}

/**
 * Simulates a single complete match (AI vs AI) and checks all 8 rule invariants on every step.
 */
export function simulateSingleMatchForTest(
  matchIndex: number,
  teamA: Team,
  teamB: Team,
  formationAId: string,
  formationBId: string,
  difficulty: number,
  isKnockout: boolean
): SingleMatchSimResult {
  const violations: AutotestViolationCounters = {
    outsideInteractionRadiusPassOrExtraTurn: 0,
    falsePassOnOpponentShot: 0,
    passOverMaxDistance: 0,
    negativeTurnCounterOrDoubleGrant: 0,
    deadlockOver10s: 0,
    doubleGoalOrInconsistentScore: 0,
    repeatedOrMismatchedCommentary: 0,
    invalidMatchDuration: 0,
  };

  const formA = FORMATIONS.find((f) => f.id === formationAId) || FORMATIONS[0];
  const formB = FORMATIONS.find((f) => f.id === formationBId) || FORMATIONS[0];
  let disks = resetDisks(formA.positions, formB.positions);
  const simPool = disks.map((d) => ({ ...d }));

  const commentary = new CommentaryController(teamA.n, teamB.n);
  let lastCommentarySentence = commentary.getLatest().text;

  const verifyCommentary = (expectedCategory: CommentaryEventType, emittedText: string) => {
    if (emittedText === lastCommentarySentence) {
      violations.repeatedOrMismatchedCommentary++;
    }
    lastCommentarySentence = emittedText;
    // Check that opponent shot never produces pass commentary for other team
    if (expectedCategory !== 'pass' && emittedText.toLowerCase().includes('pas bağlantısı')) {
      violations.repeatedOrMismatchedCommentary++;
    }
  };

  let remainingSeconds = MATCH_DURATION_SECONDS;
  let elapsedRegularSeconds = 0;
  let elapsedExtraSeconds = 0;
  let isExtraTime = false;
  let score: [number, number] = [0, 0];
  let goalsCountedList: number[] = [];
  let phase = 'aim' as 'aim' | 'move' | 'goal_pause' | 'end';
  let turn: number = matchIndex % 2; // alternate kickoff team
  let turnMode: TurnMode = 'FREE_CHOICE';
  let passReceiverPlayerIndex: number | null = null;
  let remainingActionsInTurn = 1; // Central turn/attempt counter
  let extraShotGrantedThisTurn = false;
  let shotResolved = true;
  let stationarySecondsWithoutTurnAdvance = 0;
  let moveElapsedSeconds = 0;
  let waitTimer = 0.25;
  let turnTimer = SHOT_CLOCK_SECONDS;
  let closingDefenderIdx = -1;
  let activeShotContext: ShotTrackingContext | null = null;
  let targetTeammateDiskIdx = -1;
  let ballEnteredCaptureZone = false;
  let halfTimeAnnounced = false;
  let lastMinuteAnnounced = false;
  let passesCompleted = 0;
  let shotsTaken = 0;
  let penalties: [number, number] | undefined = undefined;
  let deadlocked = false;

  const dt = PHYSICS_DT * 2; // 60Hz simulation step (16.67ms)
  let safetySteps = 0;
  const maxSafetySteps = 40000; // ~660s max cap

  while (phase !== 'end' && safetySteps < maxSafetySteps) {
    safetySteps++;

    // Invariant 4: Turn counter must never be negative
    if (remainingActionsInTurn < 0) {
      violations.negativeTurnCounterOrDoubleGrant++;
    }

    // Track stationary ball time to detect any >10s deadlock
    const moving = areDisksMoving(disks);
    if (!moving && phase !== 'goal_pause') {
      stationarySecondsWithoutTurnAdvance += dt;
      if (stationarySecondsWithoutTurnAdvance > 10.2) {
        violations.deadlockOver10s++;
        deadlocked = true;
        break;
      }
    } else {
      stationarySecondsWithoutTurnAdvance = 0;
    }

    // Decrement match clock
    if (phase === 'aim' || phase === 'move') {
      const prevRem = remainingSeconds;
      remainingSeconds = Math.max(0, remainingSeconds - dt);
      const consumed = prevRem - remainingSeconds;
      if (isExtraTime) elapsedExtraSeconds += consumed;
      else elapsedRegularSeconds += consumed;

      const minuteLabel = formatFootballMatchMinute(remainingSeconds, MATCH_DURATION_SECONDS, isExtraTime);

      if (!isExtraTime && !halfTimeAnnounced && remainingSeconds <= MATCH_DURATION_SECONDS / 2) {
        halfTimeAnnounced = true;
        const entry = commentary.emitImmediate('half_time', {
          teamName: teamA.n,
          opponentName: teamB.n,
          minute: "45'",
          scoreA: score[0],
          scoreB: score[1],
        });
        verifyCommentary('half_time', entry.text);
      }

      if (!isExtraTime && !lastMinuteAnnounced && remainingSeconds <= 20) {
        lastMinuteAnnounced = true;
        const entry = commentary.emitImmediate('last_minute', {
          teamName: teamA.n,
          opponentName: teamB.n,
          minute: minuteLabel,
          scoreA: score[0],
          scoreB: score[1],
        });
        verifyCommentary('last_minute', entry.text);
      }

      // Check match end when clock hits 0 and disks are stopped
      if (remainingSeconds <= 0 && phase === 'aim' && !moving) {
        const endCheck = checkMatchEnd(remainingSeconds, score[0], score[1], isKnockout, isExtraTime);
        if (endCheck.startExtraTime) {
          isExtraTime = true;
          remainingSeconds = EXTRA_TIME_SECONDS;
          const entry = commentary.emitImmediate('extra_time', {
            teamName: teamA.n,
            opponentName: teamB.n,
            minute: 'Uzatma',
            scoreA: score[0],
            scoreB: score[1],
          });
          verifyCommentary('extra_time', entry.text);
        } else if (endCheck.startPenalties) {
          penalties = simulatePenaltyShootout(teamA.r, teamB.r);
          phase = 'end';
          const entry = commentary.emitImmediate('match_end', {
            teamName: teamA.n,
            opponentName: teamB.n,
            minute: "90'+",
            scoreA: score[0],
            scoreB: score[1],
          });
          verifyCommentary('match_end', entry.text);
          break;
        } else if (endCheck.finished) {
          phase = 'end';
          const entry = commentary.emitImmediate('match_end', {
            teamName: teamA.n,
            opponentName: teamB.n,
            minute: "90'+",
            scoreA: score[0],
            scoreB: score[1],
          });
          verifyCommentary('match_end', entry.text);
          break;
        }
      }
    }

    // 10-second shot clock check
    if (phase === 'aim') {
      turnTimer = Math.max(0, turnTimer - dt);
      if (checkTurnTimeout(turnTimer, phase)) {
        const timedOutTeam = turn;
        turn = 1 - turn;
        turnMode = 'FREE_CHOICE';
        passReceiverPlayerIndex = null;
        remainingActionsInTurn = 1;
        extraShotGrantedThisTurn = false;
        shotResolved = true;
        turnTimer = SHOT_CLOCK_SECONDS;
        waitTimer = 0.25;
        stationarySecondsWithoutTurnAdvance = 0;

        const entry = commentary.emitImmediate('timeout', {
          teamName: timedOutTeam === 0 ? teamA.n : teamB.n,
          opponentName: timedOutTeam === 0 ? teamB.n : teamA.n,
          minute: formatFootballMatchMinute(remainingSeconds, MATCH_DURATION_SECONDS, isExtraTime),
          scoreA: score[0],
          scoreB: score[1],
        });
        verifyCommentary('timeout', entry.text);
        continue;
      }
    }

    // Execute AI turn during aim phase
    if (phase === 'aim') {
      waitTimer -= dt;
      if (waitTimer <= 0) {
        if (remainingActionsInTurn !== 1) {
          violations.negativeTurnCounterOrDoubleGrant++;
        }

        // Verify passReceiverPlayerIndex is within INTERACTION_RADIUS if in PASS_RECEIVER_ONLY mode
        if (turnMode === 'PASS_RECEIVER_ONLY') {
          if (passReceiverPlayerIndex === null) {
            violations.outsideInteractionRadiusPassOrExtraTurn++;
          } else {
            const recDisk = disks[turn * PLAYERS_PER_TEAM + passReceiverPlayerIndex];
            const ball = disks[disks.length - 1];
            if (!canPlayerControlBall(recDisk, ball, INTERACTION_RADIUS)) {
              violations.outsideInteractionRadiusPassOrExtraTurn++;
            }
          }
        }

        const activeTeamObj = turn === 0 ? teamA : teamB;
        const decision = computeAIDecision(
          disks,
          turn,
          difficulty,
          activeTeamObj.r,
          turnMode,
          passReceiverPlayerIndex,
          simPool
        );

        const shooterDisk = disks[decision.diskIdx];
        const ball = disks[disks.length - 1];
        const shooterInRadius = canPlayerControlBall(shooterDisk, ball, INTERACTION_RADIUS);

        // Invariant 1: If shooter is outside INTERACTION_RADIUS, it must never be marked as a 'pass'
        if (!shooterInRadius && decision.shotType === 'pass') {
          violations.outsideInteractionRadiusPassOrExtraTurn++;
        }

        const speed = Math.hypot(decision.vx, decision.vy) || 1;
        activeShotContext = {
          shotTeam: turn,
          shooterPlayerId: decision.playerIndex,
          shotType: decision.shotType,
          shooterWasInInteractionRadius: shooterInRadius,
          shooterTouchedBall: false,
          lastTouchTeam: null,
          lastTouchPlayerId: null,
          ballStartX: ball.x,
          ballStartY: ball.y,
          aimDirX: decision.vx / speed,
          aimDirY: decision.vy / speed,
          endlineHit: false,
          sidelineHit: false,
          extraShotAlreadyGranted: extraShotGrantedThisTurn,
        };

        targetTeammateDiskIdx = decision.targetTeammateIdx;
        ballEnteredCaptureZone = false;
        shooterDisk.vx = decision.vx;
        shooterDisk.vy = decision.vy;

        remainingActionsInTurn--; // Decrement to 0 while ball moves
        shotResolved = false;
        moveElapsedSeconds = 0;
        stationarySecondsWithoutTurnAdvance = 0;
        shotsTaken++;
        phase = 'move';
        commentary.clearPending();

        const defTeam = 1 - turn;
        const closestDef = findClosestPlayerToBall(disks, defTeam);
        closingDefenderIdx = closestDef ? closestDef.diskIndex : -1;
      }
    } else if (phase === 'move') {
      moveElapsedSeconds += dt;
      const ball = disks[disks.length - 1];
      const ballSpeed = Math.hypot(ball.vx, ball.vy);

      // Defender closing
      if (closingDefenderIdx >= 0 && disks[closingDefenderIdx] && ballSpeed > 30) {
        const defDisk = disks[closingDefenderIdx];
        const chaseSpeed = DEFENDER_CHASE_SPEEDS[Math.min(2, Math.max(0, difficulty))];
        stepDefenderClosing(defDisk, ball.x, ball.y, chaseSpeed, dt);

        if (checkDefenderInterception(defDisk, ball)) {
          ball.vx *= 0.25;
          ball.vy *= 0.25;
          defDisk.vx = 0;
          defDisk.vy = 0;
          const interceptTeam = defDisk.teamIndex ?? (1 - (activeShotContext?.shotTeam ?? 0));
          if (activeShotContext) {
            // IMPORTANT: Do NOT overwrite shotTeam! Record lastTouchTeam and interception type.
            activeShotContext.lastTouchTeam = interceptTeam;
            activeShotContext.lastTouchPlayerId = defDisk.playerIndex ?? 0;
            activeShotContext.shotType = 'interception';
          }
          closingDefenderIdx = -1;
          commentary.queueTurnEvent('interception', {
            teamName: interceptTeam === 0 ? teamA.n : teamB.n,
            opponentName: interceptTeam === 0 ? teamB.n : teamA.n,
            playerIndex: defDisk.playerIndex ?? 1,
            minute: formatFootballMatchMinute(remainingSeconds, MATCH_DURATION_SECONDS, isExtraTime),
          });
        }
      }

      // Run 2 substeps of PHYSICS_DT
      let goalDetected = 0;
      for (let s = 0; s < 2; s++) {
        const prevX = ball.x;
        const prevY = ball.y;
        const res = physicsStep(disks, PHYSICS_DT);

        if (res.ballContactTeam !== null && activeShotContext) {
          activeShotContext.lastTouchTeam = res.ballContactTeam;
          activeShotContext.lastTouchPlayerId = res.ballContactPlayerIndex;
          if (
            res.ballContactTeam === activeShotContext.shotTeam &&
            res.ballContactPlayerIndex === activeShotContext.shooterPlayerId
          ) {
            activeShotContext.shooterTouchedBall = true;
          }
        }

        if (res.endlineOut && activeShotContext) {
          activeShotContext.endlineHit = true;
          commentary.queueTurnEvent('missed_shot', {
            teamName: activeShotContext.shotTeam === 0 ? teamA.n : teamB.n,
            opponentName: activeShotContext.shotTeam === 0 ? teamB.n : teamA.n,
            playerIndex: activeShotContext.shooterPlayerId,
            minute: formatFootballMatchMinute(remainingSeconds, MATCH_DURATION_SECONDS, isExtraTime),
          });
        }

        if (res.sidelineHit && activeShotContext) {
          activeShotContext.sidelineHit = true;
          commentary.queueTurnEvent('out_of_bounds', {
            teamName: activeShotContext.shotTeam === 0 ? teamA.n : teamB.n,
            opponentName: activeShotContext.shotTeam === 0 ? teamB.n : teamA.n,
            playerIndex: activeShotContext.shooterPlayerId,
            minute: formatFootballMatchMinute(remainingSeconds, MATCH_DURATION_SECONDS, isExtraTime),
          });
        }

        if (targetTeammateDiskIdx >= 0 && disks[targetTeammateDiskIdx]) {
          const tm = disks[targetTeammateDiskIdx];
          const swept = distancePointToSegment(tm.x, tm.y, prevX, prevY, ball.x, ball.y);
          if (swept <= INTERACTION_RADIUS) {
            ballEnteredCaptureZone = true;
          }
        }

        if (res.postHit && activeShotContext) {
          commentary.queueTurnEvent('post_hit', {
            teamName: activeShotContext.shotTeam === 0 ? teamA.n : teamB.n,
            opponentName: activeShotContext.shotTeam === 0 ? teamB.n : teamA.n,
            playerIndex: activeShotContext.shooterPlayerId,
            minute: formatFootballMatchMinute(remainingSeconds, MATCH_DURATION_SECONDS, isExtraTime),
          });
        }

        if (
          res.ballContactRoleId === 1 &&
          activeShotContext &&
          res.ballContactTeam !== activeShotContext.shotTeam &&
          res.ballContactTeam !== null
        ) {
          commentary.queueTurnEvent('save', {
            teamName: activeShotContext.shotTeam === 0 ? teamA.n : teamB.n,
            opponentName: activeShotContext.shotTeam === 0 ? teamB.n : teamA.n,
            playerIndex: activeShotContext.shooterPlayerId,
            minute: formatFootballMatchMinute(remainingSeconds, MATCH_DURATION_SECONDS, isExtraTime),
          });
        }

        if (res.goal > 0) {
          goalDetected = res.goal;
          break;
        }
        if (!areDisksMoving(disks)) break;
      }

      // Safety cap on move duration (prevent infinite slow slide > 6s)
      if (moveElapsedSeconds > 6.0 && goalDetected === 0) {
        for (const d of disks) {
          d.vx = 0;
          d.vy = 0;
        }
      }

      if (goalDetected > 0) {
        if (shotResolved) {
          // Double goal resolution on same shot!
          violations.doubleGoalOrInconsistentScore++;
        }
        shotResolved = true;
        for (const d of disks) {
          d.vx = 0;
          d.vy = 0;
        }

        if (goalDetected === 1) score[0]++;
        else if (goalDetected === 2) score[1]++;
        goalsCountedList.push(goalDetected);

        const scoringTeamIdx = goalDetected === 1 ? 0 : 1;
        const scoringTeamName = scoringTeamIdx === 0 ? teamA.n : teamB.n;
        const concedingTeamName = scoringTeamIdx === 0 ? teamB.n : teamA.n;
        const minuteStr = formatFootballMatchMinute(remainingSeconds, MATCH_DURATION_SECONDS, isExtraTime);

        commentary.clearPending();
        const goalEntry = commentary.emitImmediate('goal', {
          teamName: scoringTeamName,
          opponentName: concedingTeamName,
          playerIndex: activeShotContext?.shooterPlayerId ?? 6,
          minute: minuteStr,
          scoreA: score[0],
          scoreB: score[1],
        });
        verifyCommentary('goal', goalEntry.text);

        phase = 'goal_pause';
        waitTimer = 0.5;
        turn = scoringTeamIdx === 0 ? 1 : 0; // Conceding team kicks off
        turnMode = 'FREE_CHOICE';
        passReceiverPlayerIndex = null;
        remainingActionsInTurn = 1;
        extraShotGrantedThisTurn = false;
      } else if (!areDisksMoving(disks)) {
        if (shotResolved) {
          violations.negativeTurnCounterOrDoubleGrant++;
          continue;
        }
        shotResolved = true;
        closingDefenderIdx = -1;

        const shotTeam: number = activeShotContext ? activeShotContext.shotTeam : turn;
        const shooterId: number = activeShotContext ? activeShotContext.shooterPlayerId : 0;

        const passResult = checkPassSuccess(
          disks,
          shotTeam,
          shooterId,
          targetTeammateDiskIdx >= 0 ? targetTeammateDiskIdx : null,
          ballEnteredCaptureZone,
          PASS_MAX_DISTANCE,
          PLAYER_CAPTURE_RADIUS,
          activeShotContext ?? undefined
        );

        if (passResult.isPass && passResult.receiverPlayerIndex !== undefined && passResult.receiverDiskIndex !== undefined) {
          const receiverDisk = disks[passResult.receiverDiskIndex];

          // Verify all pass invariants!
          // 1. Receiver must belong to shotTeam (never opponent!)
          if (receiverDisk.teamIndex !== shotTeam || activeShotContext?.lastTouchTeam !== shotTeam) {
            violations.falsePassOnOpponentShot++;
          }
          // 2. Receiver must be within INTERACTION_RADIUS of the ball
          const distToBall = Math.hypot(receiverDisk.x - ball.x, receiverDisk.y - ball.y);
          if (distToBall > INTERACTION_RADIUS || !activeShotContext?.shooterWasInInteractionRadius) {
            violations.outsideInteractionRadiusPassOrExtraTurn++;
          }
          // 3. Pass distance from ball start must be <= PASS_MAX_DISTANCE
          if (activeShotContext) {
            const originDist = Math.hypot(
              receiverDisk.x - activeShotContext.ballStartX,
              receiverDisk.y - activeShotContext.ballStartY
            );
            if (originDist > PASS_MAX_DISTANCE) {
              violations.passOverMaxDistance++;
            }
          }
          // 4. Extra shot must not have been granted already in this possession
          if (extraShotGrantedThisTurn) {
            violations.negativeTurnCounterOrDoubleGrant++;
          }

          passesCompleted++;
          turn = shotTeam;
          turnMode = 'PASS_RECEIVER_ONLY';
          passReceiverPlayerIndex = passResult.receiverPlayerIndex;
          extraShotGrantedThisTurn = true;
          remainingActionsInTurn = 1;
          turnTimer = SHOT_CLOCK_SECONDS;
          waitTimer = 0.25;
          phase = 'aim';

          const entry = commentary.emitImmediate('pass', {
            teamName: shotTeam === 0 ? teamA.n : teamB.n,
            opponentName: shotTeam === 0 ? teamB.n : teamA.n,
            playerIndex: shooterId,
            receiverIndex: passResult.receiverPlayerIndex,
            minute: formatFootballMatchMinute(remainingSeconds, MATCH_DURATION_SECONDS, isExtraTime),
          });
          verifyCommentary('pass', entry.text);
        } else {
          // Check if match clock already expired while ball was moving
          if (remainingSeconds <= 0) {
            phase = 'aim';
            remainingActionsInTurn = 1;
            continue;
          }

          const nextTeam = 1 - shotTeam;
          turn = nextTeam;
          turnMode = 'FREE_CHOICE';
          passReceiverPlayerIndex = null;
          extraShotGrantedThisTurn = false;
          remainingActionsInTurn = 1;
          turnTimer = SHOT_CLOCK_SECONDS;
          waitTimer = 0.25;
          phase = 'aim';

          const flushed = commentary.flushPendingTurnEvent('turnover', {
            teamName: shotTeam === 0 ? teamA.n : teamB.n,
            opponentName: nextTeam === 0 ? teamA.n : teamB.n,
            playerIndex: shooterId,
            minute: formatFootballMatchMinute(remainingSeconds, MATCH_DURATION_SECONDS, isExtraTime),
          });
          if (flushed) {
            verifyCommentary(flushed.type, flushed.text);
          }
        }
      }
    } else if (phase === 'goal_pause') {
      waitTimer -= dt;
      if (waitTimer <= 0) {
        if (isExtraTime && score[0] !== score[1]) {
          phase = 'end';
          const entry = commentary.emitImmediate('match_end', {
            teamName: teamA.n,
            opponentName: teamB.n,
            minute: 'Altın Gol',
            scoreA: score[0],
            scoreB: score[1],
          });
          verifyCommentary('match_end', entry.text);
          break;
        }
        disks = resetDisks(formA.positions, formB.positions);
        // Verify ball is at exact center after goal reset
        const resetBall = disks[disks.length - 1];
        if (resetBall.x !== CENTER_X || resetBall.y !== CENTER_Y) {
          violations.doubleGoalOrInconsistentScore++;
        }
        turnMode = 'FREE_CHOICE';
        passReceiverPlayerIndex = null;
        extraShotGrantedThisTurn = false;
        remainingActionsInTurn = 1;
        shotResolved = true;
        turnTimer = SHOT_CLOCK_SECONDS;
        waitTimer = 0.25;
        phase = 'aim';
      }
    }
  }

  // Verify score consistency with counted goals
  const countedA = goalsCountedList.filter((g) => g === 1).length;
  const countedB = goalsCountedList.filter((g) => g === 2).length;
  if (countedA !== score[0] || countedB !== score[1]) {
    violations.doubleGoalOrInconsistentScore++;
  }

  // Verify match ended at 180s (or within 180s + extra time if knockout tie)
  if (Math.abs(elapsedRegularSeconds - MATCH_DURATION_SECONDS) > 1.5 || phase !== 'end') {
    violations.invalidMatchDuration++;
  }

  return {
    matchIndex,
    teamAName: teamA.n,
    teamBName: teamB.n,
    difficulty,
    isKnockout,
    scoreA: score[0],
    scoreB: score[1],
    penalties,
    elapsedDurationSeconds: Math.round(elapsedRegularSeconds),
    passesCompleted,
    shotsTaken,
    deadlocked,
    violations,
  };
}

/**
 * Runs the mandatory 59-match automated test suite across Easy, Normal, and Hard difficulties,
 * various team and formation combinations, and group/knockout scenarios.
 */
export function run59MatchAutotest(logToConsole = true): AutotestSummaryReport {
  const TOTAL_MATCHES = 59;
  const matches: SingleMatchSimResult[] = [];
  const totalViolationsByRule: AutotestViolationCounters = {
    outsideInteractionRadiusPassOrExtraTurn: 0,
    falsePassOnOpponentShot: 0,
    passOverMaxDistance: 0,
    negativeTurnCounterOrDoubleGrant: 0,
    deadlockOver10s: 0,
    doubleGoalOrInconsistentScore: 0,
    repeatedOrMismatchedCommentary: 0,
    invalidMatchDuration: 0,
  };

  for (let i = 0; i < TOTAL_MATCHES; i++) {
    // Equally distributed across Easy (0), Normal (1), Hard (2): 20, 20, 19
    const difficulty = i % 3;
    const teamA = TEAMS_DATA[(i * 3) % TEAMS_DATA.length];
    const teamB = TEAMS_DATA[(i * 5 + 7) % TEAMS_DATA.length];
    const formationA = FORMATIONS[i % FORMATIONS.length].id;
    const formationB = FORMATIONS[(i + 2) % FORMATIONS.length].id;
    const isKnockout = i % 2 === 0; // Half are knockout matches (testing golden goal & penalty shootouts)

    const res = simulateSingleMatchForTest(
      i + 1,
      teamA,
      teamB.id === teamA.id ? TEAMS_DATA[(i + 1) % TEAMS_DATA.length] : teamB,
      formationA,
      formationB,
      difficulty,
      isKnockout
    );

    matches.push(res);

    (Object.keys(totalViolationsByRule) as Array<keyof AutotestViolationCounters>).forEach((k) => {
      totalViolationsByRule[k] += res.violations[k];
    });
  }

  const totalGoals = matches.reduce((sum, m) => sum + m.scoreA + m.scoreB, 0);
  const averageGoalsPerMatch = Math.round((totalGoals / TOTAL_MATCHES) * 100) / 100;
  const deadlockedMatches = matches.filter((m) => m.deadlocked).length;
  const totalPassesCompleted = matches.reduce((sum, m) => sum + m.passesCompleted, 0);
  const totalViolations = Object.values(totalViolationsByRule).reduce((a, b) => a + b, 0);

  if (logToConsole) {
    console.log('\n============================================================');
    console.log('⚽ FISKE FUTBOL — 59 MAÇLIK OTOMATİK TEST ÖZET TABLOSU');
    console.log('============================================================');
    console.table({
      'Oynanan Maç Sayısı': TOTAL_MATCHES,
      'Kolay / Normal / Zor Dağılımı': `${matches.filter((m) => m.difficulty === 0).length} / ${matches.filter((m) => m.difficulty === 1).length} / ${matches.filter((m) => m.difficulty === 2).length}`,
      'Eleme Maçı Sayısı': matches.filter((m) => m.isKnockout).length,
      'Toplam Atılan Gol': totalGoals,
      'Maç Başına Ortalama Gol': averageGoalsPerMatch,
      'Tamamlanan Pas Sayısı': totalPassesCompleted,
      'Kilitlenen Maç Sayısı': deadlockedMatches,
      'TOPLAM KURAL İHLALİ': totalViolations,
    });
    console.table({
      '1. INTERACTION_RADIUS Dışı Pas/Ekstra Hak İhlali': totalViolationsByRule.outsideInteractionRadiusPassOrExtraTurn,
      '2. Rakip Vuruşunda Yanlış "Pas" İhlali': totalViolationsByRule.falsePassOnOpponentShot,
      '3. PASS_MAX_DISTANCE Üzeri Pas İhlali': totalViolationsByRule.passOverMaxDistance,
      '4. Negatif Tur Sayacı / Çift Hak İhlali': totalViolationsByRule.negativeTurnCounterOrDoubleGrant,
      '5. 10sn+ Hareketsiz Kilitlenme İhlali': totalViolationsByRule.deadlockOver10s,
      '6. Çift Gol Sayımı / Skor Tutarsızlığı': totalViolationsByRule.doubleGoalOrInconsistentScore,
      '7. Spiker Tekrarı / Uyumsuz Yorum İhlali': totalViolationsByRule.repeatedOrMismatchedCommentary,
      '8. 180sn Maç Süresi Bitiş İhlali': totalViolationsByRule.invalidMatchDuration,
    });
    console.log('============================================================\n');
  }

  return {
    totalMatches: TOTAL_MATCHES,
    totalGoals,
    averageGoalsPerMatch,
    deadlockedMatches,
    totalPassesCompleted,
    totalViolations,
    violationsByRule: totalViolationsByRule,
    matches,
  };
}
