import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useUi, type ResultsTab } from '../../state/ui';
import { designIsEmpty, loadExampleDesign } from '../example';
import { TAB_HELP } from '../help';

interface Step {
  /** CSS selectors tried in order; with none found the card sits in the middle of the screen */
  target?: string[];
  title: string;
  body: (ctx: { example: boolean }) => ReactNode;
  /** results tab to show for this step */
  tab?: ResultsTab;
}

const RESULTS = ['[data-tour="results"]'];

const tabStep = (tab: ResultsTab, name: string): Step => ({
  target: RESULTS,
  tab,
  title: `Results: ${name}`,
  body: () => <p>{TAB_HELP[tab]}</p>,
});

const STEPS: Step[] = [
  {
    title: 'Welcome to Hydrofoil Designer',
    body: () => (
      <>
        <p>
          A hydrofoil is a wing that works under water. As a board or boat speeds up, the foil lifts
          it out of the water so it glides above the waves.
        </p>
        <p>
          This program works out what size and shape that wing should be. You tell it what you know,
          like the weight and the speed, and it fills in the rest.
        </p>
        <p>This short tour shows you around. It takes about two minutes.</p>
      </>
    ),
  },
  {
    target: ['[data-tour="header"]'],
    title: 'The top bar',
    body: () => (
      <ul>
        <li>
          <b>SI / US</b>: metric units (kg, m) or US units (lb, ft).
        </li>
        <li>
          <b>Theme</b>: light or dark colours.
        </li>
        <li>
          <b>Save / Open</b>: keep your design in a file and load it again later.
        </li>
        <li>
          <b>Share link</b>: copy a web address that holds your whole design.
        </li>
        <li>
          <b>Reset</b>: clear everything and start over.
        </li>
      </ul>
    ),
  },
  {
    target: ['[data-tour="section"]'],
    title: 'Step 1: Choose a foil shape',
    body: () => (
      <>
        <p>
          Slice a foil from front to back and you see a shape with a rounded nose and a thin tail, a
          bit like a plane wing. This shape is called the <b>section</b>. It decides how much lift
          and drag the foil makes.
        </p>
        <p>
          Paste a shape from airfoiltools.com, or use the example shape. The example is a good place
          to start.
        </p>
      </>
    ),
  },
  {
    target: ['[data-tour="polars"]'],
    title: 'Optional: test data for the shape',
    body: () => (
      <p>
        If you have measured lift and drag data for your shape (called a <b>polar</b>), paste it
        here for more accurate results. If not, skip it: the program estimates lift and drag from
        the shape itself.
      </p>
    ),
  },
  {
    target: ['[data-tour="foil2"]'],
    title: 'Optional: a second foil',
    body: () => (
      <p>
        Most foil boards also have a small foil at the back, like the tail of a plane, to keep the
        ride steady. Turn this on to design both foils together. Leave it off while you are
        learning.
      </p>
    ),
  },
  {
    target: ['[data-tour="design"]'],
    title: 'Step 2: Fill in what you know',
    body: () => (
      <>
        <p>
          Each box can be typed in or left blank. Type what you know or want, and the program works
          out the rest.
        </p>
        <p>
          To get started you only need two numbers: <b>Craft mass</b> (the total weight) and{' '}
          <b>Cruise speed</b>.
        </p>
      </>
    ),
  },
  {
    target: ['#field-m'],
    title: 'Typing a value',
    body: () => (
      <p>
        Click a box and type a number. Use the menu beside it to change the unit, for example kg or
        lb. To remove a value, delete the number.
      </p>
    ),
  },
  {
    target: ['[data-tour="legend"]'],
    title: 'What the colours mean',
    body: () => (
      <ul>
        <li>
          <b>Entered</b> (blue outline): you typed it.
        </li>
        <li>
          <b>Calculated</b> (grey): worked out from your numbers, so it is locked. To type your own,
          clear one of the numbers it comes from.
        </li>
        <li>
          <b>Assumed</b> (purple): a starting guess. Type over it to use your own.
        </li>
        <li>
          <b>Optimised</b> (green): picked by the program to best meet your requirements.
        </li>
      </ul>
    ),
  },
  {
    target: ['.field .how:not(:disabled)', '.field .how'],
    title: 'See how a value was worked out',
    body: () => (
      <p>
        Press <b>ƒ</b> next to any value to see the formula and the numbers that went into it.
      </p>
    ),
  },
  {
    target: ['[data-tour="design"] .info-tip'],
    title: 'Not sure what something means?',
    body: () => (
      <p>
        Press any small <b>i</b> button for a plain explanation. You will find them next to every
        value and most controls.
      </p>
    ),
  },
  {
    target: ['.more-toggle'],
    title: 'More details',
    body: () => (
      <p>
        Each group shows the main values first. Press <b>More</b> to see the rest.
      </p>
    ),
  },
  {
    target: ['[data-tour="requirements"]'],
    title: 'Step 3 (optional): Set limits',
    body: () => (
      <>
        <p>
          Tell the program what it must stick to, such as the widest the foil may be. Leave a box
          empty for no limit.
        </p>
        <p>
          <b>Optimise for</b> picks what it aims for: the least drag, the slowest take-off, or the
          lightest foil. A green tick means a limit is met; a red cross means it is not.
        </p>
      </>
    ),
  },
  {
    target: ['[data-tour="status"]'],
    title: 'Messages',
    body: () => (
      <p>
        The Status box tells you what is still missing, what needs fixing, and what the program
        chose for you. Click a name in a message to jump to that value.
      </p>
    ),
  },
  tabStep('overview', 'Overview'),
  tabStep('section', 'Section'),
  tabStep('span', 'Span & structure'),
  tabStep('sweep', 'Speed sweep'),
  tabStep('flow3d', '3D flow'),
  tabStep('calc', 'Calculations'),
  tabStep('export', 'Export'),
  {
    target: ['[data-tour="help"]'],
    title: 'You are ready',
    body: ({ example }) => (
      <>
        <p>Start with step 1 on the left and work down.</p>
        {example && (
          <p>
            The example design is still filled in. Press <b>Reset</b> at the top when you want to
            clear it and start your own.
          </p>
        )}
        <p>
          Press <b>Help</b> at the top any time to take this tour again.
        </p>
      </>
    ),
  },
];

