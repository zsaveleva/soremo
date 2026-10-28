import { formatArea, formatPercent } from '../../lib/format';
import s from './ZoningBar.module.css';

// Ступени чернил вместо разных цветов: зонирование читается как штриховка на чертеже,
// а акцентный цвет остаётся за объектами и точностью.
const TONES = ['#141414', '#4a4844', '#7a776f', '#a6a298', '#c9c5bb', '#e3dfd6'];

export function ZoningBar({ zoning, area }: { zoning: { function: string; share: number }[]; area: number }) {
  return (
    <figure className={s.figure}>
      <div className={s.bar} role="img" aria-label={zoning.map((z) => `${z.function} ${formatPercent(z.share)}`).join(', ')}>
        {zoning.map((z, i) => (
          <span key={z.function} style={{ flexGrow: z.share, background: TONES[i % TONES.length] }} />
        ))}
      </div>
      <ul className={s.legend}>
        {zoning.map((z, i) => (
          <li key={z.function}>
            <span className={s.sw} style={{ background: TONES[i % TONES.length] }} aria-hidden />
            <span className={s.fn}>{z.function}</span>
            <span className={s.num}>{formatPercent(z.share)}</span>
            <span className={s.num}>{formatArea(Math.round((area * z.share) / 10) * 10)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
