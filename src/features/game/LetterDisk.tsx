import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';

import { playSfx } from '@/features/audio';
import { trackGameplayAction } from '@/features/analytics';
import { advanceSelection } from '@/features/onboarding/gestureSelection';
import { AppText, colors, fonts, Icon, radius } from '@/ui';

import {
  constraintCaption,
  FEEDBACK_VISIBLE_MS,
  feedbackAnnouncement,
  feedbackCaption,
  letterAccessibilityHint,
  letterAccessibilityLabel,
  MIN_SELECTION_TO_SUBMIT,
  selectionSummary,
  type FeedbackKind,
} from './accessibility';
import { hitTile, tilePositions, wordFromSelection, type TilePos } from './geometry';
import { letterDiskFontSize } from './layout';
import { useGame } from './store';

type FeedbackState = { word: string; kind: FeedbackKind; expectedLength?: number };
type SelectionMode = 'idle' | 'tap' | 'drag';
const ACTION_SIZE = 48;
const SHUFFLE_SIZE = 56;
const DISK_FILL = 'rgba(255, 246, 217, 0.82)';
const DEMO_DURATION_MS = 1_400;
const DEMO_LOOP_MS = 3_200;
const AnimatedLine = Animated.createAnimatedComponent(Line);
const SELECTION_COLOR = colors.goldBorder;
const SELECTION_ENTER_MS = 80;
const SELECTION_EXIT_MS = 60;
const SELECTION_EASING = Easing.bezier(0.23, 1, 0.32, 1);

type DragState = { id: number; primaryId: number; downX: number; downY: number;
  activeIds: number[]; dragging: boolean; ended: boolean; blocked: boolean; contentKey: string };
function emptyDrag(id = 0): DragState {
  'worklet';
  return { id, primaryId: -1, downX: 0, downY: 0, activeIds: [],
    dragging: false, ended: false, blocked: false, contentKey: '' };
}

/** Geometry comes directly from the UI gesture; completed edges have no timing lag. */
function SelectionConnection({ index, positions, selection, size }: {
  index: number; positions: TilePos[]; selection: SharedValue<number[]>; size: number;
}) {
  const animatedProps = useAnimatedProps(() => {
    const path = selection.get();
    const from = positions[path[index]];
    const to = positions[path[index + 1]];
    return from && to ? { x1: from.x, y1: from.y, x2: to.x, y2: to.y, opacity: 1 }
      : { x1: 0, y1: 0, x2: 0, y2: 0, opacity: 0 };
  });
  return <AnimatedLine testID={`selection-connection-${index}`} animatedProps={animatedProps}
    stroke={SELECTION_COLOR} strokeWidth={Math.max(7, size * 0.03)} strokeLinecap="round" opacity={0} />;
}

function SelectionHighlight({ point, index, radius: highlightRadius, highlights, selection, preview }: {
  point: TilePos; index: number; radius: number; highlights: SharedValue<number[]>;
  selection: SharedValue<number[]>; preview: SharedValue<number>;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: selection.get().includes(index) || preview.get() === index ? 1 : 0,
    transform: [{ scale: 0.92 + 0.08 * (highlights.get()[index] ?? 0) }],
  }));
  return <Animated.View pointerEvents="none" testID={`selection-outline-${index}`} style={[{
    position: 'absolute', left: point.x - highlightRadius, top: point.y - highlightRadius,
    width: highlightRadius * 2, height: highlightRadius * 2, borderRadius: highlightRadius,
    backgroundColor: SELECTION_COLOR, borderColor: SELECTION_COLOR, borderWidth: 2,
  }, animatedStyle]} />;
}

/** Moving the native strip leaves the SVG wheel bitmap cached between letter hits. */
function FingerTrail({ positions, selection, preview, cursor, down, size }: {
  positions: TilePos[]; selection: SharedValue<number[]>; preview: SharedValue<number>;
  cursor: SharedValue<TilePos>; down: SharedValue<boolean>; size: number;
}) {
  const thickness = Math.max(7, size * 0.03);
  const start = useDerivedValue(() => {
    const path = selection.get();
    return positions[path.length ? path[path.length - 1] : preview.get()] ?? null;
  });
  const stripStyle = useAnimatedStyle(() => {
    const from = start.get();
    const to = cursor.get();
    const dx = to.x - (from?.x ?? 0);
    const dy = to.y - (from?.y ?? 0);
    const length = from ? Math.hypot(dx, dy) : 0;
    return {
      opacity: from && down.get() && length > 0 ? 1 : 0,
      transform: [
        { translateX: ((from?.x ?? 0) + to.x) / 2 - size / 2 },
        { translateY: ((from?.y ?? 0) + to.y) / 2 - thickness / 2 },
        { rotateZ: `${Math.atan2(dy, dx)}rad` as `${number}rad` },
        { scaleX: length > 0 ? length / size : 1 },
      ],
    };
  });
  const startStyle = useAnimatedStyle(() => {
    const from = start.get();
    return { opacity: from && down.get() ? 1 : 0,
      transform: [{ translateX: (from?.x ?? 0) - thickness / 2 }, { translateY: (from?.y ?? 0) - thickness / 2 }] };
  });
  const endStyle = useAnimatedStyle(() => {
    const to = cursor.get();
    return { opacity: start.get() && down.get() ? 1 : 0,
      transform: [{ translateX: to.x - thickness / 2 }, { translateY: to.y - thickness / 2 }] };
  });
  const base = { position: 'absolute' as const, left: 0, top: 0, height: thickness, backgroundColor: SELECTION_COLOR };
  const cap = { ...base, width: thickness, borderRadius: thickness / 2 };
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <Animated.View testID="finger-trail" style={[{ ...base, width: size }, stripStyle]} />
    <Animated.View testID="finger-trail-start" style={[cap, startStyle]} />
    <Animated.View testID="finger-trail-end" style={[cap, endStyle]} />
  </View>;
}

