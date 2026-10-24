/* Raqeeb - 3D wireframe site map for Expo 2030 Riyadh camera placement.
 *
 * Dependency-free: this module carries its own perspective projection and
 * painter-style wireframe renderer on a 2D canvas, so the dashboard keeps
 * working fully offline with no CDN or build step.
 *
 * Site geometry and camera placements live in site_map.json next to this file.
 * Edit that file and refresh the page to change the plan.
 */
"use strict";
window.SiteMap3D = (function () {
  const DEG = Math.PI / 180;
  const FOV = 42 * DEG;
  const NEAR = 0.6;
  const FOG_STEPS = 6;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const V = {
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    len: a => Math.hypot(a[0], a[1], a[2]),
    norm: a => { const l = V.len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  };

  /* Deterministic pseudo-random so the generated districts never flicker. */
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ *
   * Geometry helpers
   * ------------------------------------------------------------------ */
  function ring(cx, cz, r, n, rot) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (rot || 0);
      out.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
    return out;
  }

  function hexRing(cx, cz, r, rot) {
    const out = [];
    for (let i = 0; i < 6; i++) {
      const a = (60 * i + 30) * DEG + (rot || 0);
      out.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
    return out;
  }

  function blob(cx, cz, radius, wobble, segments, seed) {
    const rand = rng(seed || 5);
    const p1 = rand() * 6.283, p2 = rand() * 6.283;
    const out = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const r = radius * (1 + wobble * (0.62 * Math.sin(3 * a + p1) + 0.38 * Math.sin(5 * a + p2)));
      out.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
    return out;
  }

  /* Pointy-top hexagonal grid, used for the district pavilion clusters. */
  function hexGrid(center, radius, cell, seed) {
    const rand = rng(seed || 1);
    const s = Math.max(18, cell);            // circumradius in metres
    const stepX = Math.sqrt(3) * s;
    const stepZ = 1.5 * s;
    const span = Math.ceil(radius / Math.min(stepX, stepZ)) + 2;
    const out = [];
    for (let q = -span; q <= span; q++) {
      for (let r = -span; r <= span; r++) {
        const cx = center[0] + stepX * (q + r / 2);
        const cz = center[1] + stepZ * r;
        const d = Math.hypot(cx - center[0], cz - center[1]);
        if (d > radius - s * 0.35) continue;
        if (rand() < 0.14) continue;                        // leave plazas and lanes
        const edge = 1 - d / Math.max(radius, 1);
        out.push({
          cx, cz,
          size: s * (0.74 + 0.14 * rand()),
          height: 10 + edge * 12 + rand() * 16,
          rot: (rand() - 0.5) * 0.22
        });
      }
    }
    return out;
  }

  function sector(cx, cz, yaw, fov, range, steps) {
    const out = [];
    const half = fov / 2;
    for (let i = 0; i <= steps; i++) {
      const a = (yaw - half + (fov * i) / steps) * DEG;
      out.push([cx + range * Math.sin(a), cz + range * Math.cos(a)]);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Scene assembly - turns site_map.json into flat wireframe primitives
   * ------------------------------------------------------------------ */
  function buildScene(data) {
    const lines = [];   // { a:[x,y,z], b:[x,y,z], style }
    const polys = [];   // { pts:[[x,z]..], style, y, alpha }
    const marks = [];   // { kind, at:[x,y,z], text }

    const seg = (a, b, style) => lines.push({ a, b, style });
    const poly = (pts, style, y, alpha) => polys.push({ pts, style, y: y || 0, alpha: alpha == null ? 1 : alpha });

    const ground = data.ground || {};
    const size = ground.size || 2600;
    const grid = ground.grid || 200;
    const sub = ground.subGrid || 50;

    /* Ground grid */
    const half = size / 2;
    for (let v = -half; v <= half + 0.01; v += sub) {
      const major = Math.abs(v % grid) < 0.01;
      seg([-half, 0, v], [half, 0, v], major ? "gridMajor" : "gridMinor");
      seg([v, 0, -half], [v, 0, half], major ? "gridMajor" : "gridMinor");
    }

    /* Site boundary */
    if (Array.isArray(data.boundary) && data.boundary.length > 2) {
      const pts = data.boundary;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        seg([a[0], 0, a[1]], [b[0], 0, b[1]], "boundary");
      }
      const inner = pts.map(p => [p[0] * 0.965, p[1] * 0.965]);
      for (let i = 0; i < inner.length; i++) {
        const a = inner[i], b = inner[(i + 1) % inner.length];
        seg([a[0], 1.5, a[1]], [b[0], 1.5, b[1]], "boundarySoft");
      }
    }

    /* Spines / boulevards */
    for (const spine of data.spines || []) {
      const pts = spine.points || [];
      const w = spine.width || 40;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length === 0 ? i : i + 1];
        if (!b) break;
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz) || 1;
        const nx = (-dz / len) * w / 2, nz = (dx / len) * w / 2;
        poly([[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]],
          "spine", 0.4, 0.5);
        seg([a[0], 0.6, a[1]], [b[0], 0.6, b[1]], "spineEdge");
        seg([a[0] + nx, 0.6, a[1] + nz], [b[0] + nx, 0.6, b[1] + nz], "spineEdge");
        seg([a[0] - nx, 0.6, a[1] - nz], [b[0] - nx, 0.6, b[1] - nz], "spineEdge");
      }
    }

    /* Water features */
    for (const w of data.water || []) {
      const pts = blob(w.center[0], w.center[1], w.radius, w.wobble == null ? 0.2 : w.wobble,
        w.segments || 40, (w.center[0] * 7 + w.center[1] * 13) | 0);
      poly(pts, "water", 0.8, 0.42);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        seg([a[0], 0.9, a[1]], [b[0], 0.9, b[1]], "waterEdge");
      }
    }

    /* District pavilion clusters */
    for (const d of data.districts || []) {
      const cells = hexGrid(d.center, d.radius || 260, d.cell || 66, d.seed || 7);
      for (const c of cells) {
        const base = hexRing(c.cx, c.cz, c.size, c.rot);
        const h = c.height;
        const top = hexRing(c.cx, c.cz, c.size * 0.92, c.rot);
        for (let i = 0; i < 6; i++) {
          const j = (i + 1) % 6;
          seg([base[i][0], 0, base[i][1]], [base[j][0], 0, base[j][1]], "buildingBase");
          seg([top[i][0], h, top[i][1]], [top[j][0], h, top[j][1]], "buildingTop");
          if (i % 2 === 0) seg([base[i][0], 0, base[i][1]], [top[i][0], h, top[i][1]], "buildingEdge");
        }
      }
      /* District boundary ring */
      const ringPts = ring(d.center[0], d.center[1], (d.radius || 260) * 1.08, 24);
      for (let i = 0; i < ringPts.length; i++) {
        const a = ringPts[i], b = ringPts[(i + 1) % ringPts.length];
        seg([a[0], 0.4, a[1]], [b[0], 0.4, b[1]], "districtRing");
      }
      if (d.label) marks.push({ kind: "label", at: [d.center[0], 26, d.center[1]], text: d.label, style: "districtLabel" });
    }

    /* Landmarks */
    for (const l of data.landmarks || []) {
      const c = l.center;
      if (l.type === "dome") {
        const R = l.radius, H = l.height, rings = l.rings || 8, segs = l.segments || 32;
        for (let r = 1; r <= rings; r++) {
          const t = r / rings;
          const rr = R * Math.cos(t * Math.PI / 2);
          const yy = H * Math.sin(t * Math.PI / 2);
          const pts = ring(c[0], c[1], rr, segs);
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            seg([a[0], yy, a[1]], [b[0], yy, b[1]], "landmark");
          }
        }
        for (let i = 0; i < segs; i += 2) {
          const a = (i / segs) * Math.PI * 2;
          let prev = [c[0] + R * Math.cos(a), 0, c[1] + R * Math.sin(a)];
          for (let r = 1; r <= rings; r++) {
            const t = r / rings;
            const rr = R * Math.cos(t * Math.PI / 2), yy = H * Math.sin(t * Math.PI / 2);
            const p = [c[0] + rr * Math.cos(a), yy, c[1] + rr * Math.sin(a)];
            seg(prev, p, "landmarkSoft");
            prev = p;
          }
        }
        seg([c[0], 0, c[1]], [c[0], H * 1.12, c[1]], "landmarkSoft");
      } else if (l.type === "ring") {
        const pts = ring(c[0], c[1], l.radius, l.segments || 48);
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          seg([a[0], l.height || 1, a[1]], [b[0], l.height || 1, b[1]], "plaza");
        }
      } else if (l.type === "gate") {
        const w = l.width / 2, h = l.height;
        for (const sgn of [-1, 1]) {
          const x = c[0] + sgn * w;
          seg([x, 0, c[1]], [x, h, c[1]], "landmark");
          seg([x, h, c[1] - 14], [x, h, c[1] + 14], "landmarkSoft");
        }
        seg([c[0] - w, h, c[1]], [c[0] + w, h, c[1]], "landmark");
        seg([c[0] - w, h * 0.55, c[1]], [c[0] + w, h * 0.55, c[1]], "landmarkSoft");
      } else if (l.type === "tower") {
        const r = l.radius, h = l.height;
        const base = ring(c[0], c[1], r, 8), top = ring(c[0], c[1], r * 0.55, 8);
        for (let i = 0; i < 8; i++) {
          const j = (i + 1) % 8;
          seg([base[i][0], 0, base[i][1]], [base[j][0], 0, base[j][1]], "landmark");
          seg([top[i][0], h, top[i][1]], [top[j][0], h, top[j][1]], "landmark");
          seg([base[i][0], 0, base[i][1]], [top[i][0], h, top[i][1]], "landmarkSoft");
        }
        seg([c[0], h, c[1]], [c[0], h + 26, c[1]], "landmark");
      }
      if (l.label) marks.push({ kind: "label", at: [c[0], (l.height || 20) + 18, c[1]], text: l.label, style: "landmarkLabel" });
    }

    /* Cameras: mast, head, ground coverage sector */
    const cameras = (data.cameras || []).map(cam => {
      const [px, py, pz] = cam.pos;
      const h = py || 10;
      seg([px, 0, pz], [px, h, pz], "mast");
      const head = [px, h, pz];
      const dir = [Math.sin(cam.yaw * DEG), Math.sin((cam.pitch || -15) * DEG), Math.cos(cam.yaw * DEG)];
      const tip = [head[0] + dir[0] * 16, head[1] + dir[1] * 16, head[2] + dir[2] * 16];
      seg(head, tip, "mast");
      seg([px - 9, h - 6, pz], [px + 9, h - 6, pz], "mast");
      seg([px, h - 6, pz - 9], [px, h - 6, pz + 9], "mast");
      const cov = sector(px, pz, cam.yaw, cam.fov || 65, cam.range || 300, 18);
      polys.push({ pts: [[px, pz]].concat(cov), style: "coverage", y: 0.5, alpha: 0.2, camColor: cam.color || "#4f8dff" });
      for (let i = 0; i < cov.length; i++) {
        seg([px, 0.7, pz], [cov[i][0], 0.7, cov[i][1]], i === 0 || i === cov.length - 1 ? "coverageEdge" : "coverageSoft");
        if (i) seg([cov[i - 1][0], 0.7, cov[i - 1][1]], [cov[i][0], 0.7, cov[i][1]], "coverageSoft");
      }
      return {
        id: cam.id, name: cam.name || cam.id, color: cam.color || "#4f8dff",
        pos: [px, h, pz], yaw: cam.yaw, fov: cam.fov, range: cam.range,
        ground: [px, pz], sector: cov, screen: null, depth: 0
      };
    });

    /* Reference labels for the stadium-scale features */
    return { lines, polys, marks, cameras, size, grid, meta: data.meta || {} };
  }

  /* ------------------------------------------------------------------ *
   * Renderer state
   * ------------------------------------------------------------------ */
  const state = {
    container: null, canvas: null, ctx: null, hud: null,
    scene: null, data: null, loading: false, error: null,
    width: 0, height: 0, dpr: 1,
    yaw: 40 * DEG, pitch: 30 * DEG, dist: 1720, target: [0, 30, 0],
    drag: null, hover: null, selected: null, autoRotate: false,
    raf: 0, needsRender: true, lastInput: 0, palette: {}, observer: null,
    legendOpen: true, markers: [], markerData: {people:[],incidents:[],unplaced:[]}, selectedMarker: null, hoverMarker: null, lastDraw: 0, lastTracking: 0, bindings: {}
  };

  const STYLE_TOKENS = {
    gridMinor: "grid", gridMajor: "gridStrong",
    boundary: "accent", boundarySoft: "accentSoft", districtRing: "accentSoft",
    buildingBase: "build", buildingTop: "buildTop", buildingEdge: "buildEdge",
    spine: "spine", spineEdge: "spineEdge",
    water: "water", waterEdge: "waterEdge",
    landmark: "accent", landmarkSoft: "accentSoft", plaza: "accentSoft",
    mast: "accent", coverage: "coverage", coverageEdge: "coverageEdge", coverageSoft: "coverageSoft"
  };
  const STYLE_WIDTH = {
    gridMinor: 0.5, gridMajor: 0.7, boundary: 1.9, boundarySoft: 0.8, districtRing: 0.7,
    buildingBase: 0.7, buildingTop: 1.1, buildingEdge: 0.55,
    spineEdge: 0.8, waterEdge: 0.9,
    landmark: 1.5, landmarkSoft: 0.6, plaza: 0.9,
    mast: 1.6, coverageEdge: 1.5, coverageSoft: 0.6
  };
  const STYLE_ALPHA = {
    gridMinor: 0.34, gridMajor: 0.5, boundary: 1, boundarySoft: 0.5, districtRing: 0.42,
    buildingBase: 0.5, buildingTop: 0.92, buildingEdge: 0.4,
    spineEdge: 0.55, waterEdge: 0.85,
    landmark: 0.95, landmarkSoft: 0.42, plaza: 0.6,
    mast: 1, coverageEdge: 0.9, coverageSoft: 0.4
  };

  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const get = (name, fallback) => (cs.getPropertyValue(name) || "").trim() || fallback;
    const accent = get("--cy", "#4f8dff");
    state.palette = {
      accent,
      accentSoft: get("--cy-border", accent),
      grid: get("--bd", "#343442"),
      gridStrong: get("--mu", "#a0a0ae"),
      build: get("--mu", "#a0a0ae"),
      buildTop: get("--tx", "#f7f7fb"),
      buildEdge: get("--bd", "#343442"),
      spine: get("--gr", "#55ba74"),
      spineEdge: get("--gr", "#55ba74"),
      water: "#2f8fd8",
      waterEdge: "#5fc8ff",
      coverage: accent,
      coverageEdge: accent,
      coverageSoft: accent,
      text: get("--tx", "#f7f7fb"),
      muted: get("--mu", "#a0a0ae"), card: get("--card", "#141422")
    };
  }

  function colorFor(style, camColor) {
    if (style === "coverage" || style === "coverageEdge" || style === "coverageSoft") return camColor || state.palette.accent;
    return state.palette[STYLE_TOKENS[style]] || state.palette.accent;
  }

  /* ------------------------------------------------------------------ *
   * Projection
   * ------------------------------------------------------------------ */
  function cameraBasis() {
    const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
    const cy = Math.cos(state.yaw), sy = Math.sin(state.yaw);
    const dir = [cp * sy, sp, cp * cy];
    const eye = [
      state.target[0] + dir[0] * state.dist,
      state.target[1] + dir[1] * state.dist,
      state.target[2] + dir[2] * state.dist
    ];
    const fwd = V.norm(V.sub(state.target, eye));
    const right = V.norm(V.cross(fwd, [0, 1, 0]));
    const up = V.cross(right, fwd);
    return { eye, fwd, right, up };
  }

  function projectPoint(p, cam) {
    const d = V.sub(p, cam.eye);
    const z = V.dot(d, cam.fwd);
    if (z <= NEAR) return null;
    const x = V.dot(d, cam.right), y = V.dot(d, cam.up);
    const f = (state.height / 2) / Math.tan(FOV / 2);
    return [state.width / 2 + (x / z) * f, state.height / 2 - (y / z) * f, z];
  }

  /* Clip a segment against the near plane, then project both ends. */
  function projectSegment(a, b, cam) {
    let da = V.sub(a, cam.eye), db = V.sub(b, cam.eye);
    let za = V.dot(da, cam.fwd), zb = V.dot(db, cam.fwd);
    if (za <= NEAR && zb <= NEAR) return null;
    let pa = a, pb = b;
    if (za <= NEAR) {
      const t = (NEAR - za) / (zb - za);
      pa = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    } else if (zb <= NEAR) {
      const t = (NEAR - zb) / (za - zb);
      pb = [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t, b[2] + (a[2] - b[2]) * t];
    }
    const sa = projectPoint(pa, cam), sb = projectPoint(pb, cam);
    if (!sa || !sb) return null;
    return [sa, sb];
  }

  function fogAlpha(depth, min, max) {
    const t = clamp((depth - min) / Math.max(max - min, 1), 0, 1);
    return 1 - t * 0.78;
  }

  /* ------------------------------------------------------------------ *
   * Draw
   * ------------------------------------------------------------------ */
  function resize() {
    if (!state.canvas) return;
    const rect = state.canvas.parentElement.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(280, Math.floor(rect.height || 460));
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.width = w; state.height = h;
    state.canvas.width = Math.floor(w * state.dpr);
    state.canvas.height = Math.floor(h * state.dpr);
    state.canvas.style.width = w + "px";
    state.canvas.style.height = h + "px";
    state.ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    state.needsRender = true;
  }

  function render() {
    const ctx = state.ctx;
    if (!ctx || !state.scene) return;
    ctx.clearRect(0, 0, state.width, state.height);
    const cam = cameraBasis();
    const scene = state.scene;

    /* Furthest / nearest depth for fog */
    let dMin = Infinity, dMax = 0;

    /* --- translucent ground polygons (water, spines, camera coverage) --- */
    const fills = [];
    for (const p of scene.polys) {
      const style = p.style;
      const color = style === "coverage"
        ? (p.camColor || state.palette.accent)
        : colorFor(style);
      const pts2 = [];
      let depth = 0, ok = true;
      for (const pt of p.pts) {
        const s = projectPoint([pt[0], p.y, pt[1]], cam);
        if (!s) { ok = false; break; }
        pts2.push(s); depth += s[2];
      }
      if (!ok || pts2.length < 3) continue;
      depth /= pts2.length;
      dMin = Math.min(dMin, depth); dMax = Math.max(dMax, depth);
      fills.push({ pts2, color, alpha: p.alpha, depth });
    }
    fills.sort((a, b) => b.depth - a.depth);
    for (const f of fills) {
      ctx.globalAlpha = f.alpha * fogAlpha(f.depth, dMin, dMax);
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.moveTo(f.pts2[0][0], f.pts2[0][1]);
      for (let i = 1; i < f.pts2.length; i++) ctx.lineTo(f.pts2[i][0], f.pts2[i][1]);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* --- wireframe lines, batched into style buckets for speed --- */
    const buckets = new Map();
    const pushTo = (key, x1, y1, x2, y2) => {
      let arr = buckets.get(key);
      if (!arr) { arr = []; buckets.set(key, arr); }
      arr.push(x1, y1, x2, y2);
    };

    for (const ln of scene.lines) {
      const pr = projectSegment(ln.a, ln.b, cam);
      if (!pr) continue;
      const depth = (pr[0][2] + pr[1][2]) / 2;
      dMin = Math.min(dMin, depth); dMax = Math.max(dMax, depth);
      const level = clamp(Math.round(((depth - 300) / 2600) * (FOG_STEPS - 1)), 0, FOG_STEPS - 1);
      pushTo(ln.style + "|" + level, pr[0][0], pr[0][1], pr[1][0], pr[1][1]);
    }

    if (!isFinite(dMin)) { dMin = 0; dMax = 1; }

    for (const [key, coords] of buckets) {
      const [style, levelStr] = key.split("|");
      const level = Number(levelStr);
      const alpha = (STYLE_ALPHA[style] || 0.7) * (1 - (level / (FOG_STEPS - 1)) * 0.7);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = colorFor(style);
      ctx.lineWidth = STYLE_WIDTH[style] || 0.8;
      ctx.beginPath();
      for (let i = 0; i < coords.length; i += 4) {
        ctx.moveTo(coords[i], coords[i + 1]);
        ctx.lineTo(coords[i + 2], coords[i + 3]);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    /* --- camera markers (screen space, drawn last) --- */
    const live = liveCameraMap();
    for (const c of scene.cameras) {
      const s = projectPoint(c.pos, cam);
      c.screen = s;
      c.depth = s ? s[2] : 0;
    }
    const visible = scene.cameras.filter(c => c.screen).sort((a, b) => b.depth - a.depth);

    for (const c of visible) {
      const info = live.get(c.id) || {};
      const color = info.alert ? '#ff5279' : info.color || c.color;
      const selected = state.selected === c.id;
      const isHover = state.hover === c.id;
      const r = selected ? 9 : isHover ? 8 : 6;
      const pulse = info.alert && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 1 + 0.5 * Math.sin(performance.now() / 260) : 1;

      ctx.globalAlpha = 0.22;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(c.screen[0], c.screen[1], r * 2.6 * pulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(c.screen[0], c.screen[1], r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = state.palette.text;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(c.screen[0], c.screen[1], r, 0, Math.PI * 2);
      ctx.stroke();

      /* label */
      const text = (info.sourceId || c.id) + (info.name ? " - " + info.name : "");
      ctx.font = '600 11px "IBM Plex Mono", ui-monospace, monospace';
      const tw = ctx.measureText(text).width;
      const lx = c.screen[0] + r + 8, ly = c.screen[1] - r - 6;
      ctx.globalAlpha = 0.78;
      ctx.fillStyle = state.palette.card || "#141422";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(lx - 5, ly - 12, tw + 12, 18, 5); else ctx.rect(lx - 5, ly - 12, tw + 12, 18);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = selected || isHover ? color : state.palette.text;
      ctx.fillText(text, lx, ly + 1);
    }

    /* --- feature labels --- */
    ctx.font = '600 10px "Inter", system-ui, sans-serif';
    for (const m of scene.marks) {
      const s = projectPoint(m.at, cam);
      if (!s) continue;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = state.palette.muted;
      ctx.fillText(m.text.toUpperCase(), s[0] - ctx.measureText(m.text.toUpperCase()).width / 2, s[1]);
    }
    ctx.globalAlpha = 1;
    drawPeople(cam);
  }

  /* ------------------------------------------------------------------ *
   * Live status bridge - reads the dashboard state when available
   * ------------------------------------------------------------------ */
  function appState() { try { return (typeof D !== "undefined" && D) ? D : null; } catch (e) { return null; } }
  function markerKey(m) { return `${m.kind}:${m.camera}:${m.id}`; }
  function updateTracking() {
    const app=appState();if(!app||!state.data||!window.SiteMapTracking)return;
    const observations=[];
    for(const source of app.cameras) {
      if(source.source_type==='webcam') {
        if(typeof W!=='undefined'&&W.active&&W.last) {
          const age=performance.now()-W.capturedAt;
          observations.push({camera:source.id,time:W.last.time,dets:W.last.dets,
            observedAt:Date.now()-age,stale:age>5000,paused:false});
        } else if(source.status==='live') {
          const a=app.analyses.get(source.id),f=a?.frames.at(-1);
          if(f&&a._mapSeenAt)observations.push({camera:source.id,time:f.time,dets:f.dets,
            observedAt:a._mapSeenAt,stale:Date.now()-a._mapSeenAt>5000,paused:false});
        }
        continue;
      }
      const saved=app.frames.get(source.id);if(!saved)continue;
      const video=[...document.querySelectorAll('video[data-camera]')].find(v=>v.dataset.camera===source.id);
      const time=video?.currentTime??saved.savedTime??saved.time;
      const a=app.analyses.get(source.id);
      const frame=a&&typeof sampleAt==='function'?sampleAt(a,time):null;
      if(frame)observations.push({camera:source.id,time,dets:frame.dets,
        observedAt:saved.observedAt,paused:!video||video.paused});
    }
    const incidents=app.incidents.map(event=>{
      const a=app.analyses.get(event.camera);
      if(!a||!event.person_id)return event;
      const frame=a.frames.reduce((best,f)=>Math.abs(f.time-event.time)<Math.abs((best?.time??Infinity)-event.time)?f:best,null);
      const person=frame&&Math.abs(frame.time-event.time)<.7?frame.dets.find(d=>d.class==='person'&&d.id===event.person_id):null;
      return person?{...event,map_box:person.box}:event;
    });
    const result=SiteMapTracking.markers({cameras:app.cameras,observations,incidents,
      placements:state.data.cameras,bindings:state.bindings,connected:app.connected});
    const old=new Map(state.markers.map(m=>[markerKey(m),m]));
    const next=[...result.people,...result.incidents];
    const signature=JSON.stringify(next.map(m=>[markerKey(m),m.at,m.alert,m.paused]));
    if(signature!==state.trackingSignature)state.needsRender=true;
    state.trackingSignature=signature;
    for(const marker of next){const previous=old.get(markerKey(marker));if(previous)marker.screen=previous.screen;}
    const counts=JSON.stringify([result.people.length,result.incidents.length,next.filter(m=>m.alert).map(m=>[m.id,m.incidents]),result.unplaced,observations.some(o=>o.paused)]);
    state.markers=next;state.markerData=result;
    if(counts!==state.trackingCounts){state.trackingCounts=counts;paintHud();}
  }
  function drawPeople(cam) {
    const ctx=state.ctx,now=performance.now();
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    for(const marker of state.markers) {
      const p=projectPoint(marker.at,cam);marker.screen=p;if(!p)continue;
      const selected=markerKey(marker)===state.selectedMarker,hover=markerKey(marker)===state.hoverMarker;
      const color=marker.alert?'#ff5279':'#64b5ff';
      if(marker.alert) {
        const phase=reduced ? .5 : (now%1500)/1500;
        ctx.globalAlpha=(1-phase)*.65;ctx.strokeStyle=color;ctx.lineWidth=1.7;
        ctx.beginPath();ctx.arc(p[0],p[1],5+phase*14,0,Math.PI*2);ctx.stroke();
      }
      ctx.globalAlpha=1;ctx.fillStyle=color;ctx.strokeStyle=state.palette.card;ctx.lineWidth=1.2;
      ctx.beginPath();ctx.arc(p[0],p[1],marker.alert?4.5:3.2,0,Math.PI*2);ctx.fill();ctx.stroke();
      if(selected||hover) {
        ctx.font='600 11px Inter,system-ui,sans-serif';
        const text=`${marker.person_id||marker.id} · ${marker.camera}${marker.alert?' · '+tt('OPEN INCIDENT','حادث مفتوح'):''}`;
        const width=ctx.measureText(text).width;
        const x=clamp(p[0]+10,4,Math.max(4,state.width-width-14)),y=clamp(p[1]-12,18,state.height-8);
        ctx.fillStyle=state.palette.card;ctx.fillRect(x-4,y-13,width+8,20);
        ctx.fillStyle=color;ctx.fillText(text,x,y);
      }
    }
    ctx.globalAlpha=1;
  }
  function pickPerson(x,y) {
    return state.markers.filter(m=>m.screen).map(m=>({marker:m,distance:Math.hypot(m.screen[0]-x,m.screen[1]-y)}))
      .filter(m=>m.distance<11).sort((a,b)=>a.distance-b.distance)[0]?.marker||null;
  }
  function bindSource(source,anchor) {
    if(anchor&&!state.data?.cameras.some(c=>c.id===anchor))return;
    if(anchor)state.bindings[source]=anchor;else delete state.bindings[source];
    try{localStorage.setItem('raqeeb.map.bindings',JSON.stringify(state.bindings));}catch{}
    refresh();
  }
  function onHudChange(event) {
    if(event.target.matches('[data-bind-source]'))bindSource(event.target.dataset.bindSource,event.target.value);
  }
  function trackingHud(marker) {
    const result=state.markerData;
    const paused=result.people.some(m=>m.paused);
    return `<div class="site-map-tracking"><span><i class="map-person-dot"></i><b>${result.people.length}</b> ${tt('people','شخص')}</span><span><i class="map-incident-dot"></i><b>${state.markers.filter(m=>m.alert).length}</b> ${tt('open incident markers','علامات حوادث مفتوحة')}</span><small>${paused?tt('Last viewed frames · Recordings paused','آخر إطارات معروضة · التسجيلات متوقفة'):tt('Current analyzed frames','الإطارات المحللة الحالية')}</small><label class="map-webcam-binding">${tt('Webcam position','موقع الكاميرا المباشرة')}<select data-bind-source="WEB-01" aria-label="${tt('Webcam map position','موقع الكاميرا على الخريطة')}"><option value="">${tt('Not placed','غير محدد')}</option>${(state.data?.cameras||[]).map(c=>`<option value="${esc(c.id)}"${state.bindings['WEB-01']===c.id?' selected':''}>${esc(c.id)} · ${esc(c.name)}</option>`).join('')}</select></label></div>
      ${result.unplaced.length?`<div class="map-placement-warning">${esc(result.unplaced.join(', '))} · ${tt('Choose a map position to show these detections.','اختر موقعاً لعرض الكشف على الخريطة.')}</div>`:''}
      ${marker?`<div class="map-person-detail"><b>${esc(marker.person_id||marker.id)}</b><span>${esc(marker.camera)} · ${marker.estimated?tt('Estimated placement','موقع تقديري'):tt('Calibrated placement','موقع معاير')}</span>${marker.kind==='person'?`<button class="btn o" data-person="${esc(marker.id)}">${tt('Person snapshot','لقطة الشخص')}</button>`:''}${marker.alert?`<button class="btn o" data-incident="${esc(marker.incidents[0])}">${tt('Review incident','مراجعة الحادث')}</button>`:''}</div>`:''}`;
  }
  function liveCameraMap() {
    const map = new Map();
    const app = appState();
    if (!app) return map;
    const alertCameras = new Set(
      (app.incidents || []).filter(e => e.status !== "Resolved" && e.status !== "False Positive").map(e => e.camera));
    for (const c of app.cameras || []) {
      map.set(c.id, {
        name: c.name, status: c.status, alert: alertCameras.has(c.id),
        color: ["ready","live"].includes(c.status) ? "#55ba74" : c.status === "error" ? "#fb416c" : "#e0b35b"
      });
    }
    for(const [source,anchor] of Object.entries(state.bindings)) {
      if(map.has(source)&&!map.has(anchor))map.set(anchor,{...map.get(source),sourceId:source});
    }
    return map;
  }

  /* ------------------------------------------------------------------ *
   * Interaction
   * ------------------------------------------------------------------ */
  function pointerPos(event) {
    const rect = state.canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  function pickCamera(x, y) {
    if (!state.scene) return null;
    let best = null, bestD = 22;
    for (const c of state.scene.cameras) {
      if (!c.screen) continue;
      const d = Math.hypot(c.screen[0] - x, c.screen[1] - y);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  function onPointerDown(event) {
    state.drag = { x: event.clientX, y: event.clientY, yaw: state.yaw, pitch: state.pitch, target: [...state.target], pan: event.shiftKey || event.button === 2, moved: 0 };
    state.autoRotate = false;
    state.canvas.setPointerCapture?.(event.pointerId);
    state.canvas.style.cursor = "grabbing";
  }

  function onPointerMove(event) {
    if (!state.drag) {
      const [x, y] = pointerPos(event);
      const person=pickPerson(x,y);
      const mk=person?markerKey(person):null;
      if(mk!==state.hoverMarker){state.hoverMarker=mk;state.needsRender=true;}
      const hit = pickCamera(x, y);
      const id = hit ? hit.id : null;
      if (id !== state.hover) { state.hover = id; state.canvas.style.cursor = id || mk ? "pointer" : "grab"; state.needsRender = true; }
      return;
    }
    const dx = event.clientX - state.drag.x, dy = event.clientY - state.drag.y;
    state.drag.moved = Math.max(state.drag.moved, Math.abs(dx) + Math.abs(dy));
    if (state.drag.pan) {
      const scale = state.dist / 900;
      const cy = Math.cos(state.yaw), sy = Math.sin(state.yaw);
      state.target[0] = state.drag.target[0] - (dx * cy - dy * sy) * scale;
      state.target[2] = state.drag.target[2] - (dx * sy + dy * cy) * scale;
    } else {
      state.yaw = state.drag.yaw - dx * 0.006;
      state.pitch = clamp(state.drag.pitch + dy * 0.005, 4 * DEG, 88 * DEG);
    }
    state.needsRender = true;
  }

  function onPointerUp(event) {
    if (state.drag && state.drag.moved < 5) {
      const [x, y] = pointerPos(event);
      const person=pickPerson(x,y);
      state.selectedMarker=person?markerKey(person):null;
      const hit = person?null:pickCamera(x, y);
      selectCamera(hit ? hit.id : null);
    }
    state.drag = null;
    if (state.canvas) state.canvas.style.cursor = state.hover ? "pointer" : "grab";
  }

  function onWheel(event) {
    event.preventDefault();
    state.dist = clamp(state.dist * (1 + Math.sign(event.deltaY) * 0.12), 260, 6200);
    state.needsRender = true;
    state.autoRotate = false;
  }

  function onMapKey(event) {
    if(event.key==='Home'){event.preventDefault();return setView('iso');}
    if(event.key==='ArrowLeft')state.yaw-=.08;
    else if(event.key==='ArrowRight')state.yaw+=.08;
    else if(event.key==='ArrowUp')state.pitch=clamp(state.pitch+.06,4*DEG,88*DEG);
    else if(event.key==='ArrowDown')state.pitch=clamp(state.pitch-.06,4*DEG,88*DEG);
    else if(['+','='].includes(event.key))state.dist=clamp(state.dist*.88,260,6200);
    else if(event.key==='-')state.dist=clamp(state.dist*1.12,260,6200);
    else return;
    event.preventDefault();state.autoRotate=false;state.needsRender=true;
  }

  function selectCamera(id) {
    state.selected = id;
    paintHud();
    state.needsRender = true;
  }

  function bindEvents() {
    const c = state.canvas;
    c.addEventListener("pointerdown", onPointerDown);
    c.addEventListener("pointermove", onPointerMove);
    c.addEventListener("pointerup", onPointerUp);
    c.addEventListener("pointerleave", () => { state.hover = null; state.needsRender = true; });
    c.addEventListener("wheel", onWheel, { passive: false });
    c.addEventListener('keydown',onMapKey);
    c.addEventListener("contextmenu", e => e.preventDefault());
    c.addEventListener("dblclick", () => setView("iso"));
  }

  function unbindEvents() {
    const c = state.canvas;
    if (!c) return;
    c.removeEventListener("pointerdown", onPointerDown);
    c.removeEventListener("pointermove", onPointerMove);
    c.removeEventListener("pointerup", onPointerUp);
    c.removeEventListener("wheel", onWheel);
    c.removeEventListener('keydown',onMapKey);
  }

  /* ------------------------------------------------------------------ *
   * HUD
   * ------------------------------------------------------------------ */
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, ch => "&#" + ch.charCodeAt(0) + ";"); }
  function tt(en, ar) { return (typeof T === "function") ? T(en, ar) : en; }

  function paintHud() {
    if (!state.hud || state.hud.contains(document.activeElement)) return;
    const live = liveCameraMap();
    const cams = state.scene ? state.scene.cameras : [];
    const selected = cams.find(c => c.id === state.selected);
    const info = selected ? (live.get(selected.id) || {}) : null;
    const ready = cams.filter(c => ["ready","live"].includes((live.get(c.id) || {}).status)).length;
    const marker=state.markers.find(m=>markerKey(m)===state.selectedMarker);

    state.hud.innerHTML =
      trackingHud(marker) +
      `<div class="site-map-summary">
         <span><i class="status-dot"></i><b>${cams.length}</b> ${tt("camera positions", "\u0645\u0648\u0627\u0642\u0639 \u0643\u0627\u0645\u064a\u0631\u0627")}</span>
         <span>${tt("Placed on plan", "\u0645\u0648\u0636\u0639\u0629 \u0639\u0644\u0649 \u0627\u0644\u0645\u062e\u0637\u0637")}</span>
         <span>${ready} ${tt("live ready", "\u062c\u0627\u0647\u0632\u0629")}</span>
       </div>
       <div class="site-map-views">
         <button type="button" class="btn quiet" data-view="iso">${tt("Isometric", "\u0645\u062c\u0633\u0645")}</button>
         <button type="button" class="btn quiet" data-view="top">${tt("Plan", "\u0645\u0633\u0642\u0637")}</button>
         <button type="button" class="btn quiet" data-view="plaza">${tt("Plaza", "\u0627\u0644\u0645\u064a\u062f\u0627\u0646")}</button>
         <button type="button" class="btn quiet" data-toggle="rotate">${state.autoRotate ? tt("Pause spin", "\u0625\u064a\u0642\u0627\u0641") : tt("Auto spin", "\u062a\u062f\u0648\u064a\u0631")}</button>
       </div>` +
      (selected
        ? `<div class="site-map-detail">
             <div class="site-map-detail-head"><b style="color:${info.color || selected.color}">${esc(selected.id)}</b><span>${esc(selected.name)}</span></div>
             <div class="site-map-detail-grid">
               <div><small>${tt("Status", "\u0627\u0644\u062d\u0627\u0644\u0629")}</small>${esc(info.status || "planned")}</div>
               <div><small>${tt("Heading", "\u0627\u0644\u0627\u062a\u062c\u0627\u0647")}</small>${Math.round(selected.yaw)}\u00b0</div>
               <div><small>${tt("Field of view", "\u0645\u062c\u0627\u0644 \u0627\u0644\u0631\u0624\u064a\u0629")}</small>${selected.fov}\u00b0</div>
               <div><small>${tt("Range", "\u0627\u0644\u0645\u062f\u0649")}</small>${selected.range} m</div>
               <div><small>${tt("Position", "\u0627\u0644\u0645\u0648\u0642\u0639")}</small>${selected.ground[0]}, ${selected.ground[1]}</div>
             </div>
             ${info.status ? `<button type="button" class="btn" data-open="${esc(info.sourceId || selected.id)}">${tt("Open live view", "\u0641\u062a\u062d \u0627\u0644\u0628\u062b")}</button>` : `<p class="mu">${tt("Planned map position; no connected camera source.", "\u0645\u0648\u0642\u0639 \u0645\u062e\u0637\u0637. \u0623\u0636\u0641 \u0645\u0642\u0637\u0639\u0627\u064b \u0644\u062a\u0641\u0639\u064a\u0644\u0647.")}</p>`}
           </div>`
        : marker ? "" : `<div class="site-map-detail"><p class="mu">${tt("Drag to orbit \u00b7 scroll to zoom \u00b7 shift-drag to pan \u00b7 click a camera pin", "\u0627\u0633\u062d\u0628 \u0644\u0644\u062f\u0648\u0631\u0627\u0646 \u00b7 \u0639\u062c\u0644\u0629 \u0644\u0644\u062a\u0643\u0628\u064a\u0631 \u00b7 \u0627\u0636\u063a\u0637 \u0639\u0644\u0649 \u0643\u0627\u0645\u064a\u0631\u0627")}</p></div>`);
  }

  function onHudClick(event) {
    const person=event.target.closest("[data-person]");
    if(person && typeof openPerson === "function") return openPerson(person.dataset.person);
    const incident=event.target.closest("[data-incident]");
    if(incident && typeof openAlert === "function") return openAlert(incident.dataset.incident);
    const view = event.target.closest("[data-view]");
    if (view) return setView(view.dataset.view);
    if (event.target.closest("[data-toggle='rotate']")) {
      state.autoRotate = !state.autoRotate;
      state.lastInput = performance.now();
      return paintHud();
    }
    const open = event.target.closest("[data-open]");
    if (open && typeof focusCamera === "function") return focusCamera(open.dataset.open);
  }

  function setView(name) {
    if (name === "top") { state.yaw = 0; state.pitch = 86 * DEG; state.dist = 2300; state.target = [0, 0, 0]; }
    else if (name === "plaza") { state.yaw = 200 * DEG; state.pitch = 16 * DEG; state.dist = 620; state.target = [0, 40, 0]; }
    else { state.yaw = 40 * DEG; state.pitch = 30 * DEG; state.dist = 1720; state.target = [0, 30, 0]; }
    state.autoRotate = false;
    paintHud();
    state.needsRender = true;
  }

  /* ------------------------------------------------------------------ *
   * Frame loop - only redraws when something changed, plus a slow spin
   * ------------------------------------------------------------------ */
  function frame() {
    state.raf = requestAnimationFrame(frame);
    if (document.hidden || !state.container?.isConnected) return;
    const now=performance.now();
    if(now-state.lastTracking>100){updateTracking();state.lastTracking=now;}
    if(state.markers.some(m=>m.alert)&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)state.needsRender=true;
    if(now-state.lastDraw<40)return;
    if (state.autoRotate && !state.drag) {
      state.yaw += 0.0022;
      state.needsRender = true;
    }
    if (state.needsRender) {
      state.needsRender = false;
      state.lastDraw=now;
      render();
      if (state.hover || state.selected) paintHudThrottled();
    }
  }

  let lastHud = 0;
  function paintHudThrottled() {
    const now = performance.now();
    if (now - lastHud < 320) return;
    lastHud = now;
    paintHud();
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */
  async function loadData() {
    if (state.data) return state.data;
    const url = (typeof api === "function") ? api("/site_map.json") : "site_map.json";
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("site_map.json unavailable");
    state.data = await res.json();
    return state.data;
  }

  function mount(container) {
    if (!container) return;
    if (state.container === container) { refresh(); return; }
    unmount();
    state.container = container;
    state.canvas = container.querySelector("canvas");
    try {state.bindings=JSON.parse(localStorage.getItem("raqeeb.map.bindings")||"{}");}catch{state.bindings={};}
    state.hud = container.querySelector(".site-map-hud");
    if (!state.canvas) return;
    state.ctx = state.canvas.getContext("2d");
    state.error = null;
    readPalette();
    resize();
    bindEvents();
    state.hud?.addEventListener("click", onHudClick);
    state.hud?.addEventListener("change",onHudChange);
    if (window.ResizeObserver) {
      state.observer = new ResizeObserver(() => { resize(); state.needsRender = true; });
      state.observer.observe(state.canvas.parentElement);
    }
    state.needsRender = true;
    if (!state.raf) state.raf = requestAnimationFrame(frame);

    state.loading = true;
    paintHud();
    loadData()
      .then(data => { state.scene = buildScene(data); state.loading = false; paintHud(); state.needsRender = true; })
      .catch(err => {
        state.loading = false;
        state.error = String(err.message || err);
        if (state.hud) {
          state.hud.innerHTML = `<div class="site-map-summary"><span>${tt("3D map unavailable", "\u0627\u0644\u062e\u0631\u064a\u0637\u0629 \u063a\u064a\u0631 \u0645\u062a\u0627\u062d\u0629")}: ${esc(state.error)}</span></div>`;
        }
      });
  }

  function unmount() {
    if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
    unbindEvents();
    state.observer?.disconnect();
    state.observer = null;
    state.hud?.removeEventListener("click", onHudClick);
    state.hud?.removeEventListener("change",onHudChange);
    state.container = null; state.canvas = null; state.ctx = null; state.hud = null;
  }

  function refresh() {
    if(!state.container)return;
    readPalette();
    updateTracking();
    paintHud();
    state.needsRender = true;
  }

  return { mount, unmount, refresh, setView, bindSource, get scene() { return state.scene; }, get markers(){return state.markers;}, get tracking(){return state.markerData;}, get mounted(){return !!state.container;} };
})();
