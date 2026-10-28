import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, CircleAlert, X } from 'lucide-react';
import { Icon } from './Icon';
import s from './Toast.module.css';

export type ToastInput = {
  /** Называет результат: «Доступ открыт», «Не удалось сохранить: нет связи». */
  message: string;
  tone?: 'done' | 'error' | 'info';
  action?: { label: string; onClick: () => void };
};

type ToastItem = ToastInput & { id: number };

const Ctx = createContext<(t: ToastInput) => void>(() => {});

export function useToast() {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: ToastInput) => {
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-2), { ...t, id }]);
      // Тост с действием живёт дольше: его нужно успеть нажать.
      window.setTimeout(() => dismiss(id), t.action ? 10_000 : 5_000);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className={s.region} role="region" aria-label="Уведомления">
        <ul className={s.stack} aria-live="polite">
          {items.map((t) => (
            <li key={t.id}>
              <ToastView {...t} onDismiss={() => dismiss(t.id)} />
            </li>
          ))}
        </ul>
      </div>
    </Ctx.Provider>
  );
}

export function ToastView({ message, tone = 'info', action, onDismiss }: ToastInput & { onDismiss?: () => void }) {
  return (
    <div className={s.toast} data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'done' && <Icon as={Check} className={s.icon} />}
      {tone === 'error' && <Icon as={CircleAlert} className={s.icon} />}
      <span className={s.message}>{message}</span>
      {action && (
        <button
          type="button"
          className={s.action}
          onClick={() => {
            action.onClick();
            onDismiss?.();
          }}
        >
          {action.label}
        </button>
      )}
      {onDismiss && (
        <button type="button" className={s.close} aria-label="Скрыть уведомление" onClick={onDismiss}>
          <Icon as={X} size={16} />
        </button>
      )}
    </div>
  );
}
