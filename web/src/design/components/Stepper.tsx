import { useId } from 'react';
import s from './Stepper.module.css';

export type StepperOption<T> = { value: T; label: string; caption?: string; disabled?: boolean };

type Props<T extends string | number> = {
  legend: string;
  name: string;
  options: StepperOption<T>[];
  value: T;
  onChange: (v: T) => void;
};

/**
 * Группа крупных переключателей для конфигуратора пакета (ТЗ 5.6).
 * Недоступные сочетания показываются отключёнными, а не скрываются (ТЗ 7.5).
 */
export function Stepper<T extends string | number>({ legend, name, options, value, onChange }: Props<T>) {
  const id = useId();
  return (
    <fieldset className={s.group} aria-labelledby={id}>
      <legend id={id} className={s.legend}>
        {legend}
      </legend>
      <div className={s.row}>
        {options.map((o) => (
          <label
            key={String(o.value)}
            className={s.option}
            data-checked={o.value === value || undefined}
            data-disabled={o.disabled || undefined}
          >
            <input
              className={s.input}
              type="radio"
              name={name}
              value={String(o.value)}
              checked={o.value === value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
            />
            <span className={s.label}>{o.label}</span>
            {o.caption && <span className={s.caption}>{o.caption}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
