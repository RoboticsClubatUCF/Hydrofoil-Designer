/**
 * Free-surface waves made by the foils, simulated in time with linearised
 * potential-flow theory in the foil's frame (water streaming past at U).
 *
 * Write the flow as φ = φ_d + φ_w, where φ_d is the foils' vortex/thickness
 * system together with its mirror image above z = 0 (zero potential on the
 * surface, see vortex.ts) and φ_w is the wave correction. Linearised on z = 0:
 *
 *   (∂t + U∂x) η = 2 w₀ + ∂φ_w/∂z     kinematic (w₀: vertical velocity of the foils alone)
 *   (∂t + U∂x) φ_w + g η = 0          dynamic (no pressure on the surface)
 *
 * In Fourier space ∂φ_w/∂z = |k| tanh(|k|D) φ̂_w, and with ω² = g|k| tanh(|k|D)
 * each mode's wave amplitude A = η̂ + i(ω/g) φ̂_w obeys
 *
 *   dA/dt = −(i U kx + i ω + μ) A + F,   F = 2ŵ₀,
 *
 * which is advanced exactly each step. The second wave family is
 * B(k) = conj A(−k), so η̂ = (A(k) + conj A(−k))/2 and η = Re IFFT(A). The steady
 * state is the Kelvin ship-wave pattern; after a change of speed or load the
 * wake evolves to the new pattern at the true (dispersive) wave speeds.
 *
 * w₀ is known in closed form in Fourier space for a lifting line with a flat
 * trailing sheet at depth h, a line of doublets for the section thickness and a
 * vertical line of doublets for a surface-piercing strut:
 *
 *   lift:      ŵ₀ = −½ |k| e^{−|k|h} Γ̂(ky) / (i kx + ε)          (ε: slow decay of the far wake)
 *   thickness: ŵ₀ = ½ i kx e^{−|k|h} μ̂(ky),   μ(y) = U·A(y)      (2-D doublet per unit span)
 *   strut:     ŵ₀ = ½ i kx μ_s (1 − e^{−|k|h_s}) / |k|
 *
 * The domain is periodic, so an absorbing layer damps waves before they leave
 * one side and re-enter on the other. It multiplies IFFT(A) by a real mask ≤ 1,
 * which can only remove wave energy.
 */
import { G } from '../physics/fluid';
import { FFT2 } from './fft';

export interface SurfaceFoil {
  /** quarter-chord position and depth */
  x0: number;
  h: number;
  /** stations across the half span: y ≥ 0, Γ(y) m²/s and section area A(y) m² */
  y: ArrayLike<number>;
  gamma: ArrayLike<number>;
  area: ArrayLike<number>;
  /** x offset of the section centroid from the quarter chord at each station */
  xArea: ArrayLike<number>;
}

export interface SurfaceStrut {
  x: number;
  /** depth it reaches, m */
  depth: number;
  /** section area, m² */
  area: number;
}

export interface SurfaceParams {
  U: number;
  foils: SurfaceFoil[];
  strut: SurfaceStrut | null;
  /** water depth, m (Infinity = deep) */
  depth: number;
}

export interface SurfaceGrid {
  nx: number;
  ny: number;
  /** domain size; the foil's quarter chord is at x = 0, y = 0 */
  Lx: number;
  Ly: number;
  /** physical x range shown: [-xUp, Lx − xUp) */
  xUp: number;
  /** absorbing layers along the sides (off only for 2-D checks) */
  sides?: boolean;
}

/** Kelvin wavelength 2πU²/g. */
export const kelvinWavelength = (U: number) => (2 * Math.PI * U * U) / G;

/** Domain sized to the wake: about four Kelvin wavelengths long, at least twelve foil lengths. */
export function gridFor(U: number, lref: number, nx = 512, ny = 256): SurfaceGrid {
  const Lx = Math.min(1200, Math.max(4 * kelvinWavelength(U), 12 * lref, 6));
  return { nx, ny, Lx, Ly: (Lx * ny) / nx, xUp: 0.2 * Lx };
}

export class SurfaceSim {
  readonly grid: SurfaceGrid;
  readonly n: number;
  private fft: FFT2;
  private kx: Float64Array;
  private ky: Float64Array;
  private kk: Float64Array;
  private om: Float64Array;
  private Ar: Float64Array;
  private Ai: Float64Array;
  private Fr: Float64Array;
  private Fi: Float64Array;
  /** per-mode step multiplier e^{λdt} and forcing increment (e^{λdt}−1)/λ·F */
  private mr: Float64Array;
  private mi: Float64Array;
  private fr: Float64Array;
  private fi: Float64Array;
  private mask: Float64Array;
  private zr: Float64Array;
  private zi: Float64Array;
  private params: SurfaceParams | null = null;
  private dt = 0;
  private mu = 0;
  /** surface elevation η (m) after the last step, row-major ny × nx; the foil is at index 0 */
  readonly eta: Float64Array;

