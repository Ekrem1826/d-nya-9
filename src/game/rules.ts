/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BASE_RADIUS,
  ROLES,
  PlayerRole,
  PITCH_LEFT,
  PITCH_TOP,
  PITCH_RIGHT,
  PITCH_BOTTOM,
  GOAL_LEFT,
  GOAL_RIGHT,
  CENTER_X,
  CENTER_Y,
  PHYSICS_DT,
  MAX_PULL_DISTANCE,
  MATCH_DURATION_SECONDS,
  SHOT_CLOCK_SECONDS,
  FORMATIONS,
  PLAYERS_PER_TEAM,
  INTERACTION_RADIUS,
  PASS_MAX_DISTANCE,
  PASS_DIRECTION_MIN_COS,
  PLAYER_CAPTURE_RADIUS,
  BALL_CONTROL_RADIUS,
  PASS_TARGET_MAX_DISTANCE,
  DEFENDER_CHASE_SPEEDS,
  POST_RADIUS,
  MIN_VELOCITY_THRESHOLD,
  MIN_VELOCITY_SQ,
} from './constants.ts';

export interface Disk {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  m: number;
  k: number; // friction drag coefficient
  f: number; // Math.exp(-k * DT)
  ball?: boolean;
  roleId?: number; // 1..7
  teamIndex?: number; // 0: User, 1: Bot
  playerIndex?: number; // 0..6
}

export const BALL_INDEX = PLAYERS_PER_TEAM * 2; // 14

export type ShotActionType = 'pass' | 'shot' | 'clearance' | 'interception';

export interface ShotTrackingContext {
  shotTeam: number; // 0 or 1
  shooterPlayerId: number; // 0..6
  shotType: ShotActionType;
  shooterWasInInteractionRadius: boolean;
  shooterTouchedBall: boolean;
  lastTouchTeam: number | null;
  lastTouchPlayerId: number | null;
  ballStartX: number;
  ballStartY: number;
  aimDirX: number;
  aimDirY: number;
  endlineHit: boolean;
  sidelineHit: boolean;
  extraShotAlreadyGranted: boolean;
}

/**
 * Creates disk representation.
 */
export function createDisk(
  x: number,
  y: number,
  r: number,
  m: number,
  k: number,
  ball = false,
  roleId?: number,
  teamIndex?: number,
  playerIndex?: number
): Disk {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    r,
    m,
    k,
    f: Math.exp(-k * PHYSICS_DT),
    ball,
    roleId,
    teamIndex,
    playerIndex,
  };
}

/**
 * Resets the 15 disks on the field:
 * Disks 0..6: User's 7 players (bottom half with formationA)
 * Disks 7..13: Bot's 7 players (top half with formationB)
 * Disk 14: Ball (center)
 * Enforces safe clearance from center ball so no player disk ever spawns overlapping the ball.
 */
export function resetDisks(
  formationA: [number, number][] = FORMATIONS[0].positions,
  formationB: [number, number][] = FORMATIONS[0].positions
): Disk[] {
  const disks: Disk[] = [];
  const ballRadius = 10;

  const ensureCenterClearance = (x: number, y: number, r: number, teamIdx: number): [number, number] => {
    const dx = x - CENTER_X;
    const dy = y - CENTER_Y;
    const dist = Math.hypot(dx, dy);
    const minClearance = r + ballRadius + 14;
    if (dist < minClearance) {
      const pushDirY = teamIdx === 0 ? 1 : -1;
      return [x, CENTER_Y + pushDirY * minClearance];
    }
    return [x, y];
  };

  // Team 0 (User - bottom half)
  formationA.forEach((p, idx) => {
    const role = ROLES[idx] || ROLES[ROLES.length - 1];
    const [safeX, safeY] = ensureCenterClearance(PITCH_LEFT + p[0], PITCH_TOP + p[1], role.radius, 0);
    disks.push(
      createDisk(
        safeX,
        safeY,
        role.radius,
        role.mass,
        2.4, // ground friction
        false,
        role.id,
        0,
        idx
      )
    );
  });

  // Team 1 (Bot - top half, mirrored)
  formationB.forEach((p, idx) => {
    const role = ROLES[idx] || ROLES[ROLES.length - 1];
    const [safeX, safeY] = ensureCenterClearance(
      PITCH_LEFT + p[0],
      PITCH_TOP + 680 - p[1],
      role.radius,
      1
    );
    disks.push(
      createDisk(
        safeX,
        safeY,
        role.radius,
        role.mass,
        2.4,
        false,
        role.id,
        1,
        idx
      )
    );
  });

  // Disk 14: Ball (Exact center of pitch)
  disks.push(createDisk(CENTER_X, CENTER_Y, ballRadius, 1.0, 1.7, true));

  return disks;
}

