# Hydrofoil Designer

An interactive, browser-based designer for hydrofoils. Paste a section profile from
[airfoiltools.com](http://airfoiltools.com/), type in **only what you know or want**, and the
designer works out everything else — span, chord, area, angle of attack, lift coefficient,
drag, power, take-off speed, stall and cavitation margins, bending stress and deflection.

- Fields you fill in are **entered**; everything that follows from them is **calculated**,
  greyed out and locked.
- Anything still free is **optimised** to meet your requirements (or a sensible default is
  **assumed**), and the app tells you which limits are shaping the design.
- Every value has an **ƒ** button that shows exactly how it was found: the formula, the numbers
  substituted, the method, and links to the values it came from and the ones it feeds.
- The proposed foil is then **simulated**: section pressures, spanwise loading, bending,
  and a speed sweep at constant load.

It runs entirely in the browser — no install, no server, works offline once loaded.

**Live site:** `https://roboticsclubatucf.github.io/Hydrofoil-Designer/` (published by GitHub
Actions from `main`; see [Deploying](#deploying)).

---

## Using it

### 1 · Section

1. On airfoiltools.com, find your section (e.g. _NACA 63-412_) and open either
   **Lednicer format dat file** or **Selig format dat file**.
2. Paste the text into the Section box, upload the `.dat` file, or drop it on the box.
   Both formats are detected automatically; coordinates that are scaled, shifted, rotated or
   listed lower-surface-first are normalised (you are told when that happens).
3. _Optional but recommended:_ on the same airfoiltools page, open one or more XFoil polars
   (e.g. Re 200 000, 500 000 and 1 000 000, Ncrit 9), and paste each polar's CSV under
   **Polar data**. With polars the section lift, drag and stall come from XFoil data,
   interpolated to the foil's Reynolds number. Without them they are estimated from the shape
   (see [Accuracy](#accuracy)).

`Load example` loads the NACA 63-412 profile.

### 2 · Design

Every field starts blank. Fill in whatever you know, in any order and in any unit — for example:

| You know…                          | You get…                                                           |
| ---------------------------------- | ------------------------------------------------------------------ |
| craft mass, cruise speed           | a complete foil, optimised for your requirements                   |
| mass, speed, span                  | chord, area, angle, drag… with only the aspect ratio optimised     |
| mass, speed, span, angle of attack | everything — span, angle and the lift equation are solved together |
| mass, speed, span, safety factor   | the chord needed for that safety factor                            |
| mass, take-off speed               | the area needed to lift off at that speed                          |
| span and chord                     | area, aspect ratio and the section's geometry                      |

Field colours:

| State                               | Meaning                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **entered** (blue outline)          | you typed it — press <kbd>Esc</kbd> or empty the box to clear it                                                                                 |
| **calculated** (grey)               | follows from your entries; locked — hover to see which entries fix it, clear one of them to type here                                            |
| **assumed** (violet, italic)        | a default used because it unlocks a calculation (water temperature 20 °C, full load share, deep water, sea-level air pressure) — type to replace |
| **optimised** (green)               | chosen by the optimiser for your objective within your requirements — type to replace                                                            |
| **from section / material / fixed** | read from the profile, the selected material, or the planform shape                                                                              |
| **conflict** (red)                  | your entries contradict each other (usually after switching planform); the status panel says which to clear                                      |

Planform shape (rectangular, tapered, elliptical), material and water type are chosen with the
selectors in their groups. Add a **foil depth** to include the free-surface lift loss and
the cavitation check.

### 3 · Requirements

Limits applied whenever the designer fills in something you left blank: maximum span, root
chord range, minimum root thickness, minimum safety factor (default 1.5), maximum take-off
speed, minimum stall margin (default 2°), aspect-ratio range (default 3–12), maximum tip
deflection, and no cavitation at cruise. Choose the objective: **minimum drag at cruise**,
**lowest take-off speed** or **lightest foil**. Each requirement shows ✓ met, ✕ not met, and a ring
when it is the limit shaping the design. If they cannot all be met, the closest design is shown
with what failed.

### Results

- **Overview** — dimensioned planform drawing and the key numbers.
- **Section** — pressure distribution at the most-loaded station (with the cavitation threshold
  −σ when a depth is given), section lift curve and drag curve with the cruise point.
- **Span & structure** — local lift coefficient against the section maximum, lift per unit span,
  bending moment, bending stress against material strength, deflection.
- **Speed sweep** — angle of attack, drag, power, L/D and cavitation margin against speed, at
  constant load, with take-off, cruise and cavitation-inception speeds marked.
- **Calculations** — every value in order with its worked calculation; copy or download as
  Markdown, or print.
- **Export** — DXF (root and tip sections plus half planform, mm, separate layers), XYZ point
  files for CAD splines, a CSV of both sections, the calculation report, the design file and the
  normalised profile.

Every chart has a crosshair readout (mouse or ←/→ keys) and a **Show table** view.

**Save** downloads the design as JSON (reopen with **Open**); **Share link** copies a URL that
contains the whole design; the current design is also kept in the browser between visits.
**SI / US** switches all units; any field's unit can also be changed individually.

---

## How it works

### The solver

The design is a system of about 60 variables linked by about 45 equations (the main ones are listed below). Each equation
knows how to be rearranged for each of its variables, or can be solved numerically when it
cannot. On every change:

1. **Structure.** Your entries, the section data and the material are the knowns. The remaining
   equations and unknowns form a bipartite graph; a maximum matching plus a
   Dulmage–Mendelsohn decomposition finds which unknowns are determined, and Tarjan's
   algorithm orders them into blocks (block-lower-triangular form, as used by equation-based
   modelling tools).
2. **Solve.** One-equation blocks are solved in closed form (or by Brent's method on a
   bracketing scan); blocks of equations that share unknowns are solved simultaneously by damped
   Newton–Raphson (Levenberg–Marquardt) in log space, then verified by back-substitution. Each
   result records its formula, substitution and inputs — that is what the **ƒ** panels show.
3. **Reynolds number.** Section data depends on Re, which depends on chord, so the solve is
   repeated with updated section data until Re settles (usually 1–3 passes). Take-off speed
   uses the section max lift at the take-off Reynolds number, which is iterated the same way.
4. **Assumptions** are added only when they unlock another calculation, so a blank form stays blank.
5. **Fitting.** If load and a speed are known but the design is not yet determined, the free
   choices (aspect ratio, angle of attack, taper ratio, then span/chord) are picked in turn —
   only ones that actually unlock results — and optimised with Nelder–Mead over bounded
   coordinates, minimising the objective plus penalties for any unmet requirement.
6. **Checks.** Every fully known equation is re-checked; contradictions are reported as conflicts.

All of this runs in a Web Worker so typing stays responsive.

### Main equations

|                             |                                                                   |
| --------------------------- | ----------------------------------------------------------------- |
| Lift from weight            | L = s_L · m · g                                                   |
| Dynamic pressure            | q = ½ ρ V²                                                        |
| Lift                        | L = q S C_L                                                       |
| Planform                    | S = b c̄, AR = b²/S, c̄ and MAC from the planform law, c_t = λ c_r  |
| Reynolds number             | Re = V · MAC / ν                                                  |
| Lift curve                  | C_L = k_FS · C_Lα(AR, λ, a₀) · (α − α_L0)                         |
| Induced drag                | C_Di = C_L² / (π e AR)                                            |
| Profile drag                | C_Dp = (1/S) ∫ c_d(c_l(y), Re(y)) c(y) dy (strip integration)     |
| Drag, power                 | D = q S (C_Dp + C_Di), P = D V                                    |
| Max lift (critical section) | C_L,max = c_l,max / k_peak                                        |
| Max lift at take-off        | C_L,max,TO = c_l,max(Re_TO) / k_peak, Re_TO = V_TO · MAC / ν      |
| Take-off speed              | L = ½ ρ V_TO² S C_L,max,TO                                        |
| Stall                       | α_stall = α_L0 + C_L,max / (k_FS C_Lα), margin = α_stall − α      |
| Free surface                | k_FS = (16 (h/c)² + 1) / (16 (h/c)² + 2)                          |
| Cavitation                  | σ = (p_atm + ρ g h − p_v) / q, margin = σ + C_p,min(c_l,peak)     |
| Bending                     | M_r = (L/2)(b/2) η̄, σ_max = k_σ M_r / (Z₁ c_r³), SF = σ_y / σ_max |
| Deflection                  | δ = ∬ M / (E I₁ c⁴) dy dy (tapered beam)                          |
| Mass                        | m_f = ρ_m A₁ ∫ c² dy                                              |

### Methods and references

| Topic                          | Method                                                                                                                                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile                        | Arc-length cubic spline through the points; cosine re-paneling (200 panels); thickness, camber, leading-edge radius (spline curvature), trailing-edge gap/angle; area, centroid, second moment and section modulus of the solid section by polygon integration         |
| Inviscid section               | Linear-strength vortex panel method with Kutta condition, solved once for two freestream directions and superposed for any angle (Katz & Plotkin, _Low-Speed Aerodynamics_, §11.4). Validated against the exact Joukowski solution and thin-aerofoil theory            |
| Boundary layer (estimate mode) | Thwaites' method with Cebeci–Bradshaw fits; Michel's transition criterion, or transition at laminar separation; Head's entrainment method with Ludwieg–Tillmann skin friction; Squire–Young drag. Max lift where upper-surface turbulent separation reaches 92 % chord |
| Polars (polar mode)            | airfoiltools CSV or XFoil text; zero-lift angle and slope from a linear fit of the attached range; drag from the attached branch; interpolation in log Re                                                                                                              |
| Finite foil                    | Prandtl lifting line, Glauert series with 24 odd terms (Anderson, _Fundamentals of Aerodynamics_, §5.3) → C_Lα, e, spanwise c_l, load centroid                                                                                                                         |
| Free surface                   | High-Froude image-vortex lift factor (Hoerner & Borst, _Fluid-Dynamic Lift_, ch. 10)                                                                                                                                                                                   |
| Cavitation                     | Panel-method C_p,min at the most-loaded station's c_l; inception speed at constant lift is the highest speed where σ + C_p,min = 0 (downward speed scan, then Brent's method)                                                                                          |
| Water                          | Pure-water density: Kell (1975); viscosity and seawater corrections: Sharqawy, Lienhard & Zubair (2010); vapour pressure: Buck (1996)                                                                                                                                  |
| Structure                      | Each half-span a cantilever from a centre strut (T-foil), lifting-line load, solid section, Euler–Bernoulli bending                                                                                                                                                    |

### Accuracy

Checked by the unit tests (`npm test`):

- Panel method: Joukowski lift within 1.5 %; NACA 2412/4412 zero-lift angles within 0.2° of
  thin-aerofoil theory; converged with panel count.
- Boundary layer: laminar flat plate within 1 % of Blasius.
- Lifting line: elliptical e = 1 and exact lift slope; rectangular AR 6 δ ≈ 0.05.
- Estimate mode vs. XFoil polars for NACA 63-412 at Re 0.5–1 M: zero-lift angle within 0.5°,
  lift slope within 10 %, max lift within 15 %, drag within 30 % (on the high side).
- Water properties against ITTC tables; a fully specified design against an independent hand
  calculation.

### Limitations

- Straight, untwisted, unswept foils; one section along the span; a single foil (enter the
  load share for a main foil that carries part of the weight). No strut, fuselage, wave or spray drag.
- Lift curve is linear up to the (conservative) linear stall estimate; real foils round off near stall.
- Estimate mode has no viscous–inviscid coupling — paste polars for accurate drag and max lift,
  especially below Re ≈ 2 × 10⁵ where laminar separation bubbles dominate.
- The free-surface factor is the high-speed (high Froude number) limit; ventilation is only flagged.
- Structure assumes a solid foil of one isotropic material; laminates and prints depend on layup
  and orientation.
- The browser cannot fetch from airfoiltools.com directly (that site is HTTP-only and sends no CORS
  headers), so data is pasted or uploaded.

---

## Development

Requires Node 22+.

```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run e2e        # browser tests (Playwright; builds and serves the app)
npm run lint
npm run typecheck
npm run build      # static site in dist/
```

```
src/
  physics/         pure TypeScript, no UI
    profile/       parsing, geometry, panel method, boundary layer, polars, section model
    wing/          planform laws, lifting line
    hydro/         free surface, cavitation
    structure/     materials, beam bending
    fluid.ts       water properties
    units.ts       units and conversions
    numeric.ts     splines, root finding, linear algebra, Nelder–Mead
  solver/          variables, equations, decomposition/solve engine, assumptions, optimiser
  simulate/        span loading, section plots, speed sweep
  export/          DXF, XYZ/CSV, Markdown report
  worker/          Web Worker running the section model, solver and simulation
  state/           Zustand store, autosave, share links
  ui/              React components and SVG charts
tests/             unit tests
e2e/               Playwright tests
public/examples/   NACA 63-412 example profile
```

### Deploying

`.github/workflows/ci.yml` lints, type-checks, tests and builds every pull request, and on
`main` publishes `dist/` to GitHub Pages. One-time setup: **Settings → Pages → Build and
deployment → Source: GitHub Actions**. The build uses relative paths, so it also works from any
static file host.

## License

MIT — see [LICENSE](LICENSE).
