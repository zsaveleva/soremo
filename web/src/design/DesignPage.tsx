import { useState } from 'react';
import { ArrowDownToLine, Map as MapIcon, Plus, RefreshCw, Upload, X } from 'lucide-react';
import { TopBar } from '../app/TopBar';
import { DocSection, DocShell } from './DocShell';
import { Footprint } from './Logo';
import {
  AccuracyMeter,
  Badge,
  BottomSheet,
  Button,
  Field,
  FileDrop,
  Input,
  Modal,
  Panel,
  Range,
  Select,
  Skeleton,
  SkeletonText,
  Stepper,
  Table,
  Tabs,
  Textarea,
  TileSelect,
  ToastView,
  useToast,
  type DropFile,
} from './components';
import { Legend } from '../features/map/Legend';
import { formatArea, formatRubRange, formatYearsRange } from '../lib/format';
import s from './DesignPage.module.css';

const NAV = [
  { id: 'colors', label: 'Цвета' },
  { id: 'type', label: 'Типографика' },
  { id: 'buttons', label: 'Кнопки' },
  { id: 'fields', label: 'Поля ввода' },
  { id: 'tiles', label: 'Плитки выбора' },
  { id: 'range', label: 'Диапазон' },
  { id: 'stepper', label: 'Конфигуратор пакета' },
  { id: 'tabs', label: 'Вкладки' },
  { id: 'table', label: 'Таблица' },
  { id: 'status', label: 'Статусы' },
  { id: 'accuracy', label: 'Точность' },
  { id: 'files', label: 'Загрузка файлов' },
  { id: 'panel', label: 'Панель и лист' },
  { id: 'feedback', label: 'Тосты и окна' },
  { id: 'skeleton', label: 'Скелетон' },
  { id: 'map', label: 'Объекты на карте' },
];

const COLORS = [
  { token: '--paper', hex: '#EFECE6', use: 'Фон страницы и подложка карты' },
  { token: '--surface', hex: '#FFFFFF', use: 'Панели, таблицы, поля ввода' },
  { token: '--ink', hex: '#141414', use: 'Основной текст, обводка объектов, выбранные состояния' },
  { token: '--ink-2', hex: '#5C5A55', use: 'Подписи и вторичный текст' },
  { token: '--line', hex: '#D8D4CC', use: 'Разделители и рамки' },
  { token: '--brick', hex: '#B8402B', use: 'Объекты на карте, primary-кнопка, низкая точность' },
  { token: '--brick-soft', hex: '#F3DED8', use: 'Выделение текста' },
  { token: '--moss', hex: '#3E6B4F', use: 'Принятые документы, высокая точность' },
  { token: '--sand', hex: '#C9A24D', use: 'На проверке, средняя точность' },
];

const TYPE = [
  { size: 48, font: 'display', sample: '12–18 млн ₽', note: 'Unbounded 600, ключевое число в сводке отчёта' },
  { size: 34, font: 'display', sample: 'Заставская ул., 33', note: 'Unbounded 600, заголовок отчёта' },
  { size: 26, font: 'display', sample: 'Большой пр. В.О., 83', note: 'Unbounded 600, адрес в карточке объекта' },
  { size: 20, font: 'text', sample: 'Креативный кластер с коворкингом', note: 'Golos 600, раздел документа' },
  { size: 17, font: 'text', sample: 'Капвложения и срок окупаемости', note: 'Golos 600, подзаголовок' },
  { size: 15, font: 'text', sample: 'Здание у станции «Московские ворота», 260 м пешком. Транспортная доступность выше, чем у 89% объектов базы.', note: 'Golos 400, основной текст, строка 1,5' },
  { size: 13, font: 'text', sample: 'Площадь по геометрии здания в OpenStreetMap', note: 'Golos 400, подписи и примечания' },
];

const SEGMENTS = [
  { value: 'owner', title: 'Собственник', caption: 'Владею зданием или управляю им' },
  { value: 'investor', title: 'Инвестор', caption: 'Ищу объекты для вложений' },
  { value: 'consultant', title: 'Консалтинг', caption: 'Бюро, девелоперская аналитика' },
  { value: 'government', title: 'Госструктура', caption: 'Комитет, ГУП, учреждение' },
  { value: 'other', title: 'Другое', caption: 'Банк, исследователь, студент' },
] as const;

