# 05 — Монетизация (реклама + IAP)

Статус: утверждено · Обновлено: 2026-06-26

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