/** Р¦РІРµС‚ РїРёР»СЋР»Рё С‚РµРєСѓС‰РµРіРѕ СЃР»РѕРІР° РїРѕ СЂРµР·СѓР»СЊС‚Р°С‚Сѓ РІРІРѕРґР°. */
function pillColor(kind: FeedbackKind | null): string {
  if (kind === 'grid' || kind === 'bonus') return colors.playGreenDark;
  if (kind === 'constraint' || kind === 'save_error') return colors.amber;
  if (kind === 'invalid' || kind === 'duplicate' || kind === 'blocked') return colors.danger;
  return colors.plum;
}

function pillTextColor(kind: FeedbackKind | null): string {
  return kind === 'constraint' || kind === 'save_error' ? colors.onAmber : colors.text;
}

export function LetterDisk({
  letters,
  onWord,
  onShuffle,
  onTapSelectionChange,
  size = 300,
  demoWord,
  demoRequestId = 0,
  demoLoop = false,
  onUserInteraction,
  onUserInteractionEnd,
  interactionGuardMs = 0,
}: {
  letters: string[];
  onWord: (word: string) => FeedbackKind;
  onShuffle?: () => void;
  onTapSelectionChange?: (selecting: boolean) => void;
  size?: number;
  /** Decorative demonstration: never calls onWord or changes game state. */
  demoWord?: string;
  demoRequestId?: number;
  /** Repeat the first-word gesture until the player touches the disk. */
  demoLoop?: boolean;
  onUserInteraction?: () => void;
  onUserInteractionEnd?: () => void;
  /** Prevent a result button's release touch from selecting a tile on the next board. */
  interactionGuardMs?: number;
}) {
  // The external hint chips now live in the wheel's corner slots, so the disk can use
  // the full allocated square instead of reserving a bottom control strip.
  const diskSize = size;
  const lettersKey = letters.join('');
  const { fontScale } = useWindowDimensions();
  const letterFontSize = letterDiskFontSize(diskSize, fontScale);
  const tileR = Math.max(21, Math.min(34, diskSize * 0.106));
  const hitR = tileR + 10;
  const radiusValue = diskSize / 2 - tileR - 10;
  const center = diskSize / 2;
  const positions = useMemo<TilePos[]>(
    () => tilePositions(letters.length, radiusValue, center),
    [letters.length, radiusValue, center],
  );
  const [selected, setSelected] = useState<number[]>([]);
  const selectedRef = useRef<number[]>([]);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [selectionMode, setSelectionModeState] = useState<SelectionMode>('idle');
  const selectionModeRef = useRef<SelectionMode>('idle');
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const demoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDemoRequest = useRef(0);
  const [demoPlaying, setDemoPlaying] = useState(false);
  const [demoRestart, setDemoRestart] = useState(0);
  const demoProgress = useSharedValue(0);
  const reducedMotion = useReducedMotion();
  const dragLettersKey = useRef('');
  const inputReadyAt = useRef(Date.now() + interactionGuardMs);
  const interactionActive = useRef(false);
  const twoLetterTracked = useRef(false);
  const currentContentKey = useRef(lettersKey);
  const activeDrag = useRef<{ id: number; contentKey: string } | null>(null);
  const uiSelection = useSharedValue<number[]>([]);
  const uiHighlights = useSharedValue<number[]>(positions.map(() => 0));
  const uiCursor = useSharedValue({ x: 0, y: 0 });
  const uiFingerDown = useSharedValue(false);
  const uiPreview = useSharedValue(-1);
  const uiDrag = useSharedValue(emptyDrag());
  const uiContentKey = useSharedValue(lettersKey);
  const uiReadyAt = useSharedValue(Date.now() + interactionGuardMs);
  const uiMultiTap = useSharedValue(false);
  const uiTap = useSharedValue({ id: 0, contentKey: lettersKey, valid: false });

  const shake = useSharedValue(0);
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  // РџСѓР»СЊСЃ РґРёСЃРєР° РїСЂРё РїРµСЂРµРјРµС€РёРІР°РЅРёРё/СЃРјРµРЅРµ Р±СѓРєРІ СѓСЂРѕРІРЅСЏ (game feel, СЃРїРµРєР° 09).
  const demoIndices = useMemo(() => {
    const used = new Set<number>();
    return [...(demoWord?.toLowerCase() ?? '')].map((ch) => {
      const index = letters.findIndex((letter, i) => letter === ch && !used.has(i));
      if (index >= 0) used.add(index);
      return index;
    });
  }, [demoWord, letters]);
  const demoPoints = demoIndices.length === 3 && demoIndices.every((index) => index >= 0)
    ? demoIndices.map((index) => positions[index])
    : [];
  const hasDemoPath = demoPoints.length === 3;
  const [demoStart, demoMiddle, demoEnd] = demoPoints.length === 3
    ? demoPoints
    : [{ x: center, y: center }, { x: center, y: center }, { x: center, y: center }];
  const demoTravel = useDerivedValue(() => demoLoop
    ? interpolate(demoProgress.get(), [0, 0.08, 0.60, 1], [0, 0, 1, 1], Extrapolation.CLAMP)
    : demoProgress.get());
  const demoOpacity = useDerivedValue(() => demoLoop
    ? interpolate(demoProgress.get(), [0, 0.08, 0.68, 0.82, 1], [0, 1, 1, 0, 0], Extrapolation.CLAMP)
    : 1);
  const firstDemoLine = useAnimatedProps(() => {
    const fraction = Math.min(1, Math.max(0, demoTravel.get() * 2));
    return {
      x2: interpolate(fraction, [0, 1], [demoStart.x, demoMiddle.x]),
      y2: interpolate(fraction, [0, 1], [demoStart.y, demoMiddle.y]),
      opacity: uiFingerDown.get() ? 0 : demoOpacity.get(),
    };
  });
  const secondDemoLine = useAnimatedProps(() => {
    const fraction = Math.min(1, Math.max(0, demoTravel.get() * 2 - 1));
    return {
      x2: interpolate(fraction, [0, 1], [demoMiddle.x, demoEnd.x]),
      y2: interpolate(fraction, [0, 1], [demoMiddle.y, demoEnd.y]),
      opacity: uiFingerDown.get() ? 0 : demoOpacity.get(),
    };
  });
  const demoHandStyle = useAnimatedStyle(() => {
    const fraction = demoTravel.get();
    const x = fraction <= 0.5
      ? interpolate(fraction * 2, [0, 1], [demoStart.x, demoMiddle.x])
      : interpolate((fraction - 0.5) * 2, [0, 1], [demoMiddle.x, demoEnd.x]);
    const y = fraction <= 0.5
      ? interpolate(fraction * 2, [0, 1], [demoStart.y, demoMiddle.y])
      : interpolate((fraction - 0.5) * 2, [0, 1], [demoMiddle.y, demoEnd.y]);
    return {
      opacity: uiFingerDown.get() ? 0 : demoOpacity.get(),
      transform: [{ translateX: x - 21 }, { translateY: y - 9 }],
    };
  });
  const cancelDemo = () => {
    if (demoTimer.current) {
      clearTimeout(demoTimer.current);
      demoTimer.current = null;
    }
    cancelAnimation(demoProgress);
    setDemoPlaying(false);
  };
  const beginInteraction = () => {
    cancelDemo();
    if (interactionActive.current) return;
    interactionActive.current = true;
    onUserInteraction?.();
  };
  const endInteraction = () => {
    if (!interactionActive.current) return;
    interactionActive.current = false;
    onUserInteractionEnd?.();
    // A quick touch can begin/end in one React batch without changing demoLoop.
    setDemoRestart((revision) => revision + 1);
  };
  useEffect(() => {
    if ((!demoLoop && demoRequestId <= 0) || !hasDemoPath) return;
    if (!demoLoop && demoRequestId === lastDemoRequest.current) {
      // A changed target cancels the old drawing; it never authorizes another one.
      cancelDemo();
      return;
    }
    if (!demoLoop) lastDemoRequest.current = demoRequestId;
    setDemoPlaying(true);
    demoProgress.set(0);
    if (reducedMotion) {
      demoProgress.set(demoLoop ? 0.64 : 1);
    } else if (demoLoop) {
      demoProgress.set(withRepeat(withTiming(1, {
        duration: DEMO_LOOP_MS,
        easing: Easing.linear,
      }), -1, false));
    } else {
      demoProgress.set(withTiming(1, {
        duration: DEMO_DURATION_MS,
        easing: Easing.bezier(0.77, 0, 0.175, 1),
      }));
    }
    if (!demoLoop) {
      demoTimer.current = setTimeout(() => {
        demoTimer.current = null;
        setDemoPlaying(false);
      }, DEMO_DURATION_MS);
    }
    return () => {
      if (demoTimer.current) clearTimeout(demoTimer.current);
      demoTimer.current = null;
      cancelAnimation(demoProgress);
    };
    // Shared values are stable; playback starts only when the request ID changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoLoop, demoRequestId, demoRestart, demoWord, lettersKey, hasDemoPath, reducedMotion]);
  const firstRender = useRef(true);
  const diskPulse = useSharedValue(1);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (reducedMotion) return;
    diskPulse.value = withSequence(
      withTiming(0.97, { duration: 95 }),
      withTiming(1, { duration: 180, easing: Easing.bezier(0.23, 1, 0.32, 1) }),
    );
  }, [lettersKey, diskPulse, reducedMotion]);
  const diskStyle = useAnimatedStyle(() => ({ transform: [{ scale: uiFingerDown.get() ? 1 : diskPulse.get() }] }));
  const triggerShake = () => {
    if (reducedMotion) return;
    cancelAnimation(shake); // РЅРµ РЅР°РєР°РїР»РёРІР°С‚СЊ СЃРёРєРІРµРЅСЃС‹ РїСЂРё С‡Р°СЃС‚С‹С… РѕС€РёР±РєР°С…
    shake.value = withSequence(
      withTiming(-9, { duration: 45 }),
      withRepeat(withTiming(9, { duration: 80 }), 3, true),
      withTiming(0, { duration: 45 }),
    );
  };

  // Р§РёСЃС‚РёРј РѕС‚Р»РѕР¶РµРЅРЅС‹Р№ СЃР±СЂРѕСЃ С„РёРґР±СЌРєР° РїСЂРё СЂР°Р·РјРѕРЅС‚РёСЂРѕРІР°РЅРёРё.
  useEffect(() => () => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    currentContentKey.current = '';
    activeDrag.current = null;
    cancelAnimation(uiHighlights);
  }, [uiHighlights]);

  useEffect(() => {
    currentContentKey.current = lettersKey;
    uiContentKey.set(lettersKey);
    activeDrag.current = null;
    uiDrag.set(emptyDrag(uiDrag.get().id + 1));
    uiTap.set({ id: 0, contentKey: lettersKey, valid: false });
    resetSelection();
    uiHighlights.set(positions.map(() => 0));
    // The demonstration effect above cancels its old path when letters change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lettersKey]);

  const stopFeedbackTimer = () => {
    if (feedbackTimer.current) {
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = null;
    }
  };

  const setSelectionMode = (nextMode: SelectionMode) => {
    selectionModeRef.current = nextMode;
    setSelectionModeState(nextMode);
    onTapSelectionChange?.(nextMode === 'tap' && selectedRef.current.length > 0);
  };

  const resetSelection = (nextMode: SelectionMode = 'idle') => {
    resetReactSelection(nextMode);
    uiSelection.set([]);
    paintHighlights([]);
    uiFingerDown.set(false);
    uiPreview.set(-1);
  };

  const resetReactSelection = (nextMode: SelectionMode = 'idle') => {
    selectedRef.current = [];
    twoLetterTracked.current = false;
    setSelected([]);
    setSelectionMode(nextMode);
    if (nextMode === 'idle') {
      dragLettersKey.current = '';
      endInteraction();
    }
  };

  const dismissFeedback = () => {
    stopFeedbackTimer();
    setFeedback(null);
  };

  const reflectSelection = (next: number[]) => {
    if (next.length === selectedRef.current.length && next.every((value, i) => value === selectedRef.current[i])) return;
    const added = next.length > selectedRef.current.length;
    selectedRef.current = next;
    setSelected(next);
    if (next.length >= 2 && !twoLetterTracked.current) {
      twoLetterTracked.current = true;
      const game = useGame.getState();
      trackGameplayAction('letters_connected', {
        len: 2,
        levelId: game.level?.globalId ?? game.level?.id,
        mode: game.mode === 'daily' ? 'daily' : 'campaign',
        inputType: selectionModeRef.current,
      });
    }
    if (selectionModeRef.current === 'tap') onTapSelectionChange?.(next.length > 0);
    if (added) playSfx('select');
  };

  const appendSelection = (idx: number) => {
    if (Date.now() < inputReadyAt.current) return;
    const next = advanceSelection(selectedRef.current, idx);
    reflectSelection(next);
    uiSelection.set(next);
    paintHighlights(next);
  };

  const removeLastSelection = () => {
    if (selectedRef.current.length === 0) return;
    const next = selectedRef.current.slice(0, -1);
    reflectSelection(next);
    uiSelection.set(next);
    paintHighlights(next);
    if (next.length === 0) setSelectionMode('idle');
  };

  const setResultFeedback = (word: string, kind: FeedbackKind) => {
    const latest = useGame.getState().lastResult;
    const nextFeedback: FeedbackState =
      latest?.word === word && latest.kind === kind
        ? {
            word,
            kind,
            expectedLength: latest.kind === 'constraint' ? latest.expectedLength : undefined,
          }
        : { word, kind };

    setFeedback(nextFeedback);
    if (kind === 'invalid' || kind === 'duplicate' || kind === 'constraint') triggerShake();
    if ((kind === 'grid' || kind === 'bonus') && !reducedMotion) {
      diskPulse.value = withSequence(
        withTiming(1.018, { duration: 130 }),
        withTiming(1, { duration: 220, easing: Easing.bezier(0.23, 1, 0.32, 1) }),
      );
    }
    stopFeedbackTimer();
    feedbackTimer.current = setTimeout(() => {
      feedbackTimer.current = null;
      setFeedback(null);
    }, FEEDBACK_VISIBLE_MS);
  };

  const confirmSelection = () => {
    if (Date.now() < inputReadyAt.current) {
      resetSelection();
      return;
    }
    if (dragLettersKey.current && dragLettersKey.current !== lettersKey) {
      resetSelection();
      return;
    }
    const word = wordFromSelection(letters, selectedRef.current);
    resetSelection();
    if (word.length < MIN_SELECTION_TO_SUBMIT) return;
    setResultFeedback(word, onWord(word));
  };

  const paintHighlights = (path: number[], preview = -1) => {
    'worklet';
    const target = positions.map((_, index) => path.includes(index) || index === preview ? 1 : 0);
    uiHighlights.set(reducedMotion || uiHighlights.get().length !== target.length ? target : withTiming(target, {
      duration: path.length || preview >= 0 ? SELECTION_ENTER_MS : SELECTION_EXIT_MS,
      easing: SELECTION_EASING,
    }));
  };
  const onDragTouchStarted = () => {
    if (!currentContentKey.current) return;
    beginInteraction();
    dismissFeedback();
  };
  const onDragStarted = (id: number, contentKey: string) => {
    if (contentKey !== currentContentKey.current) return;
    activeDrag.current = { id, contentKey };
    dragLettersKey.current = contentKey;
    resetReactSelection('drag');
  };
  const onDragSelection = (path: number[], id: number, contentKey: string) => {
    if (contentKey !== currentContentKey.current || activeDrag.current?.id !== id) return;
    reflectSelection(path);
  };
  const onDragFinished = (path: number[], id: number, contentKey: string) => {
    if (contentKey !== currentContentKey.current || activeDrag.current?.id !== id) return;
    activeDrag.current = null;
    resetReactSelection();
    if (Date.now() < inputReadyAt.current) return;
    const word = wordFromSelection(letters, path);
    if (word.length >= MIN_SELECTION_TO_SUBMIT) setResultFeedback(word, onWord(word));
  };
  const onDragCancelled = (id: number, contentKey: string) => {
    if (contentKey !== currentContentKey.current || activeDrag.current?.id !== id) return;
    activeDrag.current = null;
    resetReactSelection();
  };
  const onTapSelected = (path: number[], contentKey: string) => {
    if (contentKey !== currentContentKey.current || Date.now() < inputReadyAt.current) return;
    dismissFeedback();
    setSelectionMode('tap');
    reflectSelection(path);
  };
  const pickOnUI = (x: number, y: number) => {
    'worklet';
    const index = hitTile(positions, x, y, hitR);
    if (index < 0) return;
    const previous = uiSelection.get();
    const next = advanceSelection(previous, index);
    if (next.length === previous.length && next.every((value, i) => value === previous[i])) return;
    uiSelection.set(next);
    paintHighlights(next);
    const state = uiDrag.get();
    scheduleOnRN(onDragSelection, next, state.id, state.contentKey);
  };
  const moveOnUI = (x: number, y: number) => {
    'worklet';
    const cursor = uiCursor.get();
    if (cursor.x !== x || cursor.y !== y) uiCursor.set({ x, y });
    if (uiDrag.get().dragging) pickOnUI(x, y);
  };
  const finishOnUI = () => {
    'worklet';
    const state = uiDrag.get();
    if (!state.dragging || state.ended) return;
    const path = [...uiSelection.get()];
    uiDrag.set({ ...state, dragging: false, ended: true });
    uiSelection.set([]);
    paintHighlights([]);
    uiFingerDown.set(false);
    uiPreview.set(-1);
    scheduleOnRN(onDragFinished, path, state.id, state.contentKey);
  };

  /* eslint-disable react-hooks/refs -- Gesture callbacks run from event handlers; refs hold mutable drag state. */
  const pan = Gesture.Pan()
    .runOnJS(false)
    .minDistance(12)
    .shouldCancelWhenOutside(false)
    .onTouchesDown((e) => {
      'worklet';
      if (Date.now() < uiReadyAt.get()) { uiTap.set({ ...uiTap.get(), valid: false }); return; }
      const state = uiDrag.get();
      const activeIds = [...state.activeIds];
      e.changedTouches.forEach((touch) => { if (!activeIds.includes(touch.id)) activeIds.push(touch.id); });
      uiDrag.set({ ...state, activeIds });
      if (state.primaryId >= 0 || state.blocked || !e.changedTouches.length) return;
      const first = e.changedTouches[0];
      const id = state.id + 1;
      uiDrag.set({ ...emptyDrag(id), primaryId: first.id, downX: first.x, downY: first.y,
        activeIds, contentKey: uiContentKey.get() });
      uiTap.set({ id, contentKey: uiContentKey.get(), valid: true });
      uiCursor.set({ x: first.x, y: first.y });
      uiFingerDown.set(true);
      const preview = hitTile(positions, first.x, first.y, hitR);
      uiPreview.set(preview);
      paintHighlights(uiSelection.get(), preview);
      cancelAnimation(demoProgress);
      scheduleOnRN(onDragTouchStarted);
    })
    .onStart((e) => {
      'worklet';
      const state = uiDrag.get();
      if (Date.now() < uiReadyAt.get() || state.primaryId < 0 || state.blocked
        || state.contentKey !== uiContentKey.get()) return;
      uiDrag.set({ ...state, dragging: true });
      uiSelection.set([]);
      paintHighlights([]);
      uiPreview.set(-1);
      scheduleOnRN(onDragStarted, state.id, state.contentKey);
      pickOnUI(state.downX, state.downY);
      const cursor = uiCursor.get();
      if (e.numberOfPointers === 1) moveOnUI(e.x, e.y);
      else pickOnUI(cursor.x, cursor.y);
    })
    .onTouchesMove((e) => {
      'worklet';
      const state = uiDrag.get();
      if (state.primaryId < 0 || state.ended || state.blocked || state.contentKey !== uiContentKey.get()) return;
      const primary = e.allTouches.find((touch) => touch.id === state.primaryId);
      if (primary) moveOnUI(primary.x, primary.y);
    })
    .onUpdate((e) => {
      'worklet';
      const state = uiDrag.get();
      if (state.dragging && e.numberOfPointers === 1 && !state.ended && !state.blocked
        && state.contentKey === uiContentKey.get()) moveOnUI(e.x, e.y);
    })
    .onTouchesUp((e) => {
      'worklet';
      const state = uiDrag.get();
      const activeIds = state.activeIds.filter((id) => !e.changedTouches.some((touch) => touch.id === id));
      if (!e.changedTouches.some((touch) => touch.id === state.primaryId)) { uiDrag.set({ ...state, activeIds }); return; }
      finishOnUI();
      uiDrag.set({ ...uiDrag.get(), primaryId: -1, activeIds, blocked: activeIds.length > 0 });
      uiFingerDown.set(false);
    })
    .onEnd(() => {
      'worklet';
      finishOnUI();
    })
    .onFinalize((_e, success) => {
      'worklet';
      const state = uiDrag.get();
      const cancelled = !success && state.dragging && !state.ended;
      if (cancelled) uiSelection.set([]);
      uiFingerDown.set(false);
      uiPreview.set(-1);
      paintHighlights(uiSelection.get());
      uiDrag.set(emptyDrag(state.id));
      if (cancelled) scheduleOnRN(onDragCancelled, state.id, state.contentKey);
      else scheduleOnRN(endInteraction);
    });
  const tap = Gesture.Tap()
    .runOnJS(false)
    .maxDistance(10)
    .maxDuration(500)
    .onBegin(() => {
      'worklet';
      uiMultiTap.set(false);
    })
    .onTouchesDown((e) => {
      'worklet';
      if (e.numberOfTouches > 1) uiMultiTap.set(true);
    })
    .onEnd((e, success) => {
      'worklet';
      const token = uiTap.get();
      if (!success || uiMultiTap.get() || !token.valid || token.contentKey !== uiContentKey.get()) return;
      uiTap.set({ ...token, valid: false });
      const next = advanceSelection(uiSelection.get(), hitTile(positions, e.x, e.y, hitR));
      uiSelection.set(next);
      uiFingerDown.set(false);
      uiPreview.set(-1);
      paintHighlights(next);
      scheduleOnRN(onTapSelected, next, token.contentKey);
    })
    .onFinalize(() => {
      'worklet';
      uiTap.set({ ...uiTap.get(), valid: false });
      if (!uiFingerDown.get() && uiSelection.get().length === 0) scheduleOnRN(endInteraction);
    });
  const gesture = Gesture.Race(pan, tap);
  /* eslint-enable react-hooks/refs */

  const selectedWord = wordFromSelection(letters, selected);
  const currentWord = feedback ? feedback.word : selectedWord || (demoPlaying && !demoLoop ? demoWord ?? '' : '');
  const showPill = currentWord.length > 0;
  const pillMessage = feedback
    ? feedback.kind === 'constraint'
      ? constraintCaption(feedback.expectedLength)
      : feedbackCaption(feedback.kind)
    : null;
  const liveRegionMessage = feedback
    ? feedbackAnnouncement(feedback.word, feedback.kind, { expectedLength: feedback.expectedLength })
    : ' ';
  const canConfirm = selected.length >= MIN_SELECTION_TO_SUBMIT;
  const hasSelection = selected.length > 0;
  const showTapActions = selectionMode === 'tap' && hasSelection;
  const showShuffle = Boolean(onShuffle) && !showPill && !demoPlaying;
  const diskSummary = selectionSummary(selectedWord, selected.length, letters.length);
  const pillFg = pillTextColor(feedback?.kind ?? null);
  const confirmLabel = hasSelection ? `Подтвердить слово ${selectedWord.toUpperCase()}.` : 'Подтвердить слово.';
  const undoLabel = 'Убрать последнюю букву.';
  const clearLabel = 'Очистить выбор.';

  return (
    <View testID="letter-disk" style={{ width: size, height: size }}>
      {/* Р–РµСЃС‚ РЅР° РЅРµСЃРєР°Р»РёСЂСѓРµРјРѕР№ View в†’ РєРѕРѕСЂРґРёРЅР°С‚С‹ hit-С‚РµСЃС‚Р° РЅРµ Р·Р°РІРёСЃСЏС‚ РѕС‚ РїСѓР»СЊСЃР° РґРёСЃРєР°. */}
      <GestureDetector gesture={gesture}>
        <View style={{ width: diskSize, height: diskSize }}>
          <Animated.View style={diskStyle}>
            <Svg width={diskSize} height={diskSize} style={StyleSheet.absoluteFill} pointerEvents="none">
            {/* Один светлый диск оставляет жест и расположение букв ясными на любом фоне. */}
            <Circle cx={center} cy={center + 3} r={radiusValue + tileR + 6} fill="rgba(25,12,30,0.28)" />
            <Circle cx={center} cy={center} r={radiusValue + tileR + 6} fill={DISK_FILL} stroke={colors.goldBorder} strokeWidth={2} />
            <Circle cx={center} cy={center} r={radiusValue + tileR - 3} fill="none" stroke={colors.creamDeep} strokeWidth={1.2} />
            </Svg>
            <FingerTrail positions={positions} selection={uiSelection} preview={uiPreview}
              cursor={uiCursor} down={uiFingerDown} size={diskSize} />
            {positions.map((point, index) => <SelectionHighlight key={`${lettersKey}:highlight:${index}`}
              point={point} index={index} radius={tileR + 8} highlights={uiHighlights}
              selection={uiSelection} preview={uiPreview} />)}
            <Svg width={diskSize} height={diskSize}>

            {/* Р»РёРЅРёСЏ СЃРІСЏР·Рё РІС‹Р±СЂР°РЅРЅС‹С… Р±СѓРєРІ */}
            {positions.slice(1).map((_, i) => <SelectionConnection
              key={`${lettersKey}:line:${i}`}
              index={i} positions={positions} selection={uiSelection} size={size}
            />)}

            {demoPlaying ? (
              <>
                <AnimatedLine
                  x1={demoStart.x} y1={demoStart.y}
                  x2={demoStart.x} y2={demoStart.y}
                  animatedProps={firstDemoLine}
                  stroke={colors.goldBorder} strokeWidth={Math.max(9, size * 0.035)}
                  strokeLinecap="round" opacity={0.9}
                />
                <AnimatedLine
                  x1={demoMiddle.x} y1={demoMiddle.y}
                  x2={demoMiddle.x} y2={demoMiddle.y}
                  animatedProps={secondDemoLine}
                  stroke={colors.goldBorder} strokeWidth={Math.max(9, size * 0.035)}
                  strokeLinecap="round" opacity={0.9}
                />
              </>
            ) : null}

            {positions.map((p, i) => {
              const y = p.y;
              return (
                <Fragment key={`t${i}`}>
                  <SvgText
                    x={p.x}
                    y={y + letterFontSize * 0.3}
                    fontSize={letterFontSize}
                    fontFamily={fonts.tile}
                    fill={colors.plumDeep}
                    textAnchor="middle"
                  >
                    {letters[i].toUpperCase()}
                  </SvgText>
                </Fragment>
              );
            })}
            </Svg>
          </Animated.View>
          {demoPlaying ? (
            <Animated.View
              testID="intro-gesture-guide"
              pointerEvents="none"
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              style={[styles.demoHand, demoHandStyle]}
            >
              <MaterialCommunityIcons name="gesture-tap" size={34} color={colors.plumDeep} />
            </Animated.View>
          ) : null}
        </View>
      </GestureDetector>
      <Animated.View
        pointerEvents="none"
        style={[
          pillStyle,
          {
            position: 'absolute',
            top: center - 23,
            left: 0,
            right: 0,
            opacity: showPill ? 1 : 0,
            alignItems: 'center',
          },
        ]}
      >
        <View
          style={{
            minWidth: 90,
            maxWidth: diskSize - 32,
            paddingVertical: 7,
            paddingHorizontal: 18,
            borderRadius: radius.pill,
            backgroundColor: pillColor(feedback?.kind ?? null),
            alignItems: 'center',
          }}
        >
          <AppText preset="label" style={{ letterSpacing: 2, fontSize: 23, color: pillFg }}>
            {currentWord.toUpperCase() || ' '}
          </AppText>
          {pillMessage ? (
            <AppText preset="body" style={{ marginTop: 4, fontSize: 11, lineHeight: 15, textAlign: 'center', color: pillFg }}>
              {pillMessage}
            </AppText>
          ) : null}
        </View>
      </Animated.View>
      {showShuffle ? (
        <Pressable
          onPress={onShuffle}
          accessibilityRole="button"
          accessibilityLabel="Перемешать буквы бесплатно"
          accessibilityHint="Меняет порядок букв на диске без монет."
          style={({ pressed }) => [
            styles.shuffleButton,
            { left: center - SHUFFLE_SIZE / 2, top: center - SHUFFLE_SIZE / 2, transform: [{ scale: pressed ? 0.94 : 1 }] },
          ]}
        >
          <Icon name="shuffle" size={30} color={colors.plumDeep} />
        </Pressable>
      ) : null}
      {showTapActions ? (
        <View pointerEvents="box-none" style={styles.tapActions}>
          <Pressable
            onPress={removeLastSelection}
            accessibilityRole="button"
            accessibilityLabel={undoLabel}
            accessibilityHint="Дважды нажмите, чтобы исправить последнюю выбранную букву."
            style={({ pressed }) => [
              styles.actionButton,
              { left: 0, top: 0 },
              { opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Icon name="back" size={20} color={colors.text} />
            <AppText preset="label" style={styles.actionLabel}>
              Назад
            </AppText>
          </Pressable>
          <Pressable
            onPress={confirmSelection}
            accessibilityRole="button"
            accessibilityLabel={confirmLabel}
            accessibilityHint={canConfirm ? 'Дважды нажмите, чтобы отправить выбранное слово.' : 'Сначала выберите минимум три буквы.'}
            accessibilityState={{ disabled: !canConfirm }}
            disabled={!canConfirm}
            style={({ pressed }) => [
              styles.actionButton,
              { right: 0, top: 0 },
              { opacity: !canConfirm ? 0.55 : pressed ? 0.9 : 1 },
            ]}
          >
            <Icon name="check" size={20} color={colors.text} />
            <AppText preset="label" style={styles.actionLabel}>
              Готово
            </AppText>
          </Pressable>
          <Pressable
            onPress={() => {
              dismissFeedback();
              resetSelection();
            }}
            accessibilityRole="button"
            accessibilityLabel={clearLabel}
            accessibilityHint="Дважды нажмите, чтобы убрать выбранные буквы."
            style={({ pressed }) => [
              styles.actionButton,
              { left: 0, bottom: 0 },
              { opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Icon name="close" size={20} color={colors.text} />
            <AppText preset="label" style={styles.actionLabel}>
              Сброс
            </AppText>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.accessibilityLayer}>
        <View
          accessible
          accessibilityRole="text"
          accessibilityLabel={diskSummary}
          accessibilityHint="Выбирайте буквы кнопками ниже или проводите по диску."
          style={styles.srOnly}
        />
        {letters.map((letter, index) => {
          const isSelected = selected.includes(index);
          return (
            <Pressable
              key={`a11y-letter-${index}`}
              onPress={() => {
                beginInteraction();
                dismissFeedback();
                if (selectionModeRef.current !== 'tap') setSelectionMode('tap');
                appendSelection(index);
              }}
              accessibilityRole="button"
              accessibilityLabel={letterAccessibilityLabel(letter, index, letters.length)}
              accessibilityHint={isSelected
                ? 'Если это предыдущая буква, коснитесь её ещё раз для возврата.'
                : letterAccessibilityHint(false)}
              accessibilityState={{ selected: isSelected }}
              style={styles.srOnly}
            >
              <AppText preset="body" style={styles.srOnlyText}>
                {letter.toUpperCase()}
              </AppText>
            </Pressable>
          );
        })}
        <AppText accessibilityLiveRegion="polite" style={styles.srOnlyText}>
          {liveRegionMessage}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shuffleButton: {
    position: 'absolute',
    width: SHUFFLE_SIZE,
    height: SHUFFLE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  demoHand: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accessibilityLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
  tapActions: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  actionButton: {
    position: 'absolute',
    width: ACTION_SIZE,
    height: ACTION_SIZE,
    borderRadius: ACTION_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.plum,
    borderWidth: 1,
    borderColor: colors.goldBorder,
  },
  actionLabel: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0.01,
  },
  srOnly: {
    width: 1,
    height: 1,
    opacity: 0.01,
  },
  srOnlyText: {
    width: 1,
    height: 1,
    opacity: 0.01,
  },
});
