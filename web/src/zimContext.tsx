import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type CurrencyCode = 'USD' | 'ZiG' | 'ZAR';
export type VernacularMode = 'bilingual' | 'shona' | 'ndebele' | 'english';
export type RoleViewMode = 'inventory' | 'executive';

export interface ExchangeRates {
  USD: number;
  ZiG: number;
  ZAR: number;
  updatedAt: string;
}

export interface FdmsConfig {
  tinNumber: string;
  vatNumber: string;
  deviceId: string;
  serialNo: string;
  fiscalDay: number;
  status: 'ONLINE' | 'OFFLINE_QUEUED';
  standardVatPct: number;
}

interface ZimContextValue {
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  rates: ExchangeRates;
  updateRates: (next: Partial<ExchangeRates>) => void;
  formatMoney: (usdAmount: number, overrideCurrency?: CurrencyCode) => string;
  vernacular: VernacularMode;
  setVernacular: (v: VernacularMode) => void;
  subLabel: (shona: string, ndebele: string, englishHint?: string) => string;
  easyMode: boolean;
  setEasyMode: (on: boolean) => void;
  roleView: RoleViewMode;
  setRoleView: (r: RoleViewMode) => void;
  zesaGridOnline: boolean;
  setZesaGridOnline: (online: boolean) => void;
  pendingOfflineSyncs: number;
  triggerOfflineSync: () => void;
  fdms: FdmsConfig;
  updateFdms: (next: Partial<FdmsConfig>) => void;
}

const DEFAULT_RATES: ExchangeRates = {
  USD: 1,
  ZiG: 26.8,
  ZAR: 18.2,
  updatedAt: '2026-10-27 08:00 CAT',
};

const DEFAULT_FDMS: FdmsConfig = {
  tinNumber: '2001489210',
  vatNumber: '10028491-VAT',
  deviceId: 'FDMS-HRE-00419',
  serialNo: 'ZIMRA-VFD-99412A',
  fiscalDay: 298,
  status: 'ONLINE',
  standardVatPct: 15,
};

const ZimContext = createContext<ZimContextValue | null>(null);

export function ZimProvider({ children, defaultRoleView = 'inventory' }: { children: ReactNode; defaultRoleView?: RoleViewMode }) {
  const [currency, setCurrencyState] = useState<CurrencyCode>(() => {
    const saved = localStorage.getItem('zim_currency') as CurrencyCode | null;
    return saved === 'USD' || saved === 'ZiG' || saved === 'ZAR' ? saved : 'USD';
  });

  const [rates, setRates] = useState<ExchangeRates>(() => {
    try {
      const saved = localStorage.getItem('zim_rates');
      return saved ? { ...DEFAULT_RATES, ...JSON.parse(saved) } : DEFAULT_RATES;
    } catch {
      return DEFAULT_RATES;
    }
  });

  const [vernacular, setVernacularState] = useState<VernacularMode>(() => {
    const saved = localStorage.getItem('zim_vernacular') as VernacularMode | null;
    return saved === 'bilingual' || saved === 'shona' || saved === 'ndebele' || saved === 'english' ? saved : 'bilingual';
  });

  const [easyMode, setEasyModeState] = useState<boolean>(() => {
    const saved = localStorage.getItem('zim_easy_mode');
    return saved === null ? true : saved === 'true';
  });

  const [roleView, setRoleViewState] = useState<RoleViewMode>(() => {
    const saved = localStorage.getItem('zim_role_view') as RoleViewMode | null;
    return saved === 'executive' || saved === 'inventory' ? saved : defaultRoleView;
  });

  const [zesaGridOnline, setZesaGridOnline] = useState<boolean>(true);
  const [pendingOfflineSyncs, setPendingOfflineSyncs] = useState<number>(0);

  const [fdms, setFdms] = useState<FdmsConfig>(() => {
    try {
      const saved = localStorage.getItem('zim_fdms');
      return saved ? { ...DEFAULT_FDMS, ...JSON.parse(saved) } : DEFAULT_FDMS;
    } catch {
      return DEFAULT_FDMS;
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-easy-mode', easyMode ? 'on' : 'off');
  }, [easyMode]);

  function setCurrency(c: CurrencyCode) {
    setCurrencyState(c);
    localStorage.setItem('zim_currency', c);
  }

  function updateRates(next: Partial<ExchangeRates>) {
    setRates((prev) => {
      const updated = { ...prev, ...next, updatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' CAT' };
      localStorage.setItem('zim_rates', JSON.stringify(updated));
      return updated;
    });
  }

  function setVernacular(v: VernacularMode) {
    setVernacularState(v);
    localStorage.setItem('zim_vernacular', v);
  }

  function setEasyMode(on: boolean) {
    setEasyModeState(on);
    localStorage.setItem('zim_easy_mode', String(on));
  }

  function setRoleView(r: RoleViewMode) {
    setRoleViewState(r);
    localStorage.setItem('zim_role_view', r);
  }

  function updateFdms(next: Partial<FdmsConfig>) {
    setFdms((prev) => {
      const updated = { ...prev, ...next };
      localStorage.setItem('zim_fdms', JSON.stringify(updated));
      return updated;
    });
  }

  function formatMoney(usdAmount: number, overrideCurrency?: CurrencyCode): string {
    const c = overrideCurrency ?? currency;
    const safeUsd = Number.isFinite(usdAmount) ? usdAmount : 0;
    if (c === 'ZiG') {
      const val = safeUsd * rates.ZiG;
      return `ZiG ${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (c === 'ZAR') {
      const val = safeUsd * rates.ZAR;
      return `R ${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `$${safeUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function subLabel(shona: string, ndebele: string, englishHint?: string): string {
    if (vernacular === 'english') return englishHint ?? '';
    if (vernacular === 'shona') return shona;
    if (vernacular === 'ndebele') return ndebele;
    return `${shona} • ${ndebele}`;
  }

  function triggerOfflineSync() {
    setPendingOfflineSyncs(0);
    window.dispatchEvent(new CustomEvent('stockroom:sync'));
  }

  return (
    <ZimContext.Provider
      value={{
        currency,
        setCurrency,
        rates,
        updateRates,
        formatMoney,
        vernacular,
        setVernacular,
        subLabel,
        easyMode,
        setEasyMode,
        roleView,
        setRoleView,
        zesaGridOnline,
        setZesaGridOnline,
        pendingOfflineSyncs,
        triggerOfflineSync,
        fdms,
        updateFdms,
      }}
    >
      {children}
    </ZimContext.Provider>
  );
}

export function useZim() {
  const ctx = useContext(ZimContext);
  if (!ctx) {
    // Fallback for isolated component unit tests if rendered outside ZimProvider
    return {
      currency: 'USD' as CurrencyCode,
      setCurrency: () => {},
      rates: DEFAULT_RATES,
      updateRates: () => {},
      formatMoney: (usd: number) => `$${(usd || 0).toFixed(2)}`,
      vernacular: 'bilingual' as VernacularMode,
      setVernacular: () => {},
      subLabel: (shona: string, ndebele: string) => `${shona} • ${ndebele}`,
      easyMode: true,
      setEasyMode: () => {},
      roleView: 'inventory' as RoleViewMode,
      setRoleView: () => {},
      zesaGridOnline: true,
      setZesaGridOnline: () => {},
      pendingOfflineSyncs: 0,
      triggerOfflineSync: () => {},
      fdms: DEFAULT_FDMS,
      updateFdms: () => {},
    };
  }
  return ctx;
}
