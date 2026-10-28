import { TopBar } from './TopBar';
import { ButtonLink } from '../design/components';
import { DocShell } from '../design/DocShell';
import { Footprint } from '../design/Logo';

export function NotFoundPage() {
  return (
    <>
      <TopBar />
      <DocShell>
        <div style={{ display: 'grid', gap: 16, justifyItems: 'start', maxWidth: 520 }}>
          <Footprint size={40} muted />
          <h1 className="display" style={{ fontSize: 26 }}>
            Страницы нет
          </h1>
          <p style={{ color: 'var(--ink-2)' }}>Адрес изменился или в ссылке ошибка. Объекты и отчёты доступны с карты.</p>
          <ButtonLink to="/" variant="primary">
            К карте
          </ButtonLink>
        </div>
      </DocShell>
    </>
  );
}
