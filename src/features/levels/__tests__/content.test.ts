/* eslint-disable @typescript-eslint/no-require-imports */

const { audit } = require('../../../../scripts/audit-content');

describe('released campaign content', () => {
  test('passes strict quality gates including first-route preservation and extension exclusions', () => {
    const report = audit();
    expect(report.errors).toEqual([]);
    expect(report.counts.levels).toBe(1000);
    expect(report.duplicates.puzzleSignatures).toBe(1000);
    expect(report.passed).toBe(true);
  });
});
