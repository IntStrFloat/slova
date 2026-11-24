import { create } from 'zustand';
import { AppState, Platform } from 'react-native';

import { HELP_EXPERIMENT_CONFIG, HELP_EXPERIMENT_EVIDENCE, HELP_EXPERIMENT_ID, helpSafeId,
  isHelpEvidenceRef, validateHelpExperimentReadiness, type HelpExperimentMeasurementConfigV1,
  helpExperimentPlanFingerprint, type HelpExperimentEvidenceV1, type MeasurementPhase } from '@/core/config/helpExperiment';
import { getString, KEYS, removeKey, storage } from '@/core/storage';
import { captureHelpEnrollmentFact, enqueueCapturedHelpFact, getAnalyticsConsentEpoch, isAnalyticsCollectionEnabled,
  isCapturedHelpFact, trackOnce, useAnalyticsPrefs, type CapturedHelpFact } from '@/features/analytics';
import { analyticsKeyToken } from '@/features/analytics/dedupe';
import { chooseExperimentVariant } from '@/features/analytics/experiments';
import { getSdkIdentitySnapshot, primeSdkIdentity, subscribeSdkIdentity, validSdkPlayerId, type SdkIdentitySnapshot } from '@/features/analytics/sdkIdentity';
import { subscribeCheckoutTechnicalFailure } from '@/features/analytics/subscription';
import { useCurrency, type WalletTransactionRecord } from '@/features/currency';
import { createHelpExperimentStopAdapter, type StopFact, type StopScope } from '@/features/remote-config/helpExperimentStop';
import { useProfile } from '@/features/profile';
import { useLevels } from '@/features/levels/store';
import { useDailyPuzzle } from '@/features/dailypuzzle';

import { getHelpFlow, helpFlowProperties, isHelpFlow, restoreHelpFlowProjection, setHelpFlowVariantResolver, type HelpFlow } from './help-flow';

type Variant = 'control' | 'treatment';
type Block = { phase: MeasurementPhase; epoch: string };
type Continuity = { deviceId: string; installationId: string; sinceAtMs: number; profileToken: string | null };
type Claim = { phase: MeasurementPhase; epoch: string; origin: HelpFlow; assignmentId: string | null;
  allocationVersion: number | null; variant: Variant; planFingerprint: string | null; facts: { fact: CapturedHelpFact; retired: boolean }[] };
type Journal = { version: 1; owner: Continuity; claims: Claim[]; bindings: Record<string, string> };
type SafetyLatch = { version: 1; experimentId: typeof HELP_EXPERIMENT_ID; epoch: string; reason: 'duplicate_reward_credit' | 'broken_checkout' };
export type CapturedHelpRequest = { flow: HelpFlow; requestedAtMs: number; interactionId: string;
  isAvailable: boolean; alreadyOwned: boolean; free: boolean; previouslyCompleted: boolean | null };
export type HelpEnrollmentResult = { status: 'off' | 'ineligible' | 'unknown' | 'baseline_first' | 'trial_first' | 'participant';
  firstRequestProperties: Record<string, string | number | boolean>; uxVariant: 'control' | 'clarity'; captured: boolean };
export type HelpExposurePoint = 'no_coins' | 'wheel' | 'home_help_resume' | 'game_help_resume';
export type HelpVisibility = { layoutReady: boolean; routeFocused: boolean; windowFocused: boolean; active: boolean };
type Dependencies = {
  config: HelpExperimentMeasurementConfigV1; evidence: HelpExperimentEvidenceV1 | null;
  read(key: string): string | null; write(key: string, value: string): boolean; remove(key: string): void;
  identity(): SdkIdentitySnapshot; collectionEnabled(): boolean; consentEpoch(): number | null;
  profileToken(): string | null; now(): number;
  stopControl(): { connected: boolean; enrollmentAllowed: boolean; disabledVariants: readonly Variant[] };
  capture: typeof captureHelpEnrollmentFact; enqueue: typeof enqueueCapturedHelpFact;
  restoreFlow(flow: HelpFlow): void; event: typeof trackOnce; changed(): void;
};
const scopeKey = (phase: MeasurementPhase, epoch: string) => `${phase}:${epoch}`;
const planFingerprint = helpExperimentPlanFingerprint;
const commonProofKeys = ['producerRollout', 'rawIngestion', 'originAndDedupeProof', 'identityHistoryContinuity', 'commonTechnicalSafety'] as const;
export const useHelpExperimentState = create<{ revision: number }>(() => ({ revision: 0 }));

