(function () {
  "use strict";

  var model = window.MD.model;
  var validation = window.MD.validation;
  var demo = window.MD.demo;
  var C = window.MDClinical;
  var F = window.MDFit;

  var METRICS = ["glucose", "lactate", "pyruvate", "lpr"];
  var ANALYTES = ["glucose", "lactate", "pyruvate"];
  var NAMES = { glucose: "Glucose", lactate: "Lactate", pyruvate: "Pyruvate", lpr: "LPR" };
  var UNITS = { glucose: "mmol/L", lactate: "mmol/L", pyruvate: "µmol/L", lpr: "" };
  var COLORS = { glucose: "var(--glucose)", lactate: "var(--lactate)", pyruvate: "var(--pyruvate)", lpr: "var(--lpr)" };
  var SHORT = { glucose: "Glc", lactate: "Lac", pyruvate: "Pyr" };
  var LEVEL_ORDER = { critical: 0, invalid: 1, warning: 2, normal: 3 };

  var state = { bed: 0, sample: null, uploads: [], upload: 0 };

  // ---------- helpers ----------

  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === "class") node.className = attrs[k];
      else if (k === "html") node.innerHTML = attrs[k];
      else if (k === "text") node.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function th(label, unit, attrs) {
    return h("th", attrs || {}, [label, unit ? h("span", { class: "u", text: " " + unit }) : null]);
  }

  function fmt(metric, v) {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    if (metric === "glucose" || metric === "lactate") return v.toFixed(2);
    return v.toFixed(0);
  }

  function display(metric, v) {
    if (!v.fitOk) return "—";
    if (metric === "pyruvate" && v.pyruvateBelowLod) return "< " + v.pyruvateLod.toFixed(0);
    if (metric === "lpr" && v.lprLowerBound) return "> " + fmt("lpr", v.lpr);
    return fmt(metric, v[metric]);
  }

  // Measurement error from the mixture validation, shown next to each value.
  function uncertainty(metric, v) {
    if (!v.fitOk) return "";
    if (metric === "pyruvate" && v.pyruvateBelowLod) return "";
    if (metric === "lpr" && (v.lpr === null || v.lprLowerBound || !v.error.lpr)) return "";
    return "± " + fmt(metric, v.error[metric]);
  }

  function reference(metric) {
    var t = C.THRESHOLDS;
    if (metric === "glucose") return "Low < " + t.glucose.low + " · critical < " + t.glucose.critical;
    if (metric === "lactate") return "High > " + t.lactate.high;
    if (metric === "pyruvate") return "Low < " + t.pyruvate.low + " · detection limit " + (model.pyruvateLod * 1000).toFixed(0);
    return "Raised > " + t.lpr.raised + " · crisis > " + t.lpr.crisis;
  }

  function analyse(wavenumber, absorbance) {
    var fit = F.fit(wavenumber, absorbance, model);
    var v = C.values(fit, model);
    var a = C.assess(v);
    return { fit: fit, values: v, assessment: a, caveats: C.caveats(v), guide: C.guide(v, a) };
  }

  function summary(r) {
    if (!r.values.fitOk) return "Not reported";
    return "Glc " + display("glucose", r.values) + " · LPR " + display("lpr", r.values);
  }

  // ---------- shared result blocks ----------

  function metricTiles(r) {
    var v = r.values;
    return h("div", { class: "metrics" }, METRICS.map(function (m) {
      var st = v.fitOk ? C.status(m, v) : { level: "none", text: "Not reported" };
      var value = display(m, v);
      return h("div", { class: "metric " + st.level }, [
        h("div", { class: "metric-label" }, [h("span", { text: NAMES[m] }), h("span", { class: "metric-unc", text: uncertainty(m, v) })]),
        h("div", { class: "metric-value" + (value === "—" ? " na" : "") }, [value, UNITS[m] ? h("span", { class: "unit", text: UNITS[m] }) : null]),
        h("div", { class: "metric-status " + st.level, text: st.text }),
        h("div", { class: "metric-ref", text: reference(m) })
      ]);
    }));
  }

  var LEVEL_LABEL = { critical: "Critical", warning: "Warning", normal: "Normal", invalid: "Not reported" };

  function interpretation(r) {
    var a = r.assessment;
    var body = [
      h("span", { class: "eyebrow " + a.level, text: LEVEL_LABEL[a.level] }),
      h("h3", { text: a.title }),
      h("p", { text: a.detail })
    ];
    if (a.checks.length) {
      body.push(h("ul", {}, a.checks.map(function (c) { return h("li", { text: c }); })));
    }
    r.caveats.forEach(function (c) { body.push(h("p", { class: "caveat", text: c })); });
    return h("div", { class: "panel interp" }, body);
  }

  function guidePanel(r) {
    var g = r.guide;
    return h("div", { class: "panel guide" }, [
      h("div", { class: "panel-head" }, [h("h3", { text: g.title }), h("span", { class: "sub", text: "From the literature" })]),
      h("div", { class: "panel-body" }, [
        h("ol", { class: "guide-steps" }, g.steps.map(function (s, i) {
          return h("li", {}, [
            h("span", { class: "guide-n", text: String(i + 1) }),
            h("div", {}, [
              h("div", { class: "guide-head", text: s.head }),
              h("p", { class: "guide-text", text: s.text }),
              s.note ? h("p", { class: "guide-note", text: s.note }) : null,
              s.refs.length ? h("p", { class: "guide-refs", text: s.refs.join(" · ") }) : null
            ])
          ]);
        })),
        h("p", { class: "note", text: g.note }),
        h("details", { class: "refs" }, [
          h("summary", { text: "References" }),
          h("ol", {}, g.references.map(function (t) { return h("li", { text: t }); }))
        ])
      ])
    ]);
  }

  function legend(items) {
    return h("div", { class: "legend" }, items.map(function (it) {
      return h("span", {}, [h("i", { class: "swatch" + (it.dashed ? " dashed" : ""), style: it.dashed ? "border-color:" + it.color : "background:" + it.color }), it.label]);
    }));
  }

  function peakMarkers() {
    return ANALYTES.map(function (a) {
      return { x: model.peaks[a], label: SHORT[a] + " " + model.peaks[a], color: COLORS[a] };
    });
  }

  function milli(arr) { return arr.map(function (v) { return v * 1000; }); }

  function spectrumPanel(r, title) {
    var f = r.fit;
    var chart = h("div");
    var ok = r.values.fitOk;
    var panel = h("div", { class: "panel" }, [
      h("div", { class: "panel-head" }, [
        h("h3", { text: title || "Spectrum" }),
        legend([
          { label: "Measured", color: "var(--measured)" },
          { label: "Model", color: "var(--fit)", dashed: true },
          { label: "Glucose", color: COLORS.glucose },
          { label: "Lactate", color: COLORS.lactate },
          { label: "Pyruvate", color: COLORS.pyruvate }
        ])
      ]),
      h("div", { class: "panel-body" }, [
        chart,
        h("div", { class: "fit-line", html: "Fit residual <strong>" + f.quality.toFixed(1) + "× noise</strong> (limit " +
          model.qualityLimit + ") · " + (ok ? "spectrum explained by glucose, lactate and pyruvate" : '<span class="bad">unexplained bands, values withheld</span>') })
      ])
    ]);
    var x = f.wavenumber;
    var series = ANALYTES.map(function (a) {
      return { x: x, y: milli(f.components[a]), color: COLORS[a], width: 1, fill: true, label: NAMES[a], format: function (v) { return v.toFixed(2); } };
    });
    series.push({ x: x, y: milli(f.measured), color: "var(--measured)", width: 2, label: "Measured", format: function (v) { return v.toFixed(2); } });
    series.push({ x: x, y: milli(f.fitted), color: "var(--fit)", width: 1.5, dash: "5 4", label: "Model", format: function (v) { return v.toFixed(2); } });
    requestAnimationFrame(function () {
      MDChart.render(chart, {
        height: 280,
        series: series,
        markers: peakMarkers(),
        x: { label: "Wavenumber (cm⁻¹)", min: model.fitRange[0], max: model.fitRange[1], format: function (v) { return v.toFixed(0); }, hoverFormat: function (v) { return v.toFixed(1) + " cm⁻¹"; } },
        y: { label: "Absorbance (×10⁻³)", zero: true },
        ariaLabel: "Measured spectrum with model fit"
      });
    });
    return panel;
  }

  function fullSpectrumPanel(wavenumber, absorbance) {
    var chart = h("div");
    var panel = h("div", { class: "panel" }, [
      h("div", { class: "panel-head" }, [h("h3", { text: "Full spectrum" }), h("span", { class: "sub", text: "Shaded: fit window. Bands outside it are not used." })]),
      h("div", { class: "panel-body" }, [chart])
    ]);
    requestAnimationFrame(function () {
      MDChart.render(chart, {
        height: 220,
        series: [{ x: wavenumber, y: milli(absorbance), color: "var(--measured)", width: 1.2, label: "Absorbance", format: function (v) { return v.toFixed(2); } }],
        band: { x0: model.fitRange[0], x1: model.fitRange[1], label: "fit window" },
        x: { label: "Wavenumber (cm⁻¹)", format: function (v) { return v.toFixed(0); }, hoverFormat: function (v) { return v.toFixed(1) + " cm⁻¹"; } },
        y: { label: "Absorbance (×10⁻³)" }
      });
    });
    return panel;
  }

  // ---------- patients view ----------

  function clock(minutes) {
    var hh = Math.floor(minutes / 60), mm = minutes % 60;
    return (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
  }

  var beds = demo.beds.map(function (bed) {
    return {
      name: bed.bed,
      interval: bed.interval,
      samples: bed.samples.map(function (s) {
        var r = analyse(s.wavenumber, s.absorbance);
        var hm = s.time.split(":");
        r.time = s.time;
        r.minutes = parseInt(hm[0], 10) * 60 + parseInt(hm[1], 10);
        r.file = s.file;
        r.source = s.source;
        return r;
      })
    };
  });

  function flagged(s) { return s.assessment.level === "critical" || s.assessment.level === "warning"; }

  function renderBedList() {
    var list = document.getElementById("bed-list");
    list.innerHTML = "";
    beds.forEach(function (bed, i) {
      var last = bed.samples[bed.samples.length - 1];
      list.appendChild(h("li", {
        class: "bed-item", "aria-current": i === state.bed ? "true" : "false", tabindex: "0",
        onclick: function () { state.bed = i; state.sample = null; renderPatients(); },
        onkeydown: function (e) { if (e.key === "Enter") { state.bed = i; state.sample = null; renderPatients(); } }
      }, [
        h("span", { class: "dot " + last.assessment.level }),
        h("span", { class: "bed-name", text: bed.name }),
        h("span", { class: "bed-time", text: last.time }),
        h("span", { class: "bed-status", text: last.assessment.title })
      ]));
    });
    var bed = beds[state.bed];
    var rows = [
      ["Monitoring", "Mid-IR sensor on microdialysis"],
      ["Interval", "Every " + bed.interval + " min"],
      ["First reading", bed.samples[0].time],
      ["Readings", String(bed.samples.length)],
      ["Flagged", String(bed.samples.filter(flagged).length)]
    ];
    var dl = document.getElementById("monitor");
    dl.innerHTML = "";
    rows.forEach(function (r) {
      dl.appendChild(h("dt", { text: r[0] }));
      dl.appendChild(h("dd", { text: r[1] }));
    });
  }

  function trendPanel(bed, selected) {
    var grid = h("div", { class: "trend-grid" });
    var panel = h("div", { class: "panel" }, [
      h("div", { class: "panel-head" }, [h("h3", { text: "Trends" }), h("span", { class: "sub", text: "One reading every " + bed.interval + " min. Dashed lines: alert thresholds. Open circles: value at a detection limit." })]),
      h("div", { class: "panel-body" }, [grid])
    ]);
    var times = bed.samples.map(function (s) { return s.minutes; });
    var half = bed.interval / 2;
    var t = C.THRESHOLDS;
    function warn(y, label) { return { y: y, label: label, color: "var(--warning)", labelColor: "var(--warning-text)" }; }
    function crit(y, label) { return { y: y, label: label, color: "var(--critical)" }; }
    var lines = {
      glucose: [warn(t.glucose.low, "0.8"), crit(t.glucose.critical, "0.2")],
      lactate: [warn(t.lactate.high, "4")],
      pyruvate: [warn(t.pyruvate.low, "70")],
      lpr: [warn(t.lpr.raised, "25"), crit(t.lpr.crisis, "40")]
    };
    METRICS.forEach(function (m) {
      var box = h("div");
      grid.appendChild(h("div", {}, [h("div", { class: "trend-title" }, [NAMES[m] + " ", h("span", { text: UNITS[m] })]), box]));
      // Values known only as a limit are drawn at the limit as open circles.
      var ys = bed.samples.map(function (s) {
        var v = s.values;
        if (!v.fitOk) return null;
        return m === "pyruvate" && v.pyruvateBelowLod ? v.pyruvateLod : v[m];
      });
      var bounds = bed.samples.map(function (s) {
        return (m === "pyruvate" && s.values.pyruvateBelowLod) || (m === "lpr" && s.values.lprLowerBound);
      });
      requestAnimationFrame(function () {
        MDChart.render(box, {
          height: 170,
          series: [{
            x: times, y: ys, color: COLORS[m], width: 2.5, points: true, hollow: bounds, label: NAMES[m],
            format: function (v) { return fmt(m, v) + (UNITS[m] ? " " + UNITS[m] : ""); }
          }],
          thresholds: lines[m],
          band: { x0: selected.minutes - half * 0.4, x1: selected.minutes + half * 0.4 },
          x: { min: times[0] - half, max: times[times.length - 1] + half, ticks: times, format: clock },
          y: { zero: true }
        });
      });
    });
    return panel;
  }

  function samplesTable(bed, selected) {
    var rows = bed.samples.slice().reverse().map(function (s) {
      var idx = bed.samples.indexOf(s);
      var cells = [h("td", { text: s.time })];
      METRICS.forEach(function (m) {
        var st = s.values.fitOk ? C.status(m, s.values) : { level: "none" };
        cells.push(h("td", { class: st.level === "critical" || st.level === "warning" ? st.level : "", text: display(m, s.values) }));
      });
      cells.push(h("td", { class: "left wrap" }, [h("span", { class: "dot " + s.assessment.level, style: "display:inline-block;width:8px;height:8px;margin-right:6px" }), s.assessment.title]));
      return h("tr", {
        class: "clickable", "aria-current": s === selected ? "true" : "false",
        onclick: function () { state.sample = idx; renderPatients(); window.scrollTo({ top: 0, behavior: "smooth" }); }
      }, cells);
    });
    return h("div", { class: "panel" }, [
      h("div", { class: "panel-head" }, [h("h3", { text: "Readings" }), h("span", { class: "sub", text: "Select a row to view it" })]),
      h("div", { class: "panel-body" }, [h("div", { class: "table-wrap" }, [h("table", {}, [
        h("thead", {}, [h("tr", {}, [
          th("Time"), th("Glucose", "mmol/L"), th("Lactate", "mmol/L"), th("Pyruvate", "µmol/L"), th("LPR"), th("Assessment", null, { class: "left" })
        ])]),
        h("tbody", {}, rows)
      ])])])
    ]);
  }

  function renderPatients() {
    renderBedList();
    var bed = beds[state.bed];
    var idx = state.sample === null ? bed.samples.length - 1 : state.sample;
    var s = bed.samples[idx];
    var latest = idx === bed.samples.length - 1;
    var detail = document.getElementById("bed-detail");
    detail.innerHTML = "";
    detail.appendChild(h("div", { class: "result-head" }, [
      h("div", {}, [
        h("h2", { text: bed.name }),
        h("div", { class: "meta", text: "Reading " + s.time + (latest ? " (latest)" : "") + " · source: " + s.source + ", " + s.file })
      ]),
      h("span", { class: "pill " + s.assessment.level, text: s.assessment.title })
    ]));
    detail.appendChild(metricTiles(s));
    detail.appendChild(interpretation(s));
    if (s.guide) detail.appendChild(guidePanel(s));
    detail.appendChild(trendPanel(bed, s));
    detail.appendChild(spectrumPanel(s, "Spectrum at " + s.time));
    detail.appendChild(samplesTable(bed, s));
  }

  // ---------- analyse view ----------

  function addUpload(name, wavenumber, absorbance) {
    var item = { name: name, wavenumber: wavenumber, absorbance: absorbance };
    try {
      item.result = analyse(wavenumber, absorbance);
    } catch (err) {
      item.error = err.message;
    }
    state.uploads.push(item);
    state.upload = state.uploads.length - 1;
  }

  function readFiles(files) {
    var pending = files.length;
    Array.prototype.forEach.call(files, function (file) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var s = F.parseCsv(reader.result);
          addUpload(file.name, s.wavenumber, s.absorbance);
        } catch (err) {
          state.uploads.push({ name: file.name, error: err.message });
          state.upload = state.uploads.length - 1;
        }
        if (--pending === 0) renderAnalyse();
      };
      reader.readAsText(file);
    });
  }

  function renderAnalyse() {
    var list = document.getElementById("file-list");
    list.innerHTML = "";
    state.uploads.forEach(function (u, i) {
      var level = u.error ? "invalid" : u.result.assessment.level;
      list.appendChild(h("li", {
        class: "file-item", "aria-current": i === state.upload ? "true" : "false", tabindex: "0",
        onclick: function () { state.upload = i; renderAnalyse(); }
      }, [
        h("span", { class: "dot " + level }),
        h("span", { class: "file-name", text: u.name, title: u.name }),
        h("span", { class: "bed-status", text: u.error ? "Could not read" : summary(u.result) })
      ]));
    });

    var detail = document.getElementById("analyse-detail");
    detail.innerHTML = "";
    var u = state.uploads[state.upload];
    if (!u) {
      detail.appendChild(h("div", { class: "empty" }, [
        h("h2", { text: "No sample loaded" }),
        h("p", { text: "Add a sensor CSV file to get glucose, lactate, pyruvate and LPR. Files are processed in this browser and are not uploaded anywhere." })
      ]));
      return;
    }
    if (u.error) {
      detail.appendChild(h("div", { class: "empty" }, [h("h2", { text: u.name }), h("p", { class: "error", text: u.error })]));
      return;
    }
    var r = u.result;
    detail.appendChild(h("div", { class: "result-head" }, [
      h("div", {}, [h("h2", { text: u.name }), h("div", { class: "meta", text: u.wavenumber.length + " points, " + u.wavenumber[0].toFixed(0) + "–" + u.wavenumber[u.wavenumber.length - 1].toFixed(0) + " cm⁻¹" })]),
      h("span", { class: "pill " + r.assessment.level, text: r.assessment.title })
    ]));
    detail.appendChild(metricTiles(r));
    detail.appendChild(interpretation(r));
    if (r.guide) detail.appendChild(guidePanel(r));
    detail.appendChild(spectrumPanel(r));
    detail.appendChild(fullSpectrumPanel(u.wavenumber, u.absorbance));
  }

  function setupUpload() {
    var input = document.getElementById("file-input");
    var zone = document.getElementById("dropzone");
    input.addEventListener("change", function () { if (input.files.length) readFiles(input.files); input.value = ""; });
    ["dragenter", "dragover"].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add("over"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove("over"); });
    });
    zone.addEventListener("drop", function (e) { if (e.dataTransfer.files.length) readFiles(e.dataTransfer.files); });
    document.getElementById("load-examples").addEventListener("click", function () {
      demo.examples.forEach(function (s) { addUpload(s.file, s.wavenumber, s.absorbance); });
      renderAnalyse();
    });
  }

  // ---------- method view ----------

  function panel(title, sub, children) {
    return h("div", { class: "panel" }, [
      h("div", { class: "panel-head" }, [h("h3", { text: title }), sub ? h("span", { class: "sub", text: sub }) : null]),
      h("div", { class: "panel-body" }, children)
    ]);
  }

  function renderMethod() {
    var root = document.getElementById("method-content");
    if (root.childNodes.length) return;
    var lod = model.pyruvateLod * 1000;
    var rmse = validation.rmse;

    root.appendChild(h("div", { class: "method-intro" }, [
      h("h1", { text: "Method" }),
      h("p", { text: "A mid-infrared sensor coupled to the microdialysis catheter records the absorbance spectrum of the microdialysate continuously, instead of hourly bedside analysis. Glucose, lactate and pyruvate each absorb at their own wavenumbers. The algorithm fits the reference spectrum of each compound to each reading and reports the concentrations." })
    ]));

    root.appendChild(panel("Processing steps", null, [h("ol", { class: "steps" }, [
      "Smooth the spectrum (Savitzky–Golay, 2nd order, 11 points).",
      "Keep 1000–1200 cm⁻¹, which holds the main band of each compound: glucose 1036, lactate 1124 and pyruvate 1176 cm⁻¹.",
      "Fit the sample as the sum of the three reference spectra plus a straight baseline. Concentrations cannot be negative.",
      "Check the fit. If the residual is more than " + model.qualityLimit + "× the noise, the sample contains something the model does not know and no values are reported.",
      "Compute LPR = lactate / pyruvate. If pyruvate is below the detection limit (" + lod.toFixed(0) + " µmol/L), LPR is shown as a lower bound.",
      "Compare each value with the thresholds below. Critical thresholds (glucose below 0.2 mmol/L, LPR above 40) flag on the measured value. The others flag only when the value is past them by more than its measurement error (the ± value); otherwise it is shown as near threshold."
    ].map(function (t, i) {
      return h("li", {}, [h("span", { class: "step-n", text: "Step " + (i + 1) }), t]);
    }))]));

    // reference spectra
    var refChart = h("div");
    root.appendChild(panel("Reference spectra", "Absorbance per mM from standards of 0–" + model.maxStandard + " mM, 3 replicates each", [
      legend(ANALYTES.map(function (a) { return { label: NAMES[a], color: COLORS[a] }; })), refChart
    ]));
    requestAnimationFrame(function () {
      MDChart.render(refChart, {
        height: 300,
        series: ANALYTES.map(function (a) {
          return { x: model.wavenumber, y: milli(model.references[a]), color: COLORS[a], width: 1.8, label: NAMES[a], format: function (v) { return v.toFixed(3); } };
        }),
        markers: peakMarkers(),
        band: { x0: model.fitRange[0], x1: model.fitRange[1] },
        x: { label: "Wavenumber (cm⁻¹)", format: function (v) { return v.toFixed(0); }, hoverFormat: function (v) { return v.toFixed(1) + " cm⁻¹"; } },
        y: { label: "Absorbance per mM (×10⁻³)" }
      });
    });

    // calibration
    var cal = h("div", { class: "grid-3" });
    root.appendChild(panel("Calibration", "Smoothed absorbance at the main band against concentration, all standards (mean of 3)", [cal]));
    ANALYTES.forEach(function (a) {
      var c = validation.calibration[a];
      var box = h("div");
      cal.appendChild(h("div", {}, [
        h("div", { class: "cal-title", style: "color:" + COLORS[a], text: NAMES[a] + " at " + c.peak + " cm⁻¹" }),
        h("div", { class: "cal-sub", text: (c.slope * 1000).toFixed(2) + " ×10⁻³ per mM · R² " + c.r2.toFixed(4) }),
        box
      ]));
      var xs = c.points.map(function (p) { return p.conc; });
      var xmax = xs[xs.length - 1];
      requestAnimationFrame(function () {
        MDChart.render(box, {
          height: 200,
          series: [
            { x: [0, xmax], y: [c.intercept, c.intercept + c.slope * xmax], color: "var(--separator)", width: 1, noHover: true },
            { x: xs, y: c.points.map(function (p) { return p.mean; }), color: COLORS[a], line: false, points: true, label: "Absorbance", format: function (v) { return v.toFixed(4); } }
          ],
          x: { label: "Concentration (mM)", min: 0, format: function (v) { return v.toFixed(0); }, hoverFormat: function (v) { return v + " mM"; } },
          y: { zero: true }
        });
      });
    });

    // validation table
    var rows = validation.mixtures.map(function (row) {
      var k = row.known, m = row.measured;
      var lprK = k.pyruvate > 0 && k.lactate > 0 ? k.lactate / k.pyruvate : null;
      var lprM = m.pyruvate > 0 && m.lactate > 0 ? m.lactate / m.pyruvate : null;
      function pair(known, measured, digits) {
        return [h("td", { class: "muted", text: known === null ? "—" : known.toFixed(digits) }), h("td", { text: measured === null ? "—" : measured.toFixed(digits) })];
      }
      return h("tr", {}, [h("td", { text: row.label })]
        .concat(pair(k.glucose, m.glucose, 2))
        .concat(pair(k.lactate, m.lactate, 2))
        .concat(pair(k.pyruvate * 1000, m.pyruvate * 1000, 0))
        .concat(pair(lprK, lprM, 0))
        .concat([h("td", { text: row.quality.toFixed(1) })]));
    });
    root.appendChild(panel("Validation: synthetic mixtures", null, [
      h("div", { class: "table-wrap" }, [h("table", {}, [
        h("thead", {}, [
          h("tr", {}, [h("th", { text: "" }), th("Glucose", "mmol/L", { colspan: "2" }), th("Lactate", "mmol/L", { colspan: "2" }), th("Pyruvate", "µmol/L", { colspan: "2" }), h("th", { colspan: "2", text: "LPR" }), h("th", { text: "Fit" })]),
          h("tr", {}, [h("th", { text: "Sample" }), h("th", { text: "known" }), h("th", { text: "measured" }), h("th", { text: "known" }), h("th", { text: "measured" }), h("th", { text: "known" }), h("th", { text: "measured" }), h("th", { text: "known" }), h("th", { text: "measured" }), th("Residual", "× noise")])
        ]),
        h("tbody", {}, rows)
      ])]),
      h("p", { class: "note", text: "Root-mean-square error, mixtures A–E (15 spectra): glucose " + rmse.glucose.toFixed(2) + " mmol/L, lactate " + rmse.lactate.toFixed(2) + " mmol/L, pyruvate " + (rmse.pyruvate * 1000).toFixed(0) + " µmol/L. These are the ± values shown next to each result." })
    ]));

    // pyruvate series
    var py = validation.pyruvate;
    var pyChart = h("div");
    root.appendChild(panel("Pyruvate at low concentration", "Dilution series 0–1 mM, 3 replicates", [
      legend([{ label: "Measured (mean)", color: COLORS.pyruvate }, { label: "Measured = prepared", color: "var(--faint)", dashed: true }]),
      pyChart,
      h("p", { class: "note", text: "Detection limit " + lod.toFixed(0) + " µmol/L (3.3 × SD of the residuals, 0–0.25 mM). This series read " + py.slope.toFixed(2) + "× the prepared concentration, while the 1 mM pyruvate standard run with the mixtures read " + validation.mixtures.filter(function (r) { return r.sample === "PYR_1mM"; })[0].measured.pyruvate.toFixed(2) + " mM. Sensitivity changes between sessions: run a 1 mM check standard at the start of each session." })
    ]));
    requestAnimationFrame(function () {
      var xs = py.points.map(function (p) { return p.conc * 1000; });
      MDChart.render(pyChart, {
        height: 240,
        series: [
          { x: [0, 1000], y: [0, 1000], color: "var(--faint)", width: 1, dash: "4 4", noHover: true },
          { x: xs, y: py.points.map(function (p) { return p.mean * 1000; }), color: COLORS.pyruvate, width: 1.5, points: true, label: "Measured", format: function (v) { return v.toFixed(0) + " µmol/L"; } }
        ],
        thresholds: [{ y: lod, label: "detection limit", color: "var(--muted)" }],
        x: { label: "Prepared pyruvate (µmol/L)", min: 0, format: function (v) { return v.toFixed(0); }, hoverFormat: function (v) { return v.toFixed(0) + " µmol/L prepared"; } },
        y: { label: "Measured (µmol/L)", zero: true, format: function (v) { return v.toFixed(0); } }
      });
    });

    // thresholds
    var t = C.THRESHOLDS;
    var thr = [
      ["Glucose", "< " + t.glucose.low + " mmol/L", "Low brain glucose", "Hutchinson et al. 2015"],
      ["Glucose", "< " + t.glucose.critical + " mmol/L", "Critically low", "Hutchinson et al. 2015"],
      ["LPR", "> " + t.lpr.raised, "Raised", "Hutchinson et al. 2015"],
      ["LPR", "> " + t.lpr.crisis, "Crisis threshold; with glucose < 0.2: metabolic crisis", "Hutchinson et al. 2015"],
      ["Pyruvate", "< " + t.pyruvate.low + " µmol/L", "With raised LPR: ischaemic pattern. Above: mitochondrial dysfunction", "Nielsen et al. 2013"],
      ["Lactate", "> " + t.lactate.high + " mmol/L", "High", "Reinstrup et al. 2000 (normal 2.9 ± 0.9)"]
    ];
    root.appendChild(panel("Thresholds", "Set in web/js/clinical.js, with the response guides", [
      h("div", { class: "table-wrap" }, [h("table", {}, [
        h("thead", {}, [h("tr", {}, ["Measure", "Threshold", "Meaning", "Source"].map(function (c) { return h("th", { class: "left", text: c }); }))]),
        h("tbody", {}, thr.map(function (r) { return h("tr", {}, r.map(function (c) { return h("td", { class: "left", text: c }); })); }))
      ])]),
      h("p", { class: "note", text: "Normal brain values (Reinstrup et al. 2000): glucose 1.7 ± 0.9 mmol/L, lactate 2.9 ± 0.9 mmol/L, pyruvate 166 ± 47 µmol/L, LPR 23 ± 4. Hutchinson et al., Intensive Care Med 2015;41:1517–28 (2014 International Microdialysis Forum consensus)." })
    ]));

    // limits
    var a = validation.mixtures.filter(function (r) { return r.sample === "SampleA"; })[0];
    root.appendChild(panel("Known limits", null, [h("ul", { class: "limits" }, [
      "Pyruvate in the clinical range (20–200 µmol/L) is close to the detection limit. In mixture A (20 µmol/L pyruvate) it reads " +
        (a.measured.pyruvate * 1000).toFixed(0) + " µmol/L, so LPR reads " + (a.measured.lactate / a.measured.pyruvate).toFixed(0) +
        " instead of " + (a.known.lactate / a.known.pyruvate).toFixed(0) + ". Treat LPR as approximate.",
      "Patient microdialysate spectra measured on 17 Oct 2024 contain bands at about 1020, 1160 and 1360 cm⁻¹ that are not in the standards. All of them fail the fit check, so no values are reported for them.",
      "The reference spectra come from one sensor (March 2025). Another sensor or session needs a check standard before its results are used."
    ].map(function (t) { return h("li", { text: t }); }))]));
  }

  // ---------- navigation ----------

  function show(view) {
    if (["patients", "analyse", "method"].indexOf(view) < 0) view = "patients";
    document.querySelectorAll(".tab").forEach(function (b) {
      if (b.dataset.view === view) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    document.querySelectorAll(".view").forEach(function (s) { s.hidden = s.id !== "view-" + view; });
    if (view === "patients") renderPatients();
    if (view === "analyse") renderAnalyse();
    if (view === "method") renderMethod();
    if (location.hash.slice(1) !== view) history.replaceState(null, "", "#" + view);
  }

  document.querySelectorAll(".tab").forEach(function (b) {
    b.addEventListener("click", function () { show(b.dataset.view); });
  });
  window.addEventListener("hashchange", function () { show(location.hash.slice(1)); });

  // Open on the bed with the most severe latest result.
  beds.forEach(function (bed, i) {
    var cur = beds[state.bed].samples[beds[state.bed].samples.length - 1].assessment.level;
    var lvl = bed.samples[bed.samples.length - 1].assessment.level;
    if (LEVEL_ORDER[lvl] < LEVEL_ORDER[cur]) state.bed = i;
  });
  setupUpload();
  show(location.hash.slice(1) || "patients");
})();
