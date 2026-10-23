import type { Derivation } from '../solver/types';

/** User inputs that a derived value ultimately depends on. */
export function rootInputs(id: string, derivations: Record<string, Derivation>): string[] {
  const out = new Set<string>();
  const seen = new Set<string>();
  const stack = [...(derivations[id]?.inputs ?? [])];
  while (stack.length) {
    const v = stack.pop()!;
    if (seen.has(v)) continue;
    seen.add(v);
    const d = derivations[v];
    if (!d) continue;
    if (d.status === 'input') out.add(v);
    else if (d.status === 'calculated' || d.status === 'conflict') stack.push(...d.inputs);
  }
  return [...out];
}
