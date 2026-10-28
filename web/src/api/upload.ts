import { ApiError, getAccessToken, refreshSession, type ApiErrorBody } from './client';

/** multipart-загрузка через XHR: fetch не сообщает прогресс отправки. */
export function upload<T>(path: string, form: FormData, onProgress: (pct: number) => void, retry = true): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/v1${path}`);
    xhr.withCredentials = true;
    const t = getAccessToken();
    if (t) xhr.setRequestHeader('Authorization', `Bearer ${t}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onerror = () => reject(new ApiError(0, 'network', 'Нет связи с сервером'));
    xhr.onload = async () => {
      if (xhr.status === 401 && retry && (await refreshSession())) {
        upload<T>(path, form, onProgress, false).then(resolve, reject);
        return;
      }
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* пустой ответ */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else {
        const e = (body as ApiErrorBody | null)?.error;
        reject(new ApiError(xhr.status, e?.code ?? 'network', e?.message ?? 'Не удалось загрузить файл', e?.fields));
      }
    };
    xhr.send(form);
  });
}
