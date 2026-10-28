import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getAccessToken, onUnauthorized, refreshSession, setAccessToken, type SessionPayload } from '../../api/client';

export type Segment = 'owner' | 'investor' | 'consultant' | 'government' | 'other';

export type User = {
  id: string;
  email: string;
  type: 'individual' | 'company';
  segment: Segment;
  company_name: string | null;
  phone: string | null;
  role: 'user' | 'admin';
};

export type Access = {
  id: string;
  objects_limit: number | null;
  objects_used: number;
  starts_at: string;
  ends_at: string;
  status: 'active' | 'expired';
  months: number;
};

export type Notification = { id: number; kind: string; text: string; link: string | null; read: boolean; created_at: string };

type Me = { user: User; access: Access | null; notifications: Notification[] };

export type Session = {
  user: User | null;
  access: Access | null;
  notifications: Notification[];
  loading: boolean;
  signIn: (s: SessionPayload) => void;
  signOut: () => Promise<void>;
  reload: () => void;
};

const SessionContext = createContext<Session>({
  user: null,
  access: null,
  notifications: [],
  loading: false,
  signIn: () => {},
  signOut: async () => {},
  reload: () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ['session'],
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<Me | null> => {
      if (!getAccessToken() && !(await refreshSession())) return null;
      try {
        return await api<Me>('/me');
      } catch {
        return null;
      }
    },
  });

  useEffect(() => onUnauthorized(() => void qc.setQueryData<Me | null>(['session'], null)), [qc]);

  const signIn = useCallback(
    (s: SessionPayload) => {
      setAccessToken(s.access_token);
      qc.setQueryData<Me>(['session'], { user: s.user, access: s.access, notifications: [] });
      void qc.invalidateQueries({ queryKey: ['session'] });
      void qc.invalidateQueries({ queryKey: ['building'] });
    },
    [qc],
  );

  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setAccessToken(null);
    qc.setQueryData<Me | null>(['session'], null);
    qc.removeQueries({ queryKey: ['my-reports'] });
    void qc.invalidateQueries({ queryKey: ['building'] });
  }, [qc]);

  const value = useMemo<Session>(
    () => ({
      user: data?.user ?? null,
      access: data?.access ?? null,
      notifications: data?.notifications ?? [],
      loading: isPending,
      signIn,
      signOut,
      reload: () => void qc.invalidateQueries({ queryKey: ['session'] }),
    }),
    [data, isPending, signIn, signOut, qc],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
