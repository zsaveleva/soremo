import type { BuildingCard, ZoneEffect } from '../api/types';
import { FUNCTION_LABEL } from './labels';
import { formatArea, formatDate } from './format';
import { contextRows } from './context';

// Паспорт здания: у каждого показателя — источник, дата и статус.
// Даты наборов данных — даты выгрузок, из которых собрана база (seed/).

/** Выгрузка OpenStreetMap для базы зданий (seed/osm). */
export const OSM_EXTRACT_DATE = '2026-10-28';

export type SourceStatus = 'confirmed' | 'open' | 'estimate';

export const STATUS_LABEL: Record<SourceStatus, string> = {
  confirmed: 'Подтверждено',
  open: 'Открытые данные',
  estimate: 'Оценка',
};

export type PassportRow = { label: string; value: string; source: string; date: string | null; status: SourceStatus };

export const EXTERNAL = {
  nspd: { title: 'НСПД — Национальная система пространственных данных', url: 'https://nspd.gov.ru/' },
  rgis: { title: 'РГИС Санкт-Петербурга', url: 'https://rgis.spb.ru/' },
  yandex: { title: 'Яндекс Геоаналитика', url: 'https://yandex.ru/geoanalytics' },
};

function yearRow(b: BuildingCard): PassportRow {
  const base = { label: 'Год постройки', value: String(b.year_built) };
  switch (b.year_source) {
    case 'osm':
      return { ...base, source: 'OpenStreetMap, тег start_date', date: OSM_EXTRACT_DATE, status: 'open' };
    case 'manual':
      return { ...base, source: 'Проверен вручную по открытым источникам', date: OSM_EXTRACT_DATE, status: 'confirmed' };
    case 'user':
      return { ...base, source: 'Указан собственником при добавлении', date: b.created_at ?? null, status: 'estimate' };
    default:
      return { ...base, source: 'Оценка по эпохе застройки района', date: OSM_EXTRACT_DATE, status: 'estimate' };
  }
}

export function passportRows(b: BuildingCard): PassportRow[] {
  const user = b.source === 'user';
  const geo = user
    ? { source: 'Собственник, проверено модератором', date: b.created_at ?? null, status: 'confirmed' as const }
    : { source: 'OpenStreetMap', date: OSM_EXTRACT_DATE, status: 'open' as const };
  const model = { source: 'Расчёт: пятно застройки × этажность', date: geo.date, status: 'estimate' as const };
  const reg = user
    ? { source: 'Собственник, проверено модератором', date: b.created_at ?? null, status: 'estimate' as const }
    : { source: 'ПЗЗ Санкт-Петербурга, демо-разметка', date: OSM_EXTRACT_DATE, status: 'estimate' as const };
  const ctxDate = b.context.updated_at ?? OSM_EXTRACT_DATE;

  const rows: PassportRow[] = [
    { label: 'Адрес и контур', value: b.address, ...geo },
    yearRow(b),
    { label: 'Исходное назначение', value: FUNCTION_LABEL[b.original_function], ...geo },
    { label: 'Этажность', value: String(b.floors), ...(user ? geo : { source: 'OpenStreetMap или оценка по назначению', date: OSM_EXTRACT_DATE, status: 'estimate' as const }) },
    { label: 'Площадь застройки', value: formatArea(b.area_footprint_m2), ...geo },
    { label: 'Площадь здания', value: formatArea(b.area_total_m2), ...model },
    { label: 'Площадь участка', value: formatArea(b.area_site_m2), ...{ ...model, source: 'Оценка до выписки ЕГРН' } },
    { label: 'Вид разрешённого использования', value: b.vri, ...reg },
    { label: 'Зона по ПЗЗ', value: b.pzz_zone, ...reg },
    {
      label: 'Объект культурного наследия',
      value: b.is_okn ? 'Да' : 'Нет',
      ...(user ? reg : { source: 'Перечень ОКН КГИОП, демо-разметка', date: OSM_EXTRACT_DATE, status: 'estimate' as const }),
    },
    { label: 'Правовой статус', value: b.legal_status, source: 'Справочно, до выписки ЕГРН', date: geo.date, status: 'estimate' },
    ...contextRows(b.context).map((c) => ({
      label: c.label,
      value: c.value,
      source: 'Расчёт по объектам OpenStreetMap',
      date: ctxDate,
      status: 'open' as const,
    })),
  ];

  if (b.accuracy.docs_accepted > 0)
    rows.push({
      label: 'Техническое состояние',
      value: `Документов принято: ${b.accuracy.docs_accepted}`,
      source: 'Документы собственника, проверены экспертом',
      date: b.accuracy.latest_accepted_on ?? null,
      status: 'confirmed',
    });
  else
    rows.push({
      label: 'Техническое состояние',
      value: 'Не известно',
      source: 'Нужно техобследование',
      date: null,
      status: 'estimate',
    });
  return rows;
}

export function sourceDate(d: string | null) {
  return d ? formatDate(d) : '—';
}

export const ZONE_EFFECT: Record<ZoneEffect, { label: string; tone: 'rejected' | 'pending' | 'neutral' }> = {
  restriction: { label: 'Ограничение', tone: 'rejected' },
  check: { label: 'Нужна проверка', tone: 'pending' },
  info: { label: 'Справочно', tone: 'neutral' },
};

/** Координаты центра для поиска участка в НСПД и РГИС. */
export function coordsLabel(center: [number, number]) {
  return `${center[1].toFixed(5)}, ${center[0].toFixed(5)}`;
}
