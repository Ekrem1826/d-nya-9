/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  PITCH_LEFT,
  PITCH_TOP,
  PITCH_RIGHT,
  PITCH_BOTTOM,
  CENTER_X,
  CENTER_Y,
  GOAL_LEFT,
  GOAL_RIGHT,
  PHYSICS_DT,
  MAX_SUBSTEPS,
  MAX_PULL_DISTANCE,
  MATCH_DURATION_SECONDS,
  EXTRA_TIME_SECONDS,
  ROLES,
  FORMATIONS,
  PLAYERS_PER_TEAM,
  INTERACTION_RADIUS,
  PASS_MAX_DISTANCE,
  DEFENDER_CHASE_SPEEDS,
  Team,
  PlayerRole,
  PLAYER_CAPTURE_RADIUS,
  SHOT_CLOCK_SECONDS,
} from '../game/constants.ts';
import {
  Disk,
  ShotActionType,
  ShotTrackingContext,
  resetDisks,
  physicsStep,
  areDisksMoving,
  calculateShotPower,
  formatTimeMMSS,
  formatFootballMatchMinute,
  checkMatchEnd,
  checkPassSuccess,
  findClosestPlayerToBall,
  findValidPassTarget,
  canPlayerControlBall,
  TurnMode,
  isPlayerSelectable,
  distancePointToSegment,
  stepDefenderClosing,
  checkDefenderInterception,
  calculateTrajectoryForecast,
  checkTurnTimeout,
} from '../game/rules.ts';
import {
  CommentaryController,
  CommentaryEntry,
  CommentaryEventType,
  CommentaryContext,
} from '../game/commentary.ts';
import { computeAIDecision, run59MatchAutotest } from '../game/autotest.ts';
import { sound } from '../game/sound.ts';
import { haptics } from '../game/haptics.ts';
import { subscribeSettings } from '../game/settings.ts';
import { TacticsModal } from './TacticsModal.tsx';
import { PauseModal } from './PauseModal.tsx';
import { TeamFlag } from './TeamFlag.tsx';
import { Volume2, VolumeX, Pause, Play, Info, Trophy, Activity, Bug, Radio, Timer } from 'lucide-react';

interface PitchCanvasProps {
  teamA: Team; // User's team (or Player 1)
  teamB: Team; // Opponent's team (or Player 2)
  isKnockout: boolean;
  roundLabel: string;
  difficulty: number; // 0: Easy, 1: Normal, 2: Hard
  initialUserFormationId?: string;
  isTwoPlayer?: boolean;
  onMatchFinish: (result: { scoreA: number; scoreB: number; penalties?: [number, number] }) => void;
  onQuitToTournament: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  rotSpeed: number;
  life: number;
  color: string;
}