export interface StepResult {
  goal: number; // 0: none, 1: team A goal (top net), 2: team B goal (bottom net)
  highestCollisionImpulse: number;
  ballContactRoleId: number | null;
  ballContactTeam: number | null;
  ballContactPlayerIndex: number | null;
  postHit: boolean;
  endlineOut: boolean;
  sidelineHit: boolean;
}

// 4 Goal posts (X, Y)
const GOAL_POSTS: [number, number][] = [
  [GOAL_LEFT, PITCH_TOP],
  [GOAL_RIGHT, PITCH_TOP],
  [GOAL_LEFT, PITCH_BOTTOM],
  [GOAL_RIGHT, PITCH_BOTTOM],
];

/**
 * 2D physics step adhering to the 7 roles, goal posts, net collisions, and ball dynamics.
 * Includes post-collision boundary and goal-line enforcement so disks can never be pushed
 * out of bounds or stall inside the goal mouth.
 */
export function physicsStep(disks: Disk[], dt = PHYSICS_DT): StepResult {
  let goal = 0;
  let highestImpulse = 0;
  let ballContactRoleId: number | null = null;
  let ballContactTeam: number | null = null;
  let ballContactPlayerIndex: number | null = null;
  let postHit = false;
  let endlineOut = false;
  let sidelineHit = false;

  // 1. Movement, friction, and boundary collisions
  for (const o of disks) {
    if (!o.vx && !o.vy) continue;
    o.x += o.vx * dt;
    o.y += o.vy * dt;

    // Time-independent friction decay: exact at any dt
    const f = dt === PHYSICS_DT ? o.f : Math.exp(-o.k * dt);
    const r = o.r;
    const e = o.ball ? 0.85 : 0.6; // restitution on border bounce
    const sp = Math.hypot(o.vx, o.vy);
    const minSpeedLoss = o.ball ? 20 : 50;
    const ns = Math.max(0, sp * f - minSpeedLoss * dt);

    if (ns < MIN_VELOCITY_THRESHOLD) {
      o.vx = 0;
      o.vy = 0;
    } else {
      o.vx *= ns / sp;
      o.vy *= ns / sp;
    }

    if (o.vx * o.vx + o.vy * o.vy < MIN_VELOCITY_SQ) {
      o.vx = 0;
      o.vy = 0;
    }

    // Left and right side pitch boundaries
    if (o.x < PITCH_LEFT + r) {
      o.x = PITCH_LEFT + r;
      o.vx = Math.abs(o.vx) * e;
      if (o.ball) sidelineHit = true;
    }
    if (o.x > PITCH_RIGHT - r) {
      o.x = PITCH_RIGHT - r;
      o.vx = -Math.abs(o.vx) * e;
      if (o.ball) sidelineHit = true;
    }

    // Top and bottom goal boundaries
    if (o.ball && o.x > GOAL_LEFT && o.x < GOAL_RIGHT) {
      if (o.y < PITCH_TOP) {
        goal = 1; // Team 0 scored into Team 1's goal!
        if (o.y < PITCH_TOP - 36) {
          o.y = PITCH_TOP - 36;
          o.vy = Math.abs(o.vy) * 0.3;
        }
        if (o.x < GOAL_LEFT + r) {
          o.x = GOAL_LEFT + r;
          o.vx = Math.abs(o.vx) * 0.4;
        } else if (o.x > GOAL_RIGHT - r) {
          o.x = GOAL_RIGHT - r;
          o.vx = -Math.abs(o.vx) * 0.4;
        }
      } else if (o.y > PITCH_BOTTOM) {
        goal = 2; // Team 1 scored into Team 0's goal!
        if (o.y > PITCH_BOTTOM + 36) {
          o.y = PITCH_BOTTOM + 36;
          o.vy = -Math.abs(o.vy) * 0.3;
        }
        if (o.x < GOAL_LEFT + r) {
          o.x = GOAL_LEFT + r;
          o.vx = Math.abs(o.vx) * 0.4;
        } else if (o.x > GOAL_RIGHT - r) {
          o.x = GOAL_RIGHT - r;
          o.vx = -Math.abs(o.vx) * 0.4;
        }
      }
    } else {
      if (o.y < PITCH_TOP + r) {
        o.y = PITCH_TOP + r;
        o.vy = Math.abs(o.vy) * e;
        if (o.ball) endlineOut = true;
      }
      if (o.y > PITCH_BOTTOM - r) {
        o.y = PITCH_BOTTOM - r;
        o.vy = -Math.abs(o.vy) * e;
        if (o.ball) endlineOut = true;
      }
    }
  }

  // 2. Goal post collision for the ball
  const ball = disks[disks.length - 1];
  if (ball && ball.ball && (ball.vx !== 0 || ball.vy !== 0)) {
    for (const [px, py] of GOAL_POSTS) {
      const dx = ball.x - px;
      const dy = ball.y - py;
      const dist = Math.hypot(dx, dy);
      const minD = ball.r + POST_RADIUS;

      if (dist < minD && dist > 0.001) {
        const nx = dx / dist;
        const ny = dy / dist;
        // Separate from post
        ball.x = px + nx * minD;
        ball.y = py + ny * minD;

        // Elastic rebound off circular post
        const vn = ball.vx * nx + ball.vy * ny;
        if (vn < 0) {
          ball.vx -= 1.85 * vn * nx;
          ball.vy -= 1.85 * vn * ny;
          postHit = true;
          highestImpulse = Math.max(highestImpulse, -vn * 1.5);
        }
      }
    }
  }

  // 3. Inter-disk collisions
  for (let i = 0; i < disks.length; i++) {
    for (let j = i + 1; j < disks.length; j++) {
      const a = disks[i];
      const b = disks[j];
      if (!(a.vx || a.vy || b.vx || b.vy)) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const rr = a.r + b.r;
      const d2 = dx * dx + dy * dy;

      if (d2 < rr * rr && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;

        const im = 1 / a.m + 1 / b.m;
        const overlap = rr - d;
        const pa = overlap / a.m / im;
        const pb = overlap / b.m / im;

        a.x -= nx * pa;
        a.y -= ny * pa;
        b.x += nx * pb;
        b.y += nx * pb;

        const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (vn < 0) {
          highestImpulse = Math.max(highestImpulse, -vn);

          let eRest = a.ball || b.ball ? 0.9 : 0.7;

          // Check role-specific collision characteristics
          const playerDisk = a.ball ? b : b.ball ? a : null;
          const isBallCollision = a.ball || b.ball;

          if (isBallCollision && playerDisk && playerDisk.roleId) {
            ballContactRoleId = playerDisk.roleId;
            ballContactTeam = playerDisk.teamIndex ?? null;
            ballContactPlayerIndex = playerDisk.playerIndex ?? null;

            // 1 — Kaleci special clearance:
            if (playerDisk.roleId === 1) {
              const isNearOwnGoal =
                playerDisk.teamIndex === 0
                  ? playerDisk.y > 630
                  : playerDisk.y < 190;
              eRest = isNearOwnGoal ? 1.25 : 1.1;
            }

            // 2 — Stoper block:
            if (playerDisk.roleId === 2) {
              eRest = 1.05;
            }

            // 5 — Ön libero & merkez:
            if (playerDisk.roleId === 5) {
              eRest = 0.78;
            }

            // 7 — Forvet:
            if (playerDisk.roleId === 7) {
              const inOffensiveHalf =
                playerDisk.teamIndex === 0
                  ? playerDisk.y < CENTER_Y
                  : playerDisk.y > CENTER_Y;
              if (inOffensiveHalf) {
                eRest = 1.15;
              }
            }
          }

          const q = -((1 + eRest) * vn) / im;
          a.vx -= (q * nx) / a.m;
          a.vy -= (q * ny) / a.m;
          b.vx += (q * nx) / b.m;
          b.vy += (q * ny) / b.m;
        }
      }
    }
  }

  // 4. Post-collision boundary clamp & goal verification for ALL disks (even if vx=0, vy=0)
  for (const o of disks) {
    const r = o.r;
    if (o.x < PITCH_LEFT + r) {
      o.x = PITCH_LEFT + r;
      if (o.vx < 0) o.vx = -o.vx * 0.5;
    } else if (o.x > PITCH_RIGHT - r) {
      o.x = PITCH_RIGHT - r;
      if (o.vx > 0) o.vx = -o.vx * 0.5;
    }

    if (o.ball && o.x > GOAL_LEFT + 2 && o.x < GOAL_RIGHT - 2) {
      if (o.y < PITCH_TOP) {
        goal = 1;
      } else if (o.y > PITCH_BOTTOM) {
        goal = 2;
      }
    } else {
      if (o.y < PITCH_TOP + r) {
        o.y = PITCH_TOP + r;
        if (o.vy < 0) o.vy = -o.vy * 0.5;
      } else if (o.y > PITCH_BOTTOM - r) {
        o.y = PITCH_BOTTOM - r;
        if (o.vy > 0) o.vy = -o.vy * 0.5;
      }
    }
  }

  return {
    goal,
    highestCollisionImpulse: highestImpulse,
    ballContactRoleId,
    ballContactTeam,
    ballContactPlayerIndex,
    postHit,
    endlineOut,
    sidelineHit,
  };
}

