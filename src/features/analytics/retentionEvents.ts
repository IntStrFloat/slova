import type { RetentionSnapshot } from '@/features/retention/model';
import { deriveRetentionMilestones } from '@/features/retention/milestones';
import { trackOnce } from './index';

export type { ObservedMilestone } from '@/features/retention/milestones';
export const observedRetentionMilestones = deriveRetentionMilestones;

/** Retry committed facts with original occurrence time; legacy timing stays explicitly unknown. */
export function trackObservedRetentionMilestones(snapshot: RetentionSnapshot, nowMs = Date.now()): void {
  for (const event of deriveRetentionMilestones(snapshot, nowMs)) {
    trackOnce(event.name, event.key, { ...event.properties,
      observedAtMs: nowMs,
      recovery: event.properties.timeKnown !== true || (event.properties.occurredAtMs as number) < nowMs,
    });
  }
}
