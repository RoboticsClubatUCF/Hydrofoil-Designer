import numpy as np
from matplotlib.path import Path

N_PANELS = 100
GRID_X_MIN, GRID_X_MAX = -0.5, 1.5
GRID_Y_MIN, GRID_Y_MAX = -0.75, 0.75


def _resample_profile(coords, n=N_PANELS):
    pts = np.array(coords, dtype=float)
    if np.linalg.norm(pts[-1] - pts[0]) > 1e-6:
        pts = np.vstack([pts, pts[0]])
    # Ensure CCW winding via shoelace signed area
    signed_area = 0.5 * np.sum(pts[:-1, 0] * pts[1:, 1] - pts[1:, 0] * pts[:-1, 1])
    if signed_area < 0:
        pts = pts[::-1]
    diffs = np.diff(pts, axis=0)
    seg_lengths = np.hypot(diffs[:, 0], diffs[:, 1])
    s = np.concatenate([[0.0], np.cumsum(seg_lengths)])
    s_uniform = np.linspace(0.0, s[-1], n + 1)
    x_new = np.interp(s_uniform, s, pts[:, 0])
    y_new = np.interp(s_uniform, s, pts[:, 1])
    return np.column_stack([x_new, y_new])


def _build_panels(nodes):
    x1, y1 = nodes[:-1, 0], nodes[:-1, 1]
    x2, y2 = nodes[1:,  0], nodes[1:,  1]
    xm = 0.5 * (x1 + x2)
    ym = 0.5 * (y1 + y2)
    dx = x2 - x1
    dy = y2 - y1
    lengths = np.hypot(dx, dy)
    tx = dx / lengths
    ty = dy / lengths
    # Outward normal for CCW winding: rotate tangent 90° CCW → (-ty, tx)
    nx = -ty
    ny =  tx
    return xm, ym, nx, ny, tx, ty, lengths


def _vortex_influence(nodes, xm, ym):
    """
    Returns (u_mat, v_mat) each shape (N_ctrl, N_panels).
    u_mat[i,j] = x-velocity at control point i induced by unit gamma on panel j.
    Uses Hess-Smith constant-vortex formula.
    """
    x1j = nodes[:-1, 0]
    y1j = nodes[:-1, 1]
    x2j = nodes[1:,  0]
    y2j = nodes[1:,  1]
    beta_j = np.arctan2(y2j - y1j, x2j - x1j)   # (N,)

    # Broadcast: (N_ctrl, 1) vs (1, N_panels)
    px = xm[:, np.newaxis]
    py = ym[:, np.newaxis]
    X1 = x1j[np.newaxis, :]
    Y1 = y1j[np.newaxis, :]
    X2 = x2j[np.newaxis, :]
    Y2 = y2j[np.newaxis, :]
    B  = beta_j[np.newaxis, :]

    dx1 = px - X1
    dy1 = py - Y1
    dx2 = px - X2
    dy2 = py - Y2

    r1 = np.sqrt(np.maximum(dx1**2 + dy1**2, 1e-14))
    r2 = np.sqrt(np.maximum(dx2**2 + dy2**2, 1e-14))
    theta1 = np.arctan2(dy1, dx1)
    theta2 = np.arctan2(dy2, dx2)
    dtheta = theta2 - theta1
    dtheta = (dtheta + np.pi) % (2.0 * np.pi) - np.pi
    ln_r = np.log(r2 / r1)

    coeff = 1.0 / (2.0 * np.pi)
    u_mat = coeff * ( ln_r * np.sin(B) - dtheta * np.cos(B))
    v_mat = coeff * (-ln_r * np.cos(B) - dtheta * np.sin(B))
    return u_mat, v_mat


def _solve_vortex_panels(nodes, xm, ym, nx_ctrl, ny_ctrl, aoa_rad):
    N = len(xm)
    u_mat, v_mat = _vortex_influence(nodes, xm, ym)

    # Normal influence matrix A[i,j] = u_ij * nx_i + v_ij * ny_i
    A = u_mat * nx_ctrl[:, np.newaxis] + v_mat * ny_ctrl[:, np.newaxis]
    # Self-influence diagonal: standard limit for constant-vortex panel = 0.5
    np.fill_diagonal(A, 0.5)

    # RHS: normal component of freestream (negated for no-penetration)
    rhs = -(np.cos(aoa_rad) * nx_ctrl + np.sin(aoa_rad) * ny_ctrl)

    # Kutta condition: gamma[kutta_i] + gamma[kutta_j] = 0
    # Use the two panel midpoints closest to the trailing edge (1, 0)
    te_dist = (xm - 1.0)**2 + ym**2
    te_sorted = np.argsort(te_dist)
    ki, kj = te_sorted[0], te_sorted[1]
    A[-1, :] = 0.0
    A[-1, ki] = 1.0
    A[-1, kj] = 1.0
    rhs[-1] = 0.0

    gamma = np.linalg.solve(A, rhs)
    return gamma


