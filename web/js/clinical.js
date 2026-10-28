// Clinical thresholds, interpretation and response guides for one reading.
// Glucose, LPR: 2014 International Microdialysis Forum consensus
// (Hutchinson et al., Intensive Care Med 2015;41:1517-28).
// Pyruvate 70 umol/L to separate ischaemia from mitochondrial dysfunction:
// Nordstrom / Nielsen group (e.g. Nielsen et al., Acta Anaesthesiol Scand 2013).
// Check these against the local protocol before clinical use.
(function (root) {
  "use strict";

  var THRESHOLDS = {
    glucose: { critical: 0.2, low: 0.8 }, // mmol/L
    lactate: { high: 4.0 }, // mmol/L
    pyruvate: { low: 70 }, // umol/L
    lpr: { raised: 25, crisis: 40 }
  };

  var REFS = {
    hutchinson2015: ["Hutchinson 2015", "Hutchinson PJ et al. Consensus statement from the 2014 International Microdialysis Forum. Intensive Care Med 2015;41:1517–28."],
    oddo2008: ["Oddo 2008", "Oddo M et al. Impact of tight glycemic control on cerebral glucose metabolism after severe brain injury: a microdialysis study. Crit Care Med 2008."],
    vespa2012: ["Vespa 2012", "Vespa P et al. Tight glycemic control increases metabolic distress in traumatic brain injury: a randomized controlled within-subjects trial. Crit Care Med 2012;40:1923–9."],
    plummer2018: ["Plummer 2018", "Plummer MP et al. Cerebral metabolic effects of strict versus conventional glycaemic targets following severe traumatic brain injury. Crit Care 2018."],
    meierhans2010: ["Meierhans 2010", "Meierhans R et al. Brain metabolism is significantly impaired at blood glucose below 6 mM and brain glucose below 1 mM in patients with severe traumatic brain injury. Crit Care 2010;14:R13."],
    nicesugar2009: ["NICE-SUGAR 2009", "NICE-SUGAR Study Investigators. Intensive versus conventional glucose control in critically ill patients. N Engl J Med 2009."],
    kofler2017: ["Kofler 2017", "Kofler M et al. Enteral nutrition increases interstitial brain glucose levels in poor-grade subarachnoid hemorrhage patients. J Cereb Blood Flow Metab 2017."],
    khellaf2022: ["Khellaf 2022", "Khellaf A et al. Focally administered succinate improves cerebral metabolism in traumatic brain injury patients with mitochondrial dysfunction. J Cereb Blood Flow Metab 2022."],
    carney2017: ["Carney 2017", "Carney N et al. Guidelines for the management of severe traumatic brain injury, 4th edition. Neurosurgery 2017."],
    sharma2023: ["Sharma 2023", "Sharma H et al. Cerebral microdialysis and glucopenia in traumatic brain injury: a review. Front Neurol 2023;14:1017290."],
    zimphango2022: ["Zimphango 2022", "Zimphango C et al. Monitoring neurochemistry in traumatic brain injury patients using microdialysis integrated with biosensors: a review. Metabolites 2022;12:393."]
  };

  var CONFIRM = {
    head: "Confirm the reading",
    text: "Check that the next reading shows the same change. Check catheter position, perfusion pump and tubing, and the sensor's last check standard.",
    refs: ["zimphango2022"]
  };
  var FOLLOW = {
    head: "Follow the next readings",
    text: "The values should move after each change. If they do not, reassess.",
    refs: []
  };
  var SUPPLY = {
    head: "Correct supply, in this order",
    text: "Treat ICP above 20 mmHg. Bring PbtO₂ to 15 mmHg or more (oxygen, haemoglobin, CPP). Keep CPP at 60–70 mmHg, or where PRx is 0.3 or less. Aim for brain glucose of 1 mmol/L or more.",
    refs: ["khellaf2022", "carney2017", "hutchinson2015"]
  };

  var GUIDES = {
    lowGlucose: {
      title: "Low brain glucose: what to do",
      steps: [
        {
          head: CONFIRM.head,
          text: CONFIRM.text + " If lactate and pyruvate are also very low, suspect a sampling fault before treating.",
          refs: CONFIRM.refs
        },
        {
          head: "Check blood glucose and insulin",
          text: "Brain glucose follows blood glucose. Tight control (blood glucose 4.4–6.1 mmol/L) gives more low brain glucose and more metabolic crisis.",
          refs: ["oddo2008", "vespa2012", "plummer2018"]
        },
        {
          head: "Blood glucose below 6 mmol/L, or a tight insulin target",
          text: "Reduce insulin and aim for blood glucose of 6–10 mmol/L. Brain metabolism worsens below 6 mmol/L, and tight control raised mortality in critically ill patients. Feeding or a glucose infusion raises brain glucose.",
          refs: ["meierhans2010", "nicesugar2009", "kofler2017"]
        },
        {
          head: "Blood glucose already 6–10 mmol/L",
          text: SUPPLY.text + " Check the EEG for seizures, which raise glucose use.",
          refs: SUPPLY.refs.concat(["sharma2023"])
        },
        FOLLOW
      ],
      note: "Evidence comes from small trials and cohort studies. The Brain Trauma Foundation guidelines set no blood glucose target. Follow the local protocol."
    },
    raisedLpr: {
      title: "Raised LPR: what to do",
      steps: [
        CONFIRM,
        SUPPLY,
        {
          head: "LPR still above 25 once these are corrected",
          text: "This is the pattern of mitochondrial dysfunction. There is no standard treatment. Focal succinate given through the microdialysis catheter lowered LPR by 12% and raised brain glucose by 17% in a small study; it is a research treatment.",
          refs: ["khellaf2022"]
        },
        FOLLOW
      ],
      note: "Evidence comes from small studies. Follow the local protocol."
    }
  };

  // Turn a fit result (mmol/L) into the values shown on screen. Each value
  // carries its measurement error: the RMSE from the mixture validation.
  function values(fit, model) {
    var lod = model.pyruvateLod; // mmol/L
    var u = model.uncertainty; // mmol/L
    var belowLod = fit.pyruvate < lod;
    var lpr = null, lprLowerBound = false, lprError = 0;
    if (!belowLod) {
      lpr = fit.lactate / fit.pyruvate;
      if (fit.lactate > 0) {
        lprError = lpr * Math.sqrt(Math.pow(u.lactate / fit.lactate, 2) + Math.pow(u.pyruvate / fit.pyruvate, 2));
      }
    } else if (fit.lactate >= u.lactate) {
      lpr = fit.lactate / lod; // pyruvate below detection: LPR is at least this
      lprLowerBound = true;
    }
    return {
      glucose: fit.glucose,
      lactate: fit.lactate,
      pyruvate: fit.pyruvate * 1000,
      pyruvateBelowLod: belowLod,
      pyruvateLod: lod * 1000,
      lpr: lpr,
      lprLowerBound: lprLowerBound,
      error: { glucose: u.glucose, lactate: u.lactate, pyruvate: u.pyruvate * 1000, lpr: lprError },
      fitOk: fit.fitOk,
      quality: fit.quality
    };
  }

  // Critical thresholds (glucose < 0.2, LPR > 40) flag on the measured value.
  // Warning thresholds flag only when the value is past them by more than its
  // measurement error; within the error the value is "near threshold".
  function below(v, name, limit) { return v[name] + v.error[name] < limit; }
  function above(v, name, limit) { return v[name] - v.error[name] > limit; }
  function near(v, name, limit) { return v[name] !== null && Math.abs(v[name] - limit) <= v.error[name]; }

  var NEAR = { level: "borderline", text: "Near threshold" };
  var OK = { level: "normal", text: "In range" };

  function lprFlags(v) {
    var t = THRESHOLDS.lpr;
    if (v.lpr === null) return { raised: false, crisis: false };
    var crisis = v.lpr > t.crisis;
    if (v.lprLowerBound) return { raised: v.lpr > t.raised, crisis: crisis };
    return { raised: crisis || above(v, "lpr", t.raised), crisis: crisis };
  }

  function status(name, v) {
    var t = THRESHOLDS;
    if (name === "glucose") {
      if (v.glucose < t.glucose.critical) return { level: "critical", text: "Critically low" };
      if (below(v, "glucose", t.glucose.low)) return { level: "warning", text: "Low" };
      if (near(v, "glucose", t.glucose.low)) return NEAR;
      return OK;
    }
    if (name === "lactate") {
      if (above(v, "lactate", t.lactate.high)) return { level: "warning", text: "High" };
      if (near(v, "lactate", t.lactate.high)) return NEAR;
      return OK;
    }
    if (name === "pyruvate") {
      if (v.pyruvateBelowLod) return { level: "warning", text: "Below detection limit" };
      if (below(v, "pyruvate", t.pyruvate.low)) return { level: "warning", text: "Low" };
      if (near(v, "pyruvate", t.pyruvate.low)) return NEAR;
      return OK;
    }
    if (name === "lpr") {
      var f = lprFlags(v);
      if (v.lpr === null) return { level: "none", text: "Not available" };
      if (f.crisis) return { level: "critical", text: "Above 40" };
      if (f.raised) return { level: "warning", text: "Raised" };
      if (v.lprLowerBound) return { level: "none", text: "Not determined" };
      if (near(v, "lpr", t.lpr.raised) || near(v, "lpr", t.lpr.crisis)) return NEAR;
      return OK;
    }
  }

  // One headline per reading, most severe pattern first.
  function assess(v) {
    var t = THRESHOLDS;
    if (!v.fitOk) {
      return {
        level: "invalid",
        title: "Result not reported",
        detail: "The spectrum has bands that glucose, lactate and pyruvate do not explain " +
          "(fit residual " + v.quality.toFixed(0) + "× noise). Repeat the measurement or send the sample for reference analysis.",
        checks: []
      };
    }
    var lpr = lprFlags(v);
    var glucoseCritical = v.glucose < t.glucose.critical;
    var glucoseLow = below(v, "glucose", t.glucose.low);
    var pyruvateLow = v.pyruvateBelowLod || below(v, "pyruvate", t.pyruvate.low);
    var pyruvateNear = !pyruvateLow && near(v, "pyruvate", t.pyruvate.low);

    if (glucoseCritical && lpr.crisis) {
      return { level: "critical", title: "Metabolic crisis", detail: "Brain glucose below 0.2 mmol/L with LPR above 40.", checks: [], guide: "lowGlucose" };
    }
    if (lpr.raised && pyruvateLow) {
      return { level: lpr.crisis ? "critical" : "warning", title: "Raised LPR with low pyruvate", detail: "Pattern consistent with ischaemia.", checks: [], guide: "raisedLpr" };
    }
    if (lpr.raised && pyruvateNear) {
      return {
        level: lpr.crisis ? "critical" : "warning",
        title: "Raised LPR",
        detail: "Pyruvate is too uncertain to separate ischaemia from mitochondrial dysfunction.",
        checks: [],
        guide: "raisedLpr"
      };
    }
    if (lpr.raised) {
      return {
        level: lpr.crisis ? "critical" : "warning",
        title: "Raised LPR with normal pyruvate",
        detail: "Pattern consistent with mitochondrial dysfunction rather than ischaemia.",
        checks: [],
        guide: "raisedLpr"
      };
    }
    if (glucoseCritical) {
      return { level: "critical", title: "Critically low brain glucose", detail: "Glucose below 0.2 mmol/L.", checks: [], guide: "lowGlucose" };
    }
    if (glucoseLow) {
      return { level: "warning", title: "Low brain glucose", detail: "Glucose below 0.8 mmol/L, LPR not raised.", checks: [], guide: "lowGlucose" };
    }
    if (above(v, "lactate", t.lactate.high)) {
      return {
        level: "warning",
        title: "High lactate",
        detail: "Lactate above 4 mmol/L without a clearly raised LPR. Pattern consistent with increased glycolysis.",
        checks: ["Follow the trend."]
      };
    }
    return { level: "normal", title: "Within thresholds", detail: "No value is past an alert threshold.", checks: [] };
  }

  function show(name, x) {
    return name === "glucose" || name === "lactate" ? x.toFixed(2) : x.toFixed(0);
  }

  // Notes on how far the numbers can be trusted.
  function caveats(v) {
    var notes = [];
    if (!v.fitOk) return notes;
    var t = THRESHOLDS;
    var close = [];
    [["glucose", "Glucose", " mmol/L", [t.glucose.low, t.glucose.critical]],
      ["lactate", "Lactate", " mmol/L", [t.lactate.high]],
      ["pyruvate", "Pyruvate", " µmol/L", [t.pyruvate.low]],
      ["lpr", "LPR", "", [t.lpr.raised, t.lpr.crisis]]].forEach(function (m) {
      if (m[0] === "pyruvate" && v.pyruvateBelowLod) return;
      if (m[0] === "lpr" && (v.lpr === null || v.lprLowerBound)) return;
      m[3].forEach(function (limit) {
        if (near(v, m[0], limit)) {
          close.push(m[1] + " " + show(m[0], v[m[0]]) + " ± " + show(m[0], v.error[m[0]]) + m[2] + " (threshold " + limit + ")");
        }
      });
    });
    if (close.length) notes.push("Within measurement error of a threshold: " + close.join(", ") + ".");
    if (v.pyruvateBelowLod) {
      notes.push("Pyruvate is below the detection limit (" + v.pyruvateLod.toFixed(0) + " µmol/L)." +
        (v.lprLowerBound ? " LPR is shown as a lower bound." : ""));
    } else if (v.pyruvate < 2 * v.pyruvateLod) {
      notes.push("Pyruvate is close to the detection limit (" + v.pyruvateLod.toFixed(0) + " µmol/L). Treat LPR as approximate.");
    }
    return notes;
  }

  // Response guide for the reading's pattern, with notes that depend on it.
  function guide(v, assessment) {
    var g = GUIDES[assessment.guide];
    if (!g) return null;
    var steps = g.steps.map(function (s, i) {
      var note = null;
      if (assessment.guide === "lowGlucose" && i === 0 && v.lactate < 0.5) {
        note = "In this reading lactate is also very low (" + v.lactate.toFixed(2) + " mmol/L).";
      }
      return { head: s.head, text: s.text, note: note, refs: s.refs.map(function (k) { return REFS[k][0]; }) };
    });
    var keys = [];
    g.steps.forEach(function (s) { s.refs.forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); });
    return { title: g.title, steps: steps, note: g.note, references: keys.map(function (k) { return REFS[k][1]; }) };
  }

  var api = { THRESHOLDS: THRESHOLDS, REFS: REFS, values: values, status: status, assess: assess, caveats: caveats, guide: guide };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MDClinical = api;
})(this);
