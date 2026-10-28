"""Build the reference model, run the validation and write the web app data.

    python -m mdalgo.build

Reads data/ and writes web/data/model.js, validation.js and demo.js.
If data/patient/ holds sensor spectra and iscus.csv, a comparison with the
ISCUS values is printed (it is not written to web/data).
"""

import json
from pathlib import Path

import numpy as np

from .model import ANALYTES, FIT_RANGE, MAX_STANDARD_MM, PEAKS, QUALITY_LIMIT, build_model, fit
from .spectra import load_standards, read_concentrations, read_csv, sample_name, smooth

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "web" / "data"

MIXTURE_LABELS = {
    "SampleA": "Mixture A",
    "SampleB": "Mixture B",
    "SampleC": "Mixture C",
    "SampleD": "Mixture D",
    "SampleE": "Mixture E",
    "GLU_1mM": "Glucose 1 mM",
    "LAC_1mM": "Lactate 1 mM",
    "PYR_1mM": "Pyruvate 1 mM",
    "mix(GLP)_1mM": "Glu + Lac + Pyr, 1 mM each",
    "PF": "Perfusion fluid (blank)",
}
TEST_MIXTURES = ["SampleA", "SampleB", "SampleC", "SampleD", "SampleE"]

# Demo for the web app: one bed on continuous monitoring. Every reading is a
# measured spectrum of a synthetic mixture (data/mixtures); only the bed and the
# times are made up. The last reading (mixture E) is the flagged one.
DEMO_BED = "Bed 1"
DEMO_READINGS = ["SampleB_r1", "SampleB_r2", "SampleB_r3", "SampleC_r1", "SampleC_r2", "SampleC_r3", "SampleE_r1"]
DEMO_START = (13, 0)  # time of the first reading
DEMO_INTERVAL_MIN = 10  # one reading every 10 min
DEMO_EXAMPLES = ["SampleA_r1", "SampleB_r1", "SampleC_r1", "SampleD_r1", "SampleE_r1"]


def sig(values, digits=6):
    """Round to a fixed number of significant digits for compact JSON."""
    return [float(f"{v:.{digits}g}") for v in np.ravel(values)]


def load_folder(folder, pattern="*.csv"):
    spectra = []
    for path in sorted(Path(folder).glob(pattern)):
        if path.name == "concentrations.csv" or path.name == "iscus.csv":
            continue
        name, rep = sample_name(path.name)
        wn, a = read_csv(path)
        spectra.append({"name": name, "rep": rep, "file": path.name, "wavenumber": wn, "absorbance": a})
    return spectra


def line_fit(x, y):
    slope, intercept = np.polyfit(x, y, 1)
    pred = slope * np.asarray(x) + intercept
    r2 = 1 - np.sum((np.asarray(y) - pred) ** 2) / np.sum((np.asarray(y) - np.mean(y)) ** 2)
    return float(slope), float(intercept), float(r2)


def calibration(standards, model):
    """Smoothed absorbance at each analyte's peak against concentration."""
    blanks = [s for s in standards if s["analyte"] is None]
    out = {}
    for analyte in ANALYTES:
        peak = PEAKS[analyte]
        groups = {0.0: [np.interp(peak, b["wavenumber"], smooth(b["absorbance"], model["smoothing"])) for b in blanks]}
        for s in standards:
            if s["analyte"] == analyte:
                value = np.interp(peak, s["wavenumber"], smooth(s["absorbance"], model["smoothing"]))
                groups.setdefault(s["conc"], []).append(value)
        concs = sorted(groups)
        points = [{"conc": c, "mean": float(np.mean(groups[c])), "sd": float(np.std(groups[c], ddof=1))} for c in concs]
        x = [c for c in concs for _ in groups[c]]
        y = [v for c in concs for v in groups[c]]
        slope, intercept, r2 = line_fit(x, y)
        out[analyte] = {"peak": peak, "points": points, "slope": slope, "intercept": intercept, "r2": r2}
    return out


def validate_mixtures(model):
    known = read_concentrations(DATA / "mixtures" / "concentrations.csv")
    results = {}
    for s in load_folder(DATA / "mixtures"):
        results.setdefault(s["name"], []).append(fit(s["wavenumber"], s["absorbance"], model))
    rows = []
    for name in known:
        fits = results[name]
        rows.append(
            {
                "sample": name,
                "label": MIXTURE_LABELS.get(name, name),
                "n": len(fits),
                "known": known[name],
                "measured": {a: float(np.mean([f[a] for f in fits])) for a in ANALYTES},
                "sd": {a: float(np.std([f[a] for f in fits], ddof=1)) for a in ANALYTES},
                "quality": float(np.max([f["quality"] for f in fits])),
            }
        )
    errors = {a: [] for a in ANALYTES}
    for name in TEST_MIXTURES:
        for f in results[name]:
            for a in ANALYTES:
                errors[a].append(f[a] - known[name][a])
    rmse = {a: float(np.sqrt(np.mean(np.square(errors[a])))) for a in ANALYTES}
    return rows, rmse


