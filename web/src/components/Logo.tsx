import type { SVGProps } from 'react';

interface LogoProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
  variant?: 'full' | 'mark' | 'compact';
  themeColor?: 'light' | 'dark' | 'auto';
}

export function Logo({ size = 36, variant = 'full', themeColor = 'auto', className = '', ...props }: LogoProps) {
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`stockroom-logo-mark ${className}`}
      {...props}
    >
      <defs>
        <linearGradient id="srGreenGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#155949" />
          <stop offset="100%" stopColor="#0d3b30" />
        </linearGradient>
        <linearGradient id="srGoldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#d4af37" />
          <stop offset="100%" stopColor="#C59B27" />
        </linearGradient>
        <filter id="srGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#092922" floodOpacity="0.3" />
        </filter>
      </defs>

      {/* Rounded Hexagonal / Shield Base with Great Zimbabwe Stone contour */}
      <rect x="4" y="4" width="56" height="56" rx="16" fill="url(#srGreenGrad)" filter="url(#srGlow)" />
      
      {/* Ndebele Stepped Geometric Border Accents */}
      <path
        d="M16 10 H48"
        stroke="url(#srGoldGrad)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M12 18 L16 14 H48 L52 18"
        stroke="#FFFFFF"
        strokeOpacity="0.4"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />

      {/* Stylized Modern 3D Isometric "S" + Storage Room Cube */}
      {/* Top Facet of Storage Cube */}
      <path
        d="M32 18 L46 25 L32 32 L18 25 Z"
        fill="url(#srGoldGrad)"
      />
      {/* Left Wall of Storage Cube */}
      <path
        d="M18 25 L32 32 V46 L18 39 Z"
        fill="#114B3E"
      />
      {/* Right Wall of Storage Cube */}
      <path
        d="M32 32 L46 25 V39 L32 46 Z"
        fill="#092922"
      />

      {/* Dynamic Chevron Fold (The Antigravity "S" Motion) */}
      <path
        d="M23 27.5 L32 32 L41 27.5 M23 34.5 L32 39 L41 34.5"
        stroke="#FFFFFF"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Bottom Savanna Gold Precision Dot */}
      <circle cx="32" cy="51" r="2.8" fill="#C59B27" />
    </svg>
  );

  if (variant === 'mark') {
    return mark;
  }

  const themeClass = themeColor === 'light' ? 'on-dark' : themeColor === 'dark' ? 'on-light' : '';

  return (
    <div className={`stockroom-brand-badge ${variant === 'compact' ? 'compact' : ''} ${themeClass} ${className}`.trim()}>
      {mark}
      <div className="stockroom-brand-text">
        <div className="stockroom-title-row">
          <span className="stockroom-title-main">StockRoom</span>
          <span className="stockroom-title-badge">ZW</span>
        </div>
        <span className="stockroom-tagline">Universal SME Inventory &amp; POS</span>
      </div>
    </div>
  );
}
