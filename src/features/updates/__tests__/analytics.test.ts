import { validateEventProperties } from '@/features/analytics/schema';
test('update observations retain actual decimal native versions and exclude private metadata', () => {
  const result = validateEventProperties('update_version_observed', { result: 'version_observed', reason: 'package_manager', source: 'unknown',
    installed_version_code: '9007199254740993', previous_version_code: '9007199254740992',
    raw_exception: 'private@example.invalid', url: 'https://example.invalid/update.apk', save: '{private}' });
  expect(result).toMatchObject({ valid: true, rejected: 3, properties: { installed_version_code: '9007199254740993', source: 'unknown' } });
  expect(JSON.stringify(result.properties)).not.toMatch(/private|https/);
});
