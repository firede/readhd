import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { IconInfo } from './icons';

let uid = 0;
const nextId = () => `rh-${++uid}`;

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  const id = useRef(nextId()).current;
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`rh-switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="knob" />
    </button>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="rh-seg" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          className={`rh-segbtn ${value === o.value ? 'sel' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Slider for nullable settings: unset shows a disabled track and an "调整"
 * chip; set shows the value and a "恢复默认" chip.
 */
export function Slider({
  label,
  value,
  defaultValue,
  min,
  max,
  step,
  format = (v: number) => String(v),
  onChange,
}: {
  label: string;
  value: number | null;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number | null) => void;
}) {
  const set = value != null;
  const id = useRef(nextId()).current;
  return (
    <div className="rh-slider">
      <label htmlFor={id} className="lbl">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        disabled={!set}
        value={set ? value : defaultValue}
        className={set ? '' : 'unset'}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="val">{set ? format(value) : '默认'}</span>
      <button
        type="button"
        className="rh-chip"
        onClick={() => onChange(set ? null : defaultValue)}
      >
        {set ? '恢复默认' : '调整'}
      </button>
    </div>
  );
}

export function Swatch({
  color,
  name,
  selected,
  onClick,
}: {
  color: string;
  name: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rh-swatch ${selected ? 'sel' : ''}`}
      style={{ '--sw': color } as CSSProperties}
      title={name}
      aria-label={name}
      aria-pressed={selected}
      onClick={onClick}
    />
  );
}

export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);
  return (
    <span className="rh-tip" ref={ref}>
      <button
        type="button"
        className="rh-tipbtn"
        aria-label="说明"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <IconInfo />
      </button>
      <span className={`rh-tipbox ${open ? 'open' : ''}`} role="tooltip">
        {text}
      </span>
    </span>
  );
}

export function Card({
  title,
  children,
  className = '',
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rh-card ${className}`}>
      {title != null && <h2 className="rh-card-title">{title}</h2>}
      {children}
    </section>
  );
}

export function Button({
  children,
  variant = 'secondary',
  icon,
  onClick,
  disabled,
  type = 'button',
  className = '',
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      type={type}
      className={`rh-btn ${variant} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      {children}
    </button>
  );
}

export function StatusBadge({
  kind,
  children,
}: {
  kind: 'ok' | 'warn' | 'danger' | 'muted';
  children: ReactNode;
}) {
  return <div className={`rh-badge ${kind}`}>{children}</div>;
}
