// Порт MockEngine (api/internal/engine/mock.go) для демо-версии без сервера.
// Те же каталог функций, формулы оценки, поправки для ОКН и диапазоны по точности.
// Детерминированный разброс считается другим хэшем, поэтому числа немного
// отличаются от серверных, но правила совпадают.
import type { AccuracyLevel, BuildingCard, EngineOutput, Scenario, TEPValues } from './types';

export const ENGINE_VERSION = 'mock-1.0-browser';

type In = { b: BuildingCard; level: AccuracyLevel };

type Profile = {
  code: string;
  title: string;
  scale: 'local' | 'city';
  description: string;
  score: (i: In) => number;
  capexPerM2: number;
  rent: number;
  occupancy: number;
  noi: number;
  termMonths: number;
  rentable: number;
  areaChange: number;
  addsFloor?: boolean;
  parkingPer1k: number;
  zoning: [string, number][];
  risks: string[];
};

/** Стабильное число в [0, 1) для пары (id здания, ключ). */
export function unit(id: number, key: string) {
  let h1 = 0xdeadbeef ^ id;
  let h2 = 0x41c6ce57 ^ id;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0) * 2 ** 21 + (h1 >>> 11)) / 2 ** 53;
}

const b2f = (v: boolean) => (v ? 1 : 0);
const is = (i: In, ...fns: string[]) => fns.includes(i.b.original_function);
const industrialZone = (i: In) => i.b.pzz_zone.startsWith('ТП');
const between = (v: number, lo: number, hi: number) => (v >= lo && v <= hi ? 1 : 0);
const c = (i: In) => i.b.context;

