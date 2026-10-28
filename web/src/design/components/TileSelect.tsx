import { useId } from 'react';
import { CircleAlert } from 'lucide-react';
import { Icon } from './Icon';
import s from './TileSelect.module.css';

export type Tile<T extends string> = { value: T; title: string; caption?: string };

type Props<T extends string> = {
  legend: string;
  name: string;
  options: Tile<T>[];
  value: T | undefined;
  onChange: (v: T) => void;
  columns?: 2 | 3 | 5;
  error?: string;
};

/** Крупные плитки вместо радио-кнопок (ТЗ 5.4). Внутри — нативные radio: стрелки и Tab работают как обычно. */
export function TileSelect<T extends string>({ legend, name, options, value, onChange, columns = 2, error }: Props<T>) {
  const errId = useId();
  return (
    <fieldset className={s.group} aria-describedby={error ? errId : undefined}>
      <legend className={s.legend}>{legend}</legend>
      <div className={s.grid} data-columns={columns}>
        {options.map((o) => (
          <label key={o.value} className={s.tile} data-checked={value === o.value || undefined}>
            <input
              className={s.input}
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span className={s.title}>{o.title}</span>
            {o.caption && <span className={s.caption}>{o.caption}</span>}
          </label>
        ))}
      </div>
      {error && (
        <p className={s.error} id={errId}>
          <Icon as={CircleAlert} size={16} />
          {error}
        </p>
      )}
    </fieldset>
  );
}
