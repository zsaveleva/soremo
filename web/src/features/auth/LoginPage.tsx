import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError, type SessionPayload } from '../../api/client';
import { Button, Field, Input } from '../../design/components';
import { AuthLayout } from './AuthLayout';
import { useSession } from './session';
import { DEMO_EMAIL, DEMO_PASSWORD, IS_STATIC } from '../../api/static';
import s from './forms.module.css';

const schema = z.object({
  email: z.string().trim().min(1, 'Введите email').email('Введите email в формате name@site.ru'),
  password: z.string().min(1, 'Введите пароль'),
});
type Form = z.infer<typeof schema>;

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { signIn } = useSession();
  const [unverified, setUnverified] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    // В демо без сервера работает один аккаунт — поля заполнены, чтобы войти одним нажатием.
    defaultValues: IS_STATIC ? { email: DEMO_EMAIL, password: DEMO_PASSWORD } : undefined,
  });

  const onSubmit = handleSubmit(async (v) => {
    setUnverified(null);
    try {
      const sess = await api<SessionPayload>('/auth/login', { method: 'POST', json: v });
      signIn(sess);
      navigate(params.get('next') || (sess.user.role === 'admin' ? '/admin' : '/account'), { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'email_not_verified') setUnverified(e.message);
      else if (e instanceof ApiError && e.fields.password) setError('password', { message: e.fields.password });
      else setError('root', { message: e instanceof ApiError ? e.message : 'Не удалось войти: нет связи' });
    }
  });

  const resend = async () => {
    const r = await api<{ dev_verify_url?: string }>('/auth/resend', { method: 'POST', json: { email: getValues('email') } });
    navigate('/check-email', { state: { email: getValues('email'), devUrl: r.dev_verify_url } });
  };

  return (
    <AuthLayout title="Вход">
      <form className={s.form} onSubmit={onSubmit} noValidate>
        <Field label="Email" error={errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" {...register('email')} />}
        </Field>
        <Field label="Пароль" error={errors.password?.message}>
          {(p) => <Input {...p} type="password" autoComplete="current-password" {...register('password')} />}
        </Field>
        {unverified && (
          <div className={s.formError} role="alert">
            <p>{unverified}</p>
            <div>
              <Button size="sm" onClick={resend}>
                Отправить ссылку ещё раз
              </Button>
            </div>
          </div>
        )}
        {errors.root && <p className={s.formError} role="alert">{errors.root.message}</p>}
        <div className={s.actions}>
          <Button type="submit" variant="primary" size="lg" pending={isSubmitting} pendingLabel="Входим…">
            Войти
          </Button>
          <span className={s.alt}>
            Нет аккаунта? <Link to={`/signup${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`}>Зарегистрироваться</Link>
          </span>
        </div>
      </form>
    </AuthLayout>
  );
}
