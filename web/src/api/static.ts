// Статическая демо-версия (GitHub Pages): ответы API строятся в браузере из
// данных public/data, подготовленных scripts/build-static-data.mjs. Логика
// повторяет бэкенд — фильтры, bbox, кластеры по сетке, поиск по словам.
import { ApiError } from './client';
import type { BuildingCard, Report } from './types';

export const IS_STATIC = import.meta.env.VITE_STATIC === '1';

export const STATIC_MESSAGE =
  'В демо-версии на GitHub Pages это недоступно. Здесь открыты карта, карточки объектов и три примера отчётов; регистрация, оплата и моделирование работают в полной версии.';

type Pkg = { id: number; objects_limit: number | null; months: number; price_rub: number };

const base = import.meta.env.BASE_URL;
const cache = new Map<string, Promise<unknown>>();
function load<T>(file: string): Promise<T> {
  if (!cache.has(file)) cache.set(file, fetch(`${base}data/${file}`).then((r) => r.json()));
  return cache.get(file) as Promise<T>;
}
const buildings = () => load<(BuildingCard & { demo_slug: string | null })[]>('buildings.json');

const CLUSTER_ZOOM = 13;
function intersects(b: BuildingCard, [w, s, e, n]: number[]) {
  const ring = b.geometry.coordinates[0]!;
  return ring.some(([x = 0, y = 0]) => x >= w! && x <= e! && y >= s! && y <= n!);
}

function filtered(all: BuildingCard[], q: URLSearchParams) {
  const bbox = (q.get('bbox') ?? '').split(',').map(Number);
  const yf = Number(q.get('year_from') || 0);
  const yt = Number(q.get('year_to') || 9999);
  const af = Number(q.get('area_from') || 0);
  const at = Number(q.get('area_to') || Infinity);
  const fns = q.get('function')?.split(',');
  const docs = q.get('has_docs');
  return all.filter(
    (b) =>
      (bbox.length !== 4 || intersects(b, bbox)) &&
      b.year_built >= yf &&
      b.year_built <= yt &&
      b.area_total_m2 >= af &&
      b.area_total_m2 <= at &&
      (!fns || fns.includes(b.original_function)) &&
      // В статике документов нет ни у одного объекта.
      docs !== 'true' &&
      q.get('mine') !== 'true',
  );
}

async function listBuildings(q: URLSearchParams) {
  const items = filtered(await buildings(), q);
  const zoom = Number(q.get('zoom') || 14);
  if (zoom >= CLUSTER_ZOOM) {
    return {
      type: 'FeatureCollection',
      features: items.map((b) => ({
        type: 'Feature',
        id: b.id,
        geometry: b.geometry,
        properties: {
          address: b.address,
          year_built: b.year_built,
          original_function: b.original_function,
          area_total_m2: b.area_total_m2,
          source: b.source,
          is_demo: b.is_demo,
        },
      })),
    };
  }
  // Та же сетка, что ST_SnapToGrid на бэкенде: ~64 экранных пикселя.
  const cell = ((360 / 2 ** zoom) * 64) / 256;
  const groups = new Map<string, { n: number; x: number; y: number; id: number }>();
  for (const b of items) {
    const key = `${Math.round(b.center[0] / cell)}:${Math.round(b.center[1] / cell)}`;
    const g = groups.get(key) ?? { n: 0, x: 0, y: 0, id: b.id };
    g.n++;
    g.x += b.center[0];
    g.y += b.center[1];
    g.id = Math.min(g.id, b.id);
    groups.set(key, g);
  }
  return {
    type: 'FeatureCollection',
    features: [...groups.values()].map((g) => ({
      type: 'Feature',
      id: g.id,
      geometry: { type: 'Point', coordinates: [g.x / g.n, g.y / g.n] },
      properties: { cluster: true, count: g.n },
    })),
  };
}

const STREET_TYPES = new Set(['улица', 'ул', 'проспект', 'пр', 'пр-т', 'пр-кт', 'переулок', 'пер', 'набережная', 'наб', 'шоссе', 'ш', 'площадь', 'пл', 'бульвар', 'бул', 'дорога', 'дор', 'дом', 'д', 'литера', 'лит']);

function tokens(q: string) {
  return q
    .toLowerCase()
    .replaceAll('ё', 'е')
    .split(/[\s,]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter((w) => w && !STREET_TYPES.has(w));
}

async function search(q: string) {
  const ts = tokens(q);
  if (!ts.length || ts.join('').length < 2) return [];
  const hits = (await buildings()).filter((b) => {
    const hay = `${b.address} ${b.name ?? ''}`.toLowerCase().replaceAll('ё', 'е');
    return ts.every((t) => hay.includes(t));
  });
  const first = ts[0]!;
  hits.sort((a, b) => Number(b.address.toLowerCase().startsWith(first)) - Number(a.address.toLowerCase().startsWith(first)) || a.address.localeCompare(b.address, 'ru'));
  return hits.slice(0, 8).map((b) => ({
    id: b.id,
    address: b.address,
    name: b.name,
    year_built: b.year_built,
    original_function: b.original_function,
    is_demo: b.is_demo,
    source: b.source,
    center: b.center,
  }));
}

export async function staticApi(path: string, method: string): Promise<unknown> {
  const url = new URL(path, 'http://static');
  const p = url.pathname;
  if (method === 'GET') {
    if (p === '/cities') return [{ id: 1, slug: 'spb', name: 'Санкт-Петербург', bbox: [29.42, 59.63, 30.76, 60.25] }];
    if (p === '/buildings') return listBuildings(url.searchParams);
    if (p === '/buildings/search') return search(url.searchParams.get('q') ?? '');
    if (p === '/packages') return load<Pkg[]>('packages.json');
    const reports = () => load<Record<string, Report>>('demo-reports.json');
    if (p === '/demo/buildings')
      return Object.values(await reports()).map((r) => ({ id: r.building.id, address: r.building.address, name: r.building.name, center: r.building.center }));
    let m = p.match(/^\/demo\/reports\/(\d+)$/);
    if (m) {
      const r = (await reports())[m[1]!];
      if (!r) throw new ApiError(404, 'not_found', 'Для этого объекта нет примера отчёта.');
      return r;
    }
    m = p.match(/^\/buildings\/(\d+)$/);
    if (m) {
      const b = (await buildings()).find((x) => x.id === Number(m![1]));
      if (!b) throw new ApiError(404, 'not_found', 'Объект не найден.');
      return b;
    }
  }
  throw new ApiError(503, 'static_demo', STATIC_MESSAGE);
}

/** PDF примеров собраны заранее на полной версии и лежат рядом с данными. */
export function staticPdfUrl(path: string) {
  const m = path.match(/^\/demo\/reports\/(\d+)\/pdf$/);
  return m ? `${base}data/pdf/demo-${m[1]}.pdf` : null;
}
