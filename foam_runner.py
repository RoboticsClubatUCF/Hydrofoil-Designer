"""
foam_runner.py — Headless OpenFOAM orchestration via Docker.

Pipeline per job:
  generate_airfoil_stl → generate_case → Docker(blockMesh + snappyHexMesh +
  simpleFoam) → extract_field_data → return JSON-serialisable result dict.

Jobs are tracked in _JOBS (in-memory) and run in daemon threads.
"""

import math
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path, PurePosixPath

import numpy as np

# ---------------------------------------------------------------------------
# Resolution presets
# ---------------------------------------------------------------------------

RESOLUTION_PARAMS = {
    1: {"level": 3, "nx": 60,  "ny": 40,  "timeout": 360,  "label": "Low"},
    2: {"level": 4, "nx": 120, "ny": 80,  "timeout": 720,  "label": "Medium"},
    3: {"level": 5, "nx": 200, "ny": 120, "timeout": 1500, "label": "High"},
}

# Domain in chord-normalised units
_X_MIN_C = -5.0
_X_MAX_C = 15.0
_Y_MIN_C = -3.0
_Y_MAX_C =  3.0
_Z_DEPTH_C = 0.01   # 1-cell-thick pseudo-2D slab

DOCKER_IMAGE = "pep27-openfoam"

# ---------------------------------------------------------------------------
# Job store
# ---------------------------------------------------------------------------

_JOBS: dict = {}
_JOBS_LOCK = threading.Lock()


def submit_job(params: dict) -> str:
    job_id = uuid.uuid4().hex[:8]
    case_dir = tempfile.mkdtemp(prefix=f"foam_{job_id}_")
    with _JOBS_LOCK:
        _JOBS[job_id] = {
            "status":   "running",
            "progress": 0,
            "message":  "Initialising…",
            "result":   None,
            "error_detail": None,
            "case_dir": case_dir,
            "created":  time.time(),
        }
    t = threading.Thread(target=_run_job_thread, args=(job_id, params, case_dir), daemon=True)
    t.start()
    return job_id


def get_job(job_id: str) -> dict | None:
    with _JOBS_LOCK:
        return _JOBS.get(job_id)


def _update(job_id, **kw):
    with _JOBS_LOCK:
        _JOBS[job_id].update(kw)


# ---------------------------------------------------------------------------
# Job thread
# ---------------------------------------------------------------------------

