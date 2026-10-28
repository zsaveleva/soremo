import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError, type SessionPayload } from '../../api/client';
import { ButtonLink } from '../../design/components';
import { AuthLayout } from './AuthLayout';
import { useSession } from './session';
import s from './forms.module.css';

export function VerifyPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { signIn } = useSession();
  const [error, setError] = useState<string | null>(null);
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const token = params.get('token');
    if (!token) {
      setError('В ссылке нет кода подтверждения. Откройте ссылку из письма целиком.');
      return;
    }
    api<SessionPayload>('/auth/verify', { method: 'POST', json: { token } })
      .then((sess) => {
        signIn(sess);
        navigate(params.get('next') || '/account', { replace: true, state: { welcome: true } });
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Не удалось подтвердить email: нет связи'));
  }, [params, navigate, signIn]);

  return (
    <AuthLayout title={error ? 'Ссылка не сработала' : 'Подтверждаем email'}>
      {error ? (
        <div className={s.form}>
          <p className={s.formError} role="alert">
            {error}
          </p>
          <div className={s.actions}>
            <ButtonLink to="/login" variant="primary">
              Войти и запросить новую
            </ButtonLink>
            <Link to="/">К карте</Link>
          </div>
        </div>
      ) : (
        <p className={s.alt} style={{ marginTop: 24 }} aria-live="polite">
          Проверяем ссылку…
        </p>
      )}
    </AuthLayout>
  );
}