/**
 * Checks if any disk has active velocity above threshold.
 */
export function areDisksMoving(disks: Disk[], minSpeedSq = MIN_VELOCITY_SQ): boolean {
  return disks.some((o) => o.vx * o.vx + o.vy * o.vy > minSpeedSq);
}

export interface PassResult {
  isPass: boolean;
  receiverPlayerIndex?: number;
  receiverDiskIndex?: number;
  distance?: number;
  reason?:
    | 'success'
    | 'out_of_range'
    | 'intercepted_by_opponent'
    | 'no_ball'
    | 'not_captured'
    | 'wrong_touch_team'
    | 'shooter_not_in_radius'
    | 'wrong_angle'
    | 'out_of_bounds'
    | 'extra_shot_limit';
}

/**
 * Finds the closest player disk to the ball (optionally filtered by team).
 */
export function findClosestPlayerToBall(
  disks: Disk[],
  teamIndex?: number
): { diskIndex: number; playerIndex: number; teamIndex: number; distance: number } | null {
  const ball = disks[disks.length - 1];
  if (!ball || !ball.ball) return null;

  let minDist = Infinity;
  let bestDiskIdx = -1;
  let bestPlayerIdx = -1;
  let bestTeamIdx = -1;

  for (let i = 0; i < disks.length - 1; i++) {
    const d = disks[i];
    if (d.ball) continue;
    if (teamIndex !== undefined && d.teamIndex !== teamIndex) continue;

    const dist = Math.hypot(d.x - ball.x, d.y - ball.y);
    if (dist < minDist) {
      minDist = dist;
      bestDiskIdx = i;
      bestPlayerIdx = d.playerIndex ?? (i % PLAYERS_PER_TEAM);
      bestTeamIdx = d.teamIndex ?? 0;
    }
  }

  if (bestDiskIdx === -1) return null;
  return {
    diskIndex: bestDiskIdx,
    playerIndex: bestPlayerIdx,
    teamIndex: bestTeamIdx,
    distance: minDist,
  };
}

