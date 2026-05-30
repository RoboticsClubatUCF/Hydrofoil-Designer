import numpy as np

MU_WATER = 0.001  # Pa·s, fresh water dynamic viscosity

_ALPHA_MIN  = -5.0
_ALPHA_MAX  = 20.0
_ALPHA_STEP = 0.5


def compute_polar(coords, chord_m, v_ms, rho, mu=MU_WATER, model_size="large"):
    """Run a NeuralFoil alpha sweep. Returns polar dict or None on failure/unavailability."""
    try:
        import neuralfoil as nf
    except ImportError:
        return None

    re = rho * v_ms * chord_m / mu
    if re < 10_000:
        return None

    alphas = np.arange(_ALPHA_MIN, _ALPHA_MAX + _ALPHA_STEP / 2, _ALPHA_STEP)
    coords_np = np.array(coords, dtype=float)

    try:
        result = nf.get_aero_from_coordinates(
            coordinates=coords_np,
            alpha=alphas,
            Re=re,
            model_size=model_size,
        )
    except Exception:
        return None

    cls = result["CL"].tolist()
    cds = result["CD"].tolist()
    alphas_list = alphas.tolist()

    zero_lift_alpha = _interp_zero(alphas_list, cls)
    max_i = int(np.argmax(cls))
    alpha_stall = alphas_list[max_i]
    cl_max = cls[max_i]
    stall_in_range = max_i < len(alphas_list) - 1
    a0 = _fit_lift_slope(alphas_list, cls, cl_max)

    return {
        "alphas":          alphas_list,
        "cls":             cls,
        "cds":             cds,
        "reynolds":        round(re, 0),
        "zero_lift_alpha": zero_lift_alpha,
        "a0_per_deg":      a0,
        "cl_max":          round(cl_max, 4),
        "alpha_stall":     round(alpha_stall, 1),
        "stall_in_range":  stall_in_range,
    }


def extract_polar_params(polar):
    """Adapter: returns the subset design_foil() needs, or None if polar is None."""
    if polar is None:
        return None
    return {
        "zero_lift_alpha_deg": polar["zero_lift_alpha"],
        "a0_per_deg":          polar["a0_per_deg"],
        "alphas":              polar["alphas"],
        "cls":                 polar["cls"],
        "cds":                 polar["cds"],
        "alpha_stall":         polar["alpha_stall"],
        "cl_max":              polar["cl_max"],
        "stall_in_range":      polar["stall_in_range"],
        "reynolds":            polar["reynolds"],
    }


def _interp_zero(alphas, cls):
    """Linear interpolation to find alpha where CL = 0."""
    for i in range(len(cls) - 1):
        if cls[i] <= 0 <= cls[i + 1] or cls[i] >= 0 >= cls[i + 1]:
            da = alphas[i + 1] - alphas[i]
            dc = cls[i + 1] - cls[i]
            return round(alphas[i] - cls[i] * da / dc, 2)
    # Fallback: use negative of first-half CL max (handles very cambered profiles)
    return round(-max(cls[:len(cls) // 2]), 1)


def _fit_lift_slope(alphas, cls, cl_max):
    """Least-squares lift slope in the linear regime (10%–90% of CL_max)."""
    low, high = 0.1 * cl_max, 0.9 * cl_max
    pts = [(a, c) for a, c in zip(alphas, cls) if low <= c <= high]
    if len(pts) < 3:
        return round(2 * np.pi * (np.pi / 180), 5)  # thin-airfoil fallback
    a_arr = np.array([p[0] for p in pts])
    c_arr = np.array([p[1] for p in pts])
    slope = float(np.polyfit(a_arr, c_arr, 1)[0])
    return round(slope, 5)
