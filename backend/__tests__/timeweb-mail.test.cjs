const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const { Duplex } = require('node:stream');
const { createTimewebMailTransport } = require('../runtime/timeweb-mail.cjs');

const USER = 'billing@example.com';
const PASSWORD = 'fake-private-mail-password';
const SENDER = `Слова <${USER}>`;
const KEY = `renewal/${'a'.repeat(64)}`;
const MESSAGE = { from: SENDER, to: ['player@example.net'], reply_to: 'support@example.com',
  subject: 'Слова: напоминание о продлении подписки', text: 'Подписка продлится за 99 ₽.\n\nОтключить: https://example.com/manage\n.\nQUIT' };

class FakeSmtpSocket extends Duplex {
  constructor(steps, options) {
    super();
    this.steps = steps;
    this.options = options;
    this.encrypted = options.encrypted ?? true;
    this.authorized = options.authorized ?? true;
    this.writes = [];
  }
  _read() {}
  deliver(step) {
    if (this.destroyed) return;
    if (step.close) { this.destroy(); return; }
    if (step.end) { this.push(null); return; }
    if (step.error) { this.destroy(new Error(step.error)); return; }
    if (step.timeout) return;
    const chunks = step.chunks ?? [step.reply];
    for (const chunk of chunks) this.push(Buffer.from(chunk, 'utf8'));
    if (step.closeAfterReply) this.destroy();
  }
  _write(chunk, _encoding, callback) {
    const value = chunk.toString('utf8');
    this.writes.push(value);
    const step = this.steps.shift();
    if (!step) { callback(new Error('unexpected_test_command')); return; }
    if (step.writeError) { callback(new Error(step.writeError)); return; }
    if (step.throwError) throw new Error(step.throwError);
    callback();
    queueMicrotask(() => this.deliver(step));
  }
}

function fixture({ login = false, stage = null, response = null, greeting = null, ...socketOptions } = {}) {
  const steps = [
    { stage: 'ehlo', reply: `250-smtp.timeweb.ru\r\n250-SIZE 10485760\r\n250 AUTH ${login ? 'LOGIN' : 'PLAIN LOGIN'}\r\n` },
    ...(login ? [{ stage: 'auth', reply: '334 VXNlcm5hbWU6\r\n' },
      { stage: 'username', reply: '334 UGFzc3dvcmQ6\r\n' }, { stage: 'password', reply: '235 Authenticated\r\n' }]
      : [{ stage: 'auth', reply: '235 Authenticated\r\n' }]),
    { stage: 'mail', reply: '250 Sender accepted\r\n' },
    { stage: 'rcpt', reply: '250 Recipient accepted\r\n' },
    { stage: 'data', reply: '354 End with a dot\r\n' },
    { stage: 'body', reply: '250 Queued as private-queue-id\r\n' },
    { stage: 'quit', reply: '221 Bye\r\n' },
  ].map((step) => step.stage === stage ? { ...step, ...response } : step);
  const sockets = [];
  const connections = [];
  const connectImpl = (options) => {
    connections.push(options);
    const socket = new FakeSmtpSocket(steps.map((step) => ({ ...step })), socketOptions);
    sockets.push(socket);
    setImmediate(() => {
      if (socket.destroyed) return;
      socket.emit('secureConnect');
      socket.deliver(greeting ?? { reply: '220 smtp.timeweb.ru ESMTP\r\n' });
    });
    return socket;
  };
  return { sockets, connections, connectImpl,
    transport: createTimewebMailTransport({ username: USER, password: PASSWORD, sender: SENDER, connectImpl, timeoutMs: 30 }) };
}

function errorMatches(code, { retryable = false, ambiguous = false } = {}) {
  return (error) => {
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    assert.equal(error.status, 503);
    assert.equal(error.retryable, retryable);
    assert.equal(error.ambiguous, ambiguous);
    assert.equal(error.cause, undefined);
    assert.equal(JSON.stringify(error).includes(PASSWORD), false);
    return true;
  };
}

function decodeHeader(value) {
  return [...value.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)]
    .map((match) => Buffer.from(match[1], 'base64').toString('utf8')).join('');
}

