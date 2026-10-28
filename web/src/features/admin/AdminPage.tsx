import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, getAccessToken } from '../../api/client';
import type { BuildingFunction, DocKind, ReviewStatus } from '../../api/types';
import { TopBar } from '../../app/TopBar';
import { Badge, Button, Field, Modal, Select, SkeletonText, Table, Tabs, Textarea, useToast } from '../../design/components';
import { formatArea, formatBytes, formatDateShort, formatMonths, formatObjects, formatRub } from '../../lib/format';
import { DOC_KIND_LABEL, FUNCTION_LABEL, REVIEW_LABEL, REVIEW_TONE } from '../../lib/labels';
import { useSession } from '../auth/session';
import s from './AdminPage.module.css';

type Tab = 'documents' | 'objects' | 'users' | 'payments';

type AdminDoc = {
  id: string;
  building_id: number;
  address: string;
  kind: DocKind;
  issued_on: string;
  file_name: string;
  mime: string;
  size: number;
  status: ReviewStatus;
  review_comment: string | null;
  created_at: string;
  user_email: string;
  user_company: string | null;
};

type AdminRequest = {
  id: string;
  building_id: number;
  address: string;
  status: ReviewStatus;
  comment: string | null;
  review_comment: string | null;
  created_at: string;
  year_built: number;
  original_function: BuildingFunction;
  floors: number;
  area_total_m2: number;
  center: [number, number];
  user_email: string;
  user_company: string | null;
};

type Review = { kind: 'documents' | 'object-requests'; id: string; title: string; doc?: AdminDoc; req?: AdminRequest };

export function AdminPage() {
  const { user, loading } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'documents';
  const [status, setStatus] = useState<ReviewStatus | ''>('pending');
  const [review, setReview] = useState<Review | null>(null);

  const docs = useQuery({
    queryKey: ['admin', 'documents', status],
    enabled: user?.role === 'admin' && tab === 'documents',
    queryFn: () => api<AdminDoc[]>(`/admin/documents${status ? `?status=${status}` : ''}`),
  });
  const reqs = useQuery({
    queryKey: ['admin', 'object-requests', status],
    enabled: user?.role === 'admin' && tab === 'objects',
    queryFn: () => api<AdminRequest[]>(`/admin/object-requests${status ? `?status=${status}` : ''}`),
  });

  if (loading) return null;
  if (!user) return <Navigate to="/login?next=/admin" replace />;
  if (user.role !== 'admin')
    return (
      <>
        <TopBar />
        <main className={s.page}>
          <h1 className={s.title}>Раздел для команды SOREMO</h1>
          <p className={s.muted}>У вашего аккаунта нет прав модератора.</p>
        </main>
      </>
    );

  const statusFilter = (
    <div className={s.filter}>
      <Field label="Статус">
        {(p) => (
          <Select {...p} value={status} onChange={(e) => setStatus(e.target.value as ReviewStatus | '')}>
            <option value="pending">На проверке</option>
            <option value="accepted">Принятые</option>
            <option value="rejected">Отклонённые</option>
            <option value="">Все</option>
          </Select>
        )}
      </Field>
    </div>
  );

  return (
    <>
      <TopBar />
      <main className={s.page}>
        <h1 className={s.title}>Модерация</h1>
        <Tabs
          label="Разделы админки"
          value={tab}
          onChange={(t) => setParams({ tab: t }, { replace: true })}
          items={[
            { value: 'documents', label: 'Документы' },
            { value: 'objects', label: 'Заявки на объекты' },
            { value: 'users', label: 'Пользователи' },
            { value: 'payments', label: 'Платежи' },
          ]}
        >
          {tab === 'documents' && (
            <>
              {statusFilter}
              {!docs.data ? (
                <SkeletonText lines={6} />
              ) : (
                <Table
                  dense
                  rows={docs.data}
                  rowKey={(d) => d.id}
                  empty="Документов с таким статусом нет."
                  onRowClick={(d) => setReview({ kind: 'documents', id: d.id, title: d.file_name, doc: d })}
                  columns={[
                    { key: 'c', header: 'Загружен', width: '96px', render: (d) => formatDateShort(d.created_at) },
                    {
                      key: 'f',
                      header: 'Файл',
                      render: (d) => (
                        <span className={s.cell}>
                          <button type="button" className={s.link} onClick={(e) => (e.stopPropagation(), setReview({ kind: 'documents', id: d.id, title: d.file_name, doc: d }))}>
                            {d.file_name}
                          </button>
                          <span className={s.sub}>
                            {DOC_KIND_LABEL[d.kind]} от {formatDateShort(d.issued_on)}, {formatBytes(d.size)}
                          </span>
                        </span>
                      ),
                    },
                    { key: 'o', header: 'Объект', render: (d) => d.address },
                    { key: 'u', header: 'Пользователь', render: (d) => <span className={s.cell}>{d.user_email}{d.user_company && <span className={s.sub}>{d.user_company}</span>}</span> },
                    { key: 's', header: 'Статус', render: (d) => <Badge tone={REVIEW_TONE[d.status]}>{REVIEW_LABEL[d.status]}</Badge> },
                  ]}
                />
              )}
            </>
          )}
          {tab === 'objects' && (
            <>
              {statusFilter}
              {!reqs.data ? (
                <SkeletonText lines={6} />
              ) : (
                <Table
                  dense
                  rows={reqs.data}
                  rowKey={(r) => r.id}
                  empty="Заявок с таким статусом нет."
                  onRowClick={(r) => setReview({ kind: 'object-requests', id: r.id, title: r.address, req: r })}
                  columns={[
                    { key: 'c', header: 'Подана', width: '96px', render: (r) => formatDateShort(r.created_at) },
                    {
                      key: 'a',
                      header: 'Адрес',
                      render: (r) => (
                        <span className={s.cell}>
                          <button type="button" className={s.link} onClick={(e) => (e.stopPropagation(), setReview({ kind: 'object-requests', id: r.id, title: r.address, req: r }))}>
                            {r.address}
                          </button>
                          <span className={s.sub}>
                            {FUNCTION_LABEL[r.original_function]}, {r.year_built}, {formatArea(r.area_total_m2)}, {r.floors} эт.
                          </span>
                        </span>
                      ),
                    },
                    { key: 'u', header: 'Пользователь', render: (r) => r.user_email },
                    { key: 's', header: 'Статус', render: (r) => <Badge tone={REVIEW_TONE[r.status]}>{REVIEW_LABEL[r.status]}</Badge> },
                  ]}
                />
              )}
            </>
          )}
          {tab === 'users' && <Users />}
          {tab === 'payments' && <Payments />}
        </Tabs>
      </main>
      {review && <ReviewModal review={review} onClose={() => setReview(null)} />}
    </>
  );
}

