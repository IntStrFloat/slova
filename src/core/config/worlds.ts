/** Миры и достопримечательности (спека 07). Картинки — реальные фото. */
export interface Landmark {
  id: string;
  title: string;
  fact: string;
  image: number; // require(...) ассет
  untilLevel: number; // открывается по завершении этого уровня
}
export interface World {
  id: string;
  title: string;
  landmarks: Landmark[];
}

export const WORLDS: World[] = [
  {
    id: 'world1',
    title: 'Париж',
    landmarks: [
      {
        id: 'eiffel',
        title: 'Эйфелева башня',
        fact: 'Построена в 1889 году к Всемирной выставке. Высота — 330 м, около 7 млн посетителей в год.',
        image: require('../../../assets/landmarks/eiffel.jpg'),
        untilLevel: 10,
      },
      {
        id: 'louvre',
        title: 'Лувр',
        fact: 'Крупнейший художественный музей мира. Здесь хранится «Мона Лиза» Леонардо да Винчи.',
        image: require('../../../assets/landmarks/louvre.jpg'),
        untilLevel: 20,
      },
      {
        id: 'notredame',
        title: 'Собор Нотр-Дам',
        fact: 'Готический собор XII–XIV веков на острове Сите. Шедевр французской архитектуры.',
        image: require('../../../assets/landmarks/notredame.jpg'),
        untilLevel: 30,
      },
      {
        id: 'arc',
        title: 'Триумфальная арка',
        fact: 'Возведена в честь побед Наполеона. Высота — 50 м, в основании — могила Неизвестного солдата.',
        image: require('../../../assets/landmarks/arc.jpg'),
        untilLevel: 40,
      },
    ],
  },
];

export function landmarksForWorld(world: string): Landmark[] {
  return WORLDS.find((w) => w.id === world)?.landmarks ?? [];
}

export function landmarkUnlockedAt(world: string, levelId: number): Landmark | null {
  return landmarksForWorld(world).find((l) => l.untilLevel === levelId) ?? null;
}

export function allLandmarks(): (Landmark & { world: string })[] {
  return WORLDS.flatMap((w) => w.landmarks.map((l) => ({ world: w.id, ...l })));
}
