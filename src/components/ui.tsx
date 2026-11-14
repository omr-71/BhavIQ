import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export const SurfaceCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
  onClick?: () => void;
}> = ({ children, className = '', interactive = false, onClick }) => {
  const baseClasses =
    'bhaviq-card-3d bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 border-b-[4px] border-r-[2px] border-b-gray-200 border-r-gray-200 dark:border-b-slate-700 dark:border-r-slate-700 rounded-2xl shadow-sm transition-all duration-300';

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${baseClasses} bhaviq-card-lift hover:-translate-y-1 hover:shadow-lg cursor-pointer text-left w-full ${className}`}
      >
        {children}
      </button>
    );
  }
  return (
    <div
      className={`${baseClasses} ${
        interactive
          ? 'bhaviq-card-lift hover:-translate-y-1 hover:shadow-lg cursor-pointer'
          : ''
      } ${className}`}
    >
      {children}
    </div>
  );
};

export const KpiCard: React.FC<{
  label: string;
  value: string;
  subtext?: string;
  tone?: 'neutral' | 'positive' | 'warning' | 'danger';
  accentTop?: 'indigo' | 'emerald' | 'amber' | 'rose' | 'slate' | 'purple';
  icon?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}> = ({
  label,
  value,
  subtext,
  tone = 'neutral',
  accentTop,
  icon,
  className = '',
  onClick,
}) => {
  const isUnavailable = value === 'Not enough data';
  const toneText =
    tone === 'positive'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'warning'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'danger'
          ? 'text-rose-600 dark:text-rose-400'
          : 'text-slate-900 dark:text-slate-100';

  const resolvedTop =
    accentTop ||
    (tone === 'positive'
      ? 'emerald'
      : tone === 'warning'
        ? 'amber'
        : tone === 'danger'
          ? 'rose'
          : 'indigo');

  const topBarClass =
    resolvedTop === 'emerald'
      ? 'from-emerald-500 via-teal-400 to-emerald-500'
      : resolvedTop === 'amber'
        ? 'from-amber-500 via-orange-400 to-amber-500'
        : resolvedTop === 'rose'
          ? 'from-rose-500 via-red-400 to-rose-500'
          : resolvedTop === 'purple'
            ? 'from-purple-500 via-violet-400 to-purple-500'
            : resolvedTop === 'slate'
              ? 'from-slate-400 via-slate-300 to-slate-400 dark:from-slate-600 dark:via-slate-500 dark:to-slate-600'
              : 'from-indigo-500 via-blue-500 to-indigo-500';

  const iconBackdropClass =
    resolvedTop === 'emerald'
      ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shadow-md shadow-emerald-500/30 ring-1 ring-emerald-500/20'
      : resolvedTop === 'amber'
        ? 'bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 shadow-md shadow-amber-500/30 ring-1 ring-amber-500/20'
        : resolvedTop === 'rose'
          ? 'bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400 shadow-md shadow-rose-500/30 ring-1 ring-rose-500/20'
          : resolvedTop === 'purple'
            ? 'bg-purple-50 dark:bg-purple-500/15 text-purple-600 dark:text-purple-400 shadow-md shadow-purple-500/30 ring-1 ring-purple-500/20'
            : resolvedTop === 'slate'
              ? 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 shadow-sm shadow-slate-500/15 ring-1 ring-slate-400/20'
              : 'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 shadow-md shadow-indigo-500/30 ring-1 ring-indigo-500/20';

  return (
    <SurfaceCard
      onClick={onClick}
      className={`group relative overflow-hidden p-5 flex flex-col justify-between gap-3 ${className}`}
    >
      <div
        aria-hidden="true"
        className={`absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r ${topBarClass}`}
      />
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-tight">
          {label}
        </span>
        {icon && (
          <span
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110 ${iconBackdropClass}`}
          >
            {icon}
          </span>
        )}
      </div>
      <div>
        <span
          className={
            isUnavailable
              ? 'text-sm md:text-base font-semibold text-slate-400 dark:text-slate-500'
              : `font-mono-num text-2xl lg:text-3xl font-extrabold tracking-tight ${toneText}`
          }
        >
          {value}
        </span>
      </div>
      {subtext && (
        <span className="text-xs text-slate-500 dark:text-slate-400 leading-snug">
          {subtext}
        </span>
      )}
    </SurfaceCard>
  );
};

export const EmptyStateCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ icon, title, description, actionLabel, onAction }) => (
  <SurfaceCard className="p-8 md:p-10 text-center flex flex-col items-center justify-center max-w-lg mx-auto">
    <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-4 shadow-sm shadow-indigo-500/10">
      {icon}
    </div>
    <h3 className="font-display text-base md:text-lg font-bold text-[var(--text-primary)] mb-1.5">
      {title}
    </h3>
    <p className="text-sm text-[var(--text-secondary)] max-w-sm mb-5 leading-relaxed">
      {description}
    </p>
    {actionLabel && onAction && (
      <button
        type="button"
        onClick={onAction}
        className="bhaviq-btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap min-h-[42px]"
      >
        {actionLabel}
      </button>
    )}
  </SurfaceCard>
);

export const ResponsiveDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidthClass?: string;
}> = ({ open, onClose, title, subtitle, children, maxWidthClass = 'max-w-xl' }) => {
  if (!open) return null;

  const modalNode = (
    <div
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-slate-950/55 backdrop-blur-[3px]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="min-h-full flex items-end md:items-center justify-center p-2 sm:p-4 md:p-6">
        <div
          onClick={(e) => e.stopPropagation()}
          className={`relative z-10 w-full ${maxWidthClass} bg-[var(--bg-surface)] border border-[var(--border-hairline)] rounded-t-3xl md:rounded-2xl shadow-2xl shadow-slate-900/20 dark:shadow-black/60 max-h-[90vh] flex flex-col overflow-hidden bhaviq-sheet-enter`}
        >
          <div className="md:hidden w-10 h-1.5 bg-slate-300 dark:bg-slate-600 rounded-full mx-auto mt-2.5 mb-1 shrink-0" />
          <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-[var(--border-hairline)] shrink-0">
            <div className="min-w-0">
              <h2 className="font-display text-lg font-bold text-[var(--text-primary)] truncate">
                {title}
              </h2>
              {subtitle && (
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">{subtitle}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={`Close ${title}`}
              className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center shrink-0 text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-5 sm:p-6 overflow-y-auto overflow-x-hidden flex-1 min-h-0">
            {children}
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalNode, document.body);
  }
  return modalNode;
};

export const FieldLabel: React.FC<{
  htmlFor?: string;
  children: React.ReactNode;
  required?: boolean;
}> = ({ htmlFor, children, required }) => (
  <label
    htmlFor={htmlFor}
    className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5"
  >
    {children}
    {required && <span className="text-rose-600 dark:text-rose-400 ml-0.5">*</span>}
  </label>
);

export const TextInput: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({
  className = '',
  ...props
}) => (
  <input
    {...props}
    className={`w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--bg-surface)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 dark:focus:border-indigo-400 min-h-[42px] transition-colors ${className}`}
  />
);

export const SelectInput: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({
  className = '',
  children,
  ...props
}) => (
  <select
    {...props}
    className={`w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--bg-surface)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-500 dark:focus:border-indigo-400 min-h-[42px] transition-colors ${className}`}
  >
    {children}
  </select>
);
