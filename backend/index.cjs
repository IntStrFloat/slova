const http = require('node:http');
const path = require('node:path');
const { Buffer } = require('node:buffer');

const { createApi } = require('./runtime/api.cjs');
const { createFileStore } = require('./runtime/store.cjs');
const { loadContentCatalog, createCatalogValidators } = require('./runtime/content-catalog.cjs');
const { createBilling } = require('./runtime/billing.cjs');
const { createYooKassa } = require('./runtime/yookassa.cjs');
const { createRenewalNotices } = require('./runtime/renewal-notices.cjs');
const { createTimewebMailTransport } = require('./runtime/timeweb-mail.cjs');

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
const billingSeller = {
  name: process.env.BILLING_SELLER_NAME || '',
  inn: process.env.BILLING_SELLER_INN || '',
  email: process.env.BILLING_SUPPORT_EMAIL || '',
};
let gateway = null;
if (process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY) {
  try {
    gateway = createYooKassa({
      shopId: process.env.YOOKASSA_SHOP_ID,
      secretKey: process.env.YOOKASSA_SECRET_KEY,
      returnUrl: `${billingPublicBase}/api/billing/return`,
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
  store: createFileStore(process.env.BILLING_NOTICES_DATA_PATH || path.join('/var/lib/slova', 'renewal-notices.json'), { strict: true, durable: true }),
  transport: noticeTransport,
  mode: billingMode,
  publicBase: billingPublicBase,
  supportEmail: billingSeller.email,
  sender: process.env.BILLING_NOTICE_SENDER,
});
// A readiness checkbox cannot issue an NPD receipt. Live sales stay disabled
// until an actual confirmed fiscal service is implemented and configured here.
// BILLING_RECEIPTS_READY is intentionally ignored; it cannot bypass this gate.
const npdReceiptsConfigured = false;
const billingEnabled = process.env.BILLING_ENABLED === '1' && Boolean(gateway)
  && (billingMode === 'test' || (process.env.BILLING_LIVE_READY === '1'
    && npdReceiptsConfigured && notices.configured && notices.mode === 'live'
    && billingSeller.name && billingSeller.inn && billingSeller.email));
const billing = createBilling({
  store: createFileStore(process.env.BILLING_DATA_PATH || path.join('/var/lib/slova', 'billing.json'), { strict: true, durable: true }),
  gateway,
  notices,
  enabled: Boolean(billingEnabled),
  mode: billingMode,
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
const renewalTimer = billing.catalog().available ? setInterval(() => {
  void billing.runRenewals().catch(() => console.warn('[billing] renewal reconciliation failed'));
}, 60_000) : null;
renewalTimer?.unref();
server.on('close', () => { if (renewalTimer) clearInterval(renewalTimer); });
