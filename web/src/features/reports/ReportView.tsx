import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownToLine, Info, Upload } from 'lucide-react';
import type { Report, Scenario, TEPValues } from '../../api/types';
import { AccuracyMeter, Badge, Button, ButtonLink, Icon, Table } from '../../design/components';
import { DocSection, DocShell, type DocNavItem } from '../../design/DocShell';
import { FUNCTION_LABEL } from '../../lib/labels';
import { contextRows } from '../../lib/context';
import {
  formatArea,
  formatDate,
  formatMonthsRange,
  formatNumber,
  formatPercent,
  formatRubRange,
  formatYearsRange,
} from '../../lib/format';
import { ZoningBar } from './ZoningBar';
import { FeasibilityBadge, FeasibilityLabel, PassportSummary, PassportTable, SourceLinks, ZonesList } from './Facts';
import s from './ReportView.module.css';

type Props = {
  report: Report;
  /** Блок действий в «Как повысить точность»: у демо — регистрация, у своего отчёта — загрузка. */
  improveAction?: ReactNode;
  onDownload?: () => void;
  downloading?: boolean;
  actions?: ReactNode;
  /** Режим печати: без навигации и интерактивных элементов (PDF). */
  print?: boolean;
};

const SCALE = { local: 'Местного значения', city: 'Общегородского значения' };

