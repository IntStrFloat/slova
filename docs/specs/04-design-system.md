# 04 — Дизайн-система

Статус: утверждено · Обновлено: 2026-06-26

Единый источник стиля: `ui/theme.ts`. Текст — только через `AppText` (пресеты). Сырые `<Text>`/`fontWeight`/хардкод-цвета запрещены.

## Токены (`ui/theme.ts`)

```ts
export const theme = {
  color: {
    bg, surface, primary, accent, success, danger, muted,
    gridEmpty, gridFilled, gridHint, diskTile, diskTileActive, linkLine,
    text, textMuted, onPrimary,
  },
  radius: { sm: 8, md: 14, lg: 22, pill: 999 },
  space: [0,4,8,12,16,24,32,48],
  shadow: { card, overlay },
  worldThemes: WorldTheme[],   // палитра/фон/декор на мир (см. 07)
};
```

Темы миров (`worldThemes`) — рескин фона карты/игрового поля под локацию; выбираются прогрессией [07]. Без P2W: только косметика.

## Типографика (`AppText`)

Шрифты — `@expo-google-fonts` (заголовки — Unbounded, тело — Fredoka, как в blockblast). Пресеты:

| Пресет | Назначение |
|---|---|
| `display` | заголовки экранов/победа |
| `title` | секции |
| `body` | основной текст |
| `label` | подписи кнопок |
| `coin` | числа валют (таблично-моноширинно) |
| `tileLetter` | буквы на диске/в сетке |

## Игровые компоненты

- **LetterDisk** (SVG): круговая раскладка плиток-букв, линия связи при свайпе, подсветка активной плитки.
- **CrosswordGrid** (SVG/View): клетки, появление букв, подсветка подсказки.
- **BonusWordTray**: счётчик/индикатор бонусных слов и копилки.
- **CoinHud**: монеты/кристаллы с анимацией прилёта.
- **Primitives**: Button, IconButton, Overlay/Modal, ProgressBar, Badge, TabBar (внутри экранов), Toast.

## Анимации (Reanimated, UI-поток)

| Событие | Анимация | Хаптика | Звук |
|---|---|---|---|
| свайп по букве | плитка scale-up + сегмент линии | light | tick |
| grid-слово | буквы «влетают» в клетки, вспышка | success | word-ok |
| bonus-слово | значок «+N», прилёт монет | light | coin |
| invalid | тряска линии/диска | warning | error |
| level complete | заполнение сетки + конфетти | success | win |
| открытие достопримечательности | reveal-карточка | medium | reveal |
| колесо/сундук | вращение/раскрытие | medium | spin/chest |

Правила перфоманса — [13](13-performance.md): в drag-пути только worklets/shared values, без setState/runOnJS до завершения слова.

## Ассеты

- Звуки генерируются `scripts/gen-sounds.js`; иконки — `ui/icons`.
- Картинки достопримечательностей — оптимизированные (expo-image), докачка по мирам, чтобы не раздувать стартовый бандл [13].
