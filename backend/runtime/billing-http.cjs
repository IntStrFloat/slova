const { Buffer } = require('node:buffer');

const BILLING_PATH = '/api/billing/';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function createBillingHttp({ billing, publicBase, seller = {}, now = () => new Date(), trustProxy = false, migrationResolver }) {
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
  const legalLinks = '<nav aria-label="Документы подписки"><p><a href="/api/billing/terms">Публичная оферта</a> · <a href="/api/billing/privacy">Политика конфиденциальности</a> · <a href="/api/billing/user-agreement">Пользовательское соглашение</a> · <a href="/api/billing/personal-data-consent">Согласие на обработку персональных данных</a> · <a href="/api/billing/manage">Управление подпиской</a></p></nav><p><a href="https://www.rustore.ru/catalog/app/com.intstrfloat.slova">Игра «Слова» в RuStore</a></p>';
  const manageForm = () => `<p>Проверьте подписку или отключите следующие списания. Уже оплаченный срок сохранится.</p><form method="post" action="${BILLING_PATH}manage"><label for="code">Код восстановления подписки</label><input id="code" name="recoveryCode" required maxlength="128" autocomplete="off" spellcheck="false"><label for="action">Действие</label><select id="action" name="action"><option value="status">Проверить подписку</option><option value="cancel">Отключить автопродление</option></select><button type="submit">Продолжить</button></form><p><a href="slova://shop">Открыть игру</a></p>${billing.catalog().provider === 'robokassa' ? legalLinks : ''}`;

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
    if (!['catalog', 'terms', 'privacy', 'user-agreement', 'personal-data-consent', 'return', 'manage', 'webhook', 'robokassa/result', 'robokassa/fail'].some((name) => path === BILLING_PATH + name)) return null;
    if (path === BILLING_PATH + 'catalog' && method === 'GET') {
      const catalog = billing.catalog();
      const compatible = !catalog.protocol || request.headers?.['x-slova-billing-protocol'] === catalog.protocol;
      return response(200, { ...catalog, available: compatible && catalog.available, termsUrl: base + BILLING_PATH + 'terms', privacyUrl: base + BILLING_PATH + 'privacy', userAgreementUrl: base + BILLING_PATH + 'user-agreement', personalDataConsentUrl: base + BILLING_PATH + 'personal-data-consent', manageUrl: base + BILLING_PATH + 'manage' });
    }
    if (path === BILLING_PATH + 'robokassa/fail' && method === 'GET') {
      return response(200, page('Проверка оплаты', '<p>Вернитесь в игру: она автоматически проверит платёж. Если проверка задержалась, нажмите «Проверить оплату» в игре. Повторно оплачивать не нужно.</p><p><a href="slova://shop">Открыть «Слова»</a></p>'), true);
    }
    if (path === BILLING_PATH + 'robokassa/result' && method === 'POST') {
      if (typeof billing.result !== 'function') return response(404, { error: 'not_found' });
      if (!allow(request, 'robokassa-result', 120)) return response(429, { error: 'rate_limited' });
      return execute(async () => {
        if (!String(request.headers?.['content-type'] ?? '').startsWith('application/x-www-form-urlencoded') ||
          Buffer.byteLength(String(request.body ?? '')) > 8192) throw Object.assign(new Error(), { code: 'bad_request', status: 400 });
        const fields = new URLSearchParams(request.body ?? '');
        const names = new Set();
        for (const name of fields.keys()) {
          if (names.has(name.toLowerCase())) throw Object.assign(new Error(), { code: 'bad_request', status: 400 });
          names.add(name.toLowerCase());
        }
        const invoiceId = await billing.result(Object.fromEntries(fields));
        const out = response(200, null);
        out.headers['content-type'] = 'text/plain; charset=utf-8';
        out.body = `OK${invoiceId}`;
        return out;
      });
    }
    if (path === BILLING_PATH + 'return' && method === 'GET') {
      return response(200, page('Вернуться в игру', '<p>Откройте игру: она автоматически проверит оплату. Подписка включится после подтверждения платежа. Если проверка задержалась, нажмите «Проверить оплату» в игре.</p><p><a href="slova://shop">Открыть «Слова»</a></p><p><a href="/api/billing/manage">Управление подпиской</a></p>'), true);
    }
    if (['terms', 'privacy', 'user-agreement', 'personal-data-consent'].some((name) => path === BILLING_PATH + name) && method === 'GET' && billing.catalog().provider === 'robokassa') {
      const plan = billing.catalog().plan;
      const document = path.slice(BILLING_PATH.length);
      const title = { terms: 'Публичная оферта: подписка «Без рекламных пауз»', privacy: 'Политика конфиденциальности', 'user-agreement': 'Пользовательское соглашение', 'personal-data-consent': 'Согласие на обработку персональных данных' }[document];
      if (!seller.name || !seller.inn || !seller.email) {
        return response(200, page(title, '<p>Продажи ещё не открыты. Условия и контакты продавца будут опубликованы до подключения платежей.</p>' + legalLinks), true);
      }
      const contact = `<p>Продавец и оператор персональных данных: ${escapeHtml(seller.name)}, плательщик налога на профессиональный доход (самозанятый), ИНН ${escapeHtml(seller.inn)}. Электронная почта для вопросов о подписке, возвратов и обработки данных: ${escapeHtml(seller.email)}.</p>`;
      const documents = {
        privacy: `${contact}
<h2>Какие данные используются и зачем</h2>
<p>Для оформления и обслуживания подписки обрабатываются электронная почта покупателя, идентификаторы игрового профиля и подписки, история согласий и отмен, сведения о платежах (номер, сумма, время и статус) и оплаченный срок. Эти данные нужны для предоставления доступа, чеков НПД, напоминаний о продлении, отмены, восстановления подписки, возвратов и разбора обращений.</p>
<p>Операции с данными включают сбор, запись, хранение, уточнение, использование, передачу указанным ниже получателям и удаление при прекращении оснований для хранения. Обработка ведётся с использованием средств автоматизации и при разборе обращений продавцом. Эта страница описывает данные подписки, а не все данные игрового приложения.</p>
<h2>Получатели данных</h2>
<p>Данные подписки хранятся на сервере продавца у Timeweb. Электронная почта передаётся почтовому сервису Timeweb для сервисных писем. Robokassa получает электронную почту и данные заказа для оплаты и выдачи чека через «Робочеки СМЗ»; сведения о доходе передаются в ФНС в рамках этого сервиса. Реквизиты банковской карты вводятся на защищённой странице Robokassa. Продавец не получает и не хранит номер карты и её защитный код.</p>
<h2>Основания обработки и отдельное согласие</h2>
<p>Для оформления подписки покупатель отдельно от принятия оферты и согласия на автоматические списания подтверждает <a href="/api/billing/personal-data-consent">согласие на обработку персональных данных</a>. Простое открытие этой политики не означает согласия. История фиксирует текст и версию каждого согласия, условия тарифа, время, связанный профиль и платёж, а также последующую отмену. Эти записи используются для подтверждения волеизъявления покупателя и разбора споров.</p>
<p>Обработка осуществляется на основании согласия, а в необходимом объёме — для заключения и исполнения договора по инициативе покупателя, исполнения обязанностей, установленных законодательством РФ, и защиты прав в предусмотренных законом случаях. Сервисные письма о подписке не являются согласием на рекламные рассылки; маркетинговое согласие при оформлении подписки не запрашивается.</p>
<h2>Срок хранения и защита</h2>
<p>Данные обрабатываются в течение обслуживания подписки, а после его завершения — в объёме и на срок, необходимых для исполнения установленных законом обязанностей и рассмотрения требований по платежам. Отзыв согласия не отменяет обязанности хранить сведения, для которых остаётся иное законное основание.</p>
<p>После достижения целей обработки и прекращения иных законных оснований данные удаляются или обезличиваются в сроки, предусмотренные законодательством РФ. Доступ к данным ограничивается задачами обслуживания подписки; при передаче используются защищённые соединения. Код восстановления не следует сообщать посторонним.</p>
<h2>Обращения и отзыв согласия</h2>
<p>Для уточнения, получения сведений об обработке, удаления данных или отзыва согласия обратитесь по указанной выше электронной почте. Укажите идентификатор игрового профиля или платежа; не отправляйте реквизиты карты, пароль или код восстановления подписки. Чтобы остановить будущие списания сразу, отключите автопродление в игре или на странице управления. Изменить email можно в магазине игры после завершения ожидающей оплаты.</p>
<small>Версия документа: ${escapeHtml(plan.privacyVersion || 'subscription-privacy-v2')}.</small>`,
        terms: `${contact}
<h2>1. Предмет и оформление подписки</h2>
<p>Продавец предлагает покупателю платную подписку «Без рекламных пауз» в Android-игре «Слова: Игра в слова». Подписка отключает баннеры и межстраничные рекламные паузы. Добровольные просмотры рекламы для получения бонусов остаются доступны. Игровая валюта и дополнительные игровые бонусы в стоимость не входят. Без подписки игра остаётся доступной с рекламой.</p>
<p>Перед оформлением покупатель знакомится с этой офертой, <a href="/api/billing/user-agreement">пользовательским соглашением</a>, <a href="/api/billing/privacy">политикой конфиденциальности</a> и отдельным <a href="/api/billing/personal-data-consent">согласием на обработку персональных данных</a>, указывает email для чеков и уведомлений. Покупатель самостоятельно отмечает согласие на автоматические списания и отдельно — согласие на обработку персональных данных, затем нажимает кнопку подключения. Галочка заранее не установлена ни для одного согласия. После подтверждения первой оплаты Robokassa договор на оплаченный период считается заключённым и доступ включается в игровом профиле.</p>
<h2>2. Цена и срок доступа</h2>
<p>Стоимость: ${escapeHtml(plan.amount)} ₽ за ${escapeHtml(plan.periodDays)} дней, валюта — российский рубль, без НДС. Первый платёж списывается при оформлении подписки. Оплаченный период начинается после подтверждения платежа и составляет ${escapeHtml(plan.periodDays)} × 24 часа. При своевременном продлении следующий период добавляется к концу текущего оплаченного периода. При задержке оплаты новый период начинается не раньше её подтверждения.</p>
<p>Плановое повторное списание наступает через ${escapeHtml(plan.periodDays)} × 24 часа после подтверждения первого платежа, далее — по окончании очередного оплаченного периода с учётом переноса, описанного ниже. Точная дата и время следующего списания и окончания доступа отображаются в магазине игры и <a href="/api/billing/manage">на странице управления подпиской</a> по московскому времени (МСК, Europe/Moscow, UTC+3).</p>
<p>Если подтверждение задержалось, вернитесь в игру и нажмите «Проверить оплату». Повторно оплачивать до выяснения статуса не нужно. Сохраните код восстановления для переноса подписки на другое устройство или после переустановки; он также позволяет управлять подпиской без игры.</p>
<p>Оплата выполняется через Robokassa. Карты иностранных банков не поддерживаются. Доступные способы оплаты показаны на платёжной странице; данные банковской карты вводятся на стороне платёжного сервиса.</p>
<h2>3. Регулярные списания</h2>
<p>Согласие покупателя: «${escapeHtml(plan.consentText || 'Я согласен на автоматические списания согласно условиям оферты')}».</p>
<p>Покупатель разрешает повторно списывать ${escapeHtml(plan.amount)} ₽ с использованной при первой оплате банковской карты за каждые следующие ${escapeHtml(plan.periodDays)} дней этой подписки до отключения автопродления. Списания выполняются через Robokassa. Текст, время и версия согласия, условия тарифа и история отмен сохраняются продавцом. Согласие на обработку персональных данных оформляется отдельно и само по себе не разрешает списание денег.</p>
<p>Не менее чем за 24 часа до повторного списания продавец отправляет уведомление на указанный email. При задержке отправки уведомления списание переносится: оно не начинается ранее чем через 24 часа после подтверждения отправки. Обновлённая дата и время отображаются в игре и на странице управления. До подтверждения нового платежа доступ не продлевается. При отказе в оплате автоматическое продление отключается; для нового оформления нужно снова выразить согласие.</p>
<p>Действующие подписки сохраняют исходные цену и период. Изменение публичного тарифа для новых покупок не меняет условия существующих списаний. Автоматической смены тарифа нет. Возможное изменение индивидуальных условий допускается только по отдельному предварительному предложению продавца, направленному покупателю по email, и только после нового явного согласия покупателя. Уже данное согласие не разрешает увеличить сумму или сократить период; без нового согласия новые условия не применяются. Покупатель может отказаться от предложения и отключить автопродление. Условия оплаченного периода сохраняются.</p>
<h2>4. Отмена и восстановление</h2>
<p>Отключить автопродление можно в магазине игры или <a href="/api/billing/manage">на странице управления подпиской</a>: введите код восстановления и выберите «Отключить автопродление». Отмена доступна без обращения в поддержку и сохраняет уже оплаченный срок. Она останавливает будущие списания, но уже переданный в Robokassa платёж может завершиться. Удаление приложения само по себе не отменяет подписку. При утрате доступа к коду или профилю обратитесь в поддержку продавца.</p>
<h2>5. Чеки, ошибки и возвраты</h2>
<p>При каждой успешной оплате, включая продление, номенклатура передаётся в Robokassa для формирования чека НПД сервисом «Робочеки СМЗ» и его направления на email покупателя. Если чек или доступ не появились, напишите продавцу, указав дату, сумму и номер платежа. Продавец проверит операцию и выдачу чека.</p>
<p>Для полного или частичного возврата направьте на email продавца номер платежа, дату, сумму и причину обращения. Возврат рассматривается с учётом фактического предоставления услуги и требований законодательства РФ; эта оферта не ограничивает обязательные права потребителя. Подтверждённый возврат выполняется через платёжный сервис на исходное средство оплаты. Срок зачисления зависит от банка и платёжного сервиса. При подтверждённом возврате оплаченный доступ корректируется соразмерно возвращённой сумме.</p>
<h2>6. Обращения и применимые условия</h2>
<p>При технической проблеме предоставьте идентификатор игрового профиля, номер платежа и описание ошибки. Не передавайте реквизиты карты, пароль или код восстановления. Спорные вопросы рассматриваются продавцом по электронной почте; к отношениям применяется законодательство Российской Федерации. Изменения условий для будущих покупок публикуются с новой версией; условия уже оформленной подписки фиксируются в истории согласия.</p>
<small>Версия оферты и согласия: ${escapeHtml(plan.termsVersion || plan.consentVersion || 'no-ads-30-robokassa-v3')}.</small>`,
        'user-agreement': `${contact}
<h2>1. Использование игры</h2>
<p>Это соглашение определяет условия использования Android-игры «Слова: Игра в слова» и связанной с ней услуги подписки. Пользователь может установить игру из RuStore и использовать её для личной игры на совместимом устройстве. Условия платной услуги изложены в отдельной <a href="/api/billing/terms">публичной оферте</a>; открытие или использование игры само по себе не оформляет платную подписку.</p>
<p>Игра доступна без подписки с рекламой. Подписка «Без рекламных пауз» отключает баннеры и межстраничные рекламные паузы на оплаченный срок, но оставляет добровольные просмотры за бонусы. Стоимость и период показываются перед оформлением.</p>
<h2>2. Профиль и доступ</h2>
<p>Игровой профиль используется для сохранения оплаченного доступа и управления подпиской. Пользователь указывает свой действующий email и может уточнить его в магазине игры после завершения ожидающей оплаты. Код восстановления позволяет восстановить подписку после переустановки или на другом устройстве; храните его в безопасном месте и не передавайте посторонним.</p>
<p>Для проверки оплаты, восстановления и управления подпиской требуется соединение с сервером. Если статус не обновился, используйте кнопку «Проверить оплату» или обратитесь в поддержку с номером платежа и идентификатором профиля. Уже оплаченный срок не должен оплачиваться повторно только из-за ошибки отображения.</p>
<h2>3. Правила использования</h2>
<p>Используйте игру законным способом, не вмешивайтесь в работу чужих профилей и сервера, не пытайтесь получить чужие платёжные данные или код восстановления. Пользователь вправе прекратить использование игры в любое время. Удаление приложения не отключает автопродление: это действие доступно в магазине игры и на странице управления подпиской.</p>
<h2>4. Оплата, данные и обращения</h2>
<p>Оплата, автопродление, отмена и возвраты регулируются офертой. Карты иностранных банков не поддерживаются. Согласие на обработку персональных данных оформляется отдельным действием и отдельным документом; сведения об обработке доступны в политике конфиденциальности. Согласие на рекламные рассылки не является условием использования игры.</p>
<p>По вопросам работы игры и подписки обращайтесь по электронной почте продавца, указанной выше. Не направляйте реквизиты карты, пароль или код восстановления. При ошибке продавец проверяет обращение и принимает меры для восстановления предусмотренного договором доступа. Это соглашение не ограничивает обязательные права пользователя по законодательству РФ.</p>
<h2>5. Изменение условий</h2>
<p>Новая редакция публикуется с новой версией документа. Изменения не отменяют уже оплаченный доступ. Изменение цены или периода и автоматические списания на новых условиях требуют нового явного согласия по правилам оферты.</p>
<small>Версия документа: ${escapeHtml(plan.userAgreementVersion || 'subscription-user-agreement-v1')}.</small>`,
        'personal-data-consent': `${contact}
<h2>1. На что я даю согласие</h2>
<p>Я свободно, своей волей и в своём интересе даю указанному выше оператору согласие на обработку моих персональных данных для оформления и обслуживания подписки «Без рекламных пауз» в Android-игре «Слова: Игра в слова».</p>
<p>Цели: связать платёж с моим игровым профилем, предоставить и восстановить оплаченный доступ, выдать и доставить чек НПД, отправлять сервисные уведомления о продлении и изменении условий, выполнять отмену и возвраты, рассматривать мои обращения и подтверждать историю согласий и действий по подписке.</p>
<h2>2. Данные и действия с ними</h2>
<p>Перечень данных: моя электронная почта; идентификаторы игрового профиля, подписки и платежей; сумма, дата, время и статус платежа, оплаченный срок; текст, версия, дата и время выраженных мной согласий, сведения об отмене автопродления; сведения, которые я направляю в обращении о подписке. Номер банковской карты и её защитный код оператору не передаются и им не хранятся.</p>
<p>Разрешённые действия: сбор, запись, систематизация, накопление, хранение, уточнение, извлечение, использование, передача перечисленным ниже получателям для указанных целей, блокирование, удаление и уничтожение. Обработка выполняется с использованием средств автоматизации и без них при рассмотрении обращений.</p>
<h2>3. Получатели</h2>
<p>Timeweb используется для хранения данных на сервере продавца и отправки сервисных писем. Robokassa получает email и сведения о заказе для проведения оплаты и формирования чека НПД сервисом «Робочеки СМЗ»; сведения о доходе передаются в ФНС в рамках этого сервиса. Передача ограничена целями обслуживания подписки. Это согласие не разрешает общедоступное распространение данных или рекламные рассылки.</p>
<h2>4. Срок и отзыв</h2>
<p>Согласие действует со дня его подтверждения до завершения обслуживания подписки и рассмотрения связанных с ней обращений либо до отзыва согласия. Его можно отозвать письмом на электронную почту оператора, указанную выше. Для поиска записи укажите идентификатор профиля или номер платежа; не отправляйте реквизиты карты, пароль или код восстановления. Оператор рассматривает обращение и прекращает обработку на основании согласия в сроки, предусмотренные законодательством РФ.</p>
<p>После отзыва или достижения целей обработки оператор сохраняет только те сведения и только на тот срок, для которых остаётся самостоятельное законное основание: исполнение договора, установленных законом обязанностей или рассмотрение требований по платежам. После прекращения этих оснований сведения удаляются или обезличиваются. Чтобы сразу остановить будущие списания, можно независимо отключить автопродление в игре или на странице управления.</p>
<h2>5. Отдельное подтверждение</h2>
<p>Перед оформлением я самостоятельно отмечаю отдельный, заранее не установленный флажок: «${escapeHtml(plan.personalDataConsentText || 'Я согласен на обработку персональных данных')}». Оператор сохраняет текст и версию этого согласия, дату и время подтверждения и связь с моим профилем. Принятие оферты, пользовательского соглашения или согласие на автоматические списания не заменяют это отдельное действие. Просмотр документа не является согласием.</p>
<small>Версия документа: ${escapeHtml(plan.personalDataConsentVersion || 'subscription-personal-data-v1')}.</small>`,
      };
      return response(200, page(title, documents[document] + legalLinks), true);
    }
    if (path === BILLING_PATH + 'terms' && method === 'GET') {
      const plan = billing.catalog().plan;
      const text = seller.name && seller.inn && seller.email
        ? `<p>Продавец: ${escapeHtml(seller.name)}, ИНН ${escapeHtml(seller.inn)}. Поддержка: ${escapeHtml(seller.email)}.</p><p>Подписка «Без рекламных пауз» отключает баннеры и межстраничные рекламные паузы в игре «Слова». Добровольные просмотры рекламы для получения бонусов остаются доступны.</p><p>Стоимость: ${escapeHtml(plan.amount)} ₽ за ${escapeHtml(plan.periodDays)} дней. Первый платёж списывается при покупке; затем та же сумма списывается каждые ${escapeHtml(plan.periodDays)} дней при включённом автопродлении. Дата следующего списания отображается в игре.</p><p>Автопродление включается только с отдельного согласия покупателя. Его можно отключить в магазине игры или <a href="/api/billing/manage">на странице управления подпиской</a>, используя сохранённый код восстановления. Отключение останавливает будущие списания; оплаченный доступ действует до указанной даты.</p><p>Возвраты: обратитесь в поддержку продавца. Заявления рассматриваются в соответствии с законодательством РФ. Чек НПД направляет продавец.</p><p>Сохраните код восстановления: он нужен для управления подпиской после удаления игры или смены устройства. Не передавайте его другим людям.</p><small>Версия условий: ${escapeHtml(plan.consentVersion)}.</small>`
        : '<p>Продажи ещё не открыты. Условия и контакты продавца будут опубликованы до подключения платежей.</p>';
      const notices = seller.name && seller.inn && seller.email
        ? '<p>Перед продлением продавец отправляет напоминание на указанную при покупке электронную почту. Повторное списание начинается не ранее чем через 24 часа после подтверждения отправки напоминания. При задержке дата списания переносится; до подтверждения нового платежа доступ не продлевается. Если платёж уже отправлен провайдеру, он может завершиться после отключения автопродления.</p><p>Электронная почта используется для чеков НПД, уведомлений о продлении и обращений по подписке. Она хранится вместе с историей платежей на сервере продавца. Для доставки писем адрес передаётся почтовому сервису Timeweb. Реквизиты карты вводятся на стороне платёжного сервиса ЮKassa; продавец не получает номер карты и её защитный код. По вопросам обработки данных обратитесь в поддержку продавца.</p>'
        : '';
      const terms = billing.catalog().provider === 'robokassa'
        ? (text + notices).replace('ЮKassa', 'Robokassa').replace('Чек НПД направляет продавец.', 'Чек НПД оформляется через подключённый сервис «Робочеки СМЗ» и направляется на указанную электронную почту.')
          + '<p><a href="https://www.rustore.ru/catalog/app/com.intstrfloat.slova">Игра «Слова» в RuStore</a></p>'
        : text + notices;
      return response(200, page('Условия подписки', terms), true);
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
      if (typeof billing.webhook !== 'function') return response(404, { error: 'not_found' });
      if (!allow(request, 'webhook', 120)) return response(429, { error: 'rate_limited' });
      return execute(async () => response(200, await billing.webhook(bodyOf(request))));
    }
    return response(405, { error: 'method_not_allowed' });
  }

  async function handleUser(request, userId) {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (!path.startsWith(BILLING_PATH)) return null;
    const method = String(request.method ?? 'GET').toUpperCase();
    const catalog = billing.catalog();
    const requiresCurrentProtocol = method === 'POST' && ['checkout', 'migration/resolve'].some((route) => path === BILLING_PATH + route);
    if (requiresCurrentProtocol && catalog.protocol && request.headers?.['x-slova-billing-protocol'] !== catalog.protocol) {
      return response(409, { error: 'billing_client_update_required' });
    }
    return execute(async () => {
      if (path === BILLING_PATH + 'migration/resolve' && method === 'POST') {
        if (!allow(request, `migration:${userId}`, 6)) return response(429, { error: 'rate_limited' });
        if (!migrationResolver) return response(409, { error: 'billing_migration_unresolved' });
        return response(200, await migrationResolver.resolve(userId, bodyOf(request)));
      }
      if (path === BILLING_PATH + 'analytics-binding' && method === 'POST') {
        if (!allow(request, `analytics:${userId}`, 20)) return response(429, { error: 'rate_limited' });
        if (typeof billing.setAnalyticsBinding !== 'function') return response(503, { error: 'billing_analytics_unavailable' });
        return response(200, await billing.setAnalyticsBinding(userId, bodyOf(request)));
      }
      if (path === BILLING_PATH + 'subscription' && method === 'GET') {
        const requestId = new URL(request.url, 'http://localhost').searchParams.get('checkoutRequestId');
        return response(200, await billing.status(userId, requestId ?? undefined));
      }
      if (path === BILLING_PATH + 'checkout' && method === 'POST') {
        if (!allow(request, `checkout:${userId}`, 6)) return response(429, { error: 'rate_limited' });
        return response(200, await billing.checkout(userId, bodyOf(request)));
      }
      if (path === BILLING_PATH + 'subscription/cancel' && method === 'POST') return response(200, await billing.cancel(userId));
      if (path === BILLING_PATH + 'email' && method === 'POST') {
        if (!allow(request, `email:${userId}`, 6)) return response(429, { error: 'rate_limited' });
        return response(200, await billing.updateEmail(userId, bodyOf(request)));
      }
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
