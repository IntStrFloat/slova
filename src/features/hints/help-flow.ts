import { create } from 'zustand';

import { ECONOMY } from '@/core/config/economy';
import type { Level } from '@/core/engine/types';
import { getJSON, KEYS, storage } from '@/core/storage';
import { isDayKey } from '@/core/time';
import { safeAnalyticsId } from '@/features/analytics/schema';
import { useCurrency } from '@/features/currency';
import { useDailyPuzzle } from '@/features/dailypuzzle';
import { loadGameSnapshot, restoreGame, type GameSnapshot } from '@/features/game/persistence';
import { useGame } from '@/features/game/store';
import { clueForUnsolved } from '@/features/game/editorialClues';
import { loadGlobalLevel } from '@/features/levels';
import { newMonetizationId } from '@/features/monetization/adTelemetry';
import { isFreeIntroHelpLevel } from '@/features/onboarding/onboardingHelp';

import { isSemanticClueUnlocked } from './index';

export type RequestedHint = 'letter' | 'semantic';
export type HelpFlowStatus = 'requested' | 'returned' | 'applied' | 'closed';

export interface HelpFlow {
  version: 1;
  id: string;
  attemptId: string;
  levelKey: string;
  levelId: number;
  mode: 'campaign' | 'daily';
  dateKey?: string;
  contentVersion: string;
  contentFingerprint?: string;
  requestedHint: RequestedHint;
  displayedCost: number;
  balance: number;
  entrySource: string;
  createdAtMs: number;
  previouslyCompleted: boolean | null;
  /** Private recovery guard; the actual game snapshot remains the source of hint application. */
  initialLetterHintCount?: number;
  uxVariant: 'control' | 'clarity';
  status: HelpFlowStatus;
}

export type HelpFlowInput = Omit<HelpFlow, 'version' | 'id' | 'createdAtMs' | 'status' | 'uxVariant'> & {
  id?: string;
  uxVariant?: HelpFlow['uxVariant'];
  createdAtMs?: number;
};
const FLOW_FIELDS = new Set(['version', 'id', 'attemptId', 'levelKey', 'levelId', 'mode', 'dateKey', 'contentVersion',
  'contentFingerprint', 'requestedHint', 'displayedCost', 'balance', 'entrySource', 'createdAtMs', 'previouslyCompleted',
  'initialLetterHintCount', 'uxVariant', 'status']);

export function isHelpFlow(value: unknown): value is HelpFlow {
  if (!value || typeof value !== 'object') return false;
  const flow = value as HelpFlow;
  return Object.keys(flow).every((key) => FLOW_FIELDS.has(key))
    && flow.version === 1 && typeof flow.id === 'string' && safeAnalyticsId(flow.id)
    && typeof flow.attemptId === 'string' && safeAnalyticsId(flow.attemptId)
    && typeof flow.levelKey === 'string' && safeAnalyticsId(flow.levelKey)
    && Number.isSafeInteger(flow.levelId) && flow.levelId > 0
    && (flow.mode === 'campaign' || flow.mode === 'daily')
    && (flow.mode !== 'daily' || typeof flow.dateKey === 'string' && isDayKey(flow.dateKey))
    && flow.levelKey === (flow.mode === 'daily' ? `daily:${flow.dateKey}` : `campaign:${flow.levelId}`)
    && typeof flow.contentVersion === 'string' && safeAnalyticsId(flow.contentVersion)
    && (flow.contentFingerprint === undefined || typeof flow.contentFingerprint === 'string' && safeAnalyticsId(flow.contentFingerprint))
    && (flow.requestedHint === 'letter' || flow.requestedHint === 'semantic')
    && Number.isSafeInteger(flow.displayedCost) && flow.displayedCost >= 0
    && Number.isSafeInteger(flow.balance) && flow.balance >= 0
    && typeof flow.entrySource === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(flow.entrySource)
    && Number.isSafeInteger(flow.createdAtMs) && flow.createdAtMs > 0
    && (flow.previouslyCompleted === null || typeof flow.previouslyCompleted === 'boolean')
    && (flow.initialLetterHintCount === undefined || Number.isSafeInteger(flow.initialLetterHintCount) && flow.initialLetterHintCount >= 0)
    && (flow.uxVariant === 'control' || flow.uxVariant === 'clarity')
    && ['requested', 'returned', 'applied', 'closed'].includes(flow.status);
}

