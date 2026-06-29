/** Миры и достопримечательности (спека 07). Картинки — игровой арт. */
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
        untilLevel: 90,
      },
    ],
  },
  {
    id: 'world2',
    title: 'Нью-Йорк',
    landmarks: [
      {
        id: 'liberty',
        title: 'Статуя Свободы',
        fact: 'Подарок Франции США, открытый в 1886 году. Символ Нью-Йоркской гавани и новых возможностей.',
        image: require('../../../assets/landmarks/liberty.jpg'),
        untilLevel: 110,
      },
      {
        id: 'empire',
        title: 'Эмпайр-стейт-билдинг',
        fact: 'Классический небоскреб Манхэттена в стиле ар-деко, один из самых узнаваемых силуэтов города.',
        image: require('../../../assets/landmarks/empire.jpg'),
        untilLevel: 130,
      },
      {
        id: 'centralpark',
        title: 'Центральный парк',
        fact: 'Большой городской парк в центре Манхэттена, открытый для жителей и гостей города с XIX века.',
        image: require('../../../assets/landmarks/centralpark.jpg'),
        untilLevel: 150,
      },
      {
        id: 'brooklynbridge',
        title: 'Бруклинский мост',
        fact: 'Один из старейших подвесных мостов США, соединивший Манхэттен и Бруклин.',
        image: require('../../../assets/landmarks/brooklynbridge.jpg'),
        untilLevel: 170,
      },
    ],
  },
  {
    id: 'world3',
    title: 'Москва',
    landmarks: [
      {
        id: 'kremlin',
        title: 'Кремль',
        fact: 'Историческая крепость в центре Москвы и один из главных архитектурных символов России.',
        image: require('../../../assets/landmarks/kremlin.jpg'),
        untilLevel: 190,
      },
      {
        id: 'redsquare',
        title: 'Красная площадь',
        fact: 'Главная площадь Москвы, связанная с ключевыми событиями российской истории.',
        image: require('../../../assets/landmarks/redsquare.jpg'),
        untilLevel: 210,
      },
      {
        id: 'bolshoi',
        title: 'Большой театр',
        fact: 'Один из ведущих театров оперы и балета, основанный в XVIII веке.',
        image: require('../../../assets/landmarks/bolshoi.jpg'),
        untilLevel: 230,
      },
      {
        id: 'vdnh',
        title: 'ВДНХ',
        fact: 'Крупный выставочный комплекс с павильонами, фонтанами и музейными пространствами.',
        image: require('../../../assets/landmarks/vdnh.jpg'),
        untilLevel: 250,
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

/**
 * Достопримечательность-«блок», к которой относится глобальный уровень: первая,
 * чей `untilLevel >= levelId`. Используется как фон игрового поля, чтобы сцена
 * менялась по мере прохождения блоков внутри мира (Эйфелева → Лувр → Нотр-Дам …).
 */
export function landmarkForLevel(world: string, levelId: number): Landmark | null {
  const lms = landmarksForWorld(world);
  return lms.find((l) => levelId <= l.untilLevel) ?? lms[lms.length - 1] ?? null;
}

export function allLandmarks(): (Landmark & { world: string })[] {
  return WORLDS.flatMap((w) => w.landmarks.map((l) => ({ world: w.id, ...l })));
}
