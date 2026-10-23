import { useRef, useState } from 'react';
import { docOf, shareUrl, useStore, type Theme } from '../../state/store';
import { useUi } from '../../state/ui';
import { download, slug } from '../format';

export function Header() {
  const s = useStore();
  const openTour = useUi((u) => u.openTour);
  const fileRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const save = () =>
    download(
      `${slug(s.profile?.name ?? 'hydrofoil')}-design.json`,
      JSON.stringify(docOf(s), null, 2),
      'application/json',
    );
  const share = async () => {
    const url = await shareUrl();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link', url);
    }
  };
  const nextTheme: Record<Theme, Theme> = { auto: 'light', light: 'dark', dark: 'auto' };
  return (
    <header className="app-header">
      <h1>
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
          <rect width="32" height="32" rx="7" fill="var(--accent)" />
          <path d="M4 18c5-6 14-7 24-3-8 1-16 3-24 3z" fill="#fff" />
        </svg>
        Hydrofoil Designer
      </h1>
      {(s.solving || s.sectionBusy) && <span className="busy">calculating…</span>}
      <span className="spacer" />
      <div className="header-actions" data-tour="header">
        <div className="seg" role="group" aria-label="Unit system">
          <button
            aria-pressed={s.unitSystem === 'SI'}
            onClick={() => s.setUnitSystem('SI')}
            title="Metric units: kg, m, km/h"
          >
            SI
          </button>
          <button
            aria-pressed={s.unitSystem === 'US'}
            onClick={() => s.setUnitSystem('US')}
            title="US units: lb, ft, mph"
          >
            US
          </button>
        </div>
        <button className="btn" onClick={() => s.setTheme(nextTheme[s.theme])} title="Switch theme">
          Theme: {s.theme}
        </button>
        <button className="btn" onClick={save} title="Save this design to a file on your computer">
          Save
        </button>
        <button
          className="btn"
          onClick={() => fileRef.current?.click()}
          title="Open a design file you saved before"
        >
          Open
        </button>
        <button
          className="btn"
          onClick={share}
          title="Copy a web address that holds this whole design"
        >
          {copied ? 'Link copied' : 'Share link'}
        </button>
        <button
          className="btn ghost"
          title="Clear everything and start over"
          onClick={() => {
            if (window.confirm('Clear the whole design?')) s.reset();
          }}
        >
          Reset
        </button>
        <button className="btn" onClick={openTour} title="Take the guided tour" data-tour="help">
          Help
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            f.text().then((t) => {
              try {
                s.loadDoc(JSON.parse(t));
              } catch {
                window.alert('That file is not a Hydrofoil Designer design.');
              }
            });
            e.target.value = '';
          }}
        />
      </div>
    </header>
  );
}
