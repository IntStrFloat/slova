import { THIRD_ROUTE_STORIES } from './thirdRouteStories';

/** Миры кампании и их ключевые достопримечательности. */
export interface Landmark {
  id: string;
  title: string;
  fact: string;
  image: number;
  untilLevel: number;
}

export interface World {
  id: string;
  title: string;
  image: number;
  startsAt: number;
  endsAt: number;
  landmarks: Landmark[];
}

const FIRST_ROUTE_WORLDS: World[] = [
  {
    id: 'world1',
    title: 'Париж',
    image: require('../../../assets/worlds/illustrated-paris.jpg'),
    startsAt: 1,
    endsAt: 90,
    landmarks: [
      {
        id: 'paris-river-islands',
        title: 'Острова Сены',
        fact: 'На острове Сите начинался древний Париж. Мосты связывают его и соседний остров Сен-Луи с обоими берегами Сены.',
        image: require('../../../assets/landmarks/paris-river-islands.jpg'),
        untilLevel: 5,
      },
      {
        id: 'eiffel',
        title: 'Эйфелева башня',
        fact: 'Открыта к Всемирной выставке 1889 года. Сегодня это самый узнаваемый символ Парижа и одна из самых посещаемых башен мира.',
        image: require('../../../assets/landmarks/eiffel.jpg'),
        untilLevel: 10,
      },
      {
        id: 'louvre',
        title: 'Лувр',
        fact: 'Бывший королевский дворец превратился в крупнейший художественный музей мира. Здесь хранится «Мона Лиза» Леонардо да Винчи.',
        image: require('../../../assets/landmarks/louvre.jpg'),
        untilLevel: 20,
      },
      {
        id: 'notredame',
        title: 'Собор Нотр-Дам',
        fact: 'Готический собор на острове Сите строили почти два века. Его силуэт остаётся одним из главных образов исторического Парижа.',
        image: require('../../../assets/landmarks/notredame.jpg'),
        untilLevel: 30,
      },
      {
        id: 'paris-montmartre',
        title: 'Монмартр',
        fact: 'Холм Монмартр был домом для многих художников. С его улиц открывается вид на крыши Парижа.',
        image: require('../../../assets/landmarks/paris-montmartre.jpg'),
        untilLevel: 40,
      },
      {
        id: 'paris-luxembourg',
        title: 'Люксембургский сад',
        fact: 'Сад разбили по воле Марии Медичи в XVII веке. Сегодня здесь отдыхают у фонтана и пруда с парусными моделями.',
        image: require('../../../assets/landmarks/paris-luxembourg.jpg'),
        untilLevel: 50,
      },
      {
        id: 'paris-orsay',
        title: 'Музей Орсе',
        fact: 'Музей искусства XIX века разместился в здании бывшего вокзала на берегу Сены.',
        image: require('../../../assets/landmarks/paris-orsay.jpg'),
        untilLevel: 60,
      },
      {
        id: 'paris-versailles',
        title: 'Версаль',
        fact: 'Загородный дворец французских королей известен Зеркальной галереей и строгой геометрией садов.',
        image: require('../../../assets/landmarks/paris-versailles.jpg'),
        untilLevel: 70,
      },
      {
        id: 'paris-opera',
        title: 'Опера Гарнье',
        fact: 'Парижский оперный театр XIX века украшен мраморной лестницей и плафоном Марка Шагала.',
        image: require('../../../assets/landmarks/paris-opera.jpg'),
        untilLevel: 80,
      },
      {
        id: 'arc',
        title: 'Триумфальная арка',
        fact: 'Арку возвели в честь побед французской армии. С вершины открывается одна из самых известных панорам на Елисейские Поля.',
        image: require('../../../assets/landmarks/arc.jpg'),
        untilLevel: 90,
      },
    ],
  },
  {
    id: 'world2',
    title: 'Нью-Йорк',
    image: require('../../../assets/worlds/illustrated-newyork.jpg'),
    startsAt: 91,
    endsAt: 170,
    landmarks: [
      {
        id: 'newyork-battery',
        title: 'Бэттери-парк',
        fact: 'С набережной у южной оконечности Манхэттена видны Нью-Йоркская гавань и Статуя Свободы.',
        image: require('../../../assets/landmarks/newyork-battery.jpg'),
        untilLevel: 100,
      },
      {
        id: 'liberty',
        title: 'Статуя Свободы',
        fact: 'Подарок Франции Соединённым Штатам, открытый в 1886 году. Статуя встречала миллионы иммигрантов, прибывавших в Нью-Йоркскую гавань.',
        image: require('../../../assets/landmarks/liberty.jpg'),
        untilLevel: 110,
      },
      {
        id: 'newyork-flatiron',
        title: 'Флэтайрон-билдинг',
        fact: 'Узкий треугольный небоскрёб построили там, где Бродвей пересекает Пятую авеню.',
        image: require('../../../assets/landmarks/newyork-flatiron.jpg'),
        untilLevel: 120,
      },
      {
        id: 'empire',
        title: 'Эмпайр-стейт-билдинг',
        fact: 'Небоскрёб ар-деко долгое время оставался самым высоким зданием мира. Его шпиль стал частью классического силуэта Манхэттена.',
        image: require('../../../assets/landmarks/empire.jpg'),
        untilLevel: 130,
      },
      {
        id: 'newyork-highline',
        title: 'Хай-Лайн',
        fact: 'Городской парк проложен по бывшей надземной железной дороге над западной частью Манхэттена.',
        image: require('../../../assets/landmarks/newyork-highline.jpg'),
        untilLevel: 140,
      },
      {
        id: 'centralpark',
        title: 'Центральный парк',
        fact: 'Зелёное сердце Манхэттена занимает более трёх квадратных километров. Парк задумывался как место отдыха посреди плотной городской застройки.',
        image: require('../../../assets/landmarks/centralpark.jpg'),
        untilLevel: 150,
      },
      {
        id: 'newyork-grandcentral',
        title: 'Гранд-Сентрал',
        fact: 'Главный зал вокзала знаменит потолком с созвездиями и большими часами над информационной стойкой.',
        image: require('../../../assets/landmarks/newyork-grandcentral.jpg'),
        untilLevel: 160,
      },
      {
        id: 'brooklynbridge',
        title: 'Бруклинский мост',
        fact: 'Один из старейших подвесных мостов США соединил Манхэттен и Бруклин в 1883 году и быстро стал инженерной легендой.',
        image: require('../../../assets/landmarks/brooklynbridge.jpg'),
        untilLevel: 170,
      },
    ],
  },
  {
    id: 'world3',
    title: 'Москва',
    image: require('../../../assets/worlds/illustrated-moscow.jpg'),
    startsAt: 171,
    endsAt: 250,
    landmarks: [
      {
        id: 'moscow-zaryadye',
        title: 'Парк Зарядье',
        fact: 'Парк у Кремля объединяет природные зоны России и смотровую площадку над Москвой-рекой.',
        image: require('../../../assets/landmarks/moscow-zaryadye.jpg'),
        untilLevel: 180,
      },
      {
        id: 'kremlin',
        title: 'Кремль',
        fact: 'Историческая крепость в центре Москвы объединяет древние стены, соборы и официальную резиденцию главы государства.',
        image: require('../../../assets/landmarks/kremlin.jpg'),
        untilLevel: 190,
      },
      {
        id: 'moscow-arbat',
        title: 'Старый Арбат',
        fact: 'Пешеходная улица сохранила особняки разных эпох и давно стала местом прогулок и уличного искусства.',
        image: require('../../../assets/landmarks/moscow-arbat.jpg'),
        untilLevel: 200,
      },
      {
        id: 'redsquare',
        title: 'Красная площадь',
        fact: 'Главная площадь столицы веками была местом ярмарок, парадов и важных государственных событий.',
        image: require('../../../assets/landmarks/redsquare.jpg'),
        untilLevel: 210,
      },
      {
        id: 'moscow-kolomenskoye',
        title: 'Коломенское',
        fact: 'В бывшей царской усадьбе сохранилась церковь Вознесения XVI века и старинный ландшафт над Москвой-рекой.',
        image: require('../../../assets/landmarks/moscow-kolomenskoye.jpg'),
        untilLevel: 220,
      },
      {
        id: 'bolshoi',
        title: 'Большой театр',
        fact: 'Одна из самых известных оперных и балетных сцен мира. Здание с колоннами давно стало культурным символом Москвы.',
        image: require('../../../assets/landmarks/bolshoi.jpg'),
        untilLevel: 230,
      },
      {
        id: 'moscow-gorkypark',
        title: 'Парк Горького',
        fact: 'Прогулочные аллеи, пруды и набережная делают парк одним из любимых мест отдыха в центре Москвы.',
        image: require('../../../assets/landmarks/moscow-gorkypark.jpg'),
        untilLevel: 240,
      },
      {
        id: 'vdnh',
        title: 'ВДНХ',
        fact: 'Крупный выставочный парк с павильонами, фонтанами и музеями показывает архитектуру нескольких эпох и масштабы советского проекта.',
        image: require('../../../assets/landmarks/vdnh.jpg'),
        untilLevel: 250,
      },
    ],
  },
  {
    id: 'world4',
    title: 'Лондон',
    image: require('../../../assets/worlds/illustrated-london.jpg'),
    startsAt: 251,
    endsAt: 310,
    landmarks: [
      {
        id: 'london-stpauls',
        title: 'Собор Святого Павла',
        fact: 'Купол собора Кристофера Рена возвышается над лондонским Сити с начала XVIII века.',
        image: require('../../../assets/landmarks/london-stpauls.jpg'),
        untilLevel: 258,
      },
      {
        id: 'london-bigben',
        title: 'Биг-Бен',
        fact: 'Так обычно называют часовую башню Вестминстерского дворца и её колокол. Эти часы давно стали звуковым символом Лондона.',
        image: require('../../../assets/landmarks/london-bigben.jpg'),
        untilLevel: 265,
      },
      {
        id: 'london-camden',
        title: 'Камден',
        fact: 'Камденский рынок вырос вдоль канала Риджентс и известен лавками, музыкой и яркими фасадами.',
        image: require('../../../assets/landmarks/london-camden.jpg'),
        untilLevel: 273,
      },
      {
        id: 'london-towerbridge',
        title: 'Тауэрский мост',
        fact: 'Разводной мост через Темзу открыли в 1894 году. Он сочетает инженерную функциональность и неоготический облик.',
        image: require('../../../assets/landmarks/london-towerbridge.jpg'),
        untilLevel: 280,
      },
      {
        id: 'london-kew',
        title: 'Сады Кью',
        fact: 'Королевские ботанические сады Кью сохраняют растения со всего мира и исторические оранжереи.',
        image: require('../../../assets/landmarks/london-kew.jpg'),
        untilLevel: 288,
      },
      {
        id: 'london-britishmuseum',
        title: 'Британский музей',
        fact: 'Один из крупнейших музеев истории и культуры хранит коллекции от древнего Египта до античной Греции.',
        image: require('../../../assets/landmarks/london-britishmuseum.jpg'),
        untilLevel: 295,
      },
      {
        id: 'london-greenwich',
        title: 'Гринвич',
        fact: 'Через Королевскую обсерваторию в Гринвиче проходит нулевой меридиан.',
        image: require('../../../assets/landmarks/london-greenwich.jpg'),
        untilLevel: 303,
      },
      {
        id: 'london-eye',
        title: 'Лондонский глаз',
        fact: 'Колесо обозрения на южном берегу Темзы поднимает гостей почти на 135 метров и открывает круговую панораму города.',
        image: require('../../../assets/landmarks/london-eye.jpg'),
        untilLevel: 310,
      },
    ],
  },
  {
    id: 'world5',
    title: 'Рим',
    image: require('../../../assets/worlds/illustrated-rome.jpg'),
    startsAt: 311,
    endsAt: 370,
    landmarks: [
      {
        id: 'rome-forum',
        title: 'Римский форум',
        fact: 'На Форуме проходила общественная жизнь Древнего Рима. Между руинами сохранились колонны храмов и триумфальные арки.',
        image: require('../../../assets/landmarks/rome-forum.jpg'),
        untilLevel: 318,
      },
      {
        id: 'rome-colosseum',
        title: 'Колизей',
        fact: 'Главный амфитеатр Древнего Рима вмещал десятки тысяч зрителей. Его арки остаются одним из самых узнаваемых античных силуэтов.',
        image: require('../../../assets/landmarks/rome-colosseum.jpg'),
        untilLevel: 325,
      },
      {
        id: 'rome-trastevere',
        title: 'Трастевере',
        fact: 'Узкие улицы района на западном берегу Тибра ведут к старым площадям и церквям.',
        image: require('../../../assets/landmarks/rome-trastevere.jpg'),
        untilLevel: 333,
      },
      {
        id: 'rome-trevi',
        title: 'Фонтан Треви',
        fact: 'Самый известный фонтан Рима завершает барочную композицию на фасаде дворца Полли. По традиции сюда бросают монету на возвращение в город.',
        image: require('../../../assets/landmarks/rome-trevi.jpg'),
        untilLevel: 340,
      },
      {
        id: 'rome-spanishsteps',
        title: 'Испанская лестница',
        fact: 'Ступени XVIII века соединяют площадь Испании с церковью Тринита-деи-Монти.',
        image: require('../../../assets/landmarks/rome-spanishsteps.jpg'),
        untilLevel: 348,
      },
      {
        id: 'rome-pantheon',
        title: 'Пантеон',
        fact: 'Античный храм с огромным бетонным куполом пережил почти две тысячи лет и до сих пор поражает точностью инженерных расчётов.',
        image: require('../../../assets/landmarks/rome-pantheon.jpg'),
        untilLevel: 355,
      },
      {
        id: 'rome-appianway',
        title: 'Аппиева дорога',
        fact: 'Одна из древнейших римских дорог тянулась от столицы к югу Италии; часть каменной мостовой сохранилась.',
        image: require('../../../assets/landmarks/rome-appianway.jpg'),
        untilLevel: 363,
      },
      {
        id: 'rome-stpeters',
        title: 'Собор Святого Петра',
        fact: 'Один из крупнейших храмов мира построен над местом, которое связывают с апостолом Петром. Купол Микеланджело доминирует над панорамой Ватикана.',
        image: require('../../../assets/landmarks/rome-stpeters.jpg'),
        untilLevel: 370,
      },
    ],
  },
  {
    id: 'world6',
    title: 'Токио',
    image: require('../../../assets/worlds/illustrated-tokyo.jpg'),
    startsAt: 371,
    endsAt: 430,
    landmarks: [
      {
        id: 'tokyo-ueno',
        title: 'Парк Уэно',
        fact: 'В парке Уэно расположены музеи, пруды и аллеи сакуры, которые особенно любят весной.',
        image: require('../../../assets/landmarks/tokyo-ueno.jpg'),
        untilLevel: 378,
      },
      {
        id: 'tokyo-shibuya',
        title: 'Сибуя',
        fact: 'Перекрёсток у станции Сибуя известен плотным потоком пешеходов и неоновыми экранами, задающими ритм современного Токио.',
        image: require('../../../assets/landmarks/tokyo-shibuya.jpg'),
        untilLevel: 385,
      },
      {
        id: 'tokyo-shinjuku',
        title: 'Синдзюку',
        fact: 'В районе Синдзюку соседствуют деловые небоскрёбы, оживлённые улицы и большой городской парк.',
        image: require('../../../assets/landmarks/tokyo-shinjuku.jpg'),
        untilLevel: 393,
      },
      {
        id: 'tokyo-sensoji',
        title: 'Сэнсо-дзи',
        fact: 'Старейший буддийский храм Токио находится в районе Асакуса. Красные ворота Каминаримон и торговая улица к храму знакомы каждому гостю города.',
        image: require('../../../assets/landmarks/tokyo-sensoji.jpg'),
        untilLevel: 400,
      },
      {
        id: 'tokyo-ginza',
        title: 'Гиндза',
        fact: 'Улицы Гиндзы соединяют универмаги, театры и архитектуру современного Токио.',
        image: require('../../../assets/landmarks/tokyo-ginza.jpg'),
        untilLevel: 408,
      },
      {
        id: 'tokyo-tower',
        title: 'Токийская башня',
        fact: 'Красно-белая телебашня вдохновлена Эйфелевой башней, но выше её. Она стала символом послевоенного роста японской столицы.',
        image: require('../../../assets/landmarks/tokyo-tower.jpg'),
        untilLevel: 415,
      },
      {
        id: 'tokyo-odaiba',
        title: 'Одайба',
        fact: 'На искусственном острове Одайба прогулочные набережные выходят к Токийскому заливу и Радужному мосту.',
        image: require('../../../assets/landmarks/tokyo-odaiba.jpg'),
        untilLevel: 423,
      },
      {
        id: 'tokyo-meiji',
        title: 'Святилище Мэйдзи',
        fact: 'Лесной храмовый комплекс рядом с Харадзюку посвящён императору Мэйдзи и создаёт редкий остров тишины внутри мегаполиса.',
        image: require('../../../assets/landmarks/tokyo-meiji.jpg'),
        untilLevel: 430,
      },
    ],
  },
  {
    id: 'world7',
    title: 'Санкт-Петербург',
    image: require('../../../assets/worlds/illustrated-saintpetersburg.jpg'),
    startsAt: 431,
    endsAt: 500,
    landmarks: [
      {
        id: 'spb-nevsky',
        title: 'Невский проспект',
        fact: 'Главная улица Петербурга тянется от Адмиралтейства к Александро-Невской лавре.',
        image: require('../../../assets/landmarks/spb-nevsky.jpg'),
        untilLevel: 439,
      },
      {
        id: 'spb-hermitage',
        title: 'Эрмитаж',
        fact: 'Один из крупнейших музеев мира вырос из частной коллекции Екатерины II. Его залы занимают Зимний дворец и соседние исторические здания.',
        image: require('../../../assets/landmarks/spb-hermitage.jpg'),
        untilLevel: 447,
      },
      {
        id: 'spb-kazan',
        title: 'Казанский собор',
        fact: 'Полукруглая колоннада Казанского собора выходит на Невский проспект.',
        image: require('../../../assets/landmarks/spb-kazan.jpg'),
        untilLevel: 456,
      },
      {
        id: 'spb-stisaac',
        title: 'Исаакиевский собор',
        fact: 'Монументальный собор с позолоченным куполом строили почти сорок лет. С колоннады открывается одна из лучших панорам центра города.',
        image: require('../../../assets/landmarks/spb-stisaac.jpg'),
        untilLevel: 464,
      },
      {
        id: 'spb-summergarden',
        title: 'Летний сад',
        fact: 'Старейший сад Петербурга заложили при Петре I. Его аллеи украшают скульптуры и фонтаны.',
        image: require('../../../assets/landmarks/spb-summergarden.jpg'),
        untilLevel: 473,
      },
      {
        id: 'spb-peterhof',
        title: 'Петергоф',
        fact: 'Дворцово-парковый ансамбль на берегу Финского залива знаменит каскадами фонтанов и парадной резиденцией Петра I.',
        image: require('../../../assets/landmarks/spb-peterhof.jpg'),
        untilLevel: 482,
      },
      {
        id: 'spb-newholland',
        title: 'Новая Голландия',
        fact: 'Треугольный остров с историческими складами сегодня стал общественным пространством с садом.',
        image: require('../../../assets/landmarks/spb-newholland.jpg'),
        untilLevel: 491,
      },
      {
        id: 'spb-palacebridge',
        title: 'Дворцовый мост',
        fact: 'Разводной мост через Неву соединяет центр города с Васильевским островом. Ночной развод пролетов считается одним из главных петербургских видов.',
        image: require('../../../assets/landmarks/spb-palacebridge.jpg'),
        untilLevel: 500,
      },
    ],
  },
];

