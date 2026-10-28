import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Icon } from './Icon';
import s from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm' | 'lg';

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  /** Иконка без подписи: обязателен aria-label. */
  iconOnly?: boolean;
  block?: boolean;
};

export function buttonClass({ variant = 'secondary', size = 'md', iconOnly, block }: Common, extra?: string) {
  return [s.button, s[variant], s[size], iconOnly && s.iconOnly, block && s.block, extra].filter(Boolean).join(' ');
}

type ButtonProps = Common &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    /** Действие выполняется: кнопка блокируется, подпись меняется на pendingLabel. */
    pending?: boolean;
    pendingLabel?: ReactNode;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, icon, iconOnly, block, pending, pendingLabel, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass({ variant, size, iconOnly, block }, className)}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...rest}
    >
      {icon && <Icon as={icon} />}
      {!iconOnly && <span>{pending && pendingLabel ? pendingLabel : children}</span>}
    </button>
  );
});

export function ButtonLink({
  variant,
  size,
  icon,
  iconOnly,
  block,
  className,
  children,
  ...rest
}: Common & LinkProps) {
  return (
    <Link className={buttonClass({ variant, size, iconOnly, block }, className)} {...rest}>
      {icon && <Icon as={icon} />}
      {!iconOnly && <span>{children}</span>}
    </Link>
  );
}