const CATALOGUE: Profile[] = [
  {
    code: 'creative_cluster', title: 'Креативный кластер с коворкингом', scale: 'city',
    description: 'Этажи делятся на мастерские, студии и офисы от 30 до 400 м², первый этаж открывается на улицу кафе и шоурумами. Высокие потолки и крупный шаг колонн сохраняются как часть образа.',
    score: (i) => 0.35 * c(i).transit_index + 0.3 * c(i).commercial_density + 0.15 * c(i).business_activity + 15 * b2f(is(i, 'industrial', 'research', 'warehouse')) + 10 * between(i.b.area_total_m2, 3000, 30000),
    capexPerM2: 98000, rent: 1900, occupancy: 0.86, noi: 0.66, termMonths: 30, rentable: 0.74, areaChange: 0.06, parkingPer1k: 4,
    zoning: [['Мастерские и студии', 0.3], ['Офисы и коворкинг', 0.28], ['Шоурумы и магазины', 0.14], ['Кафе и общепит', 0.1], ['Общие зоны', 0.18]],
    risks: [
      'Заполнение креативными арендаторами занимает 2–3 года; первые годы выручка ниже расчётной.',
      'Ставка выше районной снизит заполнение: креативные арендаторы чувствительны к цене.',
      'Без собственной программы событий кластер конкурирует только ценой.',
    ],
  },
  {
    code: 'light_industrial', title: 'Light industrial + шоурумы', scale: 'local',
    description: 'Здание сохраняет производственную функцию: чистое мелкое производство и мастерские на этажах, шоурумы и пункты выдачи на первом. Перепланировка минимальная, основная статья — инженерия и грузовые лифты.',
    score: (i) => 40 * b2f(is(i, 'industrial', 'warehouse')) + 0.25 * (100 - c(i).transit_index) + 15 * b2f(industrialZone(i)) + 0.1 * c(i).commercial_density + 10 * between(i.b.area_total_m2, 1500, 40000),
    capexPerM2: 64000, rent: 1250, occupancy: 0.9, noi: 0.72, termMonths: 16, rentable: 0.82, areaChange: 0, parkingPer1k: 3,
    zoning: [['Производство и мастерские', 0.5], ['Шоурумы', 0.18], ['Склад', 0.17], ['Офисы', 0.1], ['Общие зоны', 0.05]],
    risks: [
      'Ставка light industrial растёт медленнее офисной: рост выше рынка не закладывается.',
      'Грузовой транспорт ограничен соседней застройкой и графиком заезда.',
      'Функция почти не повышает стоимость объекта при продаже.',
    ],
  },
  {
    code: 'warehouse_office', title: 'Склад с офисами и пунктом выдачи', scale: 'local',
    description: 'Нижний этаж — склад малых форматов от 50 м² и пункты выдачи интернет-заказов, верхние — офисы арендаторов склада. Подходит зданиям с подъездом для грузового транспорта.',
    score: (i) => 45 * b2f(is(i, 'warehouse')) + 20 * b2f(is(i, 'industrial')) + 0.35 * (100 - c(i).transit_index) + 12 * b2f(industrialZone(i)) - 0.15 * c(i).commercial_density + 8 * b2f(i.b.floors <= 2),
    capexPerM2: 60000, rent: 950, occupancy: 0.93, noi: 0.75, termMonths: 12, rentable: 0.86, areaChange: 0, parkingPer1k: 2,
    zoning: [['Склад малых форматов', 0.55], ['Пункты выдачи', 0.12], ['Офисы', 0.18], ['Погрузочные зоны', 0.1], ['Общие зоны', 0.05]],
    risks: [
      'Рынок складов малых форматов насыщается: ставки ниже 900 ₽/м² возможны уже через 2 года.',
      'Нужна площадка для разворота грузовиков — её размер зависит от границ участка.',
      'Высокая нагрузка на перекрытия ограничивает склад верхних этажей.',
    ],
  },
  {
    code: 'business_center', title: 'Деловой центр класса B', scale: 'city',
    description: 'Офисы от 50 до 1 500 м² с общими переговорными и конференц-залом, кафе на первом этаже. Требует полной замены инженерных систем под офисную нагрузку.',
    score: (i) => 0.45 * c(i).business_activity + 0.4 * c(i).transit_index + 25 * b2f(is(i, 'administrative', 'research')) + 10 * b2f(i.b.floors >= 4) - 10 * b2f(industrialZone(i)),
    capexPerM2: 120000, rent: 2100, occupancy: 0.82, noi: 0.62, termMonths: 36, rentable: 0.72, areaChange: 0.03, parkingPer1k: 8,
    zoning: [['Офисы', 0.62], ['Конференц-зал и переговорные', 0.1], ['Кафе и общепит', 0.06], ['Общие и технические зоны', 0.22]],
    risks: [
      'Офисный спрос вне центра чувствителен к ставке: заполнение 82% требует цены на уровне района.',
      'Замена инженерных систем — самая неопределённая статья бюджета.',
      'Новые бизнес-центры рядом удлиняют заполнение на 6–12 месяцев.',
    ],
  },
  {
    code: 'aparthotel', title: 'Апарт-отель с сервисными офисами', scale: 'city',
    description: 'Верхние этажи и надстройка — апартаменты от 22 до 45 м² для командированных и туристов, нижние — сервисные офисы и ресторан. Требуется изменение вида разрешённого использования.',
    score: (i) =>
      i.b.is_okn || industrialZone(i)
        ? -100 // надстройка и смена функции в ОКН и промзоне не рассматриваются
        : 0.5 * c(i).transit_index + 0.3 * c(i).commercial_density + 0.1 * c(i).social_500m + 10 * between(i.b.area_total_m2, 3000, 20000),
    capexPerM2: 150000, rent: 2600, occupancy: 0.76, noi: 0.55, termMonths: 36, rentable: 0.66, areaChange: 0.12, addsFloor: true, parkingPer1k: 6,
    zoning: [['Апартаменты', 0.58], ['Сервисные офисы', 0.16], ['Ресторан и лобби', 0.1], ['Общие и технические зоны', 0.16]],
    risks: [
      'Смена ВРИ и надстройка удлиняют подготовку на 9–12 месяцев и могут не согласоваться.',
      'Заполняемость апарт-отелей в Петербурге сезонна: зимой падает до 55–60%.',
      'Самые высокие капвложения на метр среди сценариев.',
    ],
  },
  {
    code: 'culture_center', title: 'Культурно-общественный центр', scale: 'city',
    description: 'Залы и фойе работают как площадка для концертов, лекций и выставок, вокруг — образовательные студии, коворкинг и общепит. Коммерческая часть покрывает часть операционных расходов.',
    score: (i) => 50 * b2f(is(i, 'culture')) + 0.35 * c(i).transit_index + 0.4 * c(i).social_500m + 10 * b2f(i.b.is_okn),
    capexPerM2: 95000, rent: 1650, occupancy: 0.85, noi: 0.56, termMonths: 42, rentable: 0.62, areaChange: 0.01, parkingPer1k: 2,
    zoning: [['Залы и событийные пространства', 0.28], ['Образовательные студии', 0.22], ['Коворкинг и офисы', 0.18], ['Кафе и общепит', 0.08], ['Общие и технические зоны', 0.24]],
    risks: [
      'Окупаемость длинная: сценарий реалистичен при участии города или операторском договоре.',
      'Выручка от событий зависит от программы и сезона, колебания по годам до 25%.',
      'Реставрация зала и сценического оборудования — наименее предсказуемая статья.',
    ],
  },
  {
    code: 'community_center', title: 'Районный общественный центр: спорт, образование, услуги', scale: 'local',
    description: 'Спортивные залы, кружки и курсы для детей и взрослых, услуги и магазины повседневного спроса на первом этаже. Арендаторы — районные операторы и городские программы.',
    score: (i) => 1.4 * c(i).social_500m + 25 * b2f(is(i, 'culture', 'sport')) + 0.15 * c(i).transit_index - 20 * b2f(industrialZone(i)) + 8 * between(i.b.area_total_m2, 1500, 25000),
    capexPerM2: 72000, rent: 1250, occupancy: 0.92, noi: 0.64, termMonths: 26, rentable: 0.76, areaChange: 0, parkingPer1k: 3,
    zoning: [['Спорт', 0.3], ['Образование и кружки', 0.26], ['Услуги и магазины', 0.16], ['Зал', 0.1], ['Общие и технические зоны', 0.18]],
    risks: [
      'Ставки для социальных арендаторов ниже рыночных; выручка зависит от городских программ.',
      'Спортивные залы требуют высоты от 6 м — подходят не все этажи.',
      'Район должен обеспечить спрос: при оттоке жителей заполнение падает первым.',
    ],
  },
  {
    code: 'campus', title: 'Образовательный кампус', scale: 'city',
    description: 'Здание целиком сдаётся образовательному оператору — колледжу, частному вузу или школе — на 10–15 лет. Аудитории занимают существующие помещения почти без перепланировки.',
    score: (i) => 30 * b2f(is(i, 'research', 'administrative', 'culture')) + 0.3 * c(i).transit_index + 0.5 * c(i).social_500m + 12 * b2f(i.b.area_total_m2 >= 6000) - 15 * b2f(industrialZone(i)),
    capexPerM2: 74000, rent: 1150, occupancy: 0.97, noi: 0.8, termMonths: 24, rentable: 0.75, areaChange: 0, parkingPer1k: 3,
    zoning: [['Аудитории и мастерские', 0.48], ['Залы и конференц-зоны', 0.14], ['Библиотека и коворкинг', 0.12], ['Столовая', 0.06], ['Общие и технические зоны', 0.2]],
    risks: [
      'Вся выручка держится на одном договоре: при выходе арендатора здание простаивает.',
      'Образовательная лицензия ограничивает перепланировку санитарными нормами.',
      'Ставка ниже рыночной для офисов и фиксируется на срок договора.',
    ],
  },
  {
    code: 'retail_services', title: 'Торгово-сервисный центр районного значения', scale: 'local',
    description: 'Магазины, сервисы и общепит повседневного спроса на нижних этажах, офисы и медицинские кабинеты — на верхних. Якорный арендатор — продуктовый супермаркет.',
    score: (i) => 35 * b2f(is(i, 'retail')) + 0.35 * c(i).commercial_density + 0.6 * c(i).social_500m + 0.2 * c(i).transit_index - 15 * b2f(industrialZone(i)),
    capexPerM2: 82000, rent: 1700, occupancy: 0.88, noi: 0.64, termMonths: 20, rentable: 0.78, areaChange: 0, parkingPer1k: 10,
    zoning: [['Магазины и сервисы', 0.46], ['Супермаркет', 0.18], ['Медицина и офисы', 0.14], ['Кафе', 0.07], ['Общие и технические зоны', 0.15]],
    risks: [
      'Онлайн-торговля снижает спрос на непродовольственную розницу: якорь должен быть продуктовым.',
      'Парковка — обязательное условие арендаторов, участок может её не вместить.',
      'Конкуренция с торговыми центрами района за тех же арендаторов.',
    ],
  },
  {
    code: 'sport_center', title: 'Спортивный комплекс', scale: 'local',
    description: 'Игровые залы, фитнес и секции для детей, при возможности — бассейн. Высокие пролёты и свободная планировка используются без дробления на мелкие помещения.',
    score: (i) => 45 * b2f(is(i, 'sport')) + 15 * b2f(is(i, 'industrial', 'warehouse') && i.b.floors <= 2) + 0.9 * c(i).social_500m + 0.15 * c(i).transit_index,
    capexPerM2: 88000, rent: 1100, occupancy: 0.9, noi: 0.6, termMonths: 22, rentable: 0.8, areaChange: 0, parkingPer1k: 6,
    zoning: [['Игровые залы', 0.4], ['Фитнес и секции', 0.3], ['Раздевалки и душевые', 0.12], ['Кафе', 0.04], ['Общие и технические зоны', 0.14]],
    risks: [
      'Бассейн в существующих конструкциях может оказаться невозможным.',
      'Выручка сезонна: летом посещаемость падает на 30–40%.',
      'Спортивные операторы просят арендные каникулы на время запуска.',
    ],
  },
];

