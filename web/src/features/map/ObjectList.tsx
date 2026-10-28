import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { BuildingFeatureProps, BuildingsResponse } from '../../api/types';
import { Input, SkeletonText } from '../../design/components';
import { FUNCTION_LABEL } from '../../lib/labels';
import { formatArea } from '../../lib/format';
import { CITY_BBOX, filterParams, type Filters } from './useBuildings';
import s from './ObjectList.module.css';

/** Текстовая альтернатива карте (ТЗ 6.8): все объекты с учётом фильтров, списком. */
export function ObjectList({ filters, onPick }: { filters: Filters; onPick: (id: number, center?: [number, number]) => void }) {
  const [q, setQ] = useState('');
  const fp = filterParams(filters);
  fp.set('bbox', CITY_BBOX.join(','));
  fp.set('zoom', '14');
  const { data } = useQuery({
    queryKey: ['buildings-list', fp.toString()],
    queryFn: ({ signal }) => api<BuildingsResponse>(`/buildings?${fp}`, { signal }),
  });

  const rows = useMemo(() => {
    const all = (data?.features ?? []).map((f) => {
      const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0]! : [];
      const c: [number, number] = [0, 0];
      for (const [lon = 0, lat = 0] of ring) {
        c[0] += lon / ring.length;
        c[1] += lat / ring.length;
      }
      return { id: f.id as number, p: f.properties as BuildingFeatureProps, center: c };
    });
    const needle = q.trim().toLowerCase();
    return all
      .filter((r) => !needle || r.p.address.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.p.is_demo) - Number(a.p.is_demo) || a.p.address.localeCompare(b.p.address, 'ru'));
  }, [data, q]);

  return (
    <div className={s.root}>
      <Input aria-label="Фильтр списка по адресу" placeholder="Улица или номер дома" value={q} onChange={(e) => setQ(e.target.value)} />
      {!data ? (
        <SkeletonText lines={8} />
      ) : (
        <>
          <p className={s.count}>Объектов: {rows.length}</p>
          <ul className={s.list}>
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" className={s.item} onClick={() => onPick(r.id, r.center)}>
                  <span className={s.addr}>{r.p.address}</span>
                  <span className={s.meta}>
                    {FUNCTION_LABEL[r.p.original_function]}, {r.p.year_built}, {formatArea(r.p.area_total_m2)}
                    {r.p.is_demo ? '. Пример отчёта' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
