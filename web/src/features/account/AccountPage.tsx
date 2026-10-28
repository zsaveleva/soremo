import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { LogOut, Map as MapIcon, Plus, Upload } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useMyDocuments, useMyObjectRequests, useMyReports } from '../../api/queries';
import type { MyReport } from '../../api/types';
import { TopBar } from '../../app/TopBar';
import { AccuracyMeter, Badge, Button, ButtonLink, SkeletonText, Table, Tabs } from '../../design/components';
import { Footprint } from '../../design/Logo';
import { formatBytes, formatDate, formatDateShort, formatObjects } from '../../lib/format';
import { DOC_KIND_LABEL, REVIEW_LABEL, REVIEW_TONE } from '../../lib/labels';
import { useSession, type Segment } from '../auth/session';
import s from './AccountPage.module.css';

type Tab = 'access' | 'objects' | 'docs';

// Подсказки зависят от сегмента (ТЗ 5.5).
const HINTS: Record<Segment, string> = {
  owner: 'Загрузите техобследование, чтобы получить точный отчёт по своему зданию: после проверки точность вырастет до ≈85%.',
  investor: 'Сравните несколько объектов: пакет на 5 объектов стоит дешевле пяти отдельных.',
  consultant: 'Пакет на 25 объектов на 3 месяца подходит для портфельного анализа по району или заказчику.',
  government: 'Пакет «Все объекты» показывает сценарии по всему нежилому фонду базы — для планирования программ реновации.',
  other: 'Три примера отчётов на карте открыты без пакета: с них удобно начать.',
};