export const SCENARIO_COUNT: Record<AccuracyLevel, number> = { low: 2, mid: 3, high: 4 };

const round10 = (v: number) => Math.round(v / 10) * 10;
const round3 = (v: number) => Math.max(3, Math.round(v / 3) * 3);
const round01 = (v: number) => Math.round(v * 10) / 10;
const roundRub = (v: number) => (v >= 1e9 ? Math.round(v / 1e7) * 1e7 : v >= 1e8 ? Math.round(v / 1e6) * 1e6 : Math.round(v / 1e5) * 1e5);

function spread(v: number, level: AccuracyLevel, round: (n: number) => number) {
  const [lo, hi] = level === 'low' ? [0.8, 1.25] : level === 'mid' ? [0.9, 1.12] : [1, 1];
  return { min: round(v * lo), max: round(v * hi) };
}

function build(i: In, p: Profile): Scenario {
  const { b } = i;
  const okn = b.is_okn;
  let capex = p.capexPerM2 * (1 + 0.004 * Math.max(0, 1960 - b.year_built)) * (0.94 + 0.12 * unit(b.id, p.code + 'capex'));
  let term = p.termMonths;
  if (okn) {
    capex *= 1.25;
    term *= 1.4;
  }
  if (b.area_total_m2 > 20000) {
    capex *= 0.95;
    term *= 1.15;
  }
  const rent = p.rent * (0.85 + 0.003 * b.context.transit_index) * (0.95 + 0.1 * unit(b.id, p.code + 'rent'));
  const areaChange = okn ? Math.min(p.areaChange, 0.01) : p.areaChange;
  const addsFloor = !!p.addsFloor && !okn;

  const afterTotal = round10(b.area_total_m2 * (1 + areaChange));
  const after: TEPValues = {
    area_total_m2: afterTotal,
    area_rentable_m2: round10(afterTotal * p.rentable),
    floors: b.floors + (addsFloor ? 1 : 0),
    parking: 0,
  };
  after.parking = Math.round((after.area_rentable_m2 / 1000) * p.parkingPer1k);
  const before: TEPValues = {
    area_total_m2: round10(b.area_total_m2),
    area_rentable_m2: round10(b.area_total_m2 * 0.35 * unit(b.id, 'occupied')),
    floors: b.floors,
    parking: 0,
  };

  const capexTotal = after.area_total_m2 * capex;
  const revenue = after.area_rentable_m2 * rent * 12 * p.occupancy;
  const payback = capexTotal / (revenue * p.noi);

  const risks = [...p.risks];
  let description = p.description;
  if (okn) {
    description += ' Фасады и предмет охраны сохраняются, новые элементы — только внутри здания.';
    risks[risks.length - 1] = 'Согласование работ в объекте культурного наследия с КГИОП удлиняет подготовку на 6–12 месяцев.';
  }
  if (i.level === 'low') risks[0] = 'Техническое состояние неизвестно: капвложения могут отличаться от расчёта на четверть в обе стороны.';

  return {
    title: p.title,
    function_code: p.code,
    scale: p.scale,
    description,
    tep: { before, after },
    zoning: p.zoning.map(([fn, share]) => ({ function: fn, share })),
    economics: {
      capex_rub: spread(capexTotal, i.level, roundRub),
      term_months: spread(term, i.level, round3),
      revenue_year_rub: spread(revenue, i.level, roundRub),
      payback_years: spread(payback, i.level, round01),
    },
    risks,
    assumptions: {
      capex_per_m2_rub: Math.round(capex / 1000) * 1000,
      rent_rub_m2_month: Math.round(rent / 10) * 10,
      occupancy: p.occupancy,
      noi_share: p.noi,
    },
  };
}