/**
 * Determines whether a player disk is within INTERACTION_RADIUS of the ball.
 * A player outside INTERACTION_RADIUS cannot initiate a pass, receive a pass,
 * control the ball, or earn an extra shot.
 */
export function canPlayerControlBall(
  playerDisk: Disk,
  ballDisk: Disk,
  controlRadius = INTERACTION_RADIUS
): boolean {
  if (!playerDisk || !ballDisk) return false;
  const dist = Math.hypot(playerDisk.x - ballDisk.x, playerDisk.y - ballDisk.y);
  return dist <= controlRadius;
}

export type TurnMode = 'FREE_CHOICE' | 'PASS_RECEIVER_ONLY';

/**
 * Checks whether a player on the active team can be selected to shoot based on turnMode.
 * - In 'FREE_CHOICE': Any player of the team can be chosen.
 * - In 'PASS_RECEIVER_ONLY': Only the designated receiver player (who must be within INTERACTION_RADIUS) can shoot!
 */
export function isPlayerSelectable(
  playerIndex: number,
  turnMode: TurnMode,
  passReceiverPlayerIndex: number | null,
  disks?: Disk[],
  activeTeam?: number
): boolean {
  if (turnMode === 'PASS_RECEIVER_ONLY') {
    if (passReceiverPlayerIndex === null || playerIndex !== passReceiverPlayerIndex) {
      return false;
    }
    if (disks && activeTeam !== undefined) {
      const receiverDisk = disks[activeTeam * PLAYERS_PER_TEAM + passReceiverPlayerIndex];
      const ball = disks[disks.length - 1];
      if (!receiverDisk || !ball || !canPlayerControlBall(receiverDisk, ball, INTERACTION_RADIUS)) {
        return false;
      }
    }
    return true;
  }
  return true;
}

