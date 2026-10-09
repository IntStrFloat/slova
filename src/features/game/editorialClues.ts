import type { Level } from '@/core/engine/types';

/** The reviewed clue set is pinned to exact local content revisions. */
const FIRST_ROUTE_FINGERPRINTS: Record<number, string> = {
  1: 'intro-v1:1:кот:кот,ток',
  2: 'intro-v1:2:сон:сон,нос',
  3: 'intro-v1:3:дело:дело,лед',
  4: 'intro-v1:4:рост:рост,рот,трос',
  5: 'intro-v1:5:клуб:клуб,лук,куб,бук',
  6: '2ec841a4e06a4fdfb4e321d2afc123a6f0836e8db36f4e193aa7ae9fb83c31c7',
  7: '279ea67d31d8bcf80938bdfe9303a67dce403d05fd63ad0b0ab9bb6361d9a179',
  8: '7a0d9b2bf8386c3c44437b2e716e284e593344fad1727dd8a032e5f16be87ba3',
  9: '833900e1cb88b2389ad20313159f94e2862736f6f27a375acb2246c5b03cdf6d',
  10: '07b2176b029a6d1e2b51be3155560578e05bd9f5b2703ce48beb9c2bfcee127d',
  11: '57bfa2d3d1360e98d21fba4043ac7831e6201ed85f2fb126eb13c18911def8b0',
  12: 'fdbc0bdc4af8258c2fb2cb91f8c426174d180e63ca5112636a92eb843756d92d',
  13: 'bb2b3a2acfb3b82b068c9802b4b98fa06135b51f3c26c9bed435d78b686467bc',
  14: '54a2c0825f415ea98c0fb91ab1053f74593411e0e354c5856c6fb72a26193dea',
  15: 'e70753bbfffdd9861c7ab7ee58262c6f43a125252f85458fd205e8d12865e7b2',
  16: 'bd6029a7b535bf0b5468cf6fc062f02fcb43e7c3df3cf5c9b64eb86bb84f25ab',
  17: '90c63a309f39ce01d11057728b500c746601049c61eb2cc48e6a6bd00a4204fe',
  18: 'c7a42dd6dc05cfff7062a1bbf71f85021f49fcd762dd3905d7707490ee26d584',
  19: '958a22a764a43b505c79ccaeb2475c15daa0963d244931505b3ef416efe36c78',
  20: '3847278fc8fb280a6572fc56a143c229d6314c1dd1daba8ed3bc8ce6b6e42c0e',
};

const CURRENT_FIRST_ROUTE_FINGERPRINTS: Record<number, string> = {
  1: 'intro-v2:1:кот:кот,ток',
  2: 'intro-v2:2:сон:сон,нос',
  3: 'intro-v2:3:дело:дело,лед',
  4: 'intro-v2:4:рост:рост,рот,трос',
  5: 'intro-v2:5:клуб:клуб,лук,куб',
  6: '2ec841a4e06a4fdfb4e321d2afc123a6f0836e8db36f4e193aa7ae9fb83c31c7',
  7: '0d62434c5a4ff9b5c90e015cbf8af52f65929a99bbb85c3689d634aca40355bc',
  8: '6b94bc3a554d4c6107a18a29c574f2d0d0c077cb40947f89bb9ae886078c8c9e',
  9: '37bb54cbacc547bb020c657fd0674bec6aa9589c73d73f9a9adc9715a7f99da7',
  10: 'dabf05a9525773717dded3b43d1ed8499323b9152b6530fe84ff6cf1bf617d2a',
};

const REVISED_LEVEL_9_FINGERPRINT = 'd9123f68d94dc0893ed49ea98caeaac40c9135e47ac08b87ae5afbbd93703753';

/** Concise meaning, without the headword or spelling pattern. */
const CLUES: Record<string, string> = {
  кот: 'Домашний усатый питомец, часто мурлычет.',
  ток: 'Движение электрического заряда по проводнику.',
  сон: 'Отдых ночью, когда человеку снятся сны.',
  нос: 'Часть лица, которой мы чувствуем запахи.',
  слон: 'Крупное животное с хоботом и бивнями.',
  парк: 'Зелёное место для прогулок и отдыха в городе.',
  карп: 'Пресноводная рыба, которую часто разводят в прудах.',
  рак: 'Обитатель водоёмов с клешнями и твёрдым панцирем.',
  дело: 'Работа или задача, которую нужно выполнить.',
  лед: 'Твёрдая замёрзшая вода.',
  рост: 'Увеличение высоты или размера.',
  рот: 'Часть лица, которой едят и говорят.',
  трос: 'Прочный толстый канат.',
  клуб: 'Место встреч людей с общим интересом.',
  лук: 'Овощ с резким вкусом, который добавляют в суп.',
  куб: 'Тело с шестью равными квадратными гранями.',
  бук: 'Дерево с гладкой серой корой.',
  утро: 'Начало дня после ночи.',
  тур: 'Один круг в соревновании.',
  глаз: 'Орган зрения.',
  зал: 'Большое помещение для встреч или занятий.',
  газ: 'Вещество, заполняющее весь доступный объём.',
  тело: 'Физическая оболочка человека или животного.',
  лето: 'Тёплое время года между весной и осенью.',
  лот: 'Предмет, выставленный на аукцион.',
  море: 'Большой солёный водоём.',
  ром: 'Крепкий напиток из сахарного тростника.',
  толк: 'Практическая польза или смысл.',
  вина: 'Чувство ответственности за совершённый проступок.',
  нива: 'Поле, засеянное зерновыми.',
  долг: 'То, что нужно вернуть или исполнить.',
  год: 'Период из двенадцати месяцев.',
  дог: 'Крупная порода собак с короткой шерстью.',
  сорт: 'Разновидность товара или растения.',
  окно: 'Проём в стене, через который попадает свет.',
  око: 'Старинное название органа зрения.',
  угол: 'Место, где сходятся две стороны.',
  гул: 'Ровный низкий шум большого скопления людей.',
  луг: 'Открытое место, покрытое травой.',
  мост: 'Сооружение для перехода через реку или дорогу.',
  сом: 'Крупная пресноводная рыба с усами.',
  трон: 'Парадное кресло правителя.',
  тон: 'Высота звука или оттенок цвета.',
  крот: 'Подземный зверёк с бархатистым мехом.',
  план: 'Заранее намеченный порядок действий.',
  пан: 'Вежливое обращение к мужчине в Польше.',
  гроб: 'Погребальный ящик.',
  горб: 'Выпуклость на спине.',
  бог: 'Высшее существо, которому поклоняются.',
  бор: 'Сосновый лес.',
};

/** No clue is promised for an unreviewed revision or a completed crossword. */
export function clueForUnsolved(
  level: Level,
  solvedWords: readonly string[],
): { clue: string; targetLength: number } | null {
  const id = level.globalId ?? level.id;
  if (level.world !== 'world1' || level.id !== id
    || !Number.isInteger(id) || typeof level.fingerprint !== 'string'
    || (FIRST_ROUTE_FINGERPRINTS[id] !== level.fingerprint
      && CURRENT_FIRST_ROUTE_FINGERPRINTS[id] !== level.fingerprint
      && !(id === 9 && level.fingerprint === REVISED_LEVEL_9_FINGERPRINT))) {
    return null;
  }

  const solved = new Set(solvedWords);
  for (const answer of level.answers) {
    if (solved.has(answer.word)) continue;
    const clue = CLUES[answer.word];
    if (!clue) return null;
    return { clue, targetLength: [...answer.word].length };
  }
  return null;
}
