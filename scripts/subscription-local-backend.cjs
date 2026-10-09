const path = require('node:path');

const root = path.resolve(__dirname, '..');
process.loadEnvFile(path.join(root, 'credentials', 'yookassa-test.env'));
if (!process.env.YOOKASSA_SECRET_KEY?.startsWith('test_')) throw new Error('Only a YooKassa test key is permitted');
Object.assign(process.env, {
  PORT: '8791', API_KEY: '', BILLING_ENABLED: '1', BILLING_MODE: 'test', BILLING_LIVE_READY: '0',
  DATA_PATH: path.join(root, 'credentials', 'subscription-qa', 'profiles.json'),
  BILLING_DATA_PATH: path.join(root, 'credentials', 'subscription-qa', 'billing-test.json'),
  MODERATION_DATA_PATH: path.join(root, 'credentials', 'subscription-qa', 'moderation.json'),
  CONTENT_CATALOG_PATH: '', FEATURE_WORD_REPORTS: '0', FEATURE_REMOTE_WORD_POLICY: '0',
  BILLING_PUBLIC_BASE: 'https://slova.193.160.208.95.nip.io',
  BILLING_SELLER_NAME: 'Тестовый продавец', BILLING_SELLER_INN: '000000000000', BILLING_SUPPORT_EMAIL: 'qa@example.com',
});
require('../backend/index.cjs');