/**
 * Calculates perpendicular distance from a point to a 2D line segment.
 */
export function distancePointToSegment(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x0, py - y0);
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lenSq));
  const projX = x0 + t * dx;
  const projY = y0 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/**
 * Finds a valid pass target teammate when aiming a flick.
 * Enforces:
 * 1. Shooter MUST be within INTERACTION_RADIUS of the ball.
 * 2. Teammate MUST be within PASS_MAX_DISTANCE of both the shooter and the ball.
 * 3. Teammate MUST be within the forward directional cone (dot >= PASS_DIRECTION_MIN_COS).
 * 4. Aim direction must also point towards the ball so the shooter will contact the ball.
 */
export function findValidPassTarget(
  disks: Disk[],
  activeTeam: number,
  shooterPlayerIndex: number,
  aimDirX: number,
  aimDirY: number,
  maxPassDistance = PASS_MAX_DISTANCE,
  interactionRadius = INTERACTION_RADIUS
): { playerIndex: number; diskIndex: number; distance: number } | null {
  const ball = disks[disks.length - 1];
  const teamOffset = activeTeam === 1 ? PLAYERS_PER_TEAM : 0;
  const shooterDisk = disks[teamOffset + shooterPlayerIndex];
  if (!ball || !shooterDisk) return null;

  // Rule 2: Shooter must be within INTERACTION_RADIUS of the ball to initiate a pass
  if (!canPlayerControlBall(shooterDisk, ball, interactionRadius)) {
    return null;
  }

  // Verify the shooter is aiming roughly towards the ball so it can strike the ball
  const toBallX = ball.x - shooterDisk.x;
  const toBallY = ball.y - shooterDisk.y;
  const toBallLen = Math.hypot(toBallX, toBallY);
  if (toBallLen > 1) {
    const ballDot = (aimDirX * toBallX + aimDirY * toBallY) / toBallLen;
    if (ballDot < 0.45) {
      return null;
    }
  }

  let bestTargetPlayerIdx = -1;
  let bestTargetDiskIdx = -1;
  let bestTargetDist = Infinity;
  let bestDot = PASS_DIRECTION_MIN_COS;

  for (let i = 0; i < PLAYERS_PER_TEAM; i++) {
    if (i === shooterPlayerIndex) continue;
    const diskIdx = teamOffset + i;
    const tm = disks[diskIdx];
    if (!tm) continue;

    const distFromBall = Math.hypot(tm.x - ball.x, tm.y - ball.y);
    const distFromShooter = Math.hypot(tm.x - shooterDisk.x, tm.y - shooterDisk.y);

    // Rule 3: Teammate must be strictly within PASS_MAX_DISTANCE
    if (
      distFromBall <= maxPassDistance &&
      distFromShooter <= maxPassDistance &&
      distFromBall > 22
    ) {
      // Check directional cone from ball/shooter towards teammate
      const vecX = tm.x - shooterDisk.x;
      const vecY = tm.y - shooterDisk.y;
      const vecLen = Math.hypot(vecX, vecY);
      if (vecLen < 1) continue;

      const dot = (aimDirX * vecX + aimDirY * vecY) / vecLen;
      if (dot >= bestDot) {
        bestDot = dot;
        bestTargetPlayerIdx = i;
        bestTargetDiskIdx = diskIdx;
        bestTargetDist = distFromBall;
      }
    }
  }

  if (bestTargetPlayerIdx === -1) return null;
  return {
    playerIndex: bestTargetPlayerIdx,
    diskIndex: bestTargetDiskIdx,
    distance: Math.round(bestTargetDist),
  };
}

/**
 * Evaluates whether a shot resulted in a successful pass to a teammate.
 * Enforces all strict rules:
 * 1. Only a player on activeTeam who was within INTERACTION_RADIUS and touched the ball can make a pass.
 * 2. lastTouchTeam must be activeTeam (opponent deflections/shots never trigger a pass for user).
 * 3. The receiving teammate must be within PASS_MAX_DISTANCE of the ball's starting point and within the directional cone.
 * 4. When the ball stops, the receiving teammate must be strictly within INTERACTION_RADIUS of the ball.
 * 5. No opponent can be closer to the ball than the receiving teammate.
 */
