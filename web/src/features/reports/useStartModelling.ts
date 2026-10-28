import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useToast } from '../../design/components';

/** Запуск моделирования: POST → экран ожидания /reports/:id (ТЗ 4.3). */
export function useStartModelling() {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (buildingId: number) =>
      api<{ report_id: string; status: string }>(`/buildings/${buildingId}/reports`, { method: 'POST' }),
    onSuccess: (r, buildingId) => {
      qc.invalidateQueries({ queryKey: ['session'] });
      qc.invalidateQueries({ queryKey: ['building', buildingId] });
      navigate(`/reports/${r.report_id}`);
    },
    onError: (e, buildingId) => {
      const msg =
        e instanceof ApiError && e.code === 'quota_exceeded'
          ? 'Лимит пакета исчерпан: выберите пакет больше'
          : e instanceof ApiError && e.code === 'access_expired'
            ? 'Срок доступа закончился: продлите пакет'
            : e instanceof ApiError && e.status !== 0 && e.code !== 'network'
              ? e.message
              : 'Не удалось запустить моделирование: нет связи';
      toast({ tone: 'error', message: msg, action: { label: 'Повторить', onClick: () => m.mutate(buildingId) } });
    },
  });
  return { start: m.mutate, pending: m.isPending };
}
