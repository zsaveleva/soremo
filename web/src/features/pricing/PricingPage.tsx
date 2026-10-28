import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { TopBar } from '../../app/TopBar';
import { api, ApiError } from '../../api/client';
import { Button, Skeleton, Stepper, useToast } from '../../design/components';
import { formatMonths, formatNumber, formatObjects, formatRub, plural } from '../../lib/format';
import { useSession } from '../auth/session';
import { MONTH_STEPS, OBJECT_STEPS, findPackage, usePackages } from './usePackages';
import s from './PricingPage.module.css';

const ALL = 'all';

export function PricingPage() {
  const { data: packages } = usePackages();
  const { user, access } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [objects, setObjects] = useState<number | null>(Number(params.get('objects')) || 5);
  const [months, setMonths] = useState<number>(Number(params.get('months')) || 3);

  const available = useMemo(
    () => new Set(packages?.filter((p) => p.objects_limit === objects).map((p) => p.months)),
    [packages, objects],
  );

  // Если срок недоступен для выбранного объёма — переключаем на ближайший доступный.
  useEffect(() => {
    if (!packages || available.has(months)) return;
    const first = MONTH_STEPS.find((m) => available.has(m));
    if (first) setMonths(first);
  }, [available, months, packages]);

  const pkg = findPackage(packages, objects, months);
  const perObject = pkg && pkg.objects_limit ? Math.round(pkg.price_rub / pkg.objects_limit) : null;
  const single = findPackage(packages, 1, 1)?.price_rub;

  const checkout = useMutation({
    mutationFn: () => api<{ payment_id: string; amount: number }>('/checkout', { method: 'POST', json: { package_id: pkg!.id } }),
    onSuccess: (r) => navigate(`/checkout/${r.payment_id}`, { state: { pkg } }),
    onError: (e) =>
      toast({
        tone: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось начать оплату: нет связи',
        action: { label: 'Повторить', onClick: () => checkout.mutate() },
      }),
  });

  const go = () => {
    if (!user) navigate(`/signup?next=${encodeURIComponent(`/pricing?objects=${objects ?? ALL}&months=${months}`)}`);
    else checkout.mutate();
  };

  return (
    <>
      <TopBar />
      <main className={s.page}>
        <header className={s.head}>
          <h1 className={s.title}>Пакеты доступа</h1>
          <p className={s.lead}>
            Пакет — это число объектов, по которым можно получить отчёты, и срок доступа. Пересчёт объекта из пакета, в том числе
            после загрузки документов, бесплатный.
          </p>
        </header>

        <div className={s.grid}>
          <div className={s.config}>
            {!packages ? (
              <>
                <Skeleton height={88} />
                <Skeleton height={88} />
              </>
            ) : (
              <>
                <Stepper
                  legend="Объектов в пакете"
                  name="objects"
                  value={objects ?? ALL}
                  onChange={(v) => setObjects(v === ALL ? null : Number(v))}
                  options={OBJECT_STEPS.map((o) => ({
                    value: o ?? ALL,
                    label: o === null ? 'Все' : String(o),
                    caption: o === null ? '≈1000 объектов' : plural(o, 'объект', 'объекта', 'объектов'),
                  }))}
                />
                <Stepper
                  legend="Срок доступа"
                  name="months"
                  value={months}
                  onChange={setMonths}
                  options={MONTH_STEPS.map((m) => ({
                    value: m,
                    label: String(m),
                    caption: plural(m, 'месяц', 'месяца', 'месяцев'),
                    disabled: !available.has(m),
                  }))}
                />
                <p className={s.note}>
                  Заштрихованы сроки, которых нет для выбранного объёма: малые пакеты рассчитаны на короткую проверку гипотезы,
                  большие — на работу с портфелем.
                </p>
              </>
            )}
          </div>

          <aside className={s.summary} aria-live="polite">
            <p className={s.sumLabel}>Итого</p>
            <p className={s.price}>{pkg ? formatRub(pkg.price_rub) : '—'}</p>
            {pkg && (
              <dl className={s.facts}>
                <div>
                  <dt>Объектов</dt>
                  <dd>{formatObjects(pkg.objects_limit)}</dd>
                </div>
                <div>
                  <dt>Срок</dt>
                  <dd>{formatMonths(pkg.months)} с момента оплаты</dd>
                </div>
                {perObject && (
                  <div>
                    <dt>За объект</dt>
                    <dd>
                      {formatRub(perObject)}
                      {single && pkg.objects_limit! > 1 ? `, на ${formatNumber(Math.round((1 - perObject / single) * 100))}% дешевле разового` : ''}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>В отчёте</dt>
                  <dd>2–4 сценария с ТЭП, зонированием и экономикой, PDF</dd>
                </div>
              </dl>
            )}
            <Button variant="primary" size="lg" block disabled={!pkg} onClick={go} pending={checkout.isPending} pendingLabel="Готовим оплату…">
              {user ? (pkg ? `Перейти к оплате` : 'Выберите срок') : 'Зарегистрироваться и оплатить'}
            </Button>
            <p className={s.free}>Моделирование повторно по тому же объекту не расходует лимит.</p>
            {access && (
              <p className={s.current}>
                Сейчас действует пакет на {formatObjects(access.objects_limit)}. Новый пакет заменит его, а объекты, которые вы уже
                моделировали, останутся бесплатными для пересчёта.
              </p>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}
