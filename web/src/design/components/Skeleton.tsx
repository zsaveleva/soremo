import s from './Skeleton.module.css';

/** Заглушка на месте загружаемого контента. Без анимации: движение в продукте только одно (ТЗ 6.7). */
export function Skeleton({ width = '100%', height = 16, radius }: { width?: number | string; height?: number; radius?: number }) {
  return <span className={s.skeleton} style={{ width, height, borderRadius: radius }} aria-hidden />;
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <span className={s.text} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '62%' : '100%'} height={12} />
      ))}
    </span>
  );
}
