import numpy as np


def parse_dat(text: str) -> dict:
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    if not lines:
        raise ValueError("Empty .dat content")

    name = lines[0]
    coords = []
    for line in lines[1:]:
        parts = line.split()
        if len(parts) >= 2:
            try:
                coords.append((float(parts[0]), float(parts[1])))
            except ValueError:
                continue

    if len(coords) < 6:
        raise ValueError("Not enough coordinate points (need at least 6)")

    upper = sorted([(x, y) for x, y in coords if y >= 0], key=lambda p: p[0])
    lower = sorted([(x, y) for x, y in coords if y < 0], key=lambda p: p[0])

    if not upper or not lower:
        raise ValueError("Could not separate upper and lower surfaces — check Y-coordinate signs")

    xs = np.linspace(0.02, 0.98, 200)

    upper_xs = [p[0] for p in upper]
    upper_ys = [p[1] for p in upper]
    lower_xs = [p[0] for p in lower]
    lower_ys = [p[1] for p in lower]

    upper_y = np.interp(xs, upper_xs, upper_ys)
    lower_y = np.interp(xs, lower_xs, lower_ys)

    thickness = upper_y - lower_y
    camber = (upper_y + lower_y) / 2

    max_t_idx = int(np.argmax(thickness))
    max_c_idx = int(np.argmax(np.abs(camber)))

    return {
        "name": name,
        "coords": coords,
        "upper": upper,
        "lower": lower,
        "max_thickness_pct": round(float(thickness[max_t_idx]) * 100, 2),
        "max_thickness_x_pct": round(float(xs[max_t_idx]) * 100, 1),
        "max_camber_pct": round(float(camber[max_c_idx]) * 100, 2),
        "max_camber_x_pct": round(float(xs[max_c_idx]) * 100, 1),
    }
