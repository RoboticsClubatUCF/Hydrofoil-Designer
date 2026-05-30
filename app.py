import io
import base64

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from flask import Flask, jsonify, render_template, request, send_file

from dat_parser import parse_dat
from foil_math import design_foil

app = Flask(__name__)


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

    try:
        front_design = design_foil(
            load_n=front_load,
            v_takeoff_ms=v_takeoff_ms,
            rho=rho,
            profile_thickness_pct=front_profile["max_thickness_pct"],
            profile_camber_pct=front_profile["max_camber_pct"],
            cl_target=cl_front,
            oswald_e=oswald_e,
            max_t_mm=max_t_front,
            chord_mm_direct=chord_front,
            max_span_mm=_opt_float("front_max_span_mm"),
            min_span_mm=_opt_float("front_min_span_mm"),
            max_chord_mm=_opt_float("front_max_chord_mm"),
            min_chord_mm=_opt_float("front_min_chord_mm"),
            min_ar=_opt_float("front_min_ar"),
            max_ar=_opt_float("front_max_ar"),
        )
        rear_design = design_foil(
            load_n=rear_load,
            v_takeoff_ms=v_takeoff_ms,
            rho=rho,
            profile_thickness_pct=rear_profile["max_thickness_pct"],
            profile_camber_pct=rear_profile["max_camber_pct"],
            cl_target=cl_rear,
            oswald_e=oswald_e,
            max_t_mm=max_t_rear,
            chord_mm_direct=chord_rear,
            max_span_mm=_opt_float("rear_max_span_mm"),
            min_span_mm=_opt_float("rear_min_span_mm"),
            max_chord_mm=_opt_float("rear_max_chord_mm"),
            min_chord_mm=_opt_float("rear_min_chord_mm"),
            min_ar=_opt_float("rear_min_ar"),
            max_ar=_opt_float("rear_max_ar"),
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


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
