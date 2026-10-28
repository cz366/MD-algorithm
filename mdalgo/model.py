"""Quantify glucose, lactate and pyruvate by fitting pure-standard spectra.

Each sample spectrum is modelled in the 1000-1200 cm-1 window as

    A(v) = c_glu * R_glu(v) + c_lac * R_lac(v) + c_pyr * R_pyr(v) + b0 + b1 * v

where R is the reference spectrum (absorbance per mM) of each analyte and
b0 + b1 * v is a straight baseline. Concentrations are kept >= 0.
"""

from itertools import combinations

import numpy as np

from .spectra import savgol_coefficients, smooth

ANALYTES = ("glucose", "lactate", "pyruvate")
PEAKS = {"glucose": 1036.0, "lactate": 1124.0, "pyruvate": 1176.0}  # cm-1
FIT_RANGE = (1000.0, 1200.0)  # cm-1
MAX_STANDARD_MM = 50.0  # use the standards closest to physiological levels
QUALITY_LIMIT = 10.0  # fit residual / noise; above this the result is not reported


def build_model(standards):
    """Reference spectrum (absorbance per mM) for each analyte.

    At each wavenumber the smoothed absorbance of the blanks and standards
    (up to 50 mM) is regressed on concentration. The slope is the reference.
    """
    coefficients = savgol_coefficients()
    grid = standards[0]["wavenumber"]
    blanks = [s for s in standards if s["analyte"] is None]
    references = []
    for analyte in ANALYTES:
        used = blanks + [s for s in standards if s["analyte"] == analyte and s["conc"] <= MAX_STANDARD_MM]
        conc = np.array([s["conc"] if s["analyte"] else 0.0 for s in used])
        Y = np.array([smooth(np.interp(grid, s["wavenumber"], s["absorbance"]), coefficients) for s in used])
        X = np.column_stack([conc, np.ones_like(conc)])
        references.append(np.linalg.lstsq(X, Y, rcond=None)[0][0])
    return {"wavenumber": grid, "references": np.array(references), "smoothing": coefficients}


def _least_squares(X, y):
    """Solve min |X b - y| with columns scaled to unit length first."""
    scale = np.linalg.norm(X, axis=0)
    Xs = X / scale
    b = np.linalg.solve(Xs.T @ Xs, Xs.T @ y)
    return b / scale


def fit(wavenumber, absorbance, model):
    """Fit one spectrum. Returns concentrations (mM) and the fitted curves."""
    lo, hi = FIT_RANGE
    wavenumber = np.asarray(wavenumber, dtype=float)
    absorbance = np.asarray(absorbance, dtype=float)
    step = np.median(np.diff(wavenumber))
    if wavenumber[0] > lo + step or wavenumber[-1] < hi - step:
        raise ValueError(f"Spectrum must cover {lo:.0f}-{hi:.0f} cm-1")

    keep = (model["wavenumber"] >= lo) & (model["wavenumber"] <= hi)
    grid = model["wavenumber"][keep]
    refs = model["references"][:, keep]
    smoothed = smooth(absorbance, model["smoothing"])
    y = np.interp(grid, wavenumber, smoothed)
    t = (grid - (lo + hi) / 2) / (hi - lo)
    baseline = np.column_stack([np.ones_like(t), t])

    # Non-negative least squares: try every subset of analytes, keep the best
    # solution where all concentrations are >= 0.
    best = None
    for k in range(len(ANALYTES) + 1):
        for subset in combinations(range(len(ANALYTES)), k):
            X = np.column_stack([refs[list(subset)].T, baseline])
            b = _least_squares(X, y)
            if np.any(b[:k] < 0):
                continue
            sse = float(np.sum((y - X @ b) ** 2))
            if best is None or sse < best[0]:
                best = (sse, subset, b)
    sse, subset, b = best

    conc = np.zeros(len(ANALYTES))
    conc[list(subset)] = b[: len(subset)]
    base = baseline @ b[len(subset):]
    fitted = conc @ refs + base

    in_window = (wavenumber >= lo) & (wavenumber <= hi)
    noise = float(np.sqrt(np.mean((absorbance[in_window] - smoothed[in_window]) ** 2)))
    residual = float(np.sqrt(sse / len(y)))
    ratio = residual / noise if noise > 0 else np.inf

    result = {a: float(c) for a, c in zip(ANALYTES, conc)}
    result.update(
        wavenumber=grid,
        measured=y,
        fitted=fitted,
        baseline=base,
        components={a: c * r for a, c, r in zip(ANALYTES, conc, refs)},
        residual_rms=residual,
        noise_rms=noise,
        quality=ratio,
        fit_ok=bool(ratio <= QUALITY_LIMIT),
    )
    return result
