import { useState } from 'react';
import { useToast } from '../../design/components';
import { getAccessToken } from '../../api/client';

/** Скачивание PDF отчёта: файл генерируется лениво, первый запрос может занять несколько секунд. */
export function usePdfDownload(path: string, fileName: string) {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const download = async () => {
    setPending(true);
    try {
      const staticUrl = import.meta.env.VITE_STATIC === '1' ? (await import('../../api/static')).staticPdfUrl(path) : null;
      const res = await fetch(staticUrl ?? `/api/v1${path}`, { credentials: 'include', headers: authHeader() });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ tone: 'error', message: 'Не удалось подготовить PDF', action: { label: 'Повторить', onClick: download } });
    } finally {
      setPending(false);
    }
  };
  return { download, pending };
}

function authHeader(): Record<string, string> {
  const t = getAccessToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