/** Continuations keep released IDs and artwork while adding distinct collection rewards. */
export const WORLDS: World[] = [
  ...FIRST_ROUTE_WORLDS,
  ...FIRST_ROUTE_WORLDS.map((world, index) => ({
    ...world,
    id: `world${index + FIRST_ROUTE_WORLDS.length + 1}`,
    title: `${world.title} · Новый маршрут`,
    startsAt: world.startsAt + 500,
    endsAt: world.endsAt + 500,
    landmarks: world.landmarks.map((landmark) => ({
      ...landmark,
      id: `${landmark.id}-route2`,
      untilLevel: landmark.untilLevel + 500,
    })),
  })),
  ...FIRST_ROUTE_WORLDS.map((world, index) => ({
    ...world,
    id: `world${index + FIRST_ROUTE_WORLDS.length * 2 + 1}`,
    title: `${world.title} · Истории`,
    startsAt: world.startsAt + 1000,
    endsAt: world.endsAt + 1000,
    landmarks: world.landmarks.map((landmark) => ({
      ...landmark,
      id: `${landmark.id}-route3`,
      fact: THIRD_ROUTE_STORIES[landmark.id],
      untilLevel: landmark.untilLevel + 1000,
    })),
  })),
];

export function worldById(worldId: string): World | null {
  return WORLDS.find((world) => world.id === worldId) ?? null;
}

