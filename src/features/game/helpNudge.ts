import { KEYS, storage } from '@/core/storage';

type HelpMode = 'intro' | 'standard';

interface HelpNudgeJournal {
  version: 1;
  sessionId: string | null;
  sessionOffers: number;
  offeredPuzzles: string[];
  dismissedPuzzles: string[];
}

const MAX_SESSION_OFFERS = 2;

function emptyJournal(): HelpNudgeJournal {
  return {
    version: 1,
    sessionId: null,
    sessionOffers: 0,
    offeredPuzzles: [],
    dismissedPuzzles: [],
  };
}

/** A damaged journal fails closed; manual help remains available. */
function readJournal(): HelpNudgeJournal | null {
  try {
    const raw = storage.getString(KEYS.helpNudge);
    if (raw == null) return emptyJournal();
    const value = JSON.parse(raw) as Partial<HelpNudgeJournal>;
    if (value?.version !== 1 ||
      (value.sessionId !== null && typeof value.sessionId !== 'string') ||
      !Number.isInteger(value.sessionOffers) || value.sessionOffers! < 0 ||
      value.sessionOffers! > MAX_SESSION_OFFERS ||
      !Array.isArray(value.offeredPuzzles) || !value.offeredPuzzles.every((key) => typeof key === 'string') ||
      !Array.isArray(value.dismissedPuzzles) || !value.dismissedPuzzles.every((key) => typeof key === 'string')) {
      return null;
    }
    return value as HelpNudgeJournal;
  } catch {
    return null;
  }
}

function writeJournal(journal: HelpNudgeJournal): boolean {
  try {
    storage.set(KEYS.helpNudge, JSON.stringify(journal));
    return true;
  } catch {
    return false;
  }
}

/** The introduction offers help sooner; later levels keep the retention ladder. */
export function isStalled(activeSeconds: number, failedAttempts: number, mode: HelpMode = 'standard'): boolean {
  if (!Number.isFinite(activeSeconds) || !Number.isFinite(failedAttempts) ||
    activeSeconds < 0 || failedAttempts < 0) return false;
  if (mode === 'intro') return activeSeconds >= 18;
  return (activeSeconds >= 60 && failedAttempts >= 3)
    || activeSeconds >= 120;
}

/** Persist before displaying so a brief process restart cannot reset either cap. */
export function claimHelpNudge(sessionId: string, puzzleKey: string): boolean {
  if (!sessionId.trim() || !puzzleKey.trim()) return false;
  const current = readJournal();
  if (!current || current.offeredPuzzles.includes(puzzleKey) ||
    current.dismissedPuzzles.includes(puzzleKey)) return false;
  const sessionOffers = current.sessionId === sessionId ? current.sessionOffers : 0;
  if (sessionOffers >= MAX_SESSION_OFFERS) return false;
  return writeJournal({
    ...current,
    sessionId,
    sessionOffers: sessionOffers + 1,
    offeredPuzzles: [...current.offeredPuzzles, puzzleKey],
  });
}

/** Returns true only when an explicit dismissal is newly committed. */
export function dismissHelpNudge(puzzleKey: string): boolean {
  if (!puzzleKey.trim()) return false;
  const current = readJournal();
  if (!current || current.dismissedPuzzles.includes(puzzleKey)) return false;
  return writeJournal({
    ...current,
    dismissedPuzzles: [...current.dismissedPuzzles, puzzleKey],
  });
}