const FUNCTION_NAMES: Record<string, string> = {
  industrial: 'производственного корпуса', warehouse: 'склада', culture: 'дома культуры', administrative: 'административного здания',
  research: 'здания НИИ', retail: 'торгового здания', sport: 'спортивного здания', other: 'здания',
};

const dec = (v: number) => v.toFixed(1).replace('.', ',');
function rubRange(r: { min: number; max: number }) {
  const [scale, name] = r.max >= 1e9 ? [1e9, 'млрд'] : [1e6, 'млн'];
  const f = (v: number) => (v / scale >= 100 ? String(Math.round(v / scale)) : dec(v / scale));
  return r.min === r.max ? `≈${f(r.max)} ${name} ₽` : `${f(r.min)}–${f(r.max)} ${name} ₽`;
}
const yearsRange = (r: { min: number; max: number }) => (r.min === r.max ? `≈${dec(r.max)} года` : `${dec(r.min)}–${dec(r.max)} года`);

function summary(i: In, sc: Scenario[]) {
  const ctx = i.b.context;
  const [best, second] = [sc[0]!, sc[1]!];
  const why: string[] = [];
  if (ctx.metro_dist_m <= 600) why.push(`здание в ${Math.round(ctx.metro_dist_m / 50) * 50} м от станции «${ctx.metro_name}»`);
  else if (ctx.transit_index < 35) why.push('метро далеко, и функции не нужен поток посетителей');
  if (ctx.commercial_density >= 60) why.push('вокруг плотная торговля и общепит');
  else if (ctx.commercial_density < 20) why.push('торговли рядом почти нет');
  if (ctx.business_activity >= 50) why.push('в районе много офисов');
  if (ctx.social_500m >= 20) why.push(`в 500 м — ${ctx.social_500m} социальных объектов`);
  if (!why.length) why.push(`планировка ${FUNCTION_NAMES[i.b.original_function]} подходит этой функции без крупной перестройки`);

  const title = /^[A-Z]/.test(best.title) ? best.title : best.title[0]!.toLowerCase() + best.title.slice(1);
  let s = `Рекомендуемый сценарий — ${title}: ${why.join(', ')}. `;
  s += `Капвложения ${rubRange(best.economics.capex_rub)}, простая окупаемость ${yearsRange(best.economics.payback_years)}. `;
  s +=
    second.economics.payback_years.min < best.economics.payback_years.min
      ? `Сценарий «${second.title}» окупается быстрее, но слабее использует положение здания. `
      : `Второй по оценке сценарий — «${second.title}»: окупаемость ${yearsRange(second.economics.payback_years)}. `;
  if (i.b.is_okn) s += 'Статус объекта культурного наследия удлиняет сроки и исключает надстройку. ';
  s +=
    i.level === 'low'
      ? 'Без технического обследования расчёт приблизительный, порядок сценариев может измениться.'
      : i.level === 'mid'
        ? 'Техническое обследование сузит диапазоны капвложений.'
        : 'Расчёт учитывает принятое техническое обследование.';
  return s;
}

