import s from './Badge.module.css';

export type BadgeTone = 'pending' | 'accepted' | 'rejected' | 'neutral' | 'draft';

/** Статус: цветной квадрат-«футпринт» и подпись. Цвет никогда не единственный носитель смысла. */
export function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={s.badge} data-tone={tone}>
      <span className={s.mark} aria-hidden />
      {children}
    </span>
  );
}
