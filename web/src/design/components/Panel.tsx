import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronUp, X } from 'lucide-react';
import { Button } from './Button';
import s from './Panel.module.css';

type Props = {
  title?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  labelledBy?: string;
};

/** Боковая панель над картой (десктоп). На узких экранах превращается в BottomSheet. */
export function Panel({ title, onClose, children, footer, labelledBy }: Props) {
  return (
    <aside className={s.panel} aria-labelledby={labelledBy}>
      {(title || onClose) && (
        <div className={s.head}>
          <div className={s.title}>{title}</div>
          {onClose && <Button variant="ghost" size="sm" iconOnly icon={X} aria-label="Закрыть панель" onClick={onClose} />}
        </div>
      )}
      <div className={s.body}>{children}</div>
      {footer && <div className={s.footer}>{footer}</div>}
    </aside>
  );
}

/** Нижний лист для мобильного: свёрнут до шапки или раскрыт почти на весь экран. */
export function BottomSheet({ title, onClose, children, footer, labelledBy }: Props) {
  const [expanded, setExpanded] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!expanded) body.current?.scrollTo({ top: 0 });
  }, [expanded]);

  return (
    <aside className={s.sheet} data-expanded={expanded || undefined} aria-labelledby={labelledBy}>
      <button
        type="button"
        className={s.handle}
        aria-expanded={expanded}
        aria-label={expanded ? 'Свернуть карточку' : 'Развернуть карточку'}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={s.grip} />
        <ChevronUp size={16} strokeWidth={1.75} aria-hidden className={s.chev} />
      </button>
      <div className={s.head}>
        <div className={s.title}>{title}</div>
        {onClose && <Button variant="ghost" size="sm" iconOnly icon={X} aria-label="Закрыть карточку" onClick={onClose} />}
      </div>
      <div ref={body} className={s.body}>
        {children}
      </div>
      {footer && <div className={s.footer}>{footer}</div>}
    </aside>
  );
}