test('accepts a single live SMTP message with strict Timeweb TLS and UTF-8 MIME', async () => {
  const { transport, connections, sockets } = fixture();
  assert.equal(transport.mode, 'live');
  assert.equal(transport.idempotencyWindowMs, 0);
  const result = await transport.send(MESSAGE, KEY);
  const id = crypto.createHash('sha256').update(KEY).digest('hex');
  assert.deepEqual(result, { id });
  assert.deepEqual(connections, [{ host: 'smtp.timeweb.ru', port: 465, servername: 'smtp.timeweb.ru',
    rejectUnauthorized: true, minVersion: 'TLSv1.2' }]);
  const writes = sockets[0].writes;
  assert.equal(writes[0], 'EHLO example.com\r\n');
  assert.equal(writes[1], `AUTH PLAIN ${Buffer.from(`\0${USER}\0${PASSWORD}`).toString('base64')}\r\n`);
  assert.equal(writes[2], `MAIL FROM:<${USER}>\r\n`);
  assert.equal(writes[3], 'RCPT TO:<player@example.net>\r\n');
  assert.equal(writes[4], 'DATA\r\n');
  assert.equal(writes[6], 'QUIT\r\n');
  const [headers, body] = writes[5].split('\r\n\r\n');
  assert.equal(decodeHeader(/^From: ([\s\S]+?)\r\nTo:/m.exec(headers)[1]), 'Слова');
  assert.equal(decodeHeader(/^Subject: ([\s\S]+?)\r\nDate:/m.exec(headers)[1]), MESSAGE.subject);
  assert.ok(headers.includes(`Message-ID: <${id}@example.com>`));
  assert.ok(headers.includes('Content-Type: text/plain; charset=UTF-8'));
  assert.ok(headers.includes('Content-Transfer-Encoding: base64'));
  assert.equal(Buffer.from(body.replace(/\r\n\.\r\n$/, ''), 'base64').toString('utf8'), MESSAGE.text.replace(/\n/g, '\r\n'));
  assert.ok(body.split('\r\n').every((line) => line.length <= 76));
  assert.ok(sockets[0].destroyed);
});

test('handles LOGIN and fragmented multiline replies including a bare final code', async () => {
  const { transport, sockets } = fixture({ login: true, stage: 'ehlo', response: {
    chunks: ['250-sm', 'tp.timeweb.ru\r', '\n250-AUTH LO', 'GIN\r\n250\r', '\n'],
  } });
  await transport.send(MESSAGE, KEY);
  assert.equal(sockets[0].writes[1], 'AUTH LOGIN\r\n');
  assert.equal(sockets[0].writes[2], `${Buffer.from(USER).toString('base64')}\r\n`);
  assert.equal(sockets[0].writes[3], `${Buffer.from(PASSWORD).toString('base64')}\r\n`);
});

test('accepts receipt keys and generates stable reconciliation IDs without provider deduplication', async () => {
  const first = fixture();
  const second = fixture();
  const key = `receipt/${'b'.repeat(64)}`;
  const sent = await first.transport.send(MESSAGE, key);
  assert.deepEqual(await second.transport.send(MESSAGE, key), sent);
  assert.match(sent.id, /^[a-f0-9]{64}$/);
  assert.equal(first.connections.length, 1);
  assert.equal(second.connections.length, 1);
});

test('folds long UTF-8 subjects and display names on character boundaries', async () => {
  const sender = `${'Ё'.repeat(64)} <${USER}>`;
  const mail = { ...MESSAGE, from: sender, subject: '😀Я'.repeat(60) };
  const fake = fixture();
  const transport = createTimewebMailTransport({ username: USER, password: PASSWORD, sender,
    connectImpl: fake.connectImpl, timeoutMs: 30 });
  await transport.send(mail, KEY);
  const headers = fake.sockets[0].writes[5].split('\r\n\r\n')[0];
  assert.equal(decodeHeader(/^From: ([\s\S]+?)\r\nTo:/m.exec(headers)[1]), 'Ё'.repeat(64));
  assert.equal(decodeHeader(/^Subject: ([\s\S]+?)\r\nDate:/m.exec(headers)[1]), mail.subject);
  for (const line of headers.split('\r\n')) {
    if (line.includes('=?UTF-8?B?')) assert.ok(line.length <= 76);
  }
});

