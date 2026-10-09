/** Product-day dates use a fixed UTC+3 calendar. Durations are whole product days. */
export const RETENTION = {
  schemaVersion: 1,
  utcOffsetMinutes: 180,
  /** R1/R2 can be disabled independently after QA without deleting ownership. */
  featureFlags: { daily: true, week: true, quests: true, event: true },
  unlockAfterCampaignWins: {
    // Retention §5 suggests 2/3, but the detailed five-level onboarding
    // contract promises the first postcard and daily entry after level 5.
    journey: 5,
    daily: 5,
    week: 5,
    quests: 8,
    event: 15,
  },
  journey: {
    // Onboarding promises the first actual postcard at level five.
    firstAlbumThresholds: [5, 9, 14, 19, 24, 29],
    laterAlbumThresholds: [5, 10, 15, 20, 25, 30],
  },
  daily: { volumeSize: 22, postcardThresholds: [3, 8, 15, 22] },
  week: { durationDays: 7, activeDaysForPostcard: 5, coinsAtTwoDays: 10, coinsAtFourDays: 50 },
  quests: {
    completionTarget: 3,
    wordTarget: 10,
    bonusTarget: 2,
    fallbackWordTarget: 5,
    eachCoins: 5,
    allCoins: 10,
  },
  event: {
    id: 'suitcase',
    firstStartDay: '2026-09-26',
    cycleDays: 14,
    durationDays: 7,
    campaignPoints: 1,
    todayDailyPoints: 2,
    tiers: [3, 8, 15, 25],
    firstTierCoins: 10,
  },
} as const;

export type CollectibleKind = 'journey' | 'daily' | 'weekly' | 'event' | 'cover';
export interface CollectibleDefinition {
  id: string;
  kind: CollectibleKind;
  title: string;
  /** Existing landmark id; the UI resolves the image through WORLDS. */
  artId: string;
}

const journeyArt = [
  ['eiffel', 'Парижское утро'], ['louvre', 'День в Лувре'],
  ['notredame', 'Сердце Парижа'], ['arc', 'Триумфальная арка'],
  ['liberty', 'Огни Нью-Йорка'], ['empire', 'Небо Манхэттена'],
] as const;
const laterJourneyArt = [
  ['centralpark', 'Центральный парк'], ['brooklynbridge', 'Бруклинский мост'],
  ['kremlin', 'Московский Кремль'], ['redsquare', 'Красная площадь'],
  ['bolshoi', 'Большой театр'], ['vdnh', 'Выставка достижений'],
  ['london-bigben', 'Биг-Бен'], ['london-towerbridge', 'Тауэрский мост'],
  ['london-britishmuseum', 'Британский музей'], ['london-eye', 'Лондонский глаз'],
  ['rome-colosseum', 'Колизей'], ['rome-trevi', 'Фонтан Треви'],
  ['rome-pantheon', 'Пантеон'], ['rome-stpeters', 'Собор Святого Петра'],
  ['tokyo-shibuya', 'Сибуя'], ['tokyo-sensoji', 'Сэнсо-дзи'],
  ['tokyo-tower', 'Токийская башня'], ['tokyo-meiji', 'Святилище Мэйдзи'],
  ['spb-hermitage', 'Эрмитаж'], ['spb-peterhof', 'Петергоф'],
  ['spb-stisaac', 'Исаакиевский собор'], ['spb-palacebridge', 'Дворцовый мост'],
] as const;
const dailyArt = [
  ['centralpark', 'Прогулка по парку'], ['brooklynbridge', 'Бруклинский мост'],
  ['kremlin', 'Московский Кремль'], ['redsquare', 'Красная площадь'],
  ['bolshoi', 'Вечер в театре'], ['vdnh', 'Аллеи ВДНХ'],
  ['london-bigben', 'Лондонские часы'], ['london-eye', 'Вид на Темзу'],
] as const;
const weeklyArt = [
  ['rome-colosseum', 'Римские каникулы'], ['rome-trevi', 'У фонтана Треви'],
  ['rome-pantheon', 'Купол Пантеона'], ['rome-stpeters', 'Римская панорама'],
  ['tokyo-shibuya', 'Огни Сибуи'], ['tokyo-sensoji', 'У ворот Сэнсо-дзи'],
  ['tokyo-tower', 'Токийская башня'], ['tokyo-meiji', 'Тихий сад Мэйдзи'],
] as const;
const eventArt = [
  ['spb-hermitage', 'Чемодан путешественника'],
  ['spb-palacebridge', 'Белые ночи'],
  ['spb-peterhof', 'Путешествие в Петергоф'],
  ['spb-stisaac', 'Вид на Исаакий'],
] as const;

export const COLLECTIBLE_CATALOG: readonly CollectibleDefinition[] = [
  ...journeyArt.map(([artId, title], index) => ({ id: `journey-1-${index + 1}`, kind: 'journey' as const, title, artId })),
  { id: 'journey-cover-1', kind: 'cover', title: 'Альбом путешествия', artId: 'eiffel' },
  ...laterJourneyArt.flatMap(([artId, title], index) => {
    const album = Math.floor(index / 6) + 2;
    const card = index % 6 + 1;
    const items: CollectibleDefinition[] = [{ id: `journey-${album}-${card}`, kind: 'journey', title, artId }];
    if (card === 6) items.push({ id: `journey-cover-${album}`, kind: 'cover', title: `Альбом путешествия ${album}`, artId });
    return items;
  }),
  ...dailyArt.map(([artId, title], index) => ({ id: `daily-1-${index + 1}`, kind: 'daily' as const, title, artId })),
  ...weeklyArt.map(([artId, title], index) => ({ id: `weekly-${index + 1}`, kind: 'weekly' as const, title, artId })),
  ...eventArt.flatMap(([artId, title], index) => ([
    { id: `event-${index + 1}`, kind: 'event' as const, title, artId },
    { id: `event-cover-${index + 1}`, kind: 'cover' as const, title: `Обложка «${title}»`, artId },
  ])),
];