export function checkPassSuccess(
  disks: Disk[],
  activeTeam: number,
  shooterPlayerIndex: number,
  targetTeammateDiskIndex: number | null = null,
  didBallEnterCaptureArea = false,
  maxDistance = PASS_MAX_DISTANCE,
  captureRadius = PLAYER_CAPTURE_RADIUS,
  shotContext?: ShotTrackingContext
): PassResult {
  const ball = disks[disks.length - 1];
  if (!ball || !ball.ball) return { isPass: false, reason: 'no_ball' };

  // Legacy 4th-parameter overload check: in older unit tests, 4th arg was PASS_MAX_DISTANCE (> 30)
  let resolvedTargetDiskIdx = targetTeammateDiskIndex;
  let resolvedMaxDistance = maxDistance;
  if (typeof targetTeammateDiskIndex === 'number' && targetTeammateDiskIndex >= disks.length) {
    resolvedMaxDistance = targetTeammateDiskIndex;
    resolvedTargetDiskIdx = null;
  }

  // Enforce ShotTrackingContext rules when provided (live match & 59-match autotest)
  if (shotContext) {
    if (shotContext.extraShotAlreadyGranted) {
      return { isPass: false, reason: 'extra_shot_limit' };
    }
    if (shotContext.shotTeam !== activeTeam) {
      return { isPass: false, reason: 'wrong_touch_team' };
    }
    if (!shotContext.shooterWasInInteractionRadius || !shotContext.shooterTouchedBall) {
      return { isPass: false, reason: 'shooter_not_in_radius' };
    }
    if (shotContext.lastTouchTeam !== activeTeam) {
      return { isPass: false, reason: 'wrong_touch_team' };
    }
    if (shotContext.shotType === 'interception' || shotContext.shotType === 'clearance') {
      return { isPass: false, reason: 'wrong_touch_team' };
    }
    if (shotContext.endlineHit) {
      return { isPass: false, reason: 'out_of_bounds' };
    }
  }

  let closestTeammateDist = Infinity;
  let closestTeammatePlayerIdx = -1;
  let closestTeammateDiskIdx = -1;
  let closestOpponentDist = Infinity;

  for (let i = 0; i < disks.length - 1; i++) {
    const d = disks[i];
    if (d.ball) continue;
    const distToBallCenter = Math.hypot(d.x - ball.x, d.y - ball.y);

    if (d.teamIndex === activeTeam) {
      if (d.playerIndex !== shooterPlayerIndex) {
        if (distToBallCenter < closestTeammateDist) {
          closestTeammateDist = distToBallCenter;
          closestTeammatePlayerIdx = d.playerIndex ?? -1;
          closestTeammateDiskIdx = i;
        }
      }
    } else {
      if (distToBallCenter < closestOpponentDist) {
        closestOpponentDist = distToBallCenter;
      }
    }
  }

  const validateCandidateReceiver = (candDiskIdx: number): PassResult => {
    const receiver = disks[candDiskIdx];
    if (!receiver || receiver.teamIndex !== activeTeam || receiver.playerIndex === shooterPlayerIndex) {
      return { isPass: false, reason: 'not_captured' };
    }

    const distToBall = Math.hypot(receiver.x - ball.x, receiver.y - ball.y);
    const strictInteractionLimit = Math.min(
      INTERACTION_RADIUS,
      captureRadius + receiver.r + ball.r
    );

    // Rule 2: Receiver MUST be within INTERACTION_RADIUS of the ball when it stops!
    if (distToBall > strictInteractionLimit || distToBall > INTERACTION_RADIUS) {
      return {
        isPass: false,
        receiverPlayerIndex: receiver.playerIndex,
        distance: Math.round(distToBall),
        reason: 'not_captured',
      };
    }

    // Rule 3: Pass distance from ball origin (or shooter) must be <= PASS_MAX_DISTANCE
    if (shotContext) {
      const passOriginDist = Math.hypot(
        receiver.x - shotContext.ballStartX,
        receiver.y - shotContext.ballStartY
      );
      const ballTravelDist = Math.hypot(
        ball.x - shotContext.ballStartX,
        ball.y - shotContext.ballStartY
      );
      if (
        passOriginDist > resolvedMaxDistance ||
        ballTravelDist > resolvedMaxDistance ||
        ballTravelDist < 8
      ) {
        return {
          isPass: false,
          receiverPlayerIndex: receiver.playerIndex,
          distance: Math.round(passOriginDist),
          reason: 'out_of_range',
        };
      }

      // Rule 3: Receiver must be within the ball's movement angle cone
      const moveX = ball.x - shotContext.ballStartX;
      const moveY = ball.y - shotContext.ballStartY;
      const moveLen = Math.hypot(moveX, moveY);
      const toRecX = receiver.x - shotContext.ballStartX;
      const toRecY = receiver.y - shotContext.ballStartY;
      const toRecLen = Math.hypot(toRecX, toRecY);

      if (moveLen > 1 && toRecLen > 1) {
        const moveDot = (moveX * toRecX + moveY * toRecY) / (moveLen * toRecLen);
        const aimDot =
          (shotContext.aimDirX * toRecX + shotContext.aimDirY * toRecY) / toRecLen;
        if (moveDot < PASS_DIRECTION_MIN_COS || aimDot < PASS_DIRECTION_MIN_COS) {
          return {
            isPass: false,
            receiverPlayerIndex: receiver.playerIndex,
            distance: Math.round(passOriginDist),
            reason: 'wrong_angle',
          };
        }
      }
    } else if (distToBall > resolvedMaxDistance) {
      return {
        isPass: false,
        receiverPlayerIndex: receiver.playerIndex,
        distance: Math.round(distToBall),
        reason: 'out_of_range',
      };
    }

    // Opponent interception check
    if (closestOpponentDist <= distToBall) {
      return {
        isPass: false,
        receiverPlayerIndex: receiver.playerIndex,
        distance: Math.round(distToBall),
        reason: 'intercepted_by_opponent',
      };
    }

    return {
      isPass: true,
      receiverPlayerIndex: receiver.playerIndex,
      receiverDiskIndex: candDiskIdx,
      distance: Math.round(distToBall),
      reason: 'success',
    };
  };

  if (resolvedTargetDiskIdx !== null && disks[resolvedTargetDiskIdx]) {
    return validateCandidateReceiver(resolvedTargetDiskIdx);
  }

  if (closestTeammateDiskIdx !== -1) {
    return validateCandidateReceiver(closestTeammateDiskIdx);
  }

  return { isPass: false, reason: 'out_of_range' };
}

