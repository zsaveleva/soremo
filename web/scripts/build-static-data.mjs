// Готовит данные для статической демо-версии (GitHub Pages) из seed/:
// здания, карточки, примеры отчётов, пакеты и PDF примеров → public/data.
// Запускается перед сборкой: npm run build:static.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

const seed = new URL('../../seed/', import.meta.url);
const out = new URL('../public/data/', import.meta.url);
rmSync(out, { recursive: true, force: true });
mkdirSync(new URL('pdf/', out), { recursive: true });

const fc = JSON.parse(readFileSync(new URL('buildings.geojson', seed)));

// id совпадают с базой после `make seed`: здания вставляются в порядке файла.
const buildings = fc.features.map((f, i) => {
  const p = f.properties;
  const ring = f.geometry.coordinates[0];
  const n = ring.length - 1;
  const center = ring.slice(0, n).reduce((a, [x, y]) => [a[0] + x / n, a[1] + y / n], [0, 0]);
  return {
    id: i + 1,
    address: p.address,
    name: p.name || null,
    year_built: p.year_built,
    original_function: p.original_function,
    floors: p.floors,
    area_total_m2: p.area_total_m2,
    area_site_m2: p.area_site_m2,
    area_footprint_m2: p.area_footprint_m2,
    vri: p.vri,
    pzz_zone: p.pzz_zone,
    is_okn: p.is_okn,
    legal_status: p.legal_status,
    source: 'base',
    is_demo: p.is_demo,
    demo_slug: p.demo_slug || null,
    geometry: f.geometry,
    center,
    context: {
      metro_name: p.metro_name,
      metro_dist_m: p.metro_dist_m,
      transit_index: p.transit_index,
      social_500m: p.social_500m,
      commercial_density: p.commercial_density,
      business_activity: p.business_activity,
    },
    accuracy: { level: 'low', docs_pending: 0, docs_accepted: 0 },
    my_report_id: null,
  };
});
writeFileSync(new URL('buildings.json', out), JSON.stringify(buildings));

const reports = {};
for (const file of readdirSync(new URL('demo_reports/', seed))) {
  const { building_slug, engine_version, ...result } = JSON.parse(readFileSync(new URL(`demo_reports/${file}`, seed)));
  const b = buildings.find((x) => x.demo_slug === building_slug);
  if (!b) throw new Error(`demo building ${building_slug} not found`);
  const at = '2026-10-28T09:00:00Z';
  reports[b.id] = {
    id: `demo-${b.id}`,
    kind: 'demo',
    status: 'ready',
    accuracy_level: result.accuracy_level,
    engine_version,
    created_at: at,
    finished_at: at,
    refined: result.accuracy_level !== 'low',
    building: { ...b, accuracy: { ...b.accuracy, level: result.accuracy_level } },
    result,
  };
  copyFileSync(new URL(`demo_pdf/demo-${b.id}.pdf`, seed), new URL(`pdf/demo-${b.id}.pdf`, out));
}
writeFileSync(new URL('demo-reports.json', out), JSON.stringify(reports));

// Цены — те же, что в api/cmd/seed/main.go (ТЗ 7.5).
const packages = [
  [1, 1, 25000], [5, 1, 90000], [5, 3, 120000], [25, 1, 250000], [25, 3, 320000], [25, 6, 420000],
  [100, 3, 700000], [100, 6, 900000], [100, 12, 1200000], [null, 6, 1800000], [null, 12, 2800000],
].map(([objects_limit, months, price_rub], i) => ({ id: i + 1, objects_limit, months, price_rub }));
writeFileSync(new URL('packages.json', out), JSON.stringify(packages));

console.log(`static data: ${buildings.length} buildings, ${Object.keys(reports).length} demo reports`);
