// Clinical thresholds and interpretation of one microdialysis sample.
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

  var CHECK_PERFUSION = "Check CPP, ICP and brain tissue oxygen (PbtO₂).";
  var CHECK_OXYGEN = "Check haemoglobin and arterial oxygenation.";
  var CHECK_GLUCOSE = "Check blood glucose. If insulin is running, review the target range.";

  // Turn a fit result (mmol/L) into the values shown on screen.
  function values(fit, model) {
    var lod = model.pyruvateLod; // mmol/L
    var pyruvateUm = fit.pyruvate * 1000;
    var belowLod = fit.pyruvate < lod;
    var lpr = null, lprLowerBound = false;
    if (!belowLod) {
      lpr = fit.lactate / fit.pyruvate;
    } else if (fit.lactate >= model.uncertainty.lactate) {
      lpr = fit.lactate / lod; // pyruvate below detection: LPR is at least this
      lprLowerBound = true;
    }
    return {
      glucose: fit.glucose,
      lactate: fit.lactate,
      pyruvate: pyruvateUm,
      pyruvateBelowLod: belowLod,
      pyruvateLod: lod * 1000,
      lpr: lpr,
      lprLowerBound: lprLowerBound,
      fitOk: fit.fitOk,
      quality: fit.quality
    };
  }

  function status(name, v) {
    var t = THRESHOLDS;
    if (name === "glucose") {
      if (v.glucose < t.glucose.critical) return { level: "critical", text: "Critically low" };
      if (v.glucose < t.glucose.low) return { level: "warning", text: "Low" };
      return { level: "normal", text: "In range" };
    }
    if (name === "lactate") {
      if (v.lactate > t.lactate.high) return { level: "warning", text: "High" };
      return { level: "normal", text: "In range" };
    }
    if (name === "pyruvate") {
      if (v.pyruvateBelowLod) return { level: "warning", text: "Below detection limit" };
      if (v.pyruvate < t.pyruvate.low) return { level: "warning", text: "Low" };
      return { level: "normal", text: "In range" };
    }
    if (name === "lpr") {
      if (v.lpr === null) return { level: "none", text: "Not available" };
      if (v.lpr > t.lpr.crisis) return { level: "critical", text: "Above 40" };
      if (v.lpr > t.lpr.raised) return { level: "warning", text: "Raised" };
      if (v.lprLowerBound) return { level: "none", text: "Not determined" };
      return { level: "normal", text: "In range" };
    }
  }

  // One headline per sample, most severe pattern first.
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
    var lowPyruvate = v.pyruvateBelowLod || v.pyruvate < t.pyruvate.low;
    var lprRaised = v.lpr !== null && v.lpr > t.lpr.raised;
    var lprCrisis = v.lpr !== null && v.lpr > t.lpr.crisis;

    if (v.glucose < t.glucose.critical && lprCrisis) {
      return {
        level: "critical",
        title: "Metabolic crisis",
        detail: "Brain glucose below 0.2 mmol/L with LPR above 40.",
        checks: [CHECK_PERFUSION, CHECK_GLUCOSE]
      };
    }
    if (lprRaised && lowPyruvate) {
      return {
        level: lprCrisis ? "critical" : "warning",
        title: "Raised LPR with low pyruvate",
        detail: "Pattern consistent with ischaemia.",
        checks: [CHECK_PERFUSION, CHECK_OXYGEN]
      };
    }
    if (lprRaised) {
      return {
        level: lprCrisis ? "critical" : "warning",
        title: "Raised LPR with normal pyruvate",
        detail: "Pattern consistent with mitochondrial dysfunction rather than ischaemia.",
        checks: ["Compare with PbtO₂ and the trend before changing perfusion targets."]
      };
    }
    if (v.glucose < t.glucose.critical) {
      return { level: "critical", title: "Critically low brain glucose", detail: "Glucose below 0.2 mmol/L.", checks: [CHECK_GLUCOSE] };
    }
    if (v.glucose < t.glucose.low) {
      return { level: "warning", title: "Low brain glucose", detail: "Glucose below 0.8 mmol/L, LPR not raised.", checks: [CHECK_GLUCOSE] };
    }
    if (v.lactate > t.lactate.high) {
      return {
        level: "warning",
        title: "High lactate, LPR not raised",
        detail: "Pattern consistent with increased glycolysis.",
        checks: ["Follow the trend."]
      };
    }
    return { level: "normal", title: "Within thresholds", detail: "No value outside the alert thresholds.", checks: [] };
  }

  // Extra notes on how far the numbers can be trusted.
  function caveats(v) {
    var notes = [];
    if (!v.fitOk) return notes;
    if (v.pyruvateBelowLod) {
      notes.push("Pyruvate is below the detection limit (" + v.pyruvateLod.toFixed(0) + " µmol/L). " +
        (v.lprLowerBound ? "LPR is shown as a lower bound." : ""));
    } else if (v.pyruvate < 2 * v.pyruvateLod) {
      notes.push("Pyruvate is close to the detection limit (" + v.pyruvateLod.toFixed(0) + " µmol/L). Treat LPR as approximate.");
    }
    return notes;
  }

  var api = { THRESHOLDS: THRESHOLDS, values: values, status: status, assess: assess, caveats: caveats };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MDClinical = api;
})(this);