export const METHODOLOGY =
  'Модель оценивает 137 характеристик здания и его окружения, сгруппированных в восемь блоков: конструкция и объёмно-планировочные решения, техническое состояние, участок и градостроительные ограничения, правовой режим и охранные обязательства, транспорт, социальная инфраструктура, коммерческое окружение, рыночные ставки по функциям. Исходные данные — OpenStreetMap, Правила землепользования и застройки Санкт-Петербурга, перечень объектов культурного наследия, открытые данные о ставках аренды и стоимости строительства, а также документы, загруженные пользователем и принятые после проверки. Экономика — укрупнённая оценка в ценах 2026 года без НДС; срок окупаемости простой, без дисконтирования.';

export function assess(b: BuildingCard, level: AccuracyLevel): EngineOutput {
  const i: In = { b, level };
  const ranked = CATALOGUE.map((p) => ({ p, score: p.score(i) + (unit(b.id, p.code) - 0.5) * 6 })).sort((x, y) => y.score - x.score);
  const scenarios = ranked.slice(0, SCENARIO_COUNT[level]).map((r) => build(i, r.p));
  const warnings: string[] = [];
  if (b.is_okn)
    warnings.push('Здание — объект культурного наследия. Работы на фасадах и в предмете охраны требуют задания и согласования КГИОП; сроки и капвложения в отчёте это учитывают.');
  if (level === 'low')
    warnings.push('Низкая точность: техническое состояние здания не известно, капвложения оценены по аналогам. Загрузите техническое обследование, чтобы получить четыре сценария и точечные значения.');
  warnings.push('Демо-версия: расчёт выполнен в браузере тем же набором правил, что и на сервере.');
  return { summary: summary(i, scenarios), scenarios, methodology: METHODOLOGY, accuracy_level: level, warnings };
}

/** Время расчёта, как у серверной заглушки: 3–8 секунд по id здания. */
export const runMs = (id: number) => 3000 + Math.floor(unit(id, 'delay') * 5000);
