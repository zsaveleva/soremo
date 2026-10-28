import { useId, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { Icon } from './Icon';
import s from './Field.module.css';

export type FieldRenderProps = { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string };

type Props = {
  label: ReactNode;
  /** Пометка «необязательно» вместо звёздочек у обязательных полей. */
  optional?: boolean;
  hint?: ReactNode;
  error?: string;
  children: (p: FieldRenderProps) => ReactNode;
};

/** Подпись, подсказка и ошибка вокруг любого контрола. */
export function Field({ label, optional, hint, error, children }: Props) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={s.field}>
      <label className={s.label} htmlFor={id}>
        {label}
        {optional && <span className={s.optional}>необязательно</span>}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {error && (
        <p className={s.error} id={errorId}>
          <Icon as={CircleAlert} size={16} />
          {error}
        </p>
      )}
      {hint && !error && (
        <p className={s.hint} id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}
