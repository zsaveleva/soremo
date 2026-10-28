import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Report } from '../../api/types';
import { Footprint } from '../../design/Logo';
import { ReportView } from './ReportView';
import s from './PrintPage.module.css';

/**
 * Страница, которую печатает headless Chromium в PDF. Тот же ReportView,
 * что в вебе, плюс шапка со знаком и без навигации (ТЗ 8.1, DoD 3).
 */
export function PrintPage({ kind }: { kind: 'user' | 'demo' }) {
  const { id } = useParams();
  const [params] = useSearchParams();
  const token = params.get('token');
  const { data, error } = useQuery({
    queryKey: ['print', kind, id],
    retry: false,
    queryFn: async () => {
      const res = await fetch(kind === 'demo' ? `/api/v1/demo/reports/${id}` : `/api/v1/reports/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as Report;
    },
  });

  useEffect(() => {
    document.documentElement.dataset.print = '1';
    if (!data) return;
    void document.fonts.ready.then(() => {
      document.body.dataset.printReady = '1';
    });
  }, [data]);

  if (error) return <p>Отчёт недоступен для печати.</p>;
  if (!data) return null;
  return (
    <div className={s.print}>
      <header className={s.brand}>
        <Footprint size={22} />
        <span className={s.word}>SOREMO CITY</span>
        <span className={s.kind}>Сценарии реновации здания</span>
      </header>
      <ReportView report={data} print />
    </div>
  );
}
