# 05 — Монетизация (реклама + IAP)

Статус: переход на Robokassa · Обновлено: 2026-10-11

## Текущая реклама — 2026-10-21

Подключена Простая монетизация Яндекса: полная unified-сборка `mobileads-mediation:8.6.0.0`, приложение `20249615`. Banner `R-M-20249615-1`, Rewarded `R-M-20249615-2`, Interstitial `R-M-20249615-3`. Google APPLICATION_ID для текущего RuStore-профиля не требуется по уточнению менеджера 21 октября. Актуальные настройки, найденные недочёты и результаты проверки — в [runbook Простой монетизации](../runbooks/yandex-easy-monetization.md). Рекламные параметры в исходном плане ниже исторические; текущие частоты показов и экономика сохранены в коде.

С 22 октября 2026 interstitial защищает только первый игровой визит, затем использует условие **три новых уровня ИЛИ пять минут видимой игры**, сохраняя rewarded-отсрочку и защиту переходов. Полный контракт и миграция — в [правилах частоты](../runbooks/interstitial-frequency.md).

## Текущая подписка

Для самозанятого реализована интеграция **Robokassa: 99 ₽ за 30 дней с автопродлением**. Товар «Без рекламных пауз» отключает баннеры и interstitial; rewarded остаётся добровольным. Оплата, продление, отмена, восстановление по коду и возвраты проверяются backend; клиент сохраняет только оплаченный срок. Продукт не даёт Pro-бонусы и не включает покупки валюты. «Робочеки СМЗ» в кабинете одобрены ФНС и активны; активация нового магазина `slova` и рекуррентов ещё не подтверждена.

Боевые продажи выключены до подтверждения подключения и сквозной проверки. Настройка и проверки описаны в [runbook Robokassa](../runbooks/robokassa-subscription.md); [история ЮKassa](../runbooks/yookassa-subscription.md) сохранена. Старым клиентам новый checkout недоступен: требуется `robokassa-v2` и новая подписанная Android-сборка. Согласие включает регулярные списания, обработку данных и публичную оферту; история согласий сохраняется. Номенклатура `Receipt` передаётся при первой оплате и каждом продлении. Ниже сохранён исходный план расширенной IAP-монетизации июня 2026; его заготовки сейчас выключены.

## Исходный план IAP

Реклама — **Yandex Mobile Ads** (AdMob в РФ недоступен). Платежи — **RuStore Billing**. Всё за интерфейсами + флаги; Noop для web/тестов. Числа — в `core/config/monetization.ts`.

## Модель

Гибрид: реклама (основной доход, 70–80%) + IAP (паки валюты, no-ads, подписка Pro).

### Реклама — где и когда
| Формат | Размещение | Триггер | Кап |
|---|---|---|---|
| Banner | низ меню-экранов (Карта/Магазин/Лидерборд/Коллекция) | постоянно | — |
| Interstitial | оверлей LevelComplete | каждый N уровень, не на туториале | `minLevelsBeforeFirst`, `everyNLevels`, `minIntervalSec` |
| Rewarded | колесо (доп. спины), удвоить награду, бесплатная подсказка, добрать монеты | **только по клику игрока** | без лимита |
| App Open | старт сессии | 1/сессия, с холодным капом | `minIntervalSec` |

### IAP (RuStore Billing)
| Продукт | Тип | Назначение |
|---|---|---|
| `coins_small/…/coins_xl` | consumable | паки монет |
| `gems_*` | consumable | паки кристаллов |
| `remove_ads` | non-consumable | убрать banner+interstitial+appopen (rewarded остаётся как услуга) |
| `pro_weekly` | subscription | ×2 дейли-бонус, 2 подсказки/уровень, без рекламы |

## Архитектура (`features/monetization`)

```ts
interface AdsProvider {
  init(): Promise<void>;
  showInterstitial(p: 'level_complete'): Promise<'shown'|'skipped'|'unavailable'>;
  showRewarded(p: 'wheel'|'double'|'hint'|'continue'): Promise<'rewarded'|'dismissed'|'unavailable'>;
  isRewardedReady(p: string): boolean;
  showAppOpen(): Promise<'shown'|'skipped'|'unavailable'>;
  banner: { show(): void; hide(): void };
}
interface IapProvider {
  init(): Promise<void>;
  getProducts(ids: string[]): Promise<Product[]>;
  purchase(id: string): Promise<'purchased'|'cancelled'|'failed'>;
  restore(): Promise<string[]>;
  getActiveSubscriptions(): Promise<string[]>;
}
```

- `YandexAdsProvider` / `RuStoreIapProvider` — native; `NoopAdsProvider`/`NoopIapProvider` — web/test (rewarded→`unavailable`).
- Фабрика по флагам в `monetization/config.ts`.

```ts
export const MONETIZATION = {
  adsEnabled: true, bannerEnabled: true, appOpenEnabled: true,
  iapEnabled: false,                 // включить после регистрации продуктов в RuStore Console
  interstitial: { minLevelsBeforeFirst: 3, everyNLevels: 2, minIntervalSec: 60 },
  appOpen: { minIntervalSec: 240 },
  rewards: { wheelExtraSpin: true, doubleLevelReward: true, freeHint: true },
};
```

## Entitlements

`iap.entitlements` (MMKV): `{ removeAds: boolean; proUntil: number|null }`. Обновляется после purchase/restore и при старте через `getActiveSubscriptions`. UI читает через zustand-стор.

## Серверная валидация

- **Подписка `pro_weekly`** и крупные паки — валидация чека на бэкенде ([11](11-profile-cloudsave-backend.md), эндпойнт `/api/iap/validate`) во избежание фрода с премиум-фичами. Расходники мелкие — клиентское подтверждение SDK допустимо (риск приемлем).

## Реальные SDK

- **Реклама**: `yandex-mobile-ads@^8.1` — banner/interstitial/rewarded/appopen; minSdk 23+. Ad unit IDs с env-override `EXPO_PUBLIC_YANDEX_*_AD_UNIT_ID`. Подключение через autolinking в prebuild; Expo config-plugin при необходимости в `plugins/`.
- **IAP**: `react-native-rustore-billing-sdk` (GitFlic). Поток: `init({consoleApplicationId, deeplinkScheme:'slova'})` → `checkPurchasesAvailability` → `getProducts` → `purchaseProduct` → подтверждение. Продукты завести в RuStore Console.

## Анти-чеклист (из [16](16-analytics.md)/ЦА)

- Interstitial не на первых уровнях/туториале и никогда не прерывает геймплей в процессе слова.
- Rewarded только добровольно, всегда с явной выгодой.
- Нет принудительного App Open чаще капа; нет «обманных» крестиков.

## Статус v1

- ⬜ Интеграция Yandex Ads (preload/reload, частоты, баннер).
- ⬜ RuStore Billing (продукты, restore, подписка) — `iapEnabled=false` до регистрации продуктов.
- ✅ Интерфейсы + Noop + флаги + entitlements-стор (готовятся в M2).