for (const [phase, ambiguous] of [['ehlo', false], ['data', true], ['body', true]]) {
  for (const action of ['timeout', 'close', 'end', 'error']) {
    test(`${action} at ${phase} produces a sanitized ${ambiguous ? 'ambiguous' : 'known unsent'} failure`, async () => {
      const response = action === 'error' ? { error: `untrusted socket error ${PASSWORD}` } : { [action]: true };
      const fake = fixture({ stage: phase, response });
      await assert.rejects(fake.transport.send(MESSAGE, KEY),
        errorMatches('renewal_notice_gateway_unavailable', { ambiguous }));
      assert.equal(fake.connections.length, 1); // No hidden reconnect/resend.
      assert.ok(fake.sockets[0].destroyed);
    });
  }
}

for (const phase of ['ehlo', 'auth', 'mail', 'rcpt', 'data', 'body']) {
  test(`explicit 4xx at ${phase} permits retry because the server rejected this attempt`, async () => {
    const fake = fixture({ stage: phase, response: { reply: `451 Temporary error ${PASSWORD}\r\n` } });
    await assert.rejects(fake.transport.send(MESSAGE, KEY),
      errorMatches('renewal_notice_gateway_unavailable', { retryable: true }));
    assert.equal(fake.connections.length, 1);
  });
  test(`explicit 5xx at ${phase} is definitive and does not retry`, async () => {
    const fake = fixture({ stage: phase, response: { reply: `550 Rejected ${PASSWORD}\r\n` } });
    await assert.rejects(fake.transport.send(MESSAGE, KEY), errorMatches('renewal_notice_gateway_rejected'));
    assert.equal(fake.connections.length, 1);
  });
}

test('acceptance survives an immediate connection close and any subsequent QUIT error', async () => {
  const closed = fixture({ stage: 'body', response: { reply: '250 Accepted\r\n', closeAfterReply: true } });
  assert.match((await closed.transport.send(MESSAGE, KEY)).id, /^[a-f0-9]{64}$/);
  const quit = fixture({ stage: 'quit', response: { throwError: PASSWORD } });
  assert.match((await quit.transport.send(MESSAGE, KEY)).id, /^[a-f0-9]{64}$/);
});

test('connect exceptions never expose authentication or arbitrary provider details', async () => {
  const transport = createTimewebMailTransport({ username: USER, password: PASSWORD, sender: SENDER,
    connectImpl: () => { throw new Error(PASSWORD); } });
  await assert.rejects(transport.send(MESSAGE, KEY), errorMatches('renewal_notice_gateway_unavailable'));
});

test('invalid injected connections fail with sanitized errors', async () => {
  for (const socket of [null, {}, { on() {}, once() {}, write() {}, destroy() { throw new Error(PASSWORD); } },
    { on() { throw new Error(PASSWORD); }, once() {}, write() {}, destroy() {} }]) {
    const transport = createTimewebMailTransport({ username: USER, password: PASSWORD, sender: SENDER,
      connectImpl: () => socket, timeoutMs: 1 });
    await assert.rejects(transport.send(MESSAGE, KEY), errorMatches('renewal_notice_gateway_unavailable'));
  }
});

for (const [name, changes] of [
  ['subject header injection', { subject: 'Hello\r\nBcc: attacker@example.com' }],
  ['recipient injection', { to: ['player@example.com\r\nRCPT TO:<attacker@example.com>'] }],
  ['multiple recipients', { to: ['player@example.com', 'attacker@example.com'] }],
  ['missing recipient', { to: [] }],
  ['invalid local part', { to: ['..player@example.com'] }],
  ['overlong domain label', { to: [`player@${'a'.repeat(64)}.com`] }],
  ['reply-to injection', { reply_to: 'support@example.com\nBcc: attacker@example.com' }],
  ['sender substitution', { from: 'attacker@example.com' }],
  ['oversized message', { text: 'a'.repeat(10_001) }],
  ['body control characters', { text: 'a\0b' }],
]) {
  test(`rejects ${name} before connecting`, async () => {
    const fake = fixture();
    await assert.rejects(fake.transport.send({ ...MESSAGE, ...changes }, KEY), errorMatches('renewal_notice_invalid_message'));
    assert.equal(fake.connections.length, 0);
  });
}

