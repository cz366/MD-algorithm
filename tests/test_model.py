import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from mdalgo.build import DATA, ROOT, validate_mixtures
from mdalgo.model import ANALYTES, PEAKS, build_model, fit
from mdalgo.spectra import load_standards, read_concentrations, read_csv


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