  constructor(grid: SurfaceGrid) {
    this.grid = grid;
    const { nx, ny, Lx, Ly } = grid;
    const n = nx * ny;
    this.n = n;
    this.fft = new FFT2(nx, ny);
    const mk = () => new Float64Array(n);
    this.kx = mk();
    this.ky = mk();
    this.kk = mk();
    this.om = mk();
    this.Ar = mk();
    this.Ai = mk();
    this.Fr = mk();
    this.Fi = mk();
    this.mr = mk();
    this.mi = mk();
    this.fr = mk();
    this.fi = mk();
    this.mask = mk();
    this.zr = mk();
    this.zi = mk();
    this.eta = mk();
    for (let j = 0; j < ny; j++) {
      const mj = j < ny / 2 ? j : j - ny;
      for (let i = 0; i < nx; i++) {
        const mi = i < nx / 2 ? i : i - nx;
        const k = j * nx + i;
        this.kx[k] = (2 * Math.PI * mi) / Lx;
        this.ky[k] = (2 * Math.PI * mj) / Ly;
        this.kk[k] = Math.hypot(this.kx[k], this.ky[k]);
      }
    }
  }

  get timeStep() {
    return this.dt;
  }

  get current(): SurfaceParams | null {
    return this.params;
  }

  /** Physical x of grid column i (the grid wraps; the foil is at column 0). */
  xOf(i: number): number {
    const { nx, Lx, xUp } = this.grid;
    const x = (i * Lx) / nx;
    return x >= Lx - xUp ? x - Lx : x;
  }

  yOf(j: number): number {
    const { ny, Ly } = this.grid;
    const y = (j * Ly) / ny;
    return y >= Ly / 2 ? y - Ly : y;
  }

