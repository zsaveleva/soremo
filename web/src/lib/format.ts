// Единое форматирование чисел для интерфейса и PDF (ТЗ 9.3):
// разряды — неразрывным пробелом, диапазоны — через короткое тире без пробелов,
// единицы — «₽», «м²»; приблизительные значения — со знаком «≈».

const NBSP = ' ';
const DASH = '–';

function num(n: number, maxFrac = 0, minFrac = 0) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: maxFrac, minimumFractionDigits: minFrac })
    .format(n)
    .replace(/ | | /g, NBSP);
}

export function formatNumber(n: number, frac = 0) {
  return num(n, frac);
}

export function plural(n: number, one: string, few: string, many: string) {
  if (!Number.isInteger(n)) return few; // 4,2 года, 1,5 млн
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function formatRub(n: number) {
  return `${num(n)}${NBSP}₽`;
}

type Scale = { div: number; unit: string };
const SCALES: Scale[] = [
  { div: 1e9, unit: 'млрд' },
  { div: 1e6, unit: 'млн' },
  { div: 1e3, unit: 'тыс.' },
];

function scaleFor(n: number): Scale {
  return SCALES.find((s) => Math.abs(n) >= s.div) ?? { div: 1, unit: '' };
}

/** Значащая точность: 2 знака после запятой до 10, 1 — до 100, далее целые. */
function short(v: number) {
  const a = Math.abs(v);
  return num(v, a < 10 ? (a < 1 ? 2 : 1) : 0);
}

/** 12 млн ₽, 1,4 млрд ₽, 850 тыс. ₽ */
export function formatRubShort(n: number) {
  const s = scaleFor(n);
  return `${short(n / s.div)}${s.unit ? NBSP + s.unit : ''}${NBSP}₽`;
}

export type Range = { min: number; max: number };

const isPoint = (r: Range) => Math.abs(r.max - r.min) <= Math.abs(r.max) * 0.005;

/** 12–18 млн ₽ (общая единица по верхней границе) или ≈ 14 млн ₽. */
export function formatRubRange(r: Range) {
  if (isPoint(r)) return `≈${NBSP}${formatRubShort(r.max)}`;
  const s = scaleFor(r.max);
  return `${short(r.min / s.div)}${DASH}${short(r.max / s.div)}${s.unit ? NBSP + s.unit : ''}${NBSP}₽`;
}

/** 4,2 года; 3,5–5 лет; ≈ 4,2 года */
export function formatYearsRange(r: Range) {
  const word = (n: number) => plural(n, 'год', 'года', 'лет');
  const f = (n: number) => num(n, 1);
  if (isPoint(r)) return `≈${NBSP}${f(r.max)}${NBSP}${word(Number(r.max.toFixed(1)))}`;
  return `${f(r.min)}${DASH}${f(r.max)}${NBSP}${word(Number(r.max.toFixed(1)))}`;
}

/** 18–24 мес.; ≈ 20 мес. */
export function formatMonthsRange(r: Range) {
  if (isPoint(r)) return `≈${NBSP}${num(r.max)}${NBSP}мес.`;
  return `${num(r.min)}${DASH}${num(r.max)}${NBSP}мес.`;
}

export function formatArea(m2: number) {
  return `${num(m2)}${NBSP}м²`;
}

export function formatAreaRange(r: Range) {
  if (isPoint(r)) return formatArea(r.max);
  return `${num(r.min)}${DASH}${num(r.max)}${NBSP}м²`;
}

export function formatDistance(m: number) {
  if (m < 1000) return `${num(Math.round(m / 10) * 10)}${NBSP}м`;
  return `${num(m / 1000, 1)}${NBSP}км`;
}

export function formatPercent(share: number) {
  return `${num(share * 100)}${NBSP}%`;
}

export function formatBytes(b: number) {
  if (b < 1024 * 1024) return `${num(Math.max(1, Math.round(b / 1024)))}${NBSP}КБ`;
  return `${num(b / 1024 / 1024, 1)}${NBSP}МБ`;
}

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const dateShortFmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** 23 октября 2026 г. → «23 октября 2026» */
export function formatDate(d: string | Date) {
  return dateFmt.format(new Date(d)).replace(/\s?г\.$/, '');
}

export function formatDateShort(d: string | Date) {
  return dateShortFmt.format(new Date(d));
}

export function formatObjects(n: number | null) {
  if (n === null) return 'все объекты';
  return `${num(n)}${NBSP}${plural(n, 'объект', 'объекта', 'объектов')}`;
}

export function formatMonths(n: number) {
  return `${n}${NBSP}${plural(n, 'месяц', 'месяца', 'месяцев')}`;
}
