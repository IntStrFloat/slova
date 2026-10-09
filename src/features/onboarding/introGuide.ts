import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { getJSON, setJSON, storage } from '@/core/storage';

const GUIDE_KEY = 'onboarding.guide.intro-v1';
const INDEPENDENT_KEY = 'onboarding.first-independent.intro-v1';
const AUTO_DEMO_LIMIT = 2;

export type IntroGuidance = {
  guidanceEnabled: boolean;
  autoDemoCount: number;
  firstValidInput: boolean;
  firstTargetAccepted: boolean;
  demoHelpedLevelIds: number[];
};

export type FirstIndependentIntroCompletion = {
  levelId: number;
  attemptId: string;
  completedAt: string;
};

const DEFAULT_GUIDANCE: IntroGuidance = {
  guidanceEnabled: true,
  autoDemoCount: 0,
  firstValidInput: false,
  firstTargetAccepted: false,
  demoHelpedLevelIds: [],
};

export function readIntroGuidance(): IntroGuidance {
  const saved = getJSON<Partial<IntroGuidance> | null>(GUIDE_KEY, null);
  if (!saved || typeof saved !== 'object') return { ...DEFAULT_GUIDANCE };
  return {
    guidanceEnabled: saved.guidanceEnabled !== false,
    autoDemoCount: Number.isInteger(saved.autoDemoCount)
      ? Math.max(0, Math.min(AUTO_DEMO_LIMIT, saved.autoDemoCount!))
      : 0,
    firstValidInput: saved.firstValidInput === true,
    firstTargetAccepted: saved.firstTargetAccepted === true,
    demoHelpedLevelIds: Array.isArray(saved.demoHelpedLevelIds)
      ? [...new Set(saved.demoHelpedLevelIds.filter((id) => Number.isInteger(id) && id >= 1 && id <= 5))]
      : [],
  };
}

function updateIntroGuidance(patch: Partial<IntroGuidance>): IntroGuidance {
  const next = { ...readIntroGuidance(), ...patch };
  setJSON(GUIDE_KEY, next);
  return next;
}

export function setIntroGuidanceEnabled(enabled: boolean): IntroGuidance {
  return updateIntroGuidance({ guidanceEnabled: enabled });
}

export function recordIntroValidInput(): IntroGuidance {
  return updateIntroGuidance({ firstValidInput: true });
}

export function recordIntroTargetAccepted(): IntroGuidance {
  return updateIntroGuidance({ firstValidInput: true, firstTargetAccepted: true });
}

/** Record introduction assistance, including a demonstration or semantic clue. */
export function recordIntroDemoHelpUsed(levelId: number): IntroGuidance {
  const current = readIntroGuidance();
  if (!Number.isInteger(levelId) || levelId < 1 || levelId > 5
    || current.demoHelpedLevelIds.includes(levelId)) return current;
  const next = { ...current, demoHelpedLevelIds: [...current.demoHelpedLevelIds, levelId] };
  // Assistance must be durable before a later win is classified as independent.
  storage.set(GUIDE_KEY, JSON.stringify(next));
  return next;
}

export function readFirstIndependentIntroCompletion(): FirstIndependentIntroCompletion | null {
  const value = getJSON<Partial<FirstIndependentIntroCompletion> | null>(INDEPENDENT_KEY, null);
  if (!value || !Number.isInteger(value.levelId) || value.levelId! < 2 || value.levelId! > 5
    || typeof value.attemptId !== 'string' || !value.attemptId
    || typeof value.completedAt !== 'string' || !Number.isFinite(Date.parse(value.completedAt))) {
    return null;
  }
  return value as FirstIndependentIntroCompletion;
}

/** First qualifying introduction completion wins; it never grants a reward. */
export function recordFirstIndependentIntroCompletion(
  completion: FirstIndependentIntroCompletion,
): FirstIndependentIntroCompletion {
  const existing = readFirstIndependentIntroCompletion();
  if (existing) return existing;
  if (!Number.isInteger(completion.levelId) || completion.levelId < 2 || completion.levelId > 5
    || !completion.attemptId || !Number.isFinite(Date.parse(completion.completedAt))) {
    throw new Error('Invalid independent introduction completion');
  }
  storage.set(INDEPENDENT_KEY, JSON.stringify(completion));
  const saved = readFirstIndependentIntroCompletion();
  if (!saved) throw new Error('Could not save independent introduction completion');
  return saved;
}

export function recordIntroAutoDemo(): IntroGuidance {
  const current = readIntroGuidance();
  if (!current.guidanceEnabled || current.firstTargetAccepted || current.autoDemoCount >= AUTO_DEMO_LIMIT) {
    return current;
  }
  return updateIntroGuidance({ autoDemoCount: current.autoDemoCount + 1 });
}

/** Controls the decorative first-level gesture without submitting a word. */
export function useIntroGuide({
  active,
  levelId,
  solvedCount,
}: {
  active: boolean;
  levelId: number;
  solvedCount: number;
}) {
  const [guidance, setGuidance] = useState(readIntroGuidance);
  const [interacting, setInteracting] = useState(false);
  const [screen, setScreen] = useState({ active, levelId });
  const [appIsActive, setAppIsActive] = useState(
    AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  );

  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      setAppIsActive(state === 'active');
      // A gesture may never finalize after Android backgrounds the screen.
      if (state !== 'active') setInteracting(false);
    });
    return () => listener.remove();
  }, []);

  // Reset transient input as part of the changed screen render, without a
  // post-render effect that could suppress the guide after focus returns.
  if (screen.active !== active || screen.levelId !== levelId) {
    setScreen({ active, levelId });
    setInteracting(false);
  }

  const onUserInteraction = useCallback(() => {
    setInteracting(true);
  }, []);

  const onInteractionEnd = useCallback(() => {
    setInteracting(false);
  }, []);

  const markValidInput = useCallback(() => {
    setGuidance(recordIntroValidInput());
  }, []);

  const markTargetAccepted = useCallback(() => {
    setInteracting(false);
    setGuidance(recordIntroTargetAccepted());
  }, []);

  const refreshGuidance = useCallback(() => {
    setGuidance(readIntroGuidance());
  }, []);

  return {
    demoActive: active && appIsActive && levelId === 1 && solvedCount === 0
      && guidance.guidanceEnabled && !guidance.firstTargetAccepted && !interacting,
    guidance,
    onUserInteraction,
    onInteractionEnd,
    markValidInput,
    markTargetAccepted,
    refreshGuidance,
  };
}
