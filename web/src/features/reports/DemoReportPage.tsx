import { useParams } from 'react-router-dom';
import { useDemoReport } from '../../api/queries';
import { TopBar } from '../../app/TopBar';
import { Button, ButtonLink, Skeleton, SkeletonText } from '../../design/components';
import { DocShell } from '../../design/DocShell';
import { ImproveForDemo, ReportView } from './ReportView';
import { usePdfDownload } from './usePdfDownload';

export function DemoReportPage() {
  const id = Number(useParams().buildingId);
  const { data, isError, refetch } = useDemoReport(id);
  const pdf = usePdfDownload(`/demo/reports/${id}/pdf`, data ? `SOREMO — ${data.building.address}.pdf` : 'report.pdf');

  return (
    <>
      <TopBar />
      {isError ? (
        <DocShell>
          <h1 className="display" style={{ fontSize: 26 }}>
            Пример отчёта не найден
          </h1>
          <p style={{ margin: '12px 0 24px', color: 'var(--ink-2)' }}>Примеры есть у трёх зданий, отмеченных на карте.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <ButtonLink to="/">К карте</ButtonLink>
            <Button variant="ghost" onClick={() => refetch()}>
              Повторить
            </Button>
          </div>
        </DocShell>
      ) : !data ? (
        <ReportSkeleton />
      ) : (
        <ReportView report={data} improveAction={<ImproveForDemo />} onDownload={pdf.download} downloading={pdf.pending} />
      )}
    </>
  );
}

export function ReportSkeleton() {
  return (
    <DocShell>
      <div style={{ display: 'grid', gap: 16 }} aria-busy="true" aria-label="Загружаем отчёт">
        <Skeleton width={180} height={14} />
        <Skeleton width="70%" height={38} />
        <Skeleton width="45%" height={18} />
        <div style={{ height: 24 }} />
        <SkeletonText lines={5} />
      </div>
    </DocShell>
  );
}
