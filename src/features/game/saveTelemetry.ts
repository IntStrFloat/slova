import { isAnalyticsCollectionEnabled, trackOnce, useAnalyticsPrefs } from '@/features/analytics';

// One bounded cumulative series per process. The first save establishes the
// denominator, later checkpoints replace its revision in the analysis view.
const newSummaryId = () => `save_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
let summaryId = newSummaryId();
let attempts = 0;
let successes = 0;
let failures = 0;
let lastSummaryAt = 0;
let pendingFailure = false;
let collecting = false;

function reset(): void {
  summaryId = newSummaryId();
  attempts = 0; successes = 0; failures = 0; lastSummaryAt = 0;
  pendingFailure = false; collecting = false;
}
// A future opt-in must not upload counters collected while analytics was off.
useAnalyticsPrefs?.subscribe?.((next, previous) => {
  if (next.optOut !== previous.optOut) reset();
});
function canCapture(): boolean {
  if (typeof isAnalyticsCollectionEnabled !== 'function' || !isAnalyticsCollectionEnabled()) {
    if (collecting || attempts) reset();
    return false;
  }
  collecting = true;
  return true;
}

export function flushGameSaveSummary(force = false): void {
  if (!canCapture()) return;
  if (attempts === 0 || !force && lastSummaryAt && Date.now() - lastSummaryAt < 60_000) return;
  trackOnce('technical_operation', `${summaryId}:${attempts}`, {
    stage: 'summary', operation: 'game_save', summary_id: summaryId, revision: attempts,
    attempts, successes, failures,
  });
  lastSummaryAt = Date.now();
}

export function recordGameSave(result: 'success' | 'failure', mode: string, latencyMs: number): void {
  if (!canCapture()) return;
  attempts += 1;
  const operationId = `${summaryId}:${attempts}`;
  if (result === 'failure') {
    failures += 1;
    pendingFailure = true;
    trackOnce('technical_operation', `${operationId}:failure`, {
      stage: 'failure', operation: 'game_save', operation_id: operationId, attempt_no: 1,
      mode, result, normalized_code: 'storage_write_failed', latency_ms: Math.max(0, latencyMs),
      recovery: false,
    });
  } else {
    successes += 1;
    if (pendingFailure) {
      trackOnce('technical_operation', `${operationId}:recovered`, {
        stage: 'recovered', operation: 'game_save', operation_id: operationId, attempt_no: 1,
        mode, result, latency_ms: Math.max(0, latencyMs), recovery: true,
      });
      pendingFailure = false;
    }
  }
  flushGameSaveSummary(attempts === 1 || result === 'failure');
}
