import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import s from './Modal.module.css';

type Props = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
};

/** Нативный <dialog>: фокус, Esc и инертный фон браузер обеспечивает сам. */
export function Modal({ open, onClose, title, children, footer, size = 'md' }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={s.dialog}
      data-size={size}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      {open && (
        <div className={s.inner}>
          <div className={s.head}>
            <h2 id={titleId} className={s.title}>
              {title}
            </h2>
            <Button variant="ghost" size="sm" iconOnly icon={X} aria-label="Закрыть" onClick={onClose} />
          </div>
          <div className={s.body}>{children}</div>
          {footer && <div className={s.footer}>{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
