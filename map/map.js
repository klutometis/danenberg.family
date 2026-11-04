/* danenberg.family — the family map (version 2: docs/design/2026-11-01-family-map-v2.md).
 *
 * One people-centric map in two frames: the world, and an inset of Latvia, where half the family
 * sits within 150 km of Vidzeme. With nothing selected the world shows *corridors*: one band per
 * pair of countries (US: states) that people moved between, wider for more people. Click a person
 * for their whole path; click where several overlap for a list; Esc clears. One year slider, played
 * by events rather than by the calendar.
 *
 * Geography is drawn once and transformed; everything else is drawn in screen pixels each frame, so
 * markers keep their size at every zoom and hit-testing is done here, not by SVG elements.
 * Data: map.json (tools/famtree/www.py, map_json). Nothing is fetched from anywhere else.
 */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  if (!$("world") || typeof d3 === "undefined") return;

  var LABEL = {
    birth: "born", baptism: "baptised", death: "died", burial: "buried", cremation: "cremated",
    marriage: "married", divorce: "divorced", residence: "lived", census: "recorded",
    immigration: "arrived", emigration: "left", military: "served", education: "studied",
    occupation: "worked", naturalization: "naturalised", origin: "came from", other: "recorded", home: "lived"
  };
  var MARK = {
    farm: "M-4,4 L-4,-1 L0,-4.5 L4,-1 L4,4 Z",
    estate: "M-4,4 L-4,-1 L0,-4.5 L4,-1 L4,4 Z",
    church: "M-1.2,4 L-1.2,-1 L-4,-1 L-4,-2.4 L-1.2,-2.4 L-1.2,-4.6 L1.2,-4.6 L1.2,-2.4 L4,-2.4 L4,-1 L1.2,-1 L1.2,4 Z",
    parish: "M-1.2,4 L-1.2,-1 L-4,-1 L-4,-2.4 L-1.2,-2.4 L-1.2,-4.6 L1.2,-4.6 L1.2,-2.4 L4,-2.4 L4,-1 L1.2,-1 L1.2,4 Z",
    cemetery: "M-1.1,4.5 L-1.1,-1.4 L-3.6,-1.4 L-3.6,-2.8 L-1.1,-2.8 L-1.1,-4.5 L1.1,-4.5 L1.1,-2.8 L3.6,-2.8 L3.6,-1.4 L1.1,-1.4 L1.1,4.5 Z",
    hospital: "M-1.6,4 L-1.6,1.6 L-4,1.6 L-4,-1.6 L-1.6,-1.6 L-1.6,-4 L1.6,-4 L1.6,-1.6 L4,-1.6 L4,1.6 L1.6,1.6 L1.6,4 Z",
    camp: "M0,-4.5 L4.5,4 L-4.5,4 Z",
    port: "M0,-4.5 L0,3 M-3.4,-2.2 L3.4,-2.2 M-3.6,1.4 A3.6,3.6 0 0 0 3.6,1.4",
    school: "M-4.6,-1.6 L0,-4 L4.6,-1.6 L0,0.8 Z M3.2,-0.8 L3.2,2.6",
    university: "M-4.6,-1.6 L0,-4 L4.6,-1.6 L0,0.8 Z M3.2,-0.8 L3.2,2.6",
    ship: "M-4.4,1.6 L4.4,1.6 L2.8,4 L-2.8,4 Z M0,1.6 L0,-4.4 M0,-4.4 L3,-2.4 L0,-1 Z"
  };
  var DOT = [5.5, 6.5, 7.5], SEL = 3.5, MARKPX = [10, 12, 14];
  var LATVIA = [[20.9, 55.65], [28.3, 58.1]];          // the inset's extent, and what the world aggregates
  var MONTH = ["January", "February", "March", "April", "May", "June", "July", "August",
               "September", "October", "November", "December"];
  function tier(k) { return k < 3 ? 0 : k < 12 ? 1 : 2; }
  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function inBox(b, lon, lat) {
    return lon >= b[0][0] && lon <= b[1][0] && lat >= b[0][1] && lat <= b[1][1];
  }
  function inLatvia(lon, lat) { return inBox(LATVIA, lon, lat); }

  // the data carries the same build stamp as this script, so a rebuild is never hidden by a cache
  var V = ((document.currentScript && document.currentScript.src) || "").split("?")[1] || "";
  Promise.all([d3.json("map.json?" + V), d3.json("basemap.json?" + V)])
    .then(function (r) { start(r[0], r[1]); })
    .catch(function (e) {
      var l = $("maploading") || $("mapnote");
      if (l) l.textContent = "The map could not load (" + e + "). The drawn maps below still work.";
      if (window.console) console.error(e);
    });

  function start(D, B) {
    if ($("maploading")) $("maploading").remove();
    var P = D.places, Q = D.people;

    // ------------------------------------------------------------ people through time
    var seats = {};                           // a fixed seat per person per place: nobody jumps
    Q.forEach(function (q, i) {
      q.i = i; q.kids = [];
      q.path = q.stays.filter(function (st) { return st.t0 != null; });
      q.gone = q.died != null ? q.died : q.until;
      var first = q.path.length ? q.path[0].t0 : null;
      q.start = q.born != null ? (first != null ? Math.min(q.born, first) : q.born) : first;
      q.stays.forEach(function (st) {
        var m = seats[st.p] = seats[st.p] || {};
        if (!(i in m)) m[i] = Object.keys(m).length;
      });
    });
    Q.forEach(function (q) { q.parents.forEach(function (pi) { Q[pi].kids.push(q.i); }); });
    Q.forEach(function (q) {                  // partners: the other parent of a shared child
      var s = {};
      q.kids.forEach(function (k) { Q[k].parents.forEach(function (pi) { if (pi !== q.i) s[pi] = 1; }); });
      q.partners = Object.keys(s).map(Number);
    });
    var lead = {};                            // what each place is mostly: its dominant branch
    P.forEach(function (pl, pi) {
      var c = {};
      Q.forEach(function (q) { q.stays.forEach(function (st) { if (st.p === pi) c[q.branch] = (c[q.branch] || 0) + 1; }); });
      lead[pi] = Object.keys(c).sort(function (a, b) { return c[b] - c[a]; })[0];
      pl.inLatvia = inLatvia(pl.lon, pl.lat);
    });

    var INK = {};
    // The tree's branch colours are pale backgrounds for text; darkening them gives mud. On the map
    // keep each hue and give it body: saturated, at a lightness legible on parchment and on sea.
    function ink(b, amt) {
      var key = b + "/" + amt;
      if (!(key in INK)) {
        var c = d3.hsl(((D.branches[b] || {}).color) || "#c9b79c");
        if (isNaN(c.h)) { c.h = 35; c.s = 0.15; }
        c.s = Math.max(c.s, 0.62);
        c.l = 0.5 - 0.06 * amt;
        INK[key] = c.formatHex();
      }
      return INK[key];
    }

    var state = { year: null, lines: new Set(Object.keys(D.branches)), sel: null, playing: false };

    // Where is person q in `year` (null = All years: their last known place)?
    function where(q, year) {
      if (!q.stays.length) return null;
      if (year == null) {
        var last = q.path.length ? q.path[q.path.length - 1] : q.stays[0];
        return { p: last.p, st: last, fresh: 1, gone: !q.living };
      }
      if (q.start == null || year + 0.999 < q.start) return null;
      if (q.gone != null && year > q.gone + 0.6) return null;
      var cur = null, next = null;
      for (var k = 0; k < q.path.length; k++) {
        if (q.path[k].t0 <= year + 0.999) cur = q.path[k]; else { next = q.path[k]; break; }
      }
      if (!cur) return null;
      // Past the end of what the evidence says (an itinerary's gap, or between two records of someone
      // not yet reviewed): whereabouts unknown. Drawn hollow at the last known place, never moved on.
      if (cur.end != null && year > cur.end + 0.001 && (!next || next.t0 > year + 0.999))
        return { p: cur.p, st: cur, unknown: 1, fresh: 0.45 };
      var out = { p: cur.p, st: cur, fresh: cur.why === "home" ? 1 : Math.max(0.25, 1 - (year - (cur.t1 || cur.t0)) / 15) };
      if (next && next.p !== cur.p && (cur.end == null || cur.end >= next.t0 - 1.2)) {   // slide on to an adjoining home
        var span = Math.max(0.25, Math.min(1.2, next.t0 - (cur.t1 || cur.t0)));
        var t = (year - (next.t0 - span)) / span;
        if (t > 0 && t < 1) {
          t = t * t * (3 - 2 * t);
          var a = P[cur.p], b = P[next.p];
          out.ll = d3.geoInterpolate([a.lon, a.lat], [b.lon, b.lat])(t);
          out.moving = t;
        }
      }
      return out;
    }

    // ------------------------------------------------------------ the two frames
    // A View is the world frame or a lens. A lens shows only what is inside its `box` ([[lon0, lat0],
    // [lon1, lat1]]): the Latvia inset is a lens on Latvia, and double-clicking the world opens one
    // anywhere (an ad-hoc lens). The world shows the whole earth and can zoom out to it.
    function View(svgId, fit, isWorld, box) {
      var v = this;
      v.svg = d3.select("#" + svgId);
      v.isWorld = isWorld;
      v.box = box || null;
      v.proj = d3.geoMercator();
      v.path = d3.geoPath(v.proj);
      v.t = d3.zoomIdentity;
      v.base = v.svg.append("g").attr("class", "base");
      v.over = v.svg.append("g").attr("class", "over");
      ["corr", "trail", "marks", "dots", "labels", "badge"].forEach(function (n) {
        v[n] = v.over.append("g").attr("class", n);
      });
      v.fit = fit;
      v.items = { dots: [], marks: [], corr: [], badge: null };
      v.zoom = d3.zoom().scaleExtent([1, isWorld ? 120 : 40])
        .on("zoom", function (ev) {
          v.t = ev.transform; v.base.attr("transform", v.t); render(v);
          if (v.isWorld && ev.sourceEvent) onUserZoom();     // your own pan or zoom: follow stops
        });
      v.svg.call(v.zoom);
      if (isWorld) v.svg.on("dblclick.zoom", null);   // the world's double-click opens a lens (below)
    }
    View.prototype.resize = function () {
      var r = this.svg.node().getBoundingClientRect();
      var keep = this.W ? this.proj.invert(this.t.invert([this.W / 2, this.H / 2])) : null;
      this.W = Math.max(240, r.width); this.H = Math.max(160, r.height);
      this.svg.attr("viewBox", "0 0 " + this.W + " " + this.H);
      this.proj.fitExtent([[18, 18], [this.W - 18, this.H - 18]], this.fit());
      if (this.isWorld) {                     // zoom out as far as the whole earth, no further
        var a = this.proj([-180, 84]), b = this.proj([180, -58]);
        this.minK = Math.min(1, 0.96 * Math.min(this.W / (b[0] - a[0]), this.H / (b[1] - a[1])));
        this.zoom.scaleExtent([this.minK, 120]);
      }
      var path = this.path;
      var multi = function (rings) {
        return { type: "MultiPolygon", coordinates: rings.map(function (r) {
          var g = { type: "Polygon", coordinates: [r] };
          return d3.geoArea(g) > 2 * Math.PI ? [r.slice().reverse()] : [r];   // fix reversed rings
        }) };
      };
      this.base.selectAll("*").remove();
      this.base.append("path").attr("class", "land").attr("d", path(multi(B.land)));
      this.base.append("path").attr("class", "lakes").attr("d", path(multi(B.lakes)));
      this.base.append("path").attr("class", "borders").attr("d", path({ type: "MultiLineString", coordinates: B.borders }));
      this.base.attr("transform", this.t);
      if (keep && Math.abs(this.t.k - 1) > 0.001) {   // zoomed in or out: keep the same spot in the middle
        var c = this.proj(keep), k = this.t.k;
        this.svg.call(this.zoom.transform, d3.zoomIdentity.translate(this.W / 2 - k * c[0], this.H / 2 - k * c[1]).scale(k));
      }
    };
    View.prototype.xy = function (lon, lat) { return this.t.apply(this.proj([lon, lat])); };

    function quantileFit(pts, lo, hi) {
      var xs = pts.map(function (p) { return p[0]; }).sort(d3.ascending);
      var ys = pts.map(function (p) { return p[1]; }).sort(d3.ascending);
      var q = function (a, f) { return a[Math.round((a.length - 1) * f)]; };
      return { type: "MultiPoint", coordinates: [[q(xs, lo), q(ys, lo)], [q(xs, hi), q(ys, hi)]] };
    }
    var recorded = P.filter(function (p) { return p.n; });
    var world = new View("world", function () {
      return quantileFit(recorded.map(function (p) { return [p.lon, p.lat]; }), 0.02, 0.98);
    }, true);
    // ------------------------------------------------------------ lenses (docked magnifiers)
    // A lens is a magnified view of a box on the earth, docked in a slot along the bottom of the map:
    // right, left, centre (one slot on a phone, two on a laptop, three on a wide screen). A slot holds a
    // lens or nothing: {key, box, title, pinned, score, since}. Which lenses: scheduleLenses().
    var SLOT_IDS = ["inset", "lens", "lens3"];          // right, left, centre
    var SLOT_CLS = ["slot-r", "slot-l", "slot-c"];
    var slotEls = SLOT_IDS.map(function (id, k) {
      var el;
      if (k === 0) {                          // the right slot is the page's old Latvia inset element
        el = $("inset").parentNode;
        el.querySelector(".insettitle").id = "slottitle0";
      } else {
        el = document.createElement("div");
        el.className = "inset";
        el.innerHTML = '<div class="insettitle" id="slottitle' + k + '"></div><svg id="' + id + '" role="img"></svg>';
        $("mapwrap").appendChild(el);
      }
      el.classList.add(SLOT_CLS[k]);
      el.hidden = true;
      var x = document.createElement("button");
      x.type = "button"; x.className = "lensx"; x.title = "Close the lens"; x.setAttribute("aria-label", "Close the lens");
      x.textContent = "×";
      x.addEventListener("click", function () { closeSlot(k); });
      el.appendChild(x);
      return el;
    });
    var slotViews = SLOT_IDS.map(function (id) {
      var v = new View(id, function () { return { type: "MultiPoint", coordinates: v.box }; }, false, LATVIA);
      v.hidden = true;
      return v;
    });
    var slots = [null, null, null];
    var views = [world].concat(slotViews);

    var ACTIVE = {};                          // people with an event in the current year (set by setYear)
    var LINE = {};                            // Peter's direct line: him and his ancestors
    (function () {
      var me = Q.filter(function (q) { return q.id === "I0027"; })[0];
      var todo = me ? [me.i] : [];
      while (todo.length) { var i = todo.pop(); if (LINE[i]) continue; LINE[i] = 1; todo = todo.concat(Q[i].parents); }
    })();

    // ------------------------------------------------------------ highlight set
    function highlighted() {
      var s = state.sel;
      if (!s || s.kind !== "person") return null;
      var h = {}, q = Q[s.i];
      h[q.i] = 2;
      q.parents.concat(q.kids, q.partners).forEach(function (k) { h[k] = 1; });
      return h;
    }

    // ------------------------------------------------------------ drawing one frame
    function render(v) {
      if (v.hidden) return;
      var k = v.t.k, tr = tier(k), R = DOT[tr], H = highlighted();
      var year = state.year == null ? null : state.year;
      // In the world frame, what an open lens shows is aggregated into its box and a count, until the
      // box is drawn wider than the lens could show it (then the lens adds nothing and the dots return).
      var cboxes = [];
      if (v.isWorld) slots.forEach(function (sl, k) {
        if (!sl || slotViews[k].hidden) return;
        var b0 = v.xy(sl.box[0][0], sl.box[1][1]), b1 = v.xy(sl.box[1][0], sl.box[0][1]);
        cboxes.push({ k: k, sl: sl, x0: b0[0], y0: b0[1], x1: b1[0], y1: b1[1], n: 0,
                      collapse: (b1[0] - b0[0]) < 0.8 * (slotEls[k].clientWidth || 360) });
      });
      var inC = function (lon, lat) {
        for (var c = 0; c < cboxes.length; c++) if (cboxes[c].collapse && inBox(cboxes[c].sl.box, lon, lat)) return cboxes[c];
        return null;
      };

      // place marks
      var marks = recorded.filter(function (p) { return v.isWorld ? !inC(p.lon, p.lat) : inBox(v.box, p.lon, p.lat); })
        .map(function (p) { var xy = v.xy(p.lon, p.lat); return { p: p, pi: P.indexOf(p), x: xy[0], y: xy[1] }; })
        .filter(function (m) { return m.x > -20 && m.y > -20 && m.x < v.W + 20 && m.y < v.H + 20; });
      var MS = MARKPX[tr] / 10;
      v.marks.selectAll("path").data(marks, function (m) { return m.p.id; }).join("path")
        .attr("class", function (m) { return "mark t-" + m.p.type + (m.p.kind === "region" ? " region" : "") +
          (state.sel && state.sel.kind === "place" && state.sel.i === m.pi ? " on" : ""); })
        .attr("d", function (m) { return MARK[m.p.type] || "M-2.6,0 a2.6,2.6 0 1,0 5.2,0 a2.6,2.6 0 1,0 -5.2,0"; })
        .attr("transform", function (m) { return "translate(" + m.x + "," + m.y + ") scale(" + MS + ")"; });
      v.items.marks = marks;

      // people
      var dots = [], hidden = 0, counted = 0;
      Q.forEach(function (q) {
        if (!state.lines.has(q.branch)) return;
        var w = where(q, year);
        if (!w) return;
        var ll = w.ll || [P[w.p].lon, P[w.p].lat];
        var cb = v.isWorld ? inC(ll[0], ll[1]) : null;
        if (v.isWorld ? cb : !inBox(v.box, ll[0], ll[1])) {
          if (cb) { cb.n++; hidden++; }
          return;
        }
        counted++;
        var xy = v.xy(ll[0], ll[1]);
        if (!w.moving) {                       // a fixed seat in a spiral around the place
          var n = (seats[w.p] || {})[q.i] || 0;
          if (n) { var a = n * 2.39996323, rr = R * 1.3 * Math.sqrt(n); xy = [xy[0] + Math.cos(a) * rr, xy[1] + Math.sin(a) * rr]; }
        }
        if (xy[0] < -30 || xy[1] < -30 || xy[0] > v.W + 30 || xy[1] > v.H + 30) return;
        dots.push({ q: q, w: w, x: xy[0], y: xy[1], hl: H ? (H[q.i] || 0) : -1 });
      });
      dots.sort(function (a, b) { return a.hl - b.hl; });          // the selected on top
      v.dots.selectAll("circle").data(dots, function (d) { return d.q.id; }).join("circle")
        .attr("cx", function (d) { return d.x; }).attr("cy", function (d) { return d.y; })
        .attr("r", function (d) { return d.hl === 2 ? R + SEL : R; })
        .attr("class", function (d) {
          return "dot" + (d.w.gone ? " gone" : "") + (d.w.unknown ? " unknown" : "") +
            (d.hl === 2 ? " sel" : d.hl === 1 ? " kin" : d.hl === 0 ? " dim" : "");
        })
        .style("fill", function (d) { return d.w.unknown ? "none" : d.w.gone ? "#fffdf8" : ink(d.q.branch, 1.25); })
        .style("stroke", function (d) { return d.w.gone || d.w.unknown ? ink(d.q.branch, 1.25) : "#fffdf8"; })
        .style("opacity", function (d) { return d.hl === 0 ? 0.22 : d.w.fresh; });
      v.items.dots = dots;

      // labels: the selected and their kin, then places, greedily so they never overlap
      var taken = [];
      function free(x, y, w, h) {
        for (var i = 0; i < taken.length; i++) {
          var b = taken[i];
          if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]) return false;
        }
        taken.push([x, y, w, h]); return true;
      }
      var labs = [];
      // Who gets a name, in priority order: the selected person and their kin; then (during play or at
      // a year) whoever was born, moved or died that year; then Peter's direct line; then the people
      // with the most places on record. Placement is greedy, so the order decides who wins a crowd.
      var rank = function (d) {
        return d.hl >= 1 ? 1000 + d.hl : ACTIVE[d.q.i] ? 500 : LINE[d.q.i] ? 300 : d.q.stays.length;
      };
      dots.filter(function (d) {
        if (H) return d.hl >= 1;
        if (state.year != null) return ACTIVE[d.q.i] || tr === 2 || (LINE[d.q.i] && counted <= 40);
        return LINE[d.q.i] || counted <= 12 || tr === 2;
      })
        .sort(function (a, b) { return rank(b) - rank(a); })
        .forEach(function (d) {
          var t = d.q.name, w = t.length * 6.6, x = d.x + R + 4, y = d.y - 7;
          if (free(x, y, w, 15)) labs.push({ id: "q" + d.q.id, x: x, y: y + 11, t: t, cls: "lab person" + (d.hl === 2 ? " sel" : "") });
        });
      var limit = v.isWorld ? [7, 18, 60][tr] : [12, 26, 80][tr];
      marks.slice().sort(function (a, b) { return (b.p.n || 0) - (a.p.n || 0); }).slice(0, limit).forEach(function (m) {
        var t = m.p.short, w = t.length * 6.2, x = m.x - w / 2, y = m.y + MARKPX[tr] * 0.55;
        if (free(x, y, w, 14)) labs.push({ id: "p" + m.p.id, x: m.x, y: y + 11, t: t, cls: "lab place" });
      });
      v.labels.selectAll("text").data(labs, function (l) { return l.id; }).join("text")
        .attr("class", function (l) { return l.cls; })
        .attr("x", function (l) { return l.x; }).attr("y", function (l) { return l.y; })
        .text(function (l) { return l.t; });

      // the selected person's path, every leg along the great circle
      var legs = [];
      if (H) {
        var q = Q[state.sel.i], stops = q.path;
        for (var i = 1; i < stops.length; i++) {
          if (stops[i].p === stops[i - 1].p) continue;
          var a = P[stops[i - 1].p], b = P[stops[i].p];
          var future = year != null && stops[i].t0 > year + 0.999;
          var pts = d3.range(0, 1.0001, 1 / 32).map(d3.geoInterpolate([a.lon, a.lat], [b.lon, b.lat]))
            .filter(function (ll) { return v.isWorld ? true : inBox(v.box, ll[0], ll[1]); })
            .map(function (ll) { return v.xy(ll[0], ll[1]); });
          if (pts.length > 1) legs.push({ id: i, d: d3.line()(pts), future: future });
        }
      }
      v.trail.selectAll("path").data(legs, function (l) { return l.id; }).join("path")
        .attr("class", function (l) { return "leg" + (l.future ? " future" : ""); })
        .attr("d", function (l) { return l.d; })
        .style("stroke", H ? ink(Q[state.sel.i].branch, 1.6) : null);

      // corridors (world only): the overview, when no person is selected
      var cs = [];
      if (v.isWorld && !H) {
        D.corridors.forEach(function (c, ci) {
          var mv = c.moves.filter(function (m) {
            return state.lines.has(Q[m[0]].branch) && (year == null || m[3] <= year + 0.999);
          });
          var ppl = {};
          mv.forEach(function (m) { ppl[m[0]] = 1; });
          var n = Object.keys(ppl).length;
          if (!n) return;
          var pts = d3.range(0, 1.0001, 1 / 40).map(d3.geoInterpolate(c.from, c.to))
            .map(function (ll) { return v.xy(ll[0], ll[1]); });
          var br = {};
          mv.forEach(function (m) { var b = Q[m[0]].branch; br[b] = (br[b] || 0) + 1; });
          var lead = Object.keys(br).sort(function (a, b) { return br[b] - br[a]; })[0];
          var mid = pts[Math.round(pts.length * 0.62)], pre = pts[Math.round(pts.length * 0.62) - 2];
          cs.push({ ci: ci, c: c, n: n, pts: pts, d: d3.line()(pts), w: Math.min(14, 1.5 + 1.8 * n),
                    color: ink(lead, 1.4), mid: mid, ang: Math.atan2(mid[1] - pre[1], mid[0] - pre[0]) * 180 / Math.PI,
                    on: state.sel && state.sel.kind === "corridor" && state.sel.i === ci });
        });
      }
      cs.sort(function (a, b) { return b.n - a.n; });
      var cg = v.corr.selectAll("g.corr").data(cs, function (c) { return c.ci; }).join(function (en) {
        var g = en.append("g").attr("class", "corr");
        g.append("path").attr("class", "band");
        g.append("path").attr("class", "arrow");
        return g;
      });
      cg.classed("on", function (c) { return c.on; });
      cg.select("path.band").attr("d", function (c) { return c.d; })
        .style("stroke", function (c) { return c.color; }).style("stroke-width", function (c) { return c.w; });
      cg.select("path.arrow").attr("d", function (c) { var s = 3 + c.w * 0.55; return "M" + (-s) + "," + (-s) + " L" + s + ",0 L" + (-s) + "," + s + " Z"; })
        .attr("transform", function (c) { return "translate(" + c.mid[0] + "," + c.mid[1] + ") rotate(" + c.ang + ")"; })
        .style("fill", function (c) { return c.color; });
      v.items.corr = cs;

      // each open lens as a dashed box in the world frame, with its count when it aggregates; and, with
      // automatic lenses, the crowds that have no lens open, as faint boxes you can click to open one
      var badge = [];
      var svgR = v.isWorld ? v.svg.node().getBoundingClientRect() : null, sc = svgR ? v.W / svgR.width : 1;
      var leaders = [];
      cboxes.forEach(function (c) {
        badge.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, cls: "lv",
                     text: c.collapse ? c.sl.title + ": " + c.n + (c.n === 1 ? " person" : " people") : c.sl.title });
        // a leader from the box to the lens: from the box's corner nearest the lens to the lens's top edge
        var r = slotEls[c.k].getBoundingClientRect();
        var lx0 = (r.left - svgR.left) * sc, lx1 = (r.right - svgR.left) * sc, ly = (r.top - svgR.top) * sc;
        var bx = Math.max(c.x0, Math.min(c.x1, (lx0 + lx1) / 2)), by = c.y1;
        var tx = Math.max(lx0 + 12, Math.min(lx1 - 12, bx));
        if (by < ly - 4) leaders.push({ x1: bx, y1: by, x2: tx, y2: ly });
      });
      var ld = v.badge.selectAll("line.leader").data(leaders).join("line").attr("class", "leader")
        .attr("x1", function (l) { return l.x1; }).attr("y1", function (l) { return l.y1; })
        .attr("x2", function (l) { return l.x2; }).attr("y2", function (l) { return l.y2; });
      if (v.isWorld && AUTO) (lensCands || []).forEach(function (c) {
        if (slots.some(function (sl) { return sl && sl.key === c.key; })) return;
        var b0 = v.xy(c.box[0][0], c.box[1][1]), b1 = v.xy(c.box[1][0], c.box[0][1]);
        badge.push({ x0: b0[0], y0: b0[1], x1: b1[0], y1: b1[1], cls: "lv cand", cand: c, text: c.title + " · " + c.people.length });
      });
      var bg = v.badge.selectAll("g.lv").data(badge).join(function (en) {
        var g = en.append("g");
        g.append("rect"); g.append("text");
        return g;
      });
      bg.attr("class", function (b) { return b.cls; });
      bg.select("rect").attr("x", function (b) { return b.x0; }).attr("y", function (b) { return b.y0; })
        .attr("width", function (b) { return Math.max(6, b.x1 - b.x0); }).attr("height", function (b) { return Math.max(6, b.y1 - b.y0); });
      bg.select("text")                                  // beside the box, on whichever side has room
        .attr("text-anchor", function (b) { return b.x1 + 230 > v.W ? "end" : "start"; })
        .attr("x", function (b) { return b.x1 + 230 > v.W ? b.x0 - 6 : b.x1 + 6; }).attr("y", function (b) { return b.y0 - 4; })
        .text(function (b) { return b.text; });
      bg.on("click", function (ev, b) {
        if (!b.cand) return;
        ev.stopPropagation();
        pinLens({ key: b.cand.key, box: b.cand.box, title: null, score: b.cand.score });
      });
      v.items.badge = badge[0] || null;
      v.counted = counted;
    }

    function renderAll() {
      views.forEach(function (v) { if (v !== world) render(v); });
      slotTitles();                           // from what the lenses show, before the world names their boxes
      render(world);                          // after the lenses: the world's lens box shows their count
      var n = 0;
      Q.forEach(function (q) { if (state.lines.has(q.branch) && where(q, state.year)) n++; });
      $("mapcount").textContent = n + " " + (n === 1 ? "person" : "people") +
        (state.year == null ? ", each at the last place on record" : " in " + Math.floor(state.year));
    }

    // ------------------------------------------------------------ hit-testing
    function hits(v, x, y) {
      var R = DOT[tier(v.t.k)];
      var ds = v.items.dots.filter(function (d) { return Math.hypot(d.x - x, d.y - y) <= R + 5; });
      if (ds.length) return { kind: "people", list: ds.map(function (d) { return d.q.i; }) };
      var ms = v.items.marks.filter(function (m) { return Math.hypot(m.x - x, m.y - y) <= MARKPX[tier(v.t.k)] * 0.6 + 3; });
      if (ms.length) return { kind: "place", i: ms[0].pi };
      for (var i = 0; i < v.items.corr.length; i++) {
        var c = v.items.corr[i], pts = c.pts;
        for (var j = 1; j < pts.length; j++) {
          if (segDist(x, y, pts[j - 1], pts[j]) <= c.w / 2 + 4) return { kind: "corridor", i: c.ci };
        }
      }
      return null;
    }
    function segDist(x, y, a, b) {
      var dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
      var t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L)) : 0;
      return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
    }
    function local(v, ev) {
      var r = v.svg.node().getBoundingClientRect();
      return [(ev.clientX - r.left) * v.W / r.width, (ev.clientY - r.top) * v.H / r.height];
    }

    var tip = $("maptip"), picker = $("picker");
    views.forEach(function (v) {
      v.svg.on("click", function (ev) {
        var xy = local(v, ev), h = hits(v, xy[0], xy[1]);
        hidePicker();
        if (!h) { select(null); return; }
        if (h.kind === "people" && h.list.length > 1) { showPicker(ev, h.list); return; }
        if (h.kind === "people") select({ kind: "person", i: h.list[0] });
        else select(h);
      });
      v.svg.on("mousemove", function (ev) {
        var xy = local(v, ev), h = hits(v, xy[0], xy[1]);
        if (!h) { tip.hidden = true; v.svg.style("cursor", null); return; }
        v.svg.style("cursor", "pointer");
        var html;
        if (h.kind === "people") {
          var names = h.list.map(function (i) { return Q[i].name; });
          html = names.length > 3 ? esc(names.slice(0, 2).join(", ")) + " and " + (names.length - 2) + " more"
                                  : esc(names.join(", "));
          if (names.length > 1) html += '<span class="hint">click to choose</span>';
        } else if (h.kind === "place") {
          html = esc(P[h.i].name);
        } else {
          var c = D.corridors[h.i];
          html = esc(c.a + " → " + c.b) + " · " + c.people.length + " " + (c.people.length === 1 ? "person" : "people") +
                 " · " + (c.y0 === c.y1 ? c.y0 : c.y0 + "–" + c.y1);
        }
        tip.innerHTML = html; tip.hidden = false;
        var r = $("mapwrap").getBoundingClientRect();
        tip.style.left = (ev.clientX - r.left + 14) + "px"; tip.style.top = (ev.clientY - r.top + 12) + "px";
      });
      v.svg.on("mouseleave", function () { tip.hidden = true; });
    });

    function showPicker(ev, list) {
      var r = $("mapwrap").getBoundingClientRect();
      list = list.slice().sort(function (a, b) { return d3.ascending(Q[a].name, Q[b].name); });
      picker.innerHTML = '<p class="hint">' + list.length + ' people here</p>' + list.map(function (i) {
        return '<button type="button" data-person="' + i + '"><span class="sw" style="background:' + ink(Q[i].branch, 1.25) +
               '"></span>' + esc(Q[i].name) + (Q[i].life ? ' <span class="life">' + esc(Q[i].life) + "</span>" : "") + "</button>";
      }).join("");
      picker.style.left = Math.min(ev.clientX - r.left + 8, r.width - 280) + "px";
      picker.style.top = Math.min(ev.clientY - r.top + 8, r.height - 40) + "px";
      picker.hidden = false;
      tip.hidden = true;
      var b = picker.querySelector("button"); if (b) b.focus();
    }
    function hidePicker() { picker.hidden = true; }

    // ------------------------------------------------------------ which lenses (the one rule)
    // A lens goes where people overlap too much to tell apart on the world map as it is drawn: places
    // with someone present this year, closer than D px to one another, form a crowd; a crowd of two or
    // more places is a candidate. Only the families ticked count, only people whose whereabouts are
    // known (not the hollow rings), only real places (not a country's or state's centre). Its weight is
    // the people in it, and twice more for anyone born, moving or dying there that year; under All years,
    // the person-years spent there. As many lenses as slots fit (1 phone, 2 laptop, 3 wide), strongest
    // first. During Play a lens stays at least 6 s (at 1x), and a challenger replaces it only if it
    // outweighs it 1.5 times. A lens you close stays closed until Play starts again from the beginning;
    // one you open (double-click, or a click on a crowd's box) is pinned until you close it. With
    // automatic lenses off, the right slot holds Latvia, as the inset always did.
    var AUTO = true, lensCands = [];
    var BROAD = { country: 1, state: 1, province: 1, region: 1 };   // a country's or state's centre
    var D_CROWD = 16, HOLD_MS = 6000, BEAT = 1.5;
    var LATVIA_LENS = { key: "latvia", box: LATVIA, title: "Latvia", score: 1e9 };
    function nSlots() { var w = $("mapwrap").clientWidth; return w < 700 ? 1 : w < 1500 ? 2 : 3; }
    function slotOrder(n) { return n === 1 ? [0] : n === 2 ? [1, 0] : [1, 2, 0]; }   // left to right
    function boxFromScreen(xs, ys) {          // a lens box (lon/lat) around points on the world, padded, 1.55:1
      var x0 = Math.min.apply(null, xs) - 22, x1 = Math.max.apply(null, xs) + 22;
      var y0 = Math.min.apply(null, ys) - 22, y1 = Math.max.apply(null, ys) + 22;
      var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, wd = Math.max(80, x1 - x0), ht = Math.max(80 / 1.55, y1 - y0);
      if (wd / ht < 1.55) wd = ht * 1.55; else ht = wd / 1.55;
      var a = world.proj.invert(world.t.invert([cx - wd / 2, cy - ht / 2]));
      var b = world.proj.invert(world.t.invert([cx + wd / 2, cy + ht / 2]));
      return [[Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.max(a[1], b[1])]];
    }
    function crowds() {
      var at = {}, wt = {};
      var year = state.year;
      Q.forEach(function (q) {
        if (!state.lines.has(q.branch)) return;
        if (year == null) {                   // All years: the person-years spent at each place
          q.stays.forEach(function (st) {
            if (st.only || BROAD[P[st.p].type]) return;
            (at[st.p] = at[st.p] || {})[q.i] = 1;
            wt[st.p] = (wt[st.p] || 0) + Math.max(0.5, (st.end != null ? st.end : st.t0) - st.t0);
          });
          return;
        }
        var w = where(q, year);
        if (!w || w.unknown || (BROAD[P[w.p].type] && !w.ll)) return;
        (at[w.p] = at[w.p] || {})[q.i] = 1;
        wt[w.p] = (wt[w.p] || 0) + 1 + (ACTIVE[q.i] ? 2 : 0);
      });
      var ids = Object.keys(at).map(Number), xy = {}, parent = {};
      ids.forEach(function (pi) { xy[pi] = world.xy(P[pi].lon, P[pi].lat); parent[pi] = pi; });
      var find = function (a) { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
      for (var a = 0; a < ids.length; a++) for (var b = a + 1; b < ids.length; b++) {
        var p1 = xy[ids[a]], p2 = xy[ids[b]];
        if (Math.abs(p1[0] - p2[0]) < D_CROWD && Math.abs(p1[1] - p2[1]) < D_CROWD &&
            Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) < D_CROWD) parent[find(ids[a])] = find(ids[b]);
      }
      var groups = {};
      ids.forEach(function (pi) { (groups[find(pi)] = groups[find(pi)] || []).push(pi); });
      var slotW = (slotEls[0].clientWidth || 360), out = [];
      Object.keys(groups).forEach(function (g) {
        var pls = groups[g];
        if (pls.length < 2) return;           // one place: its people already fan out around it
        var people = {}, score = 0;
        pls.forEach(function (pi) { Object.keys(at[pi]).forEach(function (i) { people[i] = 1; }); score += wt[pi]; });
        pls.sort(function (x, y) { return wt[y] - wt[x]; });
        var box = boxFromScreen(pls.map(function (pi) { return xy[pi][0]; }), pls.map(function (pi) { return xy[pi][1]; }));
        var b0 = world.xy(box[0][0], box[1][1]), b1 = world.xy(box[1][0], box[0][1]);
        if (b1[0] - b0[0] > 0.8 * slotW) return;   // as wide on the map as a lens: nothing to magnify
        out.push({ key: "p" + P[pls[0]].id, box: box, score: score, people: Object.keys(people),
                   title: pls.slice(0, 2).map(function (pi) { return P[pi].short; }).join(" · "),
                   cx: (b0[0] + b1[0]) / 2 });
      });
      // coalesce: crowds whose boxes overlap are one crowd (two farms side by side, a lens box and the
      // crowd next to it), repeatedly until none overlap
      for (var merged = true; merged;) {
        merged = false;
        for (var a1 = 0; a1 < out.length && !merged; a1++) for (var b1i = a1 + 1; b1i < out.length && !merged; b1i++) {
          if (!overlap(out[a1].box, out[b1i].box)) continue;
          var A = out[a1], B = out[b1i];
          var ppl = {}; A.people.concat(B.people).forEach(function (i) { ppl[i] = 1; });
          var big = A.score >= B.score ? A : B;
          A.box = [[Math.min(A.box[0][0], B.box[0][0]), Math.min(A.box[0][1], B.box[0][1])],
                   [Math.max(A.box[1][0], B.box[1][0]), Math.max(A.box[1][1], B.box[1][1])]];
          A.key = big.key; A.title = big.title; A.score = A.score + B.score; A.people = Object.keys(ppl);
          out.splice(b1i, 1);
          merged = true;
        }
      }
      return out.sort(function (x, y) { return y.score - x.score; });
    }
    function overlap(a, b) {                  // lon/lat boxes that overlap, with a little slack
      var sx = 0.05 * Math.max(a[1][0] - a[0][0], b[1][0] - b[0][0]), sy = 0.05 * Math.max(a[1][1] - a[0][1], b[1][1] - b[0][1]);
      return a[0][0] < b[1][0] + sx && b[0][0] < a[1][0] + sx && a[0][1] < b[1][1] + sy && b[0][1] < a[1][1] + sy;
    }
    var dismissedBoxes = [];
    function presentIn(box) {                // people (ticked, whereabouts known) in a box this year
      if (state.year == null) return 1;
      var n = 0, y = state.year;
      Q.forEach(function (q) {
        if (!state.lines.has(q.branch)) return;
        var w = where(q, y);
        if (!w || w.unknown) return;
        var ll = w.ll || [P[w.p].lon, P[w.p].lat];
        if (inBox(box, ll[0], ll[1])) n++;
      });
      return n;
    }
    function slotDist(k, cx) {               // how far a slot's centre is from a point on the world (px)
      var r = slotEls[k].getBoundingClientRect(), w = world.svg.node().getBoundingClientRect();
      var mid = r.width ? (r.left + r.right) / 2 - w.left : [w.width * 0.8, w.width * 0.2, w.width * 0.5][k];
      return Math.abs(mid * world.W / w.width - cx);
    }
    function scheduleLenses() {
      var n = nSlots(), order = slotOrder(n), now = performance.now(), hold = HOLD_MS / (state.speed || 1);
      var cands = (AUTO ? crowds() : [LATVIA_LENS]).filter(function (c) {
        return !dismissedBoxes.some(function (b) { return overlap(b, c.box); });
      });
      for (var k = 0; k < 3; k++) if (order.indexOf(k) < 0 && slots[k] && !slots[k].pinned) slots[k] = null;
      // A lens is a region of the map, not its busiest place: a crowd that overlaps an open lens IS that
      // lens (its count and weight go to it; it widens to take in newcomers), however its title would read.
      var claimed = {};
      order.forEach(function (k) {
        var sl = slots[k];
        if (!sl) return;
        var mine = cands.filter(function (c) { return !claimed[cands.indexOf(c)] && overlap(sl.box, c.box); });
        mine.forEach(function (c) { claimed[cands.indexOf(c)] = 1; });
        if (sl.pinned) return;
        if (mine.length) {
          sl.score = mine.reduce(function (a, c) { return a + c.score; }, 0);
          sl.seen = now;
          // its crowds now, as one box: grow to take in newcomers; shrink back when the crowd has gathered
          // into much less than the lens shows (so a lens that once took in Portland does not stay a view
          // of the whole West Coast), never by a little (no jitter)
          var u = mine.reduce(function (bx, c) {
            return [[Math.min(bx[0][0], c.box[0][0]), Math.min(bx[0][1], c.box[0][1])],
                    [Math.max(bx[1][0], c.box[1][0]), Math.max(bx[1][1], c.box[1][1])]];
          }, mine[0].box);
          var inside = u[0][0] >= sl.box[0][0] && u[0][1] >= sl.box[0][1] && u[1][0] <= sl.box[1][0] && u[1][1] <= sl.box[1][1];
          var area = function (bx) { return (bx[1][0] - bx[0][0]) * (bx[1][1] - bx[0][1]); };
          if (!inside) sl.box = [[Math.min(sl.box[0][0], u[0][0]), Math.min(sl.box[0][1], u[0][1])],
                                 [Math.max(sl.box[1][0], u[1][0]), Math.max(sl.box[1][1], u[1][1])]];
          else if (area(u) < 0.3 * area(sl.box)) sl.box = u;
        } else if (presentIn(sl.box) > 0) {
          sl.score = Math.min(sl.score, presentIn(sl.box));   // quiet, not gone: it stays until a crowd needs the slot
        } else if (!(state.playing && now - sl.since < hold)) {
          slots[k] = null;                      // nobody left in it, and it has had its time
        }
      });
      var rest = cands.filter(function (c, ci) { return !claimed[ci]; });
      lensCands = AUTO ? rest : [];
      rest.forEach(function (c) {
        var freeK = order.filter(function (k) { return !slots[k]; });
        if (freeK.length) {                     // the free slot nearest the crowd (no lens ever moves)
          var pick = freeK.slice().sort(function (a, b) { return slotDist(a, c.cx) - slotDist(b, c.cx); })[0];
          slots[pick] = { key: c.key, box: c.box, title: null, score: c.score, since: now };
          return;
        }
        var weak = order.filter(function (k) { return !slots[k].pinned && !(state.playing && now - slots[k].since < hold); })
          .sort(function (a, b) { return slots[a].score - slots[b].score; })[0];
        if (weak != null && c.score > BEAT * slots[weak].score)
          slots[weak] = { key: c.key, box: c.box, title: null, score: c.score, since: now };
      });
      lensCands = lensCands.filter(function (c) { return !slots.some(function (sl) { return sl && overlap(sl.box, c.box); }); });
      // Each lens sits on the same side as its place: the open lenses, west to east, go into the slots
      // left to right, choosing the slots nearest them (Peter: "can the inset be on the same side as the
      // area?"). A lens moves only when a newcomer arrives west or east of it.
      var open = order.map(function (k) { return slots[k]; }).filter(Boolean);
      var cxOf = function (sl) { return world.xy((sl.box[0][0] + sl.box[1][0]) / 2, (sl.box[0][1] + sl.box[1][1]) / 2)[0]; };
      open.sort(function (a, b) { return cxOf(a) - cxOf(b); });
      var slotX = { 1: 0.2 * world.W, 2: 0.5 * world.W, 0: 0.8 * world.W };
      var best = null;
      (function choose(from, picked) {          // order-keeping choices of open.length slots out of `order`
        if (picked.length === open.length) {
          var cost = picked.reduce(function (c, k, i) { return c + Math.abs(slotX[k] - cxOf(open[i])); }, 0);
          if (!best || cost < best.cost) best = { cost: cost, ks: picked.slice() };
          return;
        }
        for (var i = from; i < order.length; i++) choose(i + 1, picked.concat([order[i]]));
      })(0, []);
      slots = [null, null, null];
      if (best) best.ks.forEach(function (k, i) { slots[k] = open[i]; });
      showSlots();
      if (follow) setTimeout(function () { followYear(state.year == null ? null : Math.floor(state.year), false); }, 30);
    }
    function showSlots() {
      $("mapapp").classList.toggle("slots-3", nSlots() === 3);
      slots.forEach(function (sl, k) {
        var v = slotViews[k], el = slotEls[k], was = !v.hidden, oldKey = v.key;
        // a lens fades out (0.5 s) and in: never pops; a lens replaced in its slot fades out, then in
        if (!sl) {
          if (was) fadeOut(el, function () { v.hidden = true; v.key = null; });
          return;
        }
        if (was && oldKey !== sl.key && !el._fading) {
          fadeOut(el, function () { v.hidden = true; v.key = null; showSlots(); });
          return;
        }
        if (el._fading) return;                 // finishing a fade; showSlots runs again after it
        if (!was) fadeIn(el);
        v.hidden = false;
        if (sl.title) el.querySelector(".insettitle").textContent = sl.title;
        el.classList.toggle("pinned", !!sl.pinned);
        var boxKey = sl.box.map(function (p) { return p.map(function (x) { return x.toFixed(2); }).join(","); }).join(";");
        if (!was || oldKey !== sl.key || v.boxKey !== boxKey) {   // a new or wider box: fit it afresh
          v.key = sl.key;
          v.boxKey = boxKey;
          v.box = sl.box;
          v.t = d3.zoomIdentity;
          v.svg.call(v.zoom.transform, d3.zoomIdentity);
          v.resize();
        }
      });
      renderAll();
    }
    function fadeIn(el) {
      el.hidden = false;
      el.classList.add("fade");
      void el.offsetWidth;                      // start from transparent
      el.classList.remove("fade");
    }
    function fadeOut(el, done) {
      if (el.hidden) { done(); return; }
      el._fading = true;
      el.classList.add("fade");
      setTimeout(function () { el.hidden = true; el.classList.remove("fade"); el._fading = false; done(); renderAll(); }, 480);
    }
    function pinLens(l) {
      var order = slotOrder(nSlots());
      var k = order.filter(function (x) { return !slots[x]; })[0];
      if (k == null) {                        // replace the weakest automatic lens, else the oldest pin
        var autos = order.filter(function (x) { return !slots[x].pinned; });
        k = autos.length ? autos.sort(function (a, b) { return slots[a].score - slots[b].score; })[0]
                         : order.slice().sort(function (a, b) { return slots[a].since - slots[b].since; })[0];
      }
      dismissedBoxes = dismissedBoxes.filter(function (b) { return !overlap(b, l.box); });
      slots[k] = { key: l.key, box: l.box, title: l.title, score: l.score || 0, since: performance.now(), pinned: true };
      showSlots();
    }
    function closeSlot(k) {
      var sl = slots[k];
      if (!sl) return;
      if (!sl.pinned) dismissedBoxes.push(sl.box);   // until Play starts again from the beginning
      slots[k] = null;
      scheduleLenses();
    }
    // Double-click (or double-tap) the world: pin a lens there, magnified enough to pull the crowd apart
    function lensAt(ev) {
      var e = ev && ev.changedTouches && ev.changedTouches.length ? ev.changedTouches[0] : ev;
      var r = world.svg.node().getBoundingClientRect();
      var x = (e.clientX - r.left) * world.W / r.width, y = (e.clientY - r.top) * world.H / r.height;
      hidePicker();
      var xs = [x], ys = [y];                 // the people near the spot, at their places (not seats)
      world.items.dots.forEach(function (d) {
        if (Math.hypot(d.x - x, d.y - y) > 60) return;
        var ll = d.w.ll || [P[d.w.p].lon, P[d.w.p].lat], q = world.xy(ll[0], ll[1]);
        xs.push(q[0]); ys.push(q[1]);
      });
      pinLens({ key: "pin" + Math.round(x) + "," + Math.round(y) + "@" + world.t.k.toFixed(2), box: boxFromScreen(xs, ys), title: null });
    }
    // A lens is named for the region it shows, not its busiest towns, so its name holds while people move
    // within it: the named region (www/regions.json, written by a reader: "Vidzeme", "the Great Lakes")
    // holding most of its people, else the state, historical region or country they are in ("Ohio ·
    // Michigan", "Vidzeme"). A second name joins only when it holds half as many people as the first,
    // and leaves when it holds under a quarter.
    var REGIONS = [];                         // [{name, members: [area names], why}]
    function areaOf(pl) {                     // a place's state (US, Canada), Latvian region, or country
      var parts = String(pl.name || pl.short).split(/,\s*/).map(function (x) { return x.replace(/\s*\(.*?\)/, ""); });
      if ((pl.country === "United States" || pl.country === "Canada") && parts.length >= 2) return parts[parts.length - 2];
      if (pl.country === "Latvia") {
        var r = parts.filter(function (x) { return /^(Vidzeme|Kurzeme|Zemgale|Latgale|Sēlija)$/.test(x); })[0];
        return r || (/^Rīga\b/.test(parts[0]) ? "Rīga" : "Latvia");
      }
      return pl.country || parts[parts.length - 1];
    }
    function regionOf(area) {
      for (var i = 0; i < REGIONS.length; i++) if (REGIONS[i].members.indexOf(area) >= 0) return REGIONS[i].name;
      return area;
    }
    function slotTitles() {
      slots.forEach(function (sl, k) {
        if (!sl) return;
        var v = slotViews[k], c = {};
        v.items.dots.forEach(function (d) { var r = regionOf(areaOf(P[d.w.p])); c[r] = (c[r] || 0) + 1; });
        if (!Object.keys(c).length) v.items.marks.forEach(function (m) { var r = regionOf(areaOf(m.p)); c[r] = (c[r] || 0) + (m.p.n || 1); });
        var top = Object.keys(c).sort(function (a, b) { return c[b] - c[a]; });
        if (!top.length) return;
        var cur = sl.names || [];
        var names = [top[0]];
        var second = top[1];
        if (second && c[second] >= (cur.indexOf(second) >= 0 ? 0.25 : 0.5) * c[top[0]]) names.push(second);
        if (cur.length && cur[0] !== names[0] && cur.indexOf(names[0]) >= 0 && c[cur[0]] >= 0.8 * c[names[0]]) names = cur;   // no flip-flop
        if (names.join("|") === cur.join("|") && sl.title) return;
        sl.names = names;
        sl.title = names.join(" · ");
        slotEls[k].querySelector(".insettitle").textContent = sl.title;
      });
    }
    fetch("regions.json?" + V, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rs) { REGIONS = rs || []; slots.forEach(function (sl) { if (sl) { sl.names = null; sl.title = null; } }); renderAll(); })
      .catch(function () { /* none yet */ });
    world.svg.on("dblclick.zoom", lensAt);   // d3-zoom also calls this on a double-tap

    // ------------------------------------------------------------ selection and the panel
    function select(s) {
      state.sel = s;
      var panel = $("panel");
      if (!s) { panel.hidden = true; renderAll(); return; }
      var h = ['<button type="button" class="x" data-close="1" aria-label="Close">×</button>'];
      if (s.kind === "person") {
        var q = Q[s.i];
        h.push("<h3>" + esc(q.name) + "</h3>");
        h.push('<p class="where">' + esc(q.life || "") + (q.estimated && !q.living ? " · date of death not recorded" : "") + "</p>");
        // A home from the person's itinerary (a reader's judgment: its years, confidence and why), or
        // for someone not yet reviewed, each record on its own. A gap between homes is said, not filled.
        var yr = function (d) { var m = String(d || "").split("/"); return m.length > 1 ? m[0].slice(0, 4) + "/" + m[1].slice(0, 4) : m[0].slice(0, 4); };
        var rows = [];
        q.stays.forEach(function (st, k) {
          var yrs = st.why === "home" ? yr(st.from) + (st.to !== st.from ? "–" + (st.to ? yr(st.to) : (q.living ? "" : "")) : "")
                  : st.t0 == null ? "undated" : String(Math.floor(st.t0));
          rows.push("<li>" + '<button type="button" class="lnk" data-place="' + st.p + '">' + esc(P[st.p].short) + "</button>" +
                 ' <span class="what">' + esc((LABEL[st.why] || st.why) + ", " + yrs) +
                 (st.conf && st.conf !== "high" ? " · " + esc(st.conf) + " confidence" : "") +
                 (st.only === "origin" ? " (origin only)" : "") + "</span>" +
                 (st.note ? '<span class="why">' + esc(st.note) + "</span>" : "") + "</li>");
          var nx = q.stays[k + 1];
          if (nx && st.end != null && nx.t0 - st.end >= 1)
            rows.push('<li class="gap">no record of where, ' + Math.floor(st.end) + "–" + Math.floor(nx.t0) + "</li>");
        });
        h.push(rows.length ? '<ol class="stops">' + rows.join("") + "</ol>"
                           : '<p class="note">No place on record.</p>');
        if (q.path.length === 1) h.push('<p class="note">One place on record: nothing yet to trace.</p>');
        if (!q.reviewed) h.push('<p class="note">Not yet reviewed: drawn from each record on its own, with nothing inferred between them.</p>');
        // kin with no place on record are not on the map: named, linked to their page
        var off = function (rel) {
          return (q.kin_off || []).filter(function (x) { return x[0] === rel; }).map(function (x) {
            return '<a href="' + esc(x[2]) + '">' + esc(x[1]) + "</a>" + ' <span class="life">(not on the map)</span>';
          });
        };
        var kin = function (label, list, rel) {
          var items = list.map(function (i) {
            return '<button type="button" class="lnk" data-person="' + i + '">' + esc(Q[i].name) + "</button>";
          }).concat(off(rel));
          return items.length ? '<p class="kin">' + label + ": " + items.join(", ") + "</p>" : "";
        };
        h.push(kin("Parents", q.parents, "parent"), kin("Partners", q.partners, "partner"), kin("Children", q.kids, "child"));
        h.push('<p><a href="' + q.href + '">Open ' + esc(q.name.split(" ")[0]) + "’s page →</a></p>");
      } else if (s.kind === "place") {
        var pl = P[s.i];
        h.push("<h3>" + esc(pl.short) + "</h3>", '<p class="where">' + esc(pl.name) +
               (pl.kind === "region" ? " · a region, not an exact spot" : "") + "</p>");
        var here = Q.filter(function (q) { return state.lines.has(q.branch) && q.stays.some(function (st) { return st.p === s.i; }); });
        h.push('<ul class="who">' + here.map(function (q) {
          var yrs = q.stays.filter(function (st) { return st.p === s.i; }).map(function (st) {
            return (LABEL[st.why] || st.why) + (st.t0 != null ? " " + Math.floor(st.t0) : "");
          }).join("; ");
          return '<li><button type="button" class="lnk" data-person="' + q.i + '">' + esc(q.name) + "</button>" +
                 ' <span class="what">' + esc(yrs) + "</span></li>";
        }).join("") + "</ul>");
      } else {
        var c = D.corridors[s.i];
        h.push("<h3>" + esc(c.a) + " → " + esc(c.b) + "</h3>", '<p class="where">' + c.people.length + " " +
               (c.people.length === 1 ? "person" : "people") + ", " + (c.y0 === c.y1 ? c.y0 : c.y0 + "–" + c.y1) + "</p>");
        h.push('<ul class="who">' + c.moves.map(function (m) {
          return '<li><button type="button" class="lnk" data-person="' + m[0] + '">' + esc(Q[m[0]].name) + "</button>" +
                 ' <span class="what">' + esc(P[m[1]].short + " → " + P[m[2]].short + ", " + m[3]) + "</span></li>";
        }).join("") + "</ul>");
      }
      panel.innerHTML = h.join("");
      panel.hidden = false;
      renderAll();
    }
    function onPanel(ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      if (b.dataset.close) select(null);
      else if (b.dataset.person != null) { hidePicker(); select({ kind: "person", i: +b.dataset.person }); }
      else if (b.dataset.place != null) select({ kind: "place", i: +b.dataset.place });
    }
    $("panel").addEventListener("click", onPanel);
    picker.addEventListener("click", onPanel);
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { hidePicker(); select(null); }
    });

    // ------------------------------------------------------------ the chronicle: every event, in order
    // One list of events built once from map.json: births, deaths, local moves, and migrations (moves
    // along a corridor, grouped per corridor and year). Everything time-based reads it *through the
    // family filter*: the chronicle, the headline, who gets a name, and how long play lingers.
    var y0 = D.years[0], y1 = D.years[1];
    var ckey = {};
    D.corridors.forEach(function (c, ci) { c.moves.forEach(function (m) { ckey[m.join("|")] = ci; }); });
    var EV = [];
    var evAt = {};                            // the place of each person's birth / death record, as read
    D.events.forEach(function (e) {
      if (e.alt || e.late || e.r === "wrong" || e.r === "not-presence") return;
      var k = e.i + "|" + (e.t === "baptism" ? "birth" : e.t === "burial" || e.t === "cremation" ? "death" : e.t);
      if (!(k in evAt) || e.t === "birth" || e.t === "death") evAt[k] = e.p;
    });
    Q.forEach(function (q) {
      var first = q.path[0] || q.stays[0], lastSt = q.path[q.path.length - 1] || q.stays[q.stays.length - 1];
      // the place of the birth (death) record; else the home the reader put them in at that moment
      var homeAt = function (t) { var h = q.stays.filter(function (st) { return st.why === "home" && st.t0 <= t + 0.01 && st.end >= t - 0.01; }); return h.length ? h[0].p : null; };
      var bp = evAt[q.i + "|birth"], dp = evAt[q.i + "|death"];
      if (q.born != null) EV.push({ t: q.born, kind: "born", people: [q.i], p: bp != null ? bp : homeAt(q.born) });
      if (q.died != null) EV.push({ t: q.died, kind: "died", people: [q.i], p: dp != null ? dp : homeAt(q.died) });
    });
    var visits = {};                          // a visit, in the record's own words: married, baptised, arrived …
    D.events.forEach(function (e) {
      if (e.r !== "visit" || e.t0 == null || e.t === "birth" || e.t === "death") return;
      var k = [e.t, e.p, Math.floor(e.t0)].join("|");
      if (!visits[k]) EV.push(visits[k] = { t: e.t0, kind: "visit", what: e.t, p: e.p, people: [] });
      if (visits[k].people.indexOf(e.i) < 0) visits[k].people.push(e.i);
    });
    var grouped = {};
    Q.forEach(function (q) {
      if (!q.reviewed) return;                // records only: two records are not a move
      for (var i = 1; i < q.path.length; i++) {
        var a = q.path[i - 1], b = q.path[i];
        if (a.p === b.p) continue;
        var yr = Math.floor(b.t0), ci = ckey[[q.i, a.p, b.p, yr].join("|")];
        if (b.refine || b.vaguer) continue;   // "Oregon", then Portland; or Penkule, then only "Latvia": not a move
        var across = a.end != null && b.t0 - a.end >= 1;   // a gap between: when they moved is not known
        if (ci == null || across) { EV.push({ t: b.t0, kind: "move", people: [q.i], from: a.p, to: b.p, across: across }); continue; }
        var k = ci + "|" + yr;
        if (!grouped[k]) EV.push(grouped[k] = { t: b.t0, kind: "migration", people: [], ci: ci });
        grouped[k].people.push(q.i);
        grouped[k].t = Math.min(grouped[k].t, b.t0);
      }
    });
    EV.forEach(function (e) { e.y = Math.floor(e.t); });
    EV.sort(function (a, b) { return a.t - b.t || (a.kind === "migration" ? -1 : 1); });

    function shown(e) { return e.people.filter(function (i) { return state.lines.has(Q[i].branch); }); }
    function names(list, max) {
      var n = list.map(function (i) { return Q[i].name; });
      return n.length > max ? n.slice(0, max).join(", ") + " and " + (n.length - max) + " more" : n.join(", ").replace(/, ([^,]*)$/, " and $1");
    }
    function eventHTML(e, ppl) {
      var nm = function (i) { return '<button type="button" class="lnk" data-person="' + i + '">' + esc(Q[i].name) + "</button>"; };
      var pl = function (pi) { return pi == null ? "" : esc(P[pi].short); };
      if (e.kind === "migration") {
        var c = D.corridors[e.ci];
        return '<button type="button" class="lnk corr" data-corridor="' + e.ci + '">' + esc(c.a + " → " + c.b) + "</button> · " +
               ppl.slice(0, 4).map(nm).join(", ") + (ppl.length > 4 ? " and " + (ppl.length - 4) + " more" : "");
      }
      if (e.kind === "move") {
        var who = ppl.length <= 3 ? ppl.map(nm).join(", ").replace(/, ([^,]*)$/, " and $1")
                                  : ppl.slice(0, 2).map(nm).join(", ") + " and " + (ppl.length - 2) + " more";
        if (ppl.length > 3) who = '<span class="grp" title="' + esc(ppl.map(function (i) { return Q[i].name; }).join(", ")) + '">' + who + "</span>";
        return e.across ? who + " next on record at " + pl(e.to) + " (last at " + pl(e.from) + ")"
                        : who + " moved, " + pl(e.from) + " → " + pl(e.to);
      }
      if (e.kind === "visit") return ppl.map(nm).join(" and ") + " " + (LABEL[e.what] || e.what) + (e.p != null ? ", " + pl(e.p) : "");
      return nm(ppl[0]) + " " + (e.kind === "born" ? "born" : "died") + (e.p != null ? ", " + pl(e.p) : "");
    }

    // per-year counts, through the filter: what play lingers on
    var MOVES = {}, LIVES = {}, MIGL = {};    // per year: people moving, births and deaths, migrations
    function recount() {
      MOVES = {}; LIVES = {}; MIGL = {};
      var by = {};
      EV.forEach(function (e) {
        var n = shown(e).length;
        if (!n) return;
        if (e.kind === "born" || e.kind === "died") LIVES[e.y] = (LIVES[e.y] || 0) + 1;
        else if (e.kind !== "visit") MOVES[e.y] = (MOVES[e.y] || 0) + n;
        if (e.kind === "migration") { var k = e.y + "|" + e.ci; by[k] = (by[k] || 0) + n; }
      });
      Object.keys(by).forEach(function (k) {
        var y = +k.split("|")[0];
        (MIGL[y] = MIGL[y] || []).push({ ci: +k.split("|")[1], n: by[k] });
      });
      Object.keys(MIGL).forEach(function (y) { MIGL[y].sort(function (a, b) { return b.n - a.n; }); });
      drawHeat();
    }
    // How long a year lasts in Play: 20 ms if nothing happens, up to about a second when people are
    // born, die or move, and a year with a migration lasts at least READ (more for a two- or three-line
    // headline), so the headline can be read before the year moves on. Divided by the chosen speed.
    var READ = 2400;
    function dwell(y) {
      var m = MOVES[y] || 0, l = LIVES[y] || 0;
      var d = m || l ? 60 + 160 * Math.min(m, 6) + 22 * Math.min(l, 4) : 20;
      if (MIGL[y]) d = Math.max(d, READ + 900 * Math.min(MIGL[y].length - 1, 2));
      return d / state.speed;
    }

    // ---- the chronicle panel (two layouts, chosen by ?layout=right|bottom, for comparison)
    var LAYOUT = (new URLSearchParams(location.search).get("layout") || "timeline").replace(/[^a-z]/g, "");   // Peter, 2026-11-03
    $("mapapp").classList.add("layout-" + LAYOUT);

    var chron = $("chron"), groups = [];
    function buildChron() {
      chron.innerHTML = "";
      groups = [];
      var byYear = {};
      var sameMove = {};                      // the same move in the same year: one line, many names
      EV.forEach(function (e) {
        var ppl = shown(e);
        if (!ppl.length) return;
        if (e.kind === "move") {
          var mk = [e.y, e.from, e.to, e.across ? 1 : 0].join("|");
          if (sameMove[mk]) { ppl.forEach(function (i) { if (sameMove[mk].ppl.indexOf(i) < 0) sameMove[mk].ppl.push(i); }); return; }
          sameMove[mk] = { e: e, ppl: ppl.slice() };
          (byYear[e.y] = byYear[e.y] || []).push(sameMove[mk]);
          return;
        }
        (byYear[e.y] = byYear[e.y] || []).push({ e: e, ppl: ppl });
      });
      var years = Object.keys(byYear).map(Number).sort(function (a, b) { return a - b; });
      if (LAYOUT === "right" || LAYOUT === "timeline") years.reverse();   // newest at the top
      years.forEach(function (y) {
        var g = document.createElement("section");
        g.className = "yr";
        g.dataset.year = y;
        g.innerHTML = '<h4><button type="button" class="lnk" data-year="' + y + '">' + y + "</button></h4><ul>" +
          byYear[y].map(function (x) { return '<li class="k-' + x.e.kind + '">' + eventHTML(x.e, x.ppl) + "</li>"; }).join("") + "</ul>";
        chron.appendChild(g);
        groups.push({ y: y, el: g });
      });
      $("chronhead").textContent = LAYOUT === "bottom" ? "Chronicle" : "Chronicle · newest first";
      lastShownYear = undefined;
      showChron(state.year);
      buildTimeline();
    }
    var lastShownYear;
    // Following, as in a chat: at the top (newest first) the chronicle stays at the top as years arrive;
    // scrolled down to read, it does not move under the reader, and a pill counts the years that arrived
    // above ("↑ 3 new"), which takes them back to the top. Scrolling back to the top resumes following.
    var unseen = 0, pill = document.createElement("button");
    pill.type = "button"; pill.className = "chronnew"; pill.hidden = true;
    chron.parentNode.insertBefore(pill, chron);
    var atTop = function () { return chron.scrollTop <= 6; };
    pill.addEventListener("click", function () { chron.scrollTop = 0; unseen = 0; pill.hidden = true; });
    chron.addEventListener("scroll", function () { if (atTop()) { unseen = 0; pill.hidden = true; } });
    function showChron(year) {
      var fy = year == null ? null : Math.floor(year);
      if (fy === lastShownYear) return;
      var prevYear = lastShownYear;
      lastShownYear = fy;
      var follow = atTop(), before = chron.scrollHeight, top0 = chron.scrollTop, arrived = 0;
      groups.forEach(function (g) {
        var was = g.el.hidden;
        g.el.hidden = fy != null && g.y > fy;                       // the future is not shown yet
        if (was && !g.el.hidden && prevYear != null && g.y > prevYear) arrived++;
        g.el.classList.toggle("now", fy != null && g.y === fy);
        g.el.classList.toggle("recent", fy != null && g.y < fy && g.y >= fy - 3);
      });
      if (fy == null) return;
      if (LAYOUT === "right" || LAYOUT === "timeline") {
        if (follow || prevYear == null || fy < prevYear) { chron.scrollTop = 0; unseen = 0; pill.hidden = true; }
        else {                                                        // hold the reader's place
          chron.scrollTop = top0 + (chron.scrollHeight - before);
          unseen += arrived;
          if (unseen) { pill.hidden = false; pill.textContent = "↑ " + unseen + " new"; }
        }
      } else {                                                          // chronological: the latest card, in full
        var vis = groups.filter(function (g) { return !g.el.hidden; }), lastG = vis[vis.length - 1];
        if (lastG) chron.scrollLeft = Math.max(0, lastG.el.offsetLeft + lastG.el.offsetWidth - chron.clientWidth);
      }
    }
    chron.addEventListener("click", function (ev) {
      var b = ev.target.closest("button");
      if (!b) return;
      if (b.dataset.year != null) { stop(); setYear(+b.dataset.year); }
      else if (b.dataset.corridor != null) select({ kind: "corridor", i: +b.dataset.corridor });
      else if (b.dataset.person != null) select({ kind: "person", i: +b.dataset.person });
    });

    // ---- the headline: the year's migrations only (moves between countries, or between US states),
    // largest first, at most two lines and "and N more". It shows during its own year and no other, so
    // the year and the words always agree; births, deaths and local moves go to the chronicle.
    var capEl = $("caption"), lastHead = null;
    function headline(fy) {
      var ms = MIGL[fy] || [];
      var key = fy + ":" + ms.map(function (m) { return m.ci + "x" + m.n; }).join(",");
      if (key === lastHead) return;
      lastHead = key;
      var html = '<span class="yr">' + fy + "</span>";
      if (ms.length) {
        html += '<span class="cap">' + ms.slice(0, 2).map(function (m) {
          var c = D.corridors[m.ci];
          return '<span class="line">' + esc(c.a + " → " + c.b) + " · " + m.n + (m.n === 1 ? " person" : " people") + "</span>";
        }).join("") + (ms.length > 2 ? '<span class="line more">and ' + (ms.length - 2) + " more</span>" : "") + "</span>";
      }
      capEl.innerHTML = html;
    }

    // ---- the heat strip under the year slider: where the migrations are, through the family filter,
    // so it is clear where Play will slow down to let a headline be read
    var heat = document.createElement("div");
    heat.className = "heat";
    heat.setAttribute("aria-hidden", "true");
    function drawHeat() {
      if (typeof heat === "undefined" || !heat || !heat.parentNode) return;
      var html = "";
      Object.keys(MIGL).forEach(function (y) {
        var n = MIGL[y].reduce(function (a, m) { return a + m.n; }, 0);
        html += '<i style="left:' + ((y - y0) / (y1 - y0) * 100).toFixed(2) + "%;height:" + Math.min(100, 30 + 14 * n) + '%" title="' + y + '"></i>';
      });
      heat.innerHTML = html;
    }

    // ---- the timeline (?layout=timeline): a strip along the bottom of the map frame, over the sea, in
    // place of the year slider, so it is in view with the map. Years run along it; each year's events are
    // small marks stacked above the axis (migration, moved, born, died); the same move by several people
    // in one year is one mark. A cursor marks the year, and above the strip that year's events read in
    // words, at most two lines and "+N more". Click, drag or use the arrow keys to go to a year.
    // "Chronicle ▾" folds the whole chronicle open under the map. The lenses sit above the strip.
    var tl = null;                            // shown in the timeline layout and in full screen (CSS)
    var TL_ORDER = { migration: 0, move: 1, born: 2, died: 3 };
    function buildTimeline() {
      if (!tl) {
        var wrap = document.createElement("div");
        wrap.className = "timeline";
        wrap.innerHTML = '<div class="tlnow" id="tlnow"></div><svg id="tlsvg" role="slider" aria-label="Year" tabindex="0"></svg>' +
          '<button type="button" class="tlmore" id="tlmore" aria-expanded="false" title="The whole chronicle, under the map">Chronicle ▾</button>';
        $("mapwrap").appendChild(wrap);
        tl = { wrap: wrap, svg: d3.select("#tlsvg") };
        var go = function (ev) {
          var r = tl.svg.node().getBoundingClientRect();
          var yr = Math.round(tl.x.invert((ev.clientX - r.left) * tl.W / r.width));
          stop(); setYear(Math.max(y0, Math.min(y1, yr)));
        };
        tl.svg.on("pointerdown", function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          go(ev);
          tl.svg.on("pointermove.tl", go);
          d3.select(window).on("pointerup.tl", function () { tl.svg.on("pointermove.tl", null); d3.select(window).on("pointerup.tl", null); });
        });
        tl.svg.on("keydown", function (ev) {
          var d = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
          if (!d) return;
          ev.preventDefault();
          stop(); setYear(Math.max(y0, Math.min(y1, (state.year == null ? y1 : Math.floor(state.year)) + d)));
        });
        $("tlmore").addEventListener("click", function () {
          var open = !$("mapapp").classList.contains("tl-open");
          $("mapapp").classList.toggle("tl-open", open);
          $("tlmore").setAttribute("aria-expanded", String(open));
          $("tlmore").textContent = open ? "Chronicle ▴" : "Chronicle ▾";
          if (open) { lastShownYear = undefined; showChron(state.year); $("side").scrollIntoView({ block: "nearest", behavior: "smooth" }); }
        });
        $("tlnow").addEventListener("click", function (ev) {
          var b = ev.target.closest("button");
          if (!b) return;
          if (b.dataset.person != null) select({ kind: "person", i: +b.dataset.person });
          else if (b.dataset.corridor != null) select({ kind: "corridor", i: +b.dataset.corridor });
        });
        ["pointerdown", "dblclick", "wheel"].forEach(function (t) {   // the strip is not the map underneath
          wrap.addEventListener(t, function (ev) { ev.stopPropagation(); });
        });
        new ResizeObserver(function () { drawTimeline(); }).observe(wrap);
      }
      var marks = [], seen = {};
      EV.forEach(function (e) {
        if (!(e.kind in TL_ORDER)) return;
        var ppl = shown(e);
        if (!ppl.length) return;
        var key = e.kind === "move" ? [e.y, "mv", e.from, e.to].join("|") : e.kind === "migration" ? [e.y, "mg", e.ci].join("|") : null;
        if (key && seen[key]) { seen[key].n += ppl.length; return; }
        var m = { y: e.y, kind: e.kind, n: ppl.length };
        if (key) seen[key] = m;
        marks.push(m);
      });
      marks.sort(function (a, b) { return a.y - b.y || TL_ORDER[a.kind] - TL_ORDER[b.kind]; });
      var stack = {};
      marks.forEach(function (m) { m.k = stack[m.y] = (stack[m.y] || 0) + 1; });
      tl.marks = marks; tl.maxStack = d3.max(Object.values(stack)) || 1;
      drawTimeline();
    }
    function drawTimeline() {
      if (!tl || !tl.wrap.offsetParent) return;   // not shown in this layout
      var W = tl.svg.node().clientWidth || 800, H = 46, ax = H - 14;
      tl.W = W;
      tl.svg.attr("viewBox", "0 0 " + W + " " + H);
      var x = tl.x = d3.scaleLinear().domain([y0, y1]).range([8, W - 8]);
      var cy = state.year == null ? null : Math.floor(state.year);
      var step = Math.min(4, (ax - 4) / tl.maxStack);
      var ticks = d3.range(Math.ceil(y0 / 50) * 50, y1 + 1, (x(1900) - x(1850)) < 70 ? 100 : 50);
      tl.svg.selectAll("line.base").data([0]).join("line").attr("class", "base").attr("x1", x(y0)).attr("x2", x(y1)).attr("y1", ax).attr("y2", ax);
      tl.svg.selectAll("text.tick").data(ticks).join("text").attr("class", "tick").attr("x", x).attr("y", H - 2).text(function (t) { return t; });
      tl.svg.selectAll("rect.mk").data(tl.marks).join("rect")
        .attr("class", function (m) { return "mk m-" + m.kind + (cy != null && m.y > cy ? " future" : ""); })
        .attr("x", function (m) { return x(m.y) - 1.1; }).attr("width", 2.2)
        .attr("y", function (m) { return ax - 1 - m.k * step; }).attr("height", Math.max(1.4, step - 0.5));
      tl.svg.selectAll("line.cursor").data(cy == null ? [] : [cy]).join("line").attr("class", "cursor")
        .attr("x1", x).attr("x2", x).attr("y1", 0).attr("y2", ax + 3);
      tl.svg.attr("aria-valuemin", y0).attr("aria-valuemax", y1).attr("aria-valuenow", cy == null ? y1 : cy);
      var now = $("tlnow");
      if (cy == null) { now.innerHTML = '<span class="tly">All years</span><span class="tlq">click the timeline to go to a year</span>'; now.style.left = "0px"; return; }
      var sec = groups.filter(function (g) { return g.y === cy; })[0], lines = [];
      var rank = function (li) { return /k-migration/.test(li.className) ? 0 : /k-move/.test(li.className) ? 1 : 2; };
      if (sec) [].slice.call(sec.el.querySelectorAll("li")).sort(function (a, b) { return rank(a) - rank(b); })
        .forEach(function (li) { lines.push(li.innerHTML); });
      now.innerHTML = '<span class="tly">' + cy + "</span>" + (lines.length
        ? lines.slice(0, 2).map(function (l) { return '<span class="tle">' + l + "</span>"; }).join("") +
          (lines.length > 2 ? '<span class="tlq">+' + (lines.length - 2) + " more</span>" : "")
        : '<span class="tlq">nothing recorded</span>');
      var w = now.offsetWidth, px = x(cy) * (tl.svg.node().getBoundingClientRect().width / W);
      now.style.left = Math.max(0, Math.min(tl.wrap.clientWidth - w - 4, px - w / 2)) + "px";
    }

    // who did something this year: they get a name on the map during play
    function activeIn(fy) {
      var a = {};
      if (fy == null) return a;
      EV.forEach(function (e) { if (e.y === fy) shown(e).forEach(function (i) { a[i] = 1; }); });
      return a;
    }

    var slider = $("year"), out = $("yearout");
    slider.min = y0; slider.max = y1; slider.value = y1;
    function setYear(y) {
      var prev = state.year == null ? null : Math.floor(state.year);
      state.year = y;
      if (y == null) {
        out.textContent = "All years"; capEl.hidden = true; slider.value = y1; lastHead = null; ACTIVE = {};
        if (prev != null) setTimeout(drawTimeline, 0);
        if (prev != null || !slots.some(Boolean)) setTimeout(scheduleLenses, 0);
      } else {
        var fy = Math.floor(y);
        out.textContent = fy; slider.value = fy;
        if (fy !== prev) ACTIVE = activeIn(fy);
        headline(fy);
        if (fy !== prev && state.playing && follow) followYear(fy, false);
        if (fy !== prev) { scheduleLenses(); drawTimeline(); }
        capEl.hidden = false;
      }
      $("allyears").disabled = y == null;
      showChron(y);
      renderAll();
    }
    slider.addEventListener("input", function () { stop(); setYear(+slider.value); });
    slider.parentNode.insertBefore(heat, slider.nextSibling);
    (function () {                            // the strip sits under the slider's track
      var wrap = document.createElement("span");
      wrap.className = "yearwrap";
      slider.parentNode.insertBefore(wrap, slider);
      wrap.appendChild(slider);
      wrap.appendChild(heat);
    })();

    // ---- speed: ½×, 1×, 2× (Play's pace; a headline's reading time scales with it)
    state.speed = 1;
    var speedEl = document.createElement("span");
    speedEl.className = "speed";
    speedEl.setAttribute("role", "group");
    speedEl.setAttribute("aria-label", "Play speed");
    speedEl.innerHTML = [[0.5, "½×"], [1, "1×"], [2, "2×"]].map(function (x) {
      return '<button type="button" data-speed="' + x[0] + '"' + (x[0] === 1 ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + ">" + x[1] + "</button>";
    }).join("");
    $("play").parentNode.insertBefore(speedEl, $("play").nextSibling);
    speedEl.addEventListener("click", function (ev) {
      var b = ev.target.closest("button[data-speed]");
      if (!b) return;
      state.speed = +b.dataset.speed;
      [].forEach.call(speedEl.children, function (x) { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
    });
    $("allyears").addEventListener("click", function () { stop(); setYear(null); });

    var last = 0;
    function frame(ts) {
      if (!state.playing) return;
      var dt = Math.min(100, ts - (last || ts)); last = ts;
      // Spend this frame's time year by year, at each year's own pace: a quick empty year must not
      // carry Play deep into (or past) a year with a headline. A year with a migration always starts
      // at its beginning, so it gets its whole reading time.
      var y = state.year, t = dt;
      while (t > 0 && y < y1) {
        var fy = Math.floor(y), d = dwell(fy), left = (fy + 1 - y) * d;
        if (t < left) { y += t / d; t = 0; }
        else { y = fy + 1; t -= left; if (MIGL[fy + 1]) break; }
      }
      if (y >= y1) { setYear(y1); stop(); return; }
      setYear(y);
      requestAnimationFrame(frame);
    }
    function stop() { state.playing = false; $("play").textContent = "▶ Play"; }
    $("play").addEventListener("click", function () {
      if (state.playing) { stop(); return; }
      state.playing = true; last = 0; $("play").textContent = "❚❚ Pause";
      if (state.year == null || state.year >= y1 - 0.01) {
        var first = d3.min(Q, function (q) { return state.lines.has(q.branch) ? q.start : null; });
        state.year = Math.max(y0, Math.floor(first || y0)); lastHead = null;
        dismissedBoxes = [];                  // Play from the beginning: closed lenses may return
      }
      requestAnimationFrame(frame);
    });
    function onLines() { recount(); buildChron(); lastHead = null; if (state.year != null) { ACTIVE = activeIn(Math.floor(state.year)); headline(Math.floor(state.year)); } scheduleLenses(); }
    recount();
    buildChron();

    // ------------------------------------------------------------ filters, search, zoom
    var box = d3.select("#branches");
    Object.keys(D.branches).forEach(function (b) {
      var n = Q.filter(function (q) { return q.branch === b; }).length;
      if (!n) return;
      var lab = box.append("label").attr("class", "chk");
      lab.append("input").attr("type", "checkbox").property("checked", true).on("change", function () {
        if (this.checked) state.lines.add(b); else state.lines.delete(b);
        onLines();
        renderAll();
      });
      lab.append("span").attr("class", "sw").style("background", ink(b, 1.25));
      lab.append("span").text(" " + D.branches[b].label + " ");
      lab.append("span").attr("class", "n").text(n);
    });
    // ---- Find: our own suggestion list, because the browser's <datalist> matches letter for letter and
    // "Arvids" never finds "Arvīds". Matching ignores diacritics and case, takes each typed word as the
    // start of a word in the name (or another name the person went by), and forgives Latvian endings,
    // so "sirlaks" finds Elvīra Sirlaka and "danenberg" finds the Danenbergs.
    var fold = function (x) { return String(x || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); };
    var stem = function (w) { return w.length >= 5 ? w.replace(/(is|us|s|a|e)$/, "") : w; };
    var words = function (x) { return fold(x).split(/[^a-z0-9]+/).filter(Boolean); };
    Q.forEach(function (q) { q.hay = words(q.name); q.akaHay = words((q.aka || []).join(" ")); });
    var findEl = $("findperson"), listEl = $("findlist"), found = [], cur = -1;
    function matches(text) {
      var toks = fold(text).split(/[^a-z0-9]+/).filter(Boolean);
      if (!toks.length) return [];
      var out = [];
      Q.forEach(function (q) {
        var score = 0;
        for (var k = 0; k < toks.length; k++) {
          var t = toks[k], st = stem(t), best = 0;
          var try_ = function (bonus) {                // a word of the name beats a word of another name
            return function (w) {
              if (w === t) best = Math.max(best, 3 + bonus);
              else if (w.indexOf(t) === 0) best = Math.max(best, 2 + bonus);
              else if (st.length >= 3 && w.indexOf(st) === 0) best = Math.max(best, 1 + bonus);
            };
          };
          q.hay.forEach(try_(1));
          q.akaHay.forEach(try_(0));
          if (!best) return;
          score += best;
        }
        out.push({ q: q, score: score + (LINE[q.i] ? 0.5 : 0) });
      });
      return out.sort(function (a, b) { return b.score - a.score || d3.ascending(a.q.name, b.q.name); })
                .slice(0, 10).map(function (x) { return x.q; });
    }
    function showList() {
      found = matches(findEl.value); cur = found.length ? 0 : -1;
      listEl.innerHTML = found.map(function (q, k) {
        // show another name only when it, and not the name itself, is what matched
        var typed = words(findEl.value), inName = typed.every(function (t) {
          return q.hay.some(function (w) { return w.indexOf(t) === 0 || (stem(t).length >= 3 && w.indexOf(stem(t)) === 0); });
        });
        var aka = inName ? null : (q.aka || []).filter(function (a) {
          var aw = words(a); return typed.some(function (t) { return aw.some(function (w) { return w.indexOf(stem(t)) === 0; }); });
        })[0];
        return '<li role="option" id="find-' + k + '" data-k="' + k + '"' + (k === cur ? ' class="on" aria-selected="true"' : "") + ">" +
               esc(q.name) + (aka ? ' <span class="aka">(' + esc(aka) + ")</span>" : "") +
               (q.life ? ' <span class="life">' + esc(q.life) + "</span>" : "") + "</li>";
      }).join("") || (findEl.value.trim() ? '<li class="none">No one by that name on the map</li>' : "");
      listEl.hidden = !findEl.value.trim();
      findEl.setAttribute("aria-expanded", String(!listEl.hidden));
      findEl.setAttribute("aria-activedescendant", cur >= 0 ? "find-" + cur : "");
    }
    function mark(k) {
      cur = k;
      [].forEach.call(listEl.children, function (li, j) { li.classList.toggle("on", j === k); });
      findEl.setAttribute("aria-activedescendant", k >= 0 ? "find-" + k : "");
    }
    function pick(q) {
      onUserZoom();                           // choosing someone moves the map: your own zoom
      findEl.value = q.name; listEl.hidden = true; findEl.setAttribute("aria-expanded", "false");
      select({ kind: "person", i: q.i });
      var pts = q.path.length ? q.path : q.stays;
      var outside = pts.filter(function (st) { return !P[st.p].inLatvia; });
      if (outside.length) zoomTo(world, pts.map(function (st) { return [P[st.p].lon, P[st.p].lat]; }));
    }
    findEl.addEventListener("input", showList);
    findEl.addEventListener("focus", function () { if (findEl.value.trim()) showList(); });
    findEl.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" && found.length) { e.preventDefault(); mark((cur + 1) % found.length); }
      else if (e.key === "ArrowUp" && found.length) { e.preventDefault(); mark((cur - 1 + found.length) % found.length); }
      else if (e.key === "Enter" && cur >= 0) { e.preventDefault(); pick(found[cur]); }
      else if (e.key === "Escape") { listEl.hidden = true; e.stopPropagation(); }
    });
    listEl.addEventListener("mousedown", function (e) {      // mousedown, so it lands before the input blurs
      var li = e.target.closest("li[data-k]");
      if (li) { e.preventDefault(); pick(found[+li.dataset.k]); }
    });
    findEl.addEventListener("blur", function () { setTimeout(function () { listEl.hidden = true; }, 150); });
    // Fit a set of places in a frame, in projected coordinates (no spherical bounds to wrap the wrong way)
    function zoomTo(v, lls) {
      var xy = lls.map(function (ll) { return v.proj(ll); });
      var x0 = d3.min(xy, function (p) { return p[0]; }), x1 = d3.max(xy, function (p) { return p[0]; });
      var y0 = d3.min(xy, function (p) { return p[1]; }), y1 = d3.max(xy, function (p) { return p[1]; });
      var k = Math.max(v.minK || 1, Math.min(40, 0.85 / Math.max((x1 - x0 + 80) / v.W, (y1 - y0 + 80) / v.H)));
      v.svg.transition().duration(650).call(v.zoom.transform,
        d3.zoomIdentity.translate(v.W / 2, v.H / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2));
    }
    $("zoomin").onclick = function () { onUserZoom(); world.svg.transition().duration(250).call(world.zoom.scaleBy, 1.8); };
    $("zoomout").onclick = function () { onUserZoom(); world.svg.transition().duration(250).call(world.zoom.scaleBy, 1 / 1.8); };
    $("zoomreset").onclick = function () {
      onUserZoom();
      views.forEach(function (v) { v.svg.transition().duration(400).call(v.zoom.transform, d3.zoomIdentity); });
    };

    // ------------------------------------------------------------ follow (during Play)
    // The world eases to keep everyone present in view, between the headline and the lenses. Its one
    // rule: nobody is ever left off screen; and when everyone has gathered into much less than the
    // view, it zooms in, at most every 4 s of Play. A dot that is only a country's or a state's centre
    // ("Russia", "Oregon") is not a place anyone lived and does not steer it (Peter: "only 'real' dots"). Your own pan or zoom
    // during Play turns it off; the Follow button turns it back on. Remembered on this computer.
    var FOLLOW_KEY = "family-map-follow", lastFollow = -1e9, followMoving = false;
    // "Russia", "Canada", "Oregon", "Vidzeme": the centre of a country, state or historical region,
    // which nobody lived at. A county, district or parish (Chainsky district, Tomsk oblast) is kept.
    BROAD = { country: 1, state: 1, province: 1, region: 1 };
    var follow = true;
    try { follow = localStorage.getItem(FOLLOW_KEY) !== "off"; } catch (e) { /* private mode */ }
    var followBtn = document.createElement("button");
    followBtn.type = "button"; followBtn.className = "follow";
    followBtn.title = "Keep everyone in view, and each lens's place clear of the lenses (your own pan or zoom turns it off)";
    speedEl.parentNode.insertBefore(followBtn, speedEl.nextSibling);
    function drawFollow() {
      followBtn.classList.toggle("on", follow);
      followBtn.setAttribute("aria-pressed", String(follow));
      followBtn.textContent = (follow ? "◉" : "○") + " Follow";
    }
    function setFollow(on) {
      follow = on;
      try { localStorage.setItem(FOLLOW_KEY, on ? "on" : "off"); } catch (e) { /* ignore */ }
      drawFollow();
      if (on && state.year != null) followYear(Math.floor(state.year), true);
    }
    function onUserZoom() { if (follow && !followMoving) setFollow(false); }   // your own view now
    followBtn.addEventListener("click", function () { setFollow(!follow); });

    // automatic lenses on or off (remembered on this computer); off, the right slot holds Latvia
    var LENS_KEY = "family-map-lenses";
    try { AUTO = localStorage.getItem(LENS_KEY) !== "off"; } catch (e) { /* private mode */ }
    var lensBtn = document.createElement("button");
    lensBtn.type = "button"; lensBtn.className = "follow lensbtn";
    lensBtn.title = "Lenses that follow the story (off: the Latvia inset)";
    followBtn.parentNode.insertBefore(lensBtn, followBtn.nextSibling);
    function drawLensBtn() {
      lensBtn.classList.toggle("on", AUTO);
      lensBtn.setAttribute("aria-pressed", String(AUTO));
      lensBtn.textContent = (AUTO ? "◉" : "○") + " Lenses";
    }
    lensBtn.addEventListener("click", function () {
      AUTO = !AUTO;
      try { localStorage.setItem(LENS_KEY, AUTO ? "on" : "off"); } catch (e) { /* ignore */ }
      slots = slots.map(function (sl) { return sl && sl.pinned ? sl : null; });
      dismissedBoxes = [];
      drawLensBtn();
      scheduleLenses();
    });
    drawLensBtn();
    // the world's zoom changes what overlaps: look again when a zoom or pan comes to rest
    var lensTimer = 0;
    world.zoom.on("end.lenses", function (ev) {   // your own pan or zoom (not Follow's): crowds change with the scale
      if (!ev.sourceEvent) return;
      clearTimeout(lensTimer); lensTimer = setTimeout(scheduleLenses, 250);
    });
    drawFollow();
    function freeRect() {                     // the part of the world frame not under the headline or a lens
      var W = world.W, H = world.H, svgR = world.svg.node().getBoundingClientRect(), s = W / svgR.width;
      var capShown = capEl && !capEl.hidden && getComputedStyle(capEl).display !== "none";
      var f = { x0: 12, y0: capShown ? 70 : 14, x1: W - 56, y1: H - 12 };
      [].forEach.call(document.querySelectorAll("#mapwrap .inset, #mapwrap .timeline"), function (el) {
        if (el.hidden || !el.offsetParent) return;
        var r = el.getBoundingClientRect();
        f.y1 = Math.min(f.y1, (r.top - svgR.top) * s - 10);
      });
      if (f.y1 - f.y0 < 120) f.y1 = H - 12;  // too little room above the lenses: use the whole height
      return f;
    }
    function followYear(fy, force) {
      if (followMoving && !force) return;
      var pts = [];
      Q.forEach(function (q) {
        if (!state.lines.has(q.branch)) return;
        var w = where(q, fy);
        if (!w) return;
        var pl = P[w.p];
        if (BROAD[pl.type] && !w.ll) return;                // only a country's or state's centre
        var ll = w.ll || [pl.lon, pl.lat];
        pts.push(world.proj(ll));
      });
      slots.forEach(function (sl, k) {          // each open lens's box: in view, above the lenses
        if (!sl || slotViews[k].hidden) return;
        [[sl.box[0][0], sl.box[0][1]], [sl.box[1][0], sl.box[1][1]], [sl.box[0][0], sl.box[1][1]], [sl.box[1][0], sl.box[0][1]]]
          .forEach(function (c) { pts.push(world.proj(c)); });
      });
      if (!pts.length) return;
      var f = freeRect(), t = world.t;
      var off = pts.some(function (p) {
        var q = t.apply(p);
        return q[0] < f.x0 || q[0] > f.x1 || q[1] < f.y0 || q[1] > f.y1;
      });
      var x0 = d3.min(pts, function (p) { return p[0]; }), x1 = d3.max(pts, function (p) { return p[0]; });
      var y0 = d3.min(pts, function (p) { return p[1]; }), y1 = d3.max(pts, function (p) { return p[1]; });
      var k = Math.max(world.minK || 0.2, Math.min(3, (f.x1 - f.x0) / Math.max(x1 - x0, 1), (f.y1 - f.y0) / Math.max(y1 - y0, 1)));
      var now = performance.now();
      var gathered = k > t.k * 1.6 && now - lastFollow > 4000 / state.speed;
      if (!off && !gathered && !force) return;
      lastFollow = now;
      var T = d3.zoomIdentity.translate((f.x0 + f.x1) / 2 - k * (x0 + x1) / 2, (f.y0 + f.y1) / 2 - k * (y0 + y1) / 2).scale(k);
      followMoving = true;
      world.svg.transition("follow").duration(Math.round((force ? 500 : 900) / state.speed))
        .call(world.zoom.transform, T)
        .on("end interrupt", function () { followMoving = false; });
    }
    $("play").addEventListener("click", function () {
      if (state.playing && follow) followYear(Math.floor(state.year), true);
    });

    var nRev = Q.filter(function (q) { return q.reviewed; }).length;
    $("mapnote").innerHTML = "A dot is a person. In a given year it sits at the home their itinerary gives for that year: " +
      "where they lived, as a reader judged it from the records (click someone for each home and the reason). Where " +
      "no record says where they were, the dot is a dashed hollow ring at the last place known; it never moves on by " +
      "guesswork. Under <em>All years</em>, everyone is at their last home, and a hollow ring marks someone who has died. " +
      "Bands are migrations between countries (in the US, states), wider for more people. <strong>" + Q.length +
      " of " + D.in_tree + "</strong> people in the tree have a place on record; " + nRev + " of them have a reviewed " +
      "itinerary" + (Q.length - nRev ? ", and the other " + (Q.length - nRev) + " are drawn from their records alone" : "") + ".";

    // ---- page width: the map may use the whole window, not the text column (?wide=0 to compare)
    var app = $("mapapp");
    if (new URLSearchParams(location.search).get("wide") === "1") app.classList.add("bleed");   // the text's width (Peter)

    // ---- the chronicle dock. Open by default when the map keeps >= 860 px beside it; a choice the
    // reader makes (open or close) is remembered and wins from then on. Play opens it unless the reader
    // closed it themselves. Closed, it leaves a thin rail with the year, which opens it again.
    var DOCK_KEY = "family-map-chronicle";
    var remembered = null;
    try { remembered = localStorage.getItem(DOCK_KEY); } catch (e) { /* private mode */ }
    function setDock(open, byReader) {
      app.classList.toggle("chron-closed", !open);
      $("chronrail").hidden = open;
      if (byReader) try { localStorage.setItem(DOCK_KEY, open ? "open" : "closed"); remembered = open ? "open" : "closed"; } catch (e) { /* ignore */ }
      if (open) { lastShownYear = undefined; showChron(state.year); }
    }
    setDock(remembered ? remembered === "open" : app.getBoundingClientRect().width - 336 >= 860, false);
    $("chronclose").addEventListener("click", function () { setDock(false, true); });
    $("chronrail").addEventListener("click", function () { setDock(true, true); });
    $("play").addEventListener("click", function () {
      if (state.playing && remembered !== "closed" && app.classList.contains("chron-closed")) setDock(true, false);
    });
    var railYear = $("railyear");
    var setYear0 = setYear;
    setYear = function (y) { setYear0(y); railYear.textContent = y == null ? "" : Math.floor(y); };

    // ---- full screen: the map, its bar and the chronicle, nothing else
    $("fullscreen").addEventListener("click", function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (app.requestFullscreen) app.requestFullscreen();
    });
    document.addEventListener("fullscreenchange", function () {
      var on = document.fullscreenElement === app;
      app.classList.toggle("full", on);
      if (on) setDock(true, false);            // full screen has room: the chronicle column opens
      lastShownYear = undefined; showChron(state.year);
      setTimeout(function () { drawTimeline(); scheduleLenses(); }, 50);
      $("fullscreen").title = on ? "Leave full screen" : "Full screen";
    });

    // re-fit the maps whenever their box changes size: window, dock, full screen
    var t, pendingFrame = 0;
    function layout() { views.forEach(function (v) { if (!v.hidden || v.isWorld) v.resize(); }); renderAll(); scheduleLenses(); }
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        cancelAnimationFrame(pendingFrame);
        pendingFrame = requestAnimationFrame(layout);
      }).observe($("mapwrap"));
    } else {
      window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(layout, 150); });
    }
    layout();
    setYear(null);
    (function () {                            // ?year=1949 (a year in the chronicle): open the map there
      var y = +new URLSearchParams(location.search).get("year");
      if (y >= y0 && y <= y1) setYear(y);
    })();
  }
})();
