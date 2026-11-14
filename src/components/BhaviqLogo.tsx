import React from 'react';

interface BhaviqLogoProps {
  variant?: 'lockup' | 'mark' | 'image';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Official BhavIQ emblem featuring the royal-blue rounded square badge,
 * two-tone geometric "B" (white stem & lower bowl, ice-blue upper bowl),
 * and emerald-green upward node bar.
 */
export const BhaviqLogo: React.FC<BhaviqLogoProps> = ({
  variant = 'lockup',
  size = 'md',
  className = '',
}) => {
  if (variant === 'image') {
    const imgHeight = size === 'sm' ? 'h-7' : size === 'lg' ? 'h-11' : 'h-9';
    return (
      <img
        src="/bhaviq-logo.png"
        alt="BhavIQ Logo"
        className={`${imgHeight} w-auto object-contain shrink-0 ${className}`}
      />
    );
  }

  const dims = size === 'sm' ? 30 : size === 'lg' ? 44 : 36;
  const textClass =
    size === 'sm'
      ? 'text-[17px]'
      : size === 'lg'
        ? 'text-[24px]'
        : 'text-[20px]';

  return (
    <span className={`inline-flex items-center gap-2.5 select-none shrink-0 ${className}`}>
      <svg
        width={dims}
        height={dims}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0 drop-shadow-sm"
      >
        <defs>
          <linearGradient id="bhaviqRoyalBadge" x1="2" y1="2" x2="38" y2="38" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1D4ED8" />
            <stop offset="100%" stopColor="#13389C" />
          </linearGradient>
        </defs>

        {/* Deep royal-blue rounded square badge */}
        <rect x="1" y="1" width="38" height="38" rx="9" fill="url(#bhaviqRoyalBadge)" />

        {/* Upper ice-blue bowl of stylized "B" */}
        <path
          d="M12.6 8.2H21.9C26.5 8.2 29.6 10.7 29.6 14.1C29.6 17.2 27.2 19.3 23.6 19.8H12.6V8.2Z"
          fill="#C2DDFC"
        />

        {/* Left white vertical pillar of "B" */}
        <rect x="7.8" y="15.1" width="4.8" height="16.4" rx="1.6" fill="#FFFFFF" />

        {/* Lower pure-white bowl of "B" */}
        <path
          d="M14.3 20.1H23.2C27.9 20.1 31.3 22.4 31.3 25.9C31.3 29.4 27.9 31.5 23.0 31.5H14.3V20.1Z"
          fill="#FFFFFF"
        />

        {/* Royal-blue diagonal moat separating the emerald bar & node */}
        <path
          d="M12.2 26.8L21.5 16.0"
          stroke="#163FA9"
          strokeWidth="6.4"
          strokeLinecap="round"
        />
        <circle cx="21.6" cy="16.0" r="4.6" fill="#163FA9" />

        {/* Emerald-green upward trajectory bar & circular node */}
        <path
          d="M12.5 26.5L21.5 16.0"
          stroke="#10B981"
          strokeWidth="3.6"
          strokeLinecap="round"
        />
        <circle cx="21.6" cy="16.0" r="2.65" fill="#10B981" />
      </svg>

      {variant === 'lockup' && (
        <span
          className={`font-display font-extrabold tracking-[-0.03em] text-slate-900 dark:text-slate-50 whitespace-nowrap ${textClass}`}
        >
          Bhav<span className="text-[#1744B3] dark:text-blue-400">IQ</span>
        </span>
      )}
    </span>
  );
};
