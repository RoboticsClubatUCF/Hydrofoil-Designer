/** Small numerical toolbox shared by the physics and solver modules. */

export function linspace(a: number, b: number, n: number): number[] {
  if (n === 1) return [a];
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Linear interpolation on a monotonic increasing table; clamps at the ends. */
export function interp(x: number, xs: ArrayLike<number>, ys: ArrayLike<number>): number {
  const n = xs.length;
  if (n === 0) return NaN;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0,
    hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

/** Linear interpolation that extrapolates linearly beyond the ends. */
export function interpExtrap(x: number, xs: ArrayLike<number>, ys: ArrayLike<number>): number {
  const n = xs.length;
  if (n < 2) return ys[0];
  if (x < xs[0]) return ys[0] + ((x - xs[0]) * (ys[1] - ys[0])) / (xs[1] - xs[0]);
  if (x > xs[n - 1])
    return ys[n - 1] + ((x - xs[n - 1]) * (ys[n - 1] - ys[n - 2])) / (xs[n - 1] - xs[n - 2]);
  return interp(x, xs, ys);
}

/** Natural cubic spline through (t, v). Returns an evaluator for value and derivatives. */
export function cubicSpline(t: number[], v: number[]) {
  const n = t.length;
  const m = new Array<number>(n).fill(0); // second derivatives
  if (n > 2) {
    const a = new Array<number>(n).fill(0);
    const b = new Array<number>(n).fill(0);
    const c = new Array<number>(n).fill(0);
    const d = new Array<number>(n).fill(0);
    b[0] = 1;
    b[n - 1] = 1;
    for (let i = 1; i < n - 1; i++) {
      const h0 = t[i] - t[i - 1];
      const h1 = t[i + 1] - t[i];
      a[i] = h0;
      b[i] = 2 * (h0 + h1);
      c[i] = h1;
      d[i] = 6 * ((v[i + 1] - v[i]) / h1 - (v[i] - v[i - 1]) / h0);
    }
    // Thomas algorithm
    for (let i = 1; i < n; i++) {
      const w = a[i] / b[i - 1];
      b[i] -= w * c[i - 1];
      d[i] -= w * d[i - 1];
    }
    m[n - 1] = d[n - 1] / b[n - 1];
    for (let i = n - 2; i >= 0; i--) m[i] = (d[i] - c[i] * m[i + 1]) / b[i];
  }
  const seg = (x: number) => {
    let lo = 0,
      hi = n - 1;
    if (x <= t[0]) return 0;
    if (x >= t[n - 1]) return n - 2;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid] <= x) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  return {
    value(x: number): number {
      const i = seg(x);
      const h = t[i + 1] - t[i];
      const A = (t[i + 1] - x) / h;
      const B = (x - t[i]) / h;
      return (
        A * v[i] + B * v[i + 1] + (((A ** 3 - A) * m[i] + (B ** 3 - B) * m[i + 1]) * h * h) / 6
      );
    },
    d1(x: number): number {
      const i = seg(x);
      const h = t[i + 1] - t[i];
      const A = (t[i + 1] - x) / h;
      const B = (x - t[i]) / h;
      return (
        (v[i + 1] - v[i]) / h -
        ((3 * A * A - 1) * h * m[i]) / 6 +
        ((3 * B * B - 1) * h * m[i + 1]) / 6
      );
    },
    d2(x: number): number {
      const i = seg(x);
      const h = t[i + 1] - t[i];
      const A = (t[i + 1] - x) / h;
      const B = (x - t[i]) / h;
      return A * m[i] + B * m[i + 1];
    },
  };
}

/** Solve A x = b in place with partial-pivot Gaussian elimination. A is row-major n×n. */
export function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    if (Math.abs(M[p][k]) < 1e-300) throw new Error('Singular matrix');
    if (p !== k) [M[p], M[k]] = [M[k], M[p]];
    const pivot = M[k][k];
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / pivot;
      if (f === 0) continue;
      const Mi = M[i];
      const Mk = M[k];
      for (let j = k; j <= n; j++) Mi[j] -= f * Mk[j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

/** LU factorisation (Doolittle with partial pivoting) for repeated solves. */
export function luFactor(A: number[][]) {
  const n = A.length;
  const LU = A.map((r) => r.slice());
  const piv = Array.from({ length: n }, (_, i) => i);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(LU[i][k]) > Math.abs(LU[p][k])) p = i;
    if (Math.abs(LU[p][k]) < 1e-300) throw new Error('Singular matrix');
    if (p !== k) {
      [LU[p], LU[k]] = [LU[k], LU[p]];
      [piv[p], piv[k]] = [piv[k], piv[p]];
    }
    for (let i = k + 1; i < n; i++) {
      LU[i][k] /= LU[k][k];
      const f = LU[i][k];
      if (f === 0) continue;
      for (let j = k + 1; j < n; j++) LU[i][j] -= f * LU[k][j];
    }
  }
  return (b: number[]): number[] => {
    const y = piv.map((p) => b[p]);
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) y[i] -= LU[i][j] * y[j];
    for (let i = n - 1; i >= 0; i--) {
      for (let j = i + 1; j < n; j++) y[i] -= LU[i][j] * y[j];
      y[i] /= LU[i][i];
    }
    return y;
  };
}

