import s from './AccuracyMeter.module.css';

export type AccuracyLevel = 'low' | 'mid' | 'high';

const LEVELS: { level: AccuracyLevel; label: string; pct: number }[] = [
  { level: 'low', label: 'низкая', pct: 30 },
  { level: 'mid', label: 'средняя', pct: 60 },
  { level: 'high', label: 'высокая', pct: 85 },
];

const NEXT_STEP: Record<AccuracyLevel, string> = {
  low: 'Загрузите техобследование или экспертизу — точность вырастет до ≈85%.',
  mid: 'Загрузите техобследование или экспертизу — точность вырастет до ≈85%.',
  high: 'Отчёт уточнён по принятым документам. Это максимальная точность.',
};

type Props = {
  level: AccuracyLevel;
  /** Заменяет стандартную строку о следующем шаге, например «Документ на проверке до 2 рабочих дней». */
  hint?: string;
  compact?: boolean;
};

/** Единый индикатор точности (ТЗ 6.6): карточка объекта, отчёт, кабинет. */
export function AccuracyMeter({ level, hint, compact }: Props) {
  const idx = LEVELS.findIndex((l) => l.level === level);
  const current = LEVELS[idx]!;
  return (
    <div className={s.meter} data-compact={compact || undefined}>
      <div
        className={s.scale}
        role="meter"
        aria-label="Точность отчёта"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={current.pct}
        aria-valuetext={`${current.label}, около ${current.pct}%`}
      >
        {LEVELS.map((l, i) => (
          <div key={l.level} className={s.segment} data-level={l.level} data-filled={i <= idx || undefined}>
            <span className={s.bar} />
            <span className={s.label} data-current={i === idx || undefined}>
              {l.label} ≈{l.pct}%
            </span>
          </div>
        ))}
      </div>
      {!compact && <p className={s.hint}>{hint ?? NEXT_STEP[level]}</p>}
    </div>
  );
}
