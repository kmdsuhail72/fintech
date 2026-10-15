import type { CSSProperties, ReactNode } from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { instruments } from './marketData.js';
export function PageTitle({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action && <div className="heading-actions">{action}</div>}
    </div>
  );
}

export function Change({ value, suffix = '%' }: { value: number; suffix?: string }) {
  return (
    <span className={`change-value ${value >= 0 ? 'up' : 'down'}`}>
      {value >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
      {value > 0 ? '+' : ''}
      {value.toFixed(2)}
      {suffix}
    </span>
  );
}

export function AssetAvatar({
  symbol,
  color,
  small = false,
}: {
  symbol: string;
  color?: string;
  small?: boolean;
}) {
  const asset = instruments.find((item) => item.symbol === symbol);
  return (
    <span
      className={`asset-logo ${small ? 'small-logo' : ''}`}
      style={{ '--asset-color': color ?? asset?.color ?? '#6c69c5' } as CSSProperties}
    >
      {symbol.slice(0, 1)}
    </span>
  );
}