const PAD = 6;

function findTarget(selectors: string[] = []): Element | null {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.getClientRects().length > 0) return el;
  }
  return null;
}

/** First-visit walkthrough: highlights each part of the page with a short explanation. */
export function Tour() {
  const open = useUi((s) => s.tourOpen);
  return open ? <TourDialog /> : null;
}

function TourDialog() {
  const closeTour = useUi((s) => s.closeTour);
  const setTab = useUi((s) => s.setResultsTab);
  const [i, setI] = useState(0);
  const [offerExample] = useState(designIsEmpty);
  const [wantExample, setWantExample] = useState(true);
  const [example, setExample] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const pop = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  // put the results tab and keyboard focus back where they were
  useEffect(() => {
    const tab = useUi.getState().resultsTab;
    const focused = document.activeElement as HTMLElement | null;
    return () => {
      useUi.getState().setResultsTab(tab);
      focused?.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (step.tab) setTab(step.tab);
    primary.current?.focus({ preventScroll: true });
  }, [step, setTab]);

  // scroll the target into view once, then follow it as the page moves
  useEffect(() => {
    let raf = 0;
    let key = '';
    let scrolled = false;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tick = () => {
      const el = findTarget(step.target);
      if (el && !scrolled) {
        scrolled = true;
        // keep the top of tall parts clear of the sticky header (taller when it wraps on phones)
        const header = document.querySelector('.app-header')?.getBoundingClientRect().height ?? 0;
        document.documentElement.style.setProperty('--tour-top', `${Math.round(header) + 16}px`);
        const tall = el.getBoundingClientRect().height > window.innerHeight * 0.6;
        el.scrollIntoView({
          block: tall ? 'start' : 'center',
          behavior: smooth ? 'smooth' : 'auto',
        });
      }
      const r = el?.getBoundingClientRect() ?? null;
      const k = r ? [r.left, r.top, r.width, r.height].map(Math.round).join() : '';
      if (k !== key) {
        key = k;
        setRect(r);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  // place the card beside the highlighted part, inside the window
  useLayoutEffect(() => {
    const p = pop.current;
    if (!p) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const m = 12;
    const gap = 14;
    const w = p.offsetWidth;
    const h = p.offsetHeight;
    let at = { left: (vw - w) / 2, top: Math.max(m, (vh - h) / 2) };
    if (rect) {
      const x = Math.max(m, Math.min(rect.left, vw - w - m));
      const y = Math.max(m, Math.min(rect.top, vh - h - m));
      const l = rect.left - PAD;
      const r = rect.right + PAD;
      const t = rect.top - PAD;
      const b = rect.bottom + PAD;
      const below = b + gap + h <= vh - m ? { left: x, top: b + gap } : null;
      const above = t - gap - h >= m ? { left: x, top: t - gap - h } : null;
      const right = r + gap + w <= vw - m ? { left: r + gap, top: y } : null;
      const left = l - gap - w >= m ? { left: l - gap - w, top: y } : null;
      const order = rect.height > 200 ? [right, left, below, above] : [below, above, right, left];
      at = order.find(Boolean) ?? { left: (vw - w) / 2, top: vh - h - m };
    }
    p.style.left = `${at.left}px`;
    p.style.top = `${at.top}px`;
    p.style.visibility = 'visible';
  }, [rect, i, example]);

  const next = () => {
    if (i === 0 && offerExample && wantExample) {
      setExample(true);
      void loadExampleDesign();
    }
    if (last) closeTour();
    else setI(i + 1);
  };
  const back = () => setI(Math.max(0, i - 1));

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeTour();
    } else if (e.key === 'ArrowRight' && i > 0) {
      e.preventDefault();
      next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      back();
    } else if (e.key === 'Tab') {
      // keep keyboard focus inside the card
      const items = Array.from(
        pop.current?.querySelectorAll<HTMLElement>('button, input') ?? [],
      ).filter((el) => !el.hasAttribute('disabled'));
      if (!items.length) return;
      const first = items[0];
      const end = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        end.focus();
      } else if (!e.shiftKey && document.activeElement === end) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className="tour" onKeyDown={onKeyDown}>
      {/* blocks the page; keeps focus in the card when clicked */}
      <div className={`tour-block${rect ? '' : ' dim'}`} onMouseDown={(e) => e.preventDefault()} />
      {rect && (
        <div
          className="tour-spot"
          aria-hidden
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + 2 * PAD,
            height: rect.height + 2 * PAD,
          }}
        />
      )}
      <div
        ref={pop}
        className="tour-pop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        style={{ left: 0, top: 0, visibility: 'hidden' }}
      >
        {i > 0 && (
          <div className="tour-count">
            {i} of {STEPS.length - 1}
            <span className="tour-bar" aria-hidden>
              <span style={{ width: `${(100 * i) / (STEPS.length - 1)}%` }} />
            </span>
          </div>
        )}
        <h2 id="tour-title">{step.title}</h2>
        <div id="tour-body" className="tour-body" aria-live="polite">
          {step.body({ example })}
        </div>
        {i === 0 && offerExample && (
          <label className="tour-check">
            <input
              type="checkbox"
              checked={wantExample}
              onChange={(e) => setWantExample(e.target.checked)}
            />
            Fill in an example design (a 90 kg rider at 18 km/h) so there is something to look at
          </label>
        )}
        <div className="tour-actions">
          {!last && (
            <button className="btn ghost" onClick={closeTour}>
              {i === 0 ? 'Skip' : 'Skip tour'}
            </button>
          )}
          <span className="spacer" />
          {i > 0 && (
            <button className="btn" onClick={back}>
              Back
            </button>
          )}
          <button ref={primary} className="btn primary" onClick={next}>
            {i === 0 ? 'Start the tour' : last ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
