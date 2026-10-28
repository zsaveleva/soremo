import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { MAP_LOCALE, baseStyle } from '../map/mapStyle';
import s from './PointPicker.module.css';

type Props = { value: [number, number] | null; onChange: (p: [number, number]) => void; flyTo?: [number, number] | null };

/** Карта с перетаскиваемой точкой: клик ставит точку, перетаскивание уточняет (ТЗ 5.10). */
export function PointPicker({ value, onChange, flyTo }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      style: baseStyle(),
      locale: MAP_LOCALE,
      center: [30.3158, 59.939],
      zoom: 11,
      minZoom: 9,
      maxBounds: [29.2, 59.55, 31.0, 60.35],
      attributionControl: { compact: true },
      dragRotate: false,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    m.on('click', (e) => cb.current([e.lngLat.lng, e.lngLat.lat]));
    m.on('load', () => {
      if (window.matchMedia('(max-width: 720px)').matches)
        el.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
    });
    map.current = m;
    return () => m.remove();
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !value) return;
    if (!marker.current) {
      const pin = document.createElement('div');
      pin.className = s.pin ?? '';
      pin.setAttribute('aria-label', 'Точка здания, перетащите для уточнения');
      pin.innerHTML =
        '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h10v6h8v10H3z" fill="#B8402B" fill-opacity=".85" stroke="#141414" stroke-width="1.5" stroke-linejoin="round"/></svg>';
      marker.current = new maplibregl.Marker({ element: pin, draggable: true }).setLngLat(value).addTo(m);
      marker.current.on('dragend', () => {
        const p = marker.current!.getLngLat();
        cb.current([p.lng, p.lat]);
      });
    } else marker.current.setLngLat(value);
  }, [value]);

  useEffect(() => {
    if (flyTo) map.current?.flyTo({ center: flyTo, zoom: 16.5, duration: 800 });
  }, [flyTo]);

  return (
    <div className={s.wrap}>
      <div ref={el} className={s.map} role="application" aria-label="Карта: нажмите, чтобы поставить точку здания" />
      {!value && <p className={s.hint}>Найдите адрес или нажмите на карту там, где стоит здание</p>}
    </div>
  );
}
