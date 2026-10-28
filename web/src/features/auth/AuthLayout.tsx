import type { ReactNode } from 'react';
import { Logo } from '../../design/Logo';
import { IS_STATIC, STATIC_MESSAGE } from '../../api/static';
import s from './AuthLayout.module.css';

/** Одна колонка формы; слева на десктопе — статичный фрагмент карты (ТЗ 5.4). */
export function AuthLayout({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <div className={s.layout}>
      <div className={s.map} aria-hidden>
        <img src={`${import.meta.env.BASE_URL}map/fragment.jpg`} alt="" width={900} height={1200} />
        <p className={s.caption}>Нарвская застава: корпуса фабрики «Скороход» и соседние нежилые здания</p>
      </div>
      <main className={s.main}>
        <div className={s.top}>
          <Logo />
        </div>
        <div className={s.form}>
          <h1 className={s.title}>{title}</h1>
          {lead && <div className={s.lead}>{lead}</div>}
          {IS_STATIC && (
            <p className={s.static} role="note">
              {STATIC_MESSAGE}
            </p>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
