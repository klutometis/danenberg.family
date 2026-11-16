/* Record & photograph viewer modal with interactive face/person cutouts (no dependencies). */
(function () {
  "use strict";

  const figures = Array.from(document.querySelectorAll("figure.record[data-viewer]"));
  if (!figures.length) return;

  function parseCutouts(raw) {
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((c) => c && Array.isArray(c.box) && c.box.length === 4) : [];
    } catch (_e) {
      return [];
    }
  }

  const records = figures.map((fig, index) => {
    const imgEl = fig.querySelector("img");
    const thumb = imgEl ? imgEl.getAttribute("src") : "";
    const alt = imgEl ? imgEl.getAttribute("alt") || "" : "";
    const boxAttr = fig.getAttribute("data-box");
    const boxesAttr = fig.getAttribute("data-boxes") || boxAttr || "";
    const parseBox = (s) => {
      if (!s) return null;
      const p = s.split(",").map(Number);
      return p.length === 4 && p.every((n) => Number.isFinite(n)) ? p : null;
    };
    const box = parseBox(boxAttr);
    const boxes = boxesAttr
      .split(";")
      .map((s) => parseBox(s.trim()))
      .filter(Boolean);
    const cutouts = parseCutouts(fig.getAttribute("data-cutouts") || fig.getAttribute("data-people"));
    const highlightN = Number(fig.getAttribute("data-highlight-n")) || 0;
    return {
      index,
      fig,
      thumb,
      alt,
      full: fig.getAttribute("data-full") || thumb,
      orig: fig.getAttribute("data-orig") || fig.getAttribute("data-full") || thumb,
      origLabel: fig.getAttribute("data-orig-label") || "Full resolution",
      ev: fig.getAttribute("data-ev") || "",
      date: fig.getAttribute("data-date") || "",
      title: fig.getAttribute("data-title") || "",
      w: Number(fig.getAttribute("data-w")) || 2000,
      h: Number(fig.getAttribute("data-h")) || 2800,
      box,
      boxes,
      cutouts,
      highlightN,
    };
  });

  // Build inline cutout overlays on page figures so hovering the photo or clicking #n works inline too
  function buildCutoutElements(cutouts, highlightN, onBoxClick) {
    const frag = document.createDocumentFragment();
    // Sort by area descending so smaller nested boxes (e.g. a child on a lap) have higher z-index
    const sorted = cutouts.slice().sort((a, b) => {
      const areaA = Math.max(0.1, (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]));
      const areaB = Math.max(0.1, (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]));
      return areaB - areaA;
    });
    sorted.forEach((c, zIdx) => {
      const [x1, y1, x2, y2] = c.box;
      const w = Math.max(0.5, x2 - x1);
      const h = Math.max(0.5, y2 - y1);
      const el = document.createElement("div");
      el.className =
        "v-cutout" +
        (c.person ? " is-id" : " is-unid") +
        (highlightN && c.n === highlightN ? " is-subject" : "");
      el.setAttribute("data-n", String(c.n));
      if (c.person) el.setAttribute("data-person", c.person);
      el.style.left = x1.toFixed(1) + "%";
      el.style.top = y1.toFixed(1) + "%";
      el.style.width = w.toFixed(1) + "%";
      el.style.height = h.toFixed(1) + "%";
      el.style.zIndex = String(10 + zIdx);

      // Position badge near top-left of face_2d if available, else top-left of box
      const badge = document.createElement("span");
      badge.className = "v-cutout-badge";
      badge.textContent = "#" + c.n;
      if (Array.isArray(c.face) && c.face.length === 4 && w > 1 && h > 1) {
        const fx = Math.max(0, Math.min(90, ((c.face[0] - x1) / w) * 100));
        const fy = Math.max(0, Math.min(90, ((c.face[1] - y1) / h) * 100));
        badge.style.left = fx.toFixed(1) + "%";
        badge.style.top = fy.toFixed(1) + "%";
      }
      el.appendChild(badge);

      const tip = document.createElement("div");
      tip.className = "v-cutout-tip";
      if (y1 < 14) tip.classList.add("tip-below");
      if (x1 > 65) tip.classList.add("tip-right");
      const strong = document.createElement("strong");
      strong.textContent = "#" + c.n + " " + (c.label || "Unidentified");
      tip.appendChild(strong);
      if (c.desc) {
        const span = document.createElement("span");
        span.textContent = " — " + c.desc;
        tip.appendChild(span);
      }
      el.appendChild(tip);

      if (c.url) {
        el.title = "#" + c.n + " " + c.label + (c.desc ? " — " + c.desc : "") + " (click for profile)";
      } else if (c.desc) {
        el.title = "#" + c.n + " " + c.label + " — " + c.desc;
      }

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (onBoxClick) onBoxClick(c, el);
      });

      frag.appendChild(el);
    });
    return frag;
  }

  records.forEach((rec, idx) => {
    if (!rec.cutouts.length) return;
    const stageEl = rec.fig.querySelector(".photo-stage");
    if (stageEl) {
      const wrap = document.createElement("div");
      wrap.className = "v-inline-wrap";
      wrap.appendChild(
        buildCutoutElements(rec.cutouts, rec.highlightN, (c) => {
          if (c.url) {
            window.location.href = c.url;
          } else {
            openViewer(idx, c.n);
          }
        })
      );
      stageEl.appendChild(wrap);
    }

    // Caption key interactions: hover highlights inline box; clicking #n pulses inline box & opens viewer with #n highlighted
    const keyBtns = rec.fig.querySelectorAll(".cutout-num[data-cutout-n]");
    keyBtns.forEach((btn) => {
      const n = Number(btn.getAttribute("data-cutout-n"));
      btn.addEventListener("mouseenter", () => {
        const target = rec.fig.querySelector('.v-inline-wrap .v-cutout[data-n="' + n + '"]');
        if (target) target.classList.add("is-pulse");
      });
      btn.addEventListener("mouseleave", () => {
        const target = rec.fig.querySelector('.v-inline-wrap .v-cutout[data-n="' + n + '"]');
        if (target) target.classList.remove("is-pulse");
      });
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openViewer(idx, n);
      });
    });

    const toggleBtn = rec.fig.querySelector("[data-cutout-toggle]");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const wrap = rec.fig.querySelector(".v-inline-wrap");
        if (wrap && !wrap.classList.contains("show-all")) {
          wrap.classList.add("show-all");
        } else {
          openViewer(idx, 0, true);
        }
      });
    }
  });

  // Build modal DOM
  const modal = document.createElement("div");
  modal.className = "rv-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Record viewer");
  modal.hidden = true;
  modal.innerHTML = [
    '<div class="rv-bar">',
    '  <div class="rv-nav">',
    '    <button type="button" class="rv-btn rv-prev" title="Previous record ([ or k)" aria-label="Previous record">&larr;</button>',
    '    <span class="rv-count">1 / ' + records.length + "</span>",
    '    <button type="button" class="rv-btn rv-next" title="Next record (] or j)" aria-label="Next record">&rarr;</button>',
    "  </div>",
    '  <div class="rv-meta">',
    '    <span class="rv-when"></span><span class="rv-sep"> &middot; </span><span class="rv-title"></span>',
    "  </div>",
    '  <div class="rv-tools">',
    '    <button type="button" class="rv-btn rv-zoom-out" title="Zoom out (&minus;)" aria-label="Zoom out">&minus;</button>',
    '    <button type="button" class="rv-btn rv-zoom-in" title="Zoom in (+)" aria-label="Zoom in">+</button>',
    '    <button type="button" class="rv-btn rv-fit" title="Fit whole page (0)">Whole page</button>',
    '    <button type="button" class="rv-btn rv-region" title="Return to cited region (r)">Region</button>',
    '    <button type="button" class="rv-btn rv-faces" title="Show/hide all face boxes (b)">Faces</button>',
    '    <a class="rv-link rv-orig" href="#" target="_blank" rel="noopener">Full resolution</a>',
    '    <a class="rv-link rv-ev" href="#">Standalone page</a>',
    '    <button type="button" class="rv-btn rv-close" title="Close (Esc)" aria-label="Close">&times;</button>',
    "  </div>",
    "</div>",
    '<div class="rv-stage">',
    '  <div class="rv-canvas v-img-wrap">',
    '    <img class="rv-img" alt="">',
    '    <div class="rv-boxes"></div>',
    '    <div class="rv-cutouts"></div>',
    "  </div>",
    "</div>",
    '<div class="rv-people" hidden></div>',
  ].join("\n");
  document.body.appendChild(modal);

  const elCount = modal.querySelector(".rv-count");
  const elWhen = modal.querySelector(".rv-when");
  const elSep = modal.querySelector(".rv-sep");
  const elTitle = modal.querySelector(".rv-title");
  const btnPrev = modal.querySelector(".rv-prev");
  const btnNext = modal.querySelector(".rv-next");
  const btnZoomOut = modal.querySelector(".rv-zoom-out");
  const btnZoomIn = modal.querySelector(".rv-zoom-in");
  const btnFit = modal.querySelector(".rv-fit");
  const btnRegion = modal.querySelector(".rv-region");
  const btnFaces = modal.querySelector(".rv-faces");
  const linkOrig = modal.querySelector(".rv-orig");
  const linkEv = modal.querySelector(".rv-ev");
  const btnClose = modal.querySelector(".rv-close");
  const stage = modal.querySelector(".rv-stage");
  const canvas = modal.querySelector(".rv-canvas");
  const rvImg = modal.querySelector(".rv-img");
  const boxesLayer = modal.querySelector(".rv-boxes");
  const cutoutsLayer = modal.querySelector(".rv-cutouts");
  const peopleBar = modal.querySelector(".rv-people");

  let curIdx = -1;
  let natW = 2000;
  let natH = 2800;
  let fitScale = 0.25;
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let viewMode = "fit"; // "region" | "fit" | "custom"
  let showAllFaces = true;
  let loadToken = 0;
  let preloadImg = null;
  let pulseTimer = null;

  function cancelPreload() {
    if (preloadImg) {
      preloadImg.onload = null;
      preloadImg.onerror = null;
      preloadImg.src = "";
      preloadImg = null;
    }
  }

  function computeFitScale() {
    const sw = Math.max(200, stage.clientWidth - 32);
    const sh = Math.max(200, stage.clientHeight - 32);
    return Math.min(sw / natW, sh / natH);
  }

  function applyTransform() {
    const w = Math.max(1, Math.round(natW * scale));
    const h = Math.max(1, Math.round(natH * scale));
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.style.transform = "translate3d(" + Math.round(tx) + "px," + Math.round(ty) + "px,0)";
    btnFit.classList.toggle("active", viewMode === "fit");
    btnRegion.classList.toggle("active", viewMode === "region");
  }

  function updateFacesToggle() {
    cutoutsLayer.classList.toggle("show-all", showAllFaces);
    btnFaces.classList.toggle("active", showAllFaces);
  }

  function toggleFaces() {
    showAllFaces = !showAllFaces;
    updateFacesToggle();
  }

  function fitToPage() {
    fitScale = computeFitScale();
    scale = fitScale;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    tx = (sw - natW * scale) / 2;
    ty = (sh - natH * scale) / 2;
    viewMode = "fit";
    applyTransform();
  }

  function zoomToRegion() {
    const rec = records[curIdx];
    fitScale = computeFitScale();
    if (!rec || !rec.box) {
      fitToPage();
      return;
    }
    const [bx, by, bw, bh] = rec.box;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    const wantScale = (0.7 * sw) / (Math.max(0.02, bw) * natW);
    scale = Math.max(fitScale, Math.min(2.5, wantScale));
    const cx = (bx + bw / 2) * natW * scale;
    tx = sw / 2 - cx;
    const boxScreenH = bh * natH * scale;
    if (boxScreenH > sh * 0.82) {
      ty = sh * 0.08 - by * natH * scale;
    } else {
      const cy = (by + bh / 2) * natH * scale;
      ty = sh / 2 - cy;
    }
    viewMode = "region";
    applyTransform();
  }

  function zoomAt(factor, pivotX, pivotY) {
    fitScale = computeFitScale();
    const minS = fitScale * 0.5;
    const maxS = 5.0;
    const next = Math.max(minS, Math.min(maxS, scale * factor));
    if (Math.abs(next - scale) < 1e-6) return;
    const ix = (pivotX - tx) / scale;
    const iy = (pivotY - ty) / scale;
    scale = next;
    tx = pivotX - ix * scale;
    ty = pivotY - iy * scale;
    viewMode = "custom";
    applyTransform();
  }

  function renderBoxes(rec) {
    boxesLayer.innerHTML = "";
    for (const b of rec.boxes) {
      const [bx, by, bw, bh] = b;
      const d = document.createElement("div");
      d.className = "rv-box";
      d.style.left = "calc(" + (bx * 100).toFixed(4) + "% - 4px)";
      d.style.top = "calc(" + (by * 100).toFixed(4) + "% - 4px)";
      d.style.width = "calc(" + (bw * 100).toFixed(4) + "% + 8px)";
      d.style.height = "calc(" + (bh * 100).toFixed(4) + "% + 8px)";
      boxesLayer.appendChild(d);
    }
  }

  function renderCutouts(rec, pulseN) {
    cutoutsLayer.innerHTML = "";
    peopleBar.innerHTML = "";
    if (!rec.cutouts || !rec.cutouts.length) {
      btnFaces.hidden = true;
      peopleBar.hidden = true;
      return;
    }
    btnFaces.hidden = false;
    btnFaces.textContent = "Faces (" + rec.cutouts.length + ")";
    updateFacesToggle();
    cutoutsLayer.appendChild(
      buildCutoutElements(rec.cutouts, rec.highlightN, (c, el) => {
        if (c.url) {
          window.location.href = c.url;
        } else {
          for (const sib of cutoutsLayer.querySelectorAll(".v-cutout.is-pulse")) {
            if (sib !== el) sib.classList.remove("is-pulse");
          }
          el.classList.toggle("is-pulse");
        }
      })
    );
    // Render clickable name pills in bottom bar
    const sortedByN = rec.cutouts.slice().sort((a, b) => (a.n || 0) - (b.n || 0));
    sortedByN.forEach((c) => {
      const pill = document.createElement(c.url ? "a" : "button");
      pill.className =
        "rv-pill" +
        (c.person ? " is-id" : " is-unid") +
        (rec.highlightN && c.n === rec.highlightN ? " is-subject" : "");
      if (c.url) {
        pill.href = c.url;
      } else {
        pill.type = "button";
      }
      pill.setAttribute("data-n", String(c.n));
      pill.textContent = "#" + c.n + " " + (c.label || "Unidentified");
      pill.addEventListener("mouseenter", () => {
        const box = cutoutsLayer.querySelector('.v-cutout[data-n="' + c.n + '"]');
        if (box) box.classList.add("is-pulse");
      });
      pill.addEventListener("mouseleave", () => {
        const box = cutoutsLayer.querySelector('.v-cutout[data-n="' + c.n + '"]');
        if (box) box.classList.remove("is-pulse");
      });
      if (!c.url) {
        pill.addEventListener("click", () => {
          const box = cutoutsLayer.querySelector('.v-cutout[data-n="' + c.n + '"]');
          if (box) box.classList.toggle("is-pulse");
        });
      }
      peopleBar.appendChild(pill);
    });
    peopleBar.hidden = false;
    if (pulseN) {
      const target = cutoutsLayer.querySelector('.v-cutout[data-n="' + pulseN + '"]');
      if (target) {
        target.classList.add("is-pulse");
        if (pulseTimer) clearTimeout(pulseTimer);
        pulseTimer = setTimeout(() => {
          target.classList.remove("is-pulse");
        }, 4000);
      }
    }
  }

  function showRecord(idx, pulseN) {
    cancelPreload();
    curIdx = (idx + records.length) % records.length;
    const rec = records[curIdx];
    const token = ++loadToken;

    elCount.textContent = curIdx + 1 + " / " + records.length;
    elWhen.textContent = rec.date;
    elSep.hidden = !rec.date;
    elTitle.textContent = rec.title;
    linkOrig.href = rec.orig;
    linkOrig.textContent = rec.origLabel;
    if (rec.ev) {
      linkEv.href = rec.ev;
      linkEv.hidden = false;
    } else {
      linkEv.hidden = true;
    }
    btnRegion.hidden = !rec.box;

    natW = rec.w || 2000;
    natH = rec.h || 2800;
    renderBoxes(rec);
    renderCutouts(rec, pulseN);

    rvImg.onload = null;
    rvImg.alt = rec.alt || rec.title;
    rvImg.src = rec.thumb || rec.full;

    if (rec.box) {
      zoomToRegion();
    } else {
      fitToPage();
    }

    const startFullLoad = () => {
      if (loadToken !== token) return;
      if (!rec.full || rec.full === rec.thumb) return;
      const hi = new Image();
      preloadImg = hi;
      hi.onload = function () {
        if (loadToken !== token) return;
        preloadImg = null;
        if (hi.naturalWidth && hi.naturalHeight && (hi.naturalWidth !== natW || hi.naturalHeight !== natH)) {
          const prevW = natW;
          natW = hi.naturalWidth;
          natH = hi.naturalHeight;
          scale = scale * (prevW / natW);
          fitScale = computeFitScale();
        }
        rvImg.onload = null;
        rvImg.src = rec.full;
        applyTransform();
      };
      hi.src = rec.full;
    };

    if (rvImg.complete && rvImg.naturalWidth > 0) {
      startFullLoad();
    } else {
      rvImg.onload = startFullLoad;
    }
  }

  function openViewer(idx, pulseN, forceAllFaces) {
    if (forceAllFaces) showAllFaces = true;
    modal.hidden = false;
    document.body.classList.add("rv-open");
    showRecord(idx, pulseN);
  }

  function closeViewer() {
    cancelPreload();
    modal.hidden = true;
    document.body.classList.remove("rv-open");
    loadToken++;
  }

  // Bind clicks on record figures (only the image link, not profile links in figcaption)
  records.forEach((rec, idx) => {
    const imgLinks = rec.fig.querySelectorAll(".photo-stage a, :scope > a");
    const links = imgLinks.length ? imgLinks : rec.fig.querySelectorAll("a:not(.p)");
    for (const a of links) {
      a.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        openViewer(idx);
      });
    }
  });

  // Top bar buttons
  btnPrev.addEventListener("click", () => showRecord(curIdx - 1));
  btnNext.addEventListener("click", () => showRecord(curIdx + 1));
  btnZoomIn.addEventListener("click", () => zoomAt(1.3, stage.clientWidth / 2, stage.clientHeight / 2));
  btnZoomOut.addEventListener("click", () => zoomAt(1 / 1.3, stage.clientWidth / 2, stage.clientHeight / 2));
  btnFit.addEventListener("click", () => fitToPage());
  btnRegion.addEventListener("click", () => zoomToRegion());
  btnFaces.addEventListener("click", () => toggleFaces());
  btnClose.addEventListener("click", () => closeViewer());

  // Mouse wheel zoom toward cursor
  stage.addEventListener(
    "wheel",
    (e) => {
      if (modal.hidden) return;
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      zoomAt(factor, px, py);
    },
    { passive: false }
  );

  // Double-click toggles between region zoom and whole-page fit
  stage.addEventListener("dblclick", (e) => {
    if (modal.hidden) return;
    if (e.target.closest(".v-cutout")) return;
    e.preventDefault();
    const rec = records[curIdx];
    if (viewMode === "fit" || Math.abs(scale - fitScale) < 0.015) {
      if (rec && rec.box) {
        zoomToRegion();
      } else {
        const rect = stage.getBoundingClientRect();
        zoomAt(2.0, e.clientX - rect.left, e.clientY - rect.top);
      }
    } else {
      fitToPage();
    }
  });

  // Mouse drag to pan + backdrop click to close
  let dragging = false;
  let moved = false;
  let downTarget = null;
  let startX = 0;
  let startY = 0;
  let startTx = 0;
  let startTy = 0;

  stage.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || modal.hidden) return;
    if (e.target.closest(".v-cutout")) return;
    e.preventDefault();
    dragging = true;
    moved = false;
    downTarget = e.target;
    startX = e.clientX;
    startY = e.clientY;
    startTx = tx;
    startTy = ty;
    stage.classList.add("rv-dragging");
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.hypot(dx, dy) > 4) moved = true;
    tx = startTx + dx;
    ty = startTy + dy;
    applyTransform();
  });

  window.addEventListener("mouseup", (e) => {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove("rv-dragging");
    if (!moved && downTarget === stage && e.target === stage) {
      closeViewer();
    }
  });

  // Touch drag to pan
  let touchStartX = 0;
  let touchStartY = 0;
  let touchTx = 0;
  let touchTy = 0;
  stage.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchTx = tx;
      touchTy = ty;
    },
    { passive: true }
  );
  stage.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      tx = touchTx + (e.touches[0].clientX - touchStartX);
      ty = touchTy + (e.touches[0].clientY - touchStartY);
      applyTransform();
    },
    { passive: false }
  );

  // Keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    if (modal.hidden) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        closeViewer();
        break;
      case "0":
        e.preventDefault();
        fitToPage();
        break;
      case "b":
      case "B":
        if (records[curIdx] && records[curIdx].cutouts && records[curIdx].cutouts.length) {
          e.preventDefault();
          toggleFaces();
        }
        break;
      case "r":
      case "R":
        if (records[curIdx] && records[curIdx].box) {
          e.preventDefault();
          zoomToRegion();
        }
        break;
      case "]":
      case "j":
        e.preventDefault();
        showRecord(curIdx + 1);
        break;
      case "[":
      case "k":
        e.preventDefault();
        showRecord(curIdx - 1);
        break;
      case "+":
      case "=":
        e.preventDefault();
        zoomAt(1.3, stage.clientWidth / 2, stage.clientHeight / 2);
        break;
      case "-":
      case "_":
        e.preventDefault();
        zoomAt(1 / 1.3, stage.clientWidth / 2, stage.clientHeight / 2);
        break;
      case "ArrowLeft":
        e.preventDefault();
        tx += 90;
        applyTransform();
        break;
      case "ArrowRight":
        e.preventDefault();
        tx -= 90;
        applyTransform();
        break;
      case "ArrowUp":
        e.preventDefault();
        ty += 90;
        applyTransform();
        break;
      case "ArrowDown":
        e.preventDefault();
        ty -= 90;
        applyTransform();
        break;
    }
  });

  window.addEventListener("resize", () => {
    if (modal.hidden) return;
    if (viewMode === "fit") fitToPage();
    else if (viewMode === "region") zoomToRegion();
  });
})();
