import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from mdalgo.build import DATA, ROOT, validate_mixtures
from mdalgo.model import ANALYTES, FIT_RANGE, PEAKS, QUALITY_LIMIT, build_model, fit
from mdalgo.spectra import load_interferents, load_standards, read_concentrations, read_csv


@pytest.fixture(scope="module")
def model():
    return build_model(load_standards(DATA / "standards"))


def test_reference_peaks(model):
    """Each reference spectrum peaks where the standards do."""
    wn = model["wavenumber"]
    windows = {"glucose": (1020, 1050), "lactate": (1110, 1140), "pyruvate": (1160, 1190)}
    for analyte, ref in zip(ANALYTES, model["references"]):
        lo, hi = windows[analyte]
        keep = (wn >= lo) & (wn <= hi)
        peak = wn[keep][np.argmax(ref[keep])]
        assert abs(peak - PEAKS[analyte]) < 4, (analyte, peak)


def test_single_standards(model):
    """1 mM single-analyte standards measured on another day."""
    known = read_concentrations(DATA / "mixtures" / "concentrations.csv")
    for name in ("GLU_1mM", "LAC_1mM", "PYR_1mM"):
        for path in sorted((DATA / "mixtures").glob(f"*_{name}_r*.csv")):
            r = fit(*read_csv(path), model)
            for a in ANALYTES:
                assert abs(r[a] - known[name][a]) < 0.1, (path.name, a, r[a])
            assert r["fit_ok"]


def test_mixture_accuracy(model):
    """Glucose and lactate in mixtures A-E within 0.25 mM, pyruvate within 0.11 mM."""
    rows, rmse = validate_mixtures(model)
    assert rmse["glucose"] < 0.1
    assert rmse["lactate"] < 0.2
    assert rmse["pyruvate"] < 0.08
    for row in rows:
        assert abs(row["measured"]["glucose"] - row["known"]["glucose"]) < 0.25
        assert abs(row["measured"]["lactate"] - row["known"]["lactate"]) < 0.25
        assert abs(row["measured"]["pyruvate"] - row["known"]["pyruvate"]) < 0.11


def test_unexplained_band_fails_quality(model):
    """A band the model does not know about must fail the fit check."""
    wn, a = read_csv(next((DATA / "mixtures").glob("*_SampleB_r1.csv")))
    band = 0.004 * np.exp(-0.5 * ((wn - 1020) / 8) ** 2)
    assert fit(wn, a, model)["fit_ok"]
    assert not fit(wn, a + band, model)["fit_ok"]


def test_short_spectrum_rejected(model):
    wn, a = read_csv(next((DATA / "mixtures").glob("*_SampleB_r1.csv")))
    keep = wn > 1100
    with pytest.raises(ValueError):
        fit(wn[keep], a[keep], model)


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_web_fit_matches_python(model):
    """web/js/fit.js gives the same numbers as mdalgo.model.fit."""
    files = sorted((DATA / "mixtures").glob("*.csv"))
    files = [f for f in files if f.name != "concentrations.csv"]
    out = subprocess.run(
        ["node", str(ROOT / "tests" / "parity.js"), *map(str, files)],
        check=True, capture_output=True, text=True,
    )
    js = json.loads(out.stdout)
    for path in files:
        r = fit(*read_csv(path), model)
        for a in ANALYTES:
            assert abs(js[path.name][a] - r[a]) < 1e-5, (path.name, a)
        assert abs(js[path.name]["quality"] - r["quality"]) < 1e-3 * r["quality"]


def band(wn, centre, width, height):
    return height * np.exp(-0.5 * ((wn - centre) / width) ** 2)


@pytest.fixture(scope="module")
def library(tmp_path_factory):
    """Model with one extra compound in the library (bands at 1020 and 1160 cm-1)."""
    folder = tmp_path_factory.mktemp("interferents")
    wn, blank = read_csv(next((DATA / "mixtures").glob("*_PF_r1.csv")))
    per_mm = band(wn, 1020, 8, 4e-4) + band(wn, 1160, 10, 2e-4)
    for conc in (0, 5, 10, 20):
        np.savetxt(folder / f"Testcompound_{conc}mM_r1.csv", np.column_stack([wn, blank + conc * per_mm]),
                   delimiter=",", header="wavenumber (cm-1),Naperian absorbance", comments="")
    model = build_model(load_standards(DATA / "standards"), load_interferents(folder))
    return model, per_mm


def spiked_sample(per_mm, conc=8.0):
    wn, a = read_csv(next((DATA / "mixtures").glob("*_SampleB_r1.csv")))
    return wn, a, a + conc * per_mm


def test_library_recovers_targets(model, library):
    """An overlapping compound in the library is fitted, not mistaken for the targets."""
    lib_model, per_mm = library
    assert lib_model["components"] == ["glucose", "lactate", "pyruvate", "testcompound"]
    wn, clean, spiked = spiked_sample(per_mm)
    assert not fit(wn, spiked, model)["fit_ok"]
    r, ref = fit(wn, spiked, lib_model), fit(wn, clean, model)
    assert r["fit_ok"]
    assert abs(r["interferents"]["testcompound"] - 8.0) < 1.0
    for a, tol in (("glucose", 0.05), ("lactate", 0.1), ("pyruvate", 0.05)):
        assert abs(r[a] - ref[a]) < tol, a


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_web_fit_matches_python_with_library(library, tmp_path):
    lib_model, per_mm = library
    wn, _, spiked = spiked_sample(per_mm)
    csv = tmp_path / "spiked.csv"
    np.savetxt(csv, np.column_stack([wn, spiked]), delimiter=",", header="wavenumber (cm-1),Naperian absorbance", comments="")
    js_model = {
        "fitRange": list(FIT_RANGE),
        "qualityLimit": QUALITY_LIMIT,
        "smoothing": lib_model["smoothing"].tolist(),
        "wavenumber": lib_model["wavenumber"].tolist(),
        "references": {a: r.tolist() for a, r in zip(ANALYTES, lib_model["references"])},
        "interferents": [{"name": n, "reference": r.tolist()}
                         for n, r in zip(lib_model["components"][3:], lib_model["references"][3:])],
    }
    model_json = tmp_path / "model.json"
    model_json.write_text(json.dumps(js_model))
    out = subprocess.run(["node", str(ROOT / "tests" / "parity.js"), "--model", str(model_json), str(csv)],
                         check=True, capture_output=True, text=True)
    js = json.loads(out.stdout)["spiked.csv"]
    r = fit(wn, spiked, lib_model)
    for a in ANALYTES:
        assert abs(js[a] - r[a]) < 1e-5, a
    assert abs(js["interferents"]["testcompound"] - r["interferents"]["testcompound"]) < 1e-4
