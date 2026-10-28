import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { TopBar } from '../../app/TopBar';
import { Button, ButtonLink, Field, Input, Select, Textarea } from '../../design/components';
import { Footprint } from '../../design/Logo';
import { FUNCTION_LABEL } from '../../lib/labels';
import { useSession } from '../auth/session';
import { PointPicker } from './PointPicker';
import s from './AddObjectPage.module.css';

const num = (msg: string) =>
  z
    .string()
    .trim()
    .min(1, msg)
    .transform((v) => Number(v.replace(/\s/g, '').replace(',', '.')))
    .refine((v) => Number.isFinite(v), msg);

const schema = z.object({
  address: z.string().trim().min(5, 'Введите адрес полностью: улица и номер дома'),
  year_built: num('Укажите год постройки').refine((v) => v >= 1920 && v <= 1991, 'Сервис работает со зданиями 1920–1991 годов'),
  area_total_m2: num('Укажите общую площадь').refine((v) => v >= 100, 'Площадь — от 100 м²'),
  floors: num('Укажите этажность').refine((v) => Number.isInteger(v) && v >= 1 && v <= 40, 'Этажность — целое число от 1 до 40'),
  original_function: z.string().min(1, 'Выберите исходное назначение'),
  comment: z.string().max(2000).optional(),
});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

type GeoHit = { address: string; center: [number, number] };

export function AddObjectPage() {
  const { user, loading } = useSession();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const [point, setPoint] = useState<[number, number] | null>(null);
  const [fly, setFly] = useState<[number, number] | null>(null);
  const [pointError, setPointError] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { address: params.get('address') ?? '', original_function: '' },
  });

  const address = watch('address');
  const [q, setQ] = useState(address);
  useEffect(() => {
    const t = window.setTimeout(() => setQ(address), 500);
    return () => window.clearTimeout(t);
  }, [address]);
  const geo = useQuery({
    queryKey: ['geocode', q],
    enabled: q.trim().length >= 5 && !point,
    retry: false,
    staleTime: Infinity,
    queryFn: () => api<GeoHit[]>(`/geocode?q=${encodeURIComponent(q.trim())}`),
  });

  if (!loading && !user) return <Navigate to="/login?next=/objects/new" replace />;

  const onSubmit = handleSubmit(async (v) => {
    if (!point) {
      setPointError(true);
      return;
    }
    try {
      await api('/buildings', { method: 'POST', json: { ...v, lon: point[0], lat: point[1] } });
      void qc.invalidateQueries({ queryKey: ['my-object-requests'] });
      setDone(v.address);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length)
        Object.entries(e.fields).forEach(([k, m]) => (k === 'lon' || k === 'lat' ? setPointError(true) : setError(k as keyof FormIn, { message: m })));
      else setError('root', { message: e instanceof ApiError ? e.message : 'Не удалось отправить заявку: нет связи' });
    }
  });

  if (done)
    return (
      <>
        <TopBar />
        <main className={s.done}>
          <Footprint size={40} />
          <h1 className={s.title}>Заявка принята</h1>
          <p className={s.lead}>
            Объект {done} появится на карте после проверки — обычно в течение 2 рабочих дней. Решение придёт в кабинет, статус заявки
            виден в разделе «Мои объекты».
          </p>
          <div className={s.actions}>
            <ButtonLink to="/account?tab=objects" variant="primary">
              Мои объекты
            </ButtonLink>
            <ButtonLink to="/" variant="ghost">
              К карте
            </ButtonLink>
          </div>
        </main>
      </>
    );

  return (
    <>
      <TopBar />
      <div className={s.layout}>
        <main className={s.formCol}>
          <h1 className={s.title}>Добавить объект</h1>
          <p className={s.lead}>
            Если здания нет в базе, отправьте его на проверку. Подходят нежилые капитальные здания 1920–1991 годов постройки в
            Петербурге.
          </p>
          <form className={s.form} onSubmit={onSubmit} noValidate>
            <Field label="Адрес" error={errors.address?.message} hint="Улица и номер дома, например «Кожевенная линия, 40»">
              {(p) => <Input {...p} autoComplete="street-address" {...register('address', { onChange: () => setPoint(null) })} />}
            </Field>
            {!point && geo.data && geo.data.length > 0 && (
              <ul className={s.geo} aria-label="Найденные адреса">
                {geo.data.map((h) => (
                  <li key={`${h.center[0]},${h.center[1]}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setValue('address', h.address, { shouldValidate: true });
                        setPoint(h.center);
                        setFly(h.center);
                        setPointError(false);
                      }}
                    >
                      {h.address}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {geo.isError && <p className={s.geoNote}>Поиск адреса недоступен — поставьте точку на карте вручную.</p>}
            <p className={s.point} data-error={pointError || undefined} role={pointError ? 'alert' : undefined}>
              {point
                ? `Точка на карте: ${point[1].toFixed(5)}, ${point[0].toFixed(5)}. Перетащите её, если она стоит не на здании.`
                : pointError
                  ? 'Поставьте точку на карте: выберите адрес из списка или нажмите на здание.'
                  : 'Точка на карте ещё не поставлена.'}
            </p>
            <div className={s.row3}>
              <Field label="Год постройки" error={errors.year_built?.message}>
                {(p) => <Input {...p} inputMode="numeric" {...register('year_built')} />}
              </Field>
              <Field label="Общая площадь" error={errors.area_total_m2?.message}>
                {(p) => <Input {...p} inputMode="decimal" suffix="м²" {...register('area_total_m2')} />}
              </Field>
              <Field label="Этажность" error={errors.floors?.message}>
                {(p) => <Input {...p} inputMode="numeric" {...register('floors')} />}
              </Field>
            </div>
            <Field label="Исходное назначение" error={errors.original_function?.message}>
              {(p) => (
                <Select {...p} {...register('original_function')}>
                  <option value="" disabled>
                    Выберите
                  </option>
                  {Object.entries(FUNCTION_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Комментарий" optional hint="Что известно о здании: собственник, состояние, сколько лет пустует">
              {(p) => <Textarea {...p} {...register('comment')} />}
            </Field>
            {errors.root && (
              <p className={s.formError} role="alert">
                {errors.root.message}
              </p>
            )}
            <div className={s.actions}>
              <Button type="submit" variant="primary" size="lg" pending={isSubmitting} pendingLabel="Отправляем…">
                Отправить на проверку
              </Button>
              <span className={s.alt}>
                Документы по зданию можно загрузить после проверки, из его карточки. <Link to="/">К карте</Link>
              </span>
            </div>
          </form>
        </main>
        <div className={s.mapCol}>
          <PointPicker
            value={point}
            flyTo={fly}
            onChange={(p) => {
              setPoint(p);
              setPointError(false);
            }}
          />
        </div>
      </div>
    </>
  );
}
