import os
import tempfile

from OCP.BRepBuilderAPI import (
    BRepBuilderAPI_MakeEdge,
    BRepBuilderAPI_MakeFace,
    BRepBuilderAPI_MakeWire,
)
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism
from OCP.GC import GC_MakeSegment
from OCP.GeomAPI import GeomAPI_PointsToBSpline
from OCP.gp import gp_Pnt, gp_Vec
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_AsIs, STEPControl_Writer
from OCP.TColgp import TColgp_Array1OfPnt


def generate_step_bytes(coords_normalized: list, chord_mm: float, span_mm: float) -> bytes:
    """
    coords_normalized: list of (x, y) in 0-1 space.
    Expected order: upper surface trailing→leading, then lower surface leading→trailing.
    Returns raw STEP file bytes.
    """
    pts = [(x * chord_mm, y * chord_mm) for x, y in coords_normalized]

    # Build OCC point array from all profile coords
    n = len(pts)
    occ_pts = TColgp_Array1OfPnt(1, n)
    for i, (x, y) in enumerate(pts):
        occ_pts.SetValue(i + 1, gp_Pnt(x, y, 0.0))

    # Fit a B-spline through the profile coords (upper+lower surfaces in order)
    # Use defaults for DegMin=3, DegMax=8, Continuity=C2, Tol=1e-3
    spline = GeomAPI_PointsToBSpline(occ_pts, 3, 8).Curve()
    profile_edge = BRepBuilderAPI_MakeEdge(spline).Edge()

    # Close the trailing edge gap with a short line segment
    te_lower = gp_Pnt(pts[-1][0], pts[-1][1], 0.0)
    te_upper = gp_Pnt(pts[0][0],  pts[0][1],  0.0)
    closing_line = GC_MakeSegment(te_lower, te_upper).Value()
    closing_edge = BRepBuilderAPI_MakeEdge(closing_line).Edge()

    wire_builder = BRepBuilderAPI_MakeWire()
    wire_builder.Add(profile_edge)
    wire_builder.Add(closing_edge)
    if not wire_builder.IsDone():
        raise RuntimeError("Wire construction failed — check that profile coords form a valid closed loop")
    wire = wire_builder.Wire()

    face_builder = BRepBuilderAPI_MakeFace(wire, True)
    if not face_builder.IsDone():
        raise RuntimeError("Face construction failed — profile may not be planar")
    face = face_builder.Face()

    prism = BRepPrimAPI_MakePrism(face, gp_Vec(0.0, 0.0, span_mm))
    solid = prism.Shape()

    writer = STEPControl_Writer()
    writer.Transfer(solid, STEPControl_AsIs)

    with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as f:
        path = f.name

    try:
        status = writer.Write(path)
        if status != IFSelect_RetDone:
            raise RuntimeError("STEP writer returned an error status")
        with open(path, "rb") as f:
            return f.read()
    finally:
        if os.path.exists(path):
            os.unlink(path)
