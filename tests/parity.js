// Fit CSV files with web/js/fit.js and print the results as JSON.
// Used by test_model.py:  node tests/parity.js [--model model.json] file1.csv ...
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "..", "web");
let args = process.argv.slice(2);
let model;
if (args[0] === "--model") {
  model = JSON.parse(fs.readFileSync(args[1], "utf8"));
  args = args.slice(2);
} else {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(web, "data", "model.js"), "utf8"), context);
  model = context.window.MD.model;
}
const MDFit = require(path.join(web, "js", "fit.js"));

const out = {};
for (const file of args) {
  const s = MDFit.parseCsv(fs.readFileSync(file, "utf8"));
  const r = MDFit.fit(s.wavenumber, s.absorbance, model);
  out[path.basename(file)] = { glucose: r.glucose, lactate: r.lactate, pyruvate: r.pyruvate, interferents: r.interferents, quality: r.quality };
}
process.stdout.write(JSON.stringify(out));
