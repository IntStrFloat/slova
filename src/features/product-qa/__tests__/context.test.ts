import { matchingQaHelpFlow } from '../context';
import type { HelpFlow } from '@/features/hints/help-flow';

const base = { version: 1, id: 'help:current', attemptId: 'attempt:current', createdAtMs: 100,
  status: 'requested', uxVariant: 'control', previouslyCompleted: null } as unknown as HelpFlow;

test.each([null, undefined, false, true])('current technical flow does not depend on nullable history %j or treatment', (history) => {
  const flow = { ...base, previouslyCompleted: history } as unknown as HelpFlow;
  expect(matchingQaHelpFlow({ [flow.id]: flow }, flow.attemptId, () => true)).toBe(flow);
});
test('other attempts, terminal flows, unresumable and malformed records never supply an origin', () => {
  const flows = { other: { ...base, attemptId: 'other' }, closed: { ...base, status: 'closed' },
    applied: { ...base, status: 'applied' }, corrupt: { ...base, createdAtMs: Number.NaN }, current: base } as Record<string, HelpFlow>;
  expect(matchingQaHelpFlow(flows, 'attempt:current', () => false)).toBeNull();
  expect(matchingQaHelpFlow(flows, undefined, () => true)).toBeNull();
  expect(matchingQaHelpFlow(flows, 'attempt:current', () => true)).toBe(base);
});
