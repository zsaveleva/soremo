// Статическая демо-версия (GitHub Pages): ответы API строятся в браузере из
// данных public/data, подготовленных scripts/build-static-data.mjs. Логика
// повторяет бэкенд — фильтры, bbox, кластеры по сетке, поиск по словам.
import { ApiError } from './client';
import type { AccuracyLevel, BuildingCard, Report } from './types';
import { ENGINE_VERSION, assess, runMs } from './staticEngine';

export const IS_STATIC = import.meta.env.VITE_STATIC === '1';

export const DEMO_EMAIL = 'demo@soremo.local';
export const DEMO_PASSWORD = 'demo1234';

export const STATIC_MESSAGE = `Демо-версия без сервера. Войдите аккаунтом ${DEMO_EMAIL}, пароль ${DEMO_PASSWORD}: кабинет, пакеты и моделирование работают прямо в браузере, данные хранятся только в нём. Регистрация, загрузка документов и модерация доступны в полной версии.`;

const UNAVAILABLE =
  'В демо-версии это недоступно: регистрация, загрузка документов и модерация работают в полной версии сервиса.';

// ---- состояние демо-пользователя в localStorage ----

type StoredReport = { id: string; building_id: number; level: AccuracyLevel; created_at: number };
type State = {
  session: boolean;
  access: { id: string; package_id: number; objects_limit: number | null; objects_used: number; starts_at: string; ends_at: string; months: number } | null;
  objects: number[];
  reports: StoredReport[];
  payments: Record<string, { package_id: number; status: 'pending' | 'succeeded' }>;
};

const KEY = 'soremo-demo-v1';
let memory: State | null = null;

function read(): State {
  if (memory) return memory;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return (memory = JSON.parse(raw) as State);
  } catch {
    /* приватный режим или запрет хранилища — работаем в памяти */
  }
  return (memory = { session: false, access: null, objects: [], reports: [], payments: {} });
}

function write(st: State) {
  memory = st;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(st));
  } catch {
    /* в памяти состояние всё равно есть */
  }
}

export function hasStaticSession() {
  return read().session;
}

const DEMO_USER = {
  id: 'demo',
  email: DEMO_EMAIL,
  type: 'company' as const,
  segment: 'investor' as const,
  company_name: 'ООО «Демо-инвест»',
  phone: null,
  role: 'user' as const,
};

function accessOut(st: State) {
  const a = st.access;
  if (!a || new Date(a.ends_at).getTime() <= Date.now()) return null;
  return { id: a.id, objects_limit: a.objects_limit, objects_used: a.objects_used, starts_at: a.starts_at, ends_at: a.ends_at, status: 'active', months: a.months };
}

function newAccess(pkg: Pkg) {
  const start = new Date();
  const end = new Date(start);
  end.setMonth(end.getMonth() + pkg.months);
  return { id: crypto.randomUUID(), package_id: pkg.id, objects_limit: pkg.objects_limit, objects_used: 0, starts_at: start.toISOString(), ends_at: end.toISOString(), months: pkg.months };
}

function requireSession() {
  const st = read();
  if (!st.session) throw new ApiError(401, 'unauthorized', 'Войдите, чтобы продолжить.');
  return st;
}