export function ReportView({ report, improveAction, onDownload, downloading, actions, print }: Props) {
  const r = report.result!;
  const b = report.building;
  const level = report.accuracy_level;
  const best = r.scenarios[0]!;
  const passport = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    let wasOpen = false;
    const before = () => { if (passport.current) { wasOpen = passport.current.open; passport.current.open = true; } };
    const after = () => { if (passport.current) passport.current.open = wasOpen; };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); };
  }, []);

  const nav: DocNavItem[] = [
    { id: 'summary', label: 'Резюме' },
    { id: 'object', label: 'Объект и контекст' },
    { id: 'constraints', label: 'Зоны и ограничения' },
    ...((r.tech_risks?.length ?? 0) > 0 ? [{ id: 'technical', label: 'Риски техсостояния' }] : []),
    { id: 'scenarios', label: 'Сценарии' },
    ...r.scenarios.map((sc, i) => ({ id: `scenario-${i + 1}`, label: sc.title, level: 2 as const })),
    { id: 'compare', label: 'Сравнение сценариев' },
    ...((r.next_steps?.length ?? 0) > 0 ? [{ id: 'next', label: 'Следующие шаги' }] : []),
    ...(level !== 'high' ? [{ id: 'accuracy', label: 'Как повысить точность' }] : []),
    { id: 'method', label: 'Методика' },
  ];

  return (
    <DocShell nav={print ? undefined : nav} navLabel="Разделы отчёта">
      <article className={s.report} data-print={print || undefined}>
        <header className={s.head}>
          <div className={s.kicker}>
            {report.kind === 'demo' ? (
              <Badge tone="neutral">Пример отчёта</Badge>
            ) : report.refined ? (
              <Badge tone="accepted">Уточнён по документам</Badge>
            ) : (
              <Badge tone="draft">Черновик без документов</Badge>
            )}
            <span>Отчёт от {formatDate(report.finished_at ?? report.created_at)}</span>
          </div>
          <h1 className={s.title}>{b.address}</h1>
          <p className={s.sub}>
            {b.name ? `${b.name}, ` : ''}
            {b.year_built} год, {FUNCTION_LABEL[b.original_function].toLowerCase()}, {formatArea(b.area_total_m2)}
          </p>
          <div className={s.headRow}>
            <div className={s.meter}>
              <AccuracyMeter level={level} hint={level === 'high' ? 'Отчёт уточнён по техобследованию.' : undefined} />
            </div>
            {!print && <div className={s.headActions} data-no-print>
            {onDownload && (
              <Button data-no-print icon={ArrowDownToLine} onClick={onDownload} pending={downloading} pendingLabel="Готовим PDF…">
                Скачать PDF
              </Button>
            )}
            {actions}
            </div>}
          </div>
        </header>

        <DocSection id="summary" title="Резюме">
          <p className={s.summary}>{r.summary}</p>
          <dl className={s.keyNums} aria-label={`Ключевые показатели сценария «${best.title}»`}>
            <div>
              <dt>Капвложения</dt>
              <dd>{formatRubRange(best.economics.capex_rub)}</dd>
            </div>
            <div>
              <dt>Окупаемость</dt>
              <dd>{formatYearsRange(best.economics.payback_years)}</dd>
            </div>
            <div>
              <dt>Выручка в год</dt>
              <dd>{formatRubRange(best.economics.revenue_year_rub)}</dd>
            </div>
          </dl>
          <p className={s.keyNote}>Показатели рекомендуемого сценария «{best.title}».</p>
          {(r.warnings ?? []).length > 0 && (
            <ul className={s.warnings}>
              {(r.warnings ?? []).map((w) => (
                <li key={w}>
                  <Icon as={Info} size={16} />
                  {w}
                </li>
              ))}
            </ul>
          )}
        </DocSection>

        <DocSection id="object" title="Объект и контекст">
          <div className={s.twoCol}>
            <dl className={s.facts}>
              <Fact k="Год постройки" v={String(b.year_built)} />
              <Fact k="Исходное назначение" v={FUNCTION_LABEL[b.original_function]} />
              <Fact k="Площадь здания" v={formatArea(b.area_total_m2)} />
              <Fact k="Этажность" v={String(b.floors)} />
              <Fact k="Площадь участка" v={formatArea(b.area_site_m2)} />
              <Fact k="Зона по ПЗЗ" v={b.pzz_zone} />
              <Fact k="Объект культурного наследия" v={b.is_okn ? 'Да' : 'Нет'} />
            </dl>
            <dl className={s.facts}>
              {contextRows(b.context).map((c) => (
                <Fact key={c.label} k={c.label} v={c.value} />
              ))}
            </dl>
          </div>
          <details ref={passport} className={s.passport} open={print || undefined}>
            <PassportSummary>Паспорт здания: источники и даты</PassportSummary>
            <PassportTable b={b} />
          </details>
          <p className={s.assume}>Окружение можно дополнительно сверить по трафику и спросу в Яндекс Геоаналитике. Автоматической сверки нет.</p>
          <SourceLinks print={print} context />
          {!print && (
            <p className={s.more}>
              <Link to={`/map?b=${b.id}`}>Карточка объекта на карте</Link>
            </p>
          )}
        </DocSection>

        <DocSection id="constraints" title="Зоны и ограничения">
          <ZonesList b={b} />
          <SourceLinks print={print} />
          <p className={s.assume}>Оценка реализуемости — предварительная проверка модели. Демо-разметку и исходные сведения нужно сверить с актуальными данными участка.</p>
        </DocSection>

        {!!r.tech_risks?.length && <DocSection id="technical" title="Риски техсостояния для бюджета">
          <div className={s.technicalSection}>
          <ul className={s.technicalRisks}>{r.tech_risks.map((risk) => <li key={risk.element}>
            <div className={s.technicalBody}><h3>{risk.element}</h3><p>{risk.note}</p></div>
            <div className={s.reserve}><strong>{formatNumber(risk.reserve.min)}–{formatNumber(risk.reserve.max)}<span>%</span></strong><span>резерв</span></div>
          </li>)}</ul>
          <p className={s.explanation}>Резервы показывают чувствительность бюджета к состоянию элементов. Они не прибавлены к капвложениям и не складываются автоматически.</p>
          </div>
        </DocSection>}

        <DocSection
          id="scenarios"
          title="Сценарии"
          lead={`${r.scenarios.length} сценария в порядке рекомендации. Число сценариев зависит от точности: 2 при низкой, 3 при средней, 4 при высокой.`}
        >
          {r.scenarios.map((sc, i) => (
            <ScenarioSection key={sc.title} sc={sc} index={i} level={level} />
          ))}
        </DocSection>

        <DocSection id="compare" title="Сравнение сценариев">
          <Table
            rows={r.scenarios}
            rowKey={(sc) => sc.title}
            columns={[
              { key: 't', header: 'Сценарий', width: '24%', render: (sc) => <span className={s.cmpTitle}>{sc.title}</span> },
              { key: 'f', header: 'Реализуемость', width: '17%', render: (sc) => sc.feasibility ? <FeasibilityBadge status={sc.feasibility.status} /> : 'Не проверена' },
              { key: 'a', header: 'Арендопригодная площадь', numeric: true, render: (sc) => formatArea(sc.tep.after.area_rentable_m2) },
              { key: 'c', header: 'Капвложения', numeric: true, render: (sc) => formatRubRange(sc.economics.capex_rub) },
              { key: 'm', header: 'Срок реализации', numeric: true, render: (sc) => formatMonthsRange(sc.economics.term_months) },
              { key: 'r', header: 'Выручка в год', numeric: true, render: (sc) => formatRubRange(sc.economics.revenue_year_rub) },
              { key: 'p', header: 'Окупаемость', numeric: true, render: (sc) => formatYearsRange(sc.economics.payback_years) },
            ]}
          />
        </DocSection>

        {!!r.next_steps?.length && <DocSection id="next" title="Следующие шаги">
          <ol className={s.nextSteps}>{r.next_steps.map((step, i) => <li key={step}>
            <span className={s.stepNumber} aria-hidden="true">{String(i + 1).padStart(2, '0')}</span><span>{step}</span>
          </li>)}</ol>
        </DocSection>}

        {level !== 'high' && (
          <DocSection id="accuracy" title="Как повысить точность">
            <div className={s.improve}>
              <table className={s.levels}>
                <thead>
                  <tr>
                    <th scope="col" />
                    <th scope="col">Сейчас</th>
                    <th scope="col">После техобследования</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Точность</th>
                    <td>{level === 'low' ? '≈30%' : '≈60%'}</td>
                    <td>≈85%</td>
                  </tr>
                  <tr>
                    <th scope="row">Сценариев</th>
                    <td>{r.scenarios.length}</td>
                    <td>4</td>
                  </tr>
                  <tr>
                    <th scope="row">Числа</th>
                    <td>{level === 'low' ? 'Диапазоны −20…+25%' : 'Диапазоны −10…+12%'}</td>
                    <td>Точечные значения</td>
                  </tr>
                </tbody>
              </table>
              <p>
                Модель не видит состояние каркаса, перекрытий, кровли и инженерных систем — от них зависят капвложения и
                допустимые функции. Подойдёт техническое заключение или экспертиза не старше пяти лет. Проверка занимает до
                2 рабочих дней, пересчёт после неё бесплатный.
              </p>
              {!print && <div data-no-print>{improveAction}</div>}
            </div>
          </DocSection>
        )}

        <DocSection id="method" title="Методика">
          <p className={s.method}>{r.methodology}</p>
          <p className={s.engine}>Версия модели: {report.engine_version}</p>
        </DocSection>
      </article>
    </DocShell>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className={s.fact}>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

const TEP_ROWS: { key: keyof TEPValues; label: string; area?: boolean }[] = [
  { key: 'area_total_m2', label: 'Общая площадь', area: true },
  { key: 'area_rentable_m2', label: 'Арендопригодная площадь', area: true },
  { key: 'floors', label: 'Этажность' },
  { key: 'parking', label: 'Машино-места' },
];

function tepValue(v: number, area?: boolean) {
  if (v === 0) return '—';
  return area ? formatArea(v) : formatNumber(v);
}

function ScenarioSection({ sc, index, level }: { sc: Scenario; index: number; level: Report['accuracy_level'] }) {
  const id = `scenario-${index + 1}`;
  const e = sc.economics;
  const a = sc.assumptions;
  return (
    <section id={id} className={s.scenario} aria-labelledby={`${id}-h`}>
      <div className={s.scHead}>
        <h3 id={`${id}-h`} className={s.scTitle}>
          {sc.title}
        </h3>
        <p className={s.scMeta}>
          {index === 0 ? 'Рекомендуемый сценарий. ' : ''}
          {SCALE[sc.scale]}
        </p>
      </div>
      <p className={s.scText}>{sc.description}</p>

      {sc.feasibility && <div className={s.assessment}>
        <div className={s.assessmentHead}>
          <h4>Проверка реализуемости</h4>
          <FeasibilityBadge status={sc.feasibility.status} />
        </div>
        <ul className={s.checks}>{sc.feasibility.checks.map((check) => <li key={check.text}>
          <FeasibilityLabel status={check.status} /><span>{check.text}</span>
        </li>)}</ul>
      </div>}

      {(sc.pros?.length || sc.cons?.length) ? <div className={s.arguments}>
        <div><h4>Преимущества</h4><ul className={s.positiveList}>{sc.pros?.map((text) => <li key={text}>{text}</li>)}</ul></div>
        <div><h4>Что учесть</h4><ul className={s.cautionList}>{sc.cons?.map((text) => <li key={text}>{text}</li>)}</ul></div>
      </div> : null}

      {sc.evidence && <div className={s.evidence}>
        <div><h4>Данные в расчёте <span>{sc.evidence.confirmed.length}</span></h4><ul>{sc.evidence.confirmed.map((text) => <li key={text}>{text}</li>)}</ul></div>
        <div><h4>Нужно уточнить <span>{sc.evidence.missing.length}</span></h4><ul>{sc.evidence.missing.map((text) => <li key={text}>{text}</li>)}</ul></div>
      </div>}

      <div className={s.tepTable}>
      <h4 className={s.h4}>Технико-экономические показатели</h4>
      <Table
        stack
        rows={TEP_ROWS}
        rowKey={(r) => r.key}
        columns={[
          { key: 'l', header: 'Показатель', render: (r) => r.label },
          { key: 'b', header: 'Сейчас', numeric: true, render: (r) => tepValue(sc.tep.before[r.key], r.area) },
          { key: 'a', header: 'После реновации', numeric: true, render: (r) => tepValue(sc.tep.after[r.key], r.area) },
        ]}
      />
      </div>

      <div className={s.zoning}>
        <h4 className={s.h4}>Функциональное зонирование</h4>
        <ZoningBar zoning={sc.zoning} area={sc.tep.after.area_total_m2} />
      </div>

      <h4 className={s.h4}>Экономика</h4>
      <dl className={s.econ}>
        <div>
          <dt>Капвложения</dt>
          <dd>{formatRubRange(e.capex_rub)}</dd>
        </div>
        <div>
          <dt>Срок реализации</dt>
          <dd>{formatMonthsRange(e.term_months)}</dd>
        </div>
        <div>
          <dt>Выручка в год</dt>
          <dd>{formatRubRange(e.revenue_year_rub)}</dd>
        </div>
        <div>
          <dt>Простая окупаемость</dt>
          <dd>{formatYearsRange(e.payback_years)}</dd>
        </div>
      </dl>
      {a && (
        <p className={s.assume}>
          Допущения: капвложения {formatNumber(a.capex_per_m2_rub / 1000)} тыс. ₽ на м² общей площади, аренда{' '}
          {formatNumber(a.rent_rub_m2_month)} ₽ за м² в месяц, заполняемость {formatPercent(a.occupancy)}, чистый доход{' '}
          {formatPercent(a.noi_share)} выручки.
          {level !== 'high' && ' Диапазон отражает неизвестное техническое состояние.'}
        </p>
      )}

      <h4 className={s.h4}>Риски</h4>
      <ul className={s.risks}>
        {sc.risks.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </section>
  );
}

export function ImproveForDemo() {
  return (
    <div className={s.improveActions}>
      <ButtonLink variant="primary" to="/signup">
        Зарегистрироваться
      </ButtonLink>
      <ButtonLink to="/pricing">Пакеты и цены</ButtonLink>
    </div>
  );
}

export function ImproveForUser({ buildingId }: { buildingId: number }) {
  return (
    <div className={s.improveActions}>
      <ButtonLink variant="primary" icon={Upload} to={`/objects/${buildingId}/documents`}>
        Загрузить техобследование
      </ButtonLink>
    </div>
  );
}
