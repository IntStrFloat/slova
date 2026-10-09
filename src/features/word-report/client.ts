import app from '../../../app.json';
import { normalizeSubmission } from '@/core/engine';
import { ENV } from '@/core/config/env';
import { getJSON, storage } from '@/core/storage';
import { getIntroLevelForFingerprint } from '@/features/onboarding/introPack';
import { useProfile } from '@/features/profile';

const STORAGE_KEY = 'word-report.outbox.v1';
const MAX_PENDING = 10;
const MAX_DAILY = 10;
const MAX_RECENT = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NORMALIZED_WORD = /^[а-я]{3,8}$/;
const reportFields = new Set([
  'globalLevel', 'world', 'mode', 'contentVersion', 'levelFingerprint', 'policyRevision',
  'reportId', 'createdAt', 'locale', 'normalizedWord', 'reportKind',
  'currentClassification', 'appVersion',
]);

export type WordReportKind = 'missing_valid' | 'inappropriate_or_wrong';
export type WordClassification = 'grid' | 'bonus' | 'blocked' | 'invalid';

export type WordReportContext = {
  globalLevel: number;
  world: string;
  mode: 'normal' | 'daily';
  contentVersion: string;
  levelFingerprint: string;
  policyRevision: number | null;
};

export type WordReportInput = {
  word: string;
  reportKind: WordReportKind;
  currentClassification: WordClassification;
  context: WordReportContext;
};

type WordReport = WordReportContext & {
  reportId: string;
  createdAt: string;
  locale: 'ru';
  normalizedWord: string;
  reportKind: WordReportKind;
  currentClassification: WordClassification;
  appVersion: string;
};

type Pending = { key: string; report: WordReport };
type Recent = { key: string; reportId: string; at: string };
type LocalState = {
  version: 1;
  pending: Pending[];
  recent: Recent[];
  day: string;
  acceptedToday: number;
  retryAt: number;
};

export type WordReportResult = {
  status: 'sent' | 'duplicate' | 'queued' | 'rate_limited' | 'invalid' |
    'unsupported_content' | 'unavailable' | 'auth_required' | 'save_failed';
  reportId?: string;
  retryAfterSeconds?: number;
};

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function validPending(value: unknown): value is Pending {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Pending;
  const report = entry.report;
  if (typeof entry.key !== 'string' || !report || typeof report !== 'object' ||
      Object.keys(report).length !== reportFields.size ||
      Object.keys(report).some((field) => !reportFields.has(field))) return false;
  return UUID.test(report.reportId) && typeof report.createdAt === 'string' &&
    !Number.isNaN(Date.parse(report.createdAt)) && report.locale === 'ru' &&
    NORMALIZED_WORD.test(report.normalizedWord) && canReportWord(report) &&
    (report.reportKind === 'missing_valid' || report.reportKind === 'inappropriate_or_wrong') &&
    (report.currentClassification === 'grid' || report.currentClassification === 'bonus' ||
      report.currentClassification === 'blocked' || report.currentClassification === 'invalid') &&
    typeof report.appVersion === 'string' && report.appVersion.length >= 1 &&
    report.appVersion.length <= 64 &&
    entry.key === reportKey({
      word: report.normalizedWord,
      context: report,
      reportKind: report.reportKind,
      currentClassification: report.currentClassification,
    }, report.normalizedWord);
}

function loadState(): LocalState {
  const stored = getJSON<Partial<LocalState> | null>(STORAGE_KEY, null);
  const today = dayKey(Date.now());
  if (stored?.version !== 1) {
    return { version: 1, pending: [], recent: [], day: today, acceptedToday: 0, retryAt: 0 };
  }
  return {
    version: 1,
    pending: Array.isArray(stored.pending) ? stored.pending.filter(validPending).slice(-MAX_PENDING) : [],
    recent: Array.isArray(stored.recent) ? stored.recent.filter((entry) =>
      typeof entry?.key === 'string' && typeof entry?.reportId === 'string' &&
      UUID.test(entry.reportId)).slice(-MAX_RECENT) : [],
    day: today,
    acceptedToday: stored.day === today && Number.isSafeInteger(stored.acceptedToday)
      ? Math.max(0, stored.acceptedToday!) : 0,
    retryAt: typeof stored.retryAt === 'number' && Number.isFinite(stored.retryAt)
      ? stored.retryAt : 0,
  };
}

function saveState(state: LocalState): boolean {
  try {
    const serialized = JSON.stringify(state);
    storage.set(STORAGE_KEY, serialized);
    return storage.getString(STORAGE_KEY) === serialized;
  } catch {
    return false;
  }
}

function reportKey(input: WordReportInput, normalizedWord: string): string {
  const { context } = input;
  return [context.mode, context.globalLevel, context.contentVersion,
    context.levelFingerprint, normalizedWord, input.reportKind].join('|');
}

function newReportId(): string {
  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  let entropy = Date.now();
  return template.replace(/[xy]/g, (placeholder) => {
    const random = Math.floor(Math.random() * 16);
    const digit = (random + (entropy % 16)) % 16;
    entropy = Math.floor(entropy / 16);
    return (placeholder === 'y' ? (digit & 3) | 8 : digit).toString(16);
  });
}

