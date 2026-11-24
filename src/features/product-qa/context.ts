import type { HelpFlow } from '@/features/hints/help-flow';

/** Technical origin selection is independent of treatment CTAs and history certainty. */
export function matchingQaHelpFlow(
  flows: Record<string, HelpFlow>, attemptId: string | undefined, canResume: (flow: HelpFlow) => boolean,
): HelpFlow | null {
  if (!attemptId || !flows || typeof flows !== 'object' || Array.isArray(flows)) return null;
  return Object.values(flows).filter((flow) => {
    if (!flow || flow.attemptId !== attemptId || !['requested', 'returned'].includes(flow.status)
      || !Number.isSafeInteger(flow.createdAtMs) || flow.createdAtMs <= 0) return false;
    try { return canResume(flow); } catch { return false; }
  }).sort((left, right) => right.createdAtMs - left.createdAtMs)[0] ?? null;
}
