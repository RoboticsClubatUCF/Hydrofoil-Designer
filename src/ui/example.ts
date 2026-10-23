import { useStore } from '../state/store';

/** True when nothing has been entered yet. */
export function designIsEmpty(): boolean {
  const s = useStore.getState();
  return !s.profileText.trim() && Object.keys(s.inputs).length === 0;
}

/** A starting point for beginners: the example section, a 90 kg rider and an 18 km/h cruise. */
export async function loadExampleDesign() {
  const r = await fetch(`${import.meta.env.BASE_URL}examples/naca63412.dat`);
  const s = useStore.getState();
  s.setProfileText(await r.text(), 1);
  s.setInput('m', 90);
  s.setInput('V', 5);
}
