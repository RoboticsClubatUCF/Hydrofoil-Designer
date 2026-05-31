import io
import base64
import subprocess
import threading

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from flask import Flask, jsonify, render_template, request, send_file

from dat_parser import parse_dat
from foil_math import design_foil
from foil_polar import compute_polar, extract_polar_params
from panel_method import run_panel_method_safe

app = Flask(__name__)


# ---------------------------------------------------------------------------
# Shared helpers (used by both /api/calculate and /api/cfd)
# ---------------------------------------------------------------------------

def _mu_from_rho(r):
    if r <= 1003:  return 0.001
    if r <= 1017:  return 0.00106
    return 0.00108


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/calculate", methods=["POST"])
def calculate():
    data = request.get_json(force=True)

    try:
        front_profile = parse_dat(data["front_dat"])
    except Exception as e:
        return jsonify({"error": f"Front foil: {e}"}), 400

    rear_dat = data["front_dat"] if data.get("rear_same_as_front") else data.get("rear_dat", "")
    try:
        rear_profile = parse_dat(rear_dat)
    except Exception as e:
        return jsonify({"error": f"Rear foil: {e}"}), 400

    try:
        weight_n     = float(data["weight_n"])
        v_takeoff_ms = float(data["v_takeoff_ms"])
        rho          = float(data["rho"])
        load_split   = float(data["load_split_pct"]) / 100.0
        oswald_e     = float(data.get("oswald_e", 0.9))
        cl_front     = float(data.get("cl_front", 0.8))
        cl_rear      = float(data.get("cl_rear", 0.63))
    except (KeyError, ValueError) as e:
        return jsonify({"error": f"Invalid input: {e}"}), 400

    def _opt_float(key):
        v = data.get(key)
        if v is None or v == "":
            return None
        try:
            f = float(v)
            return f if f > 0 else None
        except (TypeError, ValueError):
            return None

    front_sizing = data.get("front_sizing_mode", "thickness")
    rear_sizing  = data.get("rear_sizing_mode",  "thickness")

    max_t_front = _opt_float("max_t_front_mm") if front_sizing == "thickness" else None
    chord_front = _opt_float("chord_front_mm") if front_sizing == "chord"     else None
    max_t_rear  = _opt_float("max_t_rear_mm")  if rear_sizing  == "thickness" else None
    chord_rear  = _opt_float("chord_rear_mm")  if rear_sizing  == "chord"     else None

    if front_sizing == "thickness" and max_t_front is None:
        return jsonify({"error": "Front foil: max thickness (mm) is required in thickness mode"}), 400
    if front_sizing == "chord" and chord_front is None:
        return jsonify({"error": "Front foil: chord (mm) is required in direct chord mode"}), 400
    if rear_sizing == "thickness" and max_t_rear is None:
        return jsonify({"error": "Rear foil: max thickness (mm) is required in thickness mode"}), 400
    if rear_sizing == "chord" and chord_rear is None:
        return jsonify({"error": "Rear foil: chord (mm) is required in direct chord mode"}), 400

    front_load = weight_n * load_split
    rear_load  = weight_n * (1.0 - load_split)
    mu = _mu_from_rho(rho)

    def _design_with_polar(load_n, profile, cl_target, max_t_mm, chord_mm_direct, prefix):
        common = dict(
            load_n=load_n,
            v_takeoff_ms=v_takeoff_ms,
            rho=rho,
            profile_thickness_pct=profile["max_thickness_pct"],
            profile_camber_pct=profile["max_camber_pct"],
            cl_target=cl_target,
            oswald_e=oswald_e,
            max_t_mm=max_t_mm,
            chord_mm_direct=chord_mm_direct,
            max_span_mm=_opt_float(f"{prefix}_max_span_mm"),
            min_span_mm=_opt_float(f"{prefix}_min_span_mm"),
            max_chord_mm=_opt_float(f"{prefix}_max_chord_mm"),
            min_chord_mm=_opt_float(f"{prefix}_min_chord_mm"),
            min_ar=_opt_float(f"{prefix}_min_ar"),
            max_ar=_opt_float(f"{prefix}_max_ar"),
        )
        p1 = design_foil(**common)
        chord_m = p1["chord_mm"] / 1000.0
        try:
            polar = compute_polar(profile["coords"], chord_m, v_takeoff_ms, rho, mu)
        except Exception:
            polar = None
        polar_params = extract_polar_params(polar)
        design = design_foil(**common, polar_data=polar_params)
        if polar is not None:
            design["plot_lift_curve"] = _make_lift_curve(polar, design["aoa_deg"], cl_target)
            design["plot_drag_polar"] = _make_drag_polar(polar, cl_target, design["cd"])
        else:
            design["plot_lift_curve"] = None
            design["plot_drag_polar"] = None
        flow = run_panel_method_safe(profile["coords"], design["aoa_deg"])
        if flow is not None:
            design["flow"] = flow
        return design

    try:
        front_design = _design_with_polar(
            front_load, front_profile, cl_front, max_t_front, chord_front, "front"
        )
        rear_design = _design_with_polar(
            rear_load, rear_profile, cl_rear, max_t_rear, chord_rear, "rear"
        )
    except Exception as e:
        return jsonify({"error": f"Calculation error: {e}"}), 500

    return jsonify({
        "front": {
            **_profile_summary(front_profile),
            **front_design,
            "plot": _make_plot(front_profile),
        },
        "rear": {
            **_profile_summary(rear_profile),
            **rear_design,
            "plot": _make_plot(rear_profile),
        },
    })


