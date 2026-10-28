import { Link } from 'react-router-dom';
import s from './Logo.module.css';

/** Знак — футпринт здания, тот же, что в фавиконе, пустых состояниях и шапке PDF. */
export function Footprint({ size = 20, muted }: { size?: number; muted?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={s.mark}>
      <path
        d="M3 4h10v6h8v10H3z"
        fill={muted ? 'none' : '#B8402B'}
        fillOpacity={0.85}
        stroke={muted ? '#5C5A55' : '#141414'}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className={s.logo} aria-label="SOREMO CITY — на карту">
      <Footprint />
      <span className={s.word}>SOREMO CITY</span>
    </Link>
  );
}
