import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { Report } from '../../api/types';
import { TopBar } from '../../app/TopBar';
import { Button, ButtonLink, useToast } from '../../design/components';
import { DocShell } from '../../design/DocShell';
import { useSession } from '../auth/session';
import { ReportSkeleton } from './DemoReportPage';
import { ModelingProgress } from './ModelingProgress';
import { ImproveForUser, ReportView } from './ReportView';
import { usePdfDownload } from './usePdfDownload';
import { IS_STATIC } from '../../api/static';
import { useStartModelling } from './useStartModelling';

const SCENARIOS = { low: 2, mid: 3, high: 4 };

export function ReportPage() {
  const { id } = useParams();
  const { user, loading } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, error, refetch } = useQuery({
    queryKey: ['report', id],
    enabled: !loading && !!user,
    queryFn: () => api<Report>(`/reports/${id}`),
    // Статус опрашивается раз в 1,5 с, пока отчёт считается (ТЗ 8.3).
    refetchInterval: (q) => (q.state.data && (q.state.data.status === 'queued' || q.state.data.status === 'running') ? 1500 : false),
  });
  const pdf = usePdfDownload(`/reports/${id}/pdf`, data ? `SOREMO — ${data.building.address}.pdf` : 'report.pdf');
  const { start, pending } = useStartModelling();

  const wasRunning = useRef(false);
  useEffect(() => {
    if (!data) return;
    if (data.status === 'queued' || data.status === 'running') wasRunning.current = true;
    if (data.status === 'ready' && wasRunning.current) {
      wasRunning.current = false;
      window.scrollTo({ top: 0 });
      void qc.invalidateQueries({ queryKey: ['my-reports'] });
      void qc.invalidateQueries({ queryKey: ['session'] });
      void qc.invalidateQueries({ queryKey: ['building', data.building.id] });
      toast({ tone: 'done', message: 'Отчёт готов и сохранён в кабинете' });
    }
  }, [data, qc, toast]);

  if (!loading && !user)
    return (
      <>
        <TopBar />
        <DocShell>
          <h1 className="display" style={{ fontSize: 26 }}>
            Войдите, чтобы открыть отчёт
          </h1>
          <p style={{ margin: '12px 0 24px', color: 'var(--ink-2)' }}>Отчёты видит только тот, кто их получил.</p>
          <ButtonLink variant="primary" to={`/login?next=/reports/${id}`}>
            Войти
          </ButtonLink>
        </DocShell>
      </>
    );

  if (error)
    return (
      <>
        <TopBar />
        <DocShell>
          <h1 className="display" style={{ fontSize: 26 }}>
            {error instanceof ApiError && error.status === 404 ? 'Отчёт не найден' : 'Не удалось открыть отчёт'}
          </h1>
          <p style={{ margin: '12px 0 24px', color: 'var(--ink-2)' }}>{error.message}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <ButtonLink to="/account?tab=objects">Мои объекты</ButtonLink>
            <Button variant="ghost" onClick={() => refetch()}>
              Повторить
            </Button>
          </div>
        </DocShell>
      </>
    );

  if (!data) return (
    <>
      <TopBar />
      <ReportSkeleton />
    </>
  );

  if (data.status === 'queued' || data.status === 'running')
    return (
      <>
        <TopBar />
        <ModelingProgress b={data.building} scenarios={SCENARIOS[data.accuracy_level]} />
      </>
    );

  if (data.status === 'failed')
    return (
      <>
        <TopBar />
        <DocShell>
          <h1 className="display" style={{ fontSize: 26 }}>
            Расчёт не завершился
          </h1>
          <p style={{ margin: '12px 0 24px', color: 'var(--ink-2)' }}>
            Модель не смогла посчитать сценарии для {data.building.address}. Лимит пакета за повторный запуск не спишется.
          </p>
          <Button variant="primary" onClick={() => start(data.building.id)} pending={pending} pendingLabel="Запускаем…">
            Запустить ещё раз
          </Button>
        </DocShell>
      </>
    );

  // Документы приняты после расчёта — предлагаем бесплатный пересчёт.
  const canRefine = data.building.accuracy.level !== data.accuracy_level;

  return (
    <>
      <TopBar />
      {canRefine && (
        <div role="status" data-no-print style={{ background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
          <div style={{ maxWidth: 1148, margin: '0 auto', padding: '12px 16px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>Документ по объекту принят: точность выросла. Пересчёт бесплатный.</span>
            <Button size="sm" variant="primary" onClick={() => start(data.building.id)} pending={pending} pendingLabel="Запускаем…">
              Пересчитать отчёт
            </Button>
          </div>
        </div>
      )}
      <ReportView
        report={data}
        improveAction={<ImproveForUser buildingId={data.building.id} />}
        // В демо без сервера PDF собирает печать браузера: печатная вёрстка та же, что у серверного PDF.
        onDownload={IS_STATIC ? () => window.print() : pdf.download}
        downloading={pdf.pending}
      />
    </>
  );
}