for (const key of ['arbitrary/key', `renewal/${'A'.repeat(64)}`, `renewal/${'a'.repeat(63)}`, `receipt/${'a'.repeat(64)}\n`]) {
  test('rejects an invalid durable message key before connecting', async () => {
    const fake = fixture();
    await assert.rejects(fake.transport.send(MESSAGE, key), errorMatches('renewal_notice_invalid_message'));
    assert.equal(fake.connections.length, 0);
  });
}

for (const change of [
  { username: 'billing@example.com\n' }, { username: 'other@example.com' }, { password: '' },
  { password: `${PASSWORD}\r\nDATA` }, { password: 'a'.repeat(1_025) }, { sender: 'Слова\nBcc: attacker@example.com' },
  { host: 'attacker.example.com' }, { port: 25 }, { port: 587 }, { secure: false },
  { servername: 'attacker.example.com' }, { rejectUnauthorized: false }, { timeoutMs: 0 },
  { timeoutMs: 60_001 }, { connectImpl: null },
]) {
  test('rejects invalid or overridable TLS configuration', () => {
    assert.throws(() => createTimewebMailTransport({ username: USER, password: PASSWORD, sender: SENDER, ...change }),
      errorMatches('renewal_notice_bad_configuration'));
  });
}

test('rejects malformed options instead of exposing JavaScript or credential errors', () => {
  for (const options of [null, [], 'credential-string']) {
    assert.throws(() => createTimewebMailTransport(options), errorMatches('renewal_notice_bad_configuration'));
  }
});

for (const options of [{ authorized: false }, { encrypted: false }]) {
  test('does not send commands over an unauthorized or unencrypted socket', async () => {
    const fake = fixture(options);
    await assert.rejects(fake.transport.send(MESSAGE, KEY), errorMatches('renewal_notice_gateway_unavailable'));
    assert.deepEqual(fake.sockets[0].writes, []);
  });
}

for (const response of [
  { reply: '250-Unfinished\r\n550 Different code\r\n' },
  { reply: 'garbage\r\n' },
  { reply: '250 Invalid bare newline\n' },
  { reply: `250-${'x'.repeat(65_536)}\r\n250 End\r\n` },
  { reply: '354 Unexpected positive status\r\n' },
  { reply: '250-AUTH PLAIN\r\n250 End\r\n235 Unsolicited AUTH acceptance\r\n' },
]) {
  test('rejects malformed, oversized or unexpected SMTP replies without leaking their text', async () => {
    const fake = fixture({ stage: 'ehlo', response });
    await assert.rejects(fake.transport.send(MESSAGE, KEY), errorMatches('renewal_notice_gateway_invalid_response'));
  });
}

test('requires final DATA 250 and quarantines an unknown post-DATA response', async () => {
  const fake = fixture({ stage: 'body', response: { reply: '235 Not DATA acceptance\r\n' } });
  await assert.rejects(fake.transport.send(MESSAGE, KEY),
    errorMatches('renewal_notice_gateway_invalid_response', { ambiguous: true }));
});

test('does not downgrade or silently skip unsupported authentication', async () => {
  const fake = fixture({ stage: 'ehlo', response: { reply: '250-AUTH CRAM-MD5\r\n250 End\r\n' } });
  await assert.rejects(fake.transport.send(MESSAGE, KEY), errorMatches('renewal_notice_gateway_rejected'));
  assert.equal(fake.sockets[0].writes.length, 1);
});

test('allows an address-only sender with the exact authenticated envelope', async () => {
  const fake = fixture();
  const transport = createTimewebMailTransport({ username: USER, password: PASSWORD, sender: USER,
    connectImpl: fake.connectImpl, timeoutMs: 30 });
  await transport.send({ ...MESSAGE, from: USER }, KEY);
  assert.ok(fake.sockets[0].writes[5].startsWith(`From: ${USER}\r\n`));
});
