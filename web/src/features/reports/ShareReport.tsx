import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Share2 } from 'lucide-react';
import { api } from '../../api/client';
import type { Report, ReportShare } from '../../api/types';
import { Badge, Button, Input, Modal, useToast } from '../../design/components';
import s from './ShareReport.module.css';

export function ShareReport({ report }: { report: Report }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const share = report.share;
  const url = share ? new URL(`${import.meta.env.BASE_URL}shared/${share.token}`, window.location.origin).href : '';
  const update = (value: ReportShare | undefined) => {
    qc.setQueryData<Report>(['report', report.id], (old) => old ? { ...old, share: value } : old);
  };
  const create = useMutation({
    mutationFn: () => api<ReportShare>(`/reports/${report.id}/share`, { method: 'POST' }),
    onSuccess: (value) => update(value),
  });
  const revoke = useMutation({
    mutationFn: () => api<void>(`/reports/${report.id}/share`, { method: 'DELETE' }),
    onSuccess: () => { update(undefined); toast({ message: 'Доступ по ссылке закрыт', tone: 'done' }); },
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ message: 'Ссылка скопирована', tone: 'done' });
    } catch {
      toast({ message: 'Выделите и скопируйте ссылку из поля', tone: 'info' });
    }
  };
  return <>
    <Button icon={Share2} onClick={() => setOpen(true)}>Поделиться отчётом</Button>
    <Modal open={open} onClose={() => setOpen(false)} title="Поделиться отчётом" footer={
      <div className={s.actions}>
        {share ? <>
          <Button variant="ghost" onClick={() => revoke.mutate()} pending={revoke.isPending} pendingLabel="Закрываем…">Закрыть доступ</Button>
          <Button variant="primary" icon={Copy} onClick={copy}>Копировать ссылку</Button>
        </> : <Button variant="primary" icon={Share2} onClick={() => create.mutate()} pending={create.isPending} pendingLabel="Создаём…">Создать ссылку</Button>}
      </div>
    }>
      <div className={s.content}>
        <p className={s.intro}>Для инвестора или банка</p>
        <div className={s.document}>
          <span className={s.documentLabel}>Сценарии реновации</span>
          <p>{report.building.address}</p>
          {report.building.name && <span className={s.documentLabel}>{report.building.name}</span>}
        </div>
        <div className={s.accessState} role="status">
          <Badge tone={share ? 'accepted' : 'neutral'}>{share ? 'Доступ по ссылке открыт' : 'Доступ по ссылке закрыт'}</Badge>
        </div>
        {share ? <>
          <label className={s.field}>Ссылка на отчёт
            <Input value={url} readOnly onFocus={(e) => e.target.select()} />
          </label>
          <p className={s.note}>Любой, у кого есть ссылка, сможет прочитать отчёт и скачать PDF без входа. Данные владельца скрыты.</p>
          <p className={s.revokeNote}>Доступ можно закрыть в любой момент. Уже скачанные копии останутся у получателя.</p>
        </> : <>
          <p className={s.note}>Ссылка откроет просмотр отчёта и скачивание PDF без регистрации. Данные владельца останутся скрыты.</p>
          <p className={s.revokeNote}>Вы управляете доступом. После его закрытия прежняя ссылка перестанет работать.</p>
        </>}
        {(create.error || revoke.error) && <p className={s.error} role="alert">{(create.error || revoke.error)?.message}</p>}
      </div>
    </Modal>
  </>;
}
