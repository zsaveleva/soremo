import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Link2, Unlink } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import type { Report } from '../../api/types';
import { TopBar } from '../../app/TopBar';
import { Button, ButtonLink, Icon } from '../../design/components';
import { DocShell } from '../../design/DocShell';
import { ReportSkeleton } from './DemoReportPage';
import { ReportView } from './ReportView';
import { usePdfDownload } from './usePdfDownload';
import s from './SharedReportPage.module.css';

export function SharedReportPage() {
  const { token } = useParams();
  const { data, error, refetch } = useQuery({
    queryKey: ['shared-report', token],
    queryFn: ({ signal }) => api<Report>(`/shared/${encodeURIComponent(token ?? '')}`, { signal }),
    staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: true,
  });
  const pdf = usePdfDownload(`/shared/${encodeURIComponent(token ?? '')}/pdf`, data ? `SOREMO — ${data.building.address}.pdf` : 'report.pdf');
  return <>
    <TopBar />
    {error ? <DocShell>
      <div className={s.error}>
        <Icon as={Unlink} size={28} className={s.errorIcon} />
        <h1 className={s.title}>{error instanceof ApiError && error.status === 404 ? 'Ссылка не действует' : 'Не удалось открыть отчёт'}</h1>
        <p className={s.description}>{error.message}</p>
        <div className={s.actions}>
          <Button onClick={() => refetch()}>Проверить ещё раз</Button>
          <ButtonLink variant="ghost" to="/">К карте</ButtonLink>
        </div>
      </div>
    </DocShell> : !data ? <ReportSkeleton /> : <>
      <div className={s.accessNote} data-no-print><Icon as={Link2} size={16} /><span>Отчёт открыт по ссылке владельца</span></div>
      <ReportView report={data} onDownload={pdf.download} downloading={pdf.pending} />
    </>}
  </>;
}