type Tep = { label: string; before: number | string; after: number | string; unit?: 'm2' };
const TEP: Tep[] = [
  { label: 'Общая площадь', before: 16131, after: 17420, unit: 'm2' },
  { label: 'Арендопригодная площадь', before: 0, after: 12940, unit: 'm2' },
  { label: 'Этажность', before: 5, after: '5 + мансарда' },
  { label: 'Машино-места', before: 0, after: 64 },
];

const OBJECTS = [
  { value: 1, label: '1', caption: 'объект' },
  { value: 5, label: '5', caption: 'объектов' },
  { value: 25, label: '25', caption: 'объектов' },
  { value: 100, label: '100', caption: 'объектов' },
  { value: 0, label: 'Все', caption: '≈1000 объектов' },
];

const MONTHS_FOR: Record<number, number[]> = { 1: [1], 5: [1, 3], 25: [1, 3, 6], 100: [3, 6, 12], 0: [6, 12] };

export function DesignPage() {
  const toast = useToast();
  const [segment, setSegment] = useState<(typeof SEGMENTS)[number]['value']>('investor');
  const [kind, setKind] = useState<'individual' | 'company'>('company');
  const [years, setYears] = useState<[number, number]>([1930, 1975]);
  const [objects, setObjects] = useState(5);
  const [months, setMonths] = useState(3);
  const [tab, setTab] = useState<'access' | 'objects' | 'docs'>('objects');
  const [modal, setModal] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [files, setFiles] = useState<DropFile[]>(() => [
    { id: 'a', file: new File([new Uint8Array(4_812_000)], 'Техзаключение_Заставская_33_2024.pdf'), progress: 100 },
    { id: 'b', file: new File([new Uint8Array(12_400_000)], 'Обмерные_чертежи_корпус_Б.pdf'), progress: 46 },
    {
      id: 'c',
      file: new File([new Uint8Array(1200)], 'фасад.heic'),
      error: 'Формат HEIC не принимается. Сохраните фото как JPG или PNG.',
    },
  ]);

  const allowed = MONTHS_FOR[objects]!;

  return (
    <>
      <TopBar />
      <DocShell nav={NAV} navLabel="Компоненты">
        <header className={s.header}>
          <h1 className="display">Дизайн-система</h1>
          <p className={s.intro}>
            Компоненты интерфейса во всех состояниях. Цвета, шрифты и отступы берутся из <code>design/tokens.css</code>;
            экраны продукта собираются только из этих элементов.
          </p>
        </header>

        <DocSection id="colors" title="Цвета" lead="Один акцент — кирпичный. Он появляется только на объектах карты, на primary-кнопке и в индикаторе низкой точности.">
          <Table
            columns={[
              { key: 'sw', header: '', width: '56px', render: (c) => <span className={s.swatch} style={{ background: c.hex }} /> },
              { key: 'token', header: 'Токен', render: (c) => <code>{c.token}</code> },
              { key: 'hex', header: 'Значение', render: (c) => c.hex },
              { key: 'use', header: 'Где используется', render: (c) => c.use },
            ]}
            rows={COLORS}
            rowKey={(c) => c.token}
          />
        </DocSection>

        <DocSection id="type" title="Типографика" lead="Unbounded — только для заголовков экрана, адреса объекта и ключевых чисел. Всё остальное — Golos Text, цифры моноширинные по ширине через tabular-nums.">
          <dl className={s.type}>
            {TYPE.map((t) => (
              <div key={t.size} className={s.typeRow}>
                <dt className={s.typeMeta}>
                  {t.size} px
                  <span>{t.note}</span>
                </dt>
                <dd className={t.font === 'display' ? 'display' : undefined} style={{ fontSize: t.size, fontWeight: t.font === 'text' && t.size > 15 ? 600 : undefined }}>
                  {t.sample}
                </dd>
              </div>
            ))}
          </dl>
        </DocSection>

        <DocSection id="buttons" title="Кнопки" lead="Primary — одно главное действие на экране. Danger — тёмная: необратимые действия в админке.">
          <div className={s.matrix}>
            {(['primary', 'secondary', 'ghost', 'danger'] as const).map((v) => (
              <div key={v} className={s.matrixRow}>
                <span className={s.matrixLabel}>{v}</span>
                <Button variant={v}>{LABELS[v]}</Button>
                <Button variant={v} icon={ICONS[v]}>
                  {LABELS[v]}
                </Button>
                <Button variant={v} pending pendingLabel="Отправляем…">
                  {LABELS[v]}
                </Button>
                <Button variant={v} disabled>
                  {LABELS[v]}
                </Button>
              </div>
            ))}
            <div className={s.matrixRow}>
              <span className={s.matrixLabel}>размеры</span>
              <Button variant="primary" size="lg">
                Оплатить 120 000 ₽
              </Button>
              <Button size="sm" icon={RefreshCw}>
                Пересчитать
              </Button>
              <Button variant="ghost" iconOnly icon={ArrowDownToLine} aria-label="Скачать PDF" />
            </div>
          </div>
          <p className={s.note}>Колонки: обычное, с иконкой, во время выполнения, недоступно. Фокус с клавиатуры — обводка 2 px чернилами.</p>
        </DocSection>

        <DocSection id="fields" title="Поля ввода" lead="Подпись над полем, ошибка под ним и говорит, что сделать. Необязательные поля помечены словом, обязательные — ничем.">
          <div className={s.grid2}>
            <Field label="Email" hint="На этот адрес придёт ссылка для подтверждения">
              {(p) => <Input {...p} type="email" defaultValue="" />}
            </Field>
            <Field label="Email" error="Введите email в формате name@site.ru">
              {(p) => <Input {...p} type="email" defaultValue="office@narvskaya-zastava" />}
            </Field>
            <Field label="Название компании" optional>
              {(p) => <Input {...p} defaultValue="ООО «Нарвская застава»" />}
            </Field>
            <Field label="Площадь здания">
              {(p) => <Input {...p} inputMode="numeric" defaultValue="16 131" suffix="м²" />}
            </Field>
            <Field label="Назначение здания">
              {(p) => (
                <Select {...p} defaultValue="industrial">
                  <option value="industrial">Производственное</option>
                  <option value="warehouse">Складское</option>
                  <option value="culture">Культурно-досуговое</option>
                  <option value="administrative">Административное</option>
                </Select>
              )}
            </Field>
            <Field label="Дата документа">
              {(p) => <Input {...p} type="date" defaultValue="2024-03-14" />}
            </Field>
            <Field label="Год постройки" hint="Только для просмотра: значение из базы">
              {(p) => <Input {...p} defaultValue="1932" disabled />}
            </Field>
            <Field label="Комментарий" optional>
              {(p) => <Textarea {...p} defaultValue="Корпус Б, 3–5 этажи свободны с 2021 года." />}
            </Field>
          </div>
        </DocSection>

        <DocSection id="tiles" title="Плитки выбора" lead="Тип и сегмент при регистрации. Нажимается вся плитка; стрелки клавиатуры переключают выбор внутри группы.">
          <div className={s.stack}>
            <TileSelect
              legend="Вы регистрируетесь как"
              name="ds-type"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'individual', title: 'Физлицо', caption: 'Счёт и доступ на ваше имя' },
                { value: 'company', title: 'Юрлицо', caption: 'Компания, ИП, учреждение' },
              ]}
            />
            <TileSelect legend="Чем вы занимаетесь" name="ds-seg" columns={5} value={segment} onChange={setSegment} options={[...SEGMENTS]} />
            <TileSelect
              legend="Чем вы занимаетесь"
              name="ds-seg-err"
              columns={5}
              value={undefined}
              onChange={() => {}}
              options={[...SEGMENTS]}
              error="Выберите один из вариантов — от него зависят подсказки в кабинете"
            />
          </div>
        </DocSection>

        <DocSection id="range" title="Диапазон" lead="Фильтр года постройки на карте.">
          <div className={s.narrow}>
            <Range label="Год постройки" min={1920} max={1991} value={years} onChange={setYears} ticks={[1920, 1941, 1956, 1975, 1991]} />
          </div>
        </DocSection>

        <DocSection id="stepper" title="Конфигуратор пакета" lead="Недоступные сочетания отключены и заштрихованы, а не скрыты: видно, что срок существует, но не для этого объёма.">
          <div className={s.stack}>
            <Stepper
              legend="Объектов в пакете"
              name="ds-objects"
              value={objects}
              onChange={(v) => {
                setObjects(v);
                if (!MONTHS_FOR[v]!.includes(months)) setMonths(MONTHS_FOR[v]![0]!);
              }}
              options={OBJECTS}
            />
            <Stepper
              legend="Срок доступа"
              name="ds-months"
              value={months}
              onChange={setMonths}
              options={[1, 3, 6, 12].map((m) => ({
                value: m,
                label: String(m),
                caption: m === 1 ? 'месяц' : m === 3 ? 'месяца' : 'месяцев',
                disabled: !allowed.includes(m),
              }))}
            />
          </div>
        </DocSection>

        <DocSection id="tabs" title="Вкладки" lead="Разделы личного кабинета.">
          <Tabs
            label="Разделы кабинета"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'access', label: 'Доступ' },
              { value: 'objects', label: 'Мои объекты', count: 3 },
              { value: 'docs', label: 'Документы', count: 1 },
            ]}
          >
            <p className={s.note}>
              {tab === 'access' && 'Пакет «5 объектов на 3 месяца»: использовано 3 из 5, действует до 28 января 2027.'}
              {tab === 'objects' && 'Три отчёта: Заставская ул., 33; Большой пр. В.О., 83; Цветочная ул., 6 лит.А.'}
              {tab === 'docs' && 'Техзаключение_Заставская_33_2024.pdf — на проверке'}
            </p>
          </Tabs>
        </DocSection>

        <DocSection id="table" title="Таблица" lead="ТЭП «было → станет». Числа по правому краю, шапка отделена линией чернилами, строки — тонкими разделителями.">
          <Table
            caption="Сценарий «Креативный кластер с коворкингом», Заставская ул., 33"
            columns={[
              { key: 'l', header: 'Показатель', render: (r: Tep) => r.label },
              { key: 'b', header: 'Сейчас', numeric: true, render: (r: Tep) => fmtTep(r.before, r.unit) },
              { key: 'a', header: 'После реновации', numeric: true, render: (r: Tep) => fmtTep(r.after, r.unit) },
            ]}
            rows={TEP}
            rowKey={(r) => r.label}
          />
        </DocSection>

        <DocSection id="status" title="Статусы" lead="Квадратная метка — как футпринт на карте. Цвет дублируется словом.">
          <div className={s.row}>
            <Badge tone="pending">На проверке</Badge>
            <Badge tone="accepted">Принят</Badge>
            <Badge tone="rejected">Отклонён</Badge>
            <Badge tone="draft">Черновик без документов</Badge>
            <Badge tone="neutral">Добавлен пользователем</Badge>
          </div>
        </DocSection>

        <DocSection id="accuracy" title="Точность" lead="Один компонент для карточки объекта, отчёта и кабинета. Под шкалой — что нужно для следующего уровня.">
          <div className={s.stack}>
            <AccuracyMeter level="low" />
            <AccuracyMeter level="mid" hint="Принят документ «иное». Техобследование или экспертиза поднимут точность до ≈85%." />
            <AccuracyMeter level="high" />
            <div className={s.narrow}>
              <p className={s.note}>Компактный вариант для таблиц:</p>
              <AccuracyMeter level="mid" compact />
            </div>
          </div>
        </DocSection>

        <DocSection id="files" title="Загрузка файлов" lead="Перетаскивание или выбор на компьютере, прогресс у каждого файла, ошибка говорит, что сделать.">
          <FileDrop
            files={files}
            onAdd={(fs) => setFiles((x) => [...x, ...fs.map((file) => ({ id: crypto.randomUUID(), file }))])}
            onRemove={(id) => setFiles((x) => x.filter((f) => f.id !== id))}
            hint="PDF, DOCX, JPG или PNG, до 50 МБ каждый. Проверка занимает до 2 рабочих дней."
          />
        </DocSection>

        <DocSection id="panel" title="Панель и лист" lead="Панель открывается справа над картой на десктопе. На телефоне та же карточка — нижний лист: свёрнут до шапки, раскрывается по нажатию.">
          <div className={s.mapStage} style={{ '--fragment': `url(${import.meta.env.BASE_URL}map/fragment.jpg)` } as React.CSSProperties}>
            <Panel
              title={<span className={s.panelTitle}>Заставская ул., 33</span>}
              onClose={() => toast({ message: 'Панель закрыта' })}
              footer={
                <Button variant="primary" block>
                  Смоделировать сценарии
                </Button>
              }
            >
              <p className={s.note}>Производственное здание 1932 года, 16 131 м²</p>
              <div style={{ marginTop: 16 }}>
                <AccuracyMeter level="low" />
              </div>
            </Panel>
          </div>
          <div className={s.row} style={{ marginTop: 16 }}>
            <Button onClick={() => setSheet(true)}>Показать нижний лист</Button>
          </div>
          {sheet && (
            <BottomSheet
              title={<span className={s.panelTitle}>Большой пр. В.О., 83</span>}
              onClose={() => setSheet(false)}
              footer={
                <Button variant="primary" block>
                  Открыть пример отчёта
                </Button>
              }
            >
              <p className={s.note}>ДК имени С. М. Кирова, 1937 год, 42 536 м²</p>
            </BottomSheet>
          )}
        </DocSection>

        <DocSection id="feedback" title="Тосты и окна" lead="Тост называет результат и, если можно, предлагает действие. Модальное окно — для подтверждений и превью документа.">
          <div className={s.stack}>
            <ToastView tone="done" message="Документ отправлен на проверку" />
            <ToastView tone="error" message="Не удалось сохранить: нет связи" action={{ label: 'Повторить', onClick: () => {} }} />
            <ToastView message="Доступ открыт до 28 января 2027" />
            <div className={s.row}>
              <Button onClick={() => toast({ tone: 'done', message: 'Доступ открыт' })}>Показать тост</Button>
              <Button onClick={() => setModal(true)}>Открыть окно</Button>
            </div>
          </div>
          <Modal
            open={modal}
            onClose={() => setModal(false)}
            title="Отклонить документ"
            footer={
              <>
                <Button variant="danger" onClick={() => setModal(false)}>
                  Отклонить
                </Button>
                <Button variant="ghost" onClick={() => setModal(false)}>
                  Отмена
                </Button>
              </>
            }
          >
            <div className={s.stack}>
              <p>Техзаключение_Заставская_33_2024.pdf, 4,6 МБ. Пользователь увидит причину в кабинете.</p>
              <Field label="Причина">{(p) => <Textarea {...p} defaultValue="Нет подписи и печати организации, проводившей обследование." />}</Field>
            </div>
          </Modal>
        </DocSection>

        <DocSection id="skeleton" title="Скелетон" lead="Вместо спиннера: форма будущего контента, без мерцания.">
          <div className={s.skeletonCard}>
            <Skeleton width="70%" height={26} />
            <Skeleton width="40%" height={14} />
            <div style={{ height: 8 }} />
            <SkeletonText lines={4} />
          </div>
        </DocSection>

        <DocSection id="map" title="Объекты на карте" lead="Единственный фирменный приём продукта — кирпичный футпринт здания на бумажной карте. Он же — фавикон, знак в логотипе и пустые состояния.">
          <div className={s.mapRow}>
            <Legend />
            <div className={s.empty}>
              <Footprint size={40} muted />
              <p>Пока нет отчётов. Выберите объект на карте.</p>
              <Button icon={MapIcon}>К карте</Button>
            </div>
          </div>
          <p className={s.note}>
            Числа в отчёте: капвложения {formatRubRange({ min: 1.21e9, max: 1.86e9 })}, окупаемость{' '}
            {formatYearsRange({ min: 6.5, max: 9 })} при низкой точности и {formatYearsRange({ min: 4.2, max: 4.2 })} при высокой, площадь{' '}
            {formatArea(16131)}.
          </p>
        </DocSection>
      </DocShell>
    </>
  );
}

const LABELS = { primary: 'Смоделировать', secondary: 'Открыть отчёт', ghost: 'Отмена', danger: 'Отклонить' };
const ICONS = { primary: Plus, secondary: Upload, ghost: RefreshCw, danger: X };

function fmtTep(v: number | string, unit?: 'm2') {
  if (typeof v === 'string') return v;
  if (v === 0) return '—';
  return unit === 'm2' ? formatArea(v) : String(v);
}
