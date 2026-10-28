import { useLocation } from 'react-router-dom';
import { AuthLayout } from './AuthLayout';
import s from './forms.module.css';

type State = { email?: string; devUrl?: string; next?: string } | null;

export function CheckEmailPage() {
  const st = useLocation().state as State;
  return (
    <AuthLayout
      title="Проверьте почту"
      lead={
        <>
          Отправили ссылку для подтверждения на <strong>{st?.email ?? 'ваш email'}</strong>. Откройте её в течение 48 часов — после
          этого вы войдёте в кабинет и сможете выбрать пакет.
        </>
      }
    >
      <p className={s.alt} style={{ marginTop: 24 }}>
        Письма нет несколько минут — проверьте папку «Спам» или войдите ещё раз и запросите ссылку повторно.
      </p>
      {st?.devUrl && (
        <div className={s.devBox}>
          <span className={s.devLabel}>Письма пока не отправляются</span>
          <span>Почта на сервере не подключена, поэтому ссылка подтверждения показана здесь:</span>
          <a href={st.devUrl.replace(/^https?:\/\/[^/]+/, '') + (st.next ? `&next=${encodeURIComponent(st.next)}` : '')}>
            {st.devUrl}
          </a>
        </div>
      )}
    </AuthLayout>
  );
}
