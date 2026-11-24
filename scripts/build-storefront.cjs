/* global __dirname */
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const process = require('node:process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'web/storefront');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output' || !args[1])) {
  throw new Error('Usage: node scripts/build-storefront.cjs [--output <directory>]');
}
const OUTPUT = path.resolve(ROOT, args[1] || 'output/robokassa-qa/2026-10-16/approval-v3/storefront');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const escape = (value) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const seller = {};
for (const line of fs.readFileSync(path.join(ROOT, 'credentials/robokassa-seller.env'), 'utf8').split(/\r?\n/)) {
  if (!line.trim() || line.trim().startsWith('#')) continue;
  const match = /^(BILLING_SELLER_NAME|BILLING_SELLER_INN)=(.*)$/.exec(line);
  if (!match || seller[match[1]]) throw new Error('Invalid seller file');
  let value = match[2];
  if (value.startsWith('"')) value = JSON.parse(value);
  else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
  seller[match[1]] = value;
}
if (!seller.BILLING_SELLER_NAME || !/^\d{12}$/.test(seller.BILLING_SELLER_INN)) throw new Error('Seller details required');
let html = fs.readFileSync(path.join(SOURCE, 'index.html'), 'utf8');
for (const key of ['NAME', 'INN']) {
  if (!html.includes(`{{SELLER_${key}}}`)) throw new Error('Missing seller placeholder');
  html = html.replaceAll(`{{SELLER_${key}}}`, escape(seller[`BILLING_SELLER_${key}`]));
}
if (/\{\{[^}]+\}\}|<script\b|<form\b/i.test(html)) throw new Error('Unexpected unfinished or active content');
const files = new Map([
  ['index.html', Buffer.from(html)],
  ['app-ads.txt', fs.readFileSync(path.join(SOURCE, 'app-ads.txt'))],
  ['storefront-assets/styles.css', fs.readFileSync(path.join(SOURCE, 'styles.css'))],
]);
for (const entry of fs.readdirSync(path.join(SOURCE, 'assets'), { withFileTypes: true })) {
  if (!entry.isFile() || !/^[a-z0-9-]+\.(jpg|png|webp)$/.test(entry.name)) throw new Error('Unexpected storefront asset');
  files.set(`storefront-assets/${entry.name}`, fs.readFileSync(path.join(SOURCE, 'assets', entry.name)));
}
for (const match of html.matchAll(/(?:src|href)="(\/storefront-assets\/[^"?#]+)(?:[^"#]*)?"/g)) {
  if (!files.has(match[1].slice(1))) throw new Error('Missing linked asset');
}
for (const fragment of ['/api/billing/terms', '/api/billing/privacy', '/api/billing/user-agreement', '/api/billing/personal-data-consent', '/api/billing/manage', 'sales@strsoft.ru',
  'https://www.rustore.ru/catalog/app/com.intstrfloat.slova', '99', '30']) {
  if (!html.includes(fragment)) throw new Error('Missing storefront requirement');
}
if (fs.existsSync(OUTPUT) && fs.realpathSync(OUTPUT).toLowerCase() !== OUTPUT.toLowerCase()) throw new Error('Unsafe output path');
fs.mkdirSync(path.join(OUTPUT, 'storefront-assets'), { recursive: true });
for (const [name, bytes] of files) {
  const target = path.join(OUTPUT, name);
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('Unsafe output file');
  fs.writeFileSync(target, bytes);
}
const manifest = { version: 1, url: 'https://slova.193.160.208.95.nip.io/', createdAt: new Date().toISOString(),
  files: [...files].map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: hash(bytes) })) };
fs.writeFileSync(path.join(OUTPUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ output: OUTPUT, files: files.size, bytes: [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0), htmlSha256: hash(files.get('index.html')) }));