@app.route("/api/step", methods=["POST"])
def download_step():
    data = request.get_json(force=True)
    foil_label = data.get("foil", "foil")
    coords     = data["coords"]
    chord_mm   = float(data["chord_mm"])
    span_mm    = float(data["span_mm"])
    name       = data.get("name", "foil").replace(" ", "_")

    try:
        from step_generator import generate_step_bytes
        step_bytes = generate_step_bytes(coords, chord_mm, span_mm)
    except ImportError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        return jsonify({"error": f"STEP generation failed: {e}"}), 500

    filename = f"{name}_{foil_label}_foil.step"
    return send_file(
        io.BytesIO(step_bytes),
        mimetype="application/octet-stream",
        as_attachment=True,
        download_name=filename,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _profile_summary(profile: dict) -> dict:
    return {
        "name":                profile["name"],
        "max_thickness_pct":   profile["max_thickness_pct"],
        "max_thickness_x_pct": profile["max_thickness_x_pct"],
        "max_camber_pct":      profile["max_camber_pct"],
        "max_camber_x_pct":    profile["max_camber_x_pct"],
        "coords":              profile["coords"],
    }


def _make_plot(profile: dict) -> str:
    coords = profile["coords"]
    xs = [p[0] for p in coords]
    ys = [p[1] for p in coords]

    fig, ax = plt.subplots(figsize=(7, 2.5))
    ax.plot(xs, ys, color="#1a6bbf", linewidth=2)
    ax.fill(xs, ys, alpha=0.15, color="#1a6bbf")
    ax.set_aspect("equal")
    ax.set_xlabel("x/c", fontsize=9)
    ax.set_ylabel("y/c", fontsize=9)
    ax.set_title(profile["name"], fontsize=10, fontweight="bold")
    ax.grid(True, alpha=0.25, linestyle="--")
    ax.tick_params(labelsize=8)
    fig.tight_layout(pad=0.5)

    buf = io.BytesIO()
    plt.savefig(buf, format="png", dpi=110)
    plt.close(fig)
    buf.seek(0)
    return "data:image/png;base64," + base64.b64encode(buf.read()).decode()


def _make_lift_curve(polar: dict, aoa_deg: float, cl_operating: float) -> str:
    alphas = polar["alphas"]
    cls    = polar["cls"]
    alpha_stall = polar["alpha_stall"]

    fig, ax = plt.subplots(figsize=(5, 3.5))
    ax.plot(alphas, cls, color="#1a6bbf", linewidth=2)
    ax.axhline(0, color="#888", linewidth=0.6, alpha=0.5)
    ax.axvline(alpha_stall, color="#c0392b", linestyle="--", linewidth=1.2,
               alpha=0.85, label=f"Stall  {alpha_stall:.1f}°")
    ax.plot(aoa_deg, cl_operating, "o", color="#e67e22", markersize=8, zorder=5,
            label=f"Op. point  α={aoa_deg:.1f}°, CL={cl_operating:.2f}")
    ax.set_xlabel("Angle of attack (°)", fontsize=9)
    ax.set_ylabel("CL", fontsize=9)
    ax.set_title("Lift Curve", fontsize=10, fontweight="bold")
    ax.legend(fontsize=8, loc="upper left")
    ax.grid(True, alpha=0.25, linestyle="--")
    ax.tick_params(labelsize=8)
    fig.tight_layout(pad=0.5)

    buf = io.BytesIO()
    plt.savefig(buf, format="png", dpi=110)
    plt.close(fig)
    buf.seek(0)
    return "data:image/png;base64," + base64.b64encode(buf.read()).decode()


def _make_drag_polar(polar: dict, cl_operating: float, cd_operating) -> str:
    cls = polar["cls"]
    cds = polar["cds"]

    fig, ax = plt.subplots(figsize=(4.5, 3.5))
    ax.plot(cds, cls, color="#1a6bbf", linewidth=2)
    if cd_operating is not None:
        ax.plot(cd_operating, cl_operating, "o", color="#e67e22", markersize=8, zorder=5,
                label=f"Op. point\nCD={cd_operating:.4f}")
        ax.legend(fontsize=8, loc="upper left")
    ax.set_xlabel("CD (profile drag)", fontsize=9)
    ax.set_ylabel("CL", fontsize=9)
    ax.set_title("Drag Polar", fontsize=10, fontweight="bold")
    ax.grid(True, alpha=0.25, linestyle="--")
    ax.tick_params(labelsize=8)
    fig.tight_layout(pad=0.5)

    buf = io.BytesIO()
    plt.savefig(buf, format="png", dpi=110)
    plt.close(fig)
    buf.seek(0)
    return "data:image/png;base64," + base64.b64encode(buf.read()).decode()


# ---------------------------------------------------------------------------
# CFD (OpenFOAM via Docker)
# ---------------------------------------------------------------------------

@app.route("/api/cfd", methods=["POST"])
def start_cfd():
    data = request.get_json(force=True)

    required = ["coords", "chord_mm", "span_mm", "aoa_deg", "v_ms", "rho", "foil", "resolution"]
    for field in required:
        if field not in data:
            return jsonify({"error": f"Missing field: {field}"}), 400

    try:
        resolution = int(data["resolution"])
        assert 1 <= resolution <= 3
    except (ValueError, AssertionError):
        return jsonify({"error": "resolution must be 1, 2, or 3"}), 400

    # Docker pre-flight
    try:
        dr = subprocess.run(["docker", "info"], capture_output=True, timeout=6)
        if dr.returncode != 0:
            return jsonify({"error": "Docker is not running. Start Docker Desktop and try again."}), 503
    except FileNotFoundError:
        return jsonify({"error": "Docker not found. Install Docker Desktop and ensure it is running."}), 503
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Docker did not respond in time. Ensure Docker Desktop is running."}), 503

    try:
        from foam_runner import submit_job
    except ImportError as e:
        return jsonify({"error": f"foam_runner unavailable: {e}"}), 500

    rho = float(data["rho"])
    params = {
        "coords":     data["coords"],
        "chord_m":    float(data["chord_mm"]) / 1000.0,
        "span_mm":    float(data["span_mm"]),
        "aoa_deg":    float(data["aoa_deg"]),
        "v_ms":       float(data["v_ms"]),
        "rho":        rho,
        "nu":         _mu_from_rho(rho) / rho,
        "foil":       data["foil"],
        "resolution": resolution,
        "n_cores":    int(data.get("n_cores", 6)),
        "timeout_s":  int(data.get("timeout_s", 1200)),
    }

    job_id = submit_job(params)
    return jsonify({"job_id": job_id}), 202


@app.route("/api/cfd/<job_id>", methods=["GET"])
def poll_cfd(job_id):
    try:
        from foam_runner import get_job
    except ImportError as e:
        return jsonify({"error": str(e)}), 500

    job = get_job(job_id)
    if job is None:
        return jsonify({"error": "Job not found"}), 404

    resp = {
        "status":   job["status"],
        "progress": job["progress"],
        "message":  job.get("message", ""),
    }
    if job["status"] == "complete":
        resp["result"] = job["result"]
    elif job["status"] == "error":
        resp["error_detail"] = job.get("error_detail", "Unknown error")
    return jsonify(resp)


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000, threaded=True)
