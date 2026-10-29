/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_RADIUS,
  ROLES,
  MATCH_DURATION_SECONDS,
  SHOT_CLOCK_SECONDS,
  FORMATIONS,
  PLAYERS_PER_TEAM,
  PASS_MAX_DISTANCE,
  BALL_CONTROL_RADIUS,
} from './constants.ts';
import {
  resetDisks,
  calculateShotPower,
  formatTimeMMSS,
  formatFootballMatchMinute,
  checkMatchEnd,
  physicsStep,
  checkPassSuccess,
  findClosestPlayerToBall,
  canPlayerControlBall,
  isPlayerSelectable,
  distancePointToSegment,
  stepDefenderClosing,
  checkDefenderInterception,
  calculateTrajectoryForecast,
  checkTurnTimeout,
} from './rules.ts';

test('Each team has 7 players (total 15 disks with ball)', () => {
  assert.equal(PLAYERS_PER_TEAM, 7);
  const disks = resetDisks();
  assert.equal(disks.length, 15);

  // 7 User players
  for (let i = 0; i < 7; i++) {
    assert.equal(disks[i].teamIndex, 0);
    assert.equal(disks[i].playerIndex, i);
  }

  // 7 Bot players
  for (let i = 7; i < 14; i++) {
    assert.equal(disks[i].teamIndex, 1);
    assert.equal(disks[i].playerIndex, i - 7);
  }

  // Ball is disk 14
  assert.equal(disks[14].ball, true);
  assert.equal(disks[14].r, 10);
});

test('Tactical formations all contain exactly 7 player positions', () => {
  assert.equal(FORMATIONS.length, 5);
  FORMATIONS.forEach((f) => {
    assert.equal(f.positions.length, 7, `Formation ${f.name} should have 7 coordinates`);
  });
});

test('Pass detection succeeds when ball stops near a teammate within distance threshold', () => {
  const disks = resetDisks();
  const ball = disks[14];

  // Move ball right next to teammate #2 (Stoper, index 1)
  // Distance will be ~25px, well within PASS_MAX_DISTANCE
  ball.x = disks[1].x + disks[1].r + ball.r + 15;
  ball.y = disks[1].y;

  // Shooter was user player #6 (Forvet, index 6)
  const passResult = checkPassSuccess(disks, 0, 6, PASS_MAX_DISTANCE);
  assert.equal(passResult.isPass, true);
  assert.equal(passResult.receiverPlayerIndex, 1);
  assert.ok(passResult.distance !== undefined && passResult.distance <= PASS_MAX_DISTANCE);
});

test('Pass detection fails if ball stops too far from teammates', () => {
  const disks = resetDisks();
  const ball = disks[14];

  // Place ball in isolated space far from all players
  ball.x = 250;
  ball.y = 410; // center circle, far from all players (> 100px)

  const passResult = checkPassSuccess(disks, 0, 6, PASS_MAX_DISTANCE);
  assert.equal(passResult.isPass, false);
});

test('Pass detection fails if opponent intercepts (closer to ball)', () => {
  const disks = resetDisks();
  const ball = disks[14];

  // Teammate at (200, 450)
  disks[2].x = 200;
  disks[2].y = 450;

  // Ball at (200, 490) -> distance to teammate = 40 - r
  ball.x = 200;
  ball.y = 490;

  // Opponent placed right between at (200, 485) -> closer!
  disks[8].x = 200;
  disks[8].y = 485;

  const passResult = checkPassSuccess(disks, 0, 6, PASS_MAX_DISTANCE);
  assert.equal(passResult.isPass, false);
});

test('Match duration is configured to 3 minutes (180 seconds)', () => {
  assert.equal(MATCH_DURATION_SECONDS, 180);
  assert.equal(formatTimeMMSS(180), '03:00');
  assert.equal(formatTimeMMSS(90), '01:30');
});