const SEGMENT: Record<string, string> = { owner: 'Собственник', investor: 'Инвестор', consultant: 'Консалтинг', government: 'Госструктура', other: 'Другое' };

function Users() {
  const { data } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () =>
      api<{ id: string; email: string; type: string; segment: string; company_name: string | null; phone: string | null; role: string; verified: boolean; reports: number; paid_rub: number; created_at: string }[]>(
        '/admin/users',
      ),
  });
  if (!data) return <SkeletonText lines={6} />;
  return (
    <Table
      dense
      rows={data}
      rowKey={(u) => u.id}
      columns={[
        { key: 'c', header: 'Регистрация', width: '108px', render: (u) => formatDateShort(u.created_at) },
        { key: 'e', header: 'Email', render: (u) => <span className={s.cell}>{u.email}{u.company_name && <span className={s.sub}>{u.company_name}</span>}</span> },
        { key: 't', header: 'Тип', render: (u) => (u.type === 'company' ? 'Юрлицо' : 'Физлицо') },
        { key: 's', header: 'Сегмент', render: (u) => SEGMENT[u.segment] ?? u.segment },
        { key: 'v', header: 'Email', render: (u) => (u.role === 'admin' ? 'Админ' : u.verified ? 'Подтверждён' : 'Не подтверждён') },
        { key: 'r', header: 'Отчёты', numeric: true, render: (u) => u.reports },
        { key: 'p', header: 'Оплачено', numeric: true, render: (u) => (u.paid_rub ? formatRub(u.paid_rub) : '—') },
      ]}
    />
  );
}

function Payments() {
  const { data } = useQuery({
    queryKey: ['admin', 'payments'],
    queryFn: () =>
      api<{ id: string; amount_rub: number; status: string; provider: string; created_at: string; email: string; company_name: string | null; objects_limit: number | null; months: number }[]>(
        '/admin/payments',
      ),
  });
  if (!data) return <SkeletonText lines={6} />;
  const total = data.filter((p) => p.status === 'succeeded').reduce((n, p) => n + p.amount_rub, 0);
  return (
    <>
      <p className={s.muted} style={{ marginBottom: 16 }}>
        Проведено платежей на {formatRub(total)}. Провайдер — имитация оплаты.
      </p>
      <Table
        dense
        rows={data}
        rowKey={(p) => p.id}
        columns={[
          { key: 'c', header: 'Дата', width: '108px', render: (p) => formatDateShort(p.created_at) },
          { key: 'e', header: 'Пользователь', render: (p) => <span className={s.cell}>{p.email}{p.company_name && <span className={s.sub}>{p.company_name}</span>}</span> },
          { key: 'k', header: 'Пакет', render: (p) => `${formatObjects(p.objects_limit)}, ${formatMonths(p.months)}` },
          { key: 's', header: 'Статус', render: (p) => (p.status === 'succeeded' ? <Badge tone="accepted">Проведён</Badge> : p.status === 'pending' ? <Badge tone="pending">Не оплачен</Badge> : <Badge tone="rejected">Отказ</Badge>) },
          { key: 'a', header: 'Сумма', numeric: true, render: (p) => formatRub(p.amount_rub) },
        ]}
      />
    </>
  );
}

