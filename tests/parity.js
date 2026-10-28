// Fit CSV files with web/js/fit.js and print the results as JSON.
// Used by test_parity.py:  node tests/parity.js file1.csv file2.csv ...
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const web = path.join(__dirname, "..", "web");
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(web, "data", "model.js"), "utf8"), context);
const model = context.window.MD.model;
const MDFit = require(path.join(web, "js", "fit.js"));

const out = {};
for (const file of process.argv.slice(2)) {
  const s = MDFit.parseCsv(fs.readFileSync(file, "utf8"));
  const r = MDFit.fit(s.wavenumber, s.absorbance, model);
  out[path.basename(file)] = { glucose: r.glucose, lactate: r.lactate, pyruvate: r.pyruvate, quality: r.quality };
}
process.stdout.write(JSON.stringify(out));