def _run_job_thread(job_id: str, params: dict, case_dir: str):
    try:
        chord_m    = params["chord_m"]
        v_ms       = params["v_ms"]
        rho        = params["rho"]
        nu         = params["nu"]
        aoa_deg    = params["aoa_deg"]
        coords     = params["coords"]      # list of [x, y] in 0-1 space
        resolution = params["resolution"]
        foil_key   = params["foil"]

        res = RESOLUTION_PARAMS[resolution]

        # --- Stage 1: Generate STL ------------------------------------------
        _update(job_id, progress=3, message="Generating airfoil geometry…")
        depth_m = max(chord_m * _Z_DEPTH_C, chord_m * 0.002)
        stl_str = generate_airfoil_stl(coords, chord_m, depth_m, aoa_deg)

        # --- Stage 2: Write case files -------------------------------------
        _update(job_id, progress=6, message="Writing OpenFOAM case files…")
        generate_case(case_dir, stl_str, chord_m, v_ms, rho, nu, resolution)

        # --- Stage 3: Check Docker image -----------------------------------
        _update(job_id, progress=8, message="Checking Docker image…")
        inspect = subprocess.run(
            ["docker", "image", "inspect", DOCKER_IMAGE],
            capture_output=True
        )
        if inspect.returncode != 0:
            raise RuntimeError(
                f'Docker image "{DOCKER_IMAGE}" not found. '
                f"Build it once from the Hydrofoil-Designer directory:\n"
                f"  docker build -t {DOCKER_IMAGE} ."
            )

        # --- Stage 4: blockMesh --------------------------------------------
        _update(job_id, progress=10, message="Running blockMesh…")
        rc, stdout, stderr = _docker_run(case_dir,
            "blockMesh > /case/log.blockMesh 2>&1", res["timeout"] // 4)
        if rc != 0:
            raise RuntimeError(f"blockMesh failed:\n{_tail(case_dir, 'log.blockMesh')}")

        # --- Stage 5: snappyHexMesh ----------------------------------------
        _update(job_id, progress=25, message="Running snappyHexMesh…")
        rc, _, _ = _docker_run(case_dir,
            "snappyHexMesh -overwrite > /case/log.snappy 2>&1", res["timeout"] // 2)
        if rc != 0:
            raise RuntimeError(f"snappyHexMesh failed:\n{_tail(case_dir, 'log.snappy')}")

        # Convert frontAndBack back to empty for 2D simpleFoam
        _fix_frontAndBack_to_empty(case_dir)

        # --- Stage 6: checkMesh (non-fatal) --------------------------------
        _update(job_id, progress=40, message="Checking mesh quality…")
        _docker_run(case_dir, "checkMesh > /case/log.checkMesh 2>&1", 60)

        # --- Stage 7: simpleFoam -------------------------------------------
        _update(job_id, progress=45, message="Running simpleFoam (CFD solver)…")
        rc, _, _ = _docker_run(case_dir,
            "foamRun -solver incompressibleFluid > /case/log.simpleFoam 2>&1", res["timeout"])
        # Non-zero exit on residual divergence is OK if field data was written.
        # Fatal crash (no output at all) gets a log-tailed error.
        if _find_latest_time_dir(case_dir) is None:
            raise RuntimeError(
                f"simpleFoam produced no output.\n"
                f"{_tail(case_dir, 'log.simpleFoam', n=50)}"
            )

        # --- Stage 8: writeCellCentres -------------------------------------
        _update(job_id, progress=88, message="Post-processing field data…")
        _docker_run(case_dir,
            "postProcess -func writeCellCentres -latestTime > /case/log.postproc 2>&1", 120)

        # --- Stage 9: Extract results --------------------------------------
        _update(job_id, progress=93, message="Interpolating onto visualization grid…")
        nx, ny = res["nx"], res["ny"]
        result = extract_field_data(case_dir, nx, ny, chord_m, v_ms, rho, aoa_deg,
                                    coords, foil_key, resolution)

        _update(job_id, status="complete", progress=100, message="Done.", result=result)

    except Exception as exc:
        _update(job_id, status="error", progress=100,
                message="CFD failed.", error_detail=str(exc))
    finally:
        # Clean up large mesh files but keep logs for debugging
        _cleanup_mesh(case_dir)


# ---------------------------------------------------------------------------
# STL generation
# ---------------------------------------------------------------------------

def generate_airfoil_stl(coords_norm, chord_m: float, depth_m: float, aoa_deg: float) -> str:
    """Return ASCII STL string for the airfoil cross-section extruded in Z."""
    # Scale and rotate coords
    ang = math.radians(-aoa_deg)
    cos_a, sin_a = math.cos(ang), math.sin(ang)
    pts2d = []
    for xy in coords_norm:
        x, y = float(xy[0]) * chord_m, float(xy[1]) * chord_m
        # Translate so quarter-chord is at origin
        x -= 0.25 * chord_m
        # Rotate by -aoa (foil rotated, flow stays horizontal)
        xr = x * cos_a - y * sin_a
        yr = x * sin_a + y * cos_a
        pts2d.append((xr, yr))

    # Close polygon
    if pts2d[0] != pts2d[-1]:
        pts2d.append(pts2d[0])

    z0 = -depth_m / 2.0
    z1 =  depth_m / 2.0
    n = len(pts2d) - 1  # number of segments

    triangles = []

    # Side quads → 2 triangles each
    for i in range(n):
        x0, y0 = pts2d[i]
        x1, y1 = pts2d[i + 1]
        # quad: (x0,y0,z0), (x1,y1,z0), (x1,y1,z1), (x0,y0,z1)
        triangles.append(((x0, y0, z0), (x1, y1, z0), (x1, y1, z1)))
        triangles.append(((x0, y0, z0), (x1, y1, z1), (x0, y0, z1)))

    # Front cap (z=z0, CCW looking from -z) and back cap (z=z1, CCW from +z)
    cx = sum(p[0] for p in pts2d[:-1]) / n
    cy = sum(p[1] for p in pts2d[:-1]) / n
    for i in range(n):
        x0, y0 = pts2d[i]
        x1, y1 = pts2d[i + 1]
        triangles.append(((cx, cy, z0), (x1, y1, z0), (x0, y0, z0)))
        triangles.append(((cx, cy, z1), (x0, y0, z1), (x1, y1, z1)))

    lines = ["solid airfoil"]
    for tri in triangles:
        # Compute normal via cross product
        v1 = (tri[1][0]-tri[0][0], tri[1][1]-tri[0][1], tri[1][2]-tri[0][2])
        v2 = (tri[2][0]-tri[0][0], tri[2][1]-tri[0][1], tri[2][2]-tri[0][2])
        nx_ = v1[1]*v2[2] - v1[2]*v2[1]
        ny_ = v1[2]*v2[0] - v1[0]*v2[2]
        nz_ = v1[0]*v2[1] - v1[1]*v2[0]
        mag = math.sqrt(nx_*nx_ + ny_*ny_ + nz_*nz_) or 1.0
        lines.append(f"  facet normal {nx_/mag:.6f} {ny_/mag:.6f} {nz_/mag:.6f}")
        lines.append("    outer loop")
        for vx, vy, vz in tri:
            lines.append(f"      vertex {vx:.8f} {vy:.8f} {vz:.8f}")
        lines.append("    endloop")
        lines.append("  endfacet")
    lines.append("endsolid airfoil")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Case file generation
# ---------------------------------------------------------------------------

def generate_case(case_dir: str, stl_str: str, chord_m: float,
                  v_ms: float, rho: float, nu: float, resolution: int):
    """Write the complete OpenFOAM case directory tree."""
    res = RESOLUTION_PARAMS[resolution]

    xmin = chord_m * _X_MIN_C
    xmax = chord_m * _X_MAX_C
    ymin = chord_m * _Y_MIN_C
    ymax = chord_m * _Y_MAX_C
    zmin = -chord_m * _Z_DEPTH_C / 2.0
    zmax =  chord_m * _Z_DEPTH_C / 2.0

    for sub in ("0", "constant/triSurface", "system"):
        os.makedirs(os.path.join(case_dir, sub), exist_ok=True)

    # STL
    _write(case_dir, "constant/triSurface/airfoil.stl", stl_str)

    # blockMeshDict
    _write(case_dir, "system/blockMeshDict", f"""\
FoamFile {{ version 2.0; format ascii; class dictionary; object blockMeshDict; }}
scale 1;
vertices
(
  ({xmin:.6f} {ymin:.6f} {zmin:.6f})
  ({xmax:.6f} {ymin:.6f} {zmin:.6f})
  ({xmax:.6f} {ymax:.6f} {zmin:.6f})
  ({xmin:.6f} {ymax:.6f} {zmin:.6f})
  ({xmin:.6f} {ymin:.6f} {zmax:.6f})
  ({xmax:.6f} {ymin:.6f} {zmax:.6f})
  ({xmax:.6f} {ymax:.6f} {zmax:.6f})
  ({xmin:.6f} {ymax:.6f} {zmax:.6f})
);
blocks ( hex (0 1 2 3 4 5 6 7) (40 20 1) simpleGrading (1 1 1) );
edges ();
boundary
(
  inlet  {{ type patch;         faces ((0 4 7 3)); }}
  outlet {{ type patch;         faces ((1 2 6 5)); }}
  top    {{ type symmetryPlane; faces ((3 7 6 2)); }}
  bottom {{ type symmetryPlane; faces ((0 1 5 4)); }}
  frontAndBack {{ type patch;   faces ((0 3 2 1)(4 5 6 7)); }}
);
mergePatchPairs ();
""")

    lvl = res["level"]
    _write(case_dir, "system/snappyHexMeshDict", f"""\
FoamFile {{ version 2.0; format ascii; class dictionary; object snappyHexMeshDict; }}
castellatedMesh true;
snap            true;
addLayers       true;
geometry
{{
  airfoil
  {{
    type triSurfaceMesh;
    file "airfoil.stl";
  }}
}}
castellatedMeshControls
{{
  maxLocalCells  2000000;
  maxGlobalCells 5000000;
  minRefinementCells 10;
  nCellsBetweenLevels 3;
  resolveFeatureAngle 30;
  features ();
  refinementSurfaces
  {{
    airfoil {{ level ({lvl} {lvl}); patchInfo {{ type wall; }} }}
  }}
  refinementRegions
  {{
    airfoil {{ mode inside; levels ((1e15 {lvl})); }}
  }}
  locationInMesh ({chord_m * (-2.0):.6f} 0.0 0.0);
  allowFreeStandingZoneFaces false;
}}
snapControls
{{
  nSmoothPatch 3;
  tolerance 2.0;
  nSolveIter 30;
  nRelaxIter 5;
  nFeatureSnapIter 10;
  implicitFeatureSnap false;
  explicitFeatureSnap false;
  multiRegionFeatureSnap false;
}}
addLayersControls
{{
  relativeSizes true;
  layers {{ airfoil {{ nSurfaceLayers 3; }} }}
  expansionRatio 1.3;
  finalLayerThickness 0.3;
  minThickness 0.1;
  nGrow 0;
  featureAngle 60;
  nRelaxIter 3;
  nSmoothSurfaceNormals 1;
  nSmoothNormals 3;
  nSmoothThickness 10;
  maxFaceThicknessRatio 0.5;
  maxThicknessToMedialRatio 0.3;
  minMedialAxisAngle 90;
  nBufferCellsNoExtrude 0;
  nLayerIter 50;
}}
meshQualityControls
{{
  maxNonOrtho 65;
  maxBoundarySkewness 20;
  maxInternalSkewness 4;
  maxConcave 80;
  minVol 1e-13;
  minTetQuality -1e30;
  minArea -1;
  minTwist 0.02;
  minDeterminant 0.001;
  minFaceWeight 0.05;
  minVolRatio 0.01;
  minTriangleTwist -1;
  nSmoothScale 4;
  errorReduction 0.75;
  relaxed {{ maxNonOrtho 75; }}
}}
debug 0;
mergeTolerance 1e-6;
""")

    _write(case_dir, "system/controlDict", f"""\
FoamFile {{ version 2.0; format ascii; class dictionary; object controlDict; }}
application     foamRun;
solver          incompressibleFluid;
startFrom       startTime;
startTime       0;
stopAt          endTime;
endTime         500;
deltaT          1;
writeControl    timeStep;
writeInterval   50;
purgeWrite      3;
writeFormat     ascii;
writePrecision  6;
runTimeModifiable true;
functions
{{
  forces
  {{
    type            forces;
    libs            ("libforces.so");
    patches         (airfoil);
    rho             rhoInf;
    rhoInf          {rho:.4f};
    pRef            0;
    CofR            (0 0 0);
    writeControl    timeStep;
    writeInterval   50;
  }}
}}
""")

    _write(case_dir, "system/fvSchemes", """\
FoamFile { version 2.0; format ascii; class dictionary; object fvSchemes; }
ddtSchemes      { default steadyState; }
gradSchemes     { default Gauss linear; grad(U) Gauss linear; }
divSchemes
{
  default         none;
  div(phi,U)      Gauss linearUpwind grad(U);
  div(phi,k)      Gauss upwind;
  div(phi,omega)  Gauss upwind;
  div((nuEff*dev(T(grad(U))))) Gauss linear;
}
laplacianSchemes { default Gauss linear corrected; }
interpolationSchemes { default linear; }
snGradSchemes   { default corrected; }
wallDist        { method meshWave; }
""")

    _write(case_dir, "system/fvSolution", """\
FoamFile { version 2.0; format ascii; class dictionary; object fvSolution; }
solvers
{
  p
  {
    solver          PCG;
    preconditioner  DIC;
    tolerance       1e-6;
    relTol          0.05;
  }
  U
  {
    solver          PBiCGStab;
    preconditioner  DILU;
    tolerance       1e-7;
    relTol          0.1;
  }
  "(k|omega|nut)"
  {
    solver          PBiCGStab;
    preconditioner  DILU;
    tolerance       1e-7;
    relTol          0.1;
  }
}
PIMPLE
{
  nOuterCorrectors 1;
  nCorrectors      2;
  nNonOrthogonalCorrectors 1;
  residualControl
  {
    U               1e-4;
    p               1e-4;
    "(k|omega)"     1e-4;
  }
}
relaxationFactors
{
  fields      { p 0.3; }
  equations   { U 0.7; k 0.7; omega 0.7; }
}
""")

    _write(case_dir, "constant/transportProperties",
           f'FoamFile {{ version 2.0; format ascii; class dictionary; object transportProperties; }}\n'
           f'transportModel  Newtonian;\n'
           f'nu              [0 2 -1 0 0 0 0] {nu:.8e};\n')

    _write(case_dir, "constant/turbulenceProperties", """\
FoamFile { version 2.0; format ascii; class dictionary; object turbulenceProperties; }
simulationType  RAS;
RAS { RASModel kOmegaSST; turbulence on; printCoeffs on; }
""")

    # Turbulence initial values
    I = 0.01
    L = 0.07 * chord_m * abs(_Y_MAX_C - _Y_MIN_C) / 2
    k_val = 1.5 * (v_ms * I) ** 2
    omega_val = math.sqrt(k_val) / (0.09 ** 0.25 * L)

    _write(case_dir, "0/U", f"""\
FoamFile {{ version 2.0; format ascii; class volVectorField; object U; }}
dimensions      [0 1 -1 0 0 0 0];
internalField   uniform ({v_ms:.6f} 0 0);
boundaryField
{{
  inlet        {{ type fixedValue; value uniform ({v_ms:.6f} 0 0); }}
  outlet       {{ type zeroGradient; }}
  top          {{ type symmetryPlane; }}
  bottom       {{ type symmetryPlane; }}
  airfoil      {{ type noSlip; }}
  frontAndBack {{ type empty; }}
}}
""")

    _write(case_dir, "0/p", """\
FoamFile { version 2.0; format ascii; class volScalarField; object p; }
dimensions      [0 2 -2 0 0 0 0];
internalField   uniform 0;
boundaryField
{
  inlet        { type zeroGradient; }
  outlet       { type fixedValue; value uniform 0; }
  top          { type symmetryPlane; }
  bottom       { type symmetryPlane; }
  airfoil      { type zeroGradient; }
  frontAndBack { type empty; }
}
""")

    _write(case_dir, "0/k", f"""\
FoamFile {{ version 2.0; format ascii; class volScalarField; object k; }}
dimensions      [0 2 -2 0 0 0 0];
internalField   uniform {k_val:.6e};
boundaryField
{{
  inlet        {{ type turbulentIntensityKineticEnergyInlet; intensity {I}; value uniform {k_val:.6e}; }}
  outlet       {{ type zeroGradient; }}
  top          {{ type symmetryPlane; }}
  bottom       {{ type symmetryPlane; }}
  airfoil      {{ type kqRWallFunction; value uniform {k_val:.6e}; }}
  frontAndBack {{ type empty; }}
}}
""")

    _write(case_dir, "0/omega", f"""\
FoamFile {{ version 2.0; format ascii; class volScalarField; object omega; }}
dimensions      [0 0 -1 0 0 0 0];
internalField   uniform {omega_val:.6e};
boundaryField
{{
  inlet        {{ type turbulentMixingLengthFrequencyInlet; mixingLength {L:.6e}; value uniform {omega_val:.6e}; }}
  outlet       {{ type zeroGradient; }}
  top          {{ type symmetryPlane; }}
  bottom       {{ type symmetryPlane; }}
  airfoil      {{ type omegaWallFunction; value uniform {omega_val:.6e}; }}
  frontAndBack {{ type empty; }}
}}
""")

    _write(case_dir, "0/nut", """\
FoamFile { version 2.0; format ascii; class volScalarField; object nut; }
dimensions      [0 2 -1 0 0 0 0];
internalField   uniform 0;
boundaryField
{
  inlet        { type calculated; value uniform 0; }
  outlet       { type calculated; value uniform 0; }
  top          { type symmetryPlane; }
  bottom       { type symmetryPlane; }
  airfoil      { type nutkWallFunction; value uniform 0; }
  frontAndBack { type empty; }
}
""")


# ---------------------------------------------------------------------------
# Docker execution
# ---------------------------------------------------------------------------

def _docker_run(case_dir: str, cmd: str, timeout_s: int):
    """Run a shell command inside the OpenFOAM Docker container, mounted at /case."""
    posix_path = _windows_to_docker_path(case_dir)
    full_cmd = f"source /opt/openfoam12/etc/bashrc && cd /case && {cmd}"
    result = subprocess.run(
        ["docker", "run", "--rm",
         "-v", f"{posix_path}:/case",
         DOCKER_IMAGE,
         "bash", "-c", full_cmd],
        capture_output=True, text=True, timeout=timeout_s
    )
    return result.returncode, result.stdout, result.stderr


def _windows_to_docker_path(path: str) -> str:
    """Convert Windows path to Docker-for-Desktop mount format (/c/Users/...)."""
    p = Path(path)
    drive = p.drive.lower().rstrip(":")   # e.g. "c"
    rest  = str(p.relative_to(p.anchor)).replace("\\", "/")
    return f"/{drive}/{rest}"


# ---------------------------------------------------------------------------
# Field parsing
# ---------------------------------------------------------------------------

def parse_foam_field(field_path: str) -> np.ndarray:
    """Parse an OpenFOAM ASCII internalField → numpy array."""
    with open(field_path, "r", errors="replace") as fh:
        text = fh.read()

    # Uniform scalar: internalField   uniform 0;
    mu = re.search(r'internalField\s+uniform\s+([\d.eE+\-]+)\s*;', text)
    if mu:
        return np.array([float(mu.group(1))])

    # Uniform vector: internalField   uniform (vx vy vz);
    muv = re.search(
        r'internalField\s+uniform\s*\(\s*([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s*\)',
        text,
    )
    if muv:
        return np.array([[float(muv.group(1)), float(muv.group(2)), float(muv.group(3))]])

    # Nonuniform list — detect type, then use paren counting to extract body.
    # The lazy-regex approach fails on vector fields because it stops at the
    # first ')' inside a vector entry.  Count brackets instead.
    m_hdr = re.search(r'internalField\s+nonuniform\s+List<(scalar|vector)>', text)
    if not m_hdr:
        raise ValueError(f"Cannot parse internalField in {field_path}")

    field_type = m_hdr.group(1)
    open_idx = text.find("(", m_hdr.end())
    if open_idx == -1:
        raise ValueError(f"No data block found in {field_path}")

    depth, close_idx = 0, None
    for i in range(open_idx, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                close_idx = i
                break

    if close_idx is None:
        raise ValueError(f"Unmatched parentheses in {field_path}")

    body = text[open_idx + 1 : close_idx]

    if field_type == "scalar":
        return np.array([float(v) for v in body.split()])
    else:
        entries = re.findall(
            r'\(\s*([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s*\)', body
        )
        return np.array([[float(a), float(b), float(c)] for a, b, c in entries])


def _find_latest_time_dir(case_dir: str) -> str | None:
    """Return the path to the highest-numbered time directory (excluding 0)."""
    time_dirs = []
    for name in os.listdir(case_dir):
        try:
            t = float(name)
            if t > 0:
                time_dirs.append((t, os.path.join(case_dir, name)))
        except ValueError:
            pass
    if not time_dirs:
        return None
    return max(time_dirs, key=lambda x: x[0])[1]


# ---------------------------------------------------------------------------
# Post-processing
# ---------------------------------------------------------------------------

def extract_field_data(case_dir: str, nx: int, ny: int, chord_m: float,
                       v_ms: float, rho: float, aoa_deg: float,
                       coords_norm, foil_key: str, resolution: int) -> dict:
    from scipy.interpolate import griddata

    time_dir = _find_latest_time_dir(case_dir)
    if time_dir is None:
        raise RuntimeError("No solver output found — simpleFoam may have diverged before writing.")

    # Read cell centres
    c_path = os.path.join(time_dir, "C")
    if not os.path.exists(c_path):
        raise RuntimeError("Cell centres (C) not found — postProcess step may have failed.")
    C = parse_foam_field(c_path)   # shape (N, 3)
    cell_x = C[:, 0]
    cell_y = C[:, 1]

    # Filter to z ≈ 0 plane (pseudo-2D: keep all cells, they're all at z~0)
    # For a 1-cell-thick mesh all cells share the midplane z, so no filtering needed.

    # Read pressure and velocity
    p_path = os.path.join(time_dir, "p")
    U_path = os.path.join(time_dir, "U")
    p_arr = parse_foam_field(p_path)       # kinematic pressure (m²/s²)
    U_arr = parse_foam_field(U_path)       # shape (N, 3)

    if p_arr.shape[0] != cell_x.shape[0]:
        # Mismatch — try flattening
        p_arr = p_arr[:cell_x.shape[0]]
    if U_arr.shape[0] != cell_x.shape[0]:
        U_arr = U_arr[:cell_x.shape[0]]

    ux = U_arr[:, 0]
    uy = U_arr[:, 1]
    umag = np.sqrt(ux**2 + uy**2)

    # Cp = (p_physical - p_ref) / q = (p_kine * rho) / q
    q = 0.5 * rho * v_ms**2
    cp_arr = (p_arr * rho) / q

    # Build output grid (tight view window around the foil)
    out_xmin = chord_m * -0.5
    out_xmax = chord_m *  1.5
    out_ymin = chord_m * -0.6
    out_ymax = chord_m *  0.6

    xi = np.linspace(out_xmin, out_xmax, nx)
    yi = np.linspace(out_ymin, out_ymax, ny)
    Xi, Yi = np.meshgrid(xi, yi)
    pts = np.column_stack([cell_x, cell_y])

    def _interp(field):
        gi = griddata(pts, field, (Xi, Yi), method="linear")
        # Fill NaN edges with nearest
        nan_mask = np.isnan(gi)
        if nan_mask.any():
            gi_near = griddata(pts, field, (Xi, Yi), method="nearest")
            gi[nan_mask] = gi_near[nan_mask]
        return gi.tolist()

    pressure_grid   = _interp(cp_arr)
    velocity_x_grid = _interp(ux)
    velocity_y_grid = _interp(uy)
    velocity_mag_grid = _interp(umag)

    # Foil surface Cp
    surface_data = _extract_surface_cp(case_dir, time_dir, chord_m, aoa_deg, coords_norm, rho, v_ms)

    # Forces
    forces = _parse_forces(case_dir, chord_m, rho, v_ms)

    # Convergence
    convergence = _parse_convergence(case_dir)

    return {
        "foil":      foil_key,
        "chord_mm":  chord_m * 1000.0,
        "aoa_deg":   aoa_deg,
        "grid": {
            "nx":    nx,
            "ny":    ny,
            "x_min": out_xmin / chord_m,   # normalised by chord for JS
            "x_max": out_xmax / chord_m,
            "y_min": out_ymin / chord_m,
            "y_max": out_ymax / chord_m,
        },
        "pressure":     pressure_grid,
        "velocity_x":   velocity_x_grid,
        "velocity_y":   velocity_y_grid,
        "velocity_mag": velocity_mag_grid,
        "v_ms":         v_ms,
        "foil_surface": surface_data,
        "forces":       forces,
        "convergence":  convergence,
        "resolution_level": resolution,
    }


def _extract_surface_cp(case_dir, time_dir, chord_m, aoa_deg, coords_norm, rho, v_ms):
    """Sample Cp along the foil surface from the cell data."""
    from scipy.interpolate import griddata

    p_path = os.path.join(time_dir, "p")
    c_path = os.path.join(time_dir, "C")
    if not os.path.exists(p_path) or not os.path.exists(c_path):
        return {"x": [], "y": [], "cp": []}

    C = parse_foam_field(c_path)
    p_arr = parse_foam_field(p_path)
    q = 0.5 * rho * v_ms**2
    cp_arr = (p_arr * rho) / q

    # Rotate foil coords by AoA
    ang = math.radians(-aoa_deg)
    cos_a, sin_a = math.cos(ang), math.sin(ang)
    surf_x, surf_y = [], []
    for xy in coords_norm:
        x = (float(xy[0]) - 0.25) * chord_m
        y = float(xy[1]) * chord_m
        surf_x.append(x * cos_a - y * sin_a)
        surf_y.append(x * sin_a + y * cos_a)

    pts = np.column_stack([C[:, 0], C[:, 1]])
    query = np.column_stack([surf_x, surf_y])
    cp_surface = griddata(pts, cp_arr, query, method="nearest")

    return {
        "x":  [float(v) / chord_m for v in surf_x],
        "y":  [float(v) / chord_m for v in surf_y],
        "cp": [float(v) for v in cp_surface],
    }


def _parse_forces(case_dir, chord_m, rho, v_ms):
    """Read the last line of the forces log and compute CL, CD."""
    forces_dir = os.path.join(case_dir, "postProcessing", "forces")
    if not os.path.exists(forces_dir):
        return {"cl": None, "cd": None, "ld": None}

    # Find the latest time sub-dir
    subdirs = sorted(os.listdir(forces_dir))
    if not subdirs:
        return {"cl": None, "cd": None, "ld": None}

    force_file = os.path.join(forces_dir, subdirs[-1], "force.dat")
    if not os.path.exists(force_file):
        return {"cl": None, "cd": None, "ld": None}

    last_line = None
    with open(force_file) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#"):
                last_line = line

    if last_line is None:
        return {"cl": None, "cd": None, "ld": None}

    # Format: time (fpx fpy fpz) (fvx fvy fvz) ...
    nums = re.findall(r'[-+]?\d*\.?\d+[eE]?[+-]?\d*', last_line)
    if len(nums) < 7:
        return {"cl": None, "cd": None, "ld": None}

    try:
        fpx = float(nums[1])   # pressure force x (drag direction)
        fpy = float(nums[2])   # pressure force y (lift direction)
        fvx = float(nums[4])   # viscous x
        fvy = float(nums[5])   # viscous y
        fx = fpx + fvx
        fy = fpy + fvy
        q  = 0.5 * rho * v_ms**2 * chord_m * (chord_m * _Z_DEPTH_C)
        cd = fx / q if q else None
        cl = fy / q if q else None
        ld = (cl / cd) if (cd and cd != 0) else None
        return {"cl": round(float(cl), 4) if cl is not None else None,
                "cd": round(float(cd), 4) if cd is not None else None,
                "ld": round(float(ld), 2) if ld is not None else None}
    except Exception:
        return {"cl": None, "cd": None, "ld": None}


def _parse_convergence(case_dir):
    log_path = os.path.join(case_dir, "log.simpleFoam")
    if not os.path.exists(log_path):
        return {"iterations": 0, "final_residual": None, "diverged": True}

    iterations = 0
    last_residual = None
    diverged = False

    with open(log_path) as fh:
        for line in fh:
            m = re.match(r'\s*Time\s*=\s*(\d+)', line)
            if m:
                iterations = int(m.group(1))
            if "Initial residual" in line or "Final residual" in line:
                mr = re.search(r'Final residual\s*=\s*([\d.eE+\-]+)', line)
                if mr:
                    last_residual = float(mr.group(1))
            if "DIVERGED" in line or "nan" in line.lower():
                diverged = True

    return {
        "iterations":      iterations,
        "final_residual":  last_residual,
        "diverged":        diverged,
    }


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _fix_frontAndBack_to_empty(case_dir: str):
    """
    snappyHexMesh needs a fully-3D mesh, so blockMesh uses type patch for
    frontAndBack.  After snappy finishes, rewrite the polyMesh/boundary file
    to change it back to empty so simpleFoam runs as a true 2D case.
    """
    boundary_path = os.path.join(case_dir, "constant", "polyMesh", "boundary")
    if not os.path.exists(boundary_path):
        return
    with open(boundary_path, "r") as fh:
        lines = fh.readlines()

    in_block = False
    brace_depth = 0
    new_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped == "frontAndBack":
            in_block = True
        if in_block:
            brace_depth += stripped.count("{") - stripped.count("}")
            if in_block and re.match(r'\s*type\s+\w+\s*;', line):
                line = re.sub(r'(type\s+)\w+', r'\1empty', line)
            if brace_depth <= 0 and stripped.endswith("}"):
                in_block = False
        new_lines.append(line)

    with open(boundary_path, "w", newline="\n") as fh:
        fh.writelines(new_lines)


def _write(case_dir, rel_path, content):
    full = os.path.join(case_dir, rel_path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", newline="\n") as fh:
        fh.write(content)


def _tail(case_dir, log_name, n=30):
    path = os.path.join(case_dir, log_name)
    if not os.path.exists(path):
        return "(log not found)"
    with open(path) as fh:
        lines = fh.readlines()
    return "".join(lines[-n:])


def _cleanup_mesh(case_dir):
    """Remove large mesh directories but keep logs and field data."""
    for sub in ("constant/polyMesh", "constant/extendedFeatureEdgeMesh"):
        path = os.path.join(case_dir, sub)
        if os.path.isdir(path):
            shutil.rmtree(path, ignore_errors=True)
