import { useId, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import type { SearchHit } from '../../api/types';
import { useSearch } from '../../api/queries';
import { Icon } from '../../design/components';
import { FUNCTION_LABEL } from '../../lib/labels';
import s from './AddressSearch.module.css';

/** Поиск по адресу или названию — combobox по шаблону WAI-ARIA. */
export function AddressSearch({ onPick }: { onPick: (hit: SearchHit) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const { data, isFetching } = useSearch(q);
  const hits = data ?? [];
  const showList = open && q.trim().length >= 2;

  const pick = (h: SearchHit) => {
    onPick(h);
    setQ(h.address);
    setOpen(false);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && hits[active]) {
      e.preventDefault();
      pick(hits[active]!);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className={s.root}>
      <label htmlFor={`${listId}-input`} className="visually-hidden">
        Адрес или название здания
      </label>
      <div className={s.field}>
        <Icon as={Search} className={s.icon} />
        <input
          id={`${listId}-input`}
          className={s.input}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && hits[active] ? `${listId}-${hits[active]!.id}` : undefined}
          placeholder="Адрес или название здания"
          autoComplete="off"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
        />
      </div>
      {showList && (
        <div className={s.popover}>
          <ul id={listId} role="listbox" className={s.list} aria-label="Найденные объекты">
            {hits.map((h, i) => (
              <li
                key={h.id}
                id={`${listId}-${h.id}`}
                role="option"
                aria-selected={i === active}
                className={s.option}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(h)}
                onMouseEnter={() => setActive(i)}
              >
                <span className={s.addr}>{h.address}</span>
                <span className={s.meta}>
                  {h.name ?? FUNCTION_LABEL[h.original_function]}, {h.year_built}
                </span>
              </li>
            ))}
          </ul>
          {!isFetching && data && hits.length === 0 && (
            <div className={s.empty}>
              <p>В базе нет такого здания.</p>
              <Link to={`/objects/new?address=${encodeURIComponent(q.trim())}`} onMouseDown={(e) => e.preventDefault()}>
                Добавить объект по адресу
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
