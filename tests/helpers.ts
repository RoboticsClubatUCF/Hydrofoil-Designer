import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseProfile } from '../src/physics/profile/parse';
import { buildSectionModel, type SectionModel } from '../src/physics/profile/sectionModel';

export const EXAMPLE_PATH = fileURLToPath(
  new URL('../public/examples/naca63412.dat', import.meta.url),
);
export const exampleText = () => readFileSync(EXAMPLE_PATH, 'utf8');

let cached: SectionModel | null = null;
/** NACA 63-412 section in estimate mode (built once per test file). */
export function exampleSection(): SectionModel {
  if (!cached) cached = buildSectionModel(parseProfile(exampleText()), []);
  return cached;
}

export const deg = (r: number) => (r * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;