function readFlows(): Record<string, HelpFlow> {
  const saved = getJSON<unknown>(KEYS.helpFlows, {});
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
  return Object.fromEntries(Object.entries(saved).filter(([id, flow]) => isHelpFlow(flow) && flow.id === id)
    .map(([id, flow]) => [id, { ...(flow as HelpFlow), previouslyCompleted: (flow as HelpFlow).previouslyCompleted === true ? true : null }]));
}

function persist(flows: Record<string, HelpFlow>): void {
  const value = JSON.stringify(flows);
  storage.set(KEYS.helpFlows, value);
  if (storage.getString(KEYS.helpFlows) !== value) throw new Error('Help request was not saved');
}

export const useHelpFlows = create<{ flows: Record<string, HelpFlow> }>(() => ({ flows: readFlows() }));

export function getHelpFlow(id: string | undefined): HelpFlow | null {
  const flows = useHelpFlows.getState().flows;
  return id && safeAnalyticsId(id) && Object.hasOwn(flows, id) ? flows[id] : null;
}

/** One explicit request owns its origin ID; navigation and retries retain it. */
export function createHelpFlow(input: HelpFlowInput): HelpFlow {
  const flow: HelpFlow = { version: 1, id: input.id ?? newMonetizationId('help'),
    attemptId: input.attemptId, levelKey: input.levelKey, levelId: input.levelId, mode: input.mode,
    ...(input.dateKey !== undefined ? { dateKey: input.dateKey } : {}), contentVersion: input.contentVersion,
    ...(input.contentFingerprint !== undefined ? { contentFingerprint: input.contentFingerprint } : {}),
    requestedHint: input.requestedHint, displayedCost: input.displayedCost, balance: input.balance,
    entrySource: input.entrySource, previouslyCompleted: input.previouslyCompleted,
    ...(input.initialLetterHintCount !== undefined ? { initialLetterHintCount: input.initialLetterHintCount } : {}),
    createdAtMs: input.createdAtMs ?? Date.now(), status: 'requested', uxVariant: input.uxVariant ?? 'control' };
  if (!isHelpFlow(flow)) throw new Error('Invalid help request');
  const existing = getHelpFlow(flow.id);
  if (existing) {
    if (existing.attemptId !== flow.attemptId || existing.requestedHint !== flow.requestedHint) throw new Error('Help request identity conflict');
    return existing;
  }
  const current = useHelpFlows.getState().flows;
  // Unresolved requests can still be referenced by a native earned receipt.
  const terminal = Object.values(current).filter((item) => item.status === 'applied' || item.status === 'closed')
    .sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 32);
  const retained = Object.fromEntries(Object.entries(current).filter(([, item]) => item.status !== 'applied' && item.status !== 'closed'));
  const flows = { ...retained, ...Object.fromEntries(terminal.map((item) => [item.id, item])), [flow.id]: flow };
  persist(flows);
  useHelpFlows.setState({ flows });
  return flow;
}

function setStatus(id: string, status: HelpFlowStatus): void {
  const current = useHelpFlows.getState().flows;
  const flow = Object.hasOwn(current, id) ? current[id] : undefined;
  if (!flow || flow.status === status || flow.status === 'applied' || flow.status === 'closed') return;
  const flows = { ...current, [id]: { ...flow, status } };
  persist(flows);
  useHelpFlows.setState({ flows });
}

export function markHelpFlowReturned(id: string): void { setStatus(id, 'returned'); }
export function markHelpFlowApplied(id: string): void { setStatus(id, 'applied'); }
export function closeHelpFlow(id: string): void { setStatus(id, 'closed'); }

/** Enrollment keeps the immutable original even when the UI projection was interrupted. */
export function restoreHelpFlowProjection(flow: HelpFlow): void {
  if (!isHelpFlow(flow) || getHelpFlow(flow.id)) return;
  const flows = { ...useHelpFlows.getState().flows, [flow.id]: flow };
  persist(flows); useHelpFlows.setState({ flows });
}
let resolveVariant: (flow: HelpFlow) => HelpFlow['uxVariant'] = () => 'control';
export function setHelpFlowVariantResolver(resolver: typeof resolveVariant): void { resolveVariant = resolver; }

