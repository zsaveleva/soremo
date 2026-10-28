import type { BuildingContext } from '../api/types';
import { formatDistance, plural } from './format';

// Пояснения к контекстным метрикам (ТЗ 5.3): что значение означает для новой функции здания.

export function metroCaption(distM: number) {
  const min = Math.max(1, Math.round(distM / 80));
  if (distM <= 1200) return `${min} ${plural(min, 'минута', 'минуты', 'минут')} пешком`;
  return 'Пешком далеко: нужен наземный транспорт';
}

export function transitCaption(v: number) {
  if (v >= 70) return 'Метро рядом: функция может рассчитывать на посетителей со всего города';
  if (v >= 40) return 'Метро в 15–25 минутах пешком: для городской функции нужен свой повод приезжать';
  return 'Без автомобиля или автобуса не добраться: подходит для производства и складов';
}

export function socialCaption(n: number) {
  if (n >= 20) return 'Школы, детсады, поликлиники рядом — район живой, есть спрос на услуги';
  if (n >= 6) return 'Социальные объекты есть, но немного: район смешанный';
  return 'Жилья и социальных объектов рядом почти нет: промышленная зона';
}

export function commercialCaption(v: number) {
  if (v >= 60) return 'Много магазинов и кафе: на первых этажах будет поток';
  if (v >= 25) return 'Торговля есть, но первые этажи потребуют своего якоря';
  return 'Торговли рядом нет: розница на первом этаже рискованна';
}

export function businessCaption(v: number) {
  if (v >= 50) return 'Офисов вокруг много: офисная функция встраивается в сложившийся спрос';
  if (v >= 20) return 'Офисы рядом есть; крупный офисный проект создаст новый спрос сам';
  return 'Офисов рядом почти нет: деловая функция здесь не очевидна';
}

export function contextRows(c: BuildingContext) {
  return [
    { label: 'Ближайшее метро', value: `«${c.metro_name}», ${formatDistance(c.metro_dist_m)}`, caption: metroCaption(c.metro_dist_m) },
    { label: 'Транспортная доступность', value: `${c.transit_index} из 100`, caption: transitCaption(c.transit_index) },
    {
      label: 'Социальная инфраструктура в 500 м',
      value: `${c.social_500m} ${plural(c.social_500m, 'объект', 'объекта', 'объектов')}`,
      caption: socialCaption(c.social_500m),
    },
    { label: 'Коммерческая плотность', value: `${c.commercial_density} из 100`, caption: commercialCaption(c.commercial_density) },
    { label: 'Деловая активность', value: `${c.business_activity} из 100`, caption: businessCaption(c.business_activity) },
  ];
}