test('All 7 roles have defined stats and attributes', () => {
  assert.equal(ROLES.length, 7);
  assert.equal(ROLES[0].name, 'Kaleci');
  assert.equal(ROLES[1].name, 'Stoper');
  assert.equal(ROLES[2].name, 'Sol Bek');
  assert.equal(ROLES[3].name, 'Sağ Bek');
  assert.equal(ROLES[4].name, 'Ön Libero & Merkez');
  assert.equal(ROLES[5].name, 'On Numara');
  assert.equal(ROLES[6].name, 'Forvet');
});

test('Ball bounces off goal post and triggers postHit flag', () => {
  const disks = resetDisks();
  const ball = disks[14];

  // Aim directly at top-left goal post (GOAL_LEFT = 180, PITCH_TOP = 70)
  ball.x = 180;
  ball.y = 86; // 16px below post (ball radius = 10, post radius = 5, minD = 15)
  ball.vx = 0;
  ball.vy = -180; // moving up towards post

  const result = physicsStep(disks, 1 / 120);
  assert.equal(result.postHit, true);
  // Ball should bounce downwards (positive vy)
  assert.ok(ball.vy > 0, 'Ball velocity y should reverse on post impact');
});

test('Physics accumulator preserves elapsed time on 120Hz/90Hz displays without time loss', () => {
  const disks = resetDisks();
  const ball = disks[14];
  ball.vx = 200;
  ball.vy = 0;

  let accumulator = 0;
  const PHYSICS_DT = 1 / 120; // 0.008333s
  const frameDelta120Hz = 0.008; // slightly less than PHYSICS_DT
  let stepsRun = 0;

  // Run 15 frames of 0.008s
  for (let frame = 0; frame < 15; frame++) {
    accumulator += frameDelta120Hz;
    while (accumulator >= PHYSICS_DT) {
      accumulator -= PHYSICS_DT;
      stepsRun++;
      physicsStep(disks, PHYSICS_DT);
    }
  }

  // Without accumulator, stepsRun would be 0! With accumulator, ~14 steps execute
  assert.ok(stepsRun >= 14, `Expected at least 14 physics steps over 15 120Hz frames, got ${stepsRun}`);
  assert.ok(ball.x > 250, 'Ball should have moved forward');
});

test('30 consecutive shots simulate smoothly without NaN or freezing', () => {
  for (let shot = 0; shot < 30; shot++) {
    const disks = resetDisks();
    const shooter = disks[6]; // Forvet
    const angle = (shot / 30) * Math.PI * 2;
    const power = calculateShotPower(60 + (shot % 5) * 10, 7, shooter.y, 0);

    shooter.vx = Math.cos(angle) * power;
    shooter.vy = Math.sin(angle) * power;

    let steps = 0;
    while (steps < 200) {
      const res = physicsStep(disks, 1 / 120);
      steps++;
      // Verify no NaN coordinates
      for (const d of disks) {
        assert.ok(!Number.isNaN(d.x) && !Number.isNaN(d.y), 'Coordinates must be valid numbers');
        assert.ok(!Number.isNaN(d.vx) && !Number.isNaN(d.vy), 'Velocities must be valid numbers');
      }
      if (res.goal > 0) break;
      const anyMoving = disks.some((d) => d.vx * d.vx + d.vy * d.vy > 25);
      if (!anyMoving) break;
    }
    assert.ok(steps > 0, `Shot ${shot} should have executed physics steps`);
  }
});

test('findClosestPlayerToBall correctly identifies closest player per team', () => {
  const disks = resetDisks();
  const ball = disks[14];
  // Ball is at center (250, 410)
  const closestOverall = findClosestPlayerToBall(disks);
  assert.ok(closestOverall !== null);

  const closestUser = findClosestPlayerToBall(disks, 0);
  assert.ok(closestUser !== null);
  assert.equal(closestUser.teamIndex, 0);

  const closestBot = findClosestPlayerToBall(disks, 1);
  assert.ok(closestBot !== null);
  assert.equal(closestBot.teamIndex, 1);
});

