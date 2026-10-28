// Builds public/map/style.json from the OpenFreeMap Positron style,
// recoloured to the SOREMO palette (paper background, muted roads, no POI).
// Run: node scripts/build-map-style.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const src = JSON.parse(readFileSync(new URL('./positron.source.json', import.meta.url)));

const c = {
  paper: '#EFECE6',
  land: '#ECE9E2',
  park: '#E3E3D8',
  wood: '#DEDFD3',
  water: '#CDD2D1',
  waterLine: '#BFC6C5',
  building: '#E4E0D8',
  buildingLine: '#D6D1C7',
  roadMinor: '#F6F4EF',
  roadMajor: '#FAF9F6',
  casing: '#DAD5CB',
  rail: '#CFCAC0',
  boundary: '#B9B4AA',
  label: '#5C5A55',
  labelStrong: '#2E2D2A',
};

const drop = /(shield|aeroway|airport|poi|housenumber|landcover_ice|landcover_glacier|ne2_shaded)/;

const layers = src.layers
  .filter((l) => !drop.test(l.id))
  .map((l) => {
    const p = { ...(l.paint || {}) };
    const id = l.id;
    if (l.type === 'background') p['background-color'] = c.paper;
    else if (id === 'park') p['fill-color'] = c.park;
    else if (id === 'landcover_wood') p['fill-color'] = c.wood;
    else if (id.startsWith('landuse')) p['fill-color'] = c.land;
    else if (id === 'water') p['fill-color'] = c.water;
    else if (id === 'waterway') p['line-color'] = c.waterLine;
    else if (id === 'building') {
      p['fill-color'] = c.building;
      p['fill-outline-color'] = c.buildingLine;
    } else if (id.includes('pier')) {
      if (l.type === 'fill') p['fill-color'] = c.paper;
      else p['line-color'] = c.paper;
    } else if (l.type === 'line' && /casing/.test(id)) p['line-color'] = c.casing;
    else if (l.type === 'line' && /(motorway|major)/.test(id)) p['line-color'] = c.roadMajor;
    else if (l.type === 'line' && /(minor|path)/.test(id)) p['line-color'] = c.roadMinor;
    else if (l.type === 'line' && /dashline/.test(id)) p['line-color'] = c.paper;
    else if (l.type === 'line' && /railway/.test(id)) p['line-color'] = c.rail;
    else if (l.type === 'line' && /boundary/.test(id)) p['line-color'] = c.boundary;
    else if (l.type === 'symbol') {
      const strong = /label_(city|town|state|country)/.test(id);
      p['text-color'] = strong ? c.labelStrong : c.label;
      p['text-halo-color'] = c.paper;
      p['text-halo-width'] = 1.2;
      p['text-halo-blur'] = 0;
    }
    const layout = { ...(l.layout || {}) };
    if (l.type === 'symbol' && layout['text-field']) {
      // Только русские подписи: исходный стиль выводит латиницу и оригинал в две строки.
      layout['text-field'] = ['coalesce', ['get', 'name:ru'], ['get', 'name']];
    }
    return { ...l, layout, paint: p };
  });

const sources = { openmaptiles: src.sources.openmaptiles };
const style = { ...src, name: 'SOREMO Paper', sources, layers };
writeFileSync(new URL('../public/map/style.json', import.meta.url), JSON.stringify(style));
console.log(`style.json: ${layers.length} layers`);