function validContext(context: WordReportContext): boolean {
  return Number.isSafeInteger(context.globalLevel) && context.globalLevel >= 1 &&
    context.globalLevel <= 1000 && /^[a-z0-9_-]{1,64}$/i.test(context.world) &&
    (context.mode === 'normal' || context.mode === 'daily') &&
    /^[A-Za-z0-9._-]{1,128}$/.test(context.contentVersion) &&
    (context.policyRevision === null ||
      (Number.isSafeInteger(context.policyRevision) && context.policyRevision >= 1));
}

/** Shipped SHA-256 levels and verified current or resumed intro content. */
export function canReportWord(context: WordReportContext): boolean {
  if (!validContext(context)) return false;
  if (/^[a-f0-9]{64}$/.test(context.levelFingerprint)) return true;
  return context.mode === 'normal' &&
    context.world === 'world1' &&
    getIntroLevelForFingerprint(context.globalLevel, context.levelFingerprint, context.contentVersion) !== null;
}

const inflight = new Map<string, Promise<WordReportResult>>();

async function deliver(entry: Pending): Promise<WordReportResult> {
  const already = inflight.get(entry.report.reportId);
  if (already) return already;
  const task = (async (): Promise<WordReportResult> => {
    const token = useProfile.getState().profile?.authToken;
    if (!token) return { status: 'auth_required', reportId: entry.report.reportId };
    let response: Response;
    try {
      response = await fetch(`${ENV.apiUrl}/api/word-reports`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'idempotency-key': entry.report.reportId,
        },
        body: JSON.stringify(entry.report),
      });
    } catch {
      return { status: 'queued', reportId: entry.report.reportId };
    }
    const body = await response.json().catch(() => ({})) as {
      duplicate?: boolean;
      retryAfterSeconds?: number;
    };
    const state = loadState();
    if (response.status === 200 || response.status === 201) {
      state.pending = state.pending.filter(({ report }) => report.reportId !== entry.report.reportId);
      if (!body.duplicate) state.acceptedToday += 1;
      state.recent.push({ key: entry.key, reportId: entry.report.reportId, at: new Date().toISOString() });
      state.recent = state.recent.slice(-MAX_RECENT);
      if (!saveState(state)) return { status: 'save_failed', reportId: entry.report.reportId };
      return { status: body.duplicate ? 'duplicate' : 'sent', reportId: entry.report.reportId };
    }
    if (response.status === 429) {
      const wait = Number.isFinite(body.retryAfterSeconds) ?
        Math.max(60, Math.min(86_400, body.retryAfterSeconds!)) : 3_600;
      state.retryAt = Date.now() + wait * 1_000;
      if (!saveState(state)) return { status: 'save_failed', reportId: entry.report.reportId };
      return { status: 'rate_limited', reportId: entry.report.reportId, retryAfterSeconds: wait };
    }
    if (response.status === 401) return { status: 'auth_required', reportId: entry.report.reportId };
    if (response.status === 400 || response.status === 404 || response.status === 409 || response.status === 422) {
      state.pending = state.pending.filter(({ report }) => report.reportId !== entry.report.reportId);
      if (!saveState(state)) return { status: 'save_failed', reportId: entry.report.reportId };
      return { status: response.status === 404 ? 'unavailable' : 'invalid', reportId: entry.report.reportId };
    }
    return { status: 'queued', reportId: entry.report.reportId };
  })();
  inflight.set(entry.report.reportId, task);
  try {
    return await task;
  } finally {
    inflight.delete(entry.report.reportId);
  }
}

/** User confirmation is required before the raw word enters this local queue. */
export async function sendWordReport(input: WordReportInput): Promise<WordReportResult> {
  const normalized = normalizeSubmission(input.word.trim());
  if (!normalized.ok) return { status: 'invalid' };
  if (!canReportWord(input.context)) return { status: 'unsupported_content' };
  const state = loadState();
  const key = reportKey(input, normalized.word);
  const recent = state.recent.find((item) => item.key === key);
  if (recent) return { status: 'duplicate', reportId: recent.reportId };
  const pending = state.pending.find((item) => item.key === key);
  if (state.retryAt > Date.now()) {
    return { status: 'rate_limited', reportId: pending?.report.reportId,
      retryAfterSeconds: Math.ceil((state.retryAt - Date.now()) / 1_000) };
  }
  if (pending) return deliver(pending);
  if (state.acceptedToday + state.pending.length >= MAX_DAILY || state.pending.length >= MAX_PENDING) {
    return { status: 'rate_limited' };
  }
  const report: WordReport = {
    ...input.context,
    reportId: newReportId(),
    createdAt: new Date().toISOString(),
    locale: 'ru',
    normalizedWord: normalized.word,
    reportKind: input.reportKind,
    currentClassification: input.currentClassification,
    appVersion: app.expo.version,
  };
  const entry = { key, report };
  state.pending.push(entry);
  if (!saveState(state)) return { status: 'save_failed' };
  return deliver(entry);
}

/** Replay only reports for which the player already pressed Send. Safe to call after auth or on launch. */
export async function flushWordReports(): Promise<void> {
  const state = loadState();
  if (state.retryAt > Date.now()) return;
  for (const entry of state.pending) {
    const result = await deliver(entry);
    if (result.status === 'rate_limited' || result.status === 'auth_required' ||
        result.status === 'queued' || result.status === 'save_failed') return;
  }
}
