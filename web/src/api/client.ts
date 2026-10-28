export type ApiErrorBody = {
  error: { code: string; message: string; fields?: Record<string, string> };
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

// Access-токен живёт только в памяти; refresh-токен — в httpOnly cookie.
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(t: string | null) {
  accessToken = t;
}

export function getAccessToken() {
  return accessToken;
}

export function onUnauthorized(cb: () => void) {
  onSessionLost = cb;
}

export type SessionPayload = {
  access_token: string;
  user: import('../features/auth/session').User;
  access: import('../features/auth/session').Access | null;
};

/** Был ли вход в этом браузере: флаг ставит API рядом с httpOnly refresh-cookie. */
function hasSessionFlag() {
  return document.cookie.split('; ').some((c) => c === 'soremo_session=1');
}

/** Один общий запрос обновления на все параллельные 401. */
export function refreshSession(): Promise<boolean> {
  if (import.meta.env.VITE_STATIC === '1')
    return import('./static').then(({ hasStaticSession }) => {
      const ok = hasStaticSession();
      setAccessToken(ok ? 'static' : null);
      return ok;
    });
  if (!hasSessionFlag()) return Promise.resolve(false);
  refreshing ??= fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' })
    .then(async (r) => {
      if (!r.ok) {
        setAccessToken(null);
        return false;
      }
      const s = (await r.json()) as SessionPayload;
      setAccessToken(s.access_token);
      lastSession = s;
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export let lastSession: SessionPayload | null = null;

type Init = RequestInit & { json?: unknown };

export async function api<T>(path: string, init: Init = {}, retry = true): Promise<T> {
  if (import.meta.env.VITE_STATIC === '1') {
    const { staticApi } = await import('./static');
    return (await staticApi(path, init.method ?? 'GET', init.json)) as T;
  }
  const { json, ...rest } = init;
  const headers: Record<string, string> = { Accept: 'application/json', ...(rest.headers as Record<string, string>) };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (json !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      credentials: 'include',
      ...rest,
      headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'network', 'Нет связи с сервером');
  }

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api<T>(path, init, false);
    onSessionLost?.();
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      res.status,
      body?.error.code ?? 'network',
      body?.error.message ?? 'Не удалось получить данные: нет связи с сервером',
      body?.error.fields,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
