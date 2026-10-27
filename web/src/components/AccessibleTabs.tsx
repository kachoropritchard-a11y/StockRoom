import { useRef, type KeyboardEvent } from 'react';

export interface TabDefinition<K extends string> {
  key: K;
  label: string;
  badge?: string | number;
  purpose: string;
}

export interface AccessibleTabsProps<K extends string> {
  idPrefix: string;
  ariaLabel: string;
  tabs: TabDefinition<K>[];
  active: K;
  onChange: (key: K) => void;
}

/**
 * Keyboard- and mouse-accessible WAI-ARIA Tablist with automatic Purpose Banner.
 * - ArrowRight / ArrowLeft cycle through tabs and move focus.
 * - Home / End jump to first or last tab.
 * - Shows a clear explanation banner for the active tab so users immediately know what the tab does.
 */
export function AccessibleTabs<K extends string>({
  idPrefix,
  ariaLabel,
  tabs,
  active,
  onChange,
}: AccessibleTabsProps<K>) {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(0, tabs.findIndex((t) => t.key === active));
  const activeTab = tabs[activeIndex] ?? tabs[0];

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (tabs.length === 0) return;
    let nextIdx = activeIndex;
    if (e.key === 'ArrowRight') {
      nextIdx = (activeIndex + 1) % tabs.length;
    } else if (e.key === 'ArrowLeft') {
      nextIdx = (activeIndex - 1 + tabs.length) % tabs.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = tabs.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    const nextTab = tabs[nextIdx];
    if (nextTab) {
      onChange(nextTab.key);
      btnRefs.current[nextIdx]?.focus();
    }
  }

  return (
    <div className="tabs-container">
      <div className="tabs" role="tablist" aria-label={ariaLabel} onKeyDown={handleKeyDown}>
        {tabs.map((t, idx) => {
          const isSelected = t.key === active;
          return (
            <button
              key={t.key}
              ref={(el) => {
                btnRefs.current[idx] = el;
              }}
              id={`${idPrefix}-tab-${t.key}`}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={`${idPrefix}-panel-${t.key}`}
              tabIndex={isSelected ? 0 : -1}
              className={`tab-btn${isSelected ? ' active' : ''}`}
              onClick={() => onChange(t.key)}
            >
              <span>{t.label}</span>
              {t.badge !== undefined && <span className="tab-badge">{t.badge}</span>}
            </button>
          );
        })}
      </div>
      {activeTab && (
        <div className="tab-purpose-banner" role="note">
          <span className="tab-purpose-dot" aria-hidden="true" />
          <span>{activeTab.purpose}</span>
          <span className="tab-purpose-kbd">Use ← / → arrow keys to switch tabs</span>
        </div>
      )}
    </div>
  );
}
