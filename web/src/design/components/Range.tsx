import { useId } from 'react';
import s from './Range.module.css';

type Props = {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  /** Подписи под шкалой: только значения, которые помогают читать положение. */
  ticks?: number[];
  format?: (n: number) => string;
};

/** Диапазон из двух ползунков (год постройки, площадь). */
export function Range({ label, min, max, step = 1, value, onChange, ticks = [], format = String }: Props) {
  const id = useId();
  const [lo, hi] = value;
  const pct = (n: number) => ((n - min) / (max - min)) * 100;

  return (
    <div className={s.range} role="group" aria-labelledby={id}>
      <div className={s.head}>
        <span id={id} className={s.label}>
          {label}
        </span>
        <output className={s.value}>
          {format(lo)}–{format(hi)}
        </output>
      </div>
      <div className={s.track} style={{ '--lo': `${pct(lo)}%`, '--hi': `${pct(hi)}%` } as React.CSSProperties}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={lo}
          aria-label={`${label}: от`}
          aria-valuetext={format(lo)}
          onChange={(e) => onChange([Math.min(Number(e.target.value), hi), hi])}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={hi}
          aria-label={`${label}: до`}
          aria-valuetext={format(hi)}
          onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo)])}
        />
      </div>
      {ticks.length > 0 && (
        <div className={s.ticks} aria-hidden>
          {ticks.map((t) => (
            <span key={t} style={{ left: `${pct(t)}%` }}>
              {format(t)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
