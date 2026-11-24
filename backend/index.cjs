const http = require('node:http');
const path = require('node:path');
const { Buffer } = require('node:buffer');
const fs = require('node:fs');

const { createApi } = require('./runtime/api.cjs');
const { createFileStore } = require('./runtime/store.cjs');
const { loadContentCatalog, createCatalogValidators } = require('./runtime/content-catalog.cjs');
const { createBilling } = require('./runtime/billing.cjs');
const { createRobokassa } = require('./runtime/robokassa.cjs');
const { createRenewalNotices } = require('./runtime/renewal-notices.cjs');
const { createTimewebMailTransport } = require('./runtime/timeweb-mail.cjs');
const { createRenewalMonitor } = require('./runtime/renewal-monitor.cjs');
const { createBillingMigration } = require('./runtime/billing-migration.cjs');

const PORT = Number(process.env.PORT || 8788);
const DATA_PATH = process.env.DATA_PATH || path.join('/var/lib/slova', 'store.json');
const MODERATION_DATA_PATH = process.env.MODERATION_DATA_PATH || path.join('/var/lib/slova', 'moderation.json');
const API_KEY = process.env.API_KEY || '';
const featureFlags = {
  remoteWordPolicy: process.env.FEATURE_REMOTE_WORD_POLICY === '1',
  wordReports: process.env.FEATURE_WORD_REPORTS === '1',
};
const catalog = process.env.CONTENT_CATALOG_PATH ? loadContentCatalog(process.env.CONTENT_CATALOG_PATH) : null;
const catalogValidators = createCatalogValidators(catalog);
const billingPublicBase = process.env.BILLING_PUBLIC_BASE || 'https://slova.193.160.208.95.nip.io';
const billingMode = process.env.BILLING_MODE === 'live' ? 'live' : 'test';
const billingMerchant = process.env.ROBOKASSA_MERCHANT_LOGIN || '';
const billingStoreSuffix = `${billingMerchant.replace(/[^A-Za-z0-9_.-]/g, '_') || 'unconfigured'}-${billingMode}`;
const billingSeller = {
  name: process.env.BILLING_SELLER_NAME || '',
  inn: process.env.BILLING_SELLER_INN || '',
  email: process.env.BILLING_SUPPORT_EMAIL || '',
};
let gateway = null;
if (billingMerchant && (!process.env.BILLING_PROVIDER || process.env.BILLING_PROVIDER === 'robokassa')) {
  try {
    gateway = createRobokassa({
      merchantLogin: billingMerchant,
      password1: process.env.ROBOKASSA_PASSWORD1,
      password2: process.env.ROBOKASSA_PASSWORD2,
      password3: process.env.ROBOKASSA_PASSWORD3,
      testPassword1: process.env.ROBOKASSA_TEST_PASSWORD1,
      testPassword2: process.env.ROBOKASSA_TEST_PASSWORD2,
      hashAlgorithm: process.env.ROBOKASSA_HASH_ALGORITHM || 'SHA256',
      mode: billingMode,
    });
  } catch { console.warn('[billing] invalid gateway configuration; sales disabled'); }
}
let noticeTransport = null;
if (process.env.BILLING_NOTICE_PROVIDER === 'timeweb') {
  try {
    noticeTransport = createTimewebMailTransport({
      username: process.env.TIMEWEB_MAIL_USERNAME,
      password: process.env.TIMEWEB_MAIL_PASSWORD,
      sender: process.env.BILLING_NOTICE_SENDER,
    });
  } catch { console.warn('[billing] invalid notice transport configuration; live sales disabled'); }
}
const notices = createRenewalNotices({
  store: createFileStore(process.env.BILLING_NOTICES_DATA_PATH || path.join('/var/lib/slova', `renewal-notices-robokassa-${billingStoreSuffix}.json`), { strict: true, durable: true }),
  transport: noticeTransport,
  mode: billingMode,
  publicBase: billingPublicBase,
  supportEmail: billingSeller.email,
  sender: process.env.BILLING_NOTICE_SENDER,
});
// These are operator confirmations of actual merchant/recurring/Robocheki SMZ
// activation in the provider account, including MyTax authority. They must stay
// off until verified there; a 54-FZ Receipt payload is NOT an NPD integration.
// Legacy BILLING_RECEIPTS_READY and YooKassa secrets cannot enable this gateway.
const providerConfirmed = ['ROBOKASSA_MERCHANT_CONFIRMED', 'ROBOKASSA_RECURRING_CONFIRMED', 'ROBOKASSA_SMZ_CONFIRMED']
  .every((key) => process.env[key] === '1');
