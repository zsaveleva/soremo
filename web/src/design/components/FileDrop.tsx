import { useId, useRef, useState, type DragEvent } from 'react';
import { FileText, Upload, X } from 'lucide-react';
import { Icon } from './Icon';
import { formatBytes } from '../../lib/format';
import s from './FileDrop.module.css';

export type DropFile = {
  id: string;
  file: File;
  /** 0–100 во время загрузки; undefined — ещё не отправлен. */
  progress?: number;
  error?: string;
};

type Props = {
  files: DropFile[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  accept?: string;
  hint: string;
  disabled?: boolean;
};

export function FileDrop({ files, onAdd, onRemove, accept, hint, disabled }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!disabled) onAdd(Array.from(e.dataTransfer.files));
  };

  return (
    <div className={s.root}>
      <div
        className={s.zone}
        data-over={over || undefined}
        data-disabled={disabled || undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <Icon as={Upload} size={20} />
        <p className={s.lead}>
          Перетащите файлы сюда или{' '}
          <button type="button" className={s.pick} onClick={() => input.current?.click()} disabled={disabled} aria-describedby={hintId}>
            выберите на компьютере
          </button>
        </p>
        <p className={s.hint} id={hintId}>
          {hint}
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept={accept}
          hidden
          onChange={(e) => {
            onAdd(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </div>
      {files.length > 0 && (
        <ul className={s.list}>
          {files.map((f) => (
            <li key={f.id} className={s.item} data-error={f.error ? true : undefined}>
              <Icon as={FileText} />
              <div className={s.meta}>
                <span className={s.name}>{f.file.name}</span>
                <span className={s.sub}>
                  {f.error ?? (f.progress !== undefined && f.progress < 100 ? `Загружено ${f.progress}%` : formatBytes(f.file.size))}
                </span>
                {f.progress !== undefined && f.progress < 100 && !f.error && (
                  <span
                    className={s.progress}
                    role="progressbar"
                    aria-label={`Загрузка ${f.file.name}`}
                    aria-valuenow={f.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span style={{ width: `${f.progress}%` }} />
                  </span>
                )}
              </div>
              <button type="button" className={s.remove} aria-label={`Убрать ${f.file.name}`} onClick={() => onRemove(f.id)}>
                <Icon as={X} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
