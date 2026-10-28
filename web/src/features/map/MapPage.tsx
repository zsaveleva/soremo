import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, CircleUserRound, List, SlidersHorizontal } from 'lucide-react';
import { useBuilding } from '../../api/queries';
import type { BuildingCard } from '../../api/types';
import { BottomSheet, ButtonLink, Icon, Panel } from '../../design/components';
import { Logo } from '../../design/Logo';
import { MOBILE, useMediaQuery } from '../../lib/useMediaQuery';
import { useSession } from '../auth/session';
import { AddressSearch } from './AddressSearch';
import { BuildingMap, type MapHandle } from './BuildingMap';
import { FiltersPanel } from './FiltersPanel';
import { HowItWorks } from './HowItWorks';
import { Legend } from './Legend';
import { ObjectList } from './ObjectList';
import { ObjectActions, ObjectPanelBody, ObjectTitle } from './ObjectPanel';
import { DEFAULT_FILTERS, activeFilterCount, type Filters } from './useBuildings';
import { useStartModelling } from '../reports/useStartModelling';
import s from './MapPage.module.css';

type Drawer = 'filters' | 'list' | 'about' | null;

export function MapPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const mobile = useMediaQuery(MOBILE);
  const { user } = useSession();
  const mapRef = useRef<MapHandle>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [count, setCount] = useState<number | null>(null);

  const selected = params.get('b') ? Number(params.get('b')) : null;
  const { data: card } = useBuilding(selected);
  const { start, pending } = useStartModelling();

  const select = useCallback(
    (id: number | null) => {
      const next = new URLSearchParams(params);
      if (id === null) next.delete('b');
      else next.set('b', String(id));
      // Хэш вида карты сохраняется: ссылка на объект открывает тот же фрагмент.
      navigate({ pathname: '/map', search: next.toString() ? `?${next}` : '', hash: window.location.hash }, { replace: id === null });
    },
    [navigate, params],
  );

  // Ссылка /map?b=… без хэша — подлетаем к объекту, когда карточка загрузилась.
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (card && !focusedOnce.current && !window.location.hash) mapRef.current?.focus(card.center);
    if (card) focusedOnce.current = true;
  }, [card]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && selected !== null && select(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, select]);

  const toggle = (d: Drawer) => setDrawer((cur) => (cur === d ? null : d));
  const nFilters = activeFilterCount(filters);
  const onModel = (b: BuildingCard) => start(b.id);

  const panel =
    selected !== null &&
    (mobile ? (
      <BottomSheet
        key={selected}
        labelledBy="object-title"
        title={<ObjectTitle id={selected} />}
        onClose={() => select(null)}
        footer={<ObjectActions b={card} onModel={onModel} modelling={pending} />}
      >
        <ObjectPanelBody id={selected} />
      </BottomSheet>
    ) : (
      <Panel
        key={selected}
        labelledBy="object-title"
        title={<ObjectTitle id={selected} />}
        onClose={() => select(null)}
        footer={<ObjectActions b={card} onModel={onModel} modelling={pending} />}
      >
        <ObjectPanelBody id={selected} />
      </Panel>
    ));

  return (
    <main className={s.page}>
      <h1 className="visually-hidden">Карта нежилых зданий Петербурга 1920–1991 годов</h1>
      <BuildingMap
        ref={mapRef}
        filters={filters}
        selectedId={selected}
        onSelect={select}
        onCount={setCount}
        inset={selected === null ? {} : mobile ? { bottom: Math.round(window.innerHeight * 0.46) } : { right: 480 }}
      />

      <div className={s.control} data-open={drawer ?? undefined}>
        <div className={s.brand}>
          <Logo to="/" />
          <p className={s.lead}>Сценарии реновации советских нежилых зданий Петербурга</p>
        </div>
        <AddressSearch
          onPick={(h) => {
            select(h.id);
            mapRef.current?.focus(h.center);
            setDrawer(null);
          }}
        />
        <div className={s.toggles} role="group" aria-label="Инструменты карты">
          <button type="button" className={s.toggle} aria-expanded={drawer === 'filters'} onClick={() => toggle('filters')}>
            <Icon as={SlidersHorizontal} size={16} />
            Фильтры{nFilters > 0 && <span className={s.badge}>{nFilters}</span>}
          </button>
          <button type="button" className={s.toggle} aria-expanded={drawer === 'list'} onClick={() => toggle('list')}>
            <Icon as={List} size={16} />
            Списком
          </button>
          <button type="button" className={s.toggle} aria-expanded={drawer === 'about'} onClick={() => toggle('about')}>
            Как это работает
            <Icon as={ChevronDown} size={16} className={s.chev} />
          </button>
        </div>
        {drawer && (
          <div className={s.drawer}>
            {drawer === 'filters' && <FiltersPanel value={filters} onChange={setFilters} count={count} />}
            {drawer === 'list' && (
              <ObjectList
                filters={filters}
                onPick={(id, center) => {
                  select(id);
                  if (center) mapRef.current?.focus(center);
                  if (mobile) setDrawer(null);
                }}
              />
            )}
            {drawer === 'about' && <HowItWorks />}
          </div>
        )}
      </div>

      <div className={s.account}>
        {user ? (
          <ButtonLink to="/account" icon={CircleUserRound} className={s.accountBtn}>
            {user.company_name ?? user.email}
          </ButtonLink>
        ) : (
          <ButtonLink to="/login">Войти</ButtonLink>
        )}
      </div>

      {!(mobile && selected !== null) && (
        <div className={s.legend}>
          <Legend />
        </div>
      )}

      {panel && <div className={s.panelSlot}>{panel}</div>}
    </main>
  );
}
