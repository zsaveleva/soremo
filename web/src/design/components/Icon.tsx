import type { LucideIcon, LucideProps } from 'lucide-react';

/** Иконки lucide в одном размере и толщине штриха (ТЗ 6.5). */
export function Icon({ as: As, size = 18, ...rest }: { as: LucideIcon } & LucideProps) {
  return <As size={size} strokeWidth={1.75} aria-hidden focusable={false} {...rest} />;
}