test('canPlayerControlBall enforces BALL_CONTROL_RADIUS threshold', () => {
  const disks = resetDisks();
  const ball = disks[14];
  const userPlayer = disks[6]; // Forvet

  // Position player close to ball (within BALL_CONTROL_RADIUS = 78px)
  userPlayer.x = ball.x + 30;
  userPlayer.y = ball.y;
  assert.equal(canPlayerControlBall(userPlayer, ball, BALL_CONTROL_RADIUS), true);

  // Move player far away (> 150px)
  userPlayer.x = ball.x + 160;
  assert.equal(canPlayerControlBall(userPlayer, ball, BALL_CONTROL_RADIUS), false);
});

test('isPlayerSelectable allows any player in FREE_CHOICE, only receiver in PASS_RECEIVER_ONLY', () => {
  // In FREE_CHOICE: any of the 7 players can shoot!
  for (let i = 0; i < 7; i++) {
    assert.equal(isPlayerSelectable(i, 'FREE_CHOICE', null), true);
  }

  // In PASS_RECEIVER_ONLY: only the receiver player (e.g. index 3) can shoot!
  const receiverIndex = 3;
  for (let i = 0; i < 7; i++) {
    const expected = i === receiverIndex;
    assert.equal(
      isPlayerSelectable(i, 'PASS_RECEIVER_ONLY', receiverIndex),
      expected,
      `Player ${i} should ${expected ? '' : 'not '}be selectable after pass to ${receiverIndex}`
    );
  }
});

test('distancePointToSegment accurately calculates perpendicular distance to line segment', () => {
  // Point directly on segment
  const distOnLine = distancePointToSegment(100, 100, 50, 100, 150, 100);
  assert.equal(distOnLine, 0);

  // Point 20px above segment
  const distAbove = distancePointToSegment(100, 80, 50, 100, 150, 100);
  assert.equal(distAbove, 20);

  // Point beyond endpoint
  const distPastEnd = distancePointToSegment(180, 100, 50, 100, 150, 100);
  assert.equal(distPastEnd, 30);
});

test('stepDefenderClosing moves defender towards ball smoothly without teleporting', () => {
  const disks = resetDisks();
  const defender = disks[7]; // Bot Kaleci or defender
  const initialX = defender.x;
  const initialY = defender.y;
  const targetX = 250;
  const targetY = 350;

  // Step 0.1s at 100px/s -> should move exactly 10px towards target
  stepDefenderClosing(defender, targetX, targetY, 100, 0.1);
  const movedDist = Math.hypot(defender.x - initialX, defender.y - initialY);
  assert.ok(Math.abs(movedDist - 10) < 0.05, `Expected ~10px move, got ${movedDist}`);
});

test('checkDefenderInterception triggers when defender makes physical contact with ball', () => {
  const disks = resetDisks();
  const defender = disks[8];
  const ball = disks[14];

  // Far apart -> no interception
  defender.x = 100;
  defender.y = 200;
  ball.x = 300;
  ball.y = 400;
  assert.equal(checkDefenderInterception(defender, ball), false);

  // Placed right against each other -> interception detected
  ball.x = defender.x + defender.r + ball.r;
  ball.y = defender.y;
  assert.equal(checkDefenderInterception(defender, ball), true);
});

test('calculateTrajectoryForecast computes points and reflects off pitch boundary', () => {
  const points = calculateTrajectoryForecast(430, 400, 300, 0, 10, 10, 0.03);
  assert.ok(points.length > 5, 'Should generate trajectory points');
  // Starts moving right towards PITCH_RIGHT = 450, should bounce back left
  const hasReflected = points.some((p, i) => i > 1 && p.x < points[i - 1].x);
  assert.ok(hasReflected, 'Trajectory should reflect off right boundary');
});

test('10-second shot clock is configured to exactly 10 seconds', () => {
  assert.equal(SHOT_CLOCK_SECONDS, 10);
});