export const PitchCanvas: React.FC<PitchCanvasProps> = ({
  teamA,
  teamB,
  isKnockout,
  roundLabel,
  difficulty,
  initialUserFormationId = 'classic',
  isTwoPlayer = false,
  onMatchFinish,
  onQuitToTournament,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastSecRef = useRef<number>(MATCH_DURATION_SECONDS);

  // Formations
  const [userFormationId] = useState<string>(initialUserFormationId);
  const botFormationId = teamB.preferredFormationId || 'classic';

  const userFormation = FORMATIONS.find((f) => f.id === userFormationId) || FORMATIONS[0];
  const botFormation = FORMATIONS.find((f) => f.id === botFormationId) || FORMATIONS[0];

  // Match states
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(MATCH_DURATION_SECONDS);
  const [isExtraTime, setIsExtraTime] = useState<boolean>(false);
  const [currentTurn, setCurrentTurn] = useState<number>(0); // 0: User, 1: Bot
  const [selectedPlayerIndex, setSelectedPlayerIndex] = useState<number>(6); // default to Forvet (idx 6)
  const [statusMessage, setStatusMessage] = useState<string>('Sıra sende. Oyuncunu çek ve fırlat!');
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(sound.isMuted);
  const [showTacticsModal, setShowTacticsModal] = useState<boolean>(false);
  const [turnMode, setTurnMode] = useState<TurnMode>('FREE_CHOICE');
  const [passReceiverPlayerIndex, setPassReceiverPlayerIndex] = useState<number | null>(null);
  const [turnTimerDisplay, setTurnTimerDisplay] = useState<number>(SHOT_CLOCK_SECONDS);
  const lastTurnTimerSecRef = useRef<number>(SHOT_CLOCK_SECONDS);
  const [goalBanner, setGoalBanner] = useState<string | null>(null);
  const [passBanner, setPassBanner] = useState<{
    text: string;
    type?: 'pass' | 'turnover' | 'shot' | 'alert' | 'goal';
  } | null>(null);

  // Rich Turkish commentary controller & last 3 commentary entries
  const commentaryControllerRef = useRef<CommentaryController>(
    new CommentaryController(teamA.n, teamB.n)
  );
  const [commentaryHistory, setCommentaryHistory] = useState<CommentaryEntry[]>(() =>
    commentaryControllerRef.current.getHistory()
  );

  // Diagnostic Mode state & refs
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [diagnosticData, setDiagnosticData] = useState<{
    fps: number;
    frameDeltaMs: number;
    rAFRunning: boolean;
    rAFCount: number;
    substepsThisFrame: number;
    physicsAccumulatorMs: number;
    ballPos: { x: number; y: number };
    ballSpeed: number;
    phase: string;
    turn: number;
    lastError: string | null;
    heartbeatTicks: number;
  }>({
    fps: 60,
    frameDeltaMs: 16.6,
    rAFRunning: true,
    rAFCount: 0,
    substepsThisFrame: 0,
    physicsAccumulatorMs: 0,
    ballPos: { x: CENTER_X, y: CENTER_Y },
    ballSpeed: 0,
    phase: 'aim',
    turn: 0,
    lastError: null,
    heartbeatTicks: 0,
  });

  const physicsAccumulatorRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(performance.now());
  const rAFCountRef = useRef<number>(0);
  const animIdRef = useRef<number>(0);
  const lastHeartbeatTimeRef = useRef<number>(performance.now());
  const heartbeatTicksRef = useRef<number>(0);
  const fpsSmoothingRef = useRef<number>(60);
  const lastDiagSyncRef = useRef<number>(0);
  const lastErrorRef = useRef<string | null>(null);
  const isRafActiveRef = useRef<boolean>(true);

  // Penalty shootout state
  const [penaltyState, setPenaltyState] = useState<{
    active: boolean;
    scores: [number, number];
    history: [number[], number[]];
    isUserTurn: boolean;
    message: string;
    isFinished: boolean;
  } | null>(null);

  // Contrasting kit colors calculation
  const getContrastingTeamColors = () => {
    const parseRgb = (hex: string) => [
      parseInt(hex.slice(1, 3), 16) || 0,
      parseInt(hex.slice(3, 5), 16) || 0,
      parseInt(hex.slice(5, 7), 16) || 0,
    ];
    const c1 = parseRgb(teamA.c);
    const c2 = parseRgb(teamB.c);
    const dist = Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]);

    if (dist < 130) {
      const awayOptions = ['#ffffff', '#2563eb', '#f59e0b', '#18181b'];
      for (const opt of awayOptions) {
        const co = parseRgb(opt);
        if (Math.hypot(c1[0] - co[0], c1[1] - co[1], c1[2] - co[2]) > 140) {
          return { colorA: teamA.c, colorB: opt };
        }
      }
    }
    return { colorA: teamA.c, colorB: teamB.c };
  };

  const { colorA, colorB } = getContrastingTeamColors();
  const activeRole: PlayerRole = ROLES[selectedPlayerIndex] || ROLES[0];

  // Authoritative match state ref
  const gameStateRef = useRef({
    disks: resetDisks(userFormation.positions, botFormation.positions),
    phase: 'aim' as 'aim' | 'move' | 'bot_thinking' | 'bot_aiming' | 'goal_pause' | 'end',
    turn: 0,
    turnMode: 'FREE_CHOICE' as TurnMode,
    passReceiverPlayerIndex: null as number | null,
    remainingActionsInTurn: 1, // Single centralized turn/attempt counter
    extraShotGrantedThisTurn: false,
    shotResolved: true,
    activeShotContext: null as ShotTrackingContext | null,
    lastAimTargetTeammateDiskIdx: -1,
    ballEnteredTargetCaptureZone: false,
    moveElapsedSeconds: 0,
    waitTimer: 0,
    turnTimer: SHOT_CLOCK_SECONDS,
    selectedPlayer: 6,
    lastShooterPlayer: 6,
    lastShootingTeam: 0,
    remainingSeconds: MATCH_DURATION_SECONDS,
    isExtraTime: false,
    halfTimeAnnounced: false,
    lastMinuteAnnounced: false,
    score: [0, 0] as [number, number],
    isPaused: false,
    particles: [] as Particle[],
    shake: 0,
    passHighlightIndex: -1,
    closingDefenderIdx: -1,
    passTargetTeammateIdx: -1,
    botAim: null as {
      diskIdx: number;
      vx: number;
      vy: number;
      powerRatio: number;
      angle: number;
      timer: number;
      targetTeammateIdx?: number;
      shotType?: ShotActionType;
      trajPoints?: { x: number; y: number }[];
    } | null,
    possessionPulse: null as {
      diskIdx: number;
      timer: number;
      color: string;
    } | null,
    tacticalHint: null as string | null,
    drag: null as {
      playerIdx: number;
      startX: number;
      startY: number;
      currX: number;
      currY: number;
    } | null,
  });

  // Dev-only ?autotest=1 runner (completely disabled in production builds)
  useEffect(() => {
    if (!import.meta.env.PROD && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('autotest') === '1') {
        const report = run59MatchAutotest(true);
        (window as unknown as Record<string, unknown>).__AUTOTEST_REPORT__ = report;
      }
    }
  }, []);

  // Pre-bake static stadium background once to an offscreen canvas
  const bakeBackground = useCallback(() => {
    const bg = document.createElement('canvas');
    bg.width = WORLD_WIDTH;
    bg.height = WORLD_HEIGHT;
    const ctx = bg.getContext('2d');
    if (!ctx) return;

    // 1. Stadium background
    ctx.fillStyle = '#0a100d';
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // 2. Spectator stands (Tribünler)
    const drawStands = (startX: number, width: number) => {
      ctx.fillStyle = '#111a14';
      ctx.fillRect(startX, 0, width, WORLD_HEIGHT);

      ctx.strokeStyle = '#1b261e';
      ctx.lineWidth = 1;
      for (let y = 0; y < WORLD_HEIGHT; y += 14) {
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(startX + width, y);
        ctx.stroke();
      }

      const fanColors = [colorA, colorB, '#ffffff', '#e2e8f0', '#3b82f6', '#ef4444', '#f59e0b'];
      for (let y = 10; y < WORLD_HEIGHT - 10; y += 14) {
        for (let col = 0; col < 4; col++) {
          const cx = startX + 6 + col * 9;
          const color = fanColors[Math.floor(y * 3 + col * 7) % fanColors.length];
          ctx.beginPath();
          ctx.arc(cx, y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
      }
    };

    drawStands(0, PITCH_LEFT - 4);
    drawStands(PITCH_RIGHT + 4, WORLD_WIDTH - PITCH_RIGHT - 4);

    // 3. Turf and mower grass stripes
    ctx.fillStyle = '#164024';
    ctx.fillRect(PITCH_LEFT, PITCH_TOP, PITCH_RIGHT - PITCH_LEFT, PITCH_BOTTOM - PITCH_TOP);

    const stripeHeight = (PITCH_BOTTOM - PITCH_TOP) / 10;
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#1b4d2c' : '#215c35';
      ctx.fillRect(PITCH_LEFT, PITCH_TOP + i * stripeHeight, PITCH_RIGHT - PITCH_LEFT, stripeHeight);
    }

    // Outer boundary line
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3.5;
    ctx.strokeRect(PITCH_LEFT, PITCH_TOP, PITCH_RIGHT - PITCH_LEFT, PITCH_BOTTOM - PITCH_TOP);

    // Halfway line & center circle
    ctx.beginPath();
    ctx.moveTo(PITCH_LEFT, CENTER_Y);
    ctx.lineTo(PITCH_RIGHT, CENTER_Y);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(CENTER_X, CENTER_Y, 50, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(CENTER_X, CENTER_Y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Corner arcs
    const cornerR = 14;
    ctx.beginPath();
    ctx.arc(PITCH_LEFT, PITCH_TOP, cornerR, 0, Math.PI / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(PITCH_RIGHT, PITCH_TOP, cornerR, Math.PI / 2, Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(PITCH_LEFT, PITCH_BOTTOM, cornerR, Math.PI * 1.5, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(PITCH_RIGHT, PITCH_BOTTOM, cornerR, Math.PI, Math.PI * 1.5);
    ctx.stroke();

    // Penalty boxes
    const boxW = 210;
    const boxH = 70;
    ctx.strokeRect(CENTER_X - boxW / 2, PITCH_TOP, boxW, boxH);
    ctx.strokeRect(CENTER_X - boxW / 2, PITCH_BOTTOM - boxH, boxW, boxH);

    // Small boxes
    const smallBoxW = 110;
    const smallBoxH = 26;
    ctx.strokeRect(CENTER_X - smallBoxW / 2, PITCH_TOP, smallBoxW, smallBoxH);
    ctx.strokeRect(CENTER_X - smallBoxW / 2, PITCH_BOTTOM - smallBoxH, smallBoxW, smallBoxH);

    // Arcs
    ctx.beginPath();
    ctx.arc(CENTER_X, PITCH_TOP + boxH, 36, 0, Math.PI);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(CENTER_X, PITCH_BOTTOM - boxH, 36, Math.PI, Math.PI * 2);
    ctx.stroke();

    // Goal nets
    const drawNet = (yPos: number, isTop: boolean, kitColor: string) => {
      const netHeight = 44;
      const yStart = isTop ? yPos - netHeight : yPos;

      ctx.fillStyle = 'rgba(10, 10, 10, 0.65)';
      ctx.fillRect(GOAL_LEFT, yStart, GOAL_RIGHT - GOAL_LEFT, netHeight);

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.strokeRect(GOAL_LEFT, yStart, GOAL_RIGHT - GOAL_LEFT, netHeight);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = GOAL_LEFT; x <= GOAL_RIGHT; x += 10) {
        ctx.moveTo(x, yStart);
        ctx.lineTo(x, yStart + netHeight);
      }
      for (let y = yStart; y <= yStart + netHeight; y += 8) {
        ctx.moveTo(GOAL_LEFT, y);
        ctx.lineTo(GOAL_RIGHT, y);
      }
      ctx.stroke();

      ctx.strokeStyle = kitColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(GOAL_LEFT, yPos);
      ctx.lineTo(GOAL_RIGHT, yPos);
      ctx.stroke();
    };

    drawNet(PITCH_TOP, true, colorB);
    drawNet(PITCH_BOTTOM, false, colorA);

    // 4. Stadium Floodlights
    const floodlights = [
      [PITCH_LEFT - 12, PITCH_TOP - 12],
      [PITCH_RIGHT + 12, PITCH_TOP - 12],
      [PITCH_LEFT - 12, PITCH_BOTTOM + 12],
      [PITCH_RIGHT + 12, PITCH_BOTTOM + 12],
    ];

    floodlights.forEach(([fx, fy]) => {
      const lightGrad = ctx.createRadialGradient(fx, fy, 4, fx, fy, 280);
      lightGrad.addColorStop(0, 'rgba(255, 250, 220, 0.28)');
      lightGrad.addColorStop(0.5, 'rgba(255, 250, 220, 0.08)');
      lightGrad.addColorStop(1, 'rgba(255, 250, 220, 0)');

      ctx.fillStyle = lightGrad;
      ctx.beginPath();
      ctx.arc(fx, fy, 280, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.arc(fx, fy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    bgCanvasRef.current = bg;
  }, [colorA, colorB]);

  useEffect(() => {
    bakeBackground();
  }, [bakeBackground]);

  // Sync mute state with settings changes and support Escape/P pause key
  useEffect(() => {
    const unsub = subscribeSettings((s) => {
      setIsMuted(!s.soundEnabled);
    });
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        setIsPaused((prev) => {
          const next = !prev;
          gameStateRef.current.isPaused = next;
          lastTimeRef.current = performance.now();
          lastHeartbeatTimeRef.current = performance.now();
          physicsAccumulatorRef.current = 0;
          document.body.dataset.state = next ? 'paused' : 'playing';
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      unsub();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const lastToastTextRef = useRef<string>('');
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Compact top-corner status badge (Requirement 4):
   * Small, semi-transparent, only shown when state changes, disappears after 1.4s.
   */
  const triggerToast = useCallback(
    (text: string, type: 'pass' | 'turnover' | 'shot' | 'alert' | 'goal' = 'pass') => {
      if (lastToastTextRef.current === text) return;
      lastToastTextRef.current = text;
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      setPassBanner({ text, type });
      toastTimeoutRef.current = setTimeout(() => {
        setPassBanner(null);
        lastToastTextRef.current = '';
      }, 1400);
    },
    []
  );

  const emitCommentary = useCallback((type: CommentaryEventType, ctx: CommentaryContext = {}) => {
    const g = gameStateRef.current;
    const minute =
      ctx.minute ||
      formatFootballMatchMinute(g.remainingSeconds, MATCH_DURATION_SECONDS, g.isExtraTime);
    commentaryControllerRef.current.emitImmediate(type, {
      scoreA: g.score[0],
      scoreB: g.score[1],
      ...ctx,
      minute,
    });
    setCommentaryHistory([...commentaryControllerRef.current.getHistory()]);
  }, []);

  const queueTurnCommentary = useCallback((type: CommentaryEventType, ctx: CommentaryContext = {}) => {
    const g = gameStateRef.current;
    const minute =
      ctx.minute ||
      formatFootballMatchMinute(g.remainingSeconds, MATCH_DURATION_SECONDS, g.isExtraTime);
    commentaryControllerRef.current.queueTurnEvent(type, {
      scoreA: g.score[0],
      scoreB: g.score[1],
      ...ctx,
      minute,
    });
  }, []);

  const flushTurnCommentary = useCallback(
    (fallbackType?: CommentaryEventType, fallbackCtx?: CommentaryContext) => {
      const g = gameStateRef.current;
      const minute = formatFootballMatchMinute(
        g.remainingSeconds,
        MATCH_DURATION_SECONDS,
        g.isExtraTime
      );
      const entry = commentaryControllerRef.current.flushPendingTurnEvent(
        fallbackType,
        fallbackCtx ? { scoreA: g.score[0], scoreB: g.score[1], minute, ...fallbackCtx } : undefined
      );
      if (entry) {
        setCommentaryHistory([...commentaryControllerRef.current.getHistory()]);
      }
    },
    []
  );

  /**
   * Centralized turn / attempt / extra-shot state manager (Requirement 2).
   * Resets all shot and selection invariants in a single authoritative place.
   */
  const applyTurnTransition = useCallback(
    (
      nextTeam: number,
      mode: TurnMode,
      receiverPlayerIdx: number | null,
      customStatus?: string
    ) => {
      const g = gameStateRef.current;
      g.turn = nextTeam;
      setCurrentTurn(nextTeam);
      g.turnMode = mode;
      setTurnMode(mode);
      g.passReceiverPlayerIndex = mode === 'PASS_RECEIVER_ONLY' ? receiverPlayerIdx : null;
      setPassReceiverPlayerIndex(mode === 'PASS_RECEIVER_ONLY' ? receiverPlayerIdx : null);

      // Single centralized turn/attempt counter reset
      g.remainingActionsInTurn = 1;
      g.extraShotGrantedThisTurn = mode === 'PASS_RECEIVER_ONLY';
      g.shotResolved = true;
      g.activeShotContext = null;
      g.drag = null;
      g.botAim = null;
      g.passTargetTeammateIdx = -1;
      g.lastAimTargetTeammateDiskIdx = -1;
      g.ballEnteredTargetCaptureZone = false;
      g.closingDefenderIdx = -1;
      g.moveElapsedSeconds = 0;
      g.turnTimer = SHOT_CLOCK_SECONDS;
      lastTurnTimerSecRef.current = SHOT_CLOCK_SECONDS;
      setTurnTimerDisplay(SHOT_CLOCK_SECONDS);

      const closest = findClosestPlayerToBall(g.disks, nextTeam);
      const chosenPlayerIdx =
        mode === 'PASS_RECEIVER_ONLY' && receiverPlayerIdx !== null
          ? receiverPlayerIdx
          : closest
          ? closest.playerIndex
          : 6;

      g.selectedPlayer = chosenPlayerIdx;
      setSelectedPlayerIndex(chosenPlayerIdx);

      const isHuman = nextTeam === 0 || isTwoPlayer;
      if (isHuman) {
        g.phase = 'aim';
        if (closest) {
          g.possessionPulse = {
            diskIdx:
              mode === 'PASS_RECEIVER_ONLY' && receiverPlayerIdx !== null
                ? nextTeam * PLAYERS_PER_TEAM + receiverPlayerIdx
                : closest.diskIndex,
            timer: 1.4,
            color: mode === 'PASS_RECEIVER_ONLY' ? '#22c55e' : nextTeam === 0 ? '#38bdf8' : '#f59e0b',
          };
        }
        if (customStatus) {
          setStatusMessage(customStatus);
        } else if (mode === 'PASS_RECEIVER_ONLY') {
          setStatusMessage('Pas tamamlandı! Sıra pası alan oyuncuda.');
        } else {
          setStatusMessage(
            isTwoPlayer
              ? `Sıra ${nextTeam === 0 ? `1. Oyuncu (${teamA.n})` : `2. Oyuncu (${teamB.n})`}'da.`
              : 'Sıra sende. İstediğin oyuncuyu seç ve fırlat!'
          );
        }
      } else {
        g.phase = 'bot_thinking';
        g.waitTimer = difficulty === 0 ? 0.72 : difficulty === 1 ? 0.52 : 0.38;
        if (closest) {
          g.possessionPulse = {
            diskIdx:
              mode === 'PASS_RECEIVER_ONLY' && receiverPlayerIdx !== null
                ? PLAYERS_PER_TEAM + receiverPlayerIdx
                : closest.diskIndex,
            timer: 1.4,
            color: '#f59e0b',
          };
        }
        setStatusMessage(customStatus || `${teamB.n} hamle hazırlığında...`);
      }
    },
    [difficulty, isTwoPlayer, teamA.n, teamB.n]
  );

  // Kickoff setup with 7 players per team
  useEffect(() => {
    sound.playWhistle();
    const g = gameStateRef.current;
    g.disks = resetDisks(userFormation.positions, botFormation.positions);
    g.remainingSeconds = MATCH_DURATION_SECONDS;
    g.isExtraTime = false;
    g.halfTimeAnnounced = false;
    g.lastMinuteAnnounced = false;
    g.score = [0, 0];
    setScore([0, 0]);
    setRemainingSeconds(MATCH_DURATION_SECONDS);
    setIsExtraTime(false);

    commentaryControllerRef.current = new CommentaryController(teamA.n, teamB.n);
    setCommentaryHistory([...commentaryControllerRef.current.getHistory()]);

    const startingTurn = Math.random() < 0.5 ? 0 : 1;
    applyTurnTransition(startingTurn, 'FREE_CHOICE', null);
  }, [teamA, teamB, userFormation, botFormation, isTwoPlayer, applyTurnTransition]);

  // Main 60-120 FPS animation, fixed-timestep physics, and Android WebView watchdog
  useEffect(() => {
    lastTimeRef.current = performance.now();
    lastHeartbeatTimeRef.current = performance.now();
    physicsAccumulatorRef.current = 0;
    isRafActiveRef.current = true;

    const handleVisibilityChange = () => {
      const now = performance.now();
      lastTimeRef.current = now;
      lastHeartbeatTimeRef.current = now;
      physicsAccumulatorRef.current = 0;
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);

    const handleError = (e: ErrorEvent) => {
      lastErrorRef.current = `${e.message} (${e.filename}:${e.lineno})`;
    };
    const handleRejection = (e: PromiseRejectionEvent) => {
      lastErrorRef.current = `Promise: ${String(e.reason)}`;
    };
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    const evaluateMatchClockEnd = (): boolean => {
      const g = gameStateRef.current;
      if (g.remainingSeconds > 0 || g.phase === 'move' || g.phase === 'goal_pause' || g.phase === 'end') {
        return false;
      }
      if (areDisksMoving(g.disks)) {
        return false;
      }

      const matchCheck = checkMatchEnd(
        g.remainingSeconds,
        g.score[0],
        g.score[1],
        isKnockout,
        g.isExtraTime
      );

      if (matchCheck.startExtraTime) {
        sound.playWhistle();
        g.isExtraTime = true;
        setIsExtraTime(true);
        g.remainingSeconds = EXTRA_TIME_SECONDS;
        setRemainingSeconds(EXTRA_TIME_SECONDS);
        emitCommentary('extra_time', {
          teamName: teamA.n,
          opponentName: teamB.n,
          minute: 'Uzatma',
        });
        applyTurnTransition(
          g.turn,
          'FREE_CHOICE',
          null,
          '⚡ Uzatma Devresi: Altın Gol! İlk atan kazanır.'
        );
        return true;
      } else if (matchCheck.startPenalties) {
        sound.playWhistle();
        g.phase = 'end';
        triggerPenaltyShootout();
        return true;
      } else if (matchCheck.finished) {
        sound.playWhistle();
        haptics.vibrateMatchEnd();
        g.phase = 'end';
        emitCommentary('match_end', {
          teamName: teamA.n,
          opponentName: teamB.n,
          minute: "90'+",
        });
        setStatusMessage('Maç sona erdi!');
        setTimeout(() => {
          onMatchFinish({ scoreA: g.score[0], scoreB: g.score[1] });
        }, 1800);
        return true;
      }
      return false;
    };

    const tickFrame = (nowTime: number) => {
      try {
        const rawDelta = (nowTime - lastTimeRef.current) / 1000;
        lastTimeRef.current = nowTime;
        lastHeartbeatTimeRef.current = nowTime;
        rAFCountRef.current++;

        const dt = Math.max(0, Math.min(rawDelta, 0.1));

        if (rawDelta > 0.001) {
          const instantFps = 1 / rawDelta;
          fpsSmoothingRef.current = fpsSmoothingRef.current * 0.92 + instantFps * 0.08;
        }

        const g = gameStateRef.current;

        if (g.isPaused || penaltyState?.active || document.hidden) {
          drawCanvas();
          return;
        }

        if (g.possessionPulse) {
          g.possessionPulse.timer -= dt;
          if (g.possessionPulse.timer <= 0) {
            g.possessionPulse = null;
          }
        }

        // Decrement match clock (3 minutes)
        if (
          g.phase === 'aim' ||
          g.phase === 'move' ||
          g.phase === 'bot_thinking' ||
          g.phase === 'bot_aiming'
        ) {
          g.remainingSeconds = Math.max(0, g.remainingSeconds - dt);

          const secInt = Math.ceil(g.remainingSeconds);
          if (secInt !== lastSecRef.current) {
            lastSecRef.current = secInt;
            setRemainingSeconds(secInt);
          }

          if (!g.isExtraTime && !g.halfTimeAnnounced && g.remainingSeconds <= MATCH_DURATION_SECONDS / 2) {
            g.halfTimeAnnounced = true;
            emitCommentary('half_time', {
              teamName: teamA.n,
              opponentName: teamB.n,
              minute: "45'",
            });
          }

          if (!g.isExtraTime && !g.lastMinuteAnnounced && g.remainingSeconds <= 20) {
            g.lastMinuteAnnounced = true;
            emitCommentary('last_minute', {
              teamName: teamA.n,
              opponentName: teamB.n,
            });
          }

          // Check match end across ANY non-moving turn phase
          if (g.remainingSeconds <= 0 && g.phase !== 'move') {
            if (evaluateMatchClockEnd()) {
              drawCanvas();
              return;
            }
          }
        }

        // 10-Second Shot Clock Rule
        if (g.phase === 'aim' || g.phase === 'bot_thinking' || g.phase === 'bot_aiming') {
          g.turnTimer = Math.max(0, g.turnTimer - dt);

          const timerSecInt = Math.ceil(g.turnTimer);
          if (timerSecInt !== lastTurnTimerSecRef.current) {
            lastTurnTimerSecRef.current = timerSecInt;
            setTurnTimerDisplay(timerSecInt);
          }

          if (checkTurnTimeout(g.turnTimer, g.phase)) {
            sound.playWhistle();
            const timedOutTeam = g.turn;
            const nextTeam = timedOutTeam === 0 ? 1 : 0;
            const timedOutName = timedOutTeam === 0 ? teamA.n : teamB.n;
            const nextTeamName = nextTeam === 0 ? teamA.n : teamB.n;

            emitCommentary('timeout', {
              teamName: timedOutName,
              opponentName: nextTeamName,
            });
            triggerToast(
              nextTeam === 0 ? 'Süre doldu · Sıra sende' : `Süre doldu · Top ${teamB.n}'da`,
              nextTeam === 0 ? 'pass' : 'turnover'
            );
            applyTurnTransition(
              nextTeam,
              'FREE_CHOICE',
              null,
              nextTeam === 0
                ? 'Rakibin süresi doldu! Sıra sende.'
                : `10 sn doldu! ${teamB.n} sırayı devraldı.`
            );
          }
        }

        // Dynamic Tactical Insights
        if (g.phase === 'aim' && (g.turn === 0 || isTwoPlayer)) {
          const teamOffset = g.turn === 1 ? PLAYERS_PER_TEAM : 0;
          const userDisk = g.disks[teamOffset + g.selectedPlayer];
          const ball = g.disks[g.disks.length - 1];
          if (userDisk && ball) {
            const inControlRange = canPlayerControlBall(userDisk, ball, INTERACTION_RADIUS);
            const closestOpponent = findClosestPlayerToBall(g.disks, 1 - g.turn);
            if (!inControlRange) {
              g.tacticalHint = '🎯 Topa yaklaş veya vuruş açısı kur';
            } else if (closestOpponent && closestOpponent.distance < 85) {
              g.tacticalHint = '⚠️ Rakip yaklaşıyor! Hızlı oyna.';
            } else if ((g.turn === 0 && userDisk.y < 310) || (g.turn === 1 && userDisk.y > 510)) {
              g.tacticalHint = '🎯 Şut fırsatı! Kaleyi dene.';
            } else {
              g.tacticalHint = '💡 Kısa pas veya şut açısı hazır.';
            }
          }
        } else {
          g.tacticalHint = null;
        }

        // Fixed-timestep physics loop
        let substepsThisFrame = 0;

        if (g.phase === 'move') {
          g.moveElapsedSeconds += dt;
          physicsAccumulatorRef.current += dt;
          let goalDetected = 0;

          const ball = g.disks[g.disks.length - 1];
          const ballSpeed = ball ? Math.hypot(ball.vx, ball.vy) : 0;

          // Closing defender pursuit towards moving ball
          if (g.closingDefenderIdx >= 0 && g.disks[g.closingDefenderIdx] && ball && ballSpeed > 30) {
            const defDisk = g.disks[g.closingDefenderIdx];
            const chaseSpeed = DEFENDER_CHASE_SPEEDS[Math.min(2, Math.max(0, difficulty))];
            stepDefenderClosing(defDisk, ball.x, ball.y, chaseSpeed, dt);

            if (checkDefenderInterception(defDisk, ball)) {
              sound.playCollision(135);
              ball.vx *= 0.25;
              ball.vy *= 0.25;
              defDisk.vx = 0;
              defDisk.vy = 0;
              const interceptingTeam = defDisk.teamIndex ?? (g.lastShootingTeam === 0 ? 1 : 0);
              // CRITICAL FIX (Bug 1): Never overwrite g.lastShootingTeam or shotTeam!
              // Record interception on activeShotContext so opponent shots never trigger a pass for the user.
              if (g.activeShotContext) {
                g.activeShotContext.lastTouchTeam = interceptingTeam;
                g.activeShotContext.lastTouchPlayerId = defDisk.playerIndex ?? 0;
                g.activeShotContext.shotType = 'interception';
              }
              g.closingDefenderIdx = -1;

              queueTurnCommentary('interception', {
                teamName: interceptingTeam === 0 ? teamA.n : teamB.n,
                opponentName: interceptingTeam === 0 ? teamB.n : teamA.n,
                playerIndex: defDisk.playerIndex ?? 1,
              });
              g.possessionPulse = {
                diskIdx:
                  defDisk.playerIndex !== undefined
                    ? interceptingTeam === 0
                      ? defDisk.playerIndex
                      : defDisk.playerIndex + PLAYERS_PER_TEAM
                    : 0,
                timer: 1.4,
                color: interceptingTeam === 0 ? '#38bdf8' : '#f87171',
              };
            }
          }

          while (physicsAccumulatorRef.current >= PHYSICS_DT && substepsThisFrame < MAX_SUBSTEPS) {
            physicsAccumulatorRef.current -= PHYSICS_DT;
            substepsThisFrame++;

            const prevBallX = ball.x;
            const prevBallY = ball.y;

            const result = physicsStep(g.disks, PHYSICS_DT);

            if (result.ballContactTeam !== null && g.activeShotContext) {
              g.activeShotContext.lastTouchTeam = result.ballContactTeam;
              g.activeShotContext.lastTouchPlayerId = result.ballContactPlayerIndex;
              if (
                result.ballContactTeam === g.activeShotContext.shotTeam &&
                result.ballContactPlayerIndex === g.activeShotContext.shooterPlayerId
              ) {
                g.activeShotContext.shooterTouchedBall = true;
              }
            }

            if (result.endlineOut && g.activeShotContext) {
              g.activeShotContext.endlineHit = true;
              queueTurnCommentary('missed_shot', {
                teamName: g.activeShotContext.shotTeam === 0 ? teamA.n : teamB.n,
                opponentName: g.activeShotContext.shotTeam === 0 ? teamB.n : teamA.n,
                playerIndex: g.activeShotContext.shooterPlayerId,
              });
            }

            if (result.sidelineHit && g.activeShotContext) {
              g.activeShotContext.sidelineHit = true;
              queueTurnCommentary('out_of_bounds', {
                teamName: g.activeShotContext.shotTeam === 0 ? teamA.n : teamB.n,
                opponentName: g.activeShotContext.shotTeam === 0 ? teamB.n : teamA.n,
                playerIndex: g.activeShotContext.shooterPlayerId,
              });
            }

            if (g.lastAimTargetTeammateDiskIdx >= 0 && g.disks[g.lastAimTargetTeammateDiskIdx]) {
              const tm = g.disks[g.lastAimTargetTeammateDiskIdx];
              const sweptDist = distancePointToSegment(tm.x, tm.y, prevBallX, prevBallY, ball.x, ball.y);
              if (sweptDist <= INTERACTION_RADIUS) {
                g.ballEnteredTargetCaptureZone = true;
              }
            }

            if (result.postHit) {
              sound.playPost();
              queueTurnCommentary('post_hit', {
                teamName: g.lastShootingTeam === 0 ? teamA.n : teamB.n,
                opponentName: g.lastShootingTeam === 0 ? teamB.n : teamA.n,
                playerIndex: g.lastShooterPlayer,
              });
            }

            if (
              result.ballContactRoleId === 1 &&
              result.ballContactTeam !== g.lastShootingTeam &&
              result.ballContactTeam !== null
            ) {
              queueTurnCommentary('save', {
                teamName: g.lastShootingTeam === 0 ? teamA.n : teamB.n,
                opponentName: g.lastShootingTeam === 0 ? teamB.n : teamA.n,
                playerIndex: g.lastShooterPlayer,
              });
            }

            if (result.highestCollisionImpulse > 120) {
              sound.playCollision(result.highestCollisionImpulse);
            }

            if (result.goal > 0) {
              goalDetected = result.goal;
              break;
            }

            if (!areDisksMoving(g.disks)) {
              break;
            }
          }

          if (physicsAccumulatorRef.current > PHYSICS_DT * 3) {
            physicsAccumulatorRef.current = 0;
          }

          // Safety clamp: prevent any ball/disk from sliding longer than 6.0s and locking turn
          if (g.moveElapsedSeconds > 6.0 && goalDetected === 0) {
            for (const d of g.disks) {
              d.vx = 0;
              d.vy = 0;
            }
          }

          if (goalDetected > 0) {
            physicsAccumulatorRef.current = 0;
            g.closingDefenderIdx = -1;
            handleGoal(goalDetected);
          } else if (!areDisksMoving(g.disks) && !g.shotResolved) {
            g.shotResolved = true;
            physicsAccumulatorRef.current = 0;
            g.closingDefenderIdx = -1;

            const shotTeam = g.activeShotContext?.shotTeam ?? g.lastShootingTeam;
            const shooterPlayer = g.activeShotContext?.shooterPlayerId ?? g.lastShooterPlayer;

            const passResult = checkPassSuccess(
              g.disks,
              shotTeam,
              shooterPlayer,
              g.lastAimTargetTeammateDiskIdx >= 0 ? g.lastAimTargetTeammateDiskIdx : null,
              g.ballEnteredTargetCaptureZone,
              PASS_MAX_DISTANCE,
              PLAYER_CAPTURE_RADIUS,
              g.activeShotContext ?? undefined
            );

            if (
              passResult.isPass &&
              passResult.receiverPlayerIndex !== undefined &&
              passResult.receiverDiskIndex !== undefined
            ) {
              sound.playPass();
              const receiverIdx = passResult.receiverPlayerIndex;
              const activeTeamName = shotTeam === 0 ? teamA.n : teamB.n;
              const oppTeamName = shotTeam === 0 ? teamB.n : teamA.n;

              commentaryControllerRef.current.clearPending();
              emitCommentary('pass', {
                teamName: activeTeamName,
                opponentName: oppTeamName,
                playerIndex: shooterPlayer,
                receiverIndex: receiverIdx,
              });

              g.passHighlightIndex = passResult.receiverDiskIndex;
              setTimeout(() => {
                g.passHighlightIndex = -1;
              }, 1600);

              triggerToast(`Pas tamamlandı (#${receiverIdx + 1})`, 'pass');
              applyTurnTransition(
                shotTeam,
                'PASS_RECEIVER_ONLY',
                receiverIdx,
                shotTeam === 0 || isTwoPlayer
                  ? `Pas tamamlandı! Sıra #${receiverIdx + 1} numaralı oyuncuda.`
                  : `${teamB.n} pası tamamladı, atağı sürdürüyor...`
              );
            } else {
              // Check if time expired during the shot before handing turn over
              const nextTeam = shotTeam === 0 ? 1 : 0;
              const shootingTeamName = shotTeam === 0 ? teamA.n : teamB.n;
              const nextTeamName = nextTeam === 0 ? teamA.n : teamB.n;

              flushTurnCommentary('turnover', {
                teamName: shootingTeamName,
                opponentName: nextTeamName,
                playerIndex: shooterPlayer,
              });

              triggerToast(
                nextTeam === 0
                  ? 'Sıra sende'
                  : isTwoPlayer
                  ? `Sıra ${teamB.n}'da`
                  : `Top ${teamB.n}'da`,
                nextTeam === 0 ? 'pass' : 'turnover'
              );

              applyTurnTransition(nextTeam, 'FREE_CHOICE', null);
              evaluateMatchClockEnd();
            }
          }
        } else {
          physicsAccumulatorRef.current = 0;
        }

        // Bot Thinking Phase
        if (g.phase === 'bot_thinking') {
          g.waitTimer -= dt;
          if (g.waitTimer <= 0) {
            executeBotTurn();
          }
        }

        // Bot Aiming Phase
        if (g.phase === 'bot_aiming') {
          if (!g.botAim) {
            // Safety recovery if botAim was ever cleared unexpectedly
            executeBotTurn();
          } else {
            g.botAim.timer -= dt;
            if (g.botAim.timer <= 0) {
              const aim = g.botAim;
              g.botAim = null;
              sound.playKick(0.75);

              const botDisk = g.disks[aim.diskIdx];
              const ball = g.disks[g.disks.length - 1];
              const shooterId = botDisk.playerIndex ?? 0;
              const inRadius = canPlayerControlBall(botDisk, ball, INTERACTION_RADIUS);
              const speed = Math.hypot(aim.vx, aim.vy) || 1;

              g.lastShootingTeam = 1;
              g.lastShooterPlayer = shooterId;
              g.lastAimTargetTeammateDiskIdx =
                aim.targetTeammateIdx !== undefined ? aim.targetTeammateIdx : -1;
              g.ballEnteredTargetCaptureZone = false;
              g.remainingActionsInTurn = 0;
              g.shotResolved = false;
              g.moveElapsedSeconds = 0;
              commentaryControllerRef.current.clearPending();

              g.activeShotContext = {
                shotTeam: 1,
                shooterPlayerId: shooterId,
                shotType:
                  aim.targetTeammateIdx !== undefined && aim.targetTeammateIdx >= 0 && inRadius
                    ? 'pass'
                    : aim.shotType || 'shot',
                shooterWasInInteractionRadius: inRadius,
                shooterTouchedBall: false,
                lastTouchTeam: null,
                lastTouchPlayerId: null,
                ballStartX: ball.x,
                ballStartY: ball.y,
                aimDirX: aim.vx / speed,
                aimDirY: aim.vy / speed,
                endlineHit: false,
                sidelineHit: false,
                extraShotAlreadyGranted: g.extraShotGrantedThisTurn,
              };

              botDisk.vx = aim.vx;
              botDisk.vy = aim.vy;
              g.phase = 'move';

              const closestUserDef = findClosestPlayerToBall(g.disks, 0);
              g.closingDefenderIdx = closestUserDef ? closestUserDef.diskIndex : -1;

              queueTurnCommentary('shot', {
                teamName: teamB.n,
                opponentName: teamA.n,
                playerIndex: shooterId,
              });
              setStatusMessage('Top hareket halinde...');
            }
          }
        } else if (g.phase === 'goal_pause') {
          g.waitTimer -= dt;
          if (g.waitTimer <= 0) {
            setGoalBanner(null);
            if (g.isExtraTime && g.score[0] !== g.score[1]) {
              sound.playWhistle();
              haptics.vibrateMatchEnd();
              g.phase = 'end';
              emitCommentary('match_end', {
                teamName: teamA.n,
                opponentName: teamB.n,
                minute: 'Altın Gol',
              });
              setStatusMessage('Altın Gol! Maç bitti.');
              setTimeout(() => {
                onMatchFinish({ scoreA: g.score[0], scoreB: g.score[1] });
              }, 1800);
              return;
            }

            g.disks = resetDisks(userFormation.positions, botFormation.positions);
            applyTurnTransition(g.turn, 'FREE_CHOICE', null);
            evaluateMatchClockEnd();
          }
        }

        // Update particles
        if (g.particles.length > 0) {
          for (let i = 0; i < g.particles.length; i++) {
            const p = g.particles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 220 * dt;
            p.rotation += p.rotSpeed * dt;
            p.life -= dt;
          }
          g.particles = g.particles.filter((p) => p.life > 0);
        }

        if (g.shake > 0) {
          g.shake = Math.max(0, g.shake - dt * 2.2);
        }

        drawCanvas();

        if (nowTime - lastDiagSyncRef.current > 180) {
          lastDiagSyncRef.current = nowTime;
          const ball = g.disks[g.disks.length - 1];
          const ballSpeed = ball ? Math.round(Math.hypot(ball.vx, ball.vy)) : 0;
          setDiagnosticData({
            fps: Math.round(fpsSmoothingRef.current * 10) / 10,
            frameDeltaMs: Math.round(rawDelta * 1000 * 10) / 10,
            rAFRunning: isRafActiveRef.current,
            rAFCount: rAFCountRef.current,
            substepsThisFrame,
            physicsAccumulatorMs: Math.round(physicsAccumulatorRef.current * 1000 * 10) / 10,
            ballPos: ball ? { x: Math.round(ball.x), y: Math.round(ball.y) } : { x: 0, y: 0 },
            ballSpeed,
            phase: g.phase,
            turn: g.turn,
            lastError: lastErrorRef.current,
            heartbeatTicks: heartbeatTicksRef.current,
          });
        }
      } catch (err: unknown) {
        lastErrorRef.current = err instanceof Error ? err.message : String(err);
      }
    };

    const loop = (time: number) => {
      animIdRef.current = requestAnimationFrame(loop);
      tickFrame(time);
    };

    animIdRef.current = requestAnimationFrame(loop);

    // Watchdog fallback for Android WebView (respects pause & visibility state)
    const watchdogInterval = setInterval(() => {
      const g = gameStateRef.current;
      if (document.hidden || g.isPaused || penaltyState?.active) return;
      const now = performance.now();
      const elapsedSinceLastTick = now - lastHeartbeatTimeRef.current;
      if (elapsedSinceLastTick > 45 && (g.phase === 'move' || g.phase === 'bot_thinking')) {
        heartbeatTicksRef.current++;
        tickFrame(now);
      }
    }, 28);

    return () => {
      isRafActiveRef.current = false;
      cancelAnimationFrame(animIdRef.current);
      clearInterval(watchdogInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, [
    isKnockout,
    isTwoPlayer,
    teamA.n,
    teamB.n,
    onMatchFinish,
    penaltyState,
    userFormation,
    botFormation,
    applyTurnTransition,
    emitCommentary,
    queueTurnCommentary,
    flushTurnCommentary,
    triggerToast,
    difficulty,
  ]);

  // Goal handler with guard against double-counting on the same frame
  const handleGoal = (scoringTeam: number) => {
    const g = gameStateRef.current;
    if (g.phase !== 'move') return;

    g.phase = 'goal_pause';
    g.shotResolved = true;
    g.drag = null;
    g.botAim = null;
    for (const d of g.disks) {
      d.vx = 0;
      d.vy = 0;
    }

    sound.playGoal();
    haptics.vibrateGoal();
    g.shake = 1.2;

    const newScoreA = scoringTeam === 1 ? g.score[0] + 1 : g.score[0];
    const newScoreB = scoringTeam === 2 ? g.score[1] + 1 : g.score[1];
    g.score = [newScoreA, newScoreB];
    setScore([newScoreA, newScoreB]);

    const confettiColors = ['#ffd700', '#ffffff', teamA.c, teamB.c, '#22c55e', '#ef4444', '#38bdf8'];
    for (let i = 0; i < 70; i++) {
      g.particles.push({
        x: CENTER_X + (Math.random() - 0.5) * 120,
        y: scoringTeam === 1 ? PITCH_TOP + 15 : PITCH_BOTTOM - 15,
        vx: (Math.random() - 0.5) * 550,
        vy: (scoringTeam === 1 ? 1 : -1) * (180 + Math.random() * 380),
        size: 5 + Math.random() * 4,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 10,
        life: 2.0 + Math.random() * 0.6,
        color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
      });
    }

    const scoringTeamIdx = scoringTeam === 1 ? 0 : 1;
    const scoringName = scoringTeamIdx === 0 ? teamA.n : teamB.n;
    const concedingName = scoringTeamIdx === 0 ? teamB.n : teamA.n;
    const scorerPlayerIdx =
      g.activeShotContext?.lastTouchTeam === scoringTeamIdx &&
      g.activeShotContext?.lastTouchPlayerId !== null
        ? g.activeShotContext.lastTouchPlayerId
        : g.lastShooterPlayer;

    setGoalBanner(scoringTeam === 1 ? `GOOOL! ${teamA.n}!` : `GOL! ${teamB.n}!`);
    commentaryControllerRef.current.clearPending();
    emitCommentary('goal', {
      teamName: scoringName,
      opponentName: concedingName,
      playerIndex: scorerPlayerIdx,
      scoreA: newScoreA,
      scoreB: newScoreB,
    });

    // Follow-up score situation commentary (lead, equalizer, gap)
    const diffScore = Math.abs(newScoreA - newScoreB);
    if (newScoreA === newScoreB) {
      emitCommentary('score_equalizer', {
        teamName: scoringName,
        opponentName: concedingName,
        playerIndex: scorerPlayerIdx,
        scoreA: newScoreA,
        scoreB: newScoreB,
      });
    } else if (diffScore === 1) {
      emitCommentary('score_lead', {
        teamName: scoringName,
        opponentName: concedingName,
        playerIndex: scorerPlayerIdx,
        scoreA: newScoreA,
        scoreB: newScoreB,
      });
    } else if (diffScore >= 2) {
      emitCommentary('score_gap', {
        teamName: scoringName,
        opponentName: concedingName,
        playerIndex: scorerPlayerIdx,
        scoreA: newScoreA,
        scoreB: newScoreB,
      });
    }

    g.waitTimer = 2.2;
    g.turn = scoringTeam === 1 ? 1 : 0; // Conceding team gets kickoff
    setCurrentTurn(g.turn);
    g.turnMode = 'FREE_CHOICE';
    setTurnMode('FREE_CHOICE');
    g.passReceiverPlayerIndex = null;
    setPassReceiverPlayerIndex(null);
  };

  const botSimDisksRef = useRef<Disk[] | null>(null);

  const executeBotTurn = () => {
    const g = gameStateRef.current;
    if (!botSimDisksRef.current || botSimDisksRef.current.length !== g.disks.length) {
      botSimDisksRef.current = g.disks.map((d) => ({ ...d }));
    }

    const decision = computeAIDecision(
      g.disks,
      1,
      difficulty,
      teamB.r,
      g.turnMode,
      g.passReceiverPlayerIndex,
      botSimDisksRef.current
    );

    g.botAim = {
      diskIdx: decision.diskIdx,
      vx: decision.vx,
      vy: decision.vy,
      powerRatio: decision.powerRatio,
      angle: decision.angle,
      timer: decision.aimTime,
      targetTeammateIdx: decision.targetTeammateIdx,
      shotType: decision.shotType,
      trajPoints: decision.trajPoints,
    };
    g.phase = 'bot_aiming';
    setStatusMessage(`${teamB.n} nişan alıyor...`);
  };

  // Penalty Shootout logic
  const triggerPenaltyShootout = () => {
    setPenaltyState({
      active: true,
      scores: [0, 0],
      history: [[], []],
      isUserTurn: true,
      message: 'Penaltı atışları başladı! İlk sen vuruyorsun.',
      isFinished: false,
    });
  };

  const handlePenaltyShot = (targetZone: number) => {
    if (!penaltyState || penaltyState.isFinished) return;

    const isUserKicking = penaltyState.isUserTurn;
    const keeperDiveZone = Math.floor(Math.random() * 6);

    // Compare column (0: Sol, 1: Orta, 2: Sağ) and height so both shooter and goalkeeper have fair odds
    const sameColumn = targetZone % 3 === keeperDiveZone % 3;
    const exactMatch = targetZone === keeperDiveZone;
    const isSaved = exactMatch ? Math.random() < 0.82 : sameColumn && Math.random() < 0.42;
    const isMissed = !isSaved && Math.random() < 0.08;
    const isGoal = !isSaved && !isMissed;

    if (isGoal) {
      sound.playGoal();
      haptics.vibrateGoal();
    } else {
      sound.playKick(0.8);
    }

    const newHist0 = [...penaltyState.history[0]];
    const newHist1 = [...penaltyState.history[1]];

    if (isUserKicking) {
      newHist0.push(isGoal ? 1 : 0);
    } else {
      newHist1.push(isGoal ? 1 : 0);
    }

    const newScore0 = penaltyState.scores[0] + (isUserKicking && isGoal ? 1 : 0);
    const newScore1 = penaltyState.scores[1] + (!isUserKicking && isGoal ? 1 : 0);

    const shots0 = newHist0.length;
    const shots1 = newHist1.length;

    let finished = false;
    if (shots0 >= 5 && shots1 >= 5) {
      if (shots0 === shots1 && newScore0 !== newScore1) {
        finished = true;
      }
    } else {
      const rem0 = 5 - shots0;
      const rem1 = 5 - shots1;
      if (newScore0 > newScore1 + rem1 || newScore1 > newScore0 + rem0) {
        finished = true;
      }
    }

    const resultMessage = isUserKicking
      ? isGoal
        ? 'GOOOL! Harika bir vuruş!'
        : isSaved
        ? 'Kaleci kurtardı!'
        : 'Top dışarı gitti!'
      : isGoal
      ? 'Rakip golü attı!'
      : isSaved
      ? 'Kurtardın! Harika refleks!'
      : 'Rakip dışarı vurdu!';

    setPenaltyState({
      active: true,
      scores: [newScore0, newScore1],
      history: [newHist0, newHist1],
      isUserTurn: !isUserKicking,
      message: resultMessage,
      isFinished: finished,
    });
  };

  // Canvas drawing
  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const g = gameStateRef.current;

    ctx.save();

    if (g.shake > 0) {
      const trauma = g.shake * g.shake;
      const ox = (Math.random() - 0.5) * 16 * trauma;
      const oy = (Math.random() - 0.5) * 16 * trauma;
      ctx.translate(ox, oy);
    }

    // 1. Blit pre-baked stadium background
    if (bgCanvasRef.current) {
      ctx.drawImage(bgCanvasRef.current, 0, 0);
    } else {
      ctx.fillStyle = '#164024';
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    }

    const ball = g.disks[g.disks.length - 1];

    // Subtle INTERACTION_RADIUS ring around ball during human aim phase
    if (g.phase === 'aim' && (g.turn === 0 || isTwoPlayer) && ball) {
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, INTERACTION_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 2. Shadows for all 15 disks
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    for (let i = 0; i < g.disks.length; i++) {
      const d = g.disks[i];
      ctx.beginPath();
      ctx.arc(d.x + 3.5, d.y + 5.5, d.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Render 14 Player Disks (7 User + 7 Bot)
    for (let idx = 0; idx < g.disks.length; idx++) {
      const d = g.disks[idx];
      if (d.ball) continue;

      const isUserTeam = idx < PLAYERS_PER_TEAM;
      const diskTeamIdx = isUserTeam ? 0 : 1;
      const isHumanControllableTeam = diskTeamIdx === 0 || (isTwoPlayer && diskTeamIdx === 1);
      const isActiveHumanTurn = g.phase === 'aim' && g.turn === diskTeamIdx && isHumanControllableTeam;
      const role = ROLES[d.playerIndex || 0] || ROLES[0];
      const isSelected = isActiveHumanTurn && d.playerIndex === g.selectedPlayer;
      const isPassHighlight = idx === g.passHighlightIndex;
      const isPassTarget = isActiveHumanTurn && d.playerIndex === g.passTargetTeammateIdx;
      const isPassReceiver =
        isActiveHumanTurn &&
        g.turnMode === 'PASS_RECEIVER_ONLY' &&
        g.passReceiverPlayerIndex !== null &&
        d.playerIndex === g.passReceiverPlayerIndex;
      const isNearBall = isActiveHumanTurn && ball && canPlayerControlBall(d, ball, INTERACTION_RADIUS);
      const teamColor = isUserTeam ? colorA : colorB;

      // Subtle cyan control ring under teammates within INTERACTION_RADIUS of the ball
      if (isNearBall && !isSelected && !isPassReceiver) {
        ctx.save();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r + 3.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Possession pulse expanding ring
      if (g.possessionPulse && g.possessionPulse.diskIdx === idx) {
        const progress = 1 - g.possessionPulse.timer / 1.6;
        ctx.save();
        ctx.strokeStyle = g.possessionPulse.color;
        ctx.lineWidth = 3.5;
        ctx.globalAlpha = Math.max(0, 1 - progress);
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r + 4 + progress * 26, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Closing defender press indicator
      if (g.phase === 'move' && g.closingDefenderIdx === idx) {
        ctx.save();
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = 3;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r + 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#f97316';
        ctx.font = 'bold 8.5px ui-rounded, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('BASKI 🛡️', d.x, d.y - d.r - 9);
        ctx.restore();
      }

      // Special highlight for PASS_RECEIVER_ONLY mode
      if (isPassReceiver) {
        ctx.save();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r + 7, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#10b981';
        ctx.font = 'bold 9px ui-rounded, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('PASI ALAN ⚽', d.x, d.y - d.r - 10);
        ctx.restore();
      } else if (isPassTarget) {
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 4.5;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r + 6, 0, Math.PI * 2);
        ctx.stroke();
      } else if (isPassHighlight) {
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r + 7, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Selected player glow ring
      if (isSelected) {
        ctx.save();
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r + 5.5, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r + 8.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fillStyle = teamColor;
      ctx.fill();
      ctx.clip();

      const stripeWidth = Math.round(d.r * 0.42);
      ctx.fillStyle = isUserTeam ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.25)';
      ctx.fillRect(d.x - stripeWidth / 2, d.y - d.r, stripeWidth, d.r * 2);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.beginPath();
      ctx.arc(d.x, d.y - d.r * 0.3, d.r * 0.85, 0, Math.PI);
      ctx.fill();

      ctx.restore();

      // Rim
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.strokeStyle = isSelected ? '#ffffff' : '#0f172a';
      ctx.lineWidth = role.id === 1 ? 4.5 : 3;
      ctx.stroke();

      const isLightKit = teamColor === '#ffffff' || teamColor === '#f8fafc' || teamColor === '#facc15';
      const numTextColor = isLightKit ? '#0f172a' : '#ffffff';
      const tagTextColor = isLightKit ? '#b45309' : '#fef08a';

      ctx.fillStyle = numTextColor;
      ctx.font = `bold ${role.id === 1 ? 14 : 12}px ui-rounded, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${role.number}`, d.x, d.y - 3);

      ctx.font = 'bold 8.5px ui-rounded, system-ui, sans-serif';
      ctx.fillStyle = tagTextColor;
      ctx.fillText(role.shortName, d.x, d.y + 7.5);
    }

    // 4. Render Ball (Disk index 14)
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#18181b';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = '#18181b';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, 3.2, 0, Math.PI * 2);
    ctx.fill();

    // Bot Aiming Arrow & Trajectory Visualization
    if (g.phase === 'bot_aiming' && g.botAim) {
      const bDisk = g.disks[g.botAim.diskIdx];
      if (bDisk) {
        const angle = g.botAim.angle;
        const aimLen = 55 + g.botAim.powerRatio * 135;
        const nx = Math.cos(angle);
        const ny = Math.sin(angle);

        ctx.save();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 4;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(bDisk.x + nx * (bDisk.r + 4), bDisk.y + ny * (bDisk.r + 4));
        ctx.lineTo(bDisk.x + nx * aimLen, bDisk.y + ny * aimLen);
        ctx.stroke();
        ctx.setLineDash([]);

        const ax = bDisk.x + nx * aimLen;
        const ay = bDisk.y + ny * aimLen;
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.moveTo(ax + nx * 11, ay + ny * 11);
        ctx.lineTo(ax - ny * 7, ay + nx * 7);
        ctx.lineTo(ax + ny * 7, ay - nx * 7);
        ctx.closePath();
        ctx.fill();

        if (g.botAim.trajPoints) {
          ctx.fillStyle = 'rgba(245, 158, 11, 0.65)';
          for (let i = 0; i < g.botAim.trajPoints.length; i++) {
            const pt = g.botAim.trajPoints[i];
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, Math.max(1.5, 3.8 - i * 0.2), 0, Math.PI * 2);
            ctx.fill();
          }
        }

        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 10px ui-rounded, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🎯 Nişan Alıyor', bDisk.x, bDisk.y - bDisk.r - 12);
        ctx.restore();
      }
    }

    // 5. User Aiming Slingshot & Trajectory Forecast
    if (g.drag && g.phase === 'aim' && (g.turn === 0 || isTwoPlayer)) {
      const activeDisk = g.disks[g.drag.playerIdx];
      const role = ROLES[activeDisk.playerIndex || 0] || ROLES[0];

      const dx = g.drag.startX - g.drag.currX;
      const dy = g.drag.startY - g.drag.currY;
      const pullDist = Math.hypot(dx, dy);

      if (pullDist > 12) {
        const pullClamped = Math.min(pullDist, MAX_PULL_DISTANCE);
        const pullRatio = pullClamped / MAX_PULL_DISTANCE;
        const nx = dx / pullDist;
        const ny = dy / pullDist;

        // If shooter is within INTERACTION_RADIUS of ball, draw PASS_MAX_DISTANCE range circle gently
        if (canPlayerControlBall(activeDisk, ball, INTERACTION_RADIUS)) {
          ctx.save();
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.18)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.arc(ball.x, ball.y, PASS_MAX_DISTANCE, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // Slingshot pull band
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(activeDisk.x, activeDisk.y);
        ctx.lineTo(activeDisk.x - nx * pullClamped, activeDisk.y - ny * pullClamped);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(activeDisk.x - nx * pullClamped, activeDisk.y - ny * pullClamped, 7.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        const trajMultiplier = role.id === 6 ? 1.5 : 1.0;
        const trajLen = (50 + pullRatio * 160) * trajMultiplier;
        const hue = Math.max(0, 125 - pullRatio * 125);
        const aimColor = `hsl(${hue}, 90%, 55%)`;

        ctx.strokeStyle = aimColor;
        ctx.lineWidth = role.id === 6 ? 5 : 4.5;
        ctx.setLineDash([3, 10]);
        ctx.beginPath();
        ctx.moveTo(activeDisk.x + nx * (activeDisk.r + 4), activeDisk.y + ny * (activeDisk.r + 4));
        ctx.lineTo(activeDisk.x + nx * trajLen, activeDisk.y + ny * trajLen);
        ctx.stroke();
        ctx.setLineDash([]);

        const arrowX = activeDisk.x + nx * trajLen;
        const arrowY = activeDisk.y + ny * trajLen;
        ctx.fillStyle = aimColor;
        ctx.beginPath();
        ctx.moveTo(arrowX + nx * 12, arrowY + ny * 12);
        ctx.lineTo(arrowX - ny * 8, arrowY + nx * 8);
        ctx.lineTo(arrowX + ny * 8, arrowY - nx * 8);
        ctx.closePath();
        ctx.fill();

        const estSpeed = 120 + pullRatio * 520;
        const forecastPoints = calculateTrajectoryForecast(
          activeDisk.x,
          activeDisk.y,
          nx * estSpeed,
          ny * estSpeed,
          activeDisk.r,
          12,
          0.028
        );

        ctx.fillStyle = aimColor;
        for (let i = 0; i < forecastPoints.length; i++) {
          const pt = forecastPoints[i];
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, Math.max(1.5, 4.0 - i * 0.22), 0, Math.PI * 2);
          ctx.fill();
        }

        // Pass arrow indicator ONLY if shooter is in INTERACTION_RADIUS and teammate is within PASS_MAX_DISTANCE
        if (g.passTargetTeammateIdx >= 0) {
          const tmOffset = g.turn === 1 ? PLAYERS_PER_TEAM : 0;
          const tm = g.disks[tmOffset + g.passTargetTeammateIdx];
          if (tm) {
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 3;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(activeDisk.x, activeDisk.y);
            ctx.lineTo(tm.x, tm.y);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = '#10b981';
            ctx.font = 'bold 10.5px ui-rounded, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('🎯 PAS VER', (activeDisk.x + tm.x) / 2, (activeDisk.y + tm.y) / 2 - 10);
          }
        }

        const isForwardHalf = g.turn === 0 ? activeDisk.y < CENTER_Y : activeDisk.y > CENTER_Y;
        if (role.id === 7 && isForwardHalf) {
          ctx.fillStyle = '#f43f5e';
          ctx.font = 'bold 11px ui-rounded, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('⚡ Bitirici Şut Bonusu!', activeDisk.x, activeDisk.y - activeDisk.r - 12);
        }
      }
    }

    // 6. Confetti particles
    for (let i = 0; i < g.particles.length; i++) {
      const p = g.particles[i];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.7);
      ctx.restore();
    }

    ctx.restore();
  };

  const getCanvasCoords = (clientX: number, clientY: number): [number, number] => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const scaleX = WORLD_WIDTH / rect.width;
    const scaleY = WORLD_HEIGHT / rect.height;
    return [(clientX - rect.left) * scaleX, (clientY - rect.top) * scaleY];
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gameStateRef.current;
    const isHumanTurn = g.turn === 0 || (isTwoPlayer && g.turn === 1);
    if (
      g.phase !== 'aim' ||
      !isHumanTurn ||
      g.isPaused ||
      penaltyState?.active ||
      g.remainingActionsInTurn <= 0
    ) {
      return;
    }

    const [x, y] = getCanvasCoords(e.clientX, e.clientY);
    const teamOffset = g.turn === 1 ? PLAYERS_PER_TEAM : 0;

    let clickedPlayerIdx = -1;
    let minDist = Infinity;
    for (let i = 0; i < PLAYERS_PER_TEAM; i++) {
      const disk = g.disks[teamOffset + i];
      const dist = Math.hypot(disk.x - x, disk.y - y);
      if (dist < minDist) {
        minDist = dist;
        clickedPlayerIdx = i;
      }
    }

    if (minDist < 48 && clickedPlayerIdx !== -1) {
      // If in PASS_RECEIVER_ONLY mode, only the designated pass receiver (who is within INTERACTION_RADIUS) can be selected!
      if (!isPlayerSelectable(clickedPlayerIdx, g.turnMode, g.passReceiverPlayerIndex, g.disks, g.turn)) {
        triggerToast(`Sıra pası alan oyuncuda (#${(g.passReceiverPlayerIndex ?? 0) + 1})`, 'alert');
        setStatusMessage(`⚠️ Sıra yalnızca pası alan oyuncuda (#${(g.passReceiverPlayerIndex ?? 0) + 1})!`);
        sound.playKick(0.2);
        if (g.passReceiverPlayerIndex !== null) {
          g.selectedPlayer = g.passReceiverPlayerIndex;
          setSelectedPlayerIndex(g.passReceiverPlayerIndex);
        }
        return;
      }

      g.selectedPlayer = clickedPlayerIdx;
      setSelectedPlayerIndex(clickedPlayerIdx);
      sound.playSelection();
    } else {
      if (g.turnMode === 'PASS_RECEIVER_ONLY' && g.passReceiverPlayerIndex !== null) {
        g.selectedPlayer = g.passReceiverPlayerIndex;
        setSelectedPlayerIndex(g.passReceiverPlayerIndex);
      }
    }

    g.drag = {
      playerIdx: teamOffset + g.selectedPlayer,
      startX: x,
      startY: y,
      currX: x,
      currY: y,
    };

    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gameStateRef.current;
    if (!g.drag) return;
    const [x, y] = getCanvasCoords(e.clientX, e.clientY);
    g.drag.currX = x;
    g.drag.currY = y;

    const activeDisk = g.disks[g.drag.playerIdx];
    const dx = g.drag.startX - x;
    const dy = g.drag.startY - y;
    const pullDist = Math.hypot(dx, dy);

    if (pullDist > 16 && activeDisk) {
      const nx = dx / pullDist;
      const ny = dy / pullDist;
      // Uses strict INTERACTION_RADIUS + PASS_MAX_DISTANCE + directional angle validation
      const validPassTarget = findValidPassTarget(
        g.disks,
        g.turn,
        activeDisk.playerIndex ?? 0,
        nx,
        ny,
        PASS_MAX_DISTANCE,
        INTERACTION_RADIUS
      );
      g.passTargetTeammateIdx = validPassTarget ? validPassTarget.playerIndex : -1;
    } else {
      g.passTargetTeammateIdx = -1;
    }
  };

  const handlePointerUp = () => {
    const g = gameStateRef.current;
    if (!g.drag) return;

    const drag = g.drag;
    g.drag = null;
    const currentPassTargetIdx = g.passTargetTeammateIdx;
    g.passTargetTeammateIdx = -1;

    const isHumanTurn = g.turn === 0 || (isTwoPlayer && g.turn === 1);
    if (g.phase !== 'aim' || !isHumanTurn || g.remainingActionsInTurn <= 0) return;

    const dx = drag.startX - drag.currX;
    const dy = drag.startY - drag.currY;
    const pullDist = Math.hypot(dx, dy);

    if (pullDist > 14) {
      const activeDisk = g.disks[drag.playerIdx];
      const ball = g.disks[g.disks.length - 1];
      const shootingTeam = g.turn;
      const teamOffset = shootingTeam === 1 ? PLAYERS_PER_TEAM : 0;
      const shooterPlayerIdx = activeDisk.playerIndex ?? 0;

      if (!isPlayerSelectable(shooterPlayerIdx, g.turnMode, g.passReceiverPlayerIndex, g.disks, shootingTeam)) {
        triggerToast('Sıra pası alan oyuncuda!', 'alert');
        setStatusMessage('⚠️ Sıra yalnızca pası alan oyuncuda!');
        if (g.passReceiverPlayerIndex !== null) {
          g.selectedPlayer = g.passReceiverPlayerIndex;
          setSelectedPlayerIndex(g.passReceiverPlayerIndex);
        }
        return;
      }

      const role = ROLES[shooterPlayerIdx] || ROLES[0];
      const power = calculateShotPower(pullDist, role.id, activeDisk.y, shootingTeam);

      const nx = dx / pullDist;
      const ny = dy / pullDist;
      const shooterInRadius = canPlayerControlBall(activeDisk, ball, INTERACTION_RADIUS);

      sound.playKick(Math.min(1, pullDist / MAX_PULL_DISTANCE));

      const isPassAttempt = currentPassTargetIdx >= 0 && shooterInRadius;

      g.lastShootingTeam = shootingTeam;
      g.lastShooterPlayer = shooterPlayerIdx;
      g.lastAimTargetTeammateDiskIdx = isPassAttempt ? teamOffset + currentPassTargetIdx : -1;
      g.ballEnteredTargetCaptureZone = false;
      g.remainingActionsInTurn = 0; // Decrement turn counter so same shot can never fire twice
      g.shotResolved = false;
      g.moveElapsedSeconds = 0;
      commentaryControllerRef.current.clearPending();

      g.activeShotContext = {
        shotTeam: shootingTeam,
        shooterPlayerId: shooterPlayerIdx,
        shotType: isPassAttempt ? 'pass' : role.id === 1 ? 'clearance' : 'shot',
        shooterWasInInteractionRadius: shooterInRadius,
        shooterTouchedBall: false,
        lastTouchTeam: null,
        lastTouchPlayerId: null,
        ballStartX: ball.x,
        ballStartY: ball.y,
        aimDirX: nx,
        aimDirY: ny,
        endlineHit: false,
        sidelineHit: false,
        extraShotAlreadyGranted: g.extraShotGrantedThisTurn,
      };

      activeDisk.vx = nx * power;
      activeDisk.vy = ny * power;
      g.phase = 'move';

      const defendingTeam = shootingTeam === 0 ? 1 : 0;
      const closestDef = findClosestPlayerToBall(g.disks, defendingTeam);
      g.closingDefenderIdx = closestDef ? closestDef.diskIndex : -1;

      const shootingTeamName = shootingTeam === 0 ? teamA.n : teamB.n;
      const defendingTeamName = shootingTeam === 0 ? teamB.n : teamA.n;
      queueTurnCommentary('shot', {
        teamName: shootingTeamName,
        opponentName: defendingTeamName,
        playerIndex: shooterPlayerIdx,
      });
      setStatusMessage('Top hareket halinde...');
    }
  };

  const toggleMute = () => {
    sound.isMuted = !sound.isMuted;
    setIsMuted(sound.isMuted);
  };

  return (
    <div className="relative flex flex-col items-center justify-between h-dvh w-full bg-stone-950 select-none overflow-hidden text-stone-100 safe-area-match">
      {/* Top HUD */}
      <header className="w-full max-w-xl px-3 py-1.5 z-20 flex flex-col gap-1 bg-stone-900/90 border-b border-stone-800 backdrop-blur-xs">
        <div className="flex items-center justify-between text-xs text-stone-400 font-semibold px-1">
          <span className="flex items-center gap-1">
            <Trophy className="w-3.5 h-3.5 text-amber-400" />
            {roundLabel}
          </span>
          <div className="flex items-center gap-2">
            <span className="bg-emerald-950/80 text-emerald-300 px-2.5 py-0.5 rounded-full font-mono text-[11px] border border-emerald-800">
              ⏱️ {formatTimeMMSS(remainingSeconds)}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full font-mono text-[11px] font-black border flex items-center gap-1 transition-colors ${
                turnTimerDisplay <= 3
                  ? 'bg-rose-950/90 text-rose-300 border-rose-700 animate-pulse'
                  : 'bg-amber-950/80 text-amber-300 border-amber-800'
              }`}
              title="10 Saniye Vuruş Süresi"
            >
              <Timer className="w-3 h-3" />
              {turnTimerDisplay}s
            </span>
            <span className="text-stone-300 font-bold">
              {formatFootballMatchMinute(remainingSeconds, MATCH_DURATION_SECONDS, isExtraTime)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowTacticsModal(true)}
              aria-label="Mevki ve Taktik Bilgisi"
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 transition-colors"
              title="Mevki Özellikleri"
            >
              <Info className="w-4 h-4 text-emerald-400" />
            </button>
            <button
              onClick={toggleMute}
              aria-label={isMuted ? 'Sesi Aç' : 'Sesi Kapat'}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 transition-colors"
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-stone-300" />}
            </button>
            <button
              onClick={() => {
                const next = !isPaused;
                setIsPaused(next);
                gameStateRef.current.isPaused = next;
                lastTimeRef.current = performance.now();
                lastHeartbeatTimeRef.current = performance.now();
                physicsAccumulatorRef.current = 0;
                document.body.dataset.state = next ? 'paused' : 'playing';
              }}
              aria-label={isPaused ? 'Devam Et' : 'Duraklat'}
              className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 transition-colors"
            >
              {isPaused ? <Play className="w-4 h-4 text-emerald-400" /> : <Pause className="w-4 h-4 text-stone-300" />}
            </button>
            <button
              onClick={() => setShowDiagnostics((prev) => !prev)}
              aria-label={showDiagnostics ? 'Tanılamayı Gizle' : 'Tanılama / Hata Ayıklama Paneli'}
              className={`min-w-[40px] min-h-[40px] rounded-lg transition-colors flex items-center justify-center ${
                showDiagnostics
                  ? 'bg-amber-500 text-stone-950 font-black shadow-md shadow-amber-500/40'
                  : 'bg-stone-800 hover:bg-stone-700 text-amber-400'
              }`}
              title="Tanılama Modu (FPS, Fizik, rAF, Hata)"
            >
              <Activity className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Score Board with Formations */}
        <div className="flex items-center justify-between bg-stone-950/70 rounded-xl py-1.5 px-3 border border-stone-800">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <TeamFlag flag={teamA.f} className="w-7 h-5" />
            <div className="min-w-0">
              <span className="font-black text-sm text-white truncate block">{teamA.n}</span>
              <span className="text-[11px] text-emerald-400 font-bold block truncate">
                {userFormation.name}
              </span>
            </div>
          </div>

          <div className="px-4 text-center">
            <span className="font-black text-2xl tracking-wider text-white font-mono">
              {score[0]} – {score[1]}
            </span>
          </div>

          <div className="flex items-center justify-end gap-2.5 flex-1 min-w-0 text-right">
            <div className="min-w-0">
              <span className="font-black text-sm text-white truncate block">{teamB.n}</span>
              <span className="text-[11px] text-stone-400 font-bold block truncate">
                {botFormation.name}
              </span>
            </div>
            <TeamFlag flag={teamB.f} className="w-7 h-5" />
          </div>
        </div>

        {/* Live 3-Line Commentary Box (Requirement 5: shows last 3 items, older ones faded) */}
        <div
          aria-live="polite"
          className="flex flex-col gap-0.5 bg-stone-950/90 rounded-lg py-1 px-2.5 border border-stone-800/90 text-[11px] shadow-xs"
        >
          {commentaryHistory.slice(0, 3).map((item, idx) => {
            const opacityClass =
              idx === 0
                ? 'opacity-100 text-stone-100 font-semibold'
                : idx === 1
                ? 'opacity-60 text-stone-300 font-normal'
                : 'opacity-35 text-stone-400 font-normal';
            return (
              <div key={item.id} className={`flex items-center gap-1.5 leading-tight ${opacityClass}`}>
                {idx === 0 ? (
                  <span className="inline-flex items-center gap-1 shrink-0 font-bold text-amber-400 text-[10px] uppercase tracking-wider">
                    <Radio className="w-2.5 h-2.5 text-emerald-400" />
                    SPİKER:
                  </span>
                ) : (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-stone-600 shrink-0 ml-1 mr-0.5" />
                )}
                <p className="truncate flex-1">{item.text}</p>
              </div>
            );
          })}
        </div>

        {/* Active Role Strip */}
        <div className="flex items-center justify-between text-xs bg-stone-950/50 rounded-lg py-1 px-2.5 border border-stone-800/80">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-emerald-600 text-white font-black text-xs flex items-center justify-center">
              {activeRole.number}
            </span>
            <span className="font-bold text-white">{activeRole.name} ({activeRole.shortName})</span>
            <span className="text-stone-400 text-[11px] hidden sm:inline">• {activeRole.sizeDesc}</span>
          </div>
          <span className="text-emerald-400 text-[11px] font-medium truncate max-w-[210px]">
            🌟 {activeRole.specialAbility}
          </span>
        </div>
      </header>

      {/* Main Pitch Stage */}
      <main
        ref={containerRef}
        className="relative flex-1 w-full max-w-xl flex items-center justify-center overflow-hidden p-1 touch-none will-change-transform"
      >
        <canvas
          ref={canvasRef}
          width={WORLD_WIDTH}
          height={WORLD_HEIGHT}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="w-auto h-full max-h-[85vh] aspect-[500/820] shadow-2xl rounded-xl cursor-crosshair border-2 border-stone-800"
          style={{
            transform: 'translateZ(0)',
          }}
        />

        {/* Goal celebration banner overlay */}
        {goalBanner && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
            <div className="animate-bounce bg-black/90 border-4 border-amber-400 rounded-3xl px-8 py-5 shadow-2xl text-center transform scale-110">
              <span className="block text-4xl sm:text-5xl font-black text-amber-300 drop-shadow-md">
                ⚽ {goalBanner}
              </span>
            </div>
          </div>
        )}

        {/* Compact Top-Corner Turn/Status Tag (Requirement 4: small 11-12px semi-transparent corner tag) */}
        {passBanner && (
          <div className="absolute top-2.5 right-3 z-25 pointer-events-none">
            <div
              className={`px-2.5 py-1 rounded-md font-semibold text-[11px] leading-none shadow-md flex items-center gap-1.5 border backdrop-blur-xs transition-opacity ${
                passBanner.type === 'turnover'
                  ? 'bg-stone-900/75 text-amber-200 border-amber-700/50'
                  : passBanner.type === 'shot'
                  ? 'bg-stone-900/75 text-sky-200 border-sky-700/50'
                  : passBanner.type === 'alert'
                  ? 'bg-rose-950/80 text-rose-200 border-rose-700/60'
                  : 'bg-emerald-950/80 text-emerald-200 border-emerald-700/60'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  passBanner.type === 'turnover'
                    ? 'bg-amber-400'
                    : passBanner.type === 'alert'
                    ? 'bg-rose-400'
                    : 'bg-emerald-400'
                }`}
              />
              <span>{passBanner.text}</span>
            </div>
          </div>
        )}

        {/* Diagnostic / Debug Mode Overlay */}
        {showDiagnostics && (
          <div className="absolute top-2 left-2 right-2 z-35 bg-stone-950/95 border-2 border-amber-500/80 rounded-2xl p-3 shadow-2xl backdrop-blur-md text-[11px] font-mono select-text max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-stone-800">
              <div className="flex items-center gap-1.5 font-bold text-amber-400 text-xs">
                <Bug className="w-4 h-4 text-amber-400 animate-pulse" />
                <span>Canlı Tanılama Modu (Android APK / Performans)</span>
              </div>
              <button
                onClick={() => setShowDiagnostics(false)}
                className="min-h-[44px] px-3 py-1 rounded bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-sans font-bold"
              >
                ✕ Kapat
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-stone-300">
              <div className="bg-stone-900/80 p-2 rounded-xl border border-stone-800">
                <span className="text-stone-500 block text-[11px] font-bold">KARE / ZAMAN</span>
                <span className="text-emerald-400 font-black text-sm block">
                  {diagnosticData.fps} FPS
                </span>
                <span className="text-stone-400 text-[11px]">
                  Δt: {diagnosticData.frameDeltaMs} ms ({Math.round(1000 / (diagnosticData.fps || 60))}ms hedef)
                </span>
              </div>

              <div className="bg-stone-900/80 p-2 rounded-xl border border-stone-800">
                <span className="text-stone-500 block text-[11px] font-bold">DÖNGÜ (rAF) DURUMU</span>
                <div className="flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${diagnosticData.rAFRunning ? 'bg-emerald-500 animate-ping' : 'bg-rose-500'}`} />
                  <span className="font-bold text-stone-200">
                    {diagnosticData.rAFRunning ? 'Aktif Çalışıyor' : 'DURDU!'}
                  </span>
                </div>
                <span className="text-stone-400 text-[11px]">
                  Kare Sayacı: #{diagnosticData.rAFCount}
                </span>
              </div>

              <div className="bg-stone-900/80 p-2 rounded-xl border border-stone-800">
                <span className="text-stone-500 block text-[11px] font-bold">FİZİK SİMÜLASYONU</span>
                <span className="font-bold text-cyan-400 text-xs block">
                  {diagnosticData.substepsThisFrame} Adım/Kare (120Hz DT)
                </span>
                <span className="text-stone-400 text-[11px]">
                  Akümülatör: {diagnosticData.physicsAccumulatorMs} ms
                </span>
              </div>

              <div className="bg-stone-900/80 p-2 rounded-xl border border-stone-800">
                <span className="text-stone-500 block text-[11px] font-bold">TOP HAREKETİ</span>
                <span className="font-bold text-amber-300 text-xs block">
                  Hız: {diagnosticData.ballSpeed} px/s
                </span>
                <span className="text-stone-400 text-[11px]">
                  Konum: ({diagnosticData.ballPos.x}, {diagnosticData.ballPos.y})
                </span>
              </div>

              <div className="bg-stone-900/80 p-2 rounded-xl border border-stone-800">
                <span className="text-stone-500 block text-[11px] font-bold">OYUN FAZI</span>
                <span className="font-bold text-indigo-300 text-xs block">
                  Faz: {diagnosticData.phase}
                </span>
                <span className="text-stone-400 text-[11px]">
                  Sıra: {diagnosticData.turn === 0 ? 'Sen (0)' : 'Rakip (1)'}
                </span>
              </div>

              <div className="bg-stone-900/80 p-2 rounded-xl border border-stone-800">
                <span className="text-stone-500 block text-[11px] font-bold">WEBVIEW GÜVENCESİ</span>
                <span className="font-bold text-stone-200 text-xs block">
                  Watchdog Tetik: {diagnosticData.heartbeatTicks}
                </span>
                <span className="text-emerald-400 text-[11px]">
                  Duraklama Koruması: Aktif
                </span>
              </div>
            </div>

            <div className="mt-2.5 p-2 bg-stone-900/90 rounded-xl border border-stone-800 text-[11px]">
              <span className="text-amber-400 font-bold block mb-1">ALT SİSTEM SAĞLIK TESTİ:</span>
              <div className="flex flex-wrap gap-2 text-stone-300">
                <span className="bg-emerald-950/80 text-emerald-300 px-2 py-0.5 rounded border border-emerald-800">
                  Animasyon (rAF): ÇALIŞIYOR
                </span>
                <span className={`px-2 py-0.5 rounded border ${
                  diagnosticData.phase === 'move'
                    ? diagnosticData.ballSpeed > 0
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                      : 'bg-amber-950/80 text-amber-300 border-amber-800'
                    : 'bg-stone-800 text-stone-300 border-stone-700'
                }`}>
                  Fizik Motoru: {diagnosticData.phase === 'move' ? (diagnosticData.ballSpeed > 0 ? 'HESAPLIYOR' : 'DURMA NOKTASINDA') : 'BEKLEMEDE'}
                </span>
                <span className="bg-emerald-950/80 text-emerald-300 px-2 py-0.5 rounded border border-emerald-800">
                  Canvas Çizimi: ÇİZİLİYOR
                </span>
              </div>
              <div className="mt-1.5 text-stone-400">
                Son JS Hatası: <span className={diagnosticData.lastError ? 'text-rose-400 font-bold' : 'text-stone-500'}>
                  {diagnosticData.lastError || 'Yok (Temiz)'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Pause Modal Overlay */}
        <PauseModal
          isOpen={isPaused}
          onResume={() => {
            setIsPaused(false);
            gameStateRef.current.isPaused = false;
            lastTimeRef.current = performance.now();
            lastHeartbeatTimeRef.current = performance.now();
            physicsAccumulatorRef.current = 0;
            document.body.dataset.state = 'playing';
          }}
          onOpenTactics={() => setShowTacticsModal(true)}
          onQuitMatch={onQuitToTournament}
        />

        {/* Penalty Shootout Overlay */}
        {penaltyState && (
          <div className="absolute inset-0 z-40 bg-stone-950/95 flex flex-col items-center justify-center p-4 text-center">
            <h3 className="text-2xl font-black text-amber-400 mb-1">⚽ Penaltı Atışları</h3>
            <p className="text-xs text-stone-300 mb-4">Uzatma eşitlikle bitti. Şampiyon penaltılarla belirleniyor!</p>

            <div className="w-full max-w-sm bg-stone-900 p-4 rounded-2xl border border-stone-800 mb-4">
              <div className="flex justify-between items-center text-sm font-bold text-white mb-2">
                <span className="flex items-center gap-1.5"><TeamFlag flag={teamA.f} className="w-5 h-3.5" /> {teamA.n}</span>
                <span className="font-mono text-xl text-emerald-400">{penaltyState.scores[0]} – {penaltyState.scores[1]}</span>
                <span className="flex items-center gap-1.5">{teamB.n} <TeamFlag flag={teamB.f} className="w-5 h-3.5" /></span>
              </div>
              <div className="flex justify-between text-xs text-stone-400">
                <div>
                  {penaltyState.history[0].map((h, i) => (
                    <span key={i} className="mr-1">{h ? '🟢' : '🔴'}</span>
                  ))}
                </div>
                <div>
                  {penaltyState.history[1].map((h, i) => (
                    <span key={i} className="ml-1">{h ? '🟢' : '🔴'}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="text-sm font-semibold text-amber-300 mb-4">
              {penaltyState.message}
            </div>

            {penaltyState.isFinished ? (
              <button
                onClick={() => {
                  haptics.vibrateMatchEnd();
                  onMatchFinish({
                    scoreA: gameStateRef.current.score[0],
                    scoreB: gameStateRef.current.score[1],
                    penalties: penaltyState.scores,
                  });
                }}
                className="min-h-[44px] px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-black text-white text-base shadow-lg"
              >
                Maçı Tamamla
              </button>
            ) : penaltyState.isUserTurn || isTwoPlayer ? (
              <div>
                <p className="text-xs text-stone-400 mb-2">
                  {isTwoPlayer
                    ? `${penaltyState.isUserTurn ? teamA.n : teamB.n} Vuruş Yapacağı Köşeyi Seçsin:`
                    : 'Vuruş Yapacağın Köşeyi Seç:'}
                </p>
                <div className="grid grid-cols-3 gap-2 w-72">
                  {['Sol Üst', 'Orta Üst', 'Sağ Üst', 'Sol Alt', 'Orta Alt', 'Sağ Alt'].map((zone, idx) => (
                    <button
                      key={idx}
                      onClick={() => handlePenaltyShot(idx)}
                      className="min-h-[44px] py-3 px-1 text-xs font-bold rounded-xl bg-stone-800 hover:bg-emerald-600 text-stone-200 hover:text-white border border-stone-700 transition-colors"
                    >
                      {zone}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <p className="text-xs text-stone-400 mb-2">Rakip Vuruyor! Kalecin Hangi Yöne Atlasın?</p>
                <div className="grid grid-cols-3 gap-2 w-72">
                  {['Sol Köşe', 'Merkez', 'Sağ Köşe'].map((zone, idx) => (
                    <button
                      key={idx}
                      onClick={() => handlePenaltyShot(idx)}
                      className="min-h-[44px] py-4 px-2 text-xs font-bold rounded-xl bg-stone-800 hover:bg-amber-600 text-stone-200 hover:text-white border border-stone-700 transition-colors"
                    >
                      {zone}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Bottom Status / Selection Bar for 7 Players */}
      <footer className="w-full max-w-xl px-3 py-2 z-20 bg-stone-900/90 border-t border-stone-800 flex items-center justify-between text-xs text-stone-300">
        <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
          <span className="font-medium truncate max-w-[210px]">
            {statusMessage}
          </span>
          {gameStateRef.current.tacticalHint && gameStateRef.current.phase === 'aim' && (currentTurn === 0 || isTwoPlayer) && (
            <span className="hidden sm:inline-block px-2 py-0.5 rounded-full bg-amber-950/80 text-amber-300 border border-amber-800 text-[11px] font-bold shrink-0">
              {gameStateRef.current.tacticalHint}
            </span>
          )}
        </div>

        {/* 7 Player Selection Buttons (1..7) */}
        <div className="flex items-center gap-1 shrink-0">
          {ROLES.map((role) => {
            const isSelected = selectedPlayerIndex === role.id - 1;
            const isPassReceiver =
              turnMode === 'PASS_RECEIVER_ONLY' &&
              passReceiverPlayerIndex !== null &&
              role.id - 1 === passReceiverPlayerIndex;

            return (
              <button
                key={role.id}
                onClick={() => {
                  const targetIdx = role.id - 1;
                  const g = gameStateRef.current;
                  const isHumanTurn = g.turn === 0 || (isTwoPlayer && g.turn === 1);
                  if (g.phase !== 'aim' || !isHumanTurn) return;

                  if (!isPlayerSelectable(targetIdx, g.turnMode, g.passReceiverPlayerIndex, g.disks, g.turn)) {
                    triggerToast(`Sıra pası alan oyuncuda (#${(g.passReceiverPlayerIndex ?? 0) + 1})`, 'alert');
                    setStatusMessage(`⚠️ Sıra yalnızca pası alan oyuncuda (#${(g.passReceiverPlayerIndex ?? 0) + 1})!`);
                    sound.playKick(0.2);
                    return;
                  }

                  g.selectedPlayer = targetIdx;
                  setSelectedPlayerIndex(targetIdx);
                  sound.playSelection();
                }}
                className={`relative min-w-[44px] min-h-[44px] rounded-xl text-xs font-black transition-all flex items-center justify-center ${
                  isPassReceiver
                    ? isSelected
                      ? 'bg-emerald-500 text-stone-950 ring-2 ring-emerald-300 scale-105 shadow-md shadow-emerald-500/50'
                      : 'bg-emerald-950/90 text-emerald-300 ring-2 ring-emerald-500 hover:bg-emerald-900 animate-pulse'
                    : isSelected
                    ? 'bg-amber-400 text-stone-950 scale-105 shadow-md shadow-amber-500/50'
                    : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
                }`}
                title={`${role.number} - ${role.name}${isPassReceiver ? ' (Pası Alan Oyuncu)' : ''}`}
              >
                {role.number}
                {isPassReceiver && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-1 ring-black" />
                )}
              </button>
            );
          })}
        </div>
      </footer>

      {/* Tactics Modal */}
      <TacticsModal
        isOpen={showTacticsModal}
        onClose={() => setShowTacticsModal(false)}
        activeRoleId={activeRole.id}
      />
    </div>
  );
};
