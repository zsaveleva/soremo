import { useEffect, useState } from 'react';
import type { BuildingCard } from '../../api/types';
import { formatArea, formatDistance } from '../../lib/format';
import s from './ModelingProgress.module.css';

const STEP_MS = 1500;

/**
 * Экран ожидания моделирования (ТЗ 5.8) — единственная оркестрованная анимация продукта.
 * Строки появляются по времени заглушки; под каждой — данные здания, которые сейчас разбираются.
 */
export function ModelingProgress({ b, scenarios }: { b: BuildingCard; scenarios: number }) {
  const steps = [
    { title: 'Анализируем градостроительный контекст', detail: `Зона ${b.pzz_zone}, участок ${formatArea(b.area_site_m2)}${b.is_okn ? ', объект культурного наследия' : ''}` },
    { title: 'Оцениваем транспортную доступность', detail: `«${b.context.metro_name}», ${formatDistance(b.context.metro_dist_m)}; индекс ${b.context.transit_index} из 100` },
    { title: 'Подбираем функции', detail: `10 функций в каталоге, в отчёт попадут ${scenarios} с лучшей оценкой` },
    { title: 'Считаем экономику', detail: 'Капвложения, выручка и окупаемость по ставкам Петербурга 2026 года' },
  ];
  const [shown, setShown] = useState(1);
  useEffect(() => {
    if (shown >= steps.length) return;
    const t = window.setTimeout(() => setShown((n) => n + 1), STEP_MS);
    return () => window.clearTimeout(t);
  }, [shown, steps.length]);

  return (
    <div className={s.root} role="status" aria-live="polite">
      <p className={s.addr}>{b.address}</p>
      <h1 className={s.title}>Моделируем сценарии</h1>
      <ol className={s.steps}>
        {steps.slice(0, shown).map((st, i) => (
          <li key={st.title} className={s.step} data-done={i < shown - 1 || undefined}>
            <svg className={s.mark} viewBox="0 0 24 24" aria-hidden>
              <path className={s.markPath} d="M3 4h10v6h8v10H3z" />
            </svg>
            <span className={s.text}>
              <span className={s.stepTitle}>{st.title}</span>
              <span className={s.detail}>{st.detail}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className={s.note}>Расчёт занимает 3–8 секунд. Отчёт сохранится в кабинете, страницу можно закрыть.</p>
    </div>
  );
}