test('checkTurnTimeout accurately detects 5-second expiration during active turn phases', () => {
  // During aim phase
  assert.equal(checkTurnTimeout(4.5, 'aim'), false);
  assert.equal(checkTurnTimeout(0.1, 'aim'), false);
  assert.equal(checkTurnTimeout(0.0, 'aim'), true);
  assert.equal(checkTurnTimeout(-0.5, 'aim'), true);

  // During bot thinking/aiming
  assert.equal(checkTurnTimeout(0.0, 'bot_thinking'), true);
  assert.equal(checkTurnTimeout(0.0, 'bot_aiming'), true);

  // During non-turn phases (move, goal_pause, end) timeout should NOT trigger
  assert.equal(checkTurnTimeout(0.0, 'move'), false);
  assert.equal(checkTurnTimeout(0.0, 'goal_pause'), false);
  assert.equal(checkTurnTimeout(0.0, 'end'), false);
});

import {
  evaluateMatchAchievements,
  loadCareerHistory,
  getBestResultLabel,
} from './achievements.ts';
import { loadSettings } from './settings.ts';
import { STRINGS } from '../strings.ts';

test('evaluateMatchAchievements unlocks first_win, score_5_goals, turkey_champion, and clean_sheet_champion', () => {
  const initial = loadCareerHistory();

  // 1. Win a match 5-0 -> unlocks first_win and score_5_goals
  const afterMatch1 = evaluateMatchAchievements(initial, {
    won: true,
    goalsScored: 5,
    goalsConceded: 0,
    userTeamId: 16, // Türkiye
    stageRankReached: 1,
  });
  assert.ok(afterMatch1.unlockedIds.includes('first_win'));
  assert.ok(afterMatch1.unlockedIds.includes('score_5_goals'));
  assert.equal(afterMatch1.totalWins, 1);
  assert.equal(afterMatch1.totalGoalsScored, 5);

  // 2. Win Championship with Türkiye without conceding any goals -> unlocks turkey_champion & clean_sheet_champion
  const afterChamp = evaluateMatchAchievements(afterMatch1, {
    won: true,
    goalsScored: 2,
    goalsConceded: 0,
    userTeamId: 16,
    tournamentGoalsScored: 12,
    tournamentGoalsConceded: 0,
    isChampion: true,
    stageRankReached: 7,
  });
  assert.ok(afterChamp.unlockedIds.includes('turkey_champion'));
  assert.ok(afterChamp.unlockedIds.includes('clean_sheet_champion'));
  assert.equal(afterChamp.totalChampionships, 1);
  assert.equal(getBestResultLabel(afterChamp.bestStageRank), STRINGS.achievements.bestResults.champion);
});

test('loadSettings returns enabled defaults for sound and vibration', () => {
  const s = loadSettings();
  assert.equal(typeof s.soundEnabled, 'boolean');
  assert.equal(typeof s.vibrationEnabled, 'boolean');
});

import {
  INTERACTION_RADIUS,
  PASS_DIRECTION_MIN_COS,
} from './constants.ts';
import {
  findValidPassTarget,
  ShotTrackingContext,
} from './rules.ts';
import { CommentaryController } from './commentary.ts';
import { run59MatchAutotest } from './autotest.ts';

test('PASS_MAX_DISTANCE is 96px (24% of 400px pitch width, >=30% shorter than 160px) and INTERACTION_RADIUS is 54px', () => {
  assert.equal(PASS_MAX_DISTANCE, 96);
  assert.equal(INTERACTION_RADIUS, 54);
  assert.ok(PASS_DIRECTION_MIN_COS >= 0.85);
});

