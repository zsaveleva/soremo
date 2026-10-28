import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Button, Field, Input, TileSelect } from '../../design/components';
import { AuthLayout } from './AuthLayout';
import { SEGMENTS } from './segments';
import s from './forms.module.css';

const schema = z.object({
  email: z.string().trim().min(1, 'Введите email').email('Введите email в формате name@site.ru'),
  password: z.string().min(8, 'Пароль — не короче 8 символов').max(72, 'Пароль — не длиннее 72 символов'),
  type: z.enum(['individual', 'company'], { errorMap: () => ({ message: 'Выберите: физлицо или юрлицо' }) }),
  segment: z.enum(['owner', 'investor', 'consultant', 'government', 'other'], {
    errorMap: () => ({ message: 'Выберите, чем вы занимаетесь — от этого зависят подсказки в кабинете' }),
  }),
  company_name: z.string().max(200, 'Сократите название до 200 символов').optional(),
  phone: z
    .string()
    .regex(/^[+\d][\d\s()-]{6,20}$/, 'Укажите телефон цифрами, начиная с +7')
    .optional()
    .or(z.literal('')),
});

type Form = z.infer<typeof schema>;

export function SignupPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') ?? '';
  const {
    register,
    control,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(schema), mode: 'onTouched' });

  const onSubmit = handleSubmit(async (v) => {
    try {
      const r = await api<{ email: string; dev_verify_url?: string }>('/auth/signup', { method: 'POST', json: v });
      navigate('/check-email', { state: { email: r.email, devUrl: r.dev_verify_url, next } });
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        Object.entries(e.fields).forEach(([k, m]) => setError(k as keyof Form, { message: m }));
      } else {
        setError('root', { message: e instanceof ApiError ? e.message : 'Не удалось зарегистрироваться: нет связи' });
      }
    }
  });

  const type = watch('type');

  return (
    <AuthLayout
      title="Регистрация"
      lead="Карта и три примера отчётов открыты и без регистрации. Аккаунт нужен, чтобы выбрать пакет, моделировать объекты и загружать документы."
    >
      <form className={s.form} onSubmit={onSubmit} noValidate>
        <Field label="Email" error={errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" {...register('email')} />}
        </Field>
        <Field label="Пароль" hint="Не короче 8 символов" error={errors.password?.message}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...register('password')} />}
        </Field>
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <TileSelect
              legend="Вы регистрируетесь как"
              name="type"
              value={field.value}
              onChange={field.onChange}
              error={errors.type?.message}
              options={[
                { value: 'individual', title: 'Физлицо', caption: 'Доступ и платежи на ваше имя' },
                { value: 'company', title: 'Юрлицо', caption: 'Компания, ИП или учреждение' },
              ]}
            />
          )}
        />
        <Controller
          control={control}
          name="segment"
          render={({ field }) => (
            <TileSelect
              legend="Чем вы занимаетесь"
              name="segment"
              columns={3}
              value={field.value}
              onChange={field.onChange}
              error={errors.segment?.message}
              options={SEGMENTS}
            />
          )}
        />
        <div className={s.row}>
          <Field label={type === 'individual' ? 'Место работы' : 'Название компании'} optional error={errors.company_name?.message}>
            {(p) => <Input {...p} autoComplete="organization" {...register('company_name')} />}
          </Field>
          <Field label="Телефон" optional hint="С кодом города или мобильный, начиная с +7" error={errors.phone?.message}>
            {(p) => <Input {...p} type="tel" autoComplete="tel" {...register('phone')} />}
          </Field>
        </div>
        {errors.root && <p className={s.formError} role="alert">{errors.root.message}</p>}
        <div className={s.actions}>
          <Button type="submit" variant="primary" size="lg" pending={isSubmitting} pendingLabel="Создаём аккаунт…">
            Зарегистрироваться
          </Button>
          <span className={s.alt}>
            Уже есть аккаунт? <Link to={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Войти</Link>
          </span>
        </div>
        <p className={s.terms}>
          SOREMO CITY не связывает инвесторов с собственниками и не оказывает услуг по реновации: сервис моделирует сценарии по
          открытым данным и вашим документам.
        </p>
      </form>
    </AuthLayout>
  );
}
