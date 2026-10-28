"""Read and smooth mid-IR absorbance spectra exported by the sensor."""

import re
from pathlib import Path

import numpy as np

SG_WINDOW = 11  # points, same as sgolayfilt(x, 2, 11) in the MATLAB scripts
SG_ORDER = 2


def read_csv(path):
    """Return (wavenumber, absorbance) sorted by wavenumber.

    The file has a header row and two columns:
    wavenumber (cm-1), Naperian absorbance.
    """
    data = np.genfromtxt(path, delimiter=",", skip_header=1, encoding="utf-8-sig")
    data = data[~np.isnan(data).any(axis=1)]
    order = np.argsort(data[:, 0])
    return data[order, 0], data[order, 1]


def savgol_coefficients(window=SG_WINDOW, order=SG_ORDER):
    """Savitzky-Golay smoothing weights (centre point of a local polynomial fit)."""
    half = window // 2
    x = np.arange(-half, half + 1)
    vander = np.vander(x, order + 1, increasing=True)
    return np.linalg.pinv(vander)[0]


def smooth(y, coefficients=None):
    """Savitzky-Golay smoothing. Edges are padded with the end values."""
    if coefficients is None:
        coefficients = savgol_coefficients()
    half = len(coefficients) // 2
    padded = np.pad(y, half, mode="edge")
    return np.convolve(padded, coefficients[::-1], mode="valid")


# 10032025_CulpeoALS_Glu_25mM_50uLMin_400avg_r2.csv
# 10032025_CulpeoALS_0_50uLMin_400avg_r1.csv   (blank)
STANDARD_NAME = re.compile(
    r"CulpeoALS_(?:(?P<analyte>Glu|Lac|Pyr)_)?(?P<conc>\d+(?:\.\d+)?)(?:mM)?_.*_r(?P<rep>\d+)\.csv$"
)
ANALYTE_CODES = {"Glu": "glucose", "Lac": "lactate", "Pyr": "pyruvate"}


def parse_standard_name(name):
    """Return (analyte or None for blank, concentration in mM, replicate)."""
    m = STANDARD_NAME.search(name)
    if not m:
        return None
    analyte = ANALYTE_CODES.get(m.group("analyte"))
    return analyte, float(m.group("conc")), int(m.group("rep"))


def load_standards(folder):
    """Load all single-analyte standards and blanks in a folder."""
    standards = []
    for path in sorted(Path(folder).glob("*.csv")):
        parsed = parse_standard_name(path.name)
        if parsed is None:
            continue
        analyte, conc, rep = parsed
        wn, a = read_csv(path)
        standards.append(
            {"analyte": analyte, "conc": conc, "rep": rep, "wavenumber": wn, "absorbance": a, "file": path.name}
        )
    return standards


# Urea_5mM_r1.csv or 09102024_Culpeo51_Urea_5mM_50uLMin_r1.csv
INTERFERENT_NAME = re.compile(
    r"^(?:\d{6,8}_[^_]+_)?(?P<name>[A-Za-z][A-Za-z0-9-]*)_(?P<conc>\d+(?:\.\d+)?)mM(?:_.*)?_r(?P<rep>\d+)\.csv$"
)


def load_interferents(folder):
    """Load standards of other compounds in microdialysate (the library)."""
    library = []
    for path in sorted(Path(folder).glob("*.csv")):
        m = INTERFERENT_NAME.match(path.name)
        if not m:
            continue
        wn, a = read_csv(path)
        library.append(
            {"analyte": m.group("name").lower(), "conc": float(m.group("conc")), "rep": int(m.group("rep")),
             "wavenumber": wn, "absorbance": a, "file": path.name}
        )
    return library


def sample_name(filename):
    """09102024_Culpeo51_SampleA_r1.csv -> ('SampleA', 1)."""
    m = re.match(r"\d{8}_[^_]+_(?P<name>.+)_r(?P<rep>\d+)\.csv$", filename)
    if not m:
        return Path(filename).stem, 1
    return m.group("name"), int(m.group("rep"))


def read_concentrations(path):
    """Read a CSV of known concentrations: sample, glucose_mM, lactate_mM, pyruvate_mM."""
    rows = np.genfromtxt(path, delimiter=",", names=True, dtype=None, encoding="utf-8")
    return {
        str(r["sample"]): {"glucose": float(r["glucose_mM"]), "lactate": float(r["lactate_mM"]), "pyruvate": float(r["pyruvate_mM"])}
        for r in np.atleast_1d(rows)
    }
