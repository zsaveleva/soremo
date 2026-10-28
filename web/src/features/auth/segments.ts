import type { Segment } from './session';

export const SEGMENTS: { value: Segment; title: string; caption: string }[] = [
  { value: 'owner', title: 'Собственник', caption: 'Владею зданием или управляю им' },
  { value: 'investor', title: 'Инвестор', caption: 'Ищу объекты для вложений' },
  { value: 'consultant', title: 'Консалтинг', caption: 'Бюро, девелоперская аналитика' },
  { value: 'government', title: 'Госструктура', caption: 'Комитет, ГУП, учреждение' },
  { value: 'other', title: 'Другое', caption: 'Банк, исследователь, студент' },
];