const billingEnabled = process.env.BILLING_ENABLED === '1' && Boolean(gateway)
  && (billingMode === 'test' || (process.env.BILLING_LIVE_READY === '1'
    && providerConfirmed && gateway.capabilities.recurring && notices.configured && notices.mode === 'live'
    && billingSeller.name && billingSeller.inn && billingSeller.email));
const billing = createBilling({
  provider: 'robokassa',
  merchantLogin: billingMerchant,
  store: createFileStore(process.env.BILLING_DATA_PATH || path.join('/var/lib/slova', `billing-robokassa-${billingStoreSuffix}.json`), { strict: true, durable: true }),
  gateway,
  notices,
  enabled: Boolean(billingEnabled),
  mode: billingMode,
  analyticsOptions: {
    enabled: process.env.APPMETRICA_SERVER_EVENTS_ENABLED === '1',
    postApiKey: process.env.APPMETRICA_POST_API_KEY || '',
    applicationId: Number(process.env.APPMETRICA_APPLICATION_ID || 6321823),
  },
});

let retiredSources = [];
try {
  const configured = JSON.parse(process.env.BILLING_RETIRED_JOURNALS || '[]');
  if (!Array.isArray(configured) || configured.some((source) => !['yookassa', 'robokassa'].includes(source.provider) ||
    typeof source.path !== 'string' || !path.isAbsolute(source.path))) throw new Error();
  retiredSources = configured.map((source) => ({ provider: source.provider,
    read: () => JSON.parse(fs.readFileSync(source.path, 'utf8')) }));
} catch { console.warn('[billing] retired journal configuration unavailable; automatic migration resolution disabled'); }
const reviewedPath = process.env.BILLING_MIGRATION_RESOLUTIONS_PATH || '/etc/slova/billing-migration-resolutions.json';
const billingMigration = createBillingMigration({
  target: { provider: 'robokassa', protocol: 'robokassa-v3', merchantLogin: billingMerchant, mode: billingMode },
  sources: retiredSources,
  reviewedRead: () => {
    try { return JSON.parse(fs.readFileSync(reviewedPath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { version: 1, resolutions: [] }; throw error; }
  },
});

const api = createApi({
  store: createFileStore(DATA_PATH),
  moderationStore: createFileStore(MODERATION_DATA_PATH),
  apiKey: API_KEY,
  featureFlags,
  validateReportContext: catalogValidators.validateReportContext,
  trustProxy: process.env.TRUST_PROXY === '1',
  billing,
  billingPublicBase,
  billingSeller,
  billingMigration,
});

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    try {
      const out = await api.handle({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: chunks.length ? Buffer.concat(chunks).toString('utf8') : '',
        ip: req.socket.remoteAddress,
      });
      res.writeHead(out.status, out.headers);
      res.end(out.body);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal', message: String(err && err.message) }));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`slova backend on 127.0.0.1:${PORT} data=${DATA_PATH}`);
});

// Durable attempts and provider idempotence make overlapping ticks and restarts safe.
const renewalTick = createRenewalMonitor({ billing });
const renewalTimer = setInterval(() => {
  void renewalTick();
  void billing.flushAnalytics().catch(() => { console.warn('[analytics] billing journal unavailable'); });
}, 60_000);
renewalTimer.unref();
server.on('close', () => { clearInterval(renewalTimer); });
