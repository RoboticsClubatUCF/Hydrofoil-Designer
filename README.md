# PEP27 Hydrofoil Designer

A self-hosted web tool for designing hydrofoil profiles. Paste an airfoil `.dat` file, enter your craft's design parameters, and receive a full aerodynamic sizing report plus a **STEP file** ready to import into any major 3D modeling software.

---

## Features

- Paste any standard airfoil `.dat` coordinate file (Selig format)
- Automatically extracts **max thickness** and **max camber** with chord locations
- Calculates chord, span, planform area, aspect ratio, lift coefficient, and angle of attack using **Prandtl's lifting-line theory**
- Supports independent front and rear foil profiles (or use the same profile for both)
- Generates a **STEP solid** of the 3D foil geometry for direct import into Onshape
- Unit-flexible inputs: N / lbs / kg, km/h / m/s / knots, fresh / brackish / salt water

---

## Setup

### Requirements

- Python 3.10+
- Windows, macOS, or Linux

### Install

```bash
# Clone or copy the project folder, then:
cd HydrofoilMaker

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
An example NACA 4418 file is included in `example_data/naca4418.dat` — click **"Load NACA 4418 example"** to pre-fill it.

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
| Max front / rear thickness | Structural thickness limit — drives chord length |
| Front / rear C_L | Target lift coefficient for each foil |
| Oswald efficiency *e* | Planform efficiency factor (default 0.9) |

### 4. Calculate

Click **Calculate & Preview**. The tool displays:

- Profile summary (thickness %, camber %, chord locations)
- Airfoil shape plot
- Full design table (chord, span, area, AR, AoA, lift slope)
- **Download STEP** button for each foil

### 5. Import into Onshape

In a Part Studio: **Insert → Import** and select the downloaded `.step` file.
The foil appears as a solid body with the correct cross-section and full span.

---

## Calculation Method

```
L = ½ · ρ · V² · S · CL                      (lift equation)

chord = max_thickness_mm / (thickness% / 100)  (structural constraint)

S = L / (½ · ρ · V² · CL)                     (required planform area)

span = S / chord

a = a₀ / (1 + 57.3·a₀ / (π·e·AR))            (Prandtl lifting-line, 3D slope)

α = CL / a + α_L=0                             (angle of attack)
```

Where `a₀ ≈ 0.10966 /°` (thin airfoil theory, 2π per radian) and `α_L=0 ≈ −camber%` degrees.

---

## Project Structure

```
HydrofoilMaker/
├── app.py              # Flask routes
├── dat_parser.py       # .dat parsing and profile parameter extraction
├── foil_math.py        # Aerodynamic calculations
├── step_generator.py   # CadQuery: 2D profile → 3D STEP file
├── requirements.txt
├── templates/
│   └── index.html      # Single-page UI
├── static/
│   └── style.css
└── example_data/
    └── naca4418.dat    # NACA 4418 example profile
```

---

## Verification Baseline

Using the PEP27 design spec (890 N craft, 70/30 load split, 3.61 m/s takeoff, ρ = 1 000 kg/m³, 30 mm max front thickness, C_L = 0.8, NACA 4418):

| Output | Expected | Tool result |
|---|---|---|
| Chord | ~167 mm | 166.5 mm |
| Span | ~720 mm | 717.9 mm |
| Aspect ratio | ~4.3 | 4.31 |
| Lift slope | ~0.072 /° | 0.07237 /° |
| Angle of attack | ~7.1° | 7.1° |
