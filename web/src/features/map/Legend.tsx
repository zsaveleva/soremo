import s from './Legend.module.css';

/** Легенда карты: три вида объектов (ТЗ 5.1). Образцы — те же цвета, что у слоёв. */
export function Legend() {
  return (
    <ul className={s.legend} aria-label="Обозначения на карте">
      <li>
        <Swatch kind="base" />
        Нежилое здание 1920–1991 гг.
      </li>
      <li>
        <Swatch kind="demo" />
        Пример отчёта, открыт без регистрации
      </li>
      <li>
        <Swatch kind="user" />
        Добавлено пользователем
      </li>
    </ul>
  );
}

export function Swatch({ kind }: { kind: 'base' | 'demo' | 'user' }) {
  return (
    <svg className={s.swatch} viewBox="0 0 20 14" aria-hidden>
      <defs>
        <pattern id="legend-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="4" fill="rgba(184,64,43,0.18)" />
          <line x1="0" y1="0" x2="0" y2="4" stroke="#B8402B" strokeWidth="1.6" />
        </pattern>
      </defs>
      <path
        d="M1.5 1.5h11v4h6v7h-17z"
        fill={kind === 'user' ? 'url(#legend-hatch)' : '#B8402B'}
        fillOpacity={kind === 'user' ? 1 : 0.75}
        stroke="#141414"
        strokeWidth={kind === 'demo' ? 2 : 1}
        strokeLinejoin="round"
      />
    </svg>
  );
}