function luhn(n: string) {
  let sum = 0;
  let alt = false;
  for (let i = n.length - 1; i >= 0; i--) {
    let d = Number(n[i]);
    if (alt && (d *= 2) > 9) d -= 9;
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function validateCard(c: { number?: string; expiry?: string; cvc?: string; holder?: string }) {
  const f: Record<string, string> = {};
  const num = (c.number ?? '').replace(/\s/g, '');
  if (!/^\d{16,19}$/.test(num) || !luhn(num)) f.number = 'Проверьте номер карты: 16 цифр без ошибок';
  const m = (c.expiry ?? '').trim().match(/^(0[1-9]|1[0-2])\s*\/\s*(\d{2})$/);
  if (!m) f.expiry = 'Укажите срок в формате ММ/ГГ';
  else if (new Date(2000 + Number(m[2]), Number(m[1]), 1).getTime() <= Date.now()) f.expiry = 'Срок действия карты истёк — укажите другую карту';
  if (!/^\d{3}$/.test(c.cvc ?? '')) f.cvc = 'Три цифры с обратной стороны карты';
  if (!(c.holder ?? '').trim()) f.holder = 'Укажите имя латиницей, как на карте';
  return { f, num };
}

const QUEUE_MS = 600;

function reportStatus(r: StoredReport) {
  const t = Date.now() - r.created_at;
  return t < QUEUE_MS ? 'queued' : t < QUEUE_MS + runMs(r.building_id) ? 'running' : 'ready';
}

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
      (q.get('mine') !== 'true' || read().reports.some((r) => r.building_id === b.id)),
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

export async function staticApi(path: string, method: string, json?: unknown): Promise<unknown> {
  const url = new URL(path, 'http://static');
  const p = url.pathname;
  const body = (json ?? {}) as Record<string, unknown>;

  // ---- сессия, доступ, оплата, моделирование ----
  if (method === 'POST') {
    if (p === '/auth/login') {
      if (String(body.email ?? '').trim().toLowerCase() !== DEMO_EMAIL || body.password !== DEMO_PASSWORD)
        throw new ApiError(401, 'bad_credentials', 'Неверный email или пароль.', {
          password: `В демо-версии работает аккаунт ${DEMO_EMAIL}, пароль ${DEMO_PASSWORD}`,
        });
      const st = read();
      st.session = true;
      // Первый вход: пакет на 25 объектов на 6 месяцев, как у dev-пользователя полной версии.
      if (!st.access) st.access = newAccess((await load<Pkg[]>('packages.json')).find((x) => x.objects_limit === 25 && x.months === 6)!);
      write(st);
      return { access_token: 'static', expires_in: 900, user: DEMO_USER, access: accessOut(st) };
    }
    if (p === '/auth/logout') {
      write({ ...read(), session: false });
      return undefined;
    }
    if (p === '/me/notifications/read') return undefined;
    if (p === '/checkout') {
      const st = requireSession();
      const pkg = (await load<Pkg[]>('packages.json')).find((x) => x.id === Number(body.package_id));
      if (!pkg) throw new ApiError(404, 'not_found', 'Такого пакета нет. Выберите пакет заново.');
      const id = crypto.randomUUID();
      st.payments[id] = { package_id: pkg.id, status: 'pending' };
      write(st);
      return { payment_id: id, amount: pkg.price_rub, package: pkg };
    }
    let m = p.match(/^\/payments\/([\w-]+)\/confirm$/);
    if (m) {
      const st = requireSession();
      const pay = st.payments[m[1]!];
      if (!pay) throw new ApiError(404, 'not_found', 'Платёж не найден. Начните оформление заново.');
      if (pay.status !== 'pending') throw new ApiError(409, 'conflict', 'Этот платёж уже проведён.');
      const { f, num } = validateCard((body.card_mock ?? {}) as Record<string, string>);
      if (Object.keys(f).length) throw new ApiError(422, 'validation_failed', 'Проверьте данные карты.', f);
      if (num === '4000000000000002')
        throw new ApiError(402, 'card_declined', 'Банк отклонил платёж. Попробуйте другую карту.', { number: 'Банк отклонил эту карту — укажите другую' });
      const pkg = (await load<Pkg[]>('packages.json')).find((x) => x.id === pay.package_id)!;
      // Новый пакет заменяет старый; уже смоделированные объекты остаются бесплатными для пересчёта.
      st.access = newAccess(pkg);
      pay.status = 'succeeded';
      write(st);
      return { access: accessOut(st) };
    }
    m = p.match(/^\/buildings\/(\d+)\/reports$/);
    if (m) {
      const st = requireSession();
      const bid = Number(m[1]);
      const b = (await buildings()).find((x) => x.id === bid);
      if (!b) throw new ApiError(404, 'not_found', 'Объект не найден.');
      const active = st.reports.find((r) => r.building_id === bid && reportStatus(r) !== 'ready');
      if (active) return { report_id: active.id, status: 'queued' };
      const acc = accessOut(st);
      if (!acc) throw new ApiError(402, 'access_expired', 'Для отчёта нужен доступ: выберите пакет.');
      if (!st.objects.includes(bid)) {
        if (acc.objects_limit !== null && st.access!.objects_used >= acc.objects_limit)
          throw new ApiError(402, 'quota_exceeded', 'Лимит объектов в пакете исчерпан.');
        st.objects.push(bid);
        st.access!.objects_used++;
      }
      const r: StoredReport = { id: crypto.randomUUID(), building_id: bid, level: 'low', created_at: Date.now() };
      st.reports.push(r);
      write(st);
      return { report_id: r.id, status: 'queued' };
    }
    throw new ApiError(503, 'static_demo', UNAVAILABLE);
  }

  if (method === 'GET') {
    if (p === '/me') {
      const st = requireSession();
      return { user: DEMO_USER, access: accessOut(st), notifications: [] };
    }
    if (p === '/access/current') return { access: accessOut(requireSession()) };
    if (p === '/me/documents' || p === '/me/object-requests' || /^\/buildings\/\d+\/documents$/.test(p)) {
      requireSession();
      return [];
    }
    if (p === '/me/reports') {
      const st = requireSession();
      const all = await buildings();
      const latest = new Map<number, StoredReport>();
      for (const r of st.reports) latest.set(r.building_id, r);
      return [...latest.values()].map((r) => {
        const b = all.find((x) => x.id === r.building_id)!;
        const status = reportStatus(r);
        return {
          id: r.id, building_id: b.id, address: b.address, name: b.name, original_function: b.original_function, year_built: b.year_built,
          status, accuracy_level: r.level, created_at: new Date(r.created_at).toISOString(),
          finished_at: status === 'ready' ? new Date(r.created_at + QUEUE_MS + runMs(b.id)).toISOString() : null,
          versions: st.reports.filter((x) => x.building_id === b.id).length,
        };
      });
    }
    const rm = p.match(/^\/reports\/([\w-]+)$/);
    if (rm) {
      const st = requireSession();
      const r = st.reports.find((x) => x.id === rm[1]);
      if (!r) throw new ApiError(404, 'not_found', 'Отчёт не найден.');
      const b = (await buildings()).find((x) => x.id === r.building_id)!;
      const status = reportStatus(r);
      return {
        id: r.id, kind: 'user', status, accuracy_level: r.level, engine_version: ENGINE_VERSION,
        created_at: new Date(r.created_at).toISOString(),
        finished_at: status === 'ready' ? new Date(r.created_at + QUEUE_MS + runMs(b.id)).toISOString() : null,
        refined: r.level !== 'low',
        building: { ...b, my_report_id: r.id },
        // Результат детерминирован, поэтому не хранится, а пересчитывается при открытии.
        result: status === 'ready' ? assess(b, r.level) : null,
      } satisfies Report;
    }
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
      const st = read();
      const mine = st.session ? st.reports.filter((r) => r.building_id === b.id).at(-1) : undefined;
      return { ...b, my_report_id: mine?.id ?? null };
    }
  }
  throw new ApiError(503, 'static_demo', UNAVAILABLE);
}

/** PDF примеров собраны заранее на полной версии и лежат рядом с данными. */
export function staticPdfUrl(path: string) {
  const m = path.match(/^\/demo\/reports\/(\d+)\/pdf$/);
  return m ? `${base}data/pdf/demo-${m[1]}.pdf` : null;
}
