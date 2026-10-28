import type { StyleSpecification } from 'maplibre-gl';

const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

// Fallback when vector tiles are unavailable: desaturated OSM raster tiles
// warmed towards the paper colour.
const rasterStyle: StyleSpecification = {
  version: 8,
  glyphs: GLYPHS,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© участники OpenStreetMap',
    },
  },
  layers: [
    { id: 'paper', type: 'background', paint: { 'background-color': '#EFECE6' } },
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      paint: { 'raster-saturation': -1, 'raster-contrast': -0.25, 'raster-brightness-min': 0.18, 'raster-opacity': 0.85 },
    },
  ],
};

export function baseStyle(): string | StyleSpecification {
  // MapLibre нужен абсолютный адрес; BASE_URL учитывает подкаталог на GitHub Pages.
  return import.meta.env.VITE_MAP_BASE === 'raster' ? rasterStyle : new URL(`${import.meta.env.BASE_URL}map/style.json`, window.location.href).href;
}