function ReviewModal({ review, onClose }: { review: Review; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [needReason, setNeedReason] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const pending = (review.doc ?? review.req)!.status === 'pending';

  // Файл приходит с авторизацией, поэтому превью — через blob URL.
  useEffect(() => {
    if (!review.doc) return;
    let url: string | null = null;
    fetch(`/api/v1/documents/${review.doc.id}/file`, { headers: { Authorization: `Bearer ${getAccessToken()}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => setPreview((url = URL.createObjectURL(b))))
      .catch(() => setPreview(''));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [review.doc]);

  const decide = useMutation({
    mutationFn: (decision: 'accepted' | 'rejected') =>
      api(`/admin/${review.kind}/${review.id}/review`, { method: 'POST', json: { decision, comment } }),
    onSuccess: (_, decision) => {
      toast({ tone: 'done', message: decision === 'accepted' ? 'Принято, пользователь получил уведомление' : 'Отклонено, причина отправлена пользователю' });
      void qc.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
    onError: (e) => toast({ tone: 'error', message: e instanceof ApiError ? e.message : 'Не удалось сохранить: нет связи' }),
  });

  const d = review.doc;
  const r = review.req;
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={review.title}
      footer={
        pending ? (
          <>
            <Button variant="primary" onClick={() => decide.mutate('accepted')} pending={decide.isPending && decide.variables === 'accepted'} pendingLabel="Сохраняем…">
              Принять
            </Button>
            <Button
              variant="danger"
              onClick={() => (comment.trim().length < 5 ? setNeedReason(true) : decide.mutate('rejected'))}
              pending={decide.isPending && decide.variables === 'rejected'}
              pendingLabel="Сохраняем…"
            >
              Отклонить
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Закрыть
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Закрыть</Button>
        )
      }
    >
      <div className={s.review}>
        <dl className={s.meta}>
          {d && (
            <>
              <div><dt>Объект</dt><dd><a href={`/map?b=${d.building_id}`} target="_blank" rel="noreferrer">{d.address}</a></dd></div>
              <div><dt>Тип</dt><dd>{DOC_KIND_LABEL[d.kind]} от {formatDateShort(d.issued_on)}</dd></div>
              <div><dt>Файл</dt><dd>{d.mime}, {formatBytes(d.size)}</dd></div>
              <div><dt>Пользователь</dt><dd>{d.user_email}{d.user_company ? `, ${d.user_company}` : ''}</dd></div>
            </>
          )}
          {r && (
            <>
              <div><dt>Назначение</dt><dd>{FUNCTION_LABEL[r.original_function]}</dd></div>
              <div><dt>Год, этажность</dt><dd>{r.year_built}, {r.floors} эт.</dd></div>
              <div><dt>Площадь</dt><dd>{formatArea(r.area_total_m2)}</dd></div>
              <div><dt>Точка</dt><dd><a href={`https://www.openstreetmap.org/?mlat=${r.center[1]}&mlon=${r.center[0]}#map=18/${r.center[1]}/${r.center[0]}`} target="_blank" rel="noreferrer">{r.center[1].toFixed(5)}, {r.center[0].toFixed(5)}</a></dd></div>
              <div><dt>Пользователь</dt><dd>{r.user_email}</dd></div>
              {r.comment && <div><dt>Комментарий</dt><dd>{r.comment}</dd></div>}
            </>
          )}
          {(d ?? r)!.review_comment && <div><dt>Причина</dt><dd>{(d ?? r)!.review_comment}</dd></div>}
        </dl>
        {d && (
          <div className={s.preview}>
            {preview === null ? (
              <SkeletonText lines={6} />
            ) : preview === '' ? (
              <p className={s.muted}>Файл не открылся. Проверьте хранилище.</p>
            ) : d.mime === 'application/pdf' ? (
              <iframe src={preview} title={`Превью: ${d.file_name}`} />
            ) : d.mime.startsWith('image/') ? (
              <img src={preview} alt={`Превью: ${d.file_name}`} />
            ) : (
              <p className={s.muted}>
                DOCX не отображается в браузере. <a href={preview} download={d.file_name}>Скачать файл</a>
              </p>
            )}
          </div>
        )}
        {pending && (
          <Field
            label="Комментарий"
            hint="Для отклонения обязателен: пользователь увидит его в кабинете"
            error={needReason && comment.trim().length < 5 ? 'Напишите причину отклонения' : undefined}
          >
            {(p) => <Textarea {...p} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: нет подписи и печати организации, проводившей обследование" />}
          </Field>
        )}
      </div>
    </Modal>
  );
}
