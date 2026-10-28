import type { ExpressionSpecification, FilterSpecification, LayerSpecification, Map as MlMap } from 'maplibre-gl';

export const SOURCE_ID = 'buildings';
export const HATCH_IMAGE = 'soremo-hatch';

// Цвета повторяют design/tokens.css: MapLibre не читает CSS-переменные.
export const MAP_COLORS = { brick: '#B8402B', ink: '#141414', paper: '#EFECE6' } as const;
const { brick: BRICK, ink: INK, paper: PAPER } = MAP_COLORS;

const isCluster: FilterSpecification = ['has', 'cluster'];
const isBase: FilterSpecification = ['all', ['!', ['has', 'cluster']], ['!=', ['get', 'source'], 'user']];
const isUser: FilterSpecification = ['all', ['!', ['has', 'cluster']], ['==', ['get', 'source'], 'user']];
const isBuilding: FilterSpecification = ['!', ['has', 'cluster']];

const selected: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];
const hovered: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false];

export const buildingLayers: LayerSpecification[] = [
  {
    id: 'buildings-fill',
    type: 'fill',
    source: SOURCE_ID,
    filter: isBase,
    paint: {
      'fill-color': BRICK,
      'fill-opacity': ['case', selected, 1, hovered, 0.9, 0.75],
    },
  },
  {
    id: 'buildings-hatch',
    type: 'fill',
    source: SOURCE_ID,
    filter: isUser,
    paint: { 'fill-pattern': HATCH_IMAGE, 'fill-opacity': ['case', selected, 1, 0.9] },
  },
  {
    id: 'buildings-outline',
    type: 'line',
    source: SOURCE_ID,
    filter: isBuilding,
    paint: {
      'line-color': INK,
      'line-width': ['case', selected, 3, ['get', 'is_demo'], 2, 1],
    },
  },
  {
    id: 'demo-label',
    type: 'symbol',
    source: SOURCE_ID,
    filter: ['all', isBuilding, ['get', 'is_demo']],
    minzoom: 13,
    layout: {
      'text-field': 'Пример отчёта',
      'text-font': ['Noto Sans Bold'],
      'text-size': 11,
      'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
      'text-radial-offset': 1.6,
      'text-allow-overlap': false,
    },
    paint: { 'text-color': INK, 'text-halo-color': PAPER, 'text-halo-width': 1.5 },
  },
  {
    id: 'clusters',
    type: 'circle',
    source: SOURCE_ID,
    filter: isCluster,
    paint: {
      'circle-color': BRICK,
      'circle-opacity': 0.85,
      'circle-stroke-color': INK,
      'circle-stroke-width': 1,
      'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 9, 10, 14, 50, 20, 150, 26],
    },
  },
  {
    id: 'cluster-count',
    type: 'symbol',
    source: SOURCE_ID,
    filter: isCluster,
    layout: {
      'text-field': ['to-string', ['get', 'count']],
      'text-font': ['Noto Sans Bold'],
      'text-size': 12,
      'text-allow-overlap': true,
    },
    paint: { 'text-color': PAPER },
  },
];

export const INTERACTIVE_LAYERS = ['buildings-fill', 'buildings-hatch'];

/** Диагональная штриховка кирпичом — объекты, добавленные пользователями. */
export function addHatchImage(map: MlMap) {
  const size = 8;
  const ratio = 2;
  const c = document.createElement('canvas');
  c.width = c.height = size * ratio;
  const ctx = c.getContext('2d')!;
  ctx.scale(ratio, ratio);
  ctx.fillStyle = 'rgba(184, 64, 43, 0.18)';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = BRICK;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-1, size + 1);
  ctx.lineTo(size + 1, -1);
  ctx.moveTo(-1, 1);
  ctx.lineTo(1, -1);
  ctx.moveTo(size - 1, size + 1);
  ctx.lineTo(size + 1, size - 1);
  ctx.stroke();
  const data = ctx.getImageData(0, 0, c.width, c.height);
  if (!map.hasImage(HATCH_IMAGE)) map.addImage(HATCH_IMAGE, data, { pixelRatio: ratio });
}
