import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Small "i" button with a plain-language explanation. It shows while the mouse is over it,
 * and a click or tap keeps it open until you click elsewhere or press Escape.
 */
export function Help({ label, children }: { label: string; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  const open = hover || pinned;

  // place it under the button (above when there is no room), inside the window
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const b = btn.current?.getBoundingClientRect();
      const p = pop.current;
      if (!b || !p) return;
      const m = 8;
      const left = Math.max(m, Math.min(b.left - 10, window.innerWidth - p.offsetWidth - m));
      let top = b.bottom + 6;
      if (top + p.offsetHeight > window.innerHeight - m && b.top - 6 - p.offsetHeight >= m)
        top = b.top - 6 - p.offsetHeight;
      p.style.left = `${left}px`;
      p.style.top = `${top}px`;
      p.style.visibility = 'visible';
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || pop.current?.contains(t)) return;
      setPinned(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPinned(false);
      setHover(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="info-tip"
        aria-label={`Help: ${label}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={(e) => {
          // inside a <summary> or <label>, don't also toggle that
          e.preventDefault();
          e.stopPropagation();
          setPinned((p) => !p);
        }}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
      >
        i
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            id={id}
            role="tooltip"
            className="help-pop"
            style={{ left: 0, top: 0, visibility: 'hidden' }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
