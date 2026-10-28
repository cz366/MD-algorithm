// Small SVG line/scatter chart. No dependencies.
//
// MDChart.render(element, {
//   height, x: {label, min, max, format}, y: {label, min, max, format, zero},
//   series: [{x, y, color, width, dash, label, points, hollow, line, fill}],
//     hollow: per-point booleans, drawn as open circles
//   markers: [{x, label, color}],      vertical lines (peak positions)
//   thresholds: [{y, label, color, labelColor}],   horizontal lines
//   band: {x0, x1, label},             shaded x range
//   hover: true, tooltipFormat: function (row) -> string
// })
(function (root) {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";

  function el(name, attrs, parent) {
    var node = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function niceStep(range, count) {
    var raw = range / Math.max(count, 1);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = norm < 1.5 ? 1 : norm < 2.25 ? 2 : norm < 3.5 ? 2.5 : norm < 7.5 ? 5 : 10;
    return step * mag;
  }

  function ticks(min, max, count) {
    if (!(max > min)) return [min];
    var step = niceStep(max - min, count);
    var out = [];
    for (var v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) {
      out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    }
    return out;
  }

  function extent(opts, axis) {
    var lo = Infinity, hi = -Infinity;
    opts.series.forEach(function (s) {
      s[axis].forEach(function (v) {
        if (v === null || !isFinite(v)) return;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      });
    });
    if (axis === "y") {
      (opts.thresholds || []).forEach(function (t) { lo = Math.min(lo, t.y); hi = Math.max(hi, t.y); });
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    return [lo, hi];
  }

  function defaultFormat(step) {
    var digits = 0;
    while (digits < 6 && Math.abs(Math.round(step * Math.pow(10, digits)) - step * Math.pow(10, digits)) > 1e-6) digits++;
    return function (v) { return v.toFixed(digits); };
  }

  function render(container, opts) {
    container._chartOpts = opts;
    if (!container._chartObserved && typeof ResizeObserver !== "undefined") {
      container._chartObserved = true;
      var lastWidth = 0;
      new ResizeObserver(function () {
        var w = container.clientWidth;
        if (Math.abs(w - lastWidth) > 1 && container._chartOpts) {
          lastWidth = w;
          draw(container, container._chartOpts);
        }
      }).observe(container);
    }
    draw(container, opts);
  }

  function draw(container, opts) {
    container.innerHTML = "";
    container.classList.add("chart");
    var width = Math.max(container.clientWidth, 240);
    var height = opts.height || 240;
    var hasTop = (opts.markers && opts.markers.length) || (opts.band && opts.band.label);
    var m = { top: hasTop ? 26 : 12, right: 16, bottom: opts.x.label ? 40 : 24, left: opts.y.label ? 62 : 46 };
    var w = width - m.left - m.right;
    var h = height - m.top - m.bottom;

    var xe = extent(opts, "x");
    var x0 = opts.x.min !== undefined ? opts.x.min : xe[0];
    var x1 = opts.x.max !== undefined ? opts.x.max : xe[1];
    if (x1 === x0) { x0 -= 0.5; x1 += 0.5; }
    var ye = extent(opts, "y");
    var y0 = opts.y.min !== undefined ? opts.y.min : ye[0];
    var y1 = opts.y.max !== undefined ? opts.y.max : ye[1];
    if (opts.y.zero) { y0 = Math.min(0, y0); y1 = Math.max(0, y1); }
    if (y1 === y0) { y1 = y0 + 1; }
    var pad = (y1 - y0) * 0.06;
    if (opts.y.min === undefined && !(opts.y.zero && y0 === 0)) y0 -= pad;
    if (opts.y.max === undefined) y1 += pad;

    var sx = function (v) { return m.left + ((v - x0) / (x1 - x0)) * w; };
    var sy = function (v) { return m.top + h - ((v - y0) / (y1 - y0)) * h; };

    var svg = el("svg", { width: width, height: height, viewBox: "0 0 " + width + " " + height, role: "img", "aria-label": opts.ariaLabel || "" }, container);
    var clipId = "clip" + Math.random().toString(36).slice(2);
    var clip = el("clipPath", { id: clipId }, el("defs", {}, svg));
    el("rect", { x: m.left, y: m.top, width: w, height: h }, clip);

    if (opts.band) {
      var bx0 = sx(Math.max(opts.band.x0, x0)), bx1 = sx(Math.min(opts.band.x1, x1));
      el("rect", { x: bx0, y: m.top, width: Math.max(0, bx1 - bx0), height: h, class: "chart-band" }, svg);
      if (opts.band.label) {
        el("text", { x: (bx0 + bx1) / 2, y: m.top - 8, class: "chart-band-label", "text-anchor": "middle" }, svg).textContent = opts.band.label;
      }
    }

    var yt = ticks(y0, y1, Math.max(3, Math.round(h / 48)));
    var yfmt = opts.y.format || defaultFormat(yt.length > 1 ? yt[1] - yt[0] : 1);
    yt.forEach(function (v) {
      el("line", { x1: m.left, x2: m.left + w, y1: sy(v), y2: sy(v), class: "chart-grid" }, svg);
      el("text", { x: m.left - 8, y: sy(v), class: "chart-tick", "text-anchor": "end", "dominant-baseline": "middle" }, svg).textContent = yfmt(v);
    });
    var xt = opts.x.ticks || ticks(x0, x1, Math.max(2, Math.round(w / 90)));
    var xfmt = opts.x.format || defaultFormat(xt.length > 1 ? xt[1] - xt[0] : 1);
    xt.forEach(function (v) {
      if (v < x0 - 1e-9 || v > x1 + 1e-9) return;
      el("line", { x1: sx(v), x2: sx(v), y1: m.top + h, y2: m.top + h + 4, class: "chart-axis" }, svg);
      el("text", { x: sx(v), y: m.top + h + 16, class: "chart-tick", "text-anchor": "middle" }, svg).textContent = xfmt(v);
    });
    el("line", { x1: m.left, x2: m.left + w, y1: m.top + h, y2: m.top + h, class: "chart-axis" }, svg);

    if (opts.x.label) {
      el("text", { x: m.left + w / 2, y: height - 6, class: "chart-label", "text-anchor": "middle" }, svg).textContent = opts.x.label;
    }
    if (opts.y.label) {
      el("text", { x: 14, y: m.top + h / 2, class: "chart-label", "text-anchor": "middle", transform: "rotate(-90 14 " + (m.top + h / 2) + ")" }, svg).textContent = opts.y.label;
    }

    (opts.thresholds || []).forEach(function (t) {
      if (t.y < y0 || t.y > y1) return;
      el("line", { x1: m.left, x2: m.left + w, y1: sy(t.y), y2: sy(t.y), class: "chart-threshold", style: "stroke:" + (t.color || "var(--warning)") }, svg);
      if (t.label) {
        el("text", { x: m.left + w - 4, y: sy(t.y) - 4, class: "chart-threshold-label", "text-anchor": "end", style: "fill:" + (t.labelColor || t.color || "var(--warning)") }, svg).textContent = t.label;
      }
    });

    (opts.markers || []).forEach(function (mk) {
      if (mk.x < x0 || mk.x > x1) return;
      el("line", { x1: sx(mk.x), x2: sx(mk.x), y1: m.top, y2: m.top + h, class: "chart-marker", style: "stroke:" + (mk.color || "var(--muted)") }, svg);
      el("text", { x: sx(mk.x), y: m.top - 8, class: "chart-marker-label", "text-anchor": "middle", style: "fill:" + (mk.color || "var(--muted)") }, svg).textContent = mk.label;
    });

    var plot = el("g", { "clip-path": "url(#" + clipId + ")" }, svg);
    opts.series.forEach(function (s) {
      var color = s.color || "var(--text)";
      if (s.line !== false) {
        var d = "", pen = false;
        for (var i = 0; i < s.x.length; i++) {
          var v = s.y[i];
          if (v === null || !isFinite(v)) { pen = false; continue; }
          d += (pen ? "L" : "M") + sx(s.x[i]).toFixed(1) + "," + sy(v).toFixed(1);
          pen = true;
        }
        if (s.fill && d) {
          var area = d + "L" + sx(s.x[s.x.length - 1]).toFixed(1) + "," + sy(Math.max(y0, 0)).toFixed(1) +
            "L" + sx(s.x[0]).toFixed(1) + "," + sy(Math.max(y0, 0)).toFixed(1) + "Z";
          el("path", { d: area, style: "fill:" + color, class: "chart-fill" }, plot);
        }
        el("path", {
          d: d, fill: "none",
          style: "stroke:" + color + ";stroke-width:" + (s.width || 1.5) + (s.dash ? ";stroke-dasharray:" + s.dash : ""),
          "stroke-linejoin": "round", "stroke-linecap": "round"
        }, plot);
      }
      if (s.points) {
        s.x.forEach(function (xv, i) {
          if (s.y[i] === null || !isFinite(s.y[i])) return;
          var hollow = s.hollow ? s.hollow[i] : false;
          el("circle", { cx: sx(xv), cy: sy(s.y[i]), r: s.radius || 3.5, class: "chart-point", style: "stroke:" + color + ";fill:" + (hollow ? "var(--surface)" : color) }, svg);
        });
      }
    });

    if (opts.hover !== false) addHover(container, svg, opts, { m: m, w: w, h: h, sx: sx, sy: sy, x0: x0, x1: x1 });
  }

  function nearestIndex(xs, v) {
    var best = 0, d = Infinity;
    for (var i = 0; i < xs.length; i++) {
      var dd = Math.abs(xs[i] - v);
      if (dd < d) { d = dd; best = i; }
    }
    return best;
  }

  function addHover(container, svg, opts, g) {
    var series = opts.series.filter(function (s) { return s.label && !s.noHover; });
    if (!series.length) return;
    var line = el("line", { y1: g.m.top, y2: g.m.top + g.h, class: "chart-cursor", visibility: "hidden" }, svg);
    var dots = series.map(function (s) {
      return el("circle", { r: 3.5, class: "chart-cursor-dot", style: "fill:" + (s.color || "var(--text)"), visibility: "hidden" }, svg);
    });
    var tip = document.createElement("div");
    tip.className = "chart-tip";
    container.appendChild(tip);
    var overlay = el("rect", { x: g.m.left, y: g.m.top, width: g.w, height: g.h, fill: "transparent" }, svg);
    var xfmt = opts.x.hoverFormat || opts.x.format || function (v) { return v.toFixed(1); };

    function move(evt) {
      var rect = svg.getBoundingClientRect();
      var px = evt.clientX - rect.left;
      var xv = g.x0 + ((px - g.m.left) / g.w) * (g.x1 - g.x0);
      var ref = series[0];
      var i = nearestIndex(ref.x, xv);
      var xr = ref.x[i];
      line.setAttribute("x1", g.sx(xr));
      line.setAttribute("x2", g.sx(xr));
      line.setAttribute("visibility", "visible");
      var rows = [];
      series.forEach(function (s, k) {
        var j = nearestIndex(s.x, xr);
        var v = s.y[j];
        if (v === null || !isFinite(v) || Math.abs(s.x[j] - xr) > (g.x1 - g.x0) / 50) {
          dots[k].setAttribute("visibility", "hidden");
          return;
        }
        dots[k].setAttribute("cx", g.sx(s.x[j]));
        dots[k].setAttribute("cy", g.sy(v));
        dots[k].setAttribute("visibility", "visible");
        rows.push('<div class="chart-tip-row"><span class="swatch" style="background:' + (s.color || "var(--text)") + '"></span>' +
          s.label + '<span class="chart-tip-value">' + (s.format || opts.y.hoverFormat || opts.y.format || String)(v) + "</span></div>");
      });
      tip.innerHTML = '<div class="chart-tip-head">' + xfmt(xr) + "</div>" + rows.join("");
      tip.style.display = "block";
      var left = g.sx(xr) + 12;
      if (left + tip.offsetWidth > container.clientWidth) left = g.sx(xr) - tip.offsetWidth - 12;
      tip.style.left = left + "px";
      tip.style.top = g.m.top + "px";
    }
    function leave() {
      line.setAttribute("visibility", "hidden");
      dots.forEach(function (d) { d.setAttribute("visibility", "hidden"); });
      tip.style.display = "none";
    }
    overlay.addEventListener("mousemove", move);
    overlay.addEventListener("mouseleave", leave);
  }

  root.MDChart = { render: render };
})(this);
