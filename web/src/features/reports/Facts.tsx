import type { ReactNode } from 'react';
import { ExternalLink, Minus, Plus } from 'lucide-react';
import type { BuildingCard, Feasibility } from '../../api/types';
import { Badge, Icon, type BadgeTone } from '../../design/components';
import { EXTERNAL, STATUS_LABEL, ZONE_EFFECT, coordsLabel, passportRows, sourceDate } from '../../lib/passport';
import s from './Facts.module.css';

export function PassportSummary({ children }: { children: ReactNode }) {
  return (
    <summary className={s.passportToggle}>
      <span className={s.toggleText}>
        <span>{children}</span>
        <span className={s.toggleHint}>Происхождение данных и отметки достоверности</span>
      </span>
      <span className={s.toggleIcons} aria-hidden="true">
        <Icon as={Plus} className={s.plus} />
        <Icon as={Minus} className={s.minus} />
      </span>
    </summary>
  );
}

export const FEASIBILITY: Record<Feasibility, { label: string; tone: BadgeTone }> = {
  feasible: { label: 'Реализуемо', tone: 'accepted' },
  check: { label: 'Нужна проверка', tone: 'pending' },
  restricted: { label: 'Есть ограничение', tone: 'rejected' },
};

export function FeasibilityBadge({ status }: { status: Feasibility }) {
  return <span className={s.feasibility}><Badge tone={FEASIBILITY[status].tone}>{FEASIBILITY[status].label}</Badge></span>;
}

/** Компактная подпись для оснований: основной статус остаётся у итога проверки. */
export function FeasibilityLabel({ status }: { status: Feasibility }) {
  return <span className={s.checkStatus} data-status={status}>
    <span className={s.checkMark} aria-hidden="true" />
    {FEASIBILITY[status].label}
  </span>;
}

/** Зоны с особыми условиями: что пересекает участок и что это значит для проекта. */
export function ZonesList({ b, compact }: { b: BuildingCard; compact?: boolean }) {
  const z = b.zones;
  if (!z)
    return <div className={s.zoneSource}>
      <strong>Пересечения с зонами не проверены</strong>
      <p>Сверьте участок в РГИС и НСПД по координатам {coordsLabel(b.center)}.</p>
    </div>;
  const items = compact ? z.items.filter((x) => x.effect !== 'info') : z.items;
  return (
    <div className={s.zones}>
      <ul className={s.zoneList}>
        {items.map((x) => (
          <li key={x.code} className={s.zone}>
            <div className={s.zoneHead}>
              <span className={s.zoneTitle}>{x.title}</span>
              <Badge tone={ZONE_EFFECT[x.effect].tone}>{ZONE_EFFECT[x.effect].label}</Badge>
            </div>
            <p className={s.zoneNote}>{x.note}</p>
          </li>
        ))}
      </ul>
      {items.length === 0 && <p className={s.empty}>В наборе данных зон с ограничениями не найдено.</p>}
      <div className={s.zoneSource}>
        <div className={s.sourceHeading}>
          <strong>{z.demo ? 'Демо-разметка, нужна сверка' : z.source}</strong>
          <span>От {sourceDate(z.checked_on)}</span>
        </div>
        <p>{z.demo
          ? `Зоны определены по правилам модели. Проверьте участок в РГИС и НСПД по координатам ${coordsLabel(b.center)}.`
          : `Источник: ${z.source}. Сверьте актуальность сведений перед принятием решения.`}</p>
        {compact && z.items.some((x) => x.effect === 'info') && <p>Справочные зоны — в отчёте.</p>}
      </div>
    </div>
  );
}

export function SourceLinks({ print, context }: { print?: boolean; context?: boolean }) {
  const links = context ? [EXTERNAL.yandex] : [EXTERNAL.rgis, EXTERNAL.nspd];
  const short = context ? ['Яндекс Геоаналитика'] : ['РГИС Петербурга', 'НСПД'];
  return (
    <ul className={s.links}>
      {links.map((l, i) => (
        <li key={l.url}>
          {print ? `${l.title}: ${l.url}` : (
            <a href={l.url} target="_blank" rel="noreferrer" aria-label={l.title}>
              {short[i]}<Icon as={ExternalLink} size={14} />
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Собственная таблица с перестройкой по ширине контейнера: работает и в панели карты. */
export function PassportTable({ b }: { b: BuildingCard }) {
  const rows = passportRows(b);
  return (
    <div className={s.passportBody}>
      <p className={s.passportIntro}>Оценочные значения требуют уточнения по документам. Дата относится к источнику данных.</p>
      <table className={s.passportTable}>
        <thead><tr><th scope="col">Показатель</th><th scope="col">Значение</th><th scope="col">Источник</th><th scope="col">Дата</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.label}>
          <th scope="row">{r.label}</th>
          <td className={s.value}>{r.value}</td>
          <td className={s.sourceCell}>
            <span className={s.src}>{r.source}</span>
            <span className={s.sourceStatus} data-status={r.status}><span aria-hidden="true" />{STATUS_LABEL[r.status]}</span>
          </td>
          <td className={s.date}>{r.date ? <><span className={s.dateLabel}>Дата источника</span>{sourceDate(r.date)}</> : 'Дата не указана'}</td>
        </tr>)}</tbody>
      </table>
    </div>
  );
}
