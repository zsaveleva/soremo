import { Upload } from 'lucide-react';
import type { BuildingCard } from '../../api/types';
import { useBuilding } from '../../api/queries';
import { AccuracyMeter, Badge, Button, ButtonLink, Skeleton, SkeletonText } from '../../design/components';
import { FUNCTION_LABEL } from '../../lib/labels';
import { formatArea, formatDate, formatObjects } from '../../lib/format';
import { contextRows } from '../../lib/context';
import { useSession } from '../auth/session';
import s from './ObjectPanel.module.css';

export function ObjectPanelBody({ id }: { id: number }) {
  const { data: b, isError, refetch } = useBuilding(id);
  if (isError)
    return (
      <div className={s.error}>
        <p>Не удалось загрузить объект: нет связи с сервером.</p>
        <Button size="sm" onClick={() => refetch()}>
          Повторить
        </Button>
      </div>
    );
  if (!b) return <PanelSkeleton />;
  return <ObjectCard b={b} />;
}

export function ObjectTitle({ id }: { id: number }) {
  const { data: b } = useBuilding(id);
  if (!b) return <Skeleton width={260} height={26} />;
  return (
    <div className={s.titleBlock}>
      <h2 className={s.address} id="object-title">
        {b.address}
      </h2>
      {b.name && <p className={s.name}>{b.name}</p>}
      <p className={s.subtitle}>
        {b.year_built} год, {FUNCTION_LABEL[b.original_function].toLowerCase()}
      </p>
    </div>
  );
}