export function AccountPage() {
  const { user, access, notifications, loading, signOut, reload } = useSession();
  const [params, setParams] = useSearchParams();
  const [leaving, setLeaving] = useState(false);
  const tab = (params.get('tab') as Tab) ?? (access ? 'objects' : 'access');
  const welcome = (useLocation().state as { welcome?: boolean } | null)?.welcome;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const reports = useMyReports(!!user);
  const docs = useMyDocuments(!!user);
  const requests = useMyObjectRequests(!!user);

  const unread = notifications.filter((n) => !n.read);
  useEffect(() => {
    if (!unread.length) return;
    const t = window.setTimeout(() => api('/me/notifications/read', { method: 'POST' }).then(reload).catch(() => {}), 4000);
    return () => window.clearTimeout(t);
  }, [unread.length, reload]);

  if (loading) return null;
  if (!user) return <Navigate to={leaving ? '/' : '/login?next=/account'} replace />;

  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });

  return (
    <>
      <TopBar />
      <main className={s.page}>
        <header className={s.head}>
          <div>
            <h1 className={s.title}>Кабинет</h1>
            <p className={s.who}>
              {user.company_name ? `${user.company_name}, ` : ''}
              {user.email}
            </p>
          </div>
          <Button
            variant="ghost"
            icon={LogOut}
            onClick={() => {
              // Пока грузится экран карты, кабинет ещё на экране; флаг не даёт ему перекинуть на вход.
              setLeaving(true);
              void signOut();
            }}
          >
            Выйти
          </Button>
        </header>

        {welcome && !access && <p className={s.welcome}>Email подтверждён. Выберите пакет, чтобы получить первый отчёт.</p>}

        {notifications.length > 0 && (
          <section className={s.notes} aria-label="Уведомления">
            <ul>
              {notifications.slice(0, 4).map((n) => (
                <li key={n.id} data-unread={!n.read || undefined}>
                  <span className={s.noteDate}>{formatDateShort(n.created_at)}</span>
                  <span>
                    {n.text}
                    {n.link && (
                      <>
                        {' '}
                        <a href={n.link}>Открыть</a>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className={s.hint}>{HINTS[user.segment]}</p>

        <Tabs
          label="Разделы кабинета"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'access', label: 'Доступ' },
            { value: 'objects', label: 'Мои объекты', count: reports.data?.length },
            { value: 'docs', label: 'Документы', count: docs.data?.length },
          ]}
        >
          {tab === 'access' && <AccessTab />}
          {tab === 'objects' && (
            <ObjectsTab
              reports={reports.data}
              requests={requests.data}
              onOpen={(r) => {
                qc.removeQueries({ queryKey: ['report', r.id] });
                navigate(`/reports/${r.id}`);
              }}
            />
          )}
          {tab === 'docs' && <DocsTab />}
        </Tabs>
      </main>
    </>
  );
}

function AccessTab() {
  const { access } = useSession();
  if (!access)
    return (
      <Empty
        text="Активного пакета нет. Пакет — это число объектов, по которым можно получать отчёты, и срок доступа: от 1 объекта на месяц до всех объектов базы на год."
        action={
          <ButtonLink to="/pricing" variant="primary">
            Выбрать пакет
          </ButtonLink>
        }
      />
    );
  const limit = access.objects_limit;
  const left = limit === null ? null : limit - access.objects_used;
  const days = Math.max(0, Math.ceil((new Date(access.ends_at).getTime() - Date.now()) / 86_400_000));
  return (
    <div className={s.access}>
      <dl className={s.accessNums}>
        <div>
          <dt>Пакет</dt>
          <dd>{formatObjects(limit)}</dd>
        </div>
        <div>
          <dt>Использовано</dt>
          <dd>{limit === null ? formatObjects(access.objects_used) : `${access.objects_used} из ${limit}`}</dd>
        </div>
        <div>
          <dt>Действует до</dt>
          <dd>{formatDate(access.ends_at)}</dd>
        </div>
      </dl>
      {limit !== null && (
        <div className={s.usage} role="img" aria-label={`Использовано ${access.objects_used} из ${limit} объектов`}>
          <span style={{ width: `${Math.min(100, (access.objects_used / limit) * 100)}%` }} />
        </div>
      )}
      <p className={s.muted}>
        {left === null
          ? `Осталось ${days} дн. доступа ко всем объектам базы.`
          : left > 0
            ? `Можно смоделировать ещё ${formatObjects(left)}. Осталось ${days} дн. Повторное моделирование тех же объектов лимит не тратит.`
            : 'Лимит исчерпан: пересчёт уже смоделированных объектов доступен, новые — после продления.'}
      </p>
      <div className={s.actions}>
        <ButtonLink to="/pricing" variant={left === 0 || days < 14 ? 'primary' : 'secondary'}>
          Продлить или сменить пакет
        </ButtonLink>
        <ButtonLink to="/" icon={MapIcon} variant="ghost">
          К карте
        </ButtonLink>
      </div>
    </div>
  );
}

function ObjectsTab({
  reports,
  requests,
  onOpen,
}: {
  reports: MyReport[] | undefined;
  requests: import('../../api/types').ObjectRequest[] | undefined;
  onOpen: (r: MyReport) => void;
}) {
  if (!reports) return <SkeletonText lines={5} />;
  return (
    <div className={s.stack}>
      {reports.length === 0 ? (
        <Empty
          text="Пока нет отчётов. Выберите объект на карте и нажмите «Смоделировать сценарии»."
          action={
            <ButtonLink to="/" variant="primary" icon={MapIcon}>
              К карте
            </ButtonLink>
          }
        />
      ) : (
        <Table
          rows={reports}
          rowKey={(r) => r.id}
          onRowClick={onOpen}
          columns={[
            {
              key: 'a',
              header: 'Объект',
              render: (r) => (
                <a href={`/reports/${r.id}`} onClick={(e) => e.preventDefault()} className={s.rowLink}>
                  <span className={s.addr}>{r.address}</span>
                  {r.name && <span className={s.sub}>{r.name}</span>}
                </a>
              ),
            },
            { key: 'd', header: 'Отчёт', render: (r) => formatDateShort(r.finished_at ?? r.created_at) },
            { key: 'p', header: 'Точность', width: '180px', render: (r) => <AccuracyMeter level={r.accuracy_level} compact /> },
            {
              key: 's',
              header: 'Статус',
              render: (r) =>
                r.status === 'ready' ? (
                  r.accuracy_level === 'low' ? (
                    <Badge tone="draft">Черновик без документов</Badge>
                  ) : (
                    <Badge tone="accepted">Уточнён</Badge>
                  )
                ) : (
                  <Badge tone="pending">Считается</Badge>
                ),
            },
          ]}
        />
      )}
      {requests && requests.length > 0 && (
        <section>
          <h2 className={s.h2}>Заявки на добавление объектов</h2>
          <Table
            rows={requests}
            rowKey={(r) => r.id}
            columns={[
              { key: 'a', header: 'Адрес', render: (r) => r.address },
              { key: 'd', header: 'Подана', render: (r) => formatDateShort(r.created_at) },
              {
                key: 's',
                header: 'Статус',
                render: (r) => (
                  <span className={s.statusCell}>
                    <Badge tone={REVIEW_TONE[r.status]}>{REVIEW_LABEL[r.status]}</Badge>
                    {r.status === 'accepted' && <a href={`/map?b=${r.building_id}`}>На карте</a>}
                    {r.review_comment && <span className={s.sub}>{r.review_comment}</span>}
                  </span>
                ),
              },
            ]}
          />
        </section>
      )}
      <p>
        <ButtonLink to="/objects/new" icon={Plus} variant="ghost">
          Добавить объект, которого нет в базе
        </ButtonLink>
      </p>
    </div>
  );
}

function DocsTab() {
  const { data } = useMyDocuments();
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!data) return <SkeletonText lines={4} />;
  if (data.length === 0)
    return (
      <Empty
        text="Документов нет. Техническое обследование или экспертиза поднимают точность отчёта с ≈30% до ≈85%; загрузить их можно из карточки объекта или отчёта."
        action={
          <ButtonLink to="/" icon={Upload}>
            Выбрать объект на карте
          </ButtonLink>
        }
      />
    );
  return (
    <Table
      rows={data}
      rowKey={(d) => d.id}
      columns={[
        {
          key: 'f',
          header: 'Файл',
          render: (d) => (
            <span className={s.fileCell}>
              <span className={s.addr}>{d.file_name}</span>
              <span className={s.sub}>
                {DOC_KIND_LABEL[d.kind]} от {formatDateShort(d.issued_on)}, {formatBytes(d.size)}
              </span>
            </span>
          ),
        },
        { key: 'o', header: 'Объект', render: (d) => <a href={`/map?b=${d.building_id}`}>{d.address}</a> },
        {
          key: 's',
          header: 'Статус',
          render: (d) => (
            <span className={s.statusCell}>
              <Badge tone={REVIEW_TONE[d.status]}>{REVIEW_LABEL[d.status]}</Badge>
              {d.status === 'pending' && <span className={s.sub}>До 2 рабочих дней</span>}
              {d.review_comment && (
                <button type="button" className={s.linkBtn} onClick={() => setExpanded(expanded === d.id ? null : d.id)}>
                  {expanded === d.id ? d.review_comment : 'Причина'}
                </button>
              )}
            </span>
          ),
        },
      ]}
    />
  );
}

function Empty({ text, action }: { text: string; action: React.ReactNode }) {
  return (
    <div className={s.empty}>
      <Footprint size={40} muted />
      <p>{text}</p>
      {action}
    </div>
  );
}
