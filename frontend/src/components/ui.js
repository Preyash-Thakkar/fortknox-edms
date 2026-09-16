import React from 'react';

// Material Symbols icon
export const Icon = ({ name, className = '', fill = 0, size }) => (
  <span
    className={`material-symbols-outlined ${className}`}
    style={{ fontVariationSettings: `'FILL' ${fill}`, fontSize: size ? `${size}px` : undefined }}
  >
    {name}
  </span>
);

// Sensitivity badge — exact mapping from DESIGN.md
export function SensitivityBadge({ level }) {
  const map = {
    'Strictly Confidential': { cls: 'bg-error text-on-error', icon: 'lock' },
    Confidential: { cls: 'bg-amber-500 text-black', icon: 'warning' },
    Internal: { cls: 'bg-slate-200 text-slate-800', icon: null },
    Public: { cls: 'bg-emerald-100 text-emerald-800', icon: 'public' },
  };
  const s = map[level] || map.Internal;
  return (
    <span
      className={`px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-tight inline-flex items-center gap-1 w-fit ${s.cls}`}
    >
      {s.icon && <Icon name={s.icon} size={12} fill={1} />}
      {level}
    </span>
  );
}

// File-type icon, blueprint/code/legal motifs
export function FileTypeIcon({ filename = '', type = '' }) {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (['dwg', 'dxf', 'step', 'stp', 'iges', 'brd', 'sch'].includes(ext))
    return <Icon name="architecture" className="text-secondary" />;
  if (['js', 'ts', 'py', 'cpp', 'c', 'java', 'json', 'xml'].includes(ext))
    return <span className="font-data-mono text-secondary font-bold text-[15px]">&lt;/&gt;</span>;
  if (ext === 'pdf') return <Icon name="picture_as_pdf" className="text-error" fill={1} />;
  if (['xlsx', 'xls', 'csv'].includes(ext)) return <Icon name="table_chart" className="text-tertiary" fill={1} />;
  return <Icon name="description" className="text-secondary" />;
}

export function Button({ variant = 'primary', icon, children, className = '', ...rest }) {
  const variants = {
    primary: 'bg-primary text-on-primary hover:opacity-90 font-bold',
    secondary: 'bg-transparent border border-primary text-primary hover:bg-surface-container-high',
    ghost: 'bg-transparent border border-outline-variant text-on-surface hover:bg-surface-container-high',
    destructive: 'bg-transparent border border-error text-error hover:bg-error-container',
  };
  return (
    <button
      className={`flex items-center justify-center gap-2 px-4 py-2 rounded font-label-lg text-label-lg transition-all ${variants[variant]} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}

export function Card({ title, action, children, className = '' }) {
  return (
    <div className={`bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-md py-3 border-b border-outline-variant">
          <h3 className="font-headline-sm text-headline-sm text-primary">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function StatCard({ icon, label, value, accent = 'text-primary' }) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-lg flex items-center gap-md">
      <div className="w-12 h-12 rounded-lg bg-surface-container flex items-center justify-center shrink-0">
        <Icon name={icon} className={accent} fill={1} size={26} />
      </div>
      <div className="min-w-0">
        <p className="font-label-md text-label-md text-on-surface-variant uppercase tracking-widest truncate">
          {label}
        </p>
        <p className={`font-headline-md text-headline-md ${accent}`}>{value}</p>
      </div>
    </div>
  );
}

export function RoleBadge({ role }) {
  return (
    <span className="px-2 py-0.5 rounded-sm bg-secondary-container text-on-secondary-container text-[10px] font-bold uppercase tracking-wide">
      {role}
    </span>
  );
}

export function EmptyState({ icon = 'inbox', title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center py-xl text-center text-on-surface-variant">
      <Icon name={icon} size={40} className="mb-sm opacity-50" />
      <p className="font-body-md text-body-md font-semibold">{title}</p>
      {subtitle && <p className="font-body-sm text-body-sm mt-1">{subtitle}</p>}
    </div>
  );
}

export function bytes(n) {
  if (!n) return '--';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}
