import { useStore } from '../../state/store';

/** Main / secondary foil selector; the design form and results share it. */
export function FoilSwitch({ label }: { label: string }) {
  const viewFoil = useStore((s) => s.viewFoil);
  const setViewFoil = useStore((s) => s.setViewFoil);
  return (
    <div className="foil-switch row">
      <div className="seg" role="group" aria-label={label}>
        <button aria-pressed={viewFoil === 1} onClick={() => setViewFoil(1)}>
          Main foil
        </button>
        <button aria-pressed={viewFoil === 2} onClick={() => setViewFoil(2)}>
          Secondary foil
        </button>
      </div>
    </div>
  );
}
