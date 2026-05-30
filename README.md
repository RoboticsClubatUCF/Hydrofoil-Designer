# PEP27 Hydrofoil Designer

A self-hosted web tool for designing hydrofoil profiles. Paste an airfoil `.dat` file, enter your craft's design parameters, and receive a full aerodynamic sizing report, a **STEP file** ready to import into any major 3D modeling software, and an interactive **3D assembly preview**.

---

## Features

- Paste any standard airfoil `.dat` coordinate file (Selig format)
- Automatically extracts **max thickness** and **max camber** with chord locations
- Calculates chord, span, planform area, aspect ratio, lift coefficient, and angle of attack using **Prandtl's lifting-line theory**
- Supports independent front and rear foil profiles (or use the same profile for both)
- Two sizing modes per foil: **thickness-constrained** (drives chord from a max thickness limit) or **direct chord**
- Optional advanced constraints: min/max span, chord, and aspect ratio per foil
- **Error and warning system** — constraint violations and marginal conditions reported with actionable fix suggestions
- **Strut length** calculated dynamically from hull clearance + submergence factor × chord
- Generates a **STEP solid** of each foil for direct import into CAD software
- **Interactive 3D assembly preview** — foils, struts, and hull rendered in-browser with drag/zoom controls
- **Settings export/import** — save and restore all form values as a JSON file
- Light and **dark mode** support
- Unit-flexible inputs: N / lbs / kg, km/h / m/s / knots, fresh / brackish / salt / custom water density

---

## Setup

### Requirements

- Python 3.10+
- Windows, macOS, or Linux

### Install

```bash
# Clone or copy the project folder, then:
cd Hydrofoil-Designer

# Create a virtual environment
python -m venv .venv

# Activate it
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# macOS / Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Run

```bash
python app.py
```

Open `http://localhost:5000` in your browser.

For production (multi-user hosting):

```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

---

## Usage

### 1. Paste a `.dat` profile

Paste the raw text of a standard airfoil coordinate file into the **Front Foil Profile** box.
An example NACA 4418 file is included — click **"Load NACA 4418 example"** to pre-fill it.

**Expected format (Selig):**

```
NACA 4418
1.0000     0.0019
0.9500     0.0189
...
0.0000     0.0000
0.0125    -0.0211
...
1.0000    -0.0019
```

- Line 1: profile name
- Remaining lines: X Y coordinate pairs (normalized 0–1)
- Upper surface (Y ≥ 0) listed first, trailing edge → leading edge
- Lower surface (Y < 0) listed second, leading edge → trailing edge

### 2. Set the rear foil

Choose **"Same profile as front"** or **"Different profile"** and paste a second `.dat` file if needed.

### 3. Enter design parameters

| Parameter | Description |
|---|---|
| Total craft weight | Full loaded weight of the craft |
| Takeoff speed | Speed at which the hull leaves the water |
| Water type | Sets fluid density (fresh / brackish / salt / custom) |
| Front foil load share | Percentage of total lift carried by the front foil |
| Target hull clearance | Desired ride height above the waterline |
| Submergence factor *n* | Multiplier for chord depth in strut length calculation (default 1.5) |
| Sizing mode | Thickness limit (drives chord) or direct chord input, per foil |
| Max thickness / Chord | Structural thickness limit or explicit chord length, per foil |
| Front / rear C_L | Target lift coefficient for each foil |
| Oswald efficiency *e* | Planform efficiency factor (default 0.9) |

**Advanced Constraints** (optional, collapsible):

Each foil supports optional min/max bounds on span, chord, and aspect ratio. Leave blank to unconstrain.

### 4. Calculate

Click **Calculate & Preview**. The tool displays for each foil:

- Profile summary (thickness %, camber %, chord locations, strut length)
- Airfoil shape plot
- Full design table (chord, span, area, AR, AoA, lift slope, zero-lift angle, dynamic pressure)
- Any **errors** (constraint violations, stall risk) with fix suggestions
- Any **warnings** (marginal but feasible conditions) with suggestions
- **Download STEP** button

### 5. 3D Assembly Preview

An interactive 3D scene appears below the results showing the full hydrofoil assembly — front and rear foils, struts, and hull. Controls:

- **Left-drag** — orbit
- **Scroll** — zoom
- **Right-drag / Shift-drag** — pan

Sliders and toggles in the sidebar let you adjust hull clearance and foil separation in real time, and toggle the waterline plane, labels, wireframe, and auto-rotate.

### 6. Import into your CAD software

Open or import the downloaded `.step` file in any 3D modeling software that supports STEP (Fusion 360, FreeCAD, SolidWorks, Onshape, etc.).
The foil appears as a solid body with the correct cross-section and full span.

### 7. Settings export / import

Use **Export Settings** to save all current form values as a JSON file, and **Import Settings** to restore a previously saved session.

---

## Calculation Method

```
L = ½ · ρ · V² · S · CL                      (lift equation)

chord = max_thickness_mm / (thickness% / 100)  (structural constraint)

S = L / (½ · ρ · V² · CL)                     (required planform area)

span = S / chord

a = a₀ / (1 + 57.3·a₀ / (π·e·AR))            (Prandtl lifting-line, 3D slope)

α = CL / a + α_L=0                             (angle of attack)

strut_length = hull_clearance + n × chord      (strut sizing)
```

Where `a₀ ≈ 0.10966 /°` (thin airfoil theory, 2π per radian) and `α_L=0 ≈ −camber%` degrees.

---

## Project Structure

```
Hydrofoil-Designer/
├── app.py              # Flask routes: GET /, POST /api/calculate, POST /api/step
├── dat_parser.py       # .dat parsing and profile parameter extraction
├── foil_math.py        # Aerodynamic calculations and constraint checks
├── step_generator.py   # OCP: 2D profile → 3D STEP file
├── requirements.txt
├── templates/
│   └── index.html      # Single-page UI (vanilla HTML/CSS/JS + Three.js)
├── static/
│   └── style.css       # Navy/blue maritime theme, light/dark mode
└── example_data/
    └── naca4418.dat    # NACA 4418 example profile
```

---

## Verification Baseline

Using the PEP27 design spec (890 N craft, 70/30 load split, 3.61 m/s takeoff, ρ = 1010 kg/m³ brackish, 30 mm max front thickness, C_L = 0.8, NACA 4418):

| Output | Expected |
|---|---|
| Chord | 166.7 mm |
| Span | 710.0 mm |
| Angle of attack | 7.1° |
