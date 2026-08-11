/* Sprintline — sprint-snapped product planning Gantt.
   Timeline: Aug 1 2026 → Jan 31 2028. Sprint = 14 days from Aug 1 2026. */

(() => {
  "use strict";

  // ---------- constants ----------
  const T0 = Date.UTC(2026, 7, 1);            // Aug 1 2026
  const T_END = Date.UTC(2028, 1, 1);         // exclusive: Feb 1 2028
  const DAY = 86400000;
  const SPRINT_DAYS = 14;
  // zoom = fraction of the full timeline visible at once; px/sprint derives from viewport
  const ZOOM_LEVELS = ["sprint", "month", "fit"];
  const ZOOM_FRACTION = { sprint: 0.25, month: 0.5, fit: 1 };
  const ZOOM_MIN_W = { sprint: 32, month: 16, fit: 6 }; // px/sprint floor for narrow screens
  const TOTAL_SPRINTS = Math.floor((T_END - T0) / DAY / SPRINT_DAYS); // 39
  const ROW_H = 44;
  const LEFT_W = 300;
  const HEADER_H = 50;
  const STORE_KEY = "sprintline-v1";

  // zoom-dependent metrics (set by applyZoom)
  let SPRINT_W = 36; // provisional until applyZoom() runs
  let PX_PER_DAY = SPRINT_W / SPRINT_DAYS;
  let TIMELINE_W = Math.round((T_END - T0) / DAY * PX_PER_DAY);

  const FIELDS = ["Summary", "Assignee", "Status", "Theme", "Delivery Quarter",
    "Teams", "Delivery progress", "Key", "Effort", "Impact", "Parent"];
  const MULTI_FIELDS = new Set(["Theme", "Teams", "Delivery Quarter"]);
  const FACET_FIELDS = FIELDS.filter(f => f !== "Summary"); // highlight/filter exclude Summary

  // ---------- state ----------
  let state = load() || freshState();
  let editingId = null;

  function freshState() {
    return {
      items: JSON.parse(JSON.stringify(window.DEFAULT_ITEMS)),
      deps: [],                    // [{from, to}]
      highlight: [],               // ["Column||value", ...]
      filter: [],
      zoom: "sprint",              // "sprint" | "month" | "fit" (all viewport-relative)
      collapsed: [],               // parent Keys whose children are hidden
      configs: {}                  // named saved snapshots: { title: {savedAt, data} }
    };
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.items)) return null;
      if (s.zoom === "quarter") s.zoom = "fit";
      if (!ZOOM_LEVELS.includes(s.zoom)) s.zoom = "sprint";
      if (!s.configs || typeof s.configs !== "object") s.configs = {};
      if (!Array.isArray(s.collapsed)) s.collapsed = [];
      return s;
    } catch (e) { return null; }
  }

  function applyZoom() {
    // every zoom level fills the viewport: Fit shows the whole timeline,
    // Month shows ~half of it, Sprint ~a quarter (scroll for the rest)
    const boardEl = document.getElementById("board");
    const avail = Math.max(320, (boardEl ? boardEl.clientWidth : window.innerWidth) - LEFT_W - 2);
    const f = ZOOM_FRACTION[state.zoom] || 1;
    const totalDays = (T_END - T0) / DAY;
    const minPerDay = (ZOOM_MIN_W[state.zoom] || 6) / SPRINT_DAYS;
    PX_PER_DAY = Math.max((avail / f) / totalDays, minPerDay);
    SPRINT_W = PX_PER_DAY * SPRINT_DAYS;
    TIMELINE_W = Math.round(totalDays * PX_PER_DAY);
    document.documentElement.style.setProperty("--sprint-w", SPRINT_W + "px");
  }

  // ---------- date helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sprintDate = s => new Date(T0 + s * SPRINT_DAYS * DAY);
  const fmt = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" });
  const barX = it => it.start * SPRINT_W;
  const barW = it => it.len * SPRINT_W;
  const spanText = it => {
    const a = sprintDate(it.start), b = new Date(sprintDate(it.start + it.len) - DAY);
    return `S${it.start}\u2013S${it.start + it.len - 1} \u00b7 ${fmt(a)} \u2192 ${fmt(b)} \u00b7 ${it.len} sprint${it.len > 1 ? "s" : ""}`;
  };

  // ---------- parent / rollup helpers ----------
  const keyOf = it => (it.fields.Key || "").trim();
  const parentKeyOf = it => {
    const p = (it.fields.Parent || "none").trim();
    return p && p !== "none" ? p : null;
  };
  const isParent = it => {
    const k = keyOf(it);
    return !!k && state.items.some(x => x !== it && parentKeyOf(x) === k);
  };
  const isCollapsed = it => isParent(it) && state.collapsed.includes(keyOf(it));

  function descendants(it, acc = [], seen = new Set()) {
    const k = keyOf(it);
    if (!k || seen.has(it.id)) return acc;
    seen.add(it.id);
    state.items.forEach(x => {
      if (x !== it && parentKeyOf(x) === k && !seen.has(x.id)) {
        acc.push(x);
        descendants(x, acc, seen);
      }
    });
    return acc;
  }

  function rollupSpan(it) {
    let s = it.start, e = it.start + it.len;
    descendants(it).forEach(k => {
      s = Math.min(s, k.start);
      e = Math.max(e, k.start + k.len);
    });
    return { start: s, len: Math.max(1, e - s) };
  }

  function depthOf(it) {
    let d = 0, cur = it;
    const seen = new Set([it.id]);
    while (d < 3) {
      const pk = parentKeyOf(cur);
      if (!pk) break;
      const p = state.items.find(x => keyOf(x) === pk);
      if (!p || seen.has(p.id)) break;
      seen.add(p.id);
      d++; cur = p;
    }
    return d;
  }

  const allParentKeys = () =>
    [...new Set(state.items.filter(isParent).map(keyOf))];

  // geometry that respects collapsed rollups (used by dependency arrows)
  function geom(it) {
    if (isCollapsed(it)) {
      const r = rollupSpan(it);
      return { x: r.start * SPRINT_W, w: r.len * SPRINT_W };
    }
    return { x: barX(it), w: barW(it) };
  }

  // ---------- facet helpers ----------
  function facetValues(it, col) {
    const v = (it.fields[col] ?? "").trim();
    if (!v) return ["(blank)"];
    return MULTI_FIELDS.has(col) ? v.split(",").map(s => s.trim()).filter(Boolean) : [v];
  }
  function matches(it, tokens) {
    if (!tokens.length) return true;
    const byCol = {};
    tokens.forEach(t => {
      const i = t.indexOf("||");
      const col = t.slice(0, i), val = t.slice(i + 2);
      (byCol[col] = byCol[col] || []).push(val);
    });
    // OR within a column, AND across columns
    return Object.entries(byCol).every(([col, vals]) => {
      const have = facetValues(it, col);
      return vals.some(v => have.includes(v));
    });
  }
  const isHighlighted = it => state.highlight.length && matches(it, state.highlight);
  const visibleItems = () => state.items.filter(it => matches(it, state.filter));

  // Display list: filtered, grouped (children directly after their parent),
  // with collapsed subtrees removed. This is the row order everything renders in.
  function displayItems() {
    const visIds = new Set(visibleItems().map(x => x.id));
    const byKey = new Map();
    state.items.forEach(x => { const k = keyOf(x); if (k && !byKey.has(k)) byKey.set(k, x); });

    const emitted = new Set();
    const out = [];

    const emit = (it, hidden) => {
      if (emitted.has(it.id)) return;
      emitted.add(it.id);
      if (!hidden && visIds.has(it.id)) out.push(it);
      const k = keyOf(it);
      if (!k) return;
      const childHidden = hidden || state.collapsed.includes(k);
      state.items.forEach(x => {
        if (x !== it && parentKeyOf(x) === k) emit(x, childHidden);
      });
    };

    // top level: items with no resolvable parent
    state.items.forEach(it => {
      const pk = parentKeyOf(it);
      if (!pk || !byKey.has(pk)) emit(it, false);
    });
    // safety net for parent cycles: anything untouched renders at the end
    state.items.forEach(it => emit(it, false));
    return out;
  }

  // ---------- DOM refs ----------
  const $ = sel => document.querySelector(sel);
  const board = $("#board");
  const inner = $("#boardInner");
  const dragTip = $("#dragTip");
  const toastEl = $("#toast");

  applyZoom();

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  // ---------- render ----------
  function render() {
    const items = displayItems();
    inner.style.width = (LEFT_W + TIMELINE_W) + "px";
    inner.innerHTML = "";
    inner.appendChild(buildAxis());

    const rows = document.createElement("div");
    rows.className = "rows";
    rows.style.width = (LEFT_W + TIMELINE_W) + "px";

    // vertical quarter/today lines behind bars
    const vl = document.createElement("div");
    vl.className = "vlines";
    vl.style.cssText = `left:${LEFT_W}px; top:0; width:${TIMELINE_W}px; height:${items.length * ROW_H}px;`;
    quarterStarts().forEach(({ x }) => {
      const l = document.createElement("div");
      l.className = "vline q";
      l.style.left = x + "px";
      vl.appendChild(l);
    });
    const now = Date.now();
    if (now >= T0 && now < T_END) {
      const l = document.createElement("div");
      l.className = "vline today";
      l.style.left = ((now - T0) / DAY * PX_PER_DAY) + "px";
      vl.appendChild(l);
    }
    rows.appendChild(vl);

    items.forEach(it => rows.appendChild(buildRow(it)));

    // dependency overlay
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("dep-svg");
    svg.setAttribute("width", TIMELINE_W);
    svg.setAttribute("height", items.length * ROW_H);
    svg.style.cssText = `left:${LEFT_W}px; top:0; pointer-events:none;`;
    svg.id = "depSvg";
    drawDeps(svg, items);
    rows.appendChild(svg);

    inner.appendChild(rows);
    updateFacetCounts();
    syncZoomSeg();
    updateCollapseBtn();
    updateCfgSelect();
  }

  function quarterStarts() {
    const out = [];
    for (let y = 2026; y <= 2028; y++) for (const m of [0, 3, 6, 9]) {
      const t = Date.UTC(y, m, 1);
      if (t > T0 && t < T_END) out.push({ t, x: (t - T0) / DAY * PX_PER_DAY, label: `Q${m / 3 + 1} '${String(y).slice(2)}` });
    }
    return out;
  }

  function buildAxis() {
    const axis = document.createElement("div");
    axis.className = "axis";
    axis.style.width = (LEFT_W + TIMELINE_W) + "px";

    const corner = document.createElement("div");
    corner.className = "axis-corner";
    corner.textContent = `${TOTAL_SPRINTS} sprints \u00b7 2-week snap`;
    axis.appendChild(corner);

    const scale = document.createElement("div");
    scale.className = "axis-scale";
    scale.style.width = TIMELINE_W + "px";

    const qs = quarterStarts();
    const denseMonths = SPRINT_W < 14; // month labels collide below ~14px/sprint
    let d = new Date(T0);
    while (d.getTime() < T_END) {
      const x = (d.getTime() - T0) / DAY * PX_PER_DAY;
      const isQ = qs.some(q => q.t === d.getTime());
      // at quarter zoom, month labels collide — keep only quarter starts (and T0)
      if (!denseMonths || isQ || d.getTime() === T0) {
        const m = document.createElement("div");
        m.className = "month" + (isQ ? " q-start" : "");
        m.style.left = x + "px";
        m.textContent = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) +
          (d.getUTCMonth() === 0 || d.getTime() === T0 ? " \u2019" + String(d.getUTCFullYear()).slice(2) : "");
        scale.appendChild(m);
      }
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    }
    // quarter tags need room; below ~30px/sprint they collide with month labels
    if (SPRINT_W >= 30) {
      qs.forEach(q => {
        const tag = document.createElement("div");
        tag.className = "q-tag";
        tag.style.left = (q.x + 44) + "px";
        tag.textContent = q.label;
        scale.appendChild(tag);
      });
    }

    const ruler = document.createElement("div");
    ruler.className = "sprints";
    const labelEvery = SPRINT_W >= 30 ? 2 : SPRINT_W >= 16 ? 4 : 8;
    const tickEvery = SPRINT_W >= 16 ? 1 : 2;
    for (let s = 0; s < TOTAL_SPRINTS; s++) {
      if (s % tickEvery !== 0) continue;
      const t = document.createElement("div");
      t.className = "sprint-tick";
      t.style.left = (s * SPRINT_W) + "px";
      if (s % labelEvery === 0) t.textContent = "S" + s;
      ruler.appendChild(t);
    }
    scale.appendChild(ruler);
    axis.appendChild(scale);
    return axis;
  }

  function buildRow(it) {
    const parent = isParent(it);
    const collapsed = isCollapsed(it);
    const depth = depthOf(it);

    const row = document.createElement("div");
    row.className = "row" + (isHighlighted(it) ? " hl" : "") + (parent ? " parent" : "");
    row.dataset.id = it.id;

    const label = document.createElement("div");
    label.className = "row-label" + (depth ? " child-" + Math.min(depth, 3) : "");
    const parentTag = parentKeyOf(it)
      ? ` \u00b7 <span class="parent">\u2934 ${esc(parentKeyOf(it))}</span>` : "";
    const twist = parent
      ? `<button class="twist" title="${collapsed ? "Expand" : "Collapse"} children">${collapsed ? "\u25B8" : "\u25BE"}</button>`
      : "";
    const badge = parent
      ? `<span class="badge" title="Items rolled up under this parent">${descendants(it).length}</span>` : "";
    label.innerHTML =
      `<span class="grip" title="Drag to reorder">\u2af6</span>${twist}
       <div class="row-title">
         <div class="t" title="${esc(it.fields.Summary)}">${esc(it.fields.Summary) || "(untitled)"}</div>
         <div class="k">${esc(it.fields.Key)}${badge}${parentTag}</div>
       </div>`;
    label.querySelector(".grip").addEventListener("pointerdown", e => startReorder(e, it.id));
    if (parent) {
      label.querySelector(".twist").addEventListener("click", e => {
        e.stopPropagation();
        toggleCollapse(keyOf(it));
      });
    }
    label.addEventListener("click", e => {
      if (!e.target.classList.contains("grip") && !e.target.classList.contains("twist")) openDrawer(it.id);
    });
    row.appendChild(label);

    const lane = document.createElement("div");
    lane.className = "lane";
    lane.style.width = TIMELINE_W + "px";
    lane.dataset.id = it.id;

    if (collapsed) {
      // derived rollup bar: spans parent + all descendants; click to expand
      const r = rollupSpan(it);
      const bar = document.createElement("div");
      bar.className = "bar rollup";
      bar.dataset.id = it.id;
      bar.style.left = (r.start * SPRINT_W) + "px";
      bar.style.width = (r.len * SPRINT_W) + "px";
      bar.title = `Rollup of ${descendants(it).length} item(s) \u00b7 ` +
        spanText({ start: r.start, len: r.len }) + " \u00b7 click to expand";
      bar.innerHTML = `<span class="bar-label">${esc(it.fields.Key || it.fields.Summary)} \u00b7 ${descendants(it).length}</span>`;
      bar.addEventListener("click", e => {
        e.stopPropagation();
        toggleCollapse(keyOf(it));
      });
      lane.appendChild(bar);
    } else {
      const bar = document.createElement("div");
      bar.className = "bar";
      bar.dataset.id = it.id;
      bar.style.left = barX(it) + "px";
      bar.style.width = barW(it) + "px";
      bar.title = spanText(it);
      bar.innerHTML =
        `<span class="bar-label">${esc(it.fields.Key)}</span>
         <span class="resize" title="Drag to resize (2-week sprints)"></span>
         <span class="dot" title="Drag to another item to add a dependency"></span>`;
      bar.addEventListener("pointerdown", e => startBarDrag(e, it.id, "move"));
      bar.querySelector(".resize").addEventListener("pointerdown", e => { e.stopPropagation(); startBarDrag(e, it.id, "resize"); });
      bar.querySelector(".dot").addEventListener("pointerdown", e => { e.stopPropagation(); startLinkDrag(e, it.id); });
      lane.appendChild(bar);
    }
    row.appendChild(lane);
    return row;
  }

  function toggleCollapse(key) {
    if (!key) return;
    if (state.collapsed.includes(key)) state.collapsed = state.collapsed.filter(k => k !== key);
    else state.collapsed.push(key);
    save(); render();
  }

  function updateCollapseBtn() {
    const btn = $("#collapseBtn");
    if (!btn) return;
    const parents = allParentKeys();
    const allDown = parents.length && parents.every(k => state.collapsed.includes(k));
    btn.textContent = allDown ? "Expand parents" : "Collapse parents";
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- dependencies ----------
  function drawDeps(svg, items) {
    const idx = new Map(items.map((it, i) => [it.id, i]));
    state.deps.forEach((d, di) => {
      if (!idx.has(d.from) || !idx.has(d.to)) return; // hidden by filter or collapse
      const a = state.items.find(x => x.id === d.from);
      const b = state.items.find(x => x.id === d.to);
      const y1 = idx.get(d.from) * ROW_H + ROW_H / 2;
      const y2 = idx.get(d.to) * ROW_H + ROW_H / 2;
      const ga = geom(a), gb = geom(b);
      const x1 = ga.x + ga.w;
      const x2 = gb.x;
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.classList.add("dep");
      p.dataset.di = di;
      const bend = Math.max(18, Math.min(40, Math.abs(x2 - x1) / 2));
      p.setAttribute("d", `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2 - 4} ${y2}`);
      p.setAttribute("marker-end", "url(#arrow)");
      p.style.pointerEvents = "stroke";
      p.addEventListener("click", e => showDepPop(e, di, a, b));
      svg.appendChild(p);
    });
    // arrowhead marker
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML = `<marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L8,4 L0,8 z" fill="#3d5566"/></marker>`;
    svg.appendChild(defs);
  }

  const depPop = $("#depPop");
  function showDepPop(e, di, a, b) {
    e.stopPropagation();
    depPop.style.display = "block";
    depPop.style.left = e.clientX + 8 + "px";
    depPop.style.top = e.clientY + 8 + "px";
    depPop.querySelector(".dep-text").textContent =
      `${a.fields.Key || a.fields.Summary} \u2192 ${b.fields.Key || b.fields.Summary}`;
    depPop.querySelector(".del").onclick = () => {
      state.deps.splice(di, 1);
      depPop.style.display = "none";
      save(); render();
      toast("Dependency removed");
    };
  }
  document.addEventListener("click", e => {
    if (!depPop.contains(e.target)) depPop.style.display = "none";
  });

  function startLinkDrag(e, fromId) {
    e.preventDefault();
    const svg = $("#depSvg");
    const from = state.items.find(x => x.id === fromId);
    const items = displayItems();
    const idx = new Map(items.map((it, i) => [it.id, i]));
    const x1 = barX(from) + barW(from);
    const y1 = idx.get(fromId) * ROW_H + ROW_H / 2;
    const temp = document.createElementNS("http://www.w3.org/2000/svg", "path");
    temp.classList.add("temp");
    svg.appendChild(temp);
    let targetId = null;

    const svgPoint = ev => {
      const r = svg.getBoundingClientRect();
      return [ev.clientX - r.left, ev.clientY - r.top];
    };
    const move = ev => {
      const [mx, my] = svgPoint(ev);
      temp.setAttribute("d", `M ${x1} ${y1} C ${x1 + 30} ${y1}, ${mx - 30} ${my}, ${mx} ${my}`);
      document.querySelectorAll(".bar.link-target").forEach(b => b.classList.remove("link-target"));
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const barEl = el && el.closest ? el.closest(".bar, .lane") : null;
      targetId = barEl && barEl.dataset.id !== fromId ? barEl.dataset.id : null;
      if (targetId) {
        const tb = document.querySelector(`.bar[data-id="${targetId}"]`);
        if (tb) tb.classList.add("link-target");
      }
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      temp.remove();
      document.querySelectorAll(".bar.link-target").forEach(b => b.classList.remove("link-target"));
      if (targetId) {
        const dup = state.deps.some(d => d.from === fromId && d.to === targetId);
        if (dup) { toast("That dependency already exists"); return; }
        state.deps.push({ from: fromId, to: targetId });
        save(); render();
        toast("Dependency added \u2014 click a line to remove it");
      }
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  // ---------- bar drag (move / resize) ----------
  function startBarDrag(e, id, mode) {
    if (e.button !== 0) return;
    e.preventDefault();
    const it = state.items.find(x => x.id === id);
    const bar = e.currentTarget.closest(".bar") || e.currentTarget;
    const lane = bar.parentElement;
    const startX = e.clientX;
    const orig = { start: it.start, len: it.len };
    let moved = false;

    // snap ghost at original position
    const ghost = document.createElement("div");
    ghost.className = "ghost";
    ghost.style.left = barX(it) + "px";
    ghost.style.width = barW(it) + "px";

    const move = ev => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 4) return;
      if (!moved) { moved = true; lane.appendChild(ghost); }
      const dSprints = Math.round(dx / SPRINT_W);
      if (mode === "move") {
        it.start = clamp(orig.start + dSprints, 0, TOTAL_SPRINTS - it.len);
      } else {
        it.len = clamp(orig.len + dSprints, 1, TOTAL_SPRINTS - it.start);
      }
      bar.style.left = barX(it) + "px";
      bar.style.width = barW(it) + "px";
      redrawDepsOnly();
      dragTip.style.display = "block";
      dragTip.style.left = ev.clientX + 12 + "px";
      dragTip.style.top = ev.clientY - 30 + "px";
      dragTip.textContent = spanText(it);
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      ghost.remove();
      dragTip.style.display = "none";
      if (moved) {
        bar.title = spanText(it);
        save(); render();
        if (editingId === id) fillSprintMeta(it);
      } else if (mode === "move") {
        openDrawer(id); // click without drag = edit
      }
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  function redrawDepsOnly() {
    const svg = $("#depSvg");
    if (!svg) return;
    svg.innerHTML = "";
    drawDeps(svg, displayItems());
  }

  // ---------- row reorder ----------
  function startReorder(e, id) {
    e.preventDefault();
    const rowEl = () => document.querySelector(`.row[data-id="${id}"]`);
    rowEl()?.classList.add("dragging");

    const move = ev => {
      const rowsEl = inner.querySelector(".rows");
      const top = rowsEl.getBoundingClientRect().top;
      const vis = displayItems();
      const targetVis = clamp(Math.floor((ev.clientY - top) / ROW_H), 0, vis.length - 1);
      const curVis = vis.findIndex(x => x.id === id);
      if (targetVis === curVis || curVis < 0) return;
      // move in the underlying array to the position of the displaced visible item
      const fromIdx = state.items.findIndex(x => x.id === id);
      const [itm] = state.items.splice(fromIdx, 1);
      const anchorId = vis[targetVis].id;
      let toIdx = state.items.findIndex(x => x.id === anchorId);
      if (targetVis > curVis) toIdx += 1;
      state.items.splice(toIdx, 0, itm);
      render();
      rowEl()?.classList.add("dragging");
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      rowEl()?.classList.remove("dragging");
      save();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  // ---------- edit drawer ----------
  const drawer = $("#drawer");
  const drawerBody = $("#drawerBody");
  const scrim = $("#scrim");

  function openDrawer(id) {
    editingId = id;
    const it = state.items.find(x => x.id === id);
    drawerBody.innerHTML = "";

    const meta = document.createElement("div");
    meta.className = "sprint-meta";
    meta.id = "sprintMeta";
    drawerBody.appendChild(meta);
    fillSprintMeta(it);

    FIELDS.forEach(f => {
      const wrap = document.createElement("div");
      wrap.className = "field";
      const lab = document.createElement("label");
      lab.textContent = f;
      wrap.appendChild(lab);
      let input;
      if (f === "Parent") {
        input = document.createElement("input");
        input.setAttribute("list", "parentList");
        const dl = $("#parentList");
        dl.innerHTML = `<option value="none"></option>` +
          state.items.filter(x => x.id !== id)
            .map(x => `<option value="${esc(x.fields.Key || x.fields.Summary)}"></option>`).join("");
        const note = document.createElement("div");
        note.className = "note";
        note.textContent = "Pick another item's Key, or \u201cnone\u201d.";
        wrap.appendChild(note);
      } else if (f === "Delivery progress" || f === "Summary" || f === "Theme" || f === "Teams") {
        input = document.createElement("textarea");
      } else {
        input = document.createElement("input");
      }
      input.value = it.fields[f] ?? "";
      input.addEventListener("input", () => {
        it.fields[f] = input.value;
        save();
        renderPreservingDrawer();
      });
      wrap.insertBefore(input, wrap.querySelector(".note"));
      drawerBody.appendChild(wrap);
    });

    drawer.classList.add("open");
    scrim.classList.add("show");
  }
  function fillSprintMeta(it) {
    const el = $("#sprintMeta");
    if (el) el.textContent = spanText(it);
  }
  function renderPreservingDrawer() {
    // re-render the board without rebuilding drawer inputs (keeps typing focus)
    const active = document.activeElement;
    render();
    if (active && drawer.contains(active)) active.focus();
  }
  function closeDrawer() {
    editingId = null;
    drawer.classList.remove("open");
    scrim.classList.remove("show");
  }
  $("#drawerClose").addEventListener("click", closeDrawer);
  scrim.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawer(); });

  // ---------- highlight / filter popovers ----------
  function buildPopover(popId, stateKey, btnId) {
    const pop = $(popId);
    const btn = $(btnId);
    const body = pop.querySelector(".pop-body");
    const search = pop.querySelector("input");

    function build() {
      const q = search.value.toLowerCase();
      body.innerHTML = "";
      FACET_FIELDS.forEach(col => {
        const vals = new Set();
        state.items.forEach(it => facetValues(it, col).forEach(v => vals.add(v)));
        const list = [...vals].sort((a, b) => a.localeCompare(b))
          .filter(v => !q || v.toLowerCase().includes(q) || col.toLowerCase().includes(q));
        if (!list.length) return;
        const h = document.createElement("div");
        h.className = "pop-col";
        h.textContent = col;
        body.appendChild(h);
        list.forEach(v => {
          const token = col + "||" + v;
          const lab = document.createElement("label");
          lab.className = "pop-item";
          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = state[stateKey].includes(token);
          cb.addEventListener("change", () => {
            if (cb.checked) state[stateKey].push(token);
            else state[stateKey] = state[stateKey].filter(t => t !== token);
            save(); render();
          });
          const sp = document.createElement("span");
          sp.textContent = v;
          sp.title = v;
          lab.append(cb, sp);
          body.appendChild(lab);
        });
      });
    }
    search.addEventListener("input", build);
    pop.querySelector(".link").addEventListener("click", () => {
      state[stateKey] = [];
      save(); render(); build();
    });
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const open = pop.classList.contains("open");
      closePopovers();
      if (!open) {
        build();
        const r = btn.getBoundingClientRect();
        pop.style.top = r.bottom + 6 + "px";
        pop.style.left = Math.min(r.left, window.innerWidth - 336) + "px";
        pop.classList.add("open");
      }
    });
    pop.addEventListener("click", e => e.stopPropagation());
  }
  function closePopovers() {
    document.querySelectorAll(".popover.open").forEach(p => p.classList.remove("open"));
  }
  document.addEventListener("click", closePopovers);
  buildPopover("#hlPop", "highlight", "#hlBtn");
  buildPopover("#fltPop", "filter", "#fltBtn");

  function updateFacetCounts() {
    $("#hlCount").textContent = state.highlight.length || "";
    $("#hlCount").style.display = state.highlight.length ? "" : "none";
    $("#fltCount").textContent = state.filter.length || "";
    $("#fltCount").style.display = state.filter.length ? "" : "none";
  }

  // ---------- zoom + collapse controls ----------
  function syncZoomSeg() {
    document.querySelectorAll("#zoomSeg button").forEach(b =>
      b.classList.toggle("on", b.dataset.z === state.zoom));
  }
  document.querySelectorAll("#zoomSeg button").forEach(b =>
    b.addEventListener("click", () => {
      if (state.zoom === b.dataset.z) return;
      state.zoom = b.dataset.z;
      applyZoom();
      save(); render();
    }));

  // ---------- named configs ----------
  const CONFIG_KEYS = ["items", "deps", "highlight", "filter", "zoom", "collapsed"];
  const snapshot = () => JSON.parse(JSON.stringify(
    Object.fromEntries(CONFIG_KEYS.map(k => [k, state[k]]))));

  function updateCfgSelect() {
    const sel = $("#cfgSelect");
    if (!sel) return;
    const names = Object.keys(state.configs).sort((a, b) => a.localeCompare(b));
    sel.innerHTML = `<option value="">Configs (${names.length}) \u25be</option>` +
      names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("") +
      (names.length ? `<option value="__del">\u2716 Delete a config\u2026</option>` : "");
    sel.value = "";
  }

  $("#saveCfgBtn").addEventListener("click", () => {
    const existing = Object.keys(state.configs);
    const name = (window.prompt(
      "Name this config" + (existing.length ? " (reuse a name to overwrite it):\n\u2022 " + existing.join("\n\u2022 ") : ":"),
      "") || "").trim();
    if (!name) return;
    if (name === "__del") { toast("That name is reserved \u2014 pick another"); return; }
    const overwrote = !!state.configs[name];
    state.configs[name] = { savedAt: Date.now(), data: snapshot() };
    save(); updateCfgSelect();
    toast(overwrote ? `Updated config \u201c${name}\u201d` : `Saved config \u201c${name}\u201d`);
  });

  $("#cfgSelect").addEventListener("change", e => {
    const v = e.target.value;
    e.target.value = "";
    if (!v) return;
    if (v === "__del") {
      const name = (window.prompt(
        "Type the exact name of the config to delete:\n\u2022 " +
        Object.keys(state.configs).join("\n\u2022 "), "") || "").trim();
      if (!name) return;
      if (!state.configs[name]) { toast(`No config named \u201c${name}\u201d`); return; }
      delete state.configs[name];
      save(); updateCfgSelect();
      toast(`Deleted config \u201c${name}\u201d`);
      return;
    }
    const cfg = state.configs[v];
    if (!cfg) return;
    if (!window.confirm(
      `Load config \u201c${v}\u201d?\n\nThe board will switch to that version. ` +
      `Unsaved changes to the current board will be lost \u2014 use Save config first if you want to keep them.`)) return;
    closeDrawer();
    Object.assign(state, JSON.parse(JSON.stringify(cfg.data)));
    if (!ZOOM_LEVELS.includes(state.zoom)) state.zoom = "sprint";
    applyZoom();
    save(); render();
    toast(`Loaded config \u201c${v}\u201d \u2014 Download CSV now exports this version`);
  });

  $("#collapseBtn").addEventListener("click", () => {
    const parents = allParentKeys();
    if (!parents.length) {
      toast("No parent items yet \u2014 set an item's Parent field to group it");
      return;
    }
    const allDown = parents.every(k => state.collapsed.includes(k));
    state.collapsed = allDown ? [] : parents;
    save(); render();
    toast(allDown ? "Expanded all parents" : `Collapsed ${parents.length} parent group(s)`);
  });

  // ---------- CSV ----------
  function parseCSV(text) {
    const rows = [];
    let row = [], cell = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else inQ = false;
        } else cell += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  const Q_START = {
    "26Q3": Date.UTC(2026, 6, 1), "26Q4": Date.UTC(2026, 9, 1),
    "27Q1": Date.UTC(2027, 0, 1), "27Q2": Date.UTC(2027, 3, 1),
    "27Q3": Date.UTC(2027, 6, 1), "27Q4": Date.UTC(2027, 9, 1),
    "26Q1": Date.UTC(2026, 0, 1), "26Q2": Date.UTC(2026, 3, 1)
  };
  function seedFromQuarters(qstr) {
    const qs = (qstr || "").split(",").map(s => s.trim()).filter(s => Q_START[s] !== undefined);
    if (!qs.length) return { start: 0, len: 3 };
    const s0 = Math.min(...qs.map(q => Q_START[q]));
    const eQ = Math.max(...qs.map(q => Q_START[q]));
    const end = Date.UTC(new Date(eQ).getUTCFullYear(), new Date(eQ).getUTCMonth() + 3, 1);
    const start = clamp(Math.floor((s0 - T0) / DAY / SPRINT_DAYS), 0, TOTAL_SPRINTS - 1);
    const endS = clamp(Math.ceil((end - T0) / DAY / SPRINT_DAYS), start + 1, TOTAL_SPRINTS);
    return { start, len: endS - start };
  }

  $("#uploadBtn").addEventListener("click", () => $("#fileInput").click());
  $("#fileInput").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { importCSV(reader.result); }
      catch (err) { toast("Could not read that CSV: " + err.message); }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  function importCSV(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error("no data rows found");
    const header = rows[0].map(h => h.trim());
    const hIdx = name => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
    if (hIdx("Summary") < 0) throw new Error("a Summary column is required");

    const sIdx = hIdx("Start Sprint"), lIdx = hIdx("Length (sprints)"), dIdx = hIdx("Depends On (Keys)");
    const items = rows.slice(1).map((r, i) => {
      const fields = {};
      FIELDS.forEach(f => {
        const j = hIdx(f);
        fields[f] = j >= 0 ? (r[j] ?? "").trim() : "";
      });
      if (!fields.Parent) fields.Parent = "none";
      let start, len;
      if (sIdx >= 0 && r[sIdx] !== "" && !isNaN(+r[sIdx])) {
        start = clamp(Math.round(+r[sIdx]), 0, TOTAL_SPRINTS - 1);
        len = (lIdx >= 0 && !isNaN(+r[lIdx])) ? clamp(Math.round(+r[lIdx]), 1, TOTAL_SPRINTS - start) : 3;
      } else {
        ({ start, len } = seedFromQuarters(fields["Delivery Quarter"]));
      }
      return { id: "u" + Date.now().toString(36) + "_" + i, fields, start, len,
        _depKeys: dIdx >= 0 ? (r[dIdx] || "").split(";").map(s => s.trim()).filter(Boolean) : [] };
    });

    // rebuild deps from Keys if present
    const byKey = new Map(items.map(it => [it.fields.Key, it.id]));
    const deps = [];
    items.forEach(it => {
      it._depKeys.forEach(k => {
        if (byKey.has(k)) deps.push({ from: it.id, to: byKey.get(k) });
      });
      delete it._depKeys;
    });

    state.items = items;
    state.deps = deps;
    state.highlight = [];
    state.filter = [];
    state.collapsed = [];
    save(); render();
    toast(`Loaded ${items.length} items from CSV`);
  }

  $("#downloadBtn").addEventListener("click", () => {
    const cols = [...FIELDS, "Start Sprint", "Length (sprints)", "Start Date", "End Date", "Depends On (Keys)"];
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [cols.map(q).join(",")];
    state.items.forEach(it => {
      const depKeys = state.deps.filter(d => d.from === it.id)
        .map(d => state.items.find(x => x.id === d.to)?.fields.Key).filter(Boolean).join("; ");
      const end = new Date(sprintDate(it.start + it.len) - DAY);
      const row = FIELDS.map(f => it.fields[f]);
      row.push(it.start, it.len, sprintDate(it.start).toISOString().slice(0, 10), end.toISOString().slice(0, 10), depKeys);
      lines.push(row.map(q).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "idea-board-gantt.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("#resetBtn").addEventListener("click", () => {
    if (!window.confirm("Reset to the built-in Idea Board dataset? Your edits will be lost.")) return;
    localStorage.removeItem(STORE_KEY);
    state = freshState();
    applyZoom();
    render();
    toast("Reset to default dataset");
  });

  // ---------- go ----------
  let resizeT;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { applyZoom(); render(); }, 120);
  });

  render();
})();