def pyruvate_series(model, max_conc=0.25):
    """Pyruvate dilution series: measured against prepared concentration."""
    groups = {}
    for path in sorted((DATA / "pyruvate").glob("*.csv")):
        conc = float(path.name.split("_")[2].replace("mM", ""))
        wn, a = read_csv(path)
        groups.setdefault(conc, []).append(fit(wn, a, model)["pyruvate"])
    concs = sorted(groups)
    points = [{"conc": c, "mean": float(np.mean(groups[c])), "sd": float(np.std(groups[c], ddof=1))} for c in concs]
    x = [c for c in concs for _ in groups[c]]
    y = [v for c in concs for v in groups[c]]
    slope, intercept, r2 = line_fit(x, y)
    # Detection limit from the low end of the series: 3.3 x SD of residuals.
    low = [(c, v) for c, v in zip(x, y) if c <= max_conc]
    lx, ly = np.array(low).T
    lslope, lintercept = np.polyfit(lx, ly, 1)
    sd = np.std(ly - (lslope * lx + lintercept), ddof=2)
    return {"points": points, "slope": slope, "intercept": intercept, "r2": r2, "lod": float(3.3 * sd)}


def patient_comparison(model):
    folder = DATA / "patient"
    if not (folder / "iscus.csv").exists():
        return
    known = read_concentrations(folder / "iscus.csv")
    print("\nPatient samples: sensor vs ISCUS (not written to web/data)")
    print(f"{'sample':8} {'glu':>11} {'lac':>11} {'pyr uM':>13} {'fit':>6}")
    for s in load_folder(folder):
        key = s["file"].split("_")[1].replace(".csv", "")
        if key not in known:
            continue
        f, k = fit(s["wavenumber"], s["absorbance"], model), known[key]
        print(
            f"{key:8} {f['glucose']:5.2f}/{k['glucose']:5.2f} {f['lactate']:5.2f}/{k['lactate']:5.2f}"
            f" {f['pyruvate'] * 1000:6.0f}/{k['pyruvate'] * 1000:6.0f} {'ok' if f['fit_ok'] else 'poor':>6}"
        )


def write_js(name, obj):
    OUT.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, separators=(",", ":"))
    (OUT / f"{name}.js").write_text(f"window.MD = window.MD || {{}};\nwindow.MD.{name} = {text};\n")


def main():
    standards = load_standards(DATA / "standards")
    model = build_model(standards)
    mixtures, rmse = validate_mixtures(model)
    pyruvate = pyruvate_series(model)
    cal = calibration(standards, model)

    write_js(
        "model",
        {
            "fitRange": FIT_RANGE,
            "peaks": PEAKS,
            "qualityLimit": QUALITY_LIMIT,
            "maxStandard": MAX_STANDARD_MM,
            "smoothing": sig(model["smoothing"], 12),
            "wavenumber": sig(model["wavenumber"]),
            "references": {a: sig(r) for a, r in zip(ANALYTES, model["references"])},
            "uncertainty": rmse,
            "pyruvateLod": pyruvate["lod"],
        },
    )
    write_js("validation", {"calibration": cal, "mixtures": mixtures, "pyruvate": pyruvate, "rmse": rmse})

    spectra = {f"{s['name']}_r{s['rep']}": s for s in load_folder(DATA / "mixtures")}

    def entry(key):
        s = spectra[key]
        return {
            "file": s["file"],
            "source": MIXTURE_LABELS[s["name"]],
            "wavenumber": sig(s["wavenumber"]),
            "absorbance": sig(s["absorbance"]),
        }

    readings = []
    for i, key in enumerate(DEMO_READINGS):
        minutes = DEMO_START[0] * 60 + DEMO_START[1] + i * DEMO_INTERVAL_MIN
        readings.append({"time": f"{minutes // 60:02d}:{minutes % 60:02d}", **entry(key)})
    write_js(
        "demo",
        {
            "beds": [{"bed": DEMO_BED, "interval": DEMO_INTERVAL_MIN, "samples": readings}],
            "examples": [entry(key) for key in DEMO_EXAMPLES],
        },
    )

    print("Reference model: standards 0-%g mM, fit window %g-%g cm-1" % (MAX_STANDARD_MM, *FIT_RANGE))
    print("\nMixtures (mean of replicates): measured / known, mM")
    for row in mixtures:
        cells = "  ".join(f"{row['measured'][a]:6.3f}/{row['known'][a]:<6g}" for a in ANALYTES)
        print(f"  {row['label']:28} {cells}  fit {row['quality']:.1f}")
    print("\nRMSE, mixtures A-E: " + ", ".join(f"{a} {rmse[a]:.3f} mM" for a in ANALYTES))
    print(f"Pyruvate series: slope {pyruvate['slope']:.2f}, R2 {pyruvate['r2']:.3f}, LOD {pyruvate['lod'] * 1000:.0f} uM")
    for a in ANALYTES:
        c = cal[a]
        print(f"Calibration {a} at {c['peak']:.0f} cm-1: {c['slope'] * 1000:.2f} mAU/mM, R2 {c['r2']:.4f}")
    patient_comparison(model)


if __name__ == "__main__":
    main()