/** Denial journals must distinguish an absent key from failed IO or a non-string MMKV value. */
export function readHelpExperimentJournal(key: string): string | null {
  const raw = storage.getString(key);
  if (raw === undefined) {
    if (storage.contains(key)) throw new Error('Invalid help experiment journal type');
    return null;
  }
  if (typeof raw !== 'string') throw new Error('Invalid help experiment journal type');
  return raw;
}

/** Domain controller has explicit ports for deterministic fixtures; production uses the singleton below. */
export function createHelpExperimentController(d: Dependencies) {
  const blocked = new Set<string>();
  let journalFailure = false;
  let preparing = false, presenting = false;
  const write = (key: string, value: string) => { try { return d.write(key, value) === true; } catch { return false; } };
  const changed = () => { try { d.changed(); } catch { /* Optional UI observers cannot change a journal decision or a payment. */ } };
  const parse = (key: string): unknown => {
    try { const raw = d.read(key); return raw === null ? null : JSON.parse(raw); } catch { journalFailure = true; return false; }
  };
  type NegativeRead<T> = { raw: string | null; value: T } | null;
  function readNegative<T>(key: string, absent: T, valid: (value: unknown) => value is T): NegativeRead<T> {
    try {
      const raw = d.read(key);
      if (raw === null) return { raw, value: absent };
      const value: unknown = JSON.parse(raw);
      if (valid(value)) return { raw, value };
    } catch { /* The current call must observe this failure, including the first read. */ }
    journalFailure = true; return null;
  }
  function blocks(): NegativeRead<Block[]> {
    return readNegative(KEYS.helpEnrollmentBlocks, [], (value): value is Block[] => Array.isArray(value)
      && value.every((b) => b && typeof b === 'object' && !Array.isArray(b)
        && ['baseline', 'trial'].includes(b.phase) && helpSafeId(b.epoch)
        && Object.keys(b).length === 2 && Object.keys(b).every((key) => ['phase', 'epoch'].includes(key))));
  }
  function safety(): NegativeRead<SafetyLatch | null> {
    return readNegative<SafetyLatch | null>(KEYS.helpTrialSafety, null, (value): value is SafetyLatch => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const latch = value as SafetyLatch;
      return latch.version === 1 && latch.experimentId === HELP_EXPERIMENT_ID && helpSafeId(latch.epoch)
        && ['duplicate_reward_credit', 'broken_checkout'].includes(latch.reason)
        && Object.keys(latch).length === 4 && Object.keys(latch).every((key) => ['version', 'experimentId', 'epoch', 'reason'].includes(key));
    });
  }
  function negativeJournals(): { blocks: Block[]; safety: SafetyLatch | null } | null {
    // Complete both reads before deciding. JSON null/false is a supplied invalid record, not absence.
    const savedBlocks = blocks(), savedSafety = safety();
    if (!savedBlocks || !savedSafety) return null;
    try {
      // A reentrant storage observer cannot substitute a changed negative ledger during the pair read.
      if (d.read(KEYS.helpEnrollmentBlocks) !== savedBlocks.raw || d.read(KEYS.helpTrialSafety) !== savedSafety.raw) {
        journalFailure = true; return null;
      }
    } catch { journalFailure = true; return null; }
    return journalFailure ? null : { blocks: savedBlocks.value, safety: savedSafety.value };
  }
  function blockCurrentEpoch(phaseOverride?: MeasurementPhase): void {
    const saved = blocks();
    const current = phaseOverride ?? phaseAt(d.now(), false);
    for (const phase of current ? [current] : []) {
      const epoch = d.config[phase]?.eligibilityEpoch;
      if (!helpSafeId(epoch)) continue;
      blocked.add(scopeKey(phase, epoch));
      if (saved && !saved.value.some((b) => b.phase === phase && b.epoch === epoch)) saved.value.push({ phase, epoch });
    }
    if (saved?.value.length && !write(KEYS.helpEnrollmentBlocks, JSON.stringify(saved.value))) journalFailure = true;
    changed();
  }
  function readJournal(): Journal | null {
    const raw = parse(KEYS.helpEnrollment);
    if (raw === null) return null;
    const j = raw as Journal;
    const owner = j?.owner;
    const valid = !!j && j.version === 1 && !!owner && validSdkPlayerId(owner.deviceId)
      && helpSafeId(owner.installationId) && Number.isSafeInteger(owner.sinceAtMs) && owner.sinceAtMs > 0
      && (owner.profileToken === null || helpSafeId(owner.profileToken)) && Array.isArray(j.claims) && j.claims.length <= 2
      && !!j.bindings && typeof j.bindings === 'object' && !Array.isArray(j.bindings)
      && Object.entries(j.bindings).every(([key, value]) => helpSafeId(key) && typeof value === 'string' && value.length <= 220)
      && j.claims.every((c) => c && ['baseline', 'trial'].includes(c.phase) && helpSafeId(c.epoch) && isHelpFlow(c.origin)
        && c.origin.previouslyCompleted === false && c.origin.displayedCost > c.origin.balance
        && ['control', 'treatment'].includes(c.variant) && (c.phase === 'baseline' ? c.assignmentId === null && c.allocationVersion === null && c.variant === 'control' && c.planFingerprint === null
          : helpSafeId(c.assignmentId) && Number.isSafeInteger(c.allocationVersion) && Number(c.allocationVersion) > 0 && /^[a-f0-9]{32}$/.test(c.planFingerprint ?? ''))
        && Array.isArray(c.facts) && c.facts.length === (c.phase === 'trial' ? 3 : 2)
        && new Set(c.facts.map((entry) => entry?.fact?.name)).size === c.facts.length
        && c.facts.every((entry) => typeof entry?.retired === 'boolean' && isCapturedHelpFact(entry.fact)
          && entry.fact.envelope.origin_interaction_id === c.origin.id && entry.fact.envelope.attemptId === c.origin.attemptId
          && entry.fact.envelope.occurredAtMs === c.origin.createdAtMs && entry.fact.envelope.measurement_phase === c.phase
          && entry.fact.envelope.eligibility_epoch === c.epoch && entry.fact.envelope.device_key === owner.deviceId
          && entry.fact.envelope.install_key === owner.installationId && consistentClaimFact(c, entry.fact)))
      && new Set(j.claims.map((c) => c.phase)).size === j.claims.length;
    if (!valid) { journalFailure = true; return null; }
    return j;
  }
  function save(j: Journal): boolean {
    if (!write(KEYS.helpEnrollment, JSON.stringify(j))) { journalFailure = true; blockCurrentEpoch(); return false; }
    changed(); return true;
  }
  function identityMatches(j: Journal): boolean {
    const id = d.identity(), token = d.profileToken();
    return id.status === 'ready' && id.deviceId === j.owner.deviceId && id.installationId === j.owner.installationId
      && (j.owner.profileToken === null || token === j.owner.profileToken);
  }
  function observeIdentity(): void {
    if (!d.collectionEnabled() || d.config.identityPolicy !== 'known_pre_epoch_continuity_only_v1') return;
    const id = d.identity(); if (id.status !== 'ready') return;
    const j = readJournal();
    if (j && !identityMatches(j)) { blockCurrentEpoch(); d.remove(KEYS.helpEnrollment); return; }
    if (j && j.owner.profileToken === null && d.profileToken() !== null) save({ ...j, owner: { ...j.owner, profileToken: d.profileToken() } });
    if (!j && !journalFailure) save({ version: 1, owner: { deviceId: id.deviceId, installationId: id.installationId,
      sinceAtMs: d.now(), profileToken: d.profileToken() }, claims: [], bindings: {} });
  }
  function phaseAt(time: number, requireEnabled = true): MeasurementPhase | null {
    for (const phase of ['trial', 'baseline'] as const) {
      const config = d.config[phase];
      if ((!requireEnabled || config?.enabled) && helpSafeId(config.eligibilityEpoch) && time >= Date.parse(config.enrollmentFrom ?? '')
        && time < Date.parse(config.enrollmentToExclusive ?? '')) return phase;
    }
    return null;
  }
  function safe(phase: MeasurementPhase, time: number): boolean {
    const c = d.config[phase], epoch = c.eligibilityEpoch;
    const readiness = validateHelpExperimentReadiness(d.config, d.evidence);
    const proofs = phase === 'baseline' ? commonProofKeys : [...commonProofKeys, 'stopControl', 'rewardGuardObservability',
      'adGuardObservability', 'checkoutObservability', 'returnGuardObservability', 'timeAndWalletGuardObservability'] as const;
    const policyAllowed = d.collectionEnabled() && phaseAt(time) === phase
      && (phase === 'baseline' ? readiness.baselineReady : readiness.trialReady && d.stopControl().connected)
      && proofs.every((key) => isHelpEvidenceRef(d.evidence?.[key], d.config.definitionHash) && d.evidence?.[key].sourceKind === 'production');
    const negative = negativeJournals();
    return !!epoch && !!negative && !journalFailure && policyAllowed && !blocked.has(scopeKey(phase, epoch))
      && !negative.blocks.some((b) => b.phase === phase && b.epoch === epoch) && !negative.safety;
  }
  function presentationClaim(flow: HelpFlow | null): Claim | null {
    if (preparing || presenting) return null;
    presenting = true;
    try {
      if (!flow || !isHelpFlow(flow) || !safe('trial', d.now())) return null;
      const j = readJournal(); if (!j || !identityMatches(j)) return null;
      const key = j.bindings[flow.id];
      const claim = j.claims.find((claim) => key === scopeKey(claim.phase, claim.epoch) && claim.phase === 'trial'
        && claim.epoch === d.config.trial.eligibilityEpoch && claim.allocationVersion === d.config.trial.allocationVersion
        && claim.planFingerprint === planFingerprint(d.config)
        && claim.origin.createdAtMs <= flow.createdAtMs && !d.stopControl().disabledVariants.includes(claim.variant)) ?? null;
      return claim && safe('trial', d.now()) ? claim : null;
    } finally { presenting = false; }
  }
  function resolve(flow: HelpFlow | null): 'control' | 'clarity' {
    return presentationClaim(flow)?.variant === 'treatment' ? 'clarity' : 'control';
  }
  function prepareRequest(input: CapturedHelpRequest): HelpEnrollmentResult {
    const empty = (status: HelpEnrollmentResult['status']): HelpEnrollmentResult => ({ status, uxVariant: resolve(input.flow), firstRequestProperties: {}, captured: false });
    const phase = phaseAt(input.requestedAtMs), flow = input.flow;
    if (!phase) {
      if (phaseAt(input.requestedAtMs, false) && isHelpFlow(flow) && input.isAvailable && !input.free && !input.alreadyOwned
        && flow.displayedCost > flow.balance) blockCurrentEpoch(phaseAt(input.requestedAtMs, false)!);
      return empty('off');
    }
    if (!isHelpFlow(flow) || !helpSafeId(input.interactionId) || !Number.isSafeInteger(input.requestedAtMs)
      || input.requestedAtMs <= 0 || input.requestedAtMs > d.now() || !input.isAvailable || input.free || input.alreadyOwned
      || flow.displayedCost <= 0 || flow.balance >= flow.displayedCost) return empty('ineligible');
    const id = d.identity(), epoch = d.config[phase].eligibilityEpoch!;
    if (!d.collectionEnabled() || id.status !== 'ready') { blockCurrentEpoch(); return empty('unknown'); }
    const j = readJournal();
    if (!j || !identityMatches(j) || j.owner.sinceAtMs >= Date.parse(d.config[phase].enrollmentFrom ?? '')
      || (d.consentEpoch() !== null && d.consentEpoch()! >= Date.parse(d.config[phase].enrollmentFrom ?? ''))) {
      blockCurrentEpoch(); return empty('unknown');
    }
    const existing = j.claims.find((c) => c.phase === phase && c.epoch === epoch);
    if (j.claims.some((claim) => claim.phase === phase && claim.epoch !== epoch)) { blockCurrentEpoch(phase); return empty('unknown'); }
    const key = scopeKey(phase, epoch);
    if (!safe(phase, input.requestedAtMs)) {
      if (!existing) blockCurrentEpoch(phase);
      else if (!j.bindings[flow.id]) save({ ...j, bindings: { ...j.bindings, [flow.id]: 'control' } });
      return empty('unknown');
    }
    if (existing) {
      if (phase === 'trial' && existing.planFingerprint !== planFingerprint(d.config)) { blockCurrentEpoch(); return empty('unknown'); }
      if (existing.origin.id === flow.id && input.interactionId === flow.id && input.requestedAtMs === existing.origin.createdAtMs) {
        flush(); return { ...empty('participant'), captured: true, firstRequestProperties: { first_eligible_request: true,
          eligibility_version: 'help_deficit_v1', measurement_phase: phase, eligibility_epoch: epoch,
          ...(existing.planFingerprint ? { trial_plan_fingerprint: existing.planFingerprint } : {}),
          previously_completed: false, occurredAtMs: existing.origin.createdAtMs } };
      }
      if (flow.createdAtMs === input.requestedAtMs && flow.id === input.interactionId && !j.bindings[flow.id]) {
        if (!save({ ...j, bindings: { ...j.bindings, [flow.id]: key } })) return empty('unknown');
      }
      return { ...empty('participant'), firstRequestProperties: { first_eligible_request: false,
        eligibility_version: 'help_deficit_v1', measurement_phase: phase, eligibility_epoch: epoch,
        ...(existing.planFingerprint ? { trial_plan_fingerprint: existing.planFingerprint } : {}) } };
    }
    if (input.previouslyCompleted === true) return empty('ineligible');
    if (phase === 'trial' && (!d.stopControl().enrollmentAllowed || d.stopControl().disabledVariants.length > 0)) { blockCurrentEpoch(phase); return empty('unknown'); }
    if (input.previouslyCompleted !== false || flow.createdAtMs !== input.requestedAtMs || flow.id !== input.interactionId) {
      blockCurrentEpoch(); return empty('unknown');
    }
    const origin: HelpFlow = { ...flow, previouslyCompleted: false, uxVariant: 'control' };
    const version = phase === 'trial' ? d.config.trial.allocationVersion : null;
    const variant = phase === 'trial' ? chooseExperimentVariant({ id: HELP_EXPERIMENT_ID, allocationVersion: version!,
      startsAt: d.config.trial.enrollmentFrom!, endsAt: d.config.trial.enrollmentToExclusive!,
      exposureScreens: [], variants: [{ id: 'control', weight: 1 }, { id: 'treatment', weight: 1 }] }, id.deviceId) as Variant | null : 'control';
    if (!variant) return empty('unknown');
    const assignmentId = phase === 'trial' ? `exp_${analyticsKeyToken(`${HELP_EXPERIMENT_ID}:${version}:${id.deviceId}`)}` : null;
    const properties = { ...helpFlowProperties(origin), interaction_id: input.interactionId, hint_type: flow.requestedHint,
      already_owned: false, is_available: true, previously_completed: false, first_eligible_request: true,
      eligibility_version: 'help_deficit_v1', measurement_phase: phase, eligibility_epoch: epoch, occurredAtMs: input.requestedAtMs,
      ...(phase === 'trial' ? { trial_plan_fingerprint: planFingerprint(d.config) } : {}) };
    const request = d.capture('hint_requested', `help:${key}:${flow.id}:request`, properties);
    const rejected = d.capture('hint_rejected', `help:${key}:${flow.id}:insufficient`, { ...properties, reason: 'insufficient_coins' });
    const facts = [request, rejected];
    if (phase === 'trial') facts.push(d.capture('experiment_assigned', assignmentId!, {
      ...canonicalOrigin(origin), experiment_id: HELP_EXPERIMENT_ID, assignment_id: assignmentId!, variant,
      allocation_version: version!, unit_type: 'sdk_player', eligibility_version: 'help_deficit_v1',
      measurement_phase: phase, eligibility_epoch: epoch, occurredAtMs: input.requestedAtMs,
      trial_plan_fingerprint: planFingerprint(d.config) }));
    if (facts.some((fact) => !fact || !d.config.acceptedOriginVersions?.includes(String(fact.envelope.app_version)))) {
      blockCurrentEpoch(); return empty('unknown');
    }
    if (!safe(phase, input.requestedAtMs)) { blockCurrentEpoch(phase); return empty('unknown'); }
    const claim: Claim = { phase, epoch, origin, variant, allocationVersion: version, assignmentId, planFingerprint: phase === 'trial' ? planFingerprint(d.config) : null,
      facts: (facts as CapturedHelpFact[]).map((fact) => ({ fact, retired: false })) };
    if (!save({ ...j, claims: [...j.claims, claim], bindings: { ...j.bindings, [flow.id]: key } })) return empty('unknown');
    flush();
    return { status: phase === 'trial' ? 'trial_first' : 'baseline_first', firstRequestProperties: properties,
      uxVariant: resolve(flow), captured: true };
  }
  function prepare(input: CapturedHelpRequest): HelpEnrollmentResult {
    const closed: HelpEnrollmentResult = { status: 'unknown', captured: false, uxVariant: 'control', firstRequestProperties: {} };
    if (preparing) return closed;
    preparing = true;
    let result: HelpEnrollmentResult;
    try { result = prepareRequest(input); }
    catch { blockCurrentEpoch(); result = closed; }
    finally { preparing = false; }
    return { ...result, uxVariant: resolve(input.flow) };
  }
  function flush(): void {
    if (!d.collectionEnabled() || !negativeJournals()) return;
    const j = readJournal(); if (!j || !identityMatches(j)) return;
    let changed = false;
    for (const claim of j.claims) {
      try { d.restoreFlow(claim.origin); } catch { /* The durable claim stays ITT with no exposure. */ }
      for (const entry of claim.facts) {
        if (entry.retired) continue;
        const result = d.enqueue(entry.fact);
        if (result === 'accepted' || result === 'expired' || result === 'invalid') { entry.retired = true; changed = true; }
        if (result === 'expired' || result === 'invalid') blockCurrentEpoch();
      }
    }
    if (changed) save(j);
  }
  function exposed(flow: HelpFlow | null, point: HelpExposurePoint, observedAtMs: number, visibility: HelpVisibility): void {
    if (!flow || !['no_coins', 'wheel', 'home_help_resume', 'game_help_resume'].includes(point)
      || !visibility.layoutReady || !visibility.routeFocused || !visibility.windowFocused || !visibility.active
      || !Number.isSafeInteger(observedAtMs) || observedAtMs > d.now()) return;
    const claim = presentationClaim(flow); if (!claim) return;
    d.event('experiment_exposed', `${claim.assignmentId}:${point}`, { ...canonicalOrigin(claim.origin),
      experiment_id: HELP_EXPERIMENT_ID, assignment_id: claim.assignmentId!, variant: claim.variant,
      allocation_version: claim.allocationVersion!, exposure_version: claim.allocationVersion!,
      eligibility_version: 'help_deficit_v1', measurement_phase: 'trial', eligibility_epoch: claim.epoch,
      trial_plan_fingerprint: claim.planFingerprint!,
      interaction_id: flow.id, exposure_point: point, occurredAtMs: observedAtMs });
  }
  function purge(): void {
    const j = readJournal(), saved = blocks();
    for (const claim of j?.claims ?? []) {
      blocked.add(scopeKey(claim.phase, claim.epoch));
      if (saved && !saved.value.some((b) => b.phase === claim.phase && b.epoch === claim.epoch)) saved.value.push({ phase: claim.phase, epoch: claim.epoch });
    }
    if (saved?.value.length && !write(KEYS.helpEnrollmentBlocks, JSON.stringify(saved.value))) journalFailure = true;
    blockCurrentEpoch(); d.remove(KEYS.helpEnrollment); changed();
  }
  function latch(reason: SafetyLatch['reason']): void {
    const epoch = d.config.trial.eligibilityEpoch;
    const savedSafety = safety();
    if (!helpSafeId(epoch) || phaseAt(d.now()) !== 'trial' || !savedSafety || savedSafety.value) return;
    const value: SafetyLatch = { version: 1, experimentId: HELP_EXPERIMENT_ID, epoch, reason };
    if (!write(KEYS.helpTrialSafety, JSON.stringify(value))) journalFailure = true;
    blocked.add(scopeKey('trial', epoch)); changed();
    d.event('technical_operation', `help_stop:${epoch}:${reason}`, { operation: 'help_trial_safety', stage: 'incident', result: 'failed', normalized_code: reason });
  }
  function inspectDurableWallet(raw: string | null): void {
    let wallet: { version?: number; appliedRewards?: Record<string, unknown>; operationTransactions?: Record<string, WalletTransactionRecord> };
    try { wallet = JSON.parse(raw ?? '{}'); } catch { return; }
    if (wallet?.version !== 2) return;
    const byReward = new Map<string, Set<string>>();
    for (const [effect, tx] of Object.entries(wallet.operationTransactions ?? {})) {
      if (wallet.appliedRewards?.[effect] !== 1 || !tx || !helpSafeId(tx.rewardId) || !helpSafeId(tx.id)
        || tx.currency !== 'coins' || !['wheel', 'rewarded'].includes(tx.source) || !Number.isSafeInteger(tx.delta) || tx.delta <= 0
        || !Number.isSafeInteger(tx.balanceBefore) || tx.balanceBefore < 0 || tx.balanceBefore + tx.delta !== tx.balanceAfter) continue;
      const ids = byReward.get(tx.rewardId) ?? new Set<string>(); ids.add(tx.id); byReward.set(tx.rewardId, ids);
      if (ids.size >= 2) { latch('duplicate_reward_credit'); return; }
    }
  }
  return { prepare, resolve, flush, exposed, observeIdentity, blockCurrentEpoch, purge, inspectDurableWallet,
    checkoutFailure: () => latch('broken_checkout') };
}
function canonicalOrigin(flow: HelpFlow): Record<string, string | number | boolean> {
  return { origin_interaction_id: flow.id, attemptId: flow.attemptId, levelId: flow.levelId, levelKey: flow.levelKey,
    mode: flow.mode, contentVersion: flow.contentVersion, ...(flow.contentFingerprint ? { content_fingerprint: flow.contentFingerprint } : {}),
    ...(flow.dateKey ? { dateKey: flow.dateKey } : {}) };
}
function consistentClaimFact(claim: Claim, fact: CapturedHelpFact): boolean {
  const e = fact.envelope, flow = claim.origin;
  if (!Object.entries(canonicalOrigin(flow)).every(([key, value]) => e[key] === value)
    || e.dateKey !== flow.dateKey || e.content_fingerprint !== flow.contentFingerprint || e.content_version !== flow.contentVersion) return false;
  if (claim.phase === 'trial' && e.trial_plan_fingerprint !== claim.planFingerprint) return false;
  if (fact.name === 'experiment_assigned') return claim.phase === 'trial' && e.assignment_id === claim.assignmentId
    && e.variant === claim.variant && e.allocation_version === claim.allocationVersion;
  return e.interaction_id === flow.id && e.hint_type === flow.requestedHint && e.requested_hint === flow.requestedHint
    && e.displayed_cost === flow.displayedCost && e.balance === flow.balance && e.entry_source === flow.entrySource
    && e.is_available === true && e.already_owned === false && e.previously_completed === false && e.first_eligible_request === true;
}
function profileToken(): string | null {
  try { const id = useProfile.getState().profile?.userId; return helpSafeId(id) ? analyticsKeyToken(id) : null; } catch { return null; }
}
type SavedRemoteStop = StopFact;
function remoteStops(): SavedRemoteStop[] | null {
  try {
    const raw = readHelpExperimentJournal(KEYS.helpTrialRemoteStop);
    if (raw === null) return [];
    const values = JSON.parse(raw) as SavedRemoteStop[];
    return Array.isArray(values) && values.every((v) => v?.scope?.experimentId === HELP_EXPERIMENT_ID
      && helpSafeId(v.scope.eligibilityEpoch) && Number.isSafeInteger(v.scope.allocationVersion) && v.scope.allocationVersion > 0
      && Number.isSafeInteger(v.revision) && v.revision > 0 && Array.isArray(v.disabledVariants)
      && v.disabledVariants.length <= 2 && v.disabledVariants.every((arm) => arm === 'control' || arm === 'treatment')
      && Object.keys(v).every((key) => ['scope', 'revision', 'disabledVariants'].includes(key))
      && Object.keys(v.scope).every((key) => ['experimentId', 'eligibilityEpoch', 'allocationVersion'].includes(key))) ? values : null;
  } catch { return null; }
}
const sameStopScope = (a: StopScope, b: StopScope) => a.experimentId === b.experimentId
  && a.eligibilityEpoch === b.eligibilityEpoch && a.allocationVersion === b.allocationVersion;