  /** Fourier forcing F = 2ŵ₀ (discrete-transform normalisation). */
  private forcing(p: SurfaceParams) {
    const { nx, ny, Lx, Ly } = this.grid;
    const dx = Lx / nx,
      dy = Ly / ny;
    const norm = 2 / (dx * dy);
    const eps = 1 / (0.6 * Lx);
    this.Fr.fill(0);
    this.Fi.fill(0);
    for (const f of p.foils) {
      const ns = f.y.length;
      // spanwise transforms (Γ and section area are even in y)
      const gHat = new Float64Array(ny);
      const mHat = new Float64Array(ny);
      let xa = 0,
        wa = 0;
      for (let s = 0; s < ns; s++) {
        xa += f.xArea[s] * f.area[s];
        wa += f.area[s];
      }
      const xThick = wa > 0 ? xa / wa : 0;
      for (let j = 0; j < ny; j++) {
        const ky = this.ky[j * nx];
        let gs = 0,
          ms = 0;
        for (let s = 0; s < ns - 1; s++) {
          const d = f.y[s + 1] - f.y[s];
          const c0 = Math.cos(ky * f.y[s]),
            c1 = Math.cos(ky * f.y[s + 1]);
          gs += 0.5 * (f.gamma[s] * c0 + f.gamma[s + 1] * c1) * d;
          ms += 0.5 * (f.area[s] * c0 + f.area[s + 1] * c1) * d;
        }
        gHat[j] = 2 * gs;
        mHat[j] = 2 * ms * p.U;
      }
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          const kx = this.kx[k],
            kk = this.kk[k];
          if (kk === 0) continue;
          const decay = Math.exp(-kk * f.h);
          // lift: −½|k| e^{−|k|h} Γ̂ / (i kx + ε)
          const a = (-0.5 * kk * decay * gHat[j]) / (eps * eps + kx * kx);
          const lre = a * eps,
            lim = -a * kx;
          // thickness: ½ i kx e^{−|k|h} μ̂ at the section centroid
          const tim = 0.5 * kx * decay * mHat[j];
          const ph = -kx * f.x0,
            pt = -kx * (f.x0 + xThick);
          const cph = Math.cos(ph),
            sph = Math.sin(ph);
          this.Fr[k] += norm * (lre * cph - lim * sph - tim * Math.sin(pt));
          this.Fi[k] += norm * (lre * sph + lim * cph + tim * Math.cos(pt));
        }
      }
    }
    if (p.strut && p.strut.area > 0) {
      const mu = p.U * p.strut.area;
      for (let k = 0; k < this.n; k++) {
        const kx = this.kx[k],
          kk = this.kk[k];
        if (kk === 0) continue;
        const im = 0.5 * kx * mu * ((1 - Math.exp(-kk * p.strut.depth)) / kk);
        const ph = -kx * p.strut.x;
        this.Fr[k] += norm * (-im * Math.sin(ph));
        this.Fi[k] += norm * (im * Math.cos(ph));
      }
    }
    // Nyquist rows/columns have no conjugate partner: drop them
    for (let j = 0; j < ny; j++) this.Fr[j * nx + nx / 2] = this.Fi[j * nx + nx / 2] = 0;
    for (let i = 0; i < nx; i++) this.Fr[(ny / 2) * nx + i] = this.Fi[(ny / 2) * nx + i] = 0;
  }

  /** Set speed, foils and time step; forcing is recomputed only when the parameters object changes. */
  setParams(p: SurfaceParams, dt: number) {
    const { Lx, Ly, nx, ny, xUp } = this.grid;
    if (p !== this.params) {
      this.params = p;
      this.mu = (0.15 * Math.max(p.U, 0.5)) / Lx;
      this.forcing(p);
      const D = p.depth;
      for (let k = 0; k < this.n; k++) {
        const kk = this.kk[k];
        this.om[k] = Math.sqrt(G * kk * (Number.isFinite(D) ? Math.tanh(kk * D) : 1));
      }
    }
    this.dt = dt;
    const U = p.U,
      mu = this.mu;
    for (let k = 0; k < this.n; k++) {
      // λ = −μ − i(U kx + ω)
      const lr = -mu,
        li = -(U * this.kx[k] + this.om[k]);
      const e = Math.exp(lr * dt);
      const er = e * Math.cos(li * dt),
        ei = e * Math.sin(li * dt);
      const nr = er - 1,
        ni = ei;
      const den = lr * lr + li * li;
      const qr = den < 1e-18 ? dt : (nr * lr + ni * li) / den;
      const qi = den < 1e-18 ? 0 : (ni * lr - nr * li) / den;
      this.mr[k] = er;
      this.mi[k] = ei;
      this.fr[k] = qr * this.Fr[k] - qi * this.Fi[k];
      this.fi[k] = qr * this.Fi[k] + qi * this.Fr[k];
    }
    // absorbing layer: exp(−dt·s) with s rising quadratically into each edge band
    const wD = 0.22 * Lx,
      wU = 0.06 * Lx,
      wY = 0.14 * Ly;
    const sMax = (9 * Math.max(U, 0.5)) / wD;
    for (let j = 0; j < ny; j++) {
      const y = Math.abs(this.yOf(j));
      const ty = this.grid.sides === false ? 0 : Math.max(0, (y - (Ly / 2 - wY)) / wY);
      for (let i = 0; i < nx; i++) {
        const x = this.xOf(i);
        const td = Math.max(0, (x - (Lx - xUp - wD)) / wD);
        const tu = Math.max(0, (-xUp + wU - x) / wU);
        const t = Math.min(1, Math.max(td, tu, ty));
        this.mask[j * nx + i] = Math.exp(-dt * sMax * t * t);
      }
    }
  }

  /** Start from the steady pattern of the periodic problem (with extra damping), then settle with the absorbing layer. */
  initSteady(settleSteps = 30) {
    const p = this.params!;
    const muInit = (1.2 * Math.max(p.U, 0.5)) / this.grid.Lx;
    for (let k = 0; k < this.n; k++) {
      // steady: A = −F/λ
      const lr = -muInit,
        li = -(p.U * this.kx[k] + this.om[k]);
      const den = lr * lr + li * li;
      const fr = this.Fr[k],
        fi = this.Fi[k];
      this.Ar[k] = den > 1e-18 ? -(fr * lr + fi * li) / den : 0;
      this.Ai[k] = den > 1e-18 ? -(fi * lr - fr * li) / den : 0;
    }
    if (settleSteps > 0) {
      const dt = this.dt;
      const big = Math.max(dt, this.grid.Lx / Math.max(p.U, 0.5) / 40);
      this.setParams(p, big);
      for (let i = 0; i < settleSteps; i++) this.step();
      this.setParams(p, dt);
    }
    this.output(false);
  }

  /** Advance one time step: exact spectral update, then the absorbing layer in physical space. */
  step() {
    const { Ar, Ai, mr, mi, fr, fi } = this;
    for (let k = 0; k < this.n; k++) {
      const ar = Ar[k],
        ai = Ai[k];
      Ar[k] = mr[k] * ar - mi[k] * ai + fr[k];
      Ai[k] = mr[k] * ai + mi[k] * ar + fi[k];
    }
    this.output(true);
  }

  /** a(x) = IFFT(A), η = Re a; optionally damp a in the absorbing layer and transform back. */
  private output(damp: boolean) {
    const { zr, zi } = this;
    zr.set(this.Ar);
    zi.set(this.Ai);
    this.fft.transform(zr, zi, true);
    if (damp) {
      const m = this.mask;
      for (let k = 0; k < this.n; k++) {
        zr[k] *= m[k];
        zi[k] *= m[k];
      }
    }
    this.eta.set(zr);
    if (damp) {
      this.fft.transform(zr, zi, false);
      this.Ar.set(zr);
      this.Ai.set(zi);
    }
  }
}