test('Opponent shot or deflection never counts as a pass for the user (Bug 1 fix)', () => {
  const disks = resetDisks();
  const ball = disks[14];

  // Ball stops right next to User player #2 (index 1)
  ball.x = disks[1].x + 32;
  ball.y = disks[1].y;

  // Context: Opponent (team 1) took the shot, and user defender (team 0) intercepted it
  const opponentShotCtx: ShotTrackingContext = {
    shotTeam: 1,
    shooterPlayerId: 6,
    shotType: 'interception',
    shooterWasInInteractionRadius: true,
    shooterTouchedBall: true,
    lastTouchTeam: 0,
    lastTouchPlayerId: 1,
    ballStartX: 250,
    ballStartY: 350,
    aimDirX: 0,
    aimDirY: 1,
    endlineHit: false,
    sidelineHit: false,
    extraShotAlreadyGranted: false,
  };

  // Must NOT be a pass for Team 1 (wrong touch team) AND must NOT be a pass for Team 0 (opponent shot)
  const resForTeam1 = checkPassSuccess(disks, 1, 6, null, false, PASS_MAX_DISTANCE, 23, opponentShotCtx);
  assert.equal(resForTeam1.isPass, false);

  const resForTeam0 = checkPassSuccess(disks, 0, 6, null, false, PASS_MAX_DISTANCE, 23, opponentShotCtx);
  assert.equal(resForTeam0.isPass, false);
});

test('Player outside INTERACTION_RADIUS cannot initiate a pass or receive an extra turn (Bug 2 & 3 fix)', () => {
  const disks = resetDisks();
  const ball = disks[14];

  // Move shooter (User player #5, index 4) 110px away from ball (> INTERACTION_RADIUS = 54)
  disks[4].x = ball.x;
  disks[4].y = ball.y + 110;

  // Teammate #6 (index 5) is 70px away from shooter
  disks[5].x = disks[4].x;
  disks[5].y = disks[4].y - 70;

  // findValidPassTarget must return null because shooter is outside INTERACTION_RADIUS of the ball
  const target = findValidPassTarget(disks, 0, 4, 0, -1, PASS_MAX_DISTANCE, INTERACTION_RADIUS);
  assert.equal(target, null);
});

test('CommentaryController generates rich Turkish lines without consecutive repetition and honors event priority', () => {
  const ctrl = new CommentaryController('Türkiye', 'Brezilya');
  let prevText = ctrl.getLatest().text;

  for (let i = 0; i < 12; i++) {
    const entry = ctrl.emitImmediate('shot', {
      teamName: 'Türkiye',
      opponentName: 'Brezilya',
      playerIndex: 6,
      minute: `${10 + i}'`,
    });
    assert.notEqual(entry.text, prevText, 'Consecutive commentary sentences must not repeat');
    prevText = entry.text;
  }

  // Priority test: post_hit (80) and save (70) queued in same turn -> post_hit wins
  ctrl.clearPending();
  ctrl.queueTurnEvent('shot', { teamName: 'Türkiye', opponentName: 'Brezilya', playerIndex: 6 });
  ctrl.queueTurnEvent('save', { teamName: 'Türkiye', opponentName: 'Brezilya', playerIndex: 6 });
  ctrl.queueTurnEvent('post_hit', { teamName: 'Türkiye', opponentName: 'Brezilya', playerIndex: 6 });
  const flushed = ctrl.flushPendingTurnEvent();
  assert.ok(flushed !== null);
  assert.equal(flushed.type, 'post_hit');
  assert.equal(ctrl.getHistory().length, 3);
});

test('Mandatory 59-Match Automated AI-vs-AI Simulation completes with ZERO rule violations', () => {
  const report = run59MatchAutotest(true);
  assert.equal(report.totalMatches, 59);
  assert.equal(report.deadlockedMatches, 0, 'No match may deadlock (>10s stationary without turn advance)');
  assert.equal(report.violationsByRule.outsideInteractionRadiusPassOrExtraTurn, 0);
  assert.equal(report.violationsByRule.falsePassOnOpponentShot, 0);
  assert.equal(report.violationsByRule.passOverMaxDistance, 0);
  assert.equal(report.violationsByRule.negativeTurnCounterOrDoubleGrant, 0);
  assert.equal(report.violationsByRule.deadlockOver10s, 0);
  assert.equal(report.violationsByRule.doubleGoalOrInconsistentScore, 0);
  assert.equal(report.violationsByRule.repeatedOrMismatchedCommentary, 0);
  assert.equal(report.violationsByRule.invalidMatchDuration, 0);
  assert.equal(report.totalViolations, 0, `Expected 0 total violations across 59 matches, got ${report.totalViolations}`);
});

