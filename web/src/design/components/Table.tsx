import type { ReactNode } from 'react';
import s from './Table.module.css';

export type Column<R> = {
  key: string;
  header: ReactNode;
  /** Числа выравниваются по правому краю (ТЗ 6.4). */
  numeric?: boolean;
  width?: string;
  render: (row: R) => ReactNode;
};

type Props<R> = {
  caption?: ReactNode;
  columns: Column<R>[];
  rows: R[];
  rowKey: (row: R) => string | number;
  onRowClick?: (row: R) => void;
  dense?: boolean;
  empty?: ReactNode;
};

export function Table<R>({ caption, columns, rows, rowKey, onRowClick, dense, empty }: Props<R>) {
  return (
    <div className={s.scroll}>
      <table className={s.table} data-dense={dense || undefined}>
        {caption && <caption className={s.caption}>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" data-numeric={c.numeric || undefined} style={{ width: c.width }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && empty ? (
            <tr>
              <td colSpan={columns.length} className={s.empty}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr
                key={rowKey(r)}
                data-clickable={onRowClick ? true : undefined}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} data-numeric={c.numeric || undefined}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
