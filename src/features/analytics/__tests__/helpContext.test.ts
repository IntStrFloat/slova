import { selectHelpContext } from '../helpContext';

test('keeps a bounded campaign help origin, separate tap, modal and displayed quote', () => {
  const context = { origin_interaction_id: 'help:origin', interaction_id: 'tap:wheel', modal_id: 'modal:coins',
    attemptId: 'attempt:6', levelKey: 'campaign:6', levelId: 6, mode: 'campaign', contentVersion: 'content-v1',
    content_fingerprint: 'fp_0123456789abcdef', requested_hint: 'letter', displayed_cost: 50, balance: 20,
    entry_source: 'no_coins' };
  expect(selectHelpContext({ ...context, word: 'PRIVATE_WORD', email: 'private@example.com',
    answers: ['PRIVATE_ANSWER'], adUnitId: 'PRIVATE_UNIT', opportunity_id: 'load:separate' })).toEqual(context);
});

test('daily identities and full digest remain compatible without raw content', () => {
  expect(selectHelpContext({ levelKey: 'daily:2026-11-04', dateKey: '2026-11-04', mode: 'daily',
    content_fingerprint: 'a'.repeat(64), requested_hint: 'semantic', displayed_cost: 0, balance: 0 }))
    .toEqual({ levelKey: 'daily:2026-11-04', dateKey: '2026-11-04', mode: 'daily',
      content_fingerprint: 'a'.repeat(64), requested_hint: 'semantic', displayed_cost: 0, balance: 0 });
});

test('prior puzzle completion is an explicit boolean and missing history is not converted to false', () => {
  expect(selectHelpContext({ previously_completed: false })).toEqual({ previously_completed: false });
  expect(selectHelpContext({ previously_completed: true })).toEqual({ previously_completed: true });
  expect(selectHelpContext({ previously_completed: 'false' })).toEqual({});
  expect(selectHelpContext({ previously_completed: undefined })).toEqual({});
});

test.each([
  { levelKey: 'campaign:0', levelId: '6', displayed_cost: '50', balance: -1 },
  { mode: 'normal', requested_hint: 'PRIVATE_WORD', content_fingerprint: 'raw-answer-fingerprint' },
  { interaction_id: 'private@example.com', origin_interaction_id: 'contains spaces', modal_id: 'x'.repeat(193) },
  { levelId: 1.5, displayed_cost: Infinity, balance: Number.MAX_SAFE_INTEGER + 1 },
  { attemptId: 123, contentVersion: 123, dateKey: 20261104, entry_source: true },
])('does not admit mistyped, unsafe or unbounded context %p', (input) => {
  expect(selectHelpContext(input)).toEqual({});
});

test('projection has no shared mutable object or undeclared output fields', () => {
  const input = { origin_interaction_id: 'origin:1', balance: 20, levelKey: 'campaign:6', rawInput: 'secret' };
  const first = selectHelpContext(input);
  first.balance = 100;
  expect(input.balance).toBe(20);
  expect(selectHelpContext(input)).toEqual({ origin_interaction_id: 'origin:1', balance: 20, levelKey: 'campaign:6' });
  expect(selectHelpContext()).toEqual({});
});
