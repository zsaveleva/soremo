import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type MapGeoJSONFeature } from 'maplibre-gl';
import type { BBox, BuildingFeatureProps, ClusterProps } from '../../api/types';
import { baseStyle } from './mapStyle';
import { INTERACTIVE_LAYERS, SOURCE_ID, addHatchImage, buildingLayers } from './buildingLayers';
import { contains, padBBox, useBuildings, zoomKeyOf, type Filters, type ViewQuery } from './useBuildings';
import styles from './BuildingMap.module.css';

const SPB_CENTER: [number, number] = [30.3158, 59.939];
const SPB_BOUNDS: [number, number, number, number] = [29.2, 59.55, 31.0, 60.35];

// Вид карты хранится в хэше (#zoom/lat/lon), чтобы ссылка открывала тот же фрагмент.
function readView(): { center: [number, number]; zoom: number } {
  const [z, lat, lon] = window.location.hash.slice(1).split('/').map(Number);
  if (z && lat && lon) return { center: [lon, lat], zoom: z };
  return { center: SPB_CENTER, zoom: 11 };
}

function writeView(map: maplibregl.Map) {
  const c = map.getCenter();
  const hash = `#${map.getZoom().toFixed(2)}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`;
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + hash);
}

type Hover = { x: number; y: number; address: string } | null;

export type MapHandle = {
  /** Перелёт к объекту: на зум, где виден футпринт. */
  focus: (center: [number, number]) => void;
};

type Props = {
  filters: Filters;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCount?: (n: number) => void;
  /** Отступы под открытую панель или нижний лист, чтобы выбранный объект не прятался за ними. */
  inset?: { right?: number; bottom?: number };
};

export const BuildingMap = forwardRef<MapHandle, Props>(function BuildingMap(
  { filters, selectedId, onSelect, onCount, inset = {} },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [view, setView] = useState<ViewQuery | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [hover, setHover] = useState<Hover>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const insetRef = useRef(inset);
  insetRef.current = inset;

  const { data } = useBuildings(view, filters);

  useImperativeHandle(ref, () => ({
    focus(center) {
      const map = mapRef.current;
      if (!map) return;
      map.flyTo({
        center,
        zoom: Math.max(map.getZoom(), 15.5),
        padding: { right: insetRef.current.right ?? 0, bottom: insetRef.current.bottom ?? 0, top: 0, left: 0 },
        duration: 900,
        essential: false,
      });
    },
  }));

  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: baseStyle(),
      ...readView(),
      minZoom: 9,
      maxZoom: 18,
      maxBounds: SPB_BOUNDS,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.enable();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    mapRef.current = map;

    let fetched: ViewQuery | null = null;
    let timer: number | undefined;
    const requestView = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const b = map.getBounds();
        const visible: BBox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
        const zoomKey = zoomKeyOf(map.getZoom());
        if (fetched && fetched.zoomKey === zoomKey && contains(fetched.bbox, visible)) return;
        fetched = { bbox: padBBox(visible), zoomKey };
        setView(fetched);
      }, 300);
    };

    map.on('load', () => {
      addHatchImage(map);
      map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      buildingLayers.forEach((l) => map.addLayer(l));
      setLoaded(true);
      requestView();
    });
    map.on('moveend', requestView);
    map.on('moveend', () => writeView(map));
    // Состояние для e2e-тестов и скриншотов: idle — тайлы и данные отрисованы.
    map.on('idle', () => container.current && (container.current.dataset.mapState = 'idle'));
    map.on('dataloading', () => container.current && (container.current.dataset.mapState = 'loading'));

    let hoveredId: string | number | undefined;
    const clearHover = () => {
      if (hoveredId !== undefined) map.setFeatureState({ source: SOURCE_ID, id: hoveredId }, { hover: false });
      hoveredId = undefined;
      map.getCanvas().style.cursor = '';
      setHover(null);
    };
    map.on('mousemove', INTERACTIVE_LAYERS, (e) => {
      const f = e.features?.[0] as MapGeoJSONFeature | undefined;
      if (!f) return;
      if (hoveredId !== f.id) {
        clearHover();
        hoveredId = f.id;
        map.setFeatureState({ source: SOURCE_ID, id: f.id }, { hover: true });
      }
      map.getCanvas().style.cursor = 'pointer';
      setHover({ x: e.point.x, y: e.point.y, address: (f.properties as BuildingFeatureProps).address });
    });
    map.on('mouseleave', INTERACTIVE_LAYERS, clearHover);
    map.on('mouseenter', 'clusters', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'clusters', () => (map.getCanvas().style.cursor = ''));

    map.on('click', 'clusters', (e) => {
      const f = e.features?.[0];
      if (f?.geometry.type !== 'Point') return;
      map.easeTo({ center: f.geometry.coordinates as [number, number], zoom: Math.min(map.getZoom() + 2, 15), duration: 400 });
    });
    map.on('click', INTERACTIVE_LAYERS, (e) => {
      const id = e.features?.[0]?.id;
      if (typeof id === 'number') onSelectRef.current(id);
    });

    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!loaded || !data) return;
    (mapRef.current?.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(data);
    container.current!.dataset.mapState = 'loading';
    container.current!.dataset.objects = String(data.features.length);
    onCount?.(
      data.features.reduce((n, f) => n + ((f.properties as ClusterProps).cluster ? (f.properties as ClusterProps).count : 1), 0),
    );
  }, [data, loaded, onCount]);

  // Выделение выбранного объекта; feature-state переживает обновление данных источника.
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map || selectedId === null) return;
    map.setFeatureState({ source: SOURCE_ID, id: selectedId }, { selected: true });
    return () => {
      // При уходе со страницы карта удаляется раньше этой очистки — тогда снимать выделение не с чего.
      if (mapRef.current === map && map.getSource(SOURCE_ID)) map.setFeatureState({ source: SOURCE_ID, id: selectedId }, { selected: false });
    };
  }, [selectedId, loaded, data]);

  return (
    <div className={styles.root}>
      <div ref={container} className={styles.map} aria-label="Карта объектов. Список объектов доступен по кнопке «Списком»" role="region" />
      {hover && (
        <div className={styles.hover} style={{ left: hover.x, top: hover.y }} role="tooltip">
          {hover.address}
        </div>
      )}
    </div>
  );
});
