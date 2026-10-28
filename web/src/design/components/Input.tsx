import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { Icon } from './Icon';
import s from './Input.module.css';

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Единица справа от значения: «м²», «₽». */
  suffix?: ReactNode;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, suffix, ...rest }, ref) {
  if (!suffix) return <input ref={ref} className={[s.control, className].filter(Boolean).join(' ')} {...rest} />;
  return (
    <div className={s.affix}>
      <input ref={ref} className={[s.control, s.withSuffix, className].filter(Boolean).join(' ')} {...rest} />
      <span className={s.suffix} aria-hidden>
        {suffix}
      </span>
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={[s.control, s.textarea, className].filter(Boolean).join(' ')} {...rest} />;
  },
);

/** Нативный select ради доступности и мобильных пикеров, оформленный под систему. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <div className={s.selectWrap}>
      <select ref={ref} className={[s.control, s.select, className].filter(Boolean).join(' ')} {...rest}>
        {children}
      </select>
      <Icon as={ChevronDown} className={s.chevron} />
    </div>
  );
});
