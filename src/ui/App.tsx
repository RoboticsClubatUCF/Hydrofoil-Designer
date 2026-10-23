import { useEffect } from 'react';
import { useStore } from '../state/store';
import { Header } from './components/Header';
import { SectionCard } from './components/SectionCard';
import { SecondaryFoilCard } from './components/SecondaryFoilCard';
import { DesignForm } from './components/DesignForm';
import { RequirementsCard } from './components/RequirementsCard';
import { StatusCard } from './components/StatusCard';
import { Results } from './components/Results';
import { Help } from './components/Help';
import { Tour } from './components/Tour';

export function App() {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'auto') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
  }, [theme]);
  return (
    <>
      <Header />
      <main className="layout">
        <div className="col">
          <SectionCard />
          <SecondaryFoilCard />
          <DesignForm />
          <RequirementsCard />
        </div>
        <div className="col results-col">
          <StatusCard />
          <Results />
          <Legend />
        </div>
      </main>
      <Tour />
    </>
  );
}

function Legend() {
  return (
    <section className="card small" aria-label="Field colour key" data-tour="legend">
      <div className="row" style={{ gap: 14 }}>
        <Help label="Field colours">
          <p>The colour of each box in the design form shows where its value came from.</p>
          <p>
            A red box marks a conflict: two of your numbers disagree. Clear one of them to fix it.
          </p>
        </Help>
        <span>
          <span
            className="badge"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent-ink)' }}
          >
            entered
          </span>{' '}
          you typed it
        </span>
        <span>
          <span className="badge" style={{ background: 'var(--calc-bg)' }}>
            calculated
          </span>{' '}
          follows from your inputs (locked)
        </span>
        <span>
          <span className="badge estimate">assumed</span> a default you can overwrite
        </span>
        <span>
          <span className="badge polar">optimised</span> chosen to meet your requirements
        </span>
      </div>
    </section>
  );
}
