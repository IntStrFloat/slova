// One message to the configured mailbox itself. A persisted claim prevents
// accidental resend after a lost SMTP response or an interrupted verification.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createTimewebMailTransport } = require('../backend/runtime/timeweb-mail.cjs');

const root = path.resolve(__dirname, '..');
const config = Object.fromEntries(fs.readFileSync(path.join(root, 'credentials/timeweb-mail.env'), 'utf8')
  .split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => {
    const split = line.indexOf('=');
    return [line.slice(0, split), line.slice(split + 1)];
  }));
const file = path.join(root, 'credentials/timeweb-self-test.json');
const key = `renewal/${crypto.createHash('sha256').update('slova-mail-self-test-2026-10-08').digest('hex')}`;
const transport = createTimewebMailTransport({ username: config.TIMEWEB_MAIL_USERNAME,
  password: config.TIMEWEB_MAIL_PASSWORD, sender: config.BILLING_NOTICE_SENDER });

function save(value, exclusive = false) {
  const descriptor = fs.openSync(file, exclusive ? 'wx' : 'w', 0o600);
  try { fs.writeFileSync(descriptor, JSON.stringify(value, null, 2)); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}

async function main() {
  if (fs.existsSync(file)) {
    const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
    console.log(JSON.stringify({ status: previous.status, resent: false, checkedAt: previous.checkedAt }));
    return;
  }
  const checkedAt = new Date().toISOString();
  save({ status: 'sending', checkedAt, key }, true);
  try {
    const result = await transport.send({ from: config.BILLING_NOTICE_SENDER,
      to: [config.TIMEWEB_MAIL_USERNAME], reply_to: config.TIMEWEB_MAIL_USERNAME,
      subject: 'Слова — проверка почтовых уведомлений',
      text: 'Проверка отправки писем игры «Слова» через этот почтовый ящик. Это техническое письмо: покупка не создавалась, подписка не оформлялась, деньги не списывались.' }, key);
    save({ status: 'accepted_by_smtp', checkedAt, key, messageId: result.id });
    console.log(JSON.stringify({ status: 'accepted_by_smtp', checkedAt, sentToConfiguredMailboxOnly: true }));
  } catch (error) {
    const code = /^renewal_notice_[a-z_]+$/.test(error.code || '') ? error.code : 'smtp_verification_failed';
    const state = { status: 'failed_requires_reconciliation', checkedAt, code,
      ambiguous: error.ambiguous === true };
    save({ ...state, key });
    console.log(JSON.stringify(state));
    process.exitCode = 1;
  }
}

main().catch(() => { console.error('mail_verification_failed'); process.exitCode = 1; });
