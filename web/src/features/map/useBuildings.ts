import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { BBox, BuildingFunction, BuildingsResponse } from '../../api/types';

export const CLUSTER_ZOOM = 13;

export type ViewQuery = { bbox: BBox; zoomKey: number };

export type Filters = {
  years: [number, number];
  functions: BuildingFunction[];
  area: 'any' | 'lt2' | '2to10' | '10to30' | 'gt30';
  docs: 'any' | 'yes' | 'no';
  mine: boolean;
};

export const YEAR_MIN = 1920;
export const YEAR_MAX = 1991;

export const DEFAULT_FILTERS: Filters = { years: [YEAR_MIN, YEAR_MAX], functions: [], area: 'any', docs: 'any', mine: false };

const AREA: Record<Filters['area'], [number | null, number | null]> = {
  any: [null, null],
  lt2: [null, 2000],
  '2to10': [2000, 10000],
  '10to30': [10000, 30000],
  gt30: [30000, null],
};

export function activeFilterCount(f: Filters) {
  return (
    Number(f.years[0] !== YEAR_MIN || f.years[1] !== YEAR_MAX) +
    Number(f.functions.length > 0) +
    Number(f.area !== 'any') +
    Number(f.docs !== 'any') +
    Number(f.mine)
  );
}

export function filterParams(f: Filters) {
  const p = new URLSearchParams();
  if (f.years[0] !== YEAR_MIN) p.set('year_from', String(f.years[0]));
  if (f.years[1] !== YEAR_MAX) p.set('year_to', String(f.years[1]));
  if (f.functions.length) p.set('function', f.functions.join(','));
  const [lo, hi] = AREA[f.area];
  if (lo !== null) p.set('area_from', String(lo));
  if (hi !== null) p.set('area_to', String(hi));
  if (f.docs !== 'any') p.set('has_docs', f.docs === 'yes' ? 'true' : 'false');
  if (f.mine) p.set('mine', 'true');
  return p;
}

export function useBuildings(view: ViewQuery | null, filters: Filters) {
  const fp = filterParams(filters).toString();
  return useQuery({
    queryKey: ['buildings', view, fp],
    enabled: view !== null,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => {
      const v = view!;
      const params = new URLSearchParams(fp);
      params.set('bbox', v.bbox.map((n) => n.toFixed(5)).join(','));
      params.set('zoom', String(v.zoomKey));
      return api<BuildingsResponse>(`/buildings?${params}`, { signal });
    },
  });
}

/** Expands the visible bbox by 20% on each side so small pans need no refetch. */
export function padBBox([w, s, e, n]: BBox, ratio = 0.2): BBox {
  const dx = (e - w) * ratio;
  const dy = (n - s) * ratio;
  return [w - dx, s - dy, e + dx, n + dy];
}

export function contains(outer: BBox, inner: BBox) {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

/** Clusters depend on the integer zoom; footprints do not depend on zoom at all. */
export function zoomKeyOf(zoom: number) {
  return zoom < CLUSTER_ZOOM ? Math.floor(zoom) : CLUSTER_ZOOM;
}

export const CITY_BBOX: BBox = [29.42, 59.63, 30.76, 60.25];
