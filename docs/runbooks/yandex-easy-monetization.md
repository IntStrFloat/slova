# Простая монетизация Яндекса — Slova

Интеграция: 20 октября 2026; повторная проверка инструкции и уточнения менеджера: 21 октября 2026. Android package `com.intstrfloat.slova`, приложение Простой монетизации `20249615`.

В авторизованном кабинете РСЯ прочитаны параметры приложения: сервис включён, приложение активно, каждый из трёх новых блоков активен и соответствует своему формату. Изменения настроек не выполнялись. В управляемых параметрах этого приложения нет видимого поля сайта app-ads.txt или Google APPLICATION_ID. Доказательство чтения: `output/easy-monetization-2026-10-20/partner-account-validation.json`.

## Ответственность сторон

Яндекс управляет сетями, рекламными блоками, ставками и оптимизацией на своей стороне. В приложении остаются интеграция SDK медиации, места показов, выдача игровых наград и публикация app-ads.txt. Подключение сервиса в кабинете само по себе не меняет установленную Android-сборку.

Источники:

- [FAQ Простой монетизации](https://ads.yandex.com/helpcenter/ru/easy/faq).
- [Инструкция, присланная менеджером](https://ads.yandex.com/helpcenter/ru/easy/integration/platforms).
- [Единая сборка для React Native / Expo](https://ads.yandex.com/helpcenter/ru/easy/integration/react-native/integration/mediation).
- [Инициализация](https://ads.yandex.com/helpcenter/ru/easy/integration/react-native/integration/initializing-sdk).
- [Тестирование и официальные демоблоки](https://ads.yandex.com/helpcenter/ru/easy/integration/react-native/testing).
- [Google APPLICATION_ID](https://ads.yandex.com/helpcenter/ru/easy/integration/react-native/integration/additional-setup).
- [Дополнительный репозиторий BidMachine](https://ads.yandex.com/helpcenter/ru/dev/android/quick-start-mm).

## Состав SDK и воспроизводимость

- Expo SDK 56 / React Native 0.85.3 / New Architecture / Hermes сохранены; iOS не добавляется.
- JS wrapper `yandex-mobile-ads` закреплён на `8.5.0`. Существующий `patch-package` закрепляет Android SDK `8.6.0`.
- Вместо отдельно выбранного VK-адаптера подключён **полный** `com.yandex.android:mobileads-mediation:8.6.0.0`, совместимый с уже используемым Android SDK. Адаптеры не исключаются.
- На 21 октября 2026 RN-инструкция также указывает Android mediation `8.6.0.0`; используемая версия совпадает с ней и с [POM Яндекса](https://repo.maven.apache.org/maven2/com/yandex/android/mobileads-mediation/8.6.0.0/mobileads-mediation-8.6.0.0.pom).
- `plugins/withYandexEasyMonetization.js` сохраняет dependency, репозитории и опциональный Google ID при генерации native-проекта. Мигрирует прежнюю standalone VK dependency. Подпись не меняет.
- Gradle-репозитории ограничены собственными группами, включая транзитивные `com.explorestack` для BidMachine и `com.iab.omid.library` для Chartboost. Это предотвращает запросы чужих metadata к каждому vendor endpoint.
- Полная медиация подтягивает Kotlin stdlib с metadata `2.3.0`; прежний compiler `2.1.20` не мог её читать. Plugin закрепляет compiler и `android.kotlinVersion` на `2.3.0`. Expo SDK 56 поддерживает эту ветку и выбирает KSP `2.3.7`. Проверка metadata не отключается, версии runtime-библиотек сетей не понижаются. React Native, Expo, AGP и Hermes сохранены.
- Для D8 со всеми сетями template-heap 2 GiB оказался недостаточен. Plugin поднимает минимальный Gradle heap до 6 GiB и metaspace до 1 GiB, сохраняя прочие JVM flags и более высокие существующие лимиты. На локальной машине сборка проверяется с `--max-workers=1`.

## Блоки и правила показа

| Размещение | Формат / ID | Условие и предложение | Ошибка |
|---|---|---|---|
| Игровой экран | Banner `R-M-20249615-1` | Адаптивный sticky-баннер в выделенной области; скрыт при действующем removeAds | Ошибка логируется; игра продолжается |
| Переход после результата кампании | Interstitial `R-M-20249615-3` | Только разрешённая естественная пауза по текущей frequency policy | Переход продолжается без рекламы |
| Подсказка / монеты | Rewarded `R-M-20249615-2` | Добровольное предложение; текущая награда в UI и ECONOMY сохранена | Неподтверждённая награда не выдаётся |
| Дополнительное колесо / удвоение | Rewarded `R-M-20249615-2` | Текущий добровольный оффер; removeAds не отменяет добровольный rewarded | Закрытие без earned не равно награде |

Interstitial policy не изменена: onboarding защищён через уровень 5; нужны 5 уникальных завершений и 300 секунд видимой игры; между полноэкранными показами минимум 180 секунд видимой игры и 3 новых завершения; максимум 1 показ в первой сессии, 3 в последующих и 6 за час. Существующие исключения защищённых переходов и suppression после rewarded сохранены. Платные права подписки и сохранения не меняются.

`onRewarded` остаётся доказательством earned в клиентском SDK. Для офферов с durable confirmation результат пишется до закрытия, повторный callback не удваивает выдачу; ошибки записи могут повторяться. Это локальная идемпотентность в пределах сохранённого доказательства, а не серверная проверка подлинности просмотра. Экономика не переделывалась в рамках этой интеграции.

`src/core/config/env.ts` содержит новые production defaults и привычные EXPO_PUBLIC overrides. `.env.local` обновлён только по трём публичным ID. Debug всегда использует демоблоки. Для отдельной release-QA сборки задаётся `EXPO_PUBLIC_YANDEX_TEST_ADS=1`; для публикуемого AAB он не должен быть включён. Metro встраивает ID в bundle: требуется новая Android-сборка.

## app-ads.txt

Актуальный источник с 24 октября 2026: присланный `app-ads (2).txt`. Сохранён побайтно как `web/storefront/app-ads.txt`, без исправления или добавления seller-строк. Он заменил опубликованный 20 октября `gostlix10.txt`.

- SHA256: `e0f9aadc88cc7825e21c621fd9bd4d488fd3d801ef91229597eb0db080c07a05`.
- Размер: 108616 байт.
- Публичный URL: https://slova.193.160.208.95.nip.io/app-ads.txt.
- Nginx отдаёт только этот точный путь из отдельного storefront root как `text/plain`.
- `scripts/publish-app-ads.py` копирует **текущий опубликованный** сайт, добавляет только файл, проверяет nginx и переключает release атомарно с rollback. Не публикует старую локальную главную и не меняет backend.
- Доказательство текущей публикации: `output/app-ads-update-2026-10-24/publication.json`; внешняя HTTPS-проверка с побайтным сравнением вложения, локального и публичного файла — `external-verification.json` в той же папке. Предыдущий файл сохранён в `app-ads-before.txt`; серверный rollback и семь остальных файлов storefront сохранены. Backend, billing catalog и health не изменились.
- Для обновлений `scripts/publish-app-ads.py` принимает явные `--expected-sha256` и новый путь `--report`; прошлый отчёт публикации не перезаписывается.

Необходимо, чтобы этот домен был указан как сайт приложения в источнике, по которому сети ищут app-ads.txt. Доступность файла подтверждает публикацию, но не доказывает, что кабинет уже обнаружил его и подтвердил seller-записи.

## Google APPLICATION_ID для RuStore

21 октября 2026 менеджер Ольга явно уточнила для подключаемых RuStore-приложений: AdMob не поддерживается, Google APPLICATION_ID не требуется. Для текущего RuStore-профиля отсутствие этого ID **не является незавершённой настройкой или блокером релиза**. Прежний вывод от 20 октября о необходимости ждать ID отменён этим уточнением.

Общая страница настройки Google в инструкции описывает Google-профиль, но не заменяет полученные от менеджера условия RuStore. Полная единая сборка сохраняется: сам факт наличия Google-адаптера в dependency graph не означает, что Яндекс включает этот источник для RuStore. Не добавлять фиктивный ID и не исключать сети из рекомендованной сборки из-за отсутствия ID.

Опциональный `YANDEX_ADS_GOOGLE_APP_ID` в plugin оставлен для отдельного согласованного профиля; сейчас пуст и не требуется. Исследование `output/easy-monetization-2026-10-20/research/google-application-id-findings.md` описывает поведение Google SDK при прямом обращении, а не требование к нашей RuStore-интеграции. Исторические отчёты сохранены; актуальный вывод — в `output/easy-monetization-2026-10-21/recheck.json`.

## Проверки и выпуск

### Исправление жизненного цикла — релиз 0.1.24 / 28

21 октября 2026 по запросу пользователя исправлены оба найденных недочёта:

- Native provider переиспользует один loader на формат. Каждый показ по-прежнему получает новый загруженный ad object; повторные загрузки не добавляют loaders в native storage. Ошибки создания допускают повторное создание, ошибки загрузки повторяются через существующий loader; параллельные запросы объединяются.
- `AdsProvider.subscribeRewardedReady` и `useRewardedReady` через `useSyncExternalStore` обновляют открытое окно подсказок при загрузке/расходовании рекламы. Подписка снимается при unmount. Для провайдеров без уведомлений сохранено чтение при обычном React render, без polling.

Production ID, единая медиация, награды, частоты показов и paid-права сохранены. Изменены `yandexAds.native.ts`, `types.ts`, `index.ts`, новый `useRewardedReady.ts`, подключение в `game.tsx`, lifecycle/UI regression tests и mock существующего game-теста. Версия `app.json` и generated Android повышена до `0.1.24`, versionCode `28`.

Обе ошибки сначала воспроизведены regression tests. Итог: 93 suites / 731 tests PASS, TypeScript и ESLint PASS; `bundleRelease`, `assembleRelease`, `lintVitalRelease` PASS. Первый общий прогон превысил таймаут в неизменённом тесте подписки на фоне сборки; файл отдельно и полный повторный прогон прошли без изменения таймаутов.

Подписанный AAB: `output/release/slova-0.1.24-vc28-rustore.aab`; SHA256 `16cc6f36c59364f81d0d2c0f2d9c2d12f55ed1d0952af196bfac9f4e72bbeb35`. Сертификат прежний: SHA256 `8888e53939d854a282a0ee40e9a78e21360b50d0dd077efc2d107da155bfadcd`. Проверены четыре ABI, оба способа чтения JAR-подписи, все payload entries, Hermes, три production ID, 16 адаптеров и точное совпадение четырёх изменённых исходников с compiled source map. Доказательства: `output/ads-lifecycle-fix-2026-10-21/aab-verification/` и `ad-artifact-verification.json`. Установка/показы на устройстве фиксируются отдельно в этой же папке; в магазин эта задача сборку не загружает.

На единственном зарегистрированном Slova AVD production APK установлен поверх vc27 через `install -r`, запущен; данные не очищались. Изолированный `com.intstrfloat.slova.easyqa` с только demo ID и отключённым backend показал rewarded дважды в одной сессии: баланс `160 → 185 → 235`, доступные rewarded-вращения `5 → 4 → 3`. После force-stop/cold restart сохранились `235 / 3`, повторного начисления нет. Клики по объявлениям не выполнялись. Долгосрочный native heap не профилировался; количество loaders и отложенное обновление настоящего NoCoinsModal проверены regression tests. Временный QA package удалён, основной и существующий subscription-preview сохранены. Production native sources восстановлены, generated QA bundle удалён; AVD остановлен без wipe, testing owner освобождён. Итоговый отчёт: `output/ads-lifecycle-fix-2026-10-21/verification.json`.

### Повторная проверка 2026-10-21

- В кабинете заново подтверждены активность Slova `20249615`, включённая Простая монетизация и три активных блока с правильными форматами. Для новых игр также подтверждено: Sudoku `ru.novera.sudoku` → `20255834`; BlockBlast `com.intstrfloat.blockblast` → `20255841`.
- Новое вложение `C:/Users/Dima2/Downloads/gostlix10 (1).txt` совпадает побайтно со старым вложением, локальным app-ads.txt и HTTPS-ответом сайта Slova: 124152 байта, SHA256 `8e96a38e044e5e22d94dabdc81ee344b676f37cf7366c4a61c8cf14bcff690a1`, HTTP200 / text/plain. Повторная публикация не нужна.
- Хеш подписанного vc27 AAB заново совпал с проверенным артефактом от 20 октября. Fresh Jest: 4 suites / 21 tests PASS (plugin, env, native rewarded, provider). Native build и AVD повторно не запускались: функциональный код и AAB в этой проверке не изменялись. Предыдущие runtime-доказательства относятся к 20 октября.
- Исправлен ошибочный текущий вывод о Google ID. Новый отчёт `output/easy-monetization-2026-10-21/recheck.json` заменяет применимость старого `PASS_WITH_EXTERNAL_GOOGLE_CONFIGURATION_GAP`, сохраняя исторические файлы.

Найдены два существовавших до смены конфигурации недочёта приложения (P2). Их исправление в этот аудит не входило; новый AAB не собирался:

1. `src/features/monetization/yandexAds.native.ts:28,48`: каждый refill создаёт loader заново, а RN-wrapper держит loader в native storage без удаления. Изолированная проверка текущего provider: 10 rewarded-циклов → 11 созданных rewarded loaders. Это накопление объектов; рост heap и падение не измерялись. Исправление: переиспользовать один loader на формат и проверить повторные загрузки/ошибки регрессионным тестом.
2. `src/app/game.tsx:1232`: готовность rewarded читается без подписки на её изменение. Если загрузка завершается после открытия NoCoinsModal, кнопка может не появиться до другого render/повторного открытия; при pendingHint игровые таймеры отключены. Подтверждено статически, свежего UI-воспроизведения на устройстве нет. Исправление: реактивное состояние готовности и UI-тест отложенной загрузки.

Отдельный непроверенный внешний пункт: распознавание app-ads.txt сетями и связь с developer website. Публичная доступность файла проверена; индексация из неё не следует. Загрузка в магазин и процент раскатки в этой проверке не изменялись. Доход/fill оцениваются после выпуска. Google ID к этим пунктам не относится.

Результаты сборки, подписи и runtime фиксируются отдельно в `output/easy-monetization-2026-10-20/`. Исторические отчёты не доказывают новую интеграцию и не перезаписываются. Production-инвентарь проверяется загрузкой без тестовых кликов; показ и earned проверяются на официальных demo ID в отдельном QA package на единственном зарегистрированном Slova AVD.

Присланное письмо рекомендует выпуск на часть пользователей и около двух недель обучения. Это рекомендация менеджера, не доказательство дохода или fill rate. Загрузка в RuStore, выбранный процент раскатки и принятие модерацией отдельно не выполнены автоматически.

### Итог проверки 2026-10-20

- Подписанный AAB: `output/release/slova-0.1.23-vc27-rustore.aab`, 156959583 байта, SHA256 `d380075bb73fdbd311c0bee58c3ff5459d644857421b97414e9640458bbcad30`.
- Сертификат SHA256: `8888e53939d854a282a0ee40e9a78e21360b50d0dd077efc2d107da155bfadcd`. Совпадает с `credentials/release.jks` и предыдущим релизом. Проверены подпись всех payload entries, JAR stream, package/version, четыре ABI, отсутствие debug-флага и embedded Hermes.
- `bundleRelease`, `assembleRelease`, `lintVitalRelease` — PASS. TypeScript и ESLint — PASS. Полный клиентский прогон: 91 suite / 716 tests; после окончательных изменений build-конфигурации дополнительно прошли 12 конфигурационных тестов.
- В финальном DEX присутствуют 16 адаптеров полной медиации, включая Google NextGen и LevelPlay; все три новых ID есть в production bundle, старые ID отсутствуют. `ad-artifact-verification.json` — PASS.
- На зарегистрированном `Slova_Test_API35` (Android 15 / API 35 / x86_64) релиз установлен через `install -r`. В основном пакете **все три новых production-блока загрузились**; показы и клики по боевой рекламе не выполнялись. `production-load-verification.json` — PASS.
- Отдельный QA package содержал только `demo-banner-yandex`, `demo-interstitial-yandex`, `demo-rewarded-yandex` и отключённый игровой backend. Все три формата загрузились и показались; зафиксированы impressions, корректное закрытие полноэкранных показов и `onRewarded` до `dismissed`. Клики по объявлениям не зафиксированы. `demo-display-verification.json` — PASS.
- В настоящем React Native UI просмотр за колесо дал 15 монет: баланс 160 → 175, число rewarded-вращений 5 → 4. После force-stop/restart сохранились 175 / 4 без повторной выдачи. `wheel-reward-verification.json` — PASS.
- В crash buffer нет падений Slova / QA. Созданные этой проверкой три тестовых пакета удалены; основной пакет и прежний subscription-preview сохранены. AVD остановлен штатно; его guest data не очищались. Native production sources восстановлены; generated QA JS bundle удалён, чтобы следующий production build обязательно пересобрал его.
- Общий машиночитаемый отчёт: `output/easy-monetization-2026-10-20/integration-verification.json`.

Подтверждены конфигурация кабинета, состав AAB, три формата SDK, клиентская выдача одной награды и production load. Это не проверка fill/revenue каждой отдельной сети или всех Android-устройств. Google не входит в требования текущего RuStore-профиля. Обнаружение app-ads.txt рекламными сетями по нужному сайту приложения отдельно не подтверждено: публичный файл доступен, но управляемые параметры приложения не показывают соответствующее поле.

### Изменённые исходники

- `plugins/withYandexEasyMonetization.js` и его тесты заменяют VK-only plugin и тесты; сохраняют полную SDK-зависимость, vendor-репозитории и совместимые настройки сборки.
- `src/core/config/env.ts`, его тесты, `.env.example` и локальные три public ID — production/demo-профили и правильное соответствие форматов.
- `app.json` — версия `0.1.23`, versionCode `27`, новый config plugin. Сгенерированный Android-проект синхронизирован локально, без clean prebuild.
- `web/storefront/app-ads.txt`, `backend/deploy/nginx-slova.conf`, `scripts/build-storefront.cjs`, `scripts/deploy-storefront.py`, `scripts/publish-app-ads.py` — файл, упаковка и изолированная публикация.
- `docs/specs/05-monetization.md` и этот runbook — актуальный контракт и доказательства. Новый release-ключ, новые IAP или изменения экономики не создавались.
