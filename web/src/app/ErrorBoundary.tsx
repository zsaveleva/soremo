import { Component, type ReactNode } from 'react';
import { Footprint } from '../design/Logo';

type State = { failed: boolean };

/** Если экран упал, показываем, что делать, а не белую страницу. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main style={{ maxWidth: 560, margin: '0 auto', padding: '64px 16px', display: 'grid', gap: 16, justifyItems: 'start' }}>
        <Footprint size={40} muted />
        <h1 className="display" style={{ fontSize: 26 }}>
          Экран не открылся
        </h1>
        <p style={{ color: 'var(--ink-2)' }}>
          Ошибка в интерфейсе. Данные не потеряны: отчёты и документы сохранены в кабинете. Обновите страницу или вернитесь к карте.
        </p>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ height: 40, padding: '0 16px', border: 0, borderRadius: 4, background: 'var(--brick)', color: '#fff', fontWeight: 500, cursor: 'pointer' }}
          >
            Обновить страницу
          </button>
          <a href={import.meta.env.BASE_URL}>К карте</a>
        </div>
      </main>
    );
  }
}
