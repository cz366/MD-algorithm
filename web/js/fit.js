// Spectrum fit. Same steps as mdalgo/model.py; tests/test_parity.py checks
// that both give the same concentrations.
(function (root) {
  "use strict";

  var ANALYTES = ["glucose", "lactate", "pyruvate"];

  // Every subset of 0..n-1, by size then in lexicographic order
  // (the same order as itertools.combinations in mdalgo/model.py).
  function subsets(n) {
    var out = [];
    function combos(k, start, current) {
      if (current.length === k) { out.push(current.slice()); return; }
      for (var i = start; i < n; i++) { current.push(i); combos(k, i + 1, current); current.pop(); }
    }
    for (var k = 0; k <= n; k++) combos(k, 0, []);
    return out;
  }

  // Read a sensor CSV: header row(s), then wavenumber and absorbance columns.
  function parseCsv(text) {
    var rows = [];
    text.split(/\r?\n/).forEach(function (line) {
      var cells = line.split(/[,;\t]/);
      if (cells.length < 2) return;
      var x = parseFloat(cells[0]);
      var y = parseFloat(cells[1]);
      if (isFinite(x) && isFinite(y)) rows.push([x, y]);
    });
    if (rows.length < 50) throw new Error("Expected two numeric columns: wavenumber and absorbance.");
    rows.sort(function (a, b) { return a[0] - b[0]; });
    return {
      wavenumber: rows.map(function (r) { return r[0]; }),
      absorbance: rows.map(function (r) { return r[1]; })
    };
  }

  // Savitzky-Golay smoothing; edges padded with the end values.
  function smooth(y, weights) {
    var half = (weights.length - 1) / 2;
    var n = y.length;
    var out = new Array(n);
    for (var i = 0; i < n; i++) {
      var s = 0;
      for (var k = -half; k <= half; k++) {
        s += weights[k + half] * y[Math.min(n - 1, Math.max(0, i + k))];
      }
      out[i] = s;
    }
    return out;
  }

  // Linear interpolation, clamped at the ends (as numpy.interp).
  function interp(x, xp, fp) {
    var n = xp.length;
    return x.map(function (v) {
      if (v <= xp[0]) return fp[0];
      if (v >= xp[n - 1]) return fp[n - 1];
      var lo = 0, hi = n - 1;
      while (hi - lo > 1) {
        var mid = (lo + hi) >> 1;
        if (xp[mid] <= v) lo = mid; else hi = mid;
      }
      var t = (v - xp[lo]) / (xp[hi] - xp[lo]);
      return fp[lo] + t * (fp[hi] - fp[lo]);
    });
  }

  // Least squares on scaled columns (normal equations, Gaussian elimination).
  function leastSquares(cols, y) {
    var m = cols.length;
    var scale = cols.map(function (c) {
      return Math.sqrt(c.reduce(function (s, v) { return s + v * v; }, 0));
    });
    var xs = cols.map(function (c, j) { return c.map(function (v) { return v / scale[j]; }); });
    var A = [];
    for (var i = 0; i < m; i++) {
      var row = [];
      for (var j = 0; j < m; j++) row.push(dot(xs[i], xs[j]));
      row.push(dot(xs[i], y));
      A.push(row);
    }
    for (var p = 0; p < m; p++) {
      var best = p;
      for (var r = p + 1; r < m; r++) if (Math.abs(A[r][p]) > Math.abs(A[best][p])) best = r;
      var tmp = A[p]; A[p] = A[best]; A[best] = tmp;
      for (r = p + 1; r < m; r++) {
        var f = A[r][p] / A[p][p];
        for (var c = p; c <= m; c++) A[r][c] -= f * A[p][c];
      }
    }
    var b = new Array(m);
    for (i = m - 1; i >= 0; i--) {
      var s = A[i][m];
      for (j = i + 1; j < m; j++) s -= A[i][j] * b[j];
      b[i] = s / A[i][i];
    }
    return b.map(function (v, j) { return v / scale[j]; });
  }

  function dot(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  function fit(wavenumber, absorbance, model) {
    var lo = model.fitRange[0], hi = model.fitRange[1];
    var n = wavenumber.length;
    var step = (wavenumber[n - 1] - wavenumber[0]) / (n - 1);
    if (wavenumber[0] > lo + step || wavenumber[n - 1] < hi - step) {
      throw new Error("Spectrum must cover " + lo + "–" + hi + " cm⁻¹.");
    }

    var idx = [];
    model.wavenumber.forEach(function (v, i) { if (v >= lo && v <= hi) idx.push(i); });
    var grid = idx.map(function (i) { return model.wavenumber[i]; });
    // Targets first, then the library of other compounds in microdialysate.
    var library = model.interferents || [];
    var names = ANALYTES.concat(library.map(function (c) { return c.name; }));
    var full = ANALYTES.map(function (a) { return model.references[a]; })
      .concat(library.map(function (c) { return c.reference; }));
    var refs = full.map(function (r) { return idx.map(function (i) { return r[i]; }); });
    var smoothed = smooth(absorbance, model.smoothing);
    var y = interp(grid, wavenumber, smoothed);
    var ones = grid.map(function () { return 1; });
    var slope = grid.map(function (v) { return (v - (lo + hi) / 2) / (hi - lo); });

    // Non-negative least squares: try every subset of compounds.
    var best = null;
    subsets(names.length).forEach(function (subset) {
      var cols = subset.map(function (k) { return refs[k]; }).concat([ones, slope]);
      var b = leastSquares(cols, y);
      for (var k = 0; k < subset.length; k++) if (b[k] < 0) return;
      var sse = 0;
      for (var i = 0; i < y.length; i++) {
        var f = 0;
        for (var j = 0; j < cols.length; j++) f += b[j] * cols[j][i];
        sse += (y[i] - f) * (y[i] - f);
      }
      if (best === null || sse < best.sse) best = { sse: sse, subset: subset, b: b };
    });

    var conc = names.map(function () { return 0; });
    best.subset.forEach(function (k, j) { conc[k] = best.b[j]; });
    var b0 = best.b[best.subset.length], b1 = best.b[best.subset.length + 1];
    var baseline = slope.map(function (t) { return b0 + b1 * t; });
    var components = {};
    var interferents = {};
    names.forEach(function (a, k) {
      components[a] = refs[k].map(function (v) { return conc[k] * v; });
      if (k >= ANALYTES.length) interferents[a] = conc[k];
    });
    var fitted = baseline.map(function (v, i) {
      var s = v;
      for (var k = 0; k < names.length; k++) s += conc[k] * refs[k][i];
      return s;
    });

    var noiseSum = 0, noiseN = 0;
    for (var i = 0; i < n; i++) {
      if (wavenumber[i] >= lo && wavenumber[i] <= hi) {
        noiseSum += Math.pow(absorbance[i] - smoothed[i], 2);
        noiseN++;
      }
    }
    var noise = Math.sqrt(noiseSum / noiseN);
    var residual = Math.sqrt(best.sse / y.length);
    var quality = noise > 0 ? residual / noise : Infinity;

    return {
      glucose: conc[0],
      lactate: conc[1],
      pyruvate: conc[2],
      interferents: interferents,
      wavenumber: grid,
      measured: y,
      fitted: fitted,
      baseline: baseline,
      components: components,
      residualRms: residual,
      noiseRms: noise,
      quality: quality,
      fitOk: quality <= model.qualityLimit
    };
  }

  var api = { ANALYTES: ANALYTES, parseCsv: parseCsv, smooth: smooth, fit: fit };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MDFit = api;
})(this);
