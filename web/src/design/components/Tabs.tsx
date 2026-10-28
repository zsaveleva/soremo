import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import s from './Tabs.module.css';

export type TabItem<T extends string> = { value: T; label: string; count?: number };

type Props<T extends string> = {
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  children: ReactNode;
};

/** Вкладки по шаблону WAI-ARIA: стрелки переключают, Tab уходит в панель. */
export function Tabs<T extends string>({ label, items, value, onChange, children }: Props<T>) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent, i: number) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + dir + items.length) % items.length;
    if (!dir && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    onChange(items[to]!.value);
    refs.current[to]?.focus();
  };

  return (
    <div>
      <div className={s.list} role="tablist" aria-label={label}>
        {items.map((t, i) => (
          <button
            key={t.value}
            ref={(el) => (refs.current[i] = el)}
            role="tab"
            type="button"
            id={`${base}-${t.value}`}
            aria-selected={t.value === value}
            aria-controls={`${base}-panel`}
            tabIndex={t.value === value ? 0 : -1}
            className={s.tab}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
            {t.count !== undefined && <span className={s.count}>{t.count}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${value}`} className={s.panel}>
        {children}
      </div>
    </div>
  );
}
