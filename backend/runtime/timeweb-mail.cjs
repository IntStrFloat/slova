const crypto = require('node:crypto');
const tls = require('node:tls');
const { Buffer } = require('node:buffer');
const { noticeError } = require('./renewal-notices.cjs');

const HOST = 'smtp.timeweb.ru';
const MAX_REPLY_BYTES = 65_536;
const MAX_MESSAGE_BYTES = 65_536;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const BODY_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const OPTIONS = new Set(['username', 'password', 'sender', 'connectImpl', 'timeoutMs']);

function email(value) {
  if (typeof value !== 'string' || value.length > 254) return false;
  const parts = value.split('@');
  if (parts.length !== 2 || parts[0].length > 64 || !LOCAL_PART.test(parts[0])) return false;
  const labels = parts[1].split('.');
  return labels.length > 1 && labels.every((label) => LABEL.test(label));
}

function senderParts(value) {
  if (typeof value !== 'string' || value.length > 320 || CONTROL.test(value)) return null;
  if (email(value)) return { address: value, name: null };
  const match = /^([^<>"\\]{1,64}) <([^<>]+)>$/.exec(value);
  return match && match[1].trim() && email(match[2]) ? { address: match[2], name: match[1] } : null;
}

// RFC 2047 words are folded on Unicode boundaries; even a Subject prefix fits
// within its 76-character limit. The address gets its own continuation line.
function encodedWords(value) {
  const words = [];
  let current = '';
  for (const character of value) {
    if (Buffer.byteLength(current + character, 'utf8') > 36) {
      words.push(`=?UTF-8?B?${Buffer.from(current, 'utf8').toString('base64')}?=`);
      current = '';
    }
    current += character;
  }
  if (current) words.push(`=?UTF-8?B?${Buffer.from(current, 'utf8').toString('base64')}?=`);
  return words.join('\r\n ');
}

function serializeMessage(message, from, key) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.from !== from.original ||
      !Array.isArray(message.to) || message.to.length !== 1 || !email(message.to[0]) ||
      !email(message.reply_to) || typeof message.subject !== 'string' || !message.subject.trim() ||
      message.subject.length > 200 || CONTROL.test(message.subject) ||
      typeof message.text !== 'string' || !message.text.trim() || message.text.length > 10_000 ||
      BODY_CONTROL.test(message.text) || typeof key !== 'string' || !/^(?:renewal|receipt)\/[a-f0-9]{64}$/.test(key)) {
    throw noticeError('renewal_notice_invalid_message');
  }
  const id = crypto.createHash('sha256').update(key).digest('hex');
  const body = Buffer.from(message.text.replace(/\r\n|\r|\n/g, '\r\n'), 'utf8')
    .toString('base64').match(/.{1,76}/g).join('\r\n');
  const mime = [
    `From: ${from.name ? `${encodedWords(from.name)}\r\n <${from.address}>` : from.address}`,
    `To: ${message.to[0]}`,
    `Reply-To: ${message.reply_to}`,
    `Subject: ${encodedWords(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${id}@${from.address.split('@')[1]}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '', body, '',
  ].join('\r\n');
  if (Buffer.byteLength(mime, 'utf8') > MAX_MESSAGE_BYTES) throw noticeError('renewal_notice_invalid_message');
  // Base64 has no dots; apply SMTP transparency nevertheless.
  return { id, recipient: message.to[0], data: `${mime.replace(/^\./gm, '..')}.\r\n` };
}

// Timeweb: https://timeweb.com/ru/docs/pochta/osnovnye-voprosy-po-rabote-s-pochtoj/otpravka-pochty-cherez-skripty/
// TLS certificate/SNI: https://nodejs.org/api/tls.html#tlsconnectoptions-callback
// SMTP acceptance/multiline replies: https://www.rfc-editor.org/rfc/rfc5321#section-4.1.1.4
// AUTH and MIME: https://www.rfc-editor.org/rfc/rfc4954 and RFC 2047/2045.
// This is a live transport. SMTP offers no provider idempotency guarantee:
// the stable Message-ID is for reconciliation, never permission to resend.
function createTimewebMailTransport(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw noticeError('renewal_notice_bad_configuration');
  }
  const { username, password, sender, connectImpl = tls.connect, timeoutMs = 15_000 } = options;
  const from = senderParts(sender);
  if (Object.keys(options).some((name) => !OPTIONS.has(name)) || !email(username) || !from ||
      from.address !== username || typeof password !== 'string' || !password ||
      Buffer.byteLength(password, 'utf8') > 1_024 || CONTROL.test(password) ||
      typeof connectImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw noticeError('renewal_notice_bad_configuration');
  }
  from.original = sender;
  return {
    mode: 'live',
    idempotencyWindowMs: 0,
    async send(message, key) {
      const mail = serializeMessage(message, from, key); // Validate before any network activity.
      let socket;
      try {
        socket = connectImpl({ host: HOST, port: 465, servername: HOST,
          rejectUnauthorized: true, minVersion: 'TLSv1.2' });
      } catch { throw noticeError('renewal_notice_gateway_unavailable'); }
      if (!socket || ['on', 'once', 'write', 'destroy'].some((name) => typeof socket[name] !== 'function')) {
        try { socket?.destroy?.(); } catch { /* Invalid injected connections fail closed. */ }
        throw noticeError('renewal_notice_gateway_unavailable');
      }
      let finished = false;
      let accepted = false;
      let dataStarted = false;
      let secure = false;
      let failure = null;
      let waiter = null;
      let greeting = null;
      let awaitingGreeting = true;
      let buffer = '';
      let replyCode = null;
      let replyBytes = 0;
      let replyLines = [];
      let resolveSecure;
      let rejectSecure;
      const connected = new Promise((resolve, reject) => { resolveSecure = resolve; rejectSecure = reject; });
      function unavailable() {
        return noticeError('renewal_notice_gateway_unavailable', { ambiguous: dataStarted });
      }
      function invalidReply() {
        return noticeError('renewal_notice_gateway_invalid_response', { ambiguous: dataStarted });
      }
      function fail(error) {
        if (finished || accepted || failure) return;
        failure = error;
        rejectSecure(error);
        if (waiter) { const pending = waiter; waiter = null; pending.reject(error); }
      }
      function receive(reply) {
        if (waiter) {
          const pending = waiter;
          waiter = null;
          // Remember acceptance synchronously, before a same-turn socket close.
          if (pending.acceptance && reply.code === 250) accepted = true;
          pending.resolve(reply);
        } else if (awaitingGreeting && !greeting) greeting = reply;
        else fail(invalidReply());
      }
      function onData(chunk) {
        if (finished || accepted || failure) return;
        if (!secure || !Buffer.isBuffer(chunk)) { fail(invalidReply()); return; }
        buffer += chunk.toString('latin1');
        if (replyBytes + buffer.length > MAX_REPLY_BYTES || /(^|[^\r])\n|\r[^\n]/.test(buffer)) {
          fail(invalidReply()); return;
        }
        let end;
        while ((end = buffer.indexOf('\r\n')) !== -1 && !failure && !accepted) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const match = /^([2-5][0-5][0-9])(?:([ -])([^\u0000-\u0008\u000b-\u001f\u007f]*))?$/.exec(line);
          if (!match || (replyCode !== null && replyCode !== Number(match[1]))) { fail(invalidReply()); return; }
          replyCode = Number(match[1]);
          replyBytes += line.length + 2;
          replyLines.push(match[3] ?? '');
          if (match[2] !== '-') {
            const reply = { code: replyCode, lines: replyLines };
            replyCode = null; replyBytes = 0; replyLines = [];
            receive(reply);
          }
        }
      }
      function readReply(acceptance = false) {
        awaitingGreeting = false;
        if (failure) return Promise.reject(failure);
        if (greeting) { const reply = greeting; greeting = null; return Promise.resolve(reply); }
        return new Promise((resolve, reject) => { waiter = { resolve, reject, acceptance }; });
      }
      function expect(reply, codes) {
        if (codes.includes(reply.code)) return reply;
        if (reply.code >= 400 && reply.code < 500) {
          throw noticeError('renewal_notice_gateway_unavailable', { retryable: true });
        }
        if (reply.code >= 500) throw noticeError('renewal_notice_gateway_rejected');
        throw invalidReply();
      }
      async function command(value, codes, acceptance = false) {
        if (failure) throw failure;
        const response = readReply(acceptance);
        try { socket.write(value); } catch { fail(unavailable()); }
        return expect(await response, codes);
      }
      const timer = setTimeout(() => fail(unavailable()), timeoutMs);
      try {
        socket.on('error', () => fail(unavailable())); // Never expose TLS/SMTP error text.
        socket.on('close', () => fail(unavailable()));
        socket.on('end', () => fail(unavailable()));
        socket.on('timeout', () => fail(unavailable()));
        socket.on('data', onData);
        socket.once('secureConnect', () => {
          if (socket.encrypted !== true || socket.authorized !== true) { fail(unavailable()); return; }
          secure = true;
          resolveSecure();
        });
        await connected;
        expect(await readReply(), [220]);
        const hello = await command(`EHLO ${from.address.split('@')[1]}\r\n`, [250]);
        const mechanisms = hello.lines.flatMap((line) => {
          const match = /^AUTH(?:=|\s+)(.*)$/i.exec(line);
          return match ? match[1].toUpperCase().split(/\s+/) : [];
        });
        if (mechanisms.includes('PLAIN')) {
          // No fallback after an AUTH error: each send makes exactly one attempt.
          await command(`AUTH PLAIN ${Buffer.from(`\0${username}\0${password}`, 'utf8').toString('base64')}\r\n`, [235]);
        } else if (mechanisms.includes('LOGIN')) {
          await command('AUTH LOGIN\r\n', [334]);
          await command(`${Buffer.from(username, 'utf8').toString('base64')}\r\n`, [334]);
          await command(`${Buffer.from(password, 'utf8').toString('base64')}\r\n`, [235]);
        } else throw noticeError('renewal_notice_gateway_rejected');
        await command(`MAIL FROM:<${username}>\r\n`, [250]);
        await command(`RCPT TO:<${mail.recipient}>\r\n`, [250, 251]);
        // Conservatively quarantine unknown outcomes from the DATA command on.
        dataStarted = true;
        await command('DATA\r\n', [354]);
        await command(mail.data, [250], true);
        try { socket.write('QUIT\r\n'); } catch { /* Acceptance survives QUIT failure. */ }
        return { id: mail.id };
      } catch (error) {
        // Only our bounded codes/flags escape, including for injected sockets.
        if (['renewal_notice_gateway_unavailable', 'renewal_notice_gateway_invalid_response',
          'renewal_notice_gateway_rejected'].includes(error?.code)) {
          throw noticeError(error.code, { retryable: error.retryable === true, ambiguous: error.ambiguous === true });
        }
        throw unavailable();
      } finally {
        finished = true;
        clearTimeout(timer);
        try { socket.destroy(); } catch { /* No raw socket errors escape. */ }
      }
    },
  };
}

module.exports = { createTimewebMailTransport };