export interface RootResult {
  x: number;
  iterations: number;
  converged: boolean;
}

/** Brent's method on a bracket [a, b] where f(a) and f(b) have opposite signs. */
export function brent(
  f: (x: number) => number,
  a: number,
  b: number,
  tol = 1e-12,
  maxIter = 200,
): RootResult {
  let fa = f(a),
    fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa * fb > 0) {
    return { x: NaN, iterations: 0, converged: false };
  }
  if (fa === 0) return { x: a, iterations: 0, converged: true };
  if (fb === 0) return { x: b, iterations: 0, converged: true };
  let c = a,
    fc = fa,
    d = b - a,
    e = d;
  for (let iter = 1; iter <= maxIter; iter++) {
    if (fb * fc > 0) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0) return { x: b, iterations: iter, converged: true };
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number, q: number;
      if (a === c) {
        p = 2 * xm * s;
        q = 1 - s;
      } else {
        const qq = fa / fc;
        const r = fb / fc;
        p = s * (2 * xm * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      if (2 * p < Math.min(3 * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = xm;
        e = d;
      }
    } else {
      d = xm;
      e = d;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol1 ? d : xm > 0 ? tol1 : -tol1;
    fb = f(b);
    if (!Number.isFinite(fb)) return { x: NaN, iterations: iter, converged: false };
  }
  return { x: b, iterations: maxIter, converged: false };
}

/**
 * Find a root of f by scanning for a sign change across [lo, hi] (log-spaced when
 * both bounds are positive), then refining with Brent. Returns the root closest
 * to `prefer` when several exist.
 */
export function findRoot(
  f: (x: number) => number,
  lo: number,
  hi: number,
  opts: { samples?: number; log?: boolean; prefer?: number } = {},
): RootResult {
  const samples = opts.samples ?? 60;
  const log = opts.log ?? (lo > 0 && hi > 0);
  const xs: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    xs.push(log ? lo * Math.pow(hi / lo, t) : lo + (hi - lo) * t);
  }
  const fs = xs.map((x) => f(x));
  const roots: RootResult[] = [];
  let totalIter = samples + 1;
  for (let i = 0; i < samples; i++) {
    const f0 = fs[i],
      f1 = fs[i + 1];
    if (!Number.isFinite(f0) || !Number.isFinite(f1)) continue;
    if (f0 === 0) roots.push({ x: xs[i], iterations: 0, converged: true });
    else if (f0 * f1 < 0) {
      const r = brent(f, xs[i], xs[i + 1], Math.abs(xs[i + 1]) * 1e-12 + 1e-15);
      totalIter += r.iterations;
      if (r.converged) roots.push(r);
    }
  }
  if (Number.isFinite(fs[samples]) && fs[samples] === 0)
    roots.push({ x: xs[samples], iterations: 0, converged: true });
  if (roots.length === 0) return { x: NaN, iterations: totalIter, converged: false };
  const prefer = opts.prefer;
  let best = roots[0];
  if (prefer !== undefined) {
    for (const r of roots) if (Math.abs(r.x - prefer) < Math.abs(best.x - prefer)) best = r;
  }
  return { x: best.x, iterations: totalIter, converged: true };
}