export function totalCampaignLevels(): number {
  return WORLDS[WORLDS.length - 1]?.endsAt ?? 0;
}

export function worldForCampaignLevel(levelId: number): string {
  const normalized = Number.isFinite(levelId) ? Math.max(1, Math.trunc(levelId)) : 1;
  return WORLDS.find((world) => normalized >= world.startsAt && normalized <= world.endsAt)?.id
    ?? WORLDS[WORLDS.length - 1]?.id
    ?? 'world1';
}

export function landmarksForWorld(worldId: string): Landmark[] {
  return worldById(worldId)?.landmarks ?? [];
}

export function landmarkUnlockedAt(worldId: string, levelId: number): Landmark | null {
  return landmarksForWorld(worldId).find((landmark) => landmark.untilLevel === levelId) ?? null;
}

export function landmarkForLevel(worldId: string, levelId: number): Landmark | null {
  const landmarks = landmarksForWorld(worldId);
  return landmarks.find((landmark) => levelId <= landmark.untilLevel) ?? landmarks[landmarks.length - 1] ?? null;
}

/** The scene earned by the latest completed milestone; future cards stay previews. */
export function latestLandmarkAt(worldId: string, completedLevel: number): Landmark | null {
  let latest: Landmark | null = null;
  for (const landmark of landmarksForWorld(worldId)) {
    if (landmark.untilLevel > completedLevel) break;
    latest = landmark;
  }
  return latest;
}

export function allLandmarks(): (Landmark & { world: string })[] {
  return WORLDS.flatMap((world) => world.landmarks.map((landmark) => ({ world: world.id, ...landmark })));
}