export function readHelpTrialRemoteStop(scope: StopScope): readonly Variant[] {
  const values = remoteStops();
  return values === null ? ['control', 'treatment'] : [...new Set(values.filter((v) => sameStopScope(v.scope, scope)).flatMap((v) => v.disabledVariants))];
}
export function persistHelpTrialRemoteStop(fact: StopFact): boolean {
  const values = remoteStops(); if (!values) return false;
  const prior = values.filter((v) => sameStopScope(v.scope, fact.scope));
  const stopped: SavedRemoteStop = { scope: { ...fact.scope }, revision: Math.max(fact.revision, ...prior.map((v) => v.revision)),
    disabledVariants: [...new Set([...prior.flatMap((v) => v.disabledVariants), ...fact.disabledVariants])] };
  const raw = JSON.stringify([...values.filter((v) => !sameStopScope(v.scope, fact.scope)), stopped]);
  try {
    storage.set(KEYS.helpTrialRemoteStop, raw);
    if (storage.getString(KEYS.helpTrialRemoteStop) !== raw) return false;
    useHelpExperimentState.setState((s) => ({ revision: s.revision + 1 })); return true;
  } catch { return false; }
}
const stopAdapter = createHelpExperimentStopAdapter({ readStopped: readHelpTrialRemoteStop, onStop: persistHelpTrialRemoteStop });
const controller = createHelpExperimentController({ config: HELP_EXPERIMENT_CONFIG, evidence: HELP_EXPERIMENT_EVIDENCE,
  read: readHelpExperimentJournal, write: (key, value) => { try { storage.set(key, value); return storage.getString(key) === value; } catch { return false; } }, remove: removeKey,
  identity: getSdkIdentitySnapshot, collectionEnabled: () => Platform.OS === 'android' && AppState.currentState === 'active' && isAnalyticsCollectionEnabled(), consentEpoch: getAnalyticsConsentEpoch,
  profileToken, now: Date.now, capture: captureHelpEnrollmentFact, enqueue: enqueueCapturedHelpFact,
  stopControl: stopAdapter.getSnapshot,
  restoreFlow: restoreHelpFlowProjection, event: trackOnce,
  changed: () => useHelpExperimentState.setState((s) => ({ revision: s.revision + 1 })) });
