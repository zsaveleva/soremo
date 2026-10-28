import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { TopBar } from '../../app/TopBar';
import { api, ApiError } from '../../api/client';
import { Button, ButtonLink, Field, Icon, Input } from '../../design/components';
import { formatMonths, formatObjects, formatRub } from '../../lib/format';
import { useSession } from '../auth/session';
import type { Package } from './usePackages';
import s from './CheckoutPage.module.css';

const digits = (v: string) => v.replace(/\D/g, '');

const schema = z.object({
  number: z.string().refine((v) => digits(v).length === 16, 'Введите 16 цифр номера карты'),
  expiry: z.string().regex(/^(0[1-9]|1[0-2])\/\d{2}$/, 'Укажите срок в формате ММ/ГГ'),
  cvc: z.string().regex(/^\d{3}$/, 'Три цифры с обратной стороны карты'),
  holder: z.string().trim().min(2, 'Укажите имя латиницей, как на карте'),
});
type Form = z.infer<typeof schema>;

export function CheckoutPage() {
  const { paymentId } = useParams();
  const pkg = (useLocation().state as { pkg?: Package } | null)?.pkg;
  const navigate = useNavigate();
  const { reload } = useSession();
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(schema), mode: 'onTouched' });

  const onSubmit = handleSubmit(async (card) => {
    try {
      await api(`/payments/${paymentId}/confirm`, { method: 'POST', json: { card_mock: card } });
      reload();
      navigate('/checkout/done', { replace: true, state: { pkg } });
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length)
        Object.entries(e.fields).forEach(([k, m]) => setError(k as keyof Form, { message: m }));
      else setError('root', { message: e instanceof ApiError ? e.message : 'Платёж не прошёл: нет связи. Деньги не списаны.' });
    }
  });

  if (!pkg)
    return (
      <>
        <TopBar />
        <main className={s.page}>
          <h1 className={s.title}>Оплата</h1>
          <p className={s.lead}>Сессия оплаты устарела. Выберите пакет ещё раз.</p>
          <ButtonLink to="/pricing" variant="primary">
            К пакетам
          </ButtonLink>
        </main>
      </>
    );

  return (
    <>
      <TopBar />
      <main className={s.page}>
        <h1 className={s.title}>Оплата</h1>
        <p className={s.lead}>
          Пакет на {formatObjects(pkg.objects_limit)}, {formatMonths(pkg.months)}. Доступ откроется сразу после оплаты.
        </p>
        <form className={s.form} onSubmit={onSubmit} noValidate>
          <Field label="Номер карты" error={errors.number?.message}>
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                autoComplete="cc-number"
                placeholder="0000 0000 0000 0000"
                {...register('number', {
                  onChange: (e) =>
                    setValue(
                      'number',
                      digits(e.target.value)
                        .slice(0, 16)
                        .replace(/(\d{4})(?=\d)/g, '$1 '),
                    ),
                })}
              />
            )}
          </Field>
          <div className={s.row}>
            <Field label="Срок действия" error={errors.expiry?.message}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  autoComplete="cc-exp"
                  placeholder="ММ/ГГ"
                  {...register('expiry', {
                    onChange: (e) => {
                      const d = digits(e.target.value).slice(0, 4);
                      setValue('expiry', d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
                    },
                  })}
                />
              )}
            </Field>
            <Field label="CVC" error={errors.cvc?.message}>
              {(p) => <Input {...p} inputMode="numeric" autoComplete="cc-csc" maxLength={3} {...register('cvc')} />}
            </Field>
          </div>
          <Field label="Имя на карте" hint="Латиницей, как напечатано на карте" error={errors.holder?.message}>
            {(p) => <Input {...p} autoComplete="cc-name" {...register('holder')} />}
          </Field>
          {errors.root && (
            <p className={s.formError} role="alert">
              {errors.root.message}
            </p>
          )}
          <Button type="submit" variant="primary" size="lg" block pending={isSubmitting} pendingLabel="Проводим платёж…">
            Оплатить {formatRub(pkg.price_rub)}
          </Button>
          <p className={s.note}>
            <Icon as={Lock} size={16} />
            Демо-версия: оплата имитируется, деньги не списываются. Подойдёт любая карта с корректным номером, например
            4242 4242 4242 4242; карта 4000 0000 0000 0002 показывает отказ банка.
          </p>
        </form>
      </main>
    </>
  );
}

export function CheckoutDonePage() {
  const pkg = (useLocation().state as { pkg?: Package } | null)?.pkg;
  const { access } = useSession();
  return (
    <>
      <TopBar />
      <main className={s.page}>
        <h1 className={s.title}>Доступ открыт</h1>
        <p className={s.lead}>
          {pkg ? `Пакет на ${formatObjects(pkg.objects_limit)}` : 'Пакет'}
          {access ? ` действует до ${new Date(access.ends_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}.
          Выберите объект на карте и нажмите «Смоделировать сценарии».
        </p>
        <div className={s.actions}>
          <ButtonLink to="/" variant="primary" size="lg">
            К карте
          </ButtonLink>
          <ButtonLink to="/account" variant="ghost" size="lg">
            В кабинет
          </ButtonLink>
        </div>
      </main>
    </>
  );
}