function ObjectCard({ b }: { b: BuildingCard }) {
  const object = [
    ['Площадь здания', formatArea(b.area_total_m2)],
    ['Этажность', String(b.floors)],
    ['Площадь участка', formatArea(b.area_site_m2)],
    ['Площадь застройки', formatArea(b.area_footprint_m2)],
    ['Вид разрешённого использования', b.vri],
    ['Зона по ПЗЗ', b.pzz_zone],
    ['Объект культурного наследия', b.is_okn ? 'Да' : 'Нет'],
    ['Правовой статус, справочно', b.legal_status],
  ];
  return (
    <div className={s.card}>
      {(b.is_demo || b.source === 'user') && (
        <div className={s.tags}>
          {b.is_demo && <Badge tone="neutral">Пример отчёта открыт без регистрации</Badge>}
          {b.source === 'user' && <Badge tone="neutral">Добавлен пользователем</Badge>}
        </div>
      )}

      <section aria-labelledby="obj-h">
        <h3 id="obj-h" className={s.h3}>
          Объект
        </h3>
        <dl className={s.facts}>
          {object.map(([k, v]) => (
            <div key={k} className={s.fact}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="ctx-h">
        <h3 id="ctx-h" className={s.h3}>
          Контекст
        </h3>
        <dl className={s.context}>
          {contextRows(b.context).map((r) => (
            <div key={r.label} className={s.ctx}>
              <dt>{r.label}</dt>
              <dd>
                <span className={s.ctxValue}>{r.value}</span>
                <span className={s.ctxCaption}>{r.caption}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="acc-h">
        <h3 id="acc-h" className={s.h3}>
          Точность
        </h3>
        {b.is_demo ? (
          <AccuracyMeter level="mid" hint="У примеров уровень точности задан для демонстрации: откройте отчёт, чтобы увидеть сценарии." />
        ) : (
          <>
            <AccuracyMeter level={b.accuracy.level} hint={accuracyHint(b)} />
            <DocsLine b={b} />
          </>
        )}
      </section>
    </div>
  );
}

function accuracyHint(b: BuildingCard) {
  if (b.accuracy.docs_pending > 0 && b.accuracy.level !== 'high')
    return 'Документ на проверке, до 2 рабочих дней. После проверки отчёт можно пересчитать бесплатно.';
  if (b.accuracy.level === 'low')
    return 'Без документов модель не знает техническое состояние здания. Техобследование поднимет точность до ≈85%.';
  return undefined;
}

function DocsLine({ b }: { b: BuildingCard }) {
  const { user } = useSession();
  return (
    <div className={s.docs}>
      {b.accuracy.docs_accepted > 0 && <Badge tone="accepted">Принято документов: {b.accuracy.docs_accepted}</Badge>}
      {b.accuracy.docs_pending > 0 && <Badge tone="pending">На проверке: {b.accuracy.docs_pending}</Badge>}
      {b.accuracy.level !== 'high' && (
        <ButtonLink
          size="sm"
          icon={Upload}
          to={user ? `/objects/${b.id}/documents` : `/signup?next=${encodeURIComponent(`/objects/${b.id}/documents`)}`}
        >
          Загрузить техобследование
        </ButtonLink>
      )}
    </div>
  );
}

type ActionProps = { b: BuildingCard | undefined; onModel: (b: BuildingCard) => void; modelling?: boolean };

/** Нижняя строка панели: одно главное действие в зависимости от доступа (ТЗ 5.3). */
export function ObjectActions({ b, onModel, modelling }: ActionProps) {
  const { user, access } = useSession();
  if (!b) return <Skeleton height={40} />;

  if (b.is_demo)
    return (
      <ButtonLink variant="primary" block to={`/demo/${b.id}`}>
        Открыть пример отчёта
      </ButtonLink>
    );

  if (b.my_report_id)
    return (
      <div className={s.actions}>
        <ButtonLink variant="primary" to={`/reports/${b.my_report_id}`} className={s.grow}>
          Открыть отчёт
        </ButtonLink>
        <Button onClick={() => onModel(b)} pending={modelling} pendingLabel="Запускаем…">
          Пересчитать
        </Button>
      </div>
    );

  if (!user)
    return (
      <div className={s.gate}>
        <p className={s.gateText}>Для отчёта нужен доступ. Карточки и три примера отчётов открыты без регистрации.</p>
        <div className={s.actions}>
          <ButtonLink variant="primary" to={`/signup?next=${encodeURIComponent(`/map?b=${b.id}`)}`} className={s.grow}>
            Зарегистрироваться
          </ButtonLink>
          <ButtonLink to="/pricing">Пакеты и цены</ButtonLink>
        </div>
      </div>
    );

  if (!access || access.status !== 'active')
    return (
      <div className={s.gate}>
        <p className={s.gateText}>Для отчёта нужен доступ: выберите пакет на нужное число объектов.</p>
        <ButtonLink variant="primary" block to="/pricing">
          Выбрать пакет
        </ButtonLink>
      </div>
    );

  const left = access.objects_limit === null ? null : access.objects_limit - access.objects_used;
  if (left !== null && left <= 0)
    return (
      <div className={s.gate}>
        <p className={s.gateText}>
          Лимит пакета исчерпан: {formatObjects(access.objects_limit)} из {formatObjects(access.objects_limit)}. Продлите доступ или
          выберите пакет больше.
        </p>
        <ButtonLink variant="primary" block to="/pricing">
          Выбрать пакет
        </ButtonLink>
      </div>
    );

  return (
    <div className={s.gate}>
      <Button variant="primary" block onClick={() => onModel(b)} pending={modelling} pendingLabel="Запускаем…">
        Смоделировать сценарии
      </Button>
      <p className={s.quota}>
        {left === null
          ? `Пакет «Все объекты» до ${formatDate(access.ends_at)}.`
          : `Спишется 1 объект, останется ${formatObjects(left - 1)}. Пересчёт этого объекта потом бесплатный.`}
      </p>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className={s.card} aria-busy="true" aria-label="Загружаем карточку">
      <div className={s.skelBlock}>
        <Skeleton width={80} height={14} />
        <SkeletonText lines={5} />
      </div>
      <div className={s.skelBlock}>
        <Skeleton width={90} height={14} />
        <SkeletonText lines={4} />
      </div>
    </div>
  );
}
