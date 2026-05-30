import math

A0_PER_DEG = 2 * math.pi * (math.pi / 180)  # thin-airfoil lift slope in per-degree (~0.10966)

_STALL_ERROR_DEG = 18.0
_STALL_WARN_DEG  = 12.0
_MIN_CHORD_MM    = 20.0


def _interp_cd(polar_data, cl_target):
    """Interpolate CD from the polar at the given CL target."""
    cls = polar_data["cls"]
    cds = polar_data["cds"]
    for i in range(len(cls) - 1):
        if cls[i] <= cl_target <= cls[i + 1]:
            t = (cl_target - cls[i]) / (cls[i + 1] - cls[i])
            return round(cds[i] * (1 - t) + cds[i + 1] * t, 6)
    return None


def design_foil(
    load_n: float,
    v_takeoff_ms: float,
    rho: float,
    profile_thickness_pct: float,
    profile_camber_pct: float,
    cl_target: float,
    oswald_e: float = 0.9,
    # Chord sizing — supply exactly one
    max_t_mm: float = None,
    chord_mm_direct: float = None,
    # Optional bound constraints (None = unconstrained)
    max_span_mm: float = None,
    min_span_mm: float = None,
    max_chord_mm: float = None,
    min_chord_mm: float = None,
    min_ar: float = None,
    max_ar: float = None,
    # NeuralFoil polar augmentation (None = use thin-airfoil theory)
    polar_data: dict = None,
) -> dict:
    warnings = []
    errors = []

    q = 0.5 * rho * v_takeoff_ms ** 2
    area_m2 = load_n / (q * cl_target)

    # --- Chord sizing ---
    if max_t_mm is not None:
        chord_m  = (max_t_mm / 1000.0) / (profile_thickness_pct / 100.0)
        chord_mm = chord_m * 1000.0
    elif chord_mm_direct is not None:
        chord_mm = float(chord_mm_direct)
        chord_m  = chord_mm / 1000.0
    else:
        raise ValueError("Provide either max foil thickness (mm) or a direct chord (mm)")

    span_m  = area_m2 / chord_m
    span_mm = span_m * 1000.0
    ar      = span_m / chord_m  # = span² / area

    # Prandtl lifting-line 3D lift slope (per degree)
    a0 = polar_data["a0_per_deg"] if polar_data else A0_PER_DEG
    a  = a0 / (1.0 + (57.3 * a0) / (math.pi * oswald_e * ar))

    zero_lift_angle_deg = polar_data["zero_lift_alpha_deg"] if polar_data else -profile_camber_pct
    aoa_deg = cl_target / a + zero_lift_angle_deg

    # --- Physical sanity checks ---
    if chord_mm < _MIN_CHORD_MM:
        errors.append({
            "msg": f"Chord {chord_mm:.1f} mm is structurally impractical (< {_MIN_CHORD_MM:.0f} mm).",
            "suggestions": [
                "Reduce the max thickness constraint to allow a larger chord",
                "Use a thicker airfoil profile",
                "Shift load to the other foil",
            ],
        })

    if aoa_deg > _STALL_ERROR_DEG:
        errors.append({
            "msg": f"Angle of attack {aoa_deg:.1f}° exceeds stall (~{_STALL_ERROR_DEG:.0f}°). The foil cannot generate required lift at takeoff.",
            "suggestions": [
                "Increase the CL target",
                "Use a more cambered profile",
                "Relax the chord constraint (reduce max thickness or enter a larger direct chord)",
                "Shift more load to the other foil",
                "Increase takeoff speed",
            ],
        })
    elif aoa_deg > _STALL_WARN_DEG:
        warnings.append({
            "msg": f"Angle of attack {aoa_deg:.1f}° is approaching stall (~{_STALL_ERROR_DEG:.0f}°). Speed margin is limited.",
            "suggestions": ["Consider a higher CL target or a more cambered profile"],
        })
    elif aoa_deg < 0.5:
        warnings.append({
            "msg": f"Angle of attack {aoa_deg:.1f}° is very low — little margin above zero-lift speed.",
            "suggestions": ["Consider a lower CL target or a less cambered profile"],
        })

    if ar > 20:
        warnings.append({
            "msg": f"Aspect ratio {ar:.1f} is very high. Structural loads on the foil will be significant.",
            "suggestions": [
                "Increase chord (relax max thickness constraint)",
                "Accept a lower AR by increasing the CL target",
            ],
        })
    elif ar < 3:
        warnings.append({
            "msg": f"Aspect ratio {ar:.1f} is low. Induced drag will be significant at cruise.",
            "suggestions": ["Reduce chord or accept a longer span"],
        })

    # --- User-defined bound constraint violations ---
    if max_span_mm is not None and span_mm > max_span_mm:
        errors.append({
            "msg": f"Span {span_mm:.1f} mm exceeds your max ({max_span_mm:.0f} mm).",
            "suggestions": [
                "Increase takeoff speed to reduce required lift area",
                "Increase the CL target",
                "Increase chord (relax thickness limit or enter a larger direct chord)",
                "Shift more load to the other foil",
            ],
        })

    if min_span_mm is not None and span_mm < min_span_mm:
        errors.append({
            "msg": f"Span {span_mm:.1f} mm is below your min ({min_span_mm:.0f} mm).",
            "suggestions": [
                "Decrease the CL target",
                "Decrease chord (tighten thickness limit)",
                "Shift more load to this foil",
            ],
        })

    if max_chord_mm is not None and chord_mm > max_chord_mm:
        errors.append({
            "msg": f"Chord {chord_mm:.1f} mm exceeds your max ({max_chord_mm:.0f} mm).",
            "suggestions": [
                "Tighten the max thickness constraint",
                "Use a thinner airfoil profile",
                "Enter a smaller direct chord",
            ],
        })

    if min_chord_mm is not None and chord_mm < min_chord_mm:
        errors.append({
            "msg": f"Chord {chord_mm:.1f} mm is below your min ({min_chord_mm:.0f} mm).",
            "suggestions": [
                "Increase the max thickness constraint",
                "Use a thicker airfoil profile",
                "Enter a larger direct chord",
            ],
        })

    if max_ar is not None and ar > max_ar:
        errors.append({
            "msg": f"Aspect ratio {ar:.1f} exceeds your max ({max_ar:.1f}).",
            "suggestions": [
                "Increase chord (relax thickness limit)",
                "Increase CL target or takeoff speed to reduce required span",
            ],
        })

    if min_ar is not None and ar < min_ar:
        errors.append({
            "msg": f"Aspect ratio {ar:.1f} is below your min ({min_ar:.1f}).",
            "suggestions": [
                "Decrease chord (tighten thickness limit)",
                "Accept a larger span",
            ],
        })

    # --- NeuralFoil aerodynamic augmentation ---
    cd = drag_n = ld_ratio = stall_margin_deg = alpha_stall_out = cl_max = reynolds = None
    neuralfoil_used = False
    if polar_data:
        cd = _interp_cd(polar_data, cl_target)
        drag_n = round(cd * q * area_m2, 3) if cd is not None else None
        ld_ratio = round(cl_target / cd, 1) if cd and cd > 0 else None
        alpha_stall_out = polar_data["alpha_stall"]
        stall_margin_deg = round(alpha_stall_out - aoa_deg, 1)
        cl_max = polar_data["cl_max"]
        reynolds = polar_data["reynolds"]
        neuralfoil_used = True
        stall_already = any(aoa_deg > _STALL_ERROR_DEG for _ in [1])
        if not stall_already and stall_margin_deg < 3.0:
            warnings.append({
                "msg": f"Stall margin is only {stall_margin_deg}° (stall at {alpha_stall_out}°).",
                "suggestions": [
                    "Increase the CL target to reduce required AoA",
                    "Use a more cambered profile",
                    "Increase takeoff speed",
                ],
            })

    return {
        "area_m2":             round(area_m2, 4),
        "chord_mm":            round(chord_mm, 1),
        "span_mm":             round(span_mm, 1),
        "ar":                  round(ar, 2),
        "lift_slope_per_deg":  round(a, 5),
        "zero_lift_angle_deg": round(zero_lift_angle_deg, 1),
        "aoa_deg":             round(aoa_deg, 1),
        "cl":                  cl_target,
        "dynamic_pressure_pa": round(q, 2),
        "warnings":            warnings,
        "errors":              errors,
        "feasible":            len(errors) == 0,
        "neuralfoil_used":     neuralfoil_used,
        "cd":                  cd,
        "drag_n":              drag_n,
        "ld_ratio":            ld_ratio,
        "stall_margin_deg":    stall_margin_deg,
        "alpha_stall":         alpha_stall_out,
        "cl_max":              cl_max,
        "reynolds":            reynolds,
    }
