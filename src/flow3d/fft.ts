/** In-place radix-2 complex FFT on split real/imaginary arrays, and a 2-D version on row-major grids. */

export class FFT {
  readonly n: number;
  private rev: Uint32Array;
  private cos: Float64Array;
  private sin: Float64Array;

  constructor(n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${n}`);
    this.n = n;
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      this.cos[k] = Math.cos((2 * Math.PI * k) / n);
      this.sin[k] = Math.sin((2 * Math.PI * k) / n);
    }
  }

  /** Forward: X_k = Σ x_j e^{−2πi jk/n}. Inverse: no 1/n scaling (the caller scales). */
  transform(re: Float64Array, im: Float64Array, inverse: boolean, off = 0): void {
    const n = this.n;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        const a = off + i,
          b = off + j;
        let t = re[a];
        re[a] = re[b];
        re[b] = t;
        t = im[a];
        im[a] = im[b];
        im[b] = t;
      }
    }
    const sgn = inverse ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const wr = this.cos[k];
          const wi = sgn * this.sin[k];
          const a = off + i + j;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

/** 2-D FFT of an ny × nx row-major grid (index j·nx + i). The inverse includes the 1/(nx·ny) scaling. */
export class FFT2 {
  readonly nx: number;
  readonly ny: number;
  private fx: FFT;
  private fy: FFT;
  private colRe: Float64Array;
  private colIm: Float64Array;

  constructor(nx: number, ny: number) {
    this.nx = nx;
    this.ny = ny;
    this.fx = new FFT(nx);
    this.fy = nx === ny ? this.fx : new FFT(ny);
    this.colRe = new Float64Array(ny);
    this.colIm = new Float64Array(ny);
  }

  transform(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const { nx, ny } = this;
    for (let j = 0; j < ny; j++) this.fx.transform(re, im, inverse, j * nx);
    const cr = this.colRe,
      ci = this.colIm;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        cr[j] = re[j * nx + i];
        ci[j] = im[j * nx + i];
      }
      this.fy.transform(cr, ci, inverse, 0);
      for (let j = 0; j < ny; j++) {
        re[j * nx + i] = cr[j];
        im[j * nx + i] = ci[j];
      }
    }
    if (inverse) {
      const s = 1 / (nx * ny);
      for (let k = 0; k < re.length; k++) {
        re[k] *= s;
        im[k] *= s;
      }
    }
  }
}
