import { NavLink } from 'react-router-dom';
import { CircleUserRound } from 'lucide-react';
import { Logo } from '../design/Logo';
import { Icon } from '../design/components';
import { useSession } from '../features/auth/session';
import s from './TopBar.module.css';

/** Верхняя строка документных экранов. На карте её роль выполняют плавающие блоки. */
export function TopBar() {
  const { user, loading } = useSession();
  return (
    <header className={s.bar}>
      <Logo />
      <nav className={s.nav} aria-label="Основная навигация">
        <NavLink to="/" end className={s.link}>
          Карта
        </NavLink>
        <NavLink to="/pricing" className={s.link}>
          Пакеты
        </NavLink>
        {user?.role === 'admin' && (
          <NavLink to="/admin" className={s.link}>
            Модерация
          </NavLink>
        )}
        {!loading &&
          (user ? (
            <NavLink to="/account" className={s.link} aria-label="Кабинет">
              <Icon as={CircleUserRound} />
              <span className={s.hideSm}>Кабинет</span>
            </NavLink>
          ) : (
            <NavLink to="/login" className={s.link}>
              Войти
            </NavLink>
          ))}
      </nav>
    </header>
  );
}
