import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import { useBuilding } from '../../api/queries';
import type { Doc, DocKind } from '../../api/types';
import { upload } from '../../api/upload';
import { TopBar } from '../../app/TopBar';
import { AccuracyMeter, Badge, Button, ButtonLink, Field, FileDrop, Input, Select, Skeleton, Table, useToast } from '../../design/components';
import { formatBytes, formatDateShort } from '../../lib/format';
import { DOC_KIND_LABEL, REVIEW_LABEL, REVIEW_TONE } from '../../lib/labels';
import { useSession } from '../auth/session';
import s from './DocumentsPage.module.css';

const MAX = 50 * 1024 * 1024;
const ACCEPT = '.pdf,.docx,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const OK_EXT = /\.(pdf|docx|jpe?g|png)$/i;

type Item = {
  id: string;
  file: File;
  kind: DocKind;
  issuedOn: string;
  progress?: number;
  error?: string;
  done?: boolean;
};

const today = () => new Date().toISOString().slice(0, 10);

export function DocumentsPage() {
  const id = Number(useParams().id);
  const { user, loading } = useSession();
  const { data: b } = useBuilding(id);
  const qc = useQueryClient();
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [sending, setSending] = useState(false);
  const existing = useQuery({
    queryKey: ['building-docs', id],
    enabled: !!user,
    queryFn: () => api<Doc[]>(`/buildings/${id}/documents`),
  });

  if (!loading && !user) return <Navigate to={`/login?next=/objects/${id}/documents`} replace />;

  const add = (files: File[]) =>
    setItems((xs) => [
      ...xs,
      ...files.map((file) => ({
        id: crypto.randomUUID(),
        file,
        kind: (/обслед|заключ|тех/i.test(file.name) ? 'survey' : 'other') as DocKind,
        issuedOn: '',
        error: !OK_EXT.test(file.name)
          ? 'Формат не подходит: нужны PDF, DOCX, JPG или PNG'
          : file.size > MAX
            ? `Файл ${formatBytes(file.size)} — больше 50 МБ. Сожмите или разделите на части`
            : undefined,
      })),
    ]);
  const patch = (iid: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === iid ? { ...x, ...p } : x)));

  const ready = items.filter((i) => !i.error && !i.done);
  const missingDate = ready.some((i) => !i.issuedOn);

  const send = async () => {
    setSending(true);
    let sent = 0;
    for (const it of ready) {
      const form = new FormData();
      form.set('kind', it.kind);
      form.set('issued_on', it.issuedOn);
      form.set('file', it.file);
      try {
        await upload<Doc>(`/buildings/${id}/documents`, form, (p) => patch(it.id, { progress: p }));
        patch(it.id, { done: true, progress: 100 });
        sent++;
      } catch (e) {
        patch(it.id, { error: e instanceof ApiError ? (e.fields.file ?? e.fields.issued_on ?? e.message) : 'Не удалось загрузить: нет связи', progress: undefined });
      }
    }
    setSending(false);
    if (sent) {
      toast({ tone: 'done', message: sent === 1 ? 'Документ отправлен на проверку' : `Документы отправлены на проверку: ${sent}` });
      setItems((xs) => xs.filter((x) => !x.done));
      void qc.invalidateQueries({ queryKey: ['building-docs', id] });
      void qc.invalidateQueries({ queryKey: ['building', id] });
      void qc.invalidateQueries({ queryKey: ['my-documents'] });
    }
  };

  return (
    <>
      <TopBar />
      <main className={s.page}>
        <ButtonLink to={`/map?b=${id}`} variant="ghost" size="sm" icon={ArrowLeft} className={s.back}>
          К объекту
        </ButtonLink>
        <h1 className={s.title}>Документы по объекту</h1>
        {b ? <p className={s.addr}>{b.address}{b.name ? `, ${b.name}` : ''}</p> : <Skeleton width={260} height={20} />}

        {b && (
          <div className={s.meter}>
            <AccuracyMeter
              level={b.accuracy.level}
              hint={
                b.accuracy.level === 'high'
                  ? 'Принято техобследование: отчёт по объекту можно пересчитать бесплатно.'
                  : 'Техническое обследование или экспертиза поднимут точность до ≈85%, иной документ — до ≈60%.'
              }
            />
          </div>
        )}

        <section className={s.section} aria-labelledby="up-h">
          <h2 id="up-h" className={s.h2}>
            Загрузить
          </h2>
          <FileDrop
            files={items.map((i) => ({ id: i.id, file: i.file, progress: i.progress, error: i.error }))}
            onAdd={add}
            onRemove={(iid) => setItems((xs) => xs.filter((x) => x.id !== iid))}
            accept={ACCEPT}
            disabled={sending}
            hint="PDF, DOCX, JPG или PNG, до 50 МБ каждый. Можно несколько файлов."
          />
          {ready.length > 0 && (
            <ul className={s.meta}>
              {ready.map((it) => (
                <li key={it.id} className={s.metaRow}>
                  <span className={s.fname}>{it.file.name}</span>
                  <Field label="Тип документа">
                    {(p) => (
                      <Select {...p} value={it.kind} disabled={sending} onChange={(e) => patch(it.id, { kind: e.target.value as DocKind })}>
                        <option value="survey">Техническое обследование</option>
                        <option value="expertise">Экспертиза</option>
                        <option value="other">Иной документ</option>
                      </Select>
                    )}
                  </Field>
                  <Field label="Дата документа" error={!it.issuedOn && missingDate && sending ? 'Укажите дату' : undefined}>
                    {(p) => (
                      <Input {...p} type="date" max={today()} min="1950-01-01" value={it.issuedOn} disabled={sending} onChange={(e) => patch(it.id, { issuedOn: e.target.value })} />
                    )}
                  </Field>
                </li>
              ))}
            </ul>
          )}
          <div className={s.actions}>
            <Button variant="primary" disabled={!ready.length || missingDate} onClick={send} pending={sending} pendingLabel="Загружаем…">
              Отправить на проверку
            </Button>
            <p className={s.note}>
              {ready.length && missingDate
                ? 'Укажите дату у каждого документа.'
                : 'Проверка занимает до 2 рабочих дней. Решение придёт в кабинет; после принятия отчёт пересчитывается бесплатно.'}
            </p>
          </div>
        </section>

        <section className={s.section} aria-labelledby="ex-h">
          <h2 id="ex-h" className={s.h2}>
            Загруженные
          </h2>
          {!existing.data ? (
            <Skeleton height={80} />
          ) : (
            <Table
              rows={existing.data}
              rowKey={(d) => d.id}
              empty="По этому объекту документов пока нет."
              columns={[
                {
                  key: 'f',
                  header: 'Файл',
                  render: (d) => (
                    <span className={s.fileCell}>
                      <span>{d.file_name}</span>
                      <span className={s.sub}>
                        {DOC_KIND_LABEL[d.kind]} от {formatDateShort(d.issued_on)}, {formatBytes(d.size)}
                      </span>
                    </span>
                  ),
                },
                { key: 'd', header: 'Загружен', render: (d) => formatDateShort(d.created_at) },
                {
                  key: 's',
                  header: 'Статус',
                  render: (d) => (
                    <span className={s.fileCell}>
                      <Badge tone={REVIEW_TONE[d.status]}>{REVIEW_LABEL[d.status]}</Badge>
                      {d.review_comment && <span className={s.sub}>{d.review_comment}</span>}
                    </span>
                  ),
                },
              ]}
            />
          )}
        </section>
      </main>
    </>
  );
}