setHelpFlowVariantResolver(controller.resolve);
export const prepareHelpRequestDecision = controller.prepare;
export const flushHelpEnrollmentFacts = controller.flush;
export const blockHelpEnrollmentForCurrentEpoch = controller.blockCurrentEpoch;
export function resolveHelpUxVariant(flowOrId: HelpFlow | string | null): 'control' | 'clarity' {
  return controller.resolve(typeof flowOrId === 'string' ? getHelpFlow(flowOrId) : flowOrId);
}
export function exposeHelpExperiment(flowId: string, point: HelpExposurePoint, at: number, visibility: HelpVisibility): void {
  controller.exposed(getHelpFlow(flowId), point, at, visibility);
}
/** Prime only, then attach authoritative domain observers. No startup allocation or global-stop claim. */
export function startHelpExperimentRuntime(): () => void {
  let running = true;
  if (useAnalyticsPrefs.getState().optOut) controller.purge();
  const updateStopContext = () => {
    if (!running) return;
    const trial = HELP_EXPERIMENT_CONFIG.trial;
    const valid = helpSafeId(trial.eligibilityEpoch) && Number.isSafeInteger(trial.allocationVersion) && Number(trial.allocationVersion) > 0;
    stopAdapter.updateContext({ active: trial.enabled && valid, foreground: AppState.currentState === 'active',
      consentGranted: isAnalyticsCollectionEnabled(), consentGeneration: getSdkIdentitySnapshot().generation,
      scope: valid ? { experimentId: HELP_EXPERIMENT_ID, eligibilityEpoch: trial.eligibilityEpoch!, allocationVersion: trial.allocationVersion! } : null });
  };
  const ready = () => { if (running) { updateStopContext(); controller.observeIdentity(); controller.flush(); } };
  const stopRemote = stopAdapter.subscribe(() => useHelpExperimentState.setState((s) => ({ revision: s.revision + 1 })));
  const stopIdentity = subscribeSdkIdentity(ready);
  const stopPrefs = useAnalyticsPrefs.subscribe((next, previous) => {
    if (next.optOut) controller.purge();
    else if (previous.optOut) void primeSdkIdentity().then(ready);
    updateStopContext();
  });
  const inspectWallet = () => controller.inspectDurableWallet(getString(KEYS.currency));
  const stopWallet = useCurrency.subscribe(inspectWallet);
  const stopCheckout = subscribeCheckoutTechnicalFailure(() => controller.checkoutFailure());
  const stopProfile = useProfile.subscribe((next, previous) => { if (next.profile?.userId !== previous.profile?.userId) controller.observeIdentity(); });
  const historyChanged = () => {
    if ([KEYS.campaignHistoryProof, KEYS.dailyHistoryProof].some((key) => {
      try { return JSON.parse(getString(key) ?? '{}').complete === false; } catch { return true; }
    })) controller.purge();
  };
  const stopCampaign = useLevels.subscribe(historyChanged), stopDaily = useDailyPuzzle.subscribe(historyChanged);
  const activity = AppState.addEventListener('change', () => { updateStopContext(); });
  void primeSdkIdentity().then(ready); inspectWallet();
  return () => { running = false; stopIdentity(); stopPrefs(); stopWallet(); stopCheckout(); stopRemote(); stopProfile(); stopCampaign(); stopDaily(); activity.remove(); stopAdapter.stop(); };
}
