import type { BuildingCard, EngineOutput, Feasibility, FeasibilityVerdict, Scenario } from './types';

// Предварительные правила статического демо. Это не проверка актуального регламента.
const RULES: Record<string, { from: string[]; industrial?: boolean; social?: boolean; addsFloor?: boolean; missing: string }> = {
  creative_cluster: { from: ['administrative', 'culture', 'research'], missing: 'Шаг колонн, высота этажей и эвакуационные пути' },
  light_industrial: { from: ['industrial', 'warehouse'], industrial: true, missing: 'Грузоподъёмность перекрытий и свободная электрическая мощность' },
  warehouse_office: { from: ['warehouse', 'industrial'], industrial: true, missing: 'Складские нагрузки и подъезд грузовиков' },
  business_center: { from: ['administrative', 'research'], missing: 'Мощность сетей, вентиляция и парковка' },
  aparthotel: { from: [], addsFloor: true, social: true, missing: 'Несущая способность, освещённость и шумовой режим' },
  culture_center: { from: ['culture'], missing: 'Состояние зала, сцены и модель работы оператора' },
  community_center: { from: ['culture', 'sport'], social: true, missing: 'Высота залов и спрос районных операторов' },
  campus: { from: [], social: true, missing: 'Освещённость аудиторий и якорный образовательный оператор' },
  retail_services: { from: ['retail'], missing: 'Парковка и якорный арендатор' },
  sport_center: { from: ['sport'], missing: 'Высота залов и пролёты без колонн' },
};

function explain(b: BuildingCard, sc: Scenario, all: Scenario[]) {
  const rule = RULES[sc.function_code];
  const checks: FeasibilityVerdict['checks'] = [];
  const add = (status: Feasibility, text: string) => checks.push({ status, text });
  const compatible = !!rule?.from.includes(b.original_function);
  add(compatible ? 'feasible' : 'check', compatible
    ? `Исходное назначение совместимо с функцией по правилам демо-модели. ВРИ «${b.vri}» нужно сверить с документами.`
    : `Проверьте ВРИ «${b.vri}»: для новой функции может потребоваться его изменение.`);
  add('check', `Зона ${b.pzz_zone}: проверьте допустимость функции по актуальному градостроительному регламенту.`);
  if (b.is_okn) add(rule?.addsFloor ? 'restricted' : 'check', rule?.addsFloor
    ? 'Сценарий предполагает надстройку: статус ОКН создаёт ограничение в демо-модели.'
    : 'Статус ОКН: уточните предмет охраны и условия проведения работ.');
  if (!b.zones) add('check', 'Пересечения с зонами не проверены: сверьте участок в РГИС и НСПД.');
  else {
    if (b.zones.demo) add('check', 'Зоны размечены для демонстрации. Подтвердите пересечения по актуальным источникам.');
    for (const z of b.zones.items) {
      if ((z.code === 'szz' && rule?.social) || (z.code === 'okn_zone_1' && rule?.addsFloor))
        add('restricted', `${z.title}: по правилам демо-модели есть ограничение, проверьте режим зоны.`);
      else if (z.effect !== 'info') add('check', `${z.title}: ${z.note}`);
    }
  }
  const rank = { feasible: 0, check: 1, restricted: 2 };
  sc.feasibility ??= { checks, status: checks.reduce<Feasibility>((worst, c) => rank[c.status] > rank[worst] ? c.status : worst, 'feasible') };
  const pros: string[] = [];
  const cons: string[] = [];
  (compatible ? pros : cons).push(compatible ? 'Исходная функция близка к предлагаемой.' : 'Нужно уточнить возможность смены назначения.');
  if (sc.scale === 'city') (b.context.transit_index >= 60 ? pros : cons).push(b.context.transit_index >= 60
    ? `Транспортная доступность ${b.context.transit_index}/100 поддерживает общегородской спрос.`
    : 'Городской функции потребуется проверить доступность для посетителей.');
  if (all.length > 1 && sc.economics.capex_rub.min === Math.min(...all.map((x) => x.economics.capex_rub.min))) pros.push('Самые низкие капвложения среди сценариев отчёта.');
  if (b.is_okn) cons.push('Охранные обязательства могут увеличить бюджет и срок подготовки.');
  if (!pros.length) pros.push('Входит в число лучших функций по оценке демо-модели.');
  if (!cons.length) cons.push(sc.risks[0] ?? 'Спрос и технические условия требуют проверки.');
  sc.pros ??= pros;
  sc.cons ??= cons;
  sc.evidence ??= {
    confirmed: ['Адрес и геометрия — открытые данные OpenStreetMap', 'Метрики окружения — расчёт по OpenStreetMap',
      ...(b.zones && !b.zones.demo ? [`Зоны — ${b.zones.source}`] : [])],
    missing: ['Границы участка, ЕГРН и ГПЗУ', 'Техническое состояние и мощности сетей',
      ...(b.zones?.demo ? ['Зоны — демонстрационная разметка, требуют проверки'] : []),
      rule?.missing ?? 'Условия размещения новой функции'],
  };
}

/** Дополняет старые демо-отчёты, сохраняя их расчётные числа и ручные пояснения. */
export function annotateStatic(b: BuildingCard, out: EngineOutput): EngineOutput {
  out.scenarios.forEach((sc) => explain(b, sc, out.scenarios));
  out.tech_risks ??= [
    { element: 'Каркас и перекрытия', note: 'Проверить несущую способность, трещины и прогибы обследованием.', reserve: { min: 5, max: 15 } },
    { element: 'Кровля и фасады', note: b.is_okn ? 'Уточнить предмет охраны и объём реставрации.' : 'Проверить протечки и состояние ограждающих конструкций.', reserve: { min: 3, max: 8 } },
    { element: 'Инженерные системы', note: 'Проверить состояние сетей и доступные мощности под новую функцию.', reserve: { min: 4, max: 10 } },
  ];
  out.next_steps ??= [
    'Сверить участок, ВРИ и ограничения в ЕГРН, ГПЗУ, РГИС и НСПД.',
    'Заказать обследование конструкций и инженерных систем, проверить условия на месте.',
    ...(b.is_okn ? ['Уточнить предмет охраны и требования КГИОП.'] : []),
    'Проверить спрос и ставки с потенциальными арендаторами.',
    'Обсудить выбранный сценарий и бюджет с инвестором или банком.',
  ];
  return out;
}
