/* Gentis Arbor: the unified family tree viewer.
 *
 * Reads tree.json (written by `famtree site`) and draws a layered DAG with dagre: people and
 * union (couple) nodes, ancestors above descendants. Edges are styled by evidence class. Ghost
 * people are candidates proposed by leads. Everything here is presentation: the data, the
 * classes and the privacy filtering all happen in tools/famtree/site.py.
 */
(function () {
  "use strict";
  const NODE_W = 140, NODE_H = 40, UNION_R = 4;
  const NEAR_GENS = 3;                    // the first view fits the focus and this many generations
  const SPECULATIVE = ["probable", "possible", "weak", "unverified-tree"];
  const REJECTED = ["unlikely", "ruled-out"];
  const FIRM = ["documented", "tradition", "adoptive"];
  const STATUS_ORDER = ["confirmed", "probable", "possible", "open", "weak", "unlikely", "ruled-out"];

  let D, P, U, E, L, LEADS;               // data and indexes
  const byChild = new Map();              // child id -> [edge]
  const byUnion = new Map();              // union id -> [edge]
  const unionsOf = new Map();             // person id -> [union]
  const linksOf = new Map();              // person id -> [link]
  const state = {
    classes: new Set(), ghosts: true, blood: true,
    focus: null, mode: "ancestors", depth: 99, selected: null, orient: "lr",
  };
  let layout = null;                      // last layout: {nodes: Map id -> {x,y}, ...}
  const svg = d3.select("#svg"), vp = d3.select("#viewport");
  // Trackpad convention (Figma, Google Maps, Miro): two-finger scroll PANS, pinch (which the
  // browser reports as a wheel event with ctrlKey) or ctrl/⌘+scroll ZOOMS, drag pans.
  // d3's default (any wheel = zoom) made plain scrolling zoom, which felt wrong on a trackpad.
  const zoom = d3.zoom().scaleExtent([0.04, 3])
    .filter((ev) => ev.type !== "wheel" ? (!ev.ctrlKey || ev.type === "touchstart") && !ev.button
                                        : (ev.ctrlKey || ev.metaKey))
    .wheelDelta((ev) => -ev.deltaY * (ev.deltaMode === 1 ? 0.05 : ev.deltaMode ? 1 : 0.01))
    .on("zoom", (ev) => vp.attr("transform", ev.transform));
  svg.call(zoom).on("dblclick.zoom", null);
  svg.on("wheel.pan", (ev) => {
    if (ev.ctrlKey || ev.metaKey) return;          // zoom path, handled by d3.zoom
    ev.preventDefault();
    const s = ev.deltaMode === 1 ? 16 : ev.deltaMode ? 400 : 1;   // lines/pages → px
    const k = d3.zoomTransform(svg.node()).k;
    zoom.translateBy(svg, -(ev.shiftKey && !ev.deltaX ? ev.deltaY : ev.deltaX) * s / k,
                          -(ev.shiftKey && !ev.deltaX ? 0 : ev.deltaY) * s / k);
  }, { passive: false });

  // ------------------------------------------------------------------ helpers
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  const isGhost = (id) => P.get(id)?.ghost;
  const clsLabel = (c) => D.classes[c]?.label || c;
  const plink = (id, text) => P.has(id) ? `<a class="pl" data-id="${esc(id)}">${esc(text ?? P.get(id).name)}</a>` : esc(text ?? id);
  const badge = (cls, text) => `<span class="badge b-${esc(cls)}">${esc(text ?? clsLabel(cls))}</span>`;
  const stBadge = (st) => `<span class="badge st-${esc(st)}">${esc(st)}</span>`;
  const fold = (s) => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  function trunc(text, px, size) {
    const max = Math.floor(px / (size * 0.53));
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  }

  // ------------------------------------------------------------------ load
  fetch("tree.json", { cache: "no-cache" }).then((r) => r.json()).then(init).catch((err) => {
    d3.select("#status").text("Could not load tree.json: " + err + " (serve this folder over http)");
  });

  function init(data) {
    D = data;
    P = new Map(D.people.map((p) => [p.id, p]));
    U = new Map(D.unions.map((u) => [u.id, u]));
    E = D.edges; L = D.links;
    LEADS = new Map(D.leads.map((l) => [l.id, l]));
    for (const e of E) { push(byChild, e.child, e); push(byUnion, e.union, e); }
    for (const u of D.unions) for (const p of u.partners) push(unionsOf, p, u);
    for (const l of L) { push(linksOf, l.from, l); push(linksOf, l.to, l); }
    Object.keys(D.classes).forEach((c) => state.classes.add(c));

    const m = D.meta, c = m.counts;
    d3.select("#build").text(m.build + " build").classed("private", m.build === "private");
    d3.select("#counts").text(`${c.people} people · ${c.ghosts} candidates · ${c.fs_subtree} FamilySearch-tree · ${E.length} links · ${c.leads} leads · built ${m.generated.replace("T", " ")}`);
    d3.select("#nleads").text(`(${D.leads.length})`);
    d3.select("#about").html(m.build === "public"
      ? "Public build: living people appear by name only; DNA match data, private sources and leads about living people are withheld."
      : "<b>PRIVATE build</b>: living people, private sources and every lead. Do not publish.");
    buildLegend();
    buildLeadsTab();
    buildHelp();
    wireControls();
    const h = decodeURIComponent(location.hash.slice(1));
    if (h && P.has(h)) { state.focus = h; state.mode = "both"; state.depth = 3; state.selected = h; }
    else state.focus = m.proband;
    syncControls();
    render(true);
    if (state.selected) showPerson(state.selected);
  }

  // ------------------------------------------------------------------ legend & controls
  function edgeSample(cls) {
    const s = `<svg width="46" height="12"><path d="M2 6 H44" class="e e-${cls}"/>` +
      (cls === "adoptive" ? `<path d="M2 6 H44" class="e-adoptive-core"/>` : "") +
      (REJECTED.includes(cls) ? `<text x="23" y="6" class="xmark">✕</text>` : "") + `</svg>`;
    return s;
  }

  function classCount(cls) {
    return E.filter((e) => e.cls === cls).length + L.filter((l) => l.cls === cls).length;
  }

  function buildLegend() {
    const box = d3.select("#classes");
    for (const [cls, info] of Object.entries(D.classes)) {
      const n = classCount(cls);
      const row = box.append("label").attr("class", "cls").attr("title", info.desc);
      row.append("input").attr("type", "checkbox").attr("value", cls).property("checked", true)
        .on("change", function () { this.checked ? state.classes.add(cls) : state.classes.delete(cls); render(true); });
      row.append("span").html(edgeSample(cls));
      row.append("span").text(info.label);
      row.append("span").attr("class", "n").text(n);
    }
    const bb = d3.select("#branches");
    const used = new Set(D.people.map((p) => p.branch));
    for (const [k, b] of Object.entries(D.branches)) {
      if (!used.has(k)) continue;
      bb.append("div").attr("class", "br").html(`<i style="background:${b.color}"></i>${esc(b.label)}`);
    }
  }

  function setClasses(list, on) {
    for (const c of list) on ? state.classes.add(c) : state.classes.delete(c);
    d3.selectAll("#classes input").property("checked", function () { return state.classes.has(this.value); });
    render(true);
  }

  function wireControls() {
    d3.select("#mode").on("change", function () { state.mode = this.value; render(true); });
    d3.select("#depth").on("change", function () { state.depth = +this.value; render(true); });
    d3.select("#blood").on("change", function () { state.blood = this.checked; render(true); });
    d3.select("#orient").on("change", function () { state.orient = this.value; render(true); });
    d3.select("#ghosts").on("change", function () { state.ghosts = this.checked; render(true); });
    d3.select("#reset").on("click", reset);
    d3.select("#fit").on("click", () => fit());
    d3.select("#spec-toggle").on("click", (ev) => { ev.preventDefault(); setClasses(SPECULATIVE, !SPECULATIVE.every((c) => state.classes.has(c))); });
    d3.select("#rej-toggle").on("click", (ev) => { ev.preventDefault(); setClasses(REJECTED, !REJECTED.every((c) => state.classes.has(c))); });
    d3.select("#all-toggle").on("click", (ev) => { ev.preventDefault(); setClasses(Object.keys(D.classes), true); });
    d3.select("#focusname").on("click", (ev) => { ev.preventDefault(); if (state.focus) { select(state.focus); centerOn(state.focus); } });
    d3.selectAll(".tabs button").on("click", function () { tab(this.dataset.tab); });
    // search
    const input = d3.select("#search"), res = d3.select("#results");
    let hits = [], cur = -1;
    input.on("input", function () {
      const q = fold(this.value.trim());
      res.html(""); hits = []; cur = -1;
      if (q.length < 2) return;
      for (const p of D.people) {
        const hay = fold([p.name, ...(p.aka || [])].join(" | "));
        if (hay.includes(q)) hits.push(p);
        if (hits.length >= 25) break;
      }
      hits.sort((a, b) => (a.ghost ? 1 : 0) - (b.ghost ? 1 : 0) || a.name.localeCompare(b.name));
      res.selectAll("li").data(hits).join("li")
        .html((p) => `${esc(p.name)} <small>${esc(p.life || (p.living ? "living" : ""))}${p.ghost ? " · candidate" : ""}</small>`)
        .on("mousedown", (ev, p) => { ev.preventDefault(); goTo(p.id); });
    });
    input.on("keydown", (ev) => {
      const items = res.selectAll("li");
      if (ev.key === "ArrowDown") { cur = Math.min(cur + 1, hits.length - 1); }
      else if (ev.key === "ArrowUp") { cur = Math.max(cur - 1, 0); }
      else if (ev.key === "Enter" && hits.length) { goTo(hits[Math.max(cur, 0)].id); return; }
      else if (ev.key === "Escape") { res.html(""); return; }
      else return;
      items.classed("on", (d, i) => i === cur);
      ev.preventDefault();
    });
    input.on("blur", () => setTimeout(() => res.html(""), 150));
    // panel links (event delegation)
    d3.select("#panel").on("click", (ev) => {
      const a = ev.target.closest("a.pl");
      if (a) { ev.preventDefault(); goTo(a.dataset.id); return; }
      const c = ev.target.closest("a.cite");
      if (c) {
        ev.preventDefault();
        const li = document.getElementById(c.dataset.target);
        if (li) { li.scrollIntoView({ block: "center", behavior: "smooth" }); li.classList.add("flash"); setTimeout(() => li.classList.remove("flash"), 1500); }
      }
      const f = ev.target.closest("a.focus");
      if (f) { ev.preventDefault(); refocus(f.dataset.id, f.dataset.mode || "both", +(f.dataset.depth || 3)); }
    });
    window.addEventListener("resize", () => fit());
  }

  function syncControls() {
    d3.select("#mode").property("value", state.mode);
    d3.select("#depth").property("value", String(state.depth));
    d3.select("#blood").property("checked", state.blood);
    d3.select("#orient").property("value", state.orient);
    d3.select("#ghosts").property("checked", state.ghosts);
    d3.select("#focusname").text(state.focus && P.has(state.focus) ? P.get(state.focus).name : "—");
  }

  function reset() {
    state.focus = D.meta.proband; state.mode = "ancestors"; state.depth = 99; state.blood = true; state.ghosts = true;
    setClasses(Object.keys(D.classes), true);
    syncControls(); render(true);
  }

  function refocus(id, mode, depth) {
    state.focus = id; state.mode = mode; state.depth = depth;
    syncControls(); render(true); select(id);
  }

  function goTo(id) {
    d3.select("#results").html(""); d3.select("#search").property("value", "");
    if (!layout || !layout.nodes.has(id)) {
      // make sure it can be seen: its classes on, ghosts on, then focus on it
      if (isGhost(id)) { state.ghosts = true; const c = P.get(id).cls; if (c) state.classes.add(c); }
      d3.selectAll("#classes input").property("checked", function () { return state.classes.has(this.value); });
      state.focus = id; state.mode = "both"; state.depth = 3;
      syncControls(); render(true);
    }
    select(id); centerOn(id);
  }

  function tab(name) {
    d3.selectAll(".tabs button").classed("on", function () { return this.dataset.tab === name; });
    d3.selectAll(".tab").classed("on", function () { return this.id === "tab-" + name; });
  }

  // ------------------------------------------------------------------ visibility
  function edgeOn(e) { return state.classes.has(e.cls); }
  function linkOn(l) { return state.ghosts && state.classes.has(l.cls); }
  function partnerOn(u, p) { const c = (u.pcls || {})[p]; return !c || state.classes.has(c); }
  function nodeAllowed(id) { return state.ghosts || !isGhost(id); }

  /** Everything reachable from the real tree through enabled links. */
  function reachable() {
    const R = new Set(), RU = new Set();
    const q = [];
    for (const p of D.people) if (!p.ghost) { R.add(p.id); q.push(p.id); }
    const addP = (id) => { if (!R.has(id) && nodeAllowed(id)) { R.add(id); q.push(id); } };
    const addU = (u) => {
      if (RU.has(u.id)) return; RU.add(u.id);
      for (const p of u.partners) if (partnerOn(u, p)) addP(p);
      for (const e of byUnion.get(u.id) || []) if (edgeOn(e)) addP(e.child);
    };
    while (q.length) {
      const x = q.pop();
      for (const u of unionsOf.get(x) || []) if (partnerOn(u, x)) addU(u);
      for (const e of byChild.get(x) || []) if (edgeOn(e)) addU(U.get(e.union));
      for (const l of linksOf.get(x) || []) if (linkOn(l)) addP(l.from === x ? l.to : l.from);
    }
    // a union needs a partner or a child that can be seen
    return { R, RU };
  }

  /** The focus subgraph: ancestors and/or descendants of the focus within N generations. */
  function focusSet(R, RU) {
    const F = new Set([state.focus]), FU = new Set();
    const okU = (u) => RU.has(u.id);
    const up = (x, d) => {
      if (d >= state.depth) return;
      for (const e of byChild.get(x) || []) {
        if (!edgeOn(e) || (state.blood && e.cls === "adoptive")) continue;
        const u = U.get(e.union); if (!okU(u)) continue;
        FU.add(u.id);
        for (const p of u.partners) if (R.has(p) && partnerOn(u, p) && !F.has(p)) { F.add(p); up(p, d + 1); }
      }
    };
    const down = (x, d) => {
      if (d >= state.depth) return;
      for (const u of unionsOf.get(x) || []) {
        if (!okU(u) || !partnerOn(u, x)) continue;
        const kids = (byUnion.get(u.id) || []).filter((e) => edgeOn(e) && R.has(e.child) && !(state.blood && e.cls === "adoptive" && false));
        if (!kids.length && u.partners.length < 2) continue;
        FU.add(u.id);
        for (const p of u.partners) if (R.has(p) && partnerOn(u, p)) F.add(p);
        for (const e of kids) if (!F.has(e.child)) { F.add(e.child); down(e.child, d + 1); }
      }
    };
    if (state.mode === "ancestors" || state.mode === "both") up(state.focus, 0);
    if (state.mode === "descendants" || state.mode === "both") down(state.focus, 0);
    // context: identity / kin candidates of everyone shown, and candidate siblings of ancestors
    for (let pass = 0; pass < 2; pass++) {
      for (const x of [...F]) {
        for (const l of linksOf.get(x) || []) {
          if (!linkOn(l)) continue;
          // kin a generation below has no place in an ancestors view (nor above, in descendants)
          if (l.kind === "kin" && l.generation && ((state.mode === "ancestors" && l.generation < 0) || (state.mode === "descendants" && l.generation > 0))) continue;
          const o = l.from === x ? l.to : l.from;
          if (R.has(o) && isGhost(o)) {
            F.add(o);
            for (const e of byChild.get(o) || []) {   // its own (candidate) parents, if shown already
              const u = U.get(e.union);
              if (edgeOn(e) && u.partners.some((p) => F.has(p))) FU.add(u.id);
            }
          }
        }
      }
      for (const uid of [...FU]) {
        for (const e of byUnion.get(uid) || []) if (edgeOn(e) && R.has(e.child) && isGhost(e.child)) F.add(e.child);
        for (const p of U.get(uid).partners) if (R.has(p) && partnerOn(U.get(uid), p) && isGhost(p)) F.add(p);
      }
    }
    return { F, FU };
  }

  function visibleGraph() {
    const { R, RU } = reachable();
    let N = R, NU = RU;
    if (state.mode !== "all" && state.focus && R.has(state.focus)) ({ F: N, FU: NU } = focusSet(R, RU));
    // unions: keep those touching at least two visible things
    const unions = [];
    for (const uid of NU) {
      const u = U.get(uid);
      const ps = u.partners.filter((p) => N.has(p) && partnerOn(u, p));
      const ks = (byUnion.get(uid) || []).filter((e) => edgeOn(e) && N.has(e.child));
      if (ps.length + ks.length >= 2 || (ks.length && !u.partners.length)) unions.push({ u, ps, ks });
    }
    const links = L.filter((l) => linkOn(l) && N.has(l.from) && N.has(l.to));
    return { people: [...N].filter((id) => P.has(id)), unions, links };
  }

  // ------------------------------------------------------------------ layout
  function dagreLayout(vis) {
    const g = new dagre.graphlib.Graph({ multigraph: true });
    const lr = state.orient === "lr";
    g.setGraph({ rankdir: lr ? "LR" : "TB", nodesep: lr ? 8 : 16, ranksep: lr ? 28 : 34, edgesep: 6, marginx: 30, marginy: 30 });
    g.setDefaultEdgeLabel(() => ({}));
    // dagre's initial order follows insertion order, so insert in pedigree order from the focus:
    // father's side before mother's, real parents before candidates.
    const order = traversalOrder(vis);
    const rankOf = new Map(order.map((id, i) => [id, i]));
    const unionsSorted = vis.unions.slice().sort((a, b) => (rankOf.get(a.u.id) ?? 1e9) - (rankOf.get(b.u.id) ?? 1e9));
    for (const id of order) {
      if (P.has(id)) g.setNode(id, { width: NODE_W, height: NODE_H });
      else g.setNode(id, { width: UNION_R * 2, height: UNION_R * 2, union: true });
    }
    const parentU = new Map(), partnerU = new Map(), firmU = new Map();
    for (const { u, ps, ks } of unionsSorted) {
      for (const p of ps) { g.setEdge(p, u.id, { minlen: 1, weight: 3, kind: "p", cls: (u.pcls || {})[p] }, `p:${p}:${u.id}`); push(partnerU, p, u.id); }
      for (const e of ks) {
        const firm = FIRM.includes(e.cls);
        g.setEdge(u.id, e.child, { minlen: 1, weight: firm ? 3 : 1, kind: "e", edge: e }, `e:${e.id}`);
        push(parentU, e.child, u.id);
        if (firm) push(firmU, e.child, u.id);
      }
    }
    const satellites = [];
    for (const l of vis.links) {
      if (l.kind === "kin" && l.generation) {
        const [a, b] = l.generation > 0 ? [l.from, l.to] : [l.to, l.from];
        g.setEdge(a, b, { minlen: 2 * Math.abs(l.generation), weight: 0.2, kind: "l", link: l }, `l:${l.id}`);
      } else {
        // same generation: hang the ghost from the person's parents' union, or above their own union
        // prefer the person's real parents, then their own couple; a candidate couple may be far away
        const pu = (firmU.get(l.to) || [])[0], su = (partnerU.get(l.to) || [])[0];
        const ghostHasParents = (parentU.get(l.from) || []).length > 0;
        if (pu && !ghostHasParents) g.setEdge(pu, l.from, { minlen: 1, weight: 0.5, kind: "anchor" }, `a:${l.id}`);
        else if (su && !ghostHasParents) g.setEdge(l.from, su, { minlen: 1, weight: 0.1, kind: "anchor" }, `a:${l.id}`);
        else if (!ghostHasParents) satellites.push(l);
      }
    }
    dagre.layout(g);
    const nodes = new Map();
    for (const id of g.nodes()) { const n = g.node(id); if (n) nodes.set(id, n); }
    // satellites: beside their person, stacked
    const stack = new Map();
    for (const l of satellites) {
      const t = nodes.get(l.to), gn = nodes.get(l.from);
      if (!t || !gn) continue;
      const k = (stack.get(l.to) || 0) + 1; stack.set(l.to, k);
      if (lr) { gn.x = t.x; gn.y = t.y + (NODE_H + 8) * k; } else { gn.x = t.x + (NODE_W + 14) * k; gn.y = t.y; }
    }
    const edges = g.edges().map((ed) => ({ ...g.edge(ed), v: ed.v, w: ed.w }));
    const gr = g.graph();
    return { nodes, edges, vis, lr, width: gr.width, height: gr.height };
  }

  function computeLayout(vis) {
    if ((state.mode === "ancestors" || state.mode === "descendants") && state.focus && vis.people.includes(state.focus))
      return treeLayout(vis, state.mode === "ancestors" ? -1 : 1);
    return dagreLayout(vis);
  }

  /** A tidy tree (Reingold–Tilford, d3.tree) from the focus: up through parent unions
   *  (ancestors) or down through own unions (descendants). Same-generation extras — candidate
   *  siblings, identities, kin, spouses — sit beside the person they belong to. */
  function treeLayout(vis, dir) {
    const people = new Set(vis.people), us = new Map(vis.unions.map((x) => [x.u.id, x]));
    const placed = new Set();
    const sexKey = (id) => ({ M: 0, U: 1, F: 2 }[P.get(id)?.sex] ?? 1);
    const firmKey = (e) => (FIRM.includes(e.cls) ? 0 : 1);
    let phantom = 0;
    const ph = (children) => ({ id: "ph:" + (phantom++), phantom: true, children });

    // extras that sit at a person's level (returned to be inserted beside them)
    function extrasOf(id, viaUnion) {
      const out = [];
      for (const l of linksOf.get(id) || []) {
        const o = l.from === id ? l.to : l.from;
        if (!vis.links.includes(l) || placed.has(o)) continue;
        if (l.kind === "kin" && l.generation) continue;   // kinAbove, or a satellite
        placed.add(o); out.push({ id: o, children: [] });
      }
      if (dir < 0 && viaUnion) {
        // candidate siblings: ghost children of the union this person came from
        for (const e of byChild.get(id) || []) {
          const x = us.get(e.union); if (!x) continue;
          for (const k of x.ks) if (k.child !== id && isGhost(k.child) && !placed.has(k.child) && people.has(k.child)) { placed.add(k.child); out.push(build(k.child)); }
        }
      }
      return out;
    }

    function kinAbove(id) {
      // kin candidates one or more generations above (ancestors view): phantom chain to their row
      const out = [];
      for (const l of linksOf.get(id) || []) {
        if (!vis.links.includes(l) || l.kind !== "kin" || !l.generation || l.to !== id) continue;
        if ((dir < 0) !== (l.generation > 0)) continue;
        const o = l.from; if (placed.has(o)) continue;
        placed.add(o);
        let node = build(o, true);
        for (let i = 0; i < 2 * Math.abs(l.generation) - 1; i++) node = ph([node]);
        out.push(node);
      }
      return out;
    }

    function build(id, already) {
      if (!already) placed.add(id);
      const node = { id, children: [] };
      if (dir < 0) {
        const pe = (byChild.get(id) || []).filter((e) => us.has(e.union) && edgeOn(e)).sort((a, b) => firmKey(a) - firmKey(b));
        for (const e of pe) {
          if (placed.has(e.union)) continue;
          placed.add(e.union);
          const x = us.get(e.union);
          const un = { id: e.union, union: true, children: [] };
          for (const p of x.ps.slice().sort((a, b) => sexKey(a) - sexKey(b))) {
            if (placed.has(p)) continue;
            un.children.push(build(p));
            un.children.push(...extrasOf(p, true));
          }
          node.children.push(un);
        }
      } else {
        for (const u of unionsOf.get(id) || []) {
          const x = us.get(u.id); if (!x || placed.has(u.id)) continue;
          placed.add(u.id);
          const un = { id: u.id, union: true, children: [] };
          for (const e of x.ks) if (!placed.has(e.child)) { un.children.push(build(e.child)); un.children.push(...extrasOf(e.child, false)); }
          node.children.push(un);
        }
      }
      node.children.push(...kinAbove(id));
      return node;
    }

    // spouses (descendants view) sit beside the person: collect them as extras of the partner
    const spouseExtras = (id) => {
      const out = [];
      if (dir > 0) for (const u of unionsOf.get(id) || []) {
        const x = us.get(u.id); if (!x) continue;
        for (const p of x.ps) if (p !== id && !placed.has(p)) { placed.add(p); out.push({ id: p, children: [] }); }
      }
      return out;
    };
    placed.add(state.focus);
    const focusExtras = [...extrasOf(state.focus, false), ...spouseExtras(state.focus)];
    const focusNode = build(state.focus, true);
    const root = ph([focusNode, ...focusExtras]);
    if (dir > 0) {
      // add spouse extras level by level (the tree is built; walk it)
      const walk = (n) => {
        for (const c of n.children) {
          if (c.union) for (let i = 0; i < c.children.length; i++) {
            const ch = c.children[i];
            if (!ch.phantom && !ch.union) { const ex = spouseExtras(ch.id); c.children.splice(i + 1, 0, ...ex); i += ex.length; }
          }
          walk(c);
        }
      };
      walk(root);
    }
    const lr = state.orient === "lr";
    // breadth step (between siblings) and depth step (half a generation: unions sit between)
    const dx = lr ? NODE_H + 10 : NODE_W + 14, dy = lr ? (NODE_W + 56) / 2 : (NODE_H + 40) / 2;
    const h = d3.hierarchy(root);
    d3.tree().nodeSize([dx, dy]).separation((a, b) => {
      const small = (n) => n.data.union || n.data.phantom;
      const s = small(a) && small(b) ? 0.35 : small(a) || small(b) ? 0.6 : 1;
      return a.parent === b.parent ? s : s * 1.12;
    })(h);
    const nodes = new Map();
    // ancestors go up (TB) or left (LR); descendants down or right
    const place = (b, d) => (lr ? { x: dir * d, y: b } : { x: b, y: dir * d });
    h.each((n) => { if (!n.data.phantom) nodes.set(n.data.id, { ...place(n.x, n.depth * dy), near: n.depth <= 1 + 2 * NEAR_GENS }); });
    // anything visible but not reached: beside the person it is linked to, else in a row
    const bbox = () => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const n of nodes.values()) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); }
      return { x0, x1, y0, y1 };
    };
    let bb = bbox(), k = 0;
    for (const id of vis.people) if (!nodes.has(id)) {
      k++;
      const l = (linksOf.get(id) || []).find((x) => nodes.has(x.from === id ? x.to : x.from));
      const t = l && nodes.get(l.from === id ? l.to : l.from);
      if (t) nodes.set(id, lr ? { x: t.x + NODE_W * 0.3, y: t.y + (NODE_H + 8) * k } : { x: t.x + dx * 0.5, y: t.y + (NODE_H + 12) });
      else nodes.set(id, lr ? { x: bb.x0, y: bb.y1 + dx * k } : { x: bb.x1 + dx * k, y: bb.y0 });
    }
    // normalise to a positive box
    bb = bbox();
    const ox = -bb.x0 + NODE_W / 2 + 30, oy = -bb.y0 + NODE_H / 2 + 30;
    for (const n of nodes.values()) { n.x += ox; n.y += oy; }
    const maxX = bb.x1 + ox, maxY = bb.y1 + oy;
    // edges, drawn from positions: an S-curve leaving a box on the side that faces its target
    const edges = [];
    const S = (a, b) => {
      if (lr) { const m = (a.x + b.x) / 2; return [a, { x: m, y: a.y }, { x: m, y: b.y }, b]; }
      const m = (a.y + b.y) / 2; return [a, { x: a.x, y: m }, { x: b.x, y: m }, b];
    };
    const side = (n, toward) => (lr ? { x: n.x + Math.sign(toward.x - n.x) * NODE_W / 2, y: n.y }
                                    : { x: n.x, y: n.y + Math.sign(toward.y - n.y) * NODE_H / 2 });
    for (const { u, ps, ks } of vis.unions) {
      const un = nodes.get(u.id);
      if (!un) continue;
      const uc = { x: un.x, y: un.y };
      for (const p of ps) {
        const pn = nodes.get(p); if (!pn) continue;
        edges.push({ kind: "p", cls: (u.pcls || {})[p], final: true, points: S(side(pn, uc), uc) });
      }
      for (const e of ks) {
        const cn = nodes.get(e.child); if (!cn) continue;
        edges.push({ kind: "e", edge: e, final: true, points: S(uc, side(cn, uc)) });
      }
    }
    for (const l of vis.links) {
      if (!(l.kind === "kin" && l.generation)) continue;
      const a = nodes.get(l.from), b = nodes.get(l.to); if (!a || !b) continue;
      edges.push({ kind: "l", link: l, final: true, points: S(side(a, b), side(b, a)) });
    }
    const nearNodes = [...nodes.values()].filter((n) => n.near);
    const near = nearNodes.length ? {
      x0: d3.min(nearNodes, (n) => n.x) - NODE_W / 2 - 20, x1: d3.max(nearNodes, (n) => n.x) + NODE_W / 2 + 20,
      y0: d3.min(nearNodes, (n) => n.y) - NODE_H / 2 - 20, y1: d3.max(nearNodes, (n) => n.y) + NODE_H / 2 + 20 } : null;
    return { nodes, edges, vis, near, lr, width: maxX + NODE_W / 2 + 30, height: maxY + NODE_H / 2 + 30 };
  }

  function traversalOrder(vis) {
    const people = new Set(vis.people), us = new Map(vis.unions.map((x) => [x.u.id, x]));
    const seen = new Set(), order = [];
    const sexKey = (id) => ({ M: 0, U: 1, F: 2 }[P.get(id)?.sex] ?? 1);
    const firmKey = (e) => (FIRM.includes(e.cls) ? 0 : 1);
    const visitP = (id) => {
      if (seen.has(id) || !people.has(id)) return;
      seen.add(id);
      const pe = (byChild.get(id) || []).filter((e) => us.has(e.union)).sort((a, b) => firmKey(a) - firmKey(b));
      for (const e of pe) visitU(e.union);
      order.push(id);
      for (const l of linksOf.get(id) || []) visitP(l.from === id ? l.to : l.from);
      for (const u of unionsOf.get(id) || []) if (us.has(u.id)) visitU(u.id);
    };
    const visitU = (uid) => {
      if (seen.has(uid)) return;
      seen.add(uid);
      const x = us.get(uid);
      for (const p of x.ps.slice().sort((a, b) => sexKey(a) - sexKey(b))) visitP(p);
      order.push(uid);
      for (const e of x.ks) visitP(e.child);
    };
    if (state.focus) visitP(state.focus);
    for (const id of vis.people) visitP(id);
    for (const x of vis.unions) visitU(x.u.id);
    return order;
  }

  // ------------------------------------------------------------------ draw
  const line = d3.line().x((d) => d.x).y((d) => d.y).curve(d3.curveBasis);

  function edgePoints(ed, nodes) {
    // dagre's points start/end at node borders; anchor partner lines at the union centre
    const pts = (ed.points || []).slice();
    if (ed.final) return pts;
    const w = nodes.get(ed.w), v = nodes.get(ed.v);
    if (ed.kind === "p" && w) pts[pts.length - 1] = { x: w.x, y: w.y };
    if (ed.kind === "e" && v) pts[0] = { x: v.x, y: v.y };
    return pts;
  }

  function render(refit) {
    const vis = visibleGraph();
    layout = computeLayout(vis);
    const { nodes, edges } = layout;
    vp.selectAll("*").remove();
    const gE = vp.append("g").attr("class", "edges");
    const gL = vp.append("g").attr("class", "links");
    const gN = vp.append("g").attr("class", "nodes");

    for (const ed of edges) {
      if (ed.kind === "anchor") continue;
      const pts = edgePoints(ed, nodes);
      if (!pts.length) continue;
      if (ed.kind === "p") {
        gE.append("path").attr("class", "p" + (ed.cls ? " pc-" + ed.cls : "")).attr("d", line(pts));
      } else if (ed.kind === "e") {
        const c = ed.edge.cls;
        const path = gE.append("path").attr("class", `e e-${c}`).attr("d", line(pts))
          .append("title").text(`${clsLabel(c)}${ed.edge.lead && LEADS.get(ed.edge.lead) ? " — " + LEADS.get(ed.edge.lead).title : ""}`);
        if (c === "adoptive") gE.append("path").attr("class", "e-adoptive-core").attr("d", line(pts));
        if (REJECTED.includes(c)) mark(gE, pts, "✕", "xmark");
      } else if (ed.kind === "l") {
        const l = ed.link;
        gL.append("path").attr("class", `e e-${l.cls}`).attr("d", line(pts)).append("title").text(`${l.label} (${clsLabel(l.cls)})`);
        label(gL, pts, l.label + (REJECTED.includes(l.cls) ? " ✕" : ""), REJECTED.includes(l.cls));
      }
    }
    // same-generation links: between facing box sides (beside each other in TB, stacked in LR)
    for (const l of vis.links) {
      if (l.kind === "kin" && l.generation) continue;
      const a = nodes.get(l.from), b = nodes.get(l.to);
      if (!a || !b) continue;
      const horiz = Math.abs(a.x - b.x) > NODE_W * 0.9 || (!layout.lr && Math.abs(a.y - b.y) < NODE_H);
      let p1, p2, mid;
      if (horiz) {
        const d = a.x < b.x ? 1 : -1;
        p1 = { x: a.x + d * NODE_W / 2, y: a.y }; p2 = { x: b.x - d * NODE_W / 2, y: b.y };
      } else {
        const d = a.y < b.y ? 1 : -1;
        p1 = { x: a.x, y: a.y + d * NODE_H / 2 }; p2 = { x: b.x, y: b.y - d * NODE_H / 2 };
      }
      mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const pts = horiz ? [p1, { x: mid.x, y: p1.y }, { x: mid.x, y: p2.y }, p2] : [p1, { x: p1.x, y: mid.y }, { x: p2.x, y: mid.y }, p2];
      gL.append("path").attr("class", `e e-${l.cls}`).attr("d", line(pts))
        .append("title").text(`${l.label} (${clsLabel(l.cls)})${LEADS.get(l.lead) ? " — " + LEADS.get(l.lead).title : ""}`);
      const txt = (l.kind === "identity" ? "= ?" : l.label) + (REJECTED.includes(l.cls) ? " ✕" : "");
      gL.append("text").attr("class", "llabel" + (REJECTED.includes(l.cls) ? " rej" : "")).attr("x", horiz ? mid.x : mid.x + 6)
        .attr("y", horiz ? mid.y - 4 : mid.y + 3).attr("text-anchor", horiz ? "middle" : "start").text(txt);
    }
    // unions
    for (const { u } of vis.unions) {
      const n = nodes.get(u.id); if (!n) continue;
      gN.append("circle").attr("class", "union" + (u.ghost ? " ghost" : "")).attr("cx", n.x).attr("cy", n.y).attr("r", UNION_R)
        .append("title").text(unionTitle(u));
    }
    // people
    for (const id of vis.people) {
      const n = nodes.get(id), p = P.get(id); if (!n) continue;
      drawNode(gN, p, n);
    }
    d3.select("#status").text(`${vis.people.length} people shown · ${state.mode === "all" ? "whole tree" : state.mode + " of " + (P.get(state.focus)?.name || "?") + (state.depth < 99 ? `, ${state.depth} gen.` : "")}`);
    if (refit) {
      // a wide drawing fitted whole is unreadable: start at reading size on the focus instead
      if (fitScale() < 0.3 && layout.near) fitBox(layout.near, 0.42);
      else if (fitScale() < 0.22 && state.focus && nodes.has(state.focus)) centerOn(state.focus, 0.6, true);
      else fit();
    }
    highlight();
  }

  function unionTitle(u) {
    const names = u.partners.map((p) => P.get(p)?.name || p).join(" × ") || "parents unknown";
    const f = (u.facts || []).map((x) => `${x.type}${x.form ? " (" + x.form + ")" : ""} ${x.date || ""} ${x.place || ""}`.trim()).join("; ");
    return names + (f ? "\n" + f : "") + (u.note ? "\n" + u.note : "");
  }

  function mark(g, pts, text, cls) {
    const m = pts[Math.floor(pts.length / 2)];
    g.append("text").attr("class", cls).attr("x", m.x).attr("y", m.y).text(text);
  }
  function label(g, pts, text, rej) {
    const m = pts[Math.floor(pts.length / 2)];
    g.append("text").attr("class", "llabel" + (rej ? " rej" : "")).attr("x", m.x + 4).attr("y", m.y).attr("text-anchor", "start").text(text);
  }

  function drawNode(g, p, n) {
    const x = n.x - NODE_W / 2, y = n.y - NODE_H / 2;
    const cls = ["node"];
    if (p.ghost) cls.push("ghost");
    if (p.living) cls.push("living");
    const grp = g.append("g").attr("class", cls.join(" ")).attr("data-id", p.id).attr("transform", `translate(${x},${y})`);
    const fill = (D.branches[p.branch] || D.branches.other).color;
    const rect = grp.append("rect").attr("class", "box").attr("width", NODE_W).attr("height", NODE_H).attr("rx", 4).attr("fill", fill);
    if (p.ghost) rect.attr("stroke", ghostStroke(p.cls));
    grp.append("text").attr("class", "nm").attr("x", 7).attr("y", 16).text(trunc(p.name, NODE_W - 12, 11));
    let sub;
    if (p.living && !p.birth) sub = "living";
    else {
      const place = (p.birth && p.birth.short) || p.place || "";
      sub = [p.life, place].filter(Boolean).join(" · ");
      if (p.ghost && !sub) sub = clsLabel(p.cls).toLowerCase();
    }
    grp.append("text").attr("class", "sub").attr("x", 7).attr("y", 31).text(trunc(sub, NODE_W - 12, 9.5));
    if (p.evidence && p.evidence.facts) {
      const ev = p.evidence, w = NODE_W - 8, tot = ev.facts;
      let off = 4;
      for (const [k, col] of [["sourced", "#4a8a3a"], ["tree_only", "#d9a441"], ["legacy_only", "#b9b9b9"]]) {
        const ww = w * (ev[k] || 0) / tot;
        if (ww > 0) grp.append("rect").attr("x", off).attr("y", NODE_H - 4.5).attr("width", ww).attr("height", 2.5).attr("fill", col);
        off += ww;
      }
    }
    grp.append("title").text(`${p.name}${p.life ? " (" + p.life + ")" : ""}${p.ghost ? "\nCandidate — " + clsLabel(p.cls) + (p.fs ? " (FamilySearch tree, unverified)" : "") : ""}`);
    grp.on("click", (ev) => { ev.stopPropagation(); select(p.id); })
      .on("dblclick", (ev) => { ev.stopPropagation(); refocus(p.id, state.mode === "all" ? "both" : state.mode, state.mode === "all" ? 3 : state.depth); });
  }

  function ghostStroke(cls) {
    return REJECTED.includes(cls) ? "#b03a2e" : cls === "unverified-tree" ? "#8a6fc4" : "#666";
  }

  function highlight() {
    vp.selectAll(".node").classed("sel", function () { return this.dataset.id === state.selected; })
      .classed("focus", function () { return this.dataset.id === state.focus && state.mode !== "all" && this.dataset.id !== state.selected; });
  }

  function fitScale() {
    const gr = layout;
    const box = document.getElementById("svg").getBoundingClientRect();
    return Math.min(box.width / gr.width, box.height / gr.height, 1.1) * 0.96;
  }

  function fit() {
    if (!layout) return;
    const gr = layout;
    const box = document.getElementById("svg").getBoundingClientRect();
    if (!gr.width || !box.width) return;
    const k = fitScale();
    const tx = (box.width - gr.width * k) / 2, ty = Math.max(10, (box.height - gr.height * k) / 2);
    svg.transition().duration(350).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
  }

  function fitBox(b, minK) {
    const box = document.getElementById("svg").getBoundingClientRect();
    const w = b.x1 - b.x0, hgt = b.y1 - b.y0;
    const k = Math.max(minK || 0, Math.min(box.width / w, box.height / hgt, 1.1) * 0.96);
    const f = layout.nodes.get(state.focus);
    // centre the box; if it is still too wide, centre on the focus horizontally
    let tx = (box.width - w * k) / 2 - b.x0 * k;
    if (w * k > box.width && f) tx = box.width / 2 - f.x * k;
    let ty = (box.height - hgt * k) / 2 - b.y0 * k;
    if (hgt * k > box.height && f) ty = box.height / 2 - f.y * k;
    svg.transition().duration(350).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
  }

  function centerOn(id, scale, low) {
    const n = layout && layout.nodes.get(id); if (!n) return;
    const box = document.getElementById("svg").getBoundingClientRect();
    const t = d3.zoomTransform(svg.node());
    const k = scale || Math.max(t.k, 0.75);
    // low: put the person in the lower part of the window (ancestors fill the space above)
    const anc = low && state.mode === "ancestors";
    const cy = anc && !layout.lr ? box.height * 0.78 : box.height / 2;
    const cx = anc && layout.lr ? box.width * 0.8 : box.width / 2;
    svg.transition().duration(450).call(zoom.transform, d3.zoomIdentity.translate(cx - n.x * k, cy - n.y * k).scale(k));
  }

  function select(id) {
    state.selected = id;
    highlight();
    showPerson(id);
    tab("person");
    history.replaceState(null, "", "#" + encodeURIComponent(id));
  }

  // ------------------------------------------------------------------ the person panel
  function relatives(id) {
    const parents = [], spouses = [], children = [];
    for (const e of byChild.get(id) || []) {
      const u = U.get(e.union);
      parents.push({ e, u, people: u.partners });
    }
    for (const u of unionsOf.get(id) || []) {
      const others = u.partners.filter((p) => p !== id);
      const kids = byUnion.get(u.id) || [];
      spouses.push({ u, others, kids, cls: (u.pcls || {})[id] || (others.length ? (u.pcls || {})[others[0]] : null) });
      for (const e of kids) children.push({ e, u });
    }
    return { parents, spouses, children };
  }

  function citeRefs(nums, pid) {
    return (nums || []).map((n) => `<a class="cite" href="#" data-target="c-${esc(pid)}-${n}">${n}</a>`).join(",");
  }

  function evidenceList(items, cls) {
    if (!items || !items.length) return "";
    return `<ul class="ev ${cls}">` + items.map((x) => {
      if (x.private) return `<li class="meta">${esc(x.note)}</li>`;
      const src = (x.sources || []).map((s) => s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>${s.locator ? ", " + esc(s.locator) : ""}` : esc(s.title)).join("; ");
      const held = (x.sources || []).filter((s) => s.held || s.evidence).map((s) => heldHtml(s)).join("");
      return `<li>${esc(x.note || "")}${x.quote ? `<span class="q">“${esc(x.quote)}”</span>` : ""}${x.translation ? `<span class="q tr">${esc(x.translation)}</span>` : ""}${x.why ? `<span class="meta">Why: ${esc(x.why)}</span>` : ""}${src ? `<div class="meta">${src}</div>` : ""}${x.where ? `<div class="meta">${esc(x.where)}</div>` : ""}${held}</li>`;
    }).join("") + "</ul>";
  }

  function leadHtml(l, opts = {}) {
    if (!l) return "";
    const nodes = (l.nodes || []).filter((n) => P.has(n) && n !== opts.except);
    return `<div class="lead" id="lead-${esc(l.id)}">
      <div class="title">${stBadge(l.status)}${l.private ? '<span class="badge st-unlikely">private</span>' : ""}${esc(l.title)}</div>
      ${l.claim ? `<div class="claim">${esc(l.claim)}</div>` : ""}
      ${(l.evidence_for || []).length || (l.evidence_against || []).length ? `<details${opts.open ? " open" : ""}><summary>evidence: ${(l.evidence_for || []).length} for, ${(l.evidence_against || []).length} against</summary>
        ${evidenceList(l.evidence_for, "for")}${evidenceList(l.evidence_against, "against")}</details>` : ""}
      ${l.decider ? `<div class="dec"><b>Decider</b> ${esc(l.decider)}</div>` : ""}
      ${l.next_step ? `<div class="dec"><b>Next</b> ${esc(l.next_step)}</div>` : ""}
      ${nodes.length ? `<div class="nodes">${nodes.slice(0, 12).map((n) => plink(n)).join(" ")}${nodes.length > 12 ? ` <span class="meta">+${nodes.length - 12} more</span>` : ""}</div>` : ""}
      <div class="meta">${esc(l.id)}</div>
    </div>`;
  }

  function showPerson(id) {
    const p = P.get(id), box = d3.select("#tab-person");
    if (!p) { box.html(`<p class="hint">Not in this build.</p>`); return; }
    const h = [];
    h.push(`<h2>${esc(p.name)}</h2>`);
    if (p.aka && p.aka.length) h.push(`<div class="aka">also ${p.aka.map(esc).join("; ")}</div>`);
    const tags = [];
    if (p.living) tags.push(badge("living", "living"));
    if (p.ghost) tags.push(badge("ghost", "candidate"), ...(p.fs ? [] : [badge(p.cls)]));
    if (p.fs) tags.push(badge("unverified-tree", p.tree_label || "FamilySearch tree, unverified"));
    h.push(`<div class="life">${tags.join("")}${esc(p.life || "")}</div>`);
    h.push(`<div class="meta">${esc(id)} · ${esc((D.branches[p.branch] || {}).label || p.branch)} · <a href="#" class="focus" data-id="${esc(id)}" data-mode="both" data-depth="3">focus here</a> · <a href="#" class="focus" data-id="${esc(id)}" data-mode="ancestors" data-depth="99">ancestors</a> · <a href="#" class="focus" data-id="${esc(id)}" data-mode="descendants" data-depth="99">descendants</a></div>`);

    if (p.living && D.meta.build === "public") {
      h.push(`<div class="private">Living person: on the public site only the name and family relationships are shown. Dates, places, facts and photos are kept in the private section.</div>`);
    }
    if (p.ghost) {
      const lead = LEADS.get(p.lead);
      h.push(`<div class="debt">${p.fs ? `From the FamilySearch Family Tree (crowd-sourced, <b>unverified</b>), hung from a candidate: ` : `Not in the tree: a candidate proposed by a lead. `}${lead ? `Lead: <b>${esc(lead.title)}</b> (${esc(lead.status)}).` : ""}</div>`);
      const bits = [];
      if (p.birth) bits.push(`b. ${esc(p.birth.date || "")}${p.birth.place ? ", " + esc(p.birth.place) : ""}`);
      if (p.death) bits.push(`d. ${esc(p.death.date || "")}${p.death.place ? ", " + esc(p.death.place) : ""}`);
      if (p.place && !p.birth) bits.push(esc(p.place));
      if (bits.length) h.push(`<p>${bits.join("<br>")}</p>`);
      if (p.note) h.push(`<p>${esc(p.note)}</p>`);
      if (p.familysearch) h.push(`<p class="meta"><a href="${esc(p.familysearch)}" target="_blank" rel="noopener">FamilySearch profile</a>${p.source ? " · " + esc(p.source) : ""}${p.ascendancy ? " · Irene's ascendancy no. " + p.ascendancy : ""}</p>`);
    }

    // facts
    if (p.facts && p.facts.length) {
      const ev = p.evidence || {};
      h.push(`<h3>Facts</h3>`);
      if (ev.facts) {
        const w = (k) => (100 * (ev[k] || 0) / ev.facts).toFixed(1) + "%";
        h.push(`<div class="evbar" title="${ev.sourced} sourced · ${ev.tree_only} trees only · ${ev.legacy_only} 2015 tree only"><i style="width:${w("sourced")};background:#4a8a3a"></i><i style="width:${w("tree_only")};background:#d9a441"></i><i style="width:${w("legacy_only")};background:#b9b9b9"></i></div>`);
        h.push(`<div class="meta">${ev.sourced} of ${ev.facts} facts cite a document; ${ev.tree_only} rest on trees or memory; ${ev.legacy_only} only on the 2015 tree.</div>`);
      }
      if (ev.legacy_only) h.push(`<div class="debt"><b>Research debt:</b> ${ev.legacy_only} fact${ev.legacy_only > 1 ? "s rest" : " rests"} only on the 2015 tree (family tradition, no source). Find a record for ${ev.legacy_only > 1 ? "them" : "it"}.</div>`);
      h.push(`<table class="facts">`);
      for (const f of p.facts) {
        const what = [f.date, f.julian ? `(Julian ${f.julian})` : "", f.place, f.value].filter(Boolean).map(esc).join(" · ");
        h.push(`<tr><td class="t">${esc(f.type)}${f.preferred ? " ✓" : ""}</td><td>${what}<sup class="c">${citeRefs(f.cites, id)}</sup>${f.why ? `<span class="why">${esc(f.why)}</span>` : ""}</td></tr>`);
      }
      h.push(`</table>`);
    } else if (!p.ghost && !(p.living && D.meta.build === "public")) {
      h.push(`<div class="debt">No facts recorded yet.</div>`);
    }

    // photographs (private build: every photo tagged with the person; public: Peter's own family photo only)
    if (p.photos && p.photos.length) {
      h.push(`<h3>Photographs (${p.photos.length})</h3><div class="photos">`);
      for (const ph of p.photos) {
        const cap = [ph.title, ph.date, ph.place, ph.kind === "cutout" ? "face cutout" : "", ph.who].filter(Boolean).map(esc).join(" · ");
        const meta = [ph.caption, ph.source, ph.credit, ph.mh_photo ? "MyHeritage " + ph.mh_photo : "", ph.missing].filter(Boolean).map(esc).join(" · ");
        const img = ph.href ? `<a href="${esc(ph.href)}" target="_blank" rel="noopener"><img src="${esc(ph.href)}" alt="${esc(ph.title || "photograph")}" loading="lazy"></a>` : "";
        h.push(`<figure class="photo${ph.kind === "cutout" ? " cutout" : ""}">${img}<figcaption>${cap}${meta ? `<div class="meta">${meta}</div>` : ""}${ph.web ? `<div class="meta"><a href="${esc(ph.web)}" target="_blank" rel="noopener">on MyHeritage</a></div>` : ""}</figcaption></figure>`);
      }
      h.push(`</div>`);
    }

    // family
    const { parents, spouses, children } = relatives(id);
    const links = linksOf.get(id) || [];
    if (parents.length || spouses.length || children.length || links.length) {
      h.push(`<h3>Family</h3><ul class="kin">`);
      for (const { e, u, people } of parents) {
        const names = people.length ? people.map((x) => plink(x)).join(" × ") : `<span class="meta">${esc(u.note || "parents unknown")}</span>`;
        h.push(`<li><span class="rel">parents</span> ${names} ${badge(e.cls)}${e.lead && LEADS.get(e.lead) ? ` <span class="meta">${esc(LEADS.get(e.lead).title)}</span>` : ""}</li>`);
        if (!people.length || e.cites) {
          const sib = (byUnion.get(u.id) || []).filter((x) => x.child !== id);
          if (sib.length) h.push(`<li><span class="rel">siblings</span> ${sib.map((x) => plink(x.child)).join(", ")}</li>`);
        }
      }
      for (const { u, others, kids, cls } of spouses) {
        if (!others.length) continue;
        const f = [...new Set((u.facts || []).map((x) => `${x.type}${x.form ? " (" + x.form + ")" : ""} ${x.date || ""}${x.place ? ", " + x.place : ""}`))].join("; ");
        h.push(`<li><span class="rel">spouse</span> ${others.map((x) => plink(x)).join(", ")}${cls ? " " + badge(cls) : ""}${f ? ` <span class="meta">${esc(f)}</span>` : ""}</li>`);
      }
      if (children.length) h.push(`<li><span class="rel">children</span> ${children.map(({ e }) => plink(e.child) + (e.cls !== "documented" ? ` <span class="meta">(${esc(clsLabel(e.cls).toLowerCase())})</span>` : "")).join(", ")}</li>`);
      for (const l of links) {
        const o = l.from === id ? l.to : l.from;
        h.push(`<li><span class="rel">${l.kind === "identity" ? "same as?" : "kin?"}</span> ${plink(o)} ${badge(l.cls)} <span class="meta">${esc(l.label)}</span></li>`);
      }
      h.push(`</ul>`);
      const pe = parents.find((x) => x.e.cites && x.e.cites.length);
      if (pe) h.push(`<div class="meta">Parent link cites: ${pe.e.cites.map((c) => c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title)}</a>` : esc(c.title)).join("; ")}</div>`);
    }

    // hypotheses
    if (p.hypotheses && p.hypotheses.length) {
      h.push(`<h3>Hypotheses</h3>`);
      for (const x of p.hypotheses) {
        h.push(`<div class="lead"><div class="title">${stBadge(x.status || "open")}<span class="badge">${esc(x.confidence || "")} confidence</span></div><div class="claim">${esc(x.claim)}</div>
          ${(x.evidence_for || []).length || (x.evidence_against || []).length ? `<details><summary>evidence: ${(x.evidence_for || []).length} for, ${(x.evidence_against || []).length} against</summary>${evidenceList(x.evidence_for, "for")}${evidenceList(x.evidence_against, "against")}</details>` : ""}
          ${x.lead && LEADS.get(x.lead) ? `<div class="meta">see lead ${esc(x.lead)}</div>` : ""}</div>`);
      }
    }
    // leads
    const leads = [...new Set([...(p.leads || []), ...(p.lead ? [p.lead] : [])])].map((x) => LEADS.get(x)).filter(Boolean);
    if (leads.length) {
      leads.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
      h.push(`<h3>Leads (${leads.length})</h3>`);
      for (const l of leads) h.push(leadHtml(l, { except: id }));
    }
    // notes
    for (const k of ["bio", "notes", "todo"]) {
      if (p[k] && p[k].length) h.push(`<h3>${k === "todo" ? "To do" : k === "bio" ? "Biography" : "Notes"}</h3>` + p[k].map((x) => `<p>${esc(x)}</p>`).join(""));
    }
    // citations
    if (p.cites && p.cites.length) {
      h.push(`<h3>Sources</h3><ol class="cites">`);
      for (const c of p.cites) {
        const t = c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.title)}</a>` : esc(c.title);
        const meta = [c.repository, c.archive || c.locator, c.quality, c.confidence ? c.confidence + " confidence" : "", c.legacy ? "family tradition (2015 tree)" : c.tree ? "compiled tree" : ""].filter(Boolean).map(esc).join(" · ");
        h.push(`<li id="c-${esc(id)}-${c.n}">${t}${c.private ? "" : `<div class="meta">${meta}</div>`}${c.as_recorded ? `<div class="meta">as recorded: ${esc(c.as_recorded)}</div>` : ""}${c.quote ? `<span class="q">“${esc(c.quote)}”</span>` : ""}${c.translation ? `<span class="q tr">${esc(c.translation)}</span>` : ""}${c.note ? `<div>${esc(c.note)}</div>` : ""}${c.files ? `<div class="meta">files: ${c.files.map(esc).join(", ")}</div>` : ""}${heldHtml(c)}</li>`);
      }
      h.push(`</ol>`);
    }
    if (p.familysearch && !p.ghost) h.push(`<p class="meta"><a href="${esc(p.familysearch)}" target="_blank" rel="noopener">FamilySearch tree profile</a></p>`);
    if (p.living_reason) h.push(`<p class="meta">Living: ${esc(p.living_reason)}</p>`);
    box.html(h.join("\n"));
    box.node().scrollTop = 0;
  }

  // private build: our archived copies of the source (data/archive-index.yaml) and the evidence crops
  // in context (data/image-regions.yaml)
  function heldHtml(c) {
    const out = [];
    if (c.evidence && c.evidence.length) {
      out.push(`<div class="evidence">${c.evidence.map((e) => `<a href="${esc(e.page)}" target="_blank" rel="noopener" title="${e.note ? esc(e.note) : `the full page, region highlighted (match ${e.confidence || ""} ${e.score || ""})`}"><img src="${esc(e.thumb)}" alt="record crop" loading="lazy"></a>`).join("")}</div>`);
    }
    if (c.held && c.held.length) {
      const kb = (b) => (b ? (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB") : "");
      out.push(`<details class="held"><summary>archived copy: ${c.held.length} file${c.held.length > 1 ? "s" : ""}</summary><ul>${c.held.map((h) =>
        `<li>${h.href ? `<a href="${esc(h.href)}" target="_blank" rel="noopener">${esc(h.label)}</a>` : esc(h.label)} <span class="meta">${[h.kind, kb(h.bytes), h.fetched ? "fetched " + h.fetched : "", h.record ? "record " + h.record : "", h.match].filter(Boolean).map(esc).join(" · ")}</span><div class="meta"><code>${esc(h.where || "")}</code></div></li>`).join("")}</ul></details>`);
    } else if (!c.private && !c.legacy) {
      out.push(`<div class="meta">no archived copy (see out/archive-gaps.md)</div>`);
    }
    return out.join("");
  }

  // ------------------------------------------------------------------ the leads tab
  function buildLeadsTab() {
    const box = d3.select("#tab-leads");
    const sts = STATUS_ORDER.filter((s) => D.leads.some((l) => l.status === s));
    box.html(`<p class="hint">Every open question, candidate and rejected idea, grouped by question. Nothing is pruned: ruled-out leads stay, with their reasons.</p>
      <div class="leadfilter">${sts.map((s) => `<label><input type="checkbox" value="${s}" checked> ${s} (${D.leads.filter((l) => l.status === s).length})</label>`).join("")}</div>
      <div id="leadlist"></div>`);
    const draw = () => {
      const on = new Set(box.selectAll(".leadfilter input").filter(function () { return this.checked; }).nodes().map((n) => n.value));
      const out = [];
      for (const q of D.questions) {
        const ls = D.leads.filter((l) => l.question === q && on.has(l.status))
          .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
        if (!ls.length) continue;
        out.push(`<div class="qgroup"><h3>${esc(q)} (${ls.length})</h3>${ls.map((l) => leadHtml(l)).join("")}</div>`);
      }
      d3.select("#leadlist").html(out.join(""));
    };
    box.selectAll(".leadfilter input").on("change", draw);
    draw();
  }

  function buildHelp() {
    const c = D.meta.counts;
    const ec = Object.entries(c.edges).map(([k, v]) => `${esc(clsLabel(k))} ${v}`).join(", ");
    d3.select("#tab-help").html(`
      <h3>What this is</h3>
      <p>Every person in the Danenberg family-history data, and every <em>candidate</em> person a lead proposes, in one drawing. Each parent→child line is styled by the strength of its evidence, so you can see at a glance which parts rest on documents, which on family tradition, and which are speculation or have been rejected.</p>
      <h3>Reading it</h3>
      <ul>
        <li>Ancestors above, descendants below. A small dot joins a couple; lines drop from the dot to their children. A dot with no couple above it is a sibling group whose parents are unknown.</li>
        <li><b>Documented</b>: a register, census, card or other record cites the link. <b>Tradition / trees only</b>: only the 2015 tree, family memory or an unsourced online tree.</li>
        <li><b>Probable / possible / weak</b> come from a lead; <b>unlikely / ruled out</b> (red, ✕) have been rejected but are kept, with the reason.</li>
        <li>Dashed, translucent boxes are <b>candidates</b> (ghost people): proposed parents, possible identities (“= ?”) or possible relatives, not in the tree.</li>
        <li>The thin bar along the bottom of a box: facts citing documents (green), trees or memory only (amber), the 2015 tree only (grey) — research debt.</li>
        <li>Click a person for facts, numbered sources, family and leads. Double-click to focus on them. Scroll to zoom; drag to pan.</li>
      </ul>
      <h3>This build</h3>
      <p class="meta">${esc(D.meta.build)} · generated ${esc(D.meta.generated)} · ${c.people} people (${c.living_shown} living) · ${c.ghosts} candidates · ${c.fs_subtree} from the FamilySearch tree · edges: ${ec} · ${L.length} identity/kin links · ${c.leads} leads</p>
      ${D.meta.build === "public" ? `<p class="meta">Withheld from this public build: ${Object.entries(c.withheld || {}).map(([k, v]) => `${v} ${esc(k)}`).join(", ") || "nothing"}.</p>` : ""}
      <p class="meta">Generated by <code>make site</code> (tools/famtree/site.py) from data/ and data/curation/candidate_links.yaml.</p>`);
  }
})();
