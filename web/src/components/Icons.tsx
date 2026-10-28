import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
};

// --- NAVIGATION & CORE UI ICONS ---

export function StorefloorIcon({ size = 16, className = '', ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

export function ExecutiveIcon({ size = 16, className = '', ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
      <polyline points="3 8 9 2 15 8" />
    </svg>
  );
}

export function EyeIcon({ size = 16, className = '', ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon({ size = 16, className = '', ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export function LockIcon({ size = 16, className = '', ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function BellIcon({ size = 16, className = '', ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export function SunIcon({ size = 16, className = '', ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

export function MoonIcon({ size = 16, className = '', ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function ZapIcon({ size = 16, className = '', ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

export function BarcodeScannerIcon({ size = 18, className = '', ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <line x1="7" y1="8" x2="7" y2="16" />
      <line x1="10" y1="8" x2="10" y2="16" />
      <line x1="13" y1="8" x2="13" y2="16" />
      <line x1="17" y1="8" x2="17" y2="16" />
    </svg>
  );
}

export function CartIcon({ size = 18, className = '', ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

export function PrinterIcon({ size = 16, className = '', ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

export function WhatsAppIcon({ size = 18, className = '', ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

export function ShieldUserIcon({ size = 18, className = '', ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

export function CheckCircleIcon({ size = 16, className = '', ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

// --- DASHBOARD BIG STEP ICONS ---

export function GoodsInIcon({ size = 28, className = '', ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
      <line x1="12" y1="3" x2="12" y2="8" stroke="var(--zim-gold-500)" strokeWidth="2.5" />
      <polyline points="9 5.5 12 8 15 5.5" stroke="var(--zim-gold-500)" strokeWidth="2.5" />
    </svg>
  );
}

export function QuickAdjustIcon({ size = 28, className = '', ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <rect x="2" y="3" width="20" height="18" rx="2" />
      <line x1="8" y1="12" x2="16" y2="12" stroke="var(--zim-gold-500)" strokeWidth="2.5" />
      <line x1="12" y1="8" x2="12" y2="16" stroke="var(--zim-gold-500)" strokeWidth="2.5" />
      <circle cx="18" cy="6" r="2" fill="var(--zim-green-700)" stroke="none" />
    </svg>
  );
}

export function MoveTransferIcon({ size = 28, className = '', ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 5h18" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 19H3" />
      <rect x="9" y="8" width="6" height="8" rx="1" fill="var(--zim-green-50)" stroke="var(--zim-gold-500)" strokeWidth="1.5" />
    </svg>
  );
}

export function DispatchIcon({ size = 28, className = '', ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
      <rect x="1" y="3" width="15" height="13" rx="2" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}

// --- PRODUCT CATALOG RETAIL & HARDWARE ICONS ---

export function ProductRetailIcon({
  name,
  category,
  size = 24,
  className = '',
}: {
  name: string;
  category?: string | null;
  size?: number | string;
  className?: string;
}) {
  const s = `${name} ${category ?? ''}`.toLowerCase();

  // 1. Hardware / Construction / Bricks / Cement / Tools
  if (s.includes('cement') || s.includes('brick') || s.includes('roof') || s.includes('hardware') || s.includes('timber') || s.includes('nail')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <rect x="2" y="4" width="20" height="6" rx="1" fill="rgba(197, 155, 39, 0.15)" stroke="var(--zim-gold-600)" />
        <rect x="2" y="14" width="9" height="6" rx="1" fill="rgba(17, 75, 62, 0.12)" stroke="var(--zim-green-700)" />
        <rect x="13" y="14" width="9" height="6" rx="1" fill="rgba(17, 75, 62, 0.12)" stroke="var(--zim-green-700)" />
      </svg>
    );
  }

  // 2. Grain / Flour / Maize Meal / Sugar / Salt (Sack)
  if (s.includes('meal') || s.includes('maize') || s.includes('flour') || s.includes('grain') || s.includes('sugar') || s.includes('salt')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M6 8c0-3 3-5 6-5s6 2 6 5c0 8 3 13 3 13H3s3-5 3-13z" fill="rgba(197, 155, 39, 0.15)" stroke="var(--zim-gold-600)" />
        <line x1="8" y1="12" x2="16" y2="12" stroke="var(--zim-green-700)" />
        <line x1="8" y1="15" x2="14" y2="15" stroke="var(--zim-green-700)" />
        <path d="M9 8h6" stroke="var(--zim-gold-700)" strokeWidth="2" />
      </svg>
    );
  }

  // 3. Cooking Oil / Drinks / Mazoe / Bottles
  if (s.includes('oil') || s.includes('cooking') || s.includes('drink') || s.includes('mazoe') || s.includes('beverage')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M9 2h6v4H9z" fill="var(--zim-gold-500)" stroke="none" />
        <path d="M8 6h8l2 5v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V11l2-5z" fill="rgba(17, 75, 62, 0.12)" stroke="var(--zim-green-700)" />
        <line x1="10" y1="13" x2="14" y2="13" stroke="var(--zim-gold-600)" />
      </svg>
    );
  }

  // 4. Solar / Battery / Inverter / Electronics
  if (s.includes('solar') || s.includes('inverter') || s.includes('battery') || s.includes('panel')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <polygon points="12 2 2 8 4 20 20 20 22 8 12 2" fill="rgba(197, 155, 39, 0.15)" stroke="var(--zim-gold-600)" />
        <line x1="12" y1="2" x2="12" y2="20" stroke="var(--zim-green-700)" />
        <line x1="3" y1="14" x2="21" y2="14" stroke="var(--zim-green-700)" />
      </svg>
    );
  }

  // 5. Pharmacy / Medical / Clinic / Tablets
  if (s.includes('med') || s.includes('pharma') || s.includes('caps') || s.includes('pill')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M10.5 20.5l10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7z" fill="rgba(17, 75, 62, 0.12)" stroke="var(--zim-green-700)" />
        <line x1="8.5" y1="8.5" x2="15.5" y2="15.5" stroke="var(--zim-gold-600)" strokeWidth="2" />
      </svg>
    );
  }

  // 6. Soap / Cleaning / Hygiene
  if (s.includes('soap') || s.includes('clean') || s.includes('wash') || s.includes('detergent')) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <rect x="3" y="6" width="18" height="14" rx="4" fill="rgba(17, 75, 62, 0.1)" stroke="var(--zim-green-700)" />
        <path d="M7 10c2-1 4-1 6 0" stroke="var(--zim-gold-500)" />
        <path d="M7 14c2-1 4-1 6 0" stroke="var(--zim-gold-500)" />
      </svg>
    );
  }

  // 7. General Inventory Box / Stock Unit (Default)
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" fill="rgba(17, 75, 62, 0.08)" stroke="var(--zim-green-700)" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" stroke="var(--zim-gold-600)" />
      <line x1="12" y1="22.08" x2="12" y2="12" stroke="var(--zim-gold-600)" />
    </svg>
  );
}
