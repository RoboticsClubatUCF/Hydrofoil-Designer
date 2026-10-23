import { useRef, useState } from 'react';
import { docOf, shareUrl, useStore, type Theme } from '../../state/store';
import { download, slug } from '../format';

export function Header() {
  const s = useStore();
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
      <div className="header-actions">
        <div className="seg" role="group" aria-label="Unit system">
          <button aria-pressed={s.unitSystem === 'SI'} onClick={() => s.setUnitSystem('SI')}>
            SI
          </button>
          <button aria-pressed={s.unitSystem === 'US'} onClick={() => s.setUnitSystem('US')}>
            US
          </button>
        </div>
        <button className="btn" onClick={() => s.setTheme(nextTheme[s.theme])} title="Switch theme">
          Theme: {s.theme}
        </button>
        <button className="btn" onClick={save}>
          Save
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Open
        </button>
        <button className="btn" onClick={share}>
          {copied ? 'Link copied' : 'Share link'}
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            if (window.confirm('Clear the whole design?')) s.reset();
          }}
        >
          Reset
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
