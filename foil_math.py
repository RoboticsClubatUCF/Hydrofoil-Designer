import math


A0_PER_DEG = 2 * math.pi * (math.pi / 180)  # thin-airfoil lift slope in per-degree (~0.10966)


def design_foil(
    load_n: float,
    v_takeoff_ms: float,
    rho: float,
    max_t_mm: float,
    profile_thickness_pct: float,
    profile_camber_pct: float,
    cl_target: float,
    oswald_e: float = 0.9,
) -> dict:
    q = 0.5 * rho * v_takeoff_ms ** 2

    area_m2 = load_n / (q * cl_target)

    # Chord length derived from structural thickness constraint
    chord_m = (max_t_mm / 1000.0) / (profile_thickness_pct / 100.0)
    chord_mm = chord_m * 1000.0

    span_m = area_m2 / chord_m
    span_mm = span_m * 1000.0
    ar = span_m / chord_m  # = span² / area

    # Prandtl lifting-line 3D lift slope (per degree)
    a = A0_PER_DEG / (1.0 + (57.3 * A0_PER_DEG) / (math.pi * oswald_e * ar))

    # Zero-lift angle: thin-airfoil approximation, ≈ -camber% degrees for NACA 4-digit
    zero_lift_angle_deg = -profile_camber_pct

    aoa_deg = cl_target / a + zero_lift_angle_deg

    return {
        "area_m2": round(area_m2, 4),
        "chord_mm": round(chord_mm, 1),
        "span_mm": round(span_mm, 1),
        "ar": round(ar, 2),
        "lift_slope_per_deg": round(a, 5),
        "zero_lift_angle_deg": round(zero_lift_angle_deg, 1),
        "aoa_deg": round(aoa_deg, 1),
        "cl": cl_target,
        "dynamic_pressure_pa": round(q, 2),
    }