def _compute_cp(nodes, xm, ym, tx_ctrl, ty_ctrl, gamma, aoa_rad):
    u_mat, v_mat = _vortex_influence(nodes, xm, ym)

    # Tangential influence matrix
    C = u_mat * tx_ctrl[:, np.newaxis] + v_mat * ty_ctrl[:, np.newaxis]
    np.fill_diagonal(C, 0.0)

    vt_inf = np.cos(aoa_rad) * tx_ctrl + np.sin(aoa_rad) * ty_ctrl
    vt = C @ gamma + vt_inf
    cp = 1.0 - vt**2
    return vt, cp


def _compute_velocity_field(nodes, gamma, aoa_rad, grid_nx, grid_ny):
    x1j = nodes[:-1, 0]
    y1j = nodes[:-1, 1]
    x2j = nodes[1:,  0]
    y2j = nodes[1:,  1]
    beta_j = np.arctan2(y2j - y1j, x2j - x1j)

    gx = np.linspace(GRID_X_MIN, GRID_X_MAX, grid_nx)
    gy = np.linspace(GRID_Y_MIN, GRID_Y_MAX, grid_ny)
    GX, GY = np.meshgrid(gx, gy)    # (ny, nx)

    # Flatten grid for vectorized panel summation
    px = GX.ravel()[:, np.newaxis]  # (ny*nx, 1)
    py = GY.ravel()[:, np.newaxis]

    X1 = x1j[np.newaxis, :]
    Y1 = y1j[np.newaxis, :]
    X2 = x2j[np.newaxis, :]
    Y2 = y2j[np.newaxis, :]
    B  = beta_j[np.newaxis, :]

    dx1 = px - X1
    dy1 = py - Y1
    dx2 = px - X2
    dy2 = py - Y2

    r1 = np.sqrt(np.maximum(dx1**2 + dy1**2, 1e-14))
    r2 = np.sqrt(np.maximum(dx2**2 + dy2**2, 1e-14))
    theta1 = np.arctan2(dy1, dx1)
    theta2 = np.arctan2(dy2, dx2)
    dtheta = (theta2 - theta1 + np.pi) % (2.0 * np.pi) - np.pi
    ln_r = np.log(r2 / r1)

    coeff = 1.0 / (2.0 * np.pi)
    u_mat = coeff * ( ln_r * np.sin(B) - dtheta * np.cos(B))  # (ny*nx, N)
    v_mat = coeff * (-ln_r * np.cos(B) - dtheta * np.sin(B))

    u_grid = (u_mat @ gamma + np.cos(aoa_rad)).reshape(grid_ny, grid_nx)
    v_grid = (v_mat @ gamma + np.sin(aoa_rad)).reshape(grid_ny, grid_nx)

    return gx, gy, u_grid, v_grid


def _inside_mask(nodes, gx, gy):
    poly = Path(nodes[:-1])
    GX, GY = np.meshgrid(gx, gy)
    pts = np.column_stack([GX.ravel(), GY.ravel()])
    mask = poly.contains_points(pts).reshape(len(gy), len(gx))
    return mask


def run_panel_method(coords, aoa_deg_design, grid_nx=80, grid_ny=60):
    aoa_rad = np.deg2rad(aoa_deg_design)

    nodes = _resample_profile(coords)
    xm, ym, nx_ctrl, ny_ctrl, tx_ctrl, ty_ctrl, lengths = _build_panels(nodes)

    gamma = _solve_vortex_panels(nodes, xm, ym, nx_ctrl, ny_ctrl, aoa_rad)
    vt, cp = _compute_cp(nodes, xm, ym, tx_ctrl, ty_ctrl, gamma, aoa_rad)

    gx, gy, u_grid, v_grid = _compute_velocity_field(nodes, gamma, aoa_rad, grid_nx, grid_ny)

    mask = _inside_mask(nodes, gx, gy)
    u_grid[mask] = 0.0
    v_grid[mask] = 0.0

    return {
        "panel_x":    xm.tolist(),
        "panel_y":    ym.tolist(),
        "cp":         cp.tolist(),
        "cp_min":     float(np.min(cp)),
        "cp_max":     float(np.max(cp)),
        "grid_x":     gx.tolist(),
        "grid_y":     gy.tolist(),
        "grid_u":     u_grid.tolist(),
        "grid_v":     v_grid.tolist(),
        "inside_mask": mask.tolist(),
    }


def run_panel_method_safe(coords, aoa_deg_design, grid_nx=80, grid_ny=60):
    try:
        return run_panel_method(coords, aoa_deg_design, grid_nx, grid_ny)
    except Exception:
        return None