/** Golden-section search for the minimum of a unimodal function on [a, b]. */
export function goldenMin(
  f: (x: number) => number,
  a: number,
  b: number,
  tol = 1e-8,
  maxIter = 200,
) {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a),
    d = a + g * (b - a);
  let fc = f(c),
    fd = f(d);
  for (let i = 0; i < maxIter && Math.abs(b - a) > tol; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = f(d);
    }
  }
  const x = (a + b) / 2;
  return { x, f: f(x) };
}

/** Nelder–Mead simplex minimiser (unconstrained; callers map bounds themselves). */
export function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  opts: { step?: number; maxIter?: number; tol?: number } = {},
): { x: number[]; f: number; iterations: number } {
  const n = x0.length;
  const step = opts.step ?? 0.25;
  const maxIter = opts.maxIter ?? 400;
  const tol = opts.tol ?? 1e-9;
  let simplex: { x: number[]; f: number }[] = [{ x: x0.slice(), f: f(x0) }];
  for (let i = 0; i < n; i++) {
    const x = x0.slice();
    x[i] += step;
    simplex.push({ x, f: f(x) });
  }
  let iter = 0;
  for (; iter < maxIter; iter++) {
    simplex.sort((p, q) => p.f - q.f);
    const best = simplex[0],
      worst = simplex[n];
    if (Math.abs(worst.f - best.f) <= tol * (Math.abs(best.f) + tol)) {
      let spread = 0;
      for (const p of simplex)
        for (let j = 0; j < n; j++) spread = Math.max(spread, Math.abs(p.x[j] - best.x[j]));
      if (spread < 1e-6) break;
    }
    const centroid = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i].x[j] / n;
    const pt = (t: number) => centroid.map((c, j) => c + t * (worst.x[j] - c));
    const xr = pt(-1);
    const fr = f(xr);
    if (fr < best.f) {
      const xe = pt(-2);
      const fe = f(xe);
      simplex[n] = fe < fr ? { x: xe, f: fe } : { x: xr, f: fr };
    } else if (fr < simplex[n - 1].f) {
      simplex[n] = { x: xr, f: fr };
    } else {
      const xc = fr < worst.f ? pt(-0.5) : pt(0.5);
      const fc = f(xc);
      if (fc < Math.min(fr, worst.f)) simplex[n] = { x: xc, f: fc };
      else {
        simplex = simplex.map((p, i) =>
          i === 0
            ? p
            : (() => {
                const x = p.x.map((v, j) => best.x[j] + 0.5 * (v - best.x[j]));
                return { x, f: f(x) };
              })(),
        );
      }
    }
  }
  simplex.sort((p, q) => p.f - q.f);
  return { x: simplex[0].x, f: simplex[0].f, iterations: iter };
}

/** Least-squares straight line fit. */
export function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return { slope, intercept: (sy - slope * sx) / n };
}

/** Trapezoidal integral of samples. */
export function trapz(xs: ArrayLike<number>, ys: ArrayLike<number>): number {
  let s = 0;
  for (let i = 1; i < xs.length; i++) s += 0.5 * (ys[i] + ys[i - 1]) * (xs[i] - xs[i - 1]);
  return s;
}