/**
 * Smoothly advances a defending player disk towards the ball or intercept point without teleporting.
 * Constrains the defender to valid pitch bounds.
 */
export function stepDefenderClosing(
  defender: Disk,
  targetX: number,
  targetY: number,
  speedPxSec: number,
  dt: number
): void {
  const dx = targetX - defender.x;
  const dy = targetY - defender.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 1.0) return;

  const moveDist = Math.min(dist, speedPxSec * dt);
  defender.x += (dx / dist) * moveDist;
  defender.y += (dy / dist) * moveDist;

  // Pitch constraints
  defender.x = Math.max(PITCH_LEFT + defender.r, Math.min(PITCH_RIGHT - defender.r, defender.x));
  defender.y = Math.max(PITCH_TOP + defender.r, Math.min(PITCH_BOTTOM - defender.r, defender.y));
}

/**
 * Checks if the defending player disk made physical contact with the moving ball (interception).
 */
export function checkDefenderInterception(defender: Disk, ball: Disk): boolean {
  if (!defender || !ball) return false;
  const dx = ball.x - defender.x;
  const dy = ball.y - defender.y;
  const dist = Math.hypot(dx, dy);
  return dist <= defender.r + ball.r + 2.0;
}

/**
 * Computes a dotted trajectory forecast showing simulated path with side wall reflections.
 */
export function calculateTrajectoryForecast(
  startX: number,
  startY: number,
  vx: number,
  vy: number,
  radius = 10,
  maxPoints = 14,
  dt = 0.025
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  let cx = startX;
  let cy = startY;
  let cvx = vx;
  let cvy = vy;

  for (let i = 0; i < maxPoints; i++) {
    cx += cvx * dt;
    cy += cvy * dt;
    cvx *= 0.96;
    cvy *= 0.96;

    // Pitch side wall bounce reflection
    if (cx < PITCH_LEFT + radius) {
      cx = PITCH_LEFT + radius;
      cvx = -cvx * 0.8;
    } else if (cx > PITCH_RIGHT - radius) {
      cx = PITCH_RIGHT - radius;
      cvx = -cvx * 0.8;
    }

    // Top/Bottom boundary limit
    if (cy < PITCH_TOP + radius) {
      cy = PITCH_TOP + radius;
      cvy = -cvy * 0.8;
    } else if (cy > PITCH_BOTTOM - radius) {
      cy = PITCH_BOTTOM - radius;
      cvy = -cvy * 0.8;
    }

    points.push({ x: cx, y: cy });
    if (cvx * cvx + cvy * cvy < 40) break;
  }

  return points;
}

