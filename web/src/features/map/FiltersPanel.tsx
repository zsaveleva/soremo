import type { BuildingFunction } from '../../api/types';
import { Button, Field, Range, Select } from '../../design/components';
import { FUNCTION_LABEL } from '../../lib/labels';
import { useSession } from '../auth/session';
import { DEFAULT_FILTERS, YEAR_MAX, YEAR_MIN, type Filters } from './useBuildings';
import s from './FiltersPanel.module.css';

const FUNCTIONS: BuildingFunction[] = ['industrial', 'warehouse', 'administrative', 'culture', 'research', 'retail', 'sport'];

type Props = { value: Filters; onChange: (f: Filters) => void; count: number | null };

export function FiltersPanel({ value, onChange, count }: Props) {
  const { user } = useSession();
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => onChange({ ...value, [k]: v });
  const toggleFn = (fn: BuildingFunction) =>
    set('functions', value.functions.includes(fn) ? value.functions.filter((x) => x !== fn) : [...value.functions, fn]);

  return (
    <div className={s.panel}>
      <Range
        label="Год постройки"
        min={YEAR_MIN}
        max={YEAR_MAX}
        value={value.years}
        onChange={(v) => set('years', v)}
        ticks={[1920, 1941, 1956, 1975, 1991]}
      />

      <fieldset className={s.group}>
        <legend className={s.legend}>Исходное назначение</legend>
        <div className={s.chips}>
          {FUNCTIONS.map((fn) => (
            <label key={fn} className={s.chip} data-checked={value.functions.includes(fn) || undefined}>
              <input type="checkbox" checked={value.functions.includes(fn)} onChange={() => toggleFn(fn)} />
              {FUNCTION_LABEL[fn]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className={s.row}>
        <Field label="Площадь здания">
          {(p) => (
            <Select {...p} value={value.area} onChange={(e) => set('area', e.target.value as Filters['area'])}>
              <option value="any">Любая</option>
              <option value="lt2">до 2 000 м²</option>
              <option value="2to10">2 000–10 000 м²</option>
              <option value="10to30">10 000–30 000 м²</option>
              <option value="gt30">больше 30 000 м²</option>
            </Select>
          )}
        </Field>
        <Field label="Техобследование">
          {(p) => (
            <Select {...p} value={value.docs} onChange={(e) => set('docs', e.target.value as Filters['docs'])}>
              <option value="any">Неважно</option>
              <option value="yes">Есть принятые документы</option>
              <option value="no">Документов нет</option>
            </Select>
          )}
        </Field>
      </div>

      <label className={s.check} data-disabled={!user || undefined}>
        <input type="checkbox" checked={value.mine} disabled={!user} onChange={(e) => set('mine', e.target.checked)} />
        <span>
          Только с моими отчётами
          {!user && <span className={s.hint}>Доступно после входа</span>}
        </span>
      </label>

      <div className={s.footer}>
        <span className={s.count} aria-live="polite">
          {count === null ? '' : `Найдено объектов в этой части карты: ${count}`}
        </span>
        <Button size="sm" variant="ghost" onClick={() => onChange(DEFAULT_FILTERS)}>
          Сбросить
        </Button>
      </div>
    </div>
  );
}
