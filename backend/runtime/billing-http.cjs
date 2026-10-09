const { Buffer } = require('node:buffer');

const BILLING_PATH = '/api/billing/';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function createBillingHttp({ billing, publicBase, seller = {}, now = () => new Date(), trustProxy = false }) {
  const limits = new Map();
  const base = String(publicBase ?? '').replace(/\/$/, '');
  const response = (status, body, html = false) => ({
    status,
    headers: {
      'content-type': html ? 'text/html; charset=utf-8' : 'application/json',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': '*',
      ...(html ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" } : {}),
    },
    body: html ? body : JSON.stringify(body),
  });
  const page = (title, content) => `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — Слова</title><style>body{font:18px/1.5 system-ui,sans-serif;background:#f8f3e9;color:#282532;margin:0;padding:24px}main{max-width:580px;margin:24px auto}h1{font-size:30px}a{color:#245b48}label{display:block;margin:20px 0 8px}input,button,select{box-sizing:border-box;width:100%;font:inherit;padding:14px;border:1px solid #827e76;border-radius:12px}button{margin-top:14px;background:#245b48;color:#fff}small{color:#555}p{overflow-wrap:anywhere}</style><main><h1>${escapeHtml(title)}</h1>${content}</main></html>`;
  const manageForm = () => `<p>Проверьте подписку или отключите следующие списания. Уже оплаченный срок сохранится.</p><form method="post" action="${BILLING_PATH}manage"><label for="code">Код восстановления подписки</label><input id="code" name="recoveryCode" required maxlength="128" autocomplete="off" spellcheck="false"><label for="action">Действие</label><select id="action" name="action"><option value="status">Проверить подписку</option><option value="cancel">Отключить автопродление</option></select><button type="submit">Продолжить</button></form><p><a href="slova://shop">Открыть игру</a></p>`;

  function bodyOf(request) {
    if (Buffer.byteLength(String(request.body ?? '')) > 8192) throw Object.assign(new Error(), { code: 'bad_request', status: 413 });
    const type = String(request.headers?.['content-type'] ?? '');
    const body = type.startsWith('application/x-www-form-urlencoded')
      ? Object.fromEntries(new URLSearchParams(request.body ?? ''))
      : JSON.parse(request.body || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error(), { code: 'bad_request', status: 400 });
    return body;
  }

  function allow(request, key, maximum = 20) {
    const timestamp = now().getTime();
    for (const [name, entry] of limits) if (timestamp - entry.started >= 60_000) limits.delete(name);
    const forwarded = request.headers?.['x-forwarded-for'];
    const ip = trustProxy && typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : request.ip;
    const bucket = `${key}:${String(ip ?? 'unknown').slice(0, 64)}`;
    const entry = limits.get(bucket) ?? { started: timestamp, count: 0 };
    if (entry.count >= maximum || (!limits.has(bucket) && limits.size >= 2000)) return false;
    entry.count += 1;
    limits.set(bucket, entry);
    return true;
  }

  async function execute(action, html = false) {
    try { return await action(); } catch (error) {
      const code = error instanceof SyntaxError ? 'bad_request' : typeof error?.code === 'string' && /^[a-z_]{1,64}$/.test(error.code) ? error.code : 'billing_unavailable';
      const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 503 ? error.status
        : /disabled|unavailable/.test(code) ? 503 : /conflict|active_subscription/.test(code) ? 409 : /invalid|bad_|consent|recovery/.test(code) ? 400 : 502;
      return html ? response(status, page('Не удалось выполнить действие', `<p>Проверьте код и попробуйте ещё раз. Если проблема сохраняется, обратитесь в поддержку игры.</p>${manageForm()}`), true)
        : response(status, { error: code });
    }
  }

  async function handlePublic(request) {
    const path = new URL(request.url, 'http://localhost').pathname;
    const method = String(request.method ?? 'GET').toUpperCase();
    if (!['catalog', 'terms', 'return', 'manage', 'webhook'].some((name) => path === BILLING_PATH + name)) return null;
    if (path === BILLING_PATH + 'catalog' && method === 'GET') {
      return response(200, { ...billing.catalog(), termsUrl: base + BILLING_PATH + 'terms', manageUrl: base + BILLING_PATH + 'manage' });
    }
    if (path === BILLING_PATH + 'return' && method === 'GET') {
      return response(200, page('Вернуться в игру', '<p>Откройте игру и нажмите «Проверить оплату». Подписка включится после подтверждения платежа.</p><p><a href="slova://shop">Открыть «Слова»</a></p><p><a href="/api/billing/manage">Управление подпиской</a></p>'), true);
    }
    if (path === BILLING_PATH + 'terms' && method === 'GET') {
      const plan = billing.catalog().plan;
      const text = seller.name && seller.inn && seller.email
        ? `<p>Продавец: ${escapeHtml(seller.name)}, ИНН ${escapeHtml(seller.inn)}. Поддержка: ${escapeHtml(seller.email)}.</p><p>Подписка «Без рекламных пауз» отключает баннеры и межстраничные рекламные паузы в игре «Слова». Добровольные просмотры рекламы для получения бонусов остаются доступны.</p><p>Стоимость: ${escapeHtml(plan.amount)} ₽ за ${escapeHtml(plan.periodDays)} дней. Первый платёж списывается при покупке; затем та же сумма списывается каждые ${escapeHtml(plan.periodDays)} дней при включённом автопродлении. Дата следующего списания отображается в игре.</p><p>Автопродление включается только с отдельного согласия покупателя. Его можно отключить в магазине игры или <a href="/api/billing/manage">на странице управления подпиской</a>, используя сохранённый код восстановления. Отключение останавливает будущие списания; оплаченный доступ действует до указанной даты.</p><p>Возвраты: обратитесь в поддержку продавца. Заявления рассматриваются в соответствии с законодательством РФ. Чек НПД направляет продавец.</p><p>Сохраните код восстановления: он нужен для управления подпиской после удаления игры или смены устройства. Не передавайте его другим людям.</p><small>Версия условий: ${escapeHtml(plan.consentVersion)}.</small>`
        : '<p>Продажи ещё не открыты. Условия и контакты продавца будут опубликованы до подключения платежей.</p>';
      const notices = seller.name && seller.inn && seller.email
        ? '<p>Перед продлением продавец отправляет напоминание на указанную при покупке электронную почту. Повторное списание начинается не ранее чем через 24 часа после подтверждения отправки напоминания. При задержке дата списания переносится; до подтверждения нового платежа доступ не продлевается. Если платёж уже отправлен провайдеру, он может завершиться после отключения автопродления.</p><p>Электронная почта используется для чеков НПД, уведомлений о продлении и обращений по подписке. Она хранится вместе с историей платежей на сервере продавца. Для доставки писем адрес передаётся почтовому сервису Timeweb. Реквизиты карты вводятся на стороне платёжного сервиса ЮKassa; продавец не получает номер карты и её защитный код. По вопросам обработки данных обратитесь в поддержку продавца.</p>'
        : '';
      return response(200, page('Условия подписки', text + notices), true);
    }
    if (path === BILLING_PATH + 'manage' && method === 'GET') return response(200, page('Управление подпиской', manageForm()), true);
    if (path === BILLING_PATH + 'manage' && method === 'POST') {
      const html = String(request.headers?.['content-type'] ?? '').startsWith('application/x-www-form-urlencoded');
      if (!allow(request, 'manage', 8)) return response(429, html ? page('Попробуйте позже', '<p>Слишком много попыток. Подождите минуту.</p>') : { error: 'rate_limited' }, html);
      return execute(async () => {
        const result = await billing.manage(bodyOf(request));
        if (!html) return response(200, result);
        const until = result.activeUntil ? new Date(result.activeUntil).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : null;
        const next = result.nextPaymentAt ? new Date(result.nextPaymentAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : null;
        const renewal = result.autoRenew ? `Автопродление включено. ${next ? `Следующее списание: ${escapeHtml(next)} (МСК).` : 'Дата продления будет сообщена по электронной почте.'}` : 'Автопродление выключено. Следующих списаний не будет.';
        return response(200, page('Подписка', `<p>${result.active ? `Оплаченный доступ действует до ${escapeHtml(until)} (МСК).` : 'Оплаченного доступа сейчас нет.'}</p><p>${renewal}</p>${manageForm()}`), true);
      }, html);
    }
    if (path === BILLING_PATH + 'webhook' && method === 'POST') {
      if (!allow(request, 'webhook', 120)) return response(429, { error: 'rate_limited' });
      return execute(async () => response(200, await billing.webhook(bodyOf(request))));
    }
    return response(405, { error: 'method_not_allowed' });
  }

  async function handleUser(request, userId) {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (!path.startsWith(BILLING_PATH)) return null;
    const method = String(request.method ?? 'GET').toUpperCase();
    return execute(async () => {
      if (path === BILLING_PATH + 'subscription' && method === 'GET') return response(200, await billing.status(userId));
      if (path === BILLING_PATH + 'checkout' && method === 'POST') {
        if (!allow(request, `checkout:${userId}`, 6)) return response(429, { error: 'rate_limited' });
        return response(200, await billing.checkout(userId, bodyOf(request)));
      }
      if (path === BILLING_PATH + 'subscription/cancel' && method === 'POST') return response(200, await billing.cancel(userId));
      if (path === BILLING_PATH + 'recovery' && method === 'POST') return response(200, await billing.recovery(userId));
      if (path === BILLING_PATH + 'restore' && method === 'POST') {
        if (!allow(request, 'restore', 8)) return response(429, { error: 'rate_limited' });
        return response(200, await billing.restore(userId, bodyOf(request)));
      }
      return response(404, { error: 'not_found' });
    });
  }
  return { handlePublic, handleUser };
}

module.exports = { createBillingHttp, escapeHtml };