/**
 * Calculates shot impulse based on pull length and player role.
 */
export function calculateShotPower(
  pullDistance: number,
  roleId: number,
  diskY: number,
  teamIndex: number
): number {
  const clampedPull = Math.min(pullDistance, MAX_PULL_DISTANCE);
  const baseImpulse = 80 + 820 * Math.pow(clampedPull / MAX_PULL_DISTANCE, 1.6);
  const role = ROLES.find((r) => r.id === roleId) || ROLES[4];

  let power = baseImpulse * role.powerMultiplier;

  // Role 7 (Forvet): Kaleye yakın şutlarda güç ve isabet bonusu
  if (roleId === 7) {
    const isAttackingThird =
      teamIndex === 0 ? diskY < 280 : diskY > PITCH_BOTTOM - 210;
    if (isAttackingThird) {
      power *= 1.2;
    }
  }

  // Role 6 (On Numara): Technique finesse bonus
  if (roleId === 6) {
    power *= 1.05;
  }

  return power;
}

/**
 * Formats time in seconds to mm:ss format.
 */
export function formatTimeMMSS(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Converts real match seconds to simulated football match minute (0' to 90'+).
 */
export function formatFootballMatchMinute(
  remainingSeconds: number,
  totalSeconds = MATCH_DURATION_SECONDS,
  isExtraTime = false
): string {
  if (isExtraTime) {
    return 'Uzatma (Altın Gol)';
  }
  const elapsed = Math.max(0, totalSeconds - remainingSeconds);
  const minute = Math.min(90, Math.ceil((elapsed / totalSeconds) * 90));
  if (minute >= 90 && remainingSeconds <= 0) {
    return "90'+";
  }
  return `${Math.max(1, minute)}'`;
}

/**
 * Evaluates match end conditions.
 */
export function checkMatchEnd(
  remainingSeconds: number,
  scoreA: number,
  scoreB: number,
  isKnockout: boolean,
  isExtraTime: boolean
): { finished: boolean; startExtraTime: boolean; startPenalties: boolean } {
  if (remainingSeconds > 0) {
    return { finished: false, startExtraTime: false, startPenalties: false };
  }

  const isTied = scoreA === scoreB;

  if (!isKnockout) {
    return { finished: true, startExtraTime: false, startPenalties: false };
  }

  if (!isTied) {
    return { finished: true, startExtraTime: false, startPenalties: false };
  }

  if (!isExtraTime) {
    return { finished: false, startExtraTime: true, startPenalties: false };
  } else {
    return { finished: false, startExtraTime: false, startPenalties: true };
  }
}

/**
 * Evaluates whether the 10-second shot clock has expired.
 */
export function checkTurnTimeout(
  turnTimer: number,
  phase: string
): boolean {
  if (phase !== 'aim' && phase !== 'bot_thinking' && phase !== 'bot_aiming') {
    return false;
  }
  return turnTimer <= 0;
}

/**
 * Simulates a full penalty shootout between two teams (for knockout ties in AI simulation or fallback).
 * Guaranteed to finish with non-equal penalty scores.
 */
export function simulatePenaltyShootout(teamARating = 80, teamBRating = 80): [number, number] {
  let scoreA = 0;
  let scoreB = 0;
  const probA = Math.min(0.85, Math.max(0.55, 0.72 + (teamARating - teamBRating) * 0.005));
  const probB = Math.min(0.85, Math.max(0.55, 0.72 + (teamBRating - teamARating) * 0.005));

  for (let round = 0; round < 5; round++) {
    if (Math.random() < probA) scoreA++;
    const remA = 4 - round;
    const remB = 5 - round;
    if (scoreA > scoreB + remB || scoreB > scoreA + remA) break;

    if (Math.random() < probB) scoreB++;
    const remAfterB = 4 - round;
    if (scoreA > scoreB + remAfterB || scoreB > scoreA + remAfterB) break;
  }

  let suddenDeathSafety = 0;
  while (scoreA === scoreB && suddenDeathSafety < 25) {
    suddenDeathSafety++;
    const goalA = Math.random() < probA;
    const goalB = Math.random() < probB;
    if (goalA !== goalB) {
      if (goalA) scoreA++;
      else scoreB++;
    } else if (suddenDeathSafety === 25) {
      if (teamARating >= teamBRating) scoreA++;
      else scoreB++;
    }
  }

  return [scoreA, scoreB];
}