/** Only bounded IDs/categories and displayed numbers enter telemetry or the native receipt. */
export function helpFlowProperties(flow: HelpFlow): Record<string, string | number | boolean> {
  return { origin_interaction_id: flow.id, attemptId: flow.attemptId, levelKey: flow.levelKey,
    levelId: flow.levelId, mode: flow.mode, contentVersion: flow.contentVersion,
    ...(flow.contentFingerprint ? { content_fingerprint: flow.contentFingerprint } : {}),
    ...(flow.dateKey ? { dateKey: flow.dateKey } : {}),
    requested_hint: flow.requestedHint, displayed_cost: flow.displayedCost,
    entry_source: flow.entrySource, balance: flow.balance,
    ...(flow.previouslyCompleted !== null ? { previously_completed: flow.previouslyCompleted } : {}) };
}

function resumeContext(flow: HelpFlow): { snapshot: GameSnapshot; level: Level } | null {
  const mode = flow.mode === 'daily' ? 'daily' : 'normal';
  const snapshot = loadGameSnapshot(mode, undefined, flow.dateKey);
  if (!snapshot || snapshot.attemptId !== flow.attemptId || snapshot.globalLevel !== flow.levelId
    || snapshot.contentVersion !== flow.contentVersion || snapshot.completion.status !== 'playing') return null;
  const live = useGame.getState();
  const level = live.snapshot?.attemptId === flow.attemptId && live.level ? live.level
    : flow.mode === 'daily' ? useDailyPuzzle.getState().instances[flow.dateKey!]?.level ?? null
    : loadGlobalLevel(flow.levelId);
  if (!level) return null;
  const restored = restoreGame(level, mode, snapshot, flow.dateKey);
  return restored ? { snapshot: restored.snapshot, level } : null;
}

/** Never authorizes a restart: even an identical puzzle with another attempt ID is different. */
export function canResumeHelpFlow(flow: HelpFlow): boolean { return resumeContext(flow) !== null; }

export function currentHelpQuote(flow: HelpFlow): {
  price: number; balance: number; deficit: number; canResume: boolean;
  alreadyOwned: boolean; free: boolean; helpAvailable: boolean; hintName: string;
} {
  const context = resumeContext(flow);
  const balance = useCurrency.getState().coins;
  const free = Boolean(context && isFreeIntroHelpLevel(context.level, flow.mode === 'daily' ? 'daily' : 'normal'));
  const word = context?.level.answers.find((answer) => !context.snapshot.solvedWords.includes(answer.word))?.word;
  const alreadyOwned = Boolean(context && flow.requestedHint === 'semantic' && word
    && isSemanticClueUnlocked(flow.levelKey, context.snapshot.levelFingerprint, word));
  const price = free || alreadyOwned ? 0 : flow.requestedHint === 'letter' ? ECONOMY.hints.bulb : ECONOMY.hints.clue;
  const helpAvailable = Boolean(context && flow.status !== 'applied' && flow.status !== 'closed'
    && !(flow.requestedHint === 'letter' && flow.initialLetterHintCount !== undefined
      && (context.snapshot.hintsUsed?.length ?? 0) > flow.initialLetterHintCount)
    && (flow.requestedHint === 'semantic' ? clueForUnsolved(context.level, context.snapshot.solvedWords)
      : context.level.grid.cells.some((cell) => context.snapshot.filled[`${cell.row},${cell.col}`] !== cell.ch)));
  return { price, balance, deficit: Math.max(0, price - balance), canResume: context !== null,
    alreadyOwned, free, helpAvailable, hintName: flow.requestedHint === 'semantic' ? 'наводку' : 'букву' };
}

export function helpFlowGameHref(flow: HelpFlow) {
  return { pathname: '/game' as const, params: { helpFlowId: flow.id, source: 'help_return',
    ...(flow.mode === 'daily' ? { mode: 'daily', date: flow.dateKey! } : {}) } };
}

/** A cold-launch recovery offer is tied to a saved explicit request, never inferred from errors. */
export function latestResumableHelpFlow(attemptId?: string): HelpFlow | null {
  return Object.values(useHelpFlows.getState().flows)
    .filter((flow) => resolveVariant(flow) === 'clarity' && (flow.status === 'requested' || flow.status === 'returned')
      && (!attemptId || flow.attemptId === attemptId))
    .reverse().sort((a, b) => b.createdAtMs - a.createdAtMs)
    .find((flow) => currentHelpQuote(flow).helpAvailable) ?? null;
}
