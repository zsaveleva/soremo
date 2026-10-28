import { useEffect, useState, type ReactNode } from 'react';
import s from './DocShell.module.css';

export type DocNavItem = { id: string; label: string; level?: 2 };

/** Раздел, который сейчас в верхней трети экрана, — для подсветки в навигации. */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join('|');
  useEffect(() => {
    if (!ids.length) return;
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    const obs = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: '0px 0px -65% 0px' },
    );
    els.forEach((e) => obs.observe(e));
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}

/** Документная раскладка: навигация 220 px слева и колонка 880 px (ТЗ 6.4). */
export function DocShell({ nav, navLabel, children }: { nav?: DocNavItem[]; navLabel?: string; children: ReactNode }) {
  const active = useActiveSection(nav?.map((n) => n.id) ?? []);
  return (
    <div className={s.shell} data-has-nav={nav ? true : undefined}>
      {nav && (
        <nav className={s.nav} aria-label={navLabel ?? 'Разделы'}>
          <ul>
            {nav.map((n) => (
              <li key={n.id}>
                <a href={`#${n.id}`} aria-current={active === n.id ? 'true' : undefined} data-level={n.level}>
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <div className={s.content}>{children}</div>
    </div>
  );
}

export function DocSection({ id, title, children, lead }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className={s.section} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className={s.h2}>
        {title}
      </h2>
      {lead && <p className={s.lead}>{lead}</p>}
      {children}
    </section>
  );
}
