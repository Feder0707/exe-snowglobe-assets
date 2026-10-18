/* EXE SNOWGLOBE · engine v1.0 · form&soul.exe */
(function () {
  "use strict";
  const TAU = Math.PI * 2;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

  const DEFAULTS = {
    layout: "full",            // "full" (1920x1080) | "corner"
    cornerHeight: 640,
    /* LUCES DEL PUEBLO (53 en total: ventanas, faroles y relojes) */
    lightsNeeded: 53,          // luces que hay que encender antes de que el árbol pueda encenderse (0 = no hace falta)
    lightsPerFollow: 1,        // cada follow nuevo enciende N luces
    giftsPerFollow: 0,         // cada follow nuevo suma N regalos (por defecto no)
    shakesPerLight: 5,         // cada N !shake del chat encienden 1 luz (0 = apagado)
    lightsPerSub: 0,           // las subs también pueden encender luces (por defecto no)
    lightsPerRaid: 3, raidMin: 2,
    /* REGALOS (la meta del árbol) */
    treeGoal: 10,              // regalos necesarios para encender el árbol
    giftsPerSub: 1,            // cada sub / sub regalada = N regalos
    bitsPerGift: 500, bitsMin: 100,
    tipPerGift: 5, tipMin: 1,
    giftsPerRaid: 0,
    sleighGoal: 10,            // después del árbol: cada N regalos pasa el trineo
    maxPresents: 18,           // regalos visibles bajo el árbol
    /* COMANDOS */
    shakeCmd: "!shake", snowCmd: "!snow",
    shakeCooldown: 8, snowCooldown: 20,
    /* TEXTOS */
    names: true,
    title: "STARTING|SOON",
    subtitle: "grab a cocoa \u00b7 shake the globe with !shake",
    reducedMotion: null,       // null = respeta la preferencia del sistema
    lightsLabel: "LIGHTS", giftsLabel: "GIFTS",
    treeText: "LIGHT THE TREE", readyText: "TREE READY", sleighText: "CALL SANTA'S SLEIGH",
    showRecent: true,
    storageKey: "exe_snowglobe_v2",
  };

  const HELP = {
    en: "LIGHTS (the village): new follows, every N !shake from chat and raids light windows (subs too, if you enable it). " +
        "GIFTS (the tree): subs, gifted subs, bits and tips become presents under the tree. " +
        "When the village is lit and the gifts goal is reached, the tree lights up. Gifts that arrive early are kept.",
    es: "LUCES (el pueblo): los follows nuevos, cada N !shake del chat y los raids encienden ventanas (también las subs, si lo activas). " +
        "REGALOS (el árbol): subs, subs regaladas, bits y tips se convierten en regalos bajo el árbol. " +
        "Cuando el pueblo está encendido y se cumple la meta de regalos, se enciende el árbol. Los regalos que llegan antes se guardan.",
  };

  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = src; });
  }

  async function create(opts) {
    const cfg = Object.assign({}, DEFAULTS, opts.config || {});
    const DEMO = !!opts.demo;                           // herramientas de demo (llenado directo, preset, diagnóstico): solo en páginas de prueba
    const RM = cfg.reducedMotion !== null ? !!cfg.reducedMotion : !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
    const subtitleText = () => cfg.subtitle;
    const base = (opts.assets || "").replace(/\/?$/, "/");
    const canvas = opts.canvas, ctx = canvas.getContext("2d");
    const storage = opts.storage || null;
    const F = opts.files || null;                       // vista previa autocontenida: recursos embebidos
    const url = (f) => (F && F[f]) || base + f;
    const meta = F && F["scene.json"] ? F["scene.json"] : await (await fetch(base + "scene.json")).json();
    const [imgOff, imgLights, imgAmb, imgSleigh] = await Promise.all(
      ["globe_off.webp", "lights.webp", "ambient.webp", "sleigh.webp"].map((f) => loadImage(url(f))));
    const gifts = await Promise.all([...Array(9).keys()].map((i) => loadImage(url("gift_" + i + ".webp"))));
    const G = meta.globe, slots = meta.slots;
    const tree = slots.find((s) => s.kind === "tree"), star = slots.find((s) => s.kind === "star");
    const [STX, STY] = meta.star;
    const WIN = meta.order.windows, LAMPS = meta.order.lamps;
    const ALL = []; { let li = 0; WIN.forEach((w, i) => { ALL.push(w); if (i % 5 === 4 && li < LAMPS.length) ALL.push(LAMPS[li++]); }); while (li < LAMPS.length) ALL.push(LAMPS[li++]); }

    /* ---------- estado persistente ---------- */
    const fresh = () => ({ v: 2, lights: [], gifts: 0, treeAt: 0, sleighs: 0, shakes: 0, bitsBank: 0, tipBank: 0, presents: [], treeLit: false, recent: [], cel: { village: false, gifts: false } });
    let S = fresh();
    if (storage) { try { const got = await storage.get(cfg.storageKey); if (got && got.v === 2) S = Object.assign(S, got); if (!S.cel) S.cel = { village: S.treeLit, gifts: S.treeLit }; } catch (e) {} }
    const restoredQ = Array.isArray(S.q) ? S.q : [], restoredPC = Array.isArray(S.pc) ? S.pc : []; delete S.q; delete S.pc;   // eventos que quedaron en cola al cerrar
    let saveT = 0, destroyed = false, rafId = 0, frames = 0;
    const snapshot = () => {
      const o = JSON.parse(JSON.stringify(S, (k, v) => (k[0] === "_" ? undefined : v)));
      o.q = queue.map((j) => ({ k: j.k, name: j.name || "", big: !!j.big, eid: j.eid }));     // lo aún no procesado se guarda tal cual
      o.pc = pendCeleb.map((p) => ({ type: p.type, eid: p.eid }));
      return o;
    };
    const writeNow = () => { try { storage.set(cfg.storageKey, snapshot()); } catch (e) {} };
    function save() { if (!storage || destroyed) return; clearTimeout(saveT); saveT = setTimeout(() => { saveT = 0; writeNow(); }, 400); }

    /* ---------- vista ---------- */
    let view = { s: 1, ox: 0, oy: 0 }; let TS = 1;
    const [bx0, by0, bx1, by1] = meta.bbox;
    function layout() {
      if (cfg.layout === "corner") {
        const s = cfg.cornerHeight / (by1 - by0);
        canvas.width = Math.round((bx1 - bx0) * s); canvas.height = cfg.cornerHeight;
        view = { s, ox: -bx0 * s, oy: -by0 * s }; TS = clamp(0.62 / s, 1, 2.2);
      } else {
        canvas.width = 1920; canvas.height = 1080;
        const s = 1030 / (by1 - by0);
        view = { s, ox: 640 - ((bx0 + bx1) / 2) * s, oy: 540 - ((by0 + by1) / 2) * s + 4 }; TS = 1;
      }
    }
    layout();

    /* ---------- runtime ---------- */
    let manualT = null; const now = () => (manualT !== null ? manualT : performance.now() / 1000);
    const lit = new Map();      // slotIndex -> {t, name}
    S.lights.forEach((w) => lit.set(w.slot, { t: -99, name: w.name }));
    let treeAnim = S.treeLit ? -99 : null; let grandAt = S.treeLit ? -99 : null; const gold = []; let grandCount = 0;      // instante de inicio
    let starBurst = S.treeLit ? -99 : null;
    let sleigh = null, storm = null, shakeT = null;
    const blooms = [], drops = [], dust = [];
    const labels = [], labelQ = [];   // reconocimiento: activos (máx. 2) y pendientes
    const queue = []; let qBusy = 0;

    /* nieve dentro de la bola */
    const snow = [];
    function spawnFlake(top) {
      const a = rnd(0, TAU), rr = Math.sqrt(Math.random()) * (G.r - 70);
      return { x: G.cx + Math.cos(a) * rr, y: top ? G.cy - G.r + rnd(0, 120) : G.cy + Math.sin(a) * rr, vx: rnd(-6, 6), vy: rnd(30, 70), r: rnd(1.6, 4.2), ph: rnd(0, TAU), stop: rnd(1150, 1450) };
    }
    for (let i = 0; i < 150; i++) snow.push(spawnFlake(false));
    /* nieve fuera (solo pantalla completa) */
    const outSnow = [];
    for (let i = 0; i < 90; i++) outSnow.push({ x: rnd(0, 1920), y: rnd(0, 1080), v: rnd(18, 45), r: rnd(0.8, 2.4), ph: rnd(0, TAU) });

    /* bombillas del árbol */
    const bulbs = meta.bulbs.map(([x, y]) => ({ x, y, s: (tree.y + tree.h - y) / tree.h + 0.05 * Math.sin((x - 1025) / 28) + rnd(-0.03, 0.03), ph: rnd(0, TAU) }));

    /* ---------- lógica ---------- */
    const needLights = () => Math.min(Math.max(0, cfg.lightsNeeded | 0), ALL.length);
    const lightsDone = () => S.lights.length >= needLights();
    function remember(name, what) {
      if (!name) return; S.recent = [{ name, what }, ...S.recent.filter((r) => r.name !== name)].slice(0, 4);
    }
    let curEid = 0, eidN = 0, celeb = null; const pendCeleb = [], celebCount = { village: 0, gifts: 0 };
    { const m = new Map(), id = (x) => { if (!m.has(x)) m.set(x, ++eidN); return m.get(x); };   // se reanudan con la lógica normal (animaciones e hitos una sola vez)
      for (const j of restoredQ) if (j && (j.k === "light" || j.k === "gift")) queue.push({ k: j.k, name: j.name, big: j.big, eid: id(j.eid) });
      for (const p of restoredPC) if (p && (p.type === "village" || p.type === "gifts")) pendCeleb.push({ type: p.type, eid: id(p.eid) }); }
    function addLights(n, name) { for (let i = 0; i < n; i++) queue.push({ k: "light", name, eid: curEid }); }
    function addGifts(n, name, big) { for (let i = 0; i < n; i++) queue.push({ k: "gift", name, big: big && i === 0, eid: curEid }); }
    function checkTree(t) {
      if (needLights() === 0 && !(cfg.treeGoal > 0)) return;          // ambas metas en 0: sin celebraciones automáticas
      if (!S.treeLit && lightsDone() && S.gifts >= cfg.treeGoal) { if (celeb) celeb.fadeAt = t; pendCeleb.length = 0; S.treeLit = true; S.treeAt = S.gifts; treeAnim = t + 0.6; starBurst = t + 3.2; grandAt = t + 3.2; grandCount += 1; sleigh = { t: t + 6.5 }; }
      else if (S.treeLit && cfg.sleighGoal > 0 && S.gifts - S.treeAt >= cfg.sleighGoal * (S.sleighs + 1)) { S.sleighs += 1; starBurst = t + 0.3; sleigh = { t: t + 0.9 }; }
    }
    function step(t) {
      if (qBusy > t || !queue.length) return;
      const job = queue.shift();
      const wasL = lightsDone(), wasG = S.gifts >= cfg.treeGoal;
      if (job.k === "light") {
        if (S.lights.length < ALL.length) {
          const slot = ALL[S.lights.length]; S.lights.push({ slot, name: job.name || "" });
          lit.set(slot, { t, name: job.name }); bloomAt(slots[slot], t, 1);
          recognize("light", job.name, { slot }, t);
        } else if (job.name) { const slot = ALL[Math.floor(Math.random() * ALL.length)]; bloomAt(slots[slot], t, 0.6); recognize("light", job.name, { slot }, t); }
        qBusy = t + (job.fast ? 0.05 : 0.38);
      } else if (job.k === "gift") {
        S.gifts += 1;
        if (S.presents.length < cfg.maxPresents) addPresent(job.name, t, job.big);
        else recognize("gift", job.name, { tree: true }, t);
        qBusy = t + (job.fast ? 0.2 : 0.5);
      }
      checkTree(t);
      // celebraciones intermedias: solo si la otra meta sigue pendiente; esperan a que termine el mismo evento
      if (!S.treeLit) {
        if (!wasL && lightsDone() && needLights() > 0 && !S.cel.village) pendCeleb.push({ type: "village", eid: job.eid });
        if (!wasG && S.gifts >= cfg.treeGoal && cfg.treeGoal > 0 && !S.cel.gifts) pendCeleb.push({ type: "gifts", eid: job.eid });
      }
      for (let k = pendCeleb.length - 1; k >= 0; k--) {
        const pc = pendCeleb[k]; if (queue.some((j) => j.eid === pc.eid)) continue;
        pendCeleb.splice(k, 1); if (!S.treeLit && !S.cel[pc.type]) { S.cel[pc.type] = true; celeb = { type: pc.type, t }; celebCount[pc.type] += 1; }
      }
      save();
    }
    function recognize(kind, name, anchor, t) {
      if (!cfg.names || !name) return;
      const nm = String(name);
      // agrupar: el mismo nombre con la misma acción se suma (×N) en vez de repetirse
      const act = labels.find((l) => l.kind === kind && l.name === nm && t - l.t < 1.6);
      if (act) { act.count += 1; act.anchor = anchor; act.t = Math.max(act.t, t - 0.3); return; }
      const pend = labelQ.find((l) => l.kind === kind && l.name === nm);
      if (pend) { pend.count += 1; pend.anchor = anchor; return; }
      labelQ.push({ kind, name: nm, anchor, count: 1 });
      // si se acumulan muchos, los más viejos se resumen en un solo cartel "+N"
      while (labelQ.length > 5) {
        const i = labelQ.findIndex((l) => l.kind !== "more"); const old = labelQ.splice(i, 1)[0];
        const more = labelQ.find((l) => l.kind === "more");
        if (more) more.count += old.count; else labelQ.unshift({ kind: "more", name: "", anchor: { tree: true }, count: old.count });
      }
    }
    function bloomAt(s, t, k) { blooms.push({ x: s.cx, y: s.cy, r: 40 + Math.max(s.gw || 20, s.gh || 20) * 1.6, t, k }); }
    const GIFT_H = [52, 44, 62, 50, 54, 70, 54, 32, 48];          // altura natural de cada forma
    const GIFT_ORDER = [1, 7, 3, 0, 6, 2, 8, 4];                    // redonda, plana, dorada, cubo, verde, alta…
    const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    function giftSize(g) { const img = gifts[g], h = GIFT_H[g]; return { w: img.width * (h / img.height), h }; }
    function placePresent(i, g) {
      const { w } = giftSize(g), placed = S.presents.filter((p) => p.x != null);
      const cands = [];
      for (const [row, y0] of [[0, 816], [1, 800], [2, 786]]) for (let k = 0; k <= 12; k++) for (const sgn of [-1, 1]) {
        if (k === 0 && sgn === 1) continue; const dx = sgn * k * 12; if (Math.abs(dx) + w / 2 > 150 - row * 10) continue;
        cands.push({ x: 1025 + dx, y: y0, cost: row * 40 + Math.abs(dx) });
      }
      cands.sort((a, b) => a.cost - b.cost);
      for (const c of cands) {
        const jx = (hash(i) - 0.5) * 10, jy = (hash(i + 50) - 0.5) * 6, x = c.x + jx, y = c.y + jy;
        let ok = true;
        for (const p of placed) { const pw = giftSize(p.g).w; const ov = Math.min(x + w / 2, p.x + pw / 2) - Math.max(x - w / 2, p.x - pw / 2);
          if (Math.abs(p.y - y) < 12 && ov > Math.min(w, pw) * 0.12) { ok = false; break; } if (Math.abs(p.y - y) >= 12 && ov > Math.min(w, pw) * 0.55) { ok = false; break; } }
        if (ok) return { x, y };
      }
      const L = placed.length; return { x: 1025 + (hash(i) - 0.5) * 220, y: 780 - (L % 3) * 10 };   // montón lleno: se apilan detrás
    }
    function addPresent(name, t, big) {
      const i = S.presents.length;
      const g = big ? 5 : GIFT_ORDER[i % GIFT_ORDER.length];
      const pos = placePresent(i, g);
      S.presents.push({ g, name: name || "", x: pos.x, y: pos.y });
      drops.push({ i, t });
      recognize("gift", name, { present: i }, t);
      save();
    }
    const cd = { shake: 0, snow: new Map() };
    function shake(name, t, counts = true, force = false) {
      if (!force && t < cd.shake) return false; cd.shake = t + cfg.shakeCooldown;
      shakeT = t; storm = { t };
      for (let i = 0; i < 420; i++) {
        const f = spawnFlake(false); const dx = f.x - G.cx, dy = f.y - G.cy, d = Math.hypot(dx, dy) || 1, sp = rnd(160, 420);
        f.vx = -dy / d * sp + rnd(-60, 60); f.vy = dx / d * sp - rnd(40, 200); f.r = rnd(2, 5.2); f.storm = true; snow.push(f);
      }
      let lights = false;
      if (counts && cfg.shakesPerLight > 0) { S.shakes += 1; if (S.shakes % cfg.shakesPerLight === 0) { addLights(1, name); lights = true; } save(); }
      if (name && !lights) recognize("snow", name, { sky: true }, t);   // si enciende una luz, el nombre va en la ventana (sin duplicar)
      return true;
    }

    const api = {
      event(ev) {
        if (destroyed) return false;
        const t = now(); const n = ev.name || ""; const amt = +ev.amount || 0; curEid = ++eidN;
        const force = !!ev.force;                           // réplica de un evento ya aceptado por otra vista: sin cooldown
        switch (ev.type) {
          case "follow": remember(n, "follow"); addLights(cfg.lightsPerFollow, n); addGifts(cfg.giftsPerFollow, n); break;
          case "sub": remember(n, "sub"); addGifts(cfg.giftsPerSub, n); addLights(cfg.lightsPerSub, n); break;
          case "gift": { const c = Math.max(1, +ev.count || 1); remember(n, "gift"); addGifts(cfg.giftsPerSub * c, n); addLights(cfg.lightsPerSub * c, n); break; }
          case "bits": if (amt >= cfg.bitsMin) { remember(n, "bits"); S.bitsBank += amt; const g = Math.floor(S.bitsBank / cfg.bitsPerGift); S.bitsBank -= g * cfg.bitsPerGift;
            if (g) addGifts(g, n, amt >= cfg.bitsPerGift * 5); else recognize("spark", n, { tree: true }, t); save(); } break;
          case "tip": if (amt >= cfg.tipMin) { remember(n, "tip"); S.tipBank += amt; const g = Math.floor(S.tipBank / cfg.tipPerGift); S.tipBank -= g * cfg.tipPerGift;
            if (g) addGifts(g, n, amt >= cfg.tipPerGift * 5); else recognize("spark", n, { tree: true }, t); save(); } break;
          case "raid": if (amt >= cfg.raidMin) { remember(n, "raid"); shake(null, t, false, force); addLights(cfg.lightsPerRaid, n); addGifts(cfg.giftsPerRaid, n, true); } break;
          case "shake": return shake(n, t, true, force);
          case "snow": { const last = cd.snow.get(n) || 0; if (!force && t < last) return false; cd.snow.set(n, t + cfg.snowCooldown); recognize("snow", n || "someone", { sky: true }, t); return true; }
          case "addLights": addLights(Math.max(0, Math.min(200, +ev.count | 0)), n); break;   // ajuste manual del streamer/mod
          case "addGifts": addGifts(Math.max(0, Math.min(200, +ev.count | 0)), n); break;
          case "finale": if (!DEMO) break; S.gifts = Math.max(S.gifts, cfg.treeGoal); while (!lightsDone()) { const slot = ALL[S.lights.length]; S.lights.push({ slot, name: "" }); lit.set(slot, { t, name: "" }); } checkTree(t); save(); break;
        }
        save();                                             // lo aceptado (y su cola) se guarda enseguida
        return true;
      },
      chat(name, text) {
        const w = String(text || "").trim().toLowerCase().split(/\s+/)[0];
        if (w === cfg.shakeCmd.toLowerCase()) return api.event({ type: "shake", name });
        if (w === cfg.snowCmd.toLowerCase()) return api.event({ type: "snow", name });
        return false;
      },
      reset() { if (destroyed) return; S = fresh(); lit.clear(); queue.length = 0; celeb = null; pendCeleb.length = 0; celebCount.village = celebCount.gifts = 0; grandCount = 0; treeAnim = null; starBurst = null; grandAt = null; gold.length = 0; sleigh = null; labels.length = 0; labelQ.length = 0; save(); },
      debug: () => ({ subtitle: subtitleText(), storageKey: cfg.storageKey, labels: labels.map((l) => ({ kind: l.kind, text: l.text, count: l.count, box: l.box })), pending: labelQ.length, lights: S.lights.length, gifts: S.gifts, treeLit: S.treeLit, grandCount, celebCount, celeb: celeb && celeb.type, sleighs: S.sleighs, queue: queue.length }),
      state: () => S,
      snapshot: () => snapshot(),
      totals: () => ({ lights: S.lights.length + queue.filter((j) => j.k === "light").length, gifts: S.gifts + queue.filter((j) => j.k === "gift").length, shakes: S.shakes, bits: S.bitsBank, tip: S.tipBank }),
      preset(o) { // solo para pruebas/demos: deja el pueblo en un estado dado al instante
        if (destroyed) return;
        const t = now();
        while (S.lights.length < Math.min(o.lights || 0, ALL.length)) { const slot = ALL[S.lights.length]; S.lights.push({ slot, name: "" }); lit.set(slot, { t: -99, name: "" }); }
        for (let i = 0; i < (o.gifts || 0); i++) { S.gifts++; if (S.presents.length < cfg.maxPresents) { const g = GIFT_ORDER[S.presents.length % GIFT_ORDER.length], pos = placePresent(S.presents.length, g); S.presents.push({ g, name: "", x: pos.x, y: pos.y }); } }
      },
      setConfig(c) { Object.assign(cfg, c); layout(); },
      demoFill(kind) { // solo para la página de demostración: completa una meta en cascada rápida, sin carteles
        if (destroyed) return;
        curEid = ++eidN;
        if (kind === "lights") { const n = needLights() - S.lights.length - queue.filter((j) => j.k === "light").length; for (let i = 0; i < n; i++) queue.push({ k: "light", name: "", eid: curEid, fast: true }); }
        else { const n = cfg.treeGoal - S.gifts - queue.filter((j) => j.k === "gift").length; for (let i = 0; i < n; i++) queue.push({ k: "gift", name: "", eid: curEid, fast: true }); }
      },
    };

    /* ---------- dibujo ---------- */
    function drawSlot(i, a) {
      const s = slots[i]; if (a <= 0) return;
      ctx.globalAlpha = a; ctx.drawImage(imgLights, s.ax, s.ay, s.w, s.h, s.x, s.y, s.w, s.h); ctx.globalAlpha = 1;
    }
    const glowCache = new Map();
    function glowSprite(col) {
      let c = glowCache.get(col); if (c) return c;
      c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, `rgba(${col},1)`); gr.addColorStop(0.35, `rgba(${col},0.45)`); gr.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128); glowCache.set(col, c); return c;
    }
    function glow(x, y, r, a, col) {
      if (a <= 0.003 || r <= 0) return;
      const pa = ctx.globalAlpha; ctx.globalAlpha = Math.min(1, a); ctx.drawImage(glowSprite(col), x - r, y - r, 2 * r, 2 * r); ctx.globalAlpha = pa;
    }
    const GLASS_R = G.r - 34, GLASS_FLOOR = 1458;
    function sparkle(x, y, r, a) {   // destello de 4 puntas (purpurina), distinto a los rayos de la estrella
      if (a <= 0.01) return;
      glow(x, y, r * 1.6, 0.5 * a, "255,214,225");
      ctx.strokeStyle = `rgba(255,245,235,${a})`; ctx.lineWidth = Math.max(1.2, r * 0.18); ctx.beginPath();
      ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r * 1.3); ctx.lineTo(x, y + r * 1.3); ctx.stroke();
    }
    function globeClip() { ctx.beginPath(); ctx.arc(G.cx, G.cy, GLASS_R, 0, TAU); ctx.clip(); ctx.beginPath(); ctx.rect(0, 0, 4096, GLASS_FLOOR); ctx.clip(); }

    /* ----- carteles de reconocimiento (estilo letreros del pueblo) ----- */
    const LBL_LIFE = 2.8, LBL_SKY = 3.4;
    function shortName(n) { n = String(n).replace(/\s+/g, " ").trim(); return n.length > 16 ? n.slice(0, 15) + "\u2026" : n; }
    function icon(kind, x, y, r) {      // símbolos vectoriales en la paleta (sin emojis de color)
      ctx.save(); ctx.translate(x, y); ctx.lineCap = "round";
      if (kind === "snow") { ctx.strokeStyle = "#eef3ff"; ctx.lineWidth = r * 0.16; for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r); ctx.moveTo(0, -r * 0.55); ctx.lineTo(r * 0.22, -r * 0.75); ctx.moveTo(0, -r * 0.55); ctx.lineTo(-r * 0.22, -r * 0.75); ctx.stroke(); ctx.rotate(TAU / 6); } }
      else if (kind === "gift") { ctx.fillStyle = "#c9a45c"; ctx.fillRect(-r * 0.75, -r * 0.45, r * 1.5, r * 1.15); ctx.fillStyle = "#2a1a0e"; ctx.fillRect(-r * 0.12, -r * 0.45, r * 0.24, r * 1.15); ctx.fillRect(-r * 0.75, -r * 0.05, r * 1.5, r * 0.2);
        ctx.strokeStyle = "#c9a45c"; ctx.lineWidth = r * 0.16; ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.62, r * 0.3, r * 0.17, 0.4, 0, TAU); ctx.ellipse(r * 0.3, -r * 0.62, r * 0.3, r * 0.17, -0.4, 0, TAU); ctx.stroke(); }
      else { ctx.fillStyle = "#e8c77e"; ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * 0.32, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.32, 0); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(-r * 0.75, 0); ctx.lineTo(0, -r * 0.22); ctx.lineTo(r * 0.75, 0); ctx.lineTo(0, r * 0.22); ctx.closePath(); ctx.fill(); }
      ctx.restore();
    }
    function anchorPos(l) {
      const A = l.anchor;
      if (A.slot != null) { const s = slots[A.slot]; return { x: s.cx, y: (s.gy != null ? s.gy : s.y) - 16 }; }
      if (A.present != null) { const P = S.presents[A.present] && S.presents[A.present]._pos; if (P) return { x: P.x, y: P.y - P.h - 14 }; }
      if (A.sky) return { x: l.skyX, y: G.cy - G.r * 0.62 };
      return { x: 1025, y: 890 };   // plaza delante del árbol (nunca sobre la estrella)
    }
    function labelText(l) {
      if (l.kind === "more") return `+${l.count}`;
      return shortName(l.name) + (l.count > 1 ? ` \u00d7${l.count}` : "");
    }
    function drawLabels(t) {
      // activar pendientes (máx. 2 visibles)
      for (let k = labels.length - 1; k >= 0; k--) { const l = labels[k]; if (t - l.t > (l.anchor.sky ? LBL_SKY : LBL_LIFE)) labels.splice(k, 1); }
      const hold = celeb || (grandAt !== null && t > grandAt - 0.8 && t < grandAt + 3.5);   // durante una celebración no entran carteles nuevos
      while (!hold && labels.length < 2 && labelQ.length) { const l = labelQ.shift(); l.t = t; l.skyX = G.cx + rnd(-G.r * 0.45, G.r * 0.45); labels.push(l); }
      const fs = 26 * TS, padX = 14 * TS, h = 38 * TS, boxes = [];
      for (const l of labels) {
        const e = t - l.t, life = l.anchor.sky ? LBL_SKY : LBL_LIFE;
        const a = Math.min(1, e / 0.3) * Math.min(1, (life - e) / 0.5);
        let { x, y } = anchorPos(l);
        if (l.anchor.sky) y += e * 70;                                   // el nombre cae como un copo
        else y -= Math.min(e, 1) * 6;                                    // asciende apenas y se queda
        ctx.save(); ctx.font = `700 ${fs}px Cinzel, 'Playfair Display', serif`;
        const text = labelText(l); l.text = text;
        const hasIcon = l.kind !== "more", iw = hasIcon ? fs * 0.9 : 0;
        const w = Math.min(ctx.measureText(text).width, 330 * TS) + padX * 2 + iw;
        // dentro del vidrio y sin pisar el otro cartel
        x = clamp(x, G.cx - GLASS_R * 0.78 + w / 2, G.cx + GLASS_R * 0.78 - w / 2);
        y = clamp(y, G.cy - GLASS_R * 0.8 + h, GLASS_FLOOR - 30);
        for (const b of boxes) if (Math.abs(b.x - x) < (b.w + w) / 2 + 6 && Math.abs(b.y - y) < h + 6) y = b.y - h - 8;
        const SR = 100 + 30 * (TS - 1);                                  // zona reservada de la estrella: ningún cartel la tapa
        if (Math.abs(x - STX) < w / 2 + SR && y > STY - SR && y - h < STY + SR) x = x < STX ? STX - w / 2 - SR : STX + w / 2 + SR;
        x = clamp(x, G.cx - GLASS_R * 0.9 + w / 2, G.cx + GLASS_R * 0.9 - w / 2);
        boxes.push({ x, y, w }); l.box = [Math.round(x - w / 2), Math.round(y - h), Math.round(w), Math.round(h)];
        if (a <= 0) { ctx.restore(); continue; }
        ctx.globalAlpha = a;
        if (l.anchor.sky) {                                              // copo con nombre: sin tablero, texto grabado
          ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.shadowColor = "rgba(8,14,30,0.9)"; ctx.shadowBlur = 6 * TS;
          icon("snow", x - (ctx.measureText(text).width / 2) - fs * 0.55, y - h / 2, fs * 0.42);
          ctx.fillStyle = "#f4ead2"; ctx.fillText(text, x + fs * 0.1, y - h / 2 + 1);
        } else {                                                         // letrero de madera con borde de bronce
          const x0 = x - w / 2, y0 = y - h;
          const gr = ctx.createLinearGradient(0, y0, 0, y); gr.addColorStop(0, "rgba(74,46,24,0.94)"); gr.addColorStop(1, "rgba(42,26,14,0.94)");
          ctx.fillStyle = gr; ctx.beginPath(); ctx.roundRect(x0, y0, w, h, 6 * TS); ctx.fill();
          ctx.strokeStyle = "rgba(201,164,92,0.9)"; ctx.lineWidth = 2 * TS; ctx.stroke();
          ctx.fillStyle = "rgba(201,164,92,0.9)"; for (const nx of [x0 + 6 * TS, x0 + w - 6 * TS]) { ctx.beginPath(); ctx.arc(nx, y0 + h / 2, 2.2 * TS, 0, TAU); ctx.fill(); }
          if (hasIcon) icon(l.kind, x0 + padX + iw * 0.35, y0 + h / 2, fs * 0.36);
          ctx.textAlign = "left"; ctx.textBaseline = "middle";
          ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillText(text, x0 + padX + iw, y0 + h / 2 + 2, 330 * TS);
          ctx.fillStyle = "#f4e3b8"; ctx.fillText(text, x0 + padX + iw, y0 + h / 2, 330 * TS);
        }
        ctx.restore();
      }
    }
    function drawBackground(t) {
      if (cfg.layout === "corner") { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
      const [r, g, b] = meta.bg;
      const grd = ctx.createRadialGradient(640, 520, 80, 760, 540, 1300);
      grd.addColorStop(0, `rgb(${r + 22},${g + 30},${b + 48})`); grd.addColorStop(1, `rgb(${Math.max(0, r - 4)},${Math.max(0, g - 6)},${Math.max(0, b - 10)})`);
      ctx.fillStyle = grd; ctx.fillRect(0, 0, 1920, 1080);
      // nieve lejana
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      for (const f of outSnow) { const y = (f.y + f.v * t) % 1100 - 10, x = f.x + Math.sin(t * 0.7 + f.ph) * 12; ctx.beginPath(); ctx.arc(x, y, f.r, 0, TAU); ctx.fill(); }
      // textos
      ctx.save(); ctx.textAlign = "left"; ctx.fillStyle = "#fff4dc"; ctx.shadowColor = "rgba(255,200,120,0.35)"; ctx.shadowBlur = 24;
      const lines = String(cfg.title).split("|").map((l) => l.trim());
      let fs = 120; ctx.font = `700 ${fs}px 'Playfair Display', serif`;
      const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
      if (widest > 700) { fs = Math.floor(fs * 700 / widest); ctx.font = `700 ${fs}px 'Playfair Display', serif`; }
      const lh = fs * 1.08, top = 470 - (lines.length - 1) * lh / 2;
      lines.forEach((l, i) => ctx.fillText(l, 1150, top + i * lh));
      ctx.shadowBlur = 0; ctx.fillStyle = "#c9d6ee"; ctx.font = "700 34px Quicksand, sans-serif";
      ctx.fillText(subtitleText(), 1154, top + (lines.length - 1) * lh + 76);
      if (cfg.showRecent && S.recent.length) {
        ctx.font = "700 26px Quicksand, sans-serif"; ctx.fillStyle = "rgba(255,226,170,0.9)";
        ctx.fillText("❄  " + S.recent.map((r) => r.name).filter(Boolean).slice(0, 3).join("   ❄  "), 1154, 400 + lines.length * 124 + 70);
      }
      ctx.restore();
    }

    let last = now();
    function frame() {
      if (destroyed) return;
      frames += 1;
      const t = now(), dt = Math.min(0.05, t - last); last = t;
      step(t);
      drawBackground(t);
      ctx.save(); ctx.setTransform(view.s, 0, 0, view.s, view.ox, view.oy);
      // temblor de la bola
      if (shakeT !== null) {
        const e = t - shakeT; if (e < 1.1 && !RM) { const a = 0.022 * Math.sin(e * 30) * (1 - e / 1.1); ctx.translate(G.cx, 1900); ctx.rotate(a); ctx.translate(-G.cx, -1900); } else shakeT = null;
      }
      ctx.drawImage(imgOff, 0, 0);
      // luz ambiente del pueblo (crece a medida que se enciende)
      const frac = S.lights.length / ALL.length;
      const ambA = clamp(Math.pow(frac, 1.15) * 0.9 + (S.treeLit ? 0.08 : 0), 0, 1);
      if (ambA > 0) { const A = meta.ambient; ctx.globalAlpha = ambA; ctx.drawImage(imgAmb, A.x, A.y); ctx.globalAlpha = 1; }
      // ventanas, relojes y faroles
      for (const [i, L] of lit) {
        const e = t - L.t; let a;
        if (e < 0) continue;
        if (e < 0.32) a = [0, 0.85, 0.15, 1, 0.45, 1][Math.min(5, Math.floor(e / 0.055))]; else a = 0.94 + 0.06 * Math.sin(t * 2.1 + i * 1.7);
        drawSlot(i, a);
      }
      // árbol
      if (treeAnim !== null && t >= treeAnim) {
        const p = clamp((t - treeAnim) / 2.4, 0, 1), ycut = tree.y + tree.h - tree.h * p;
        ctx.save(); ctx.beginPath(); ctx.rect(tree.x, ycut - 8, tree.w, tree.y + tree.h - ycut + 8); ctx.clip();
        ctx.drawImage(imgLights, tree.ax, tree.ay, tree.w, tree.h, tree.x, tree.y, tree.w, tree.h); ctx.restore();
      }
      // regalos
      S.presents.forEach((pr, i) => { if (pr.x == null) { const q = placePresent(i, pr.g); pr.x = q.x; pr.y = q.y; } });
      const order = S.presents.map((pr, i) => i).sort((a, b) => S.presents[a].y - S.presents[b].y || a - b);
      order.forEach((i) => { const pr = S.presents[i];
        const img = gifts[pr.g]; const { w, h } = giftSize(pr.g);
        let y = pr.y, x = pr.x;
        const d = drops.find((d) => d.i === i);
        if (d) { const e = t - d.t; if (e < 0.55) { const k = ease(e / 0.55); y -= (1 - k) * 90 - Math.sin(k * Math.PI) * 6; } }
        ctx.save(); ctx.globalAlpha = 0.45; ctx.fillStyle = "#081020"; ctx.beginPath(); ctx.ellipse(x, y - 2, w * 0.5, 5, 0, 0, TAU); ctx.fill(); ctx.restore();
        ctx.drawImage(img, x - w / 2, y - h, w, h);
        pr._pos = { x, y, w, h, land: d ? d.t + 0.55 : -99 };
      });
      // estrella (sprite)
      if (starBurst !== null && t >= starBurst) drawSlot(slots.indexOf(star), clamp((t - starBurst) / 0.15, 0, 1));

      // ---- luz aditiva ----
      ctx.globalCompositeOperation = "lighter";
      for (let k = blooms.length - 1; k >= 0; k--) {
        const b = blooms[k], e = t - b.t; if (e > 1.1) { blooms.splice(k, 1); continue; } if (e < 0) continue;
        glow(b.x, b.y, b.r, 0.55 * b.k * (1 - e / 1.1), "255,180,95");
      }
      for (const [i, L] of lit) { if (t - L.t < 0.3) continue; const sl = slots[i]; glow(sl.cx, sl.cy, 26 + Math.max(sl.gw || 10, sl.gh || 10) * 1.1, 0.13 + 0.03 * Math.sin(t * 1.7 + i), "255,176,90"); }
      // regalos: brillo propio (distinto a la estrella): halo rosado-dorado, purpurina que sube y luego un resplandor suave
      S.presents.forEach((pr, i) => {
        const P = pr._pos; if (!P) return; const cx = P.x, cy = P.y - P.h * 0.5, e = t - P.land;
        glow(cx, P.y - P.h * 0.4, P.w * 1.25, 0.2 + 0.05 * Math.sin(t * 1.6 + i * 1.3), "255,190,140");     // resplandor permanente
        ctx.save(); ctx.translate(cx, P.y - 2); ctx.scale(1, 0.32); glow(0, 0, P.w * 1.1, 0.3 + 0.06 * Math.sin(t * 1.3 + i), "255,200,150"); ctx.restore();   // charco de luz en la nieve
        if (Math.sin(t * 0.9 + i * 2.7) > 0.985) sparkle(cx + Math.sin(i * 5.1) * P.w * 0.3, P.y - P.h * 0.9, 9, 0.7);  // destello ocasional en el lazo
        if (e >= 0 && e < 3.2) {
          const k = Math.exp(-e / 1.1);
          glow(cx, cy, P.w * 1.7 + 40 * Math.min(1, e / 0.4), 0.32 * k, "255,170,190");
          glow(cx, cy, P.w * 0.75, 0.38 * k, "255,236,205");
          if (!pr._gl) pr._gl = [...Array(18)].map(() => ({ dx: rnd(-1, 1), v: rnd(50, 130), s: rnd(5, 9), ph: rnd(0, TAU), d: rnd(0, 0.7) }));
          for (const g of pr._gl) { const ee = e - g.d; if (ee < 0) continue; const a = 0.55 * Math.max(0, 1 - ee / 2.6) * (0.55 + 0.45 * Math.sin(ee * 14 + g.ph));
            sparkle(cx + g.dx * P.w * 0.7 + Math.sin(ee * 3 + g.ph) * 10, cy - g.v * ee, g.s, a); }
        }
      });
      if (treeAnim !== null && t >= treeAnim) {
        const p = (t - treeAnim) / 2.4, ycut = tree.y + tree.h - tree.h * clamp(p, 0, 1);
        if (p < 1.03) { // hilo de chispas que sube
          const half = 20 + (ycut - tree.y) * 0.36;
          const g = ctx.createLinearGradient(0, ycut - 7, 0, ycut + 7); g.addColorStop(0, "rgba(255,210,140,0)"); g.addColorStop(0.5, "rgba(255,210,140,0.45)"); g.addColorStop(1, "rgba(255,210,140,0)");
          ctx.fillStyle = g; ctx.fillRect(1025 - half, ycut - 7, half * 2, 14);
        }
        for (const b of bulbs) {
          const e = (p - b.s) * 2.4;
          if (e > 0 && e < 0.35) glow(b.x, b.y, 6 + 10 * e / 0.35, 0.8 * (1 - e / 0.35), "255,214,150");
          else if (p > 1 && (b.ph * 10 | 0) % 3 === 0) glow(b.x, b.y, 7, 0.16 * (0.5 + 0.5 * Math.sin(t * 3 + b.ph)), "255,214,150");
        }
      }
      /* ===== celebraciones intermedias (menores y distintas del gran final) ===== */
      if (celeb) {
        const d = t - celeb.t, D = celeb.type === "village" ? 2.6 : 3.2;
        const fade = celeb.fadeAt != null ? Math.max(0, 1 - (t - celeb.fadeAt) / 0.6) : 1;      // transición limpia al gran final
        if (d > D || fade <= 0) celeb = null;
        else if (celeb.type === "village") {
          // HITO 1 · pueblo completo: pulso cálido coordinado de ventanas y faroles + dos destellos dorados suaves en la estrella
          const env = Math.sin(Math.PI * Math.min(1, d / 1.6)) * (d < 1.6 ? 1 : 0) * fade;
          ctx.globalAlpha = 0.24 * env; const A = meta.ambient; ctx.drawImage(imgAmb, A.x, A.y); ctx.globalAlpha = 1;
          for (const [i] of lit) { const sl = slots[i]; glow(sl.cx, sl.cy, 46 + Math.max(sl.gw || 10, sl.gh || 10) * 1.5, 0.3 * env, "255,182,104"); }
          // dos destellos dorados suaves y separados (0,6 s cada uno, pausa visible entre ambos); el segundo, algo mayor
          [[0.55, 1], [1.45, 1.15]].forEach(([c, m]) => {
            const k = (d - c) / 0.6; if (k <= 0 || k >= 1) return;
            const v = Math.sin(Math.PI * k) * fade * m;
            glow(STX, STY, 150 * m, 0.34 * v, "255,206,128");
            glow(STX, STY, 58, 0.6 * v, "255,224,160");
            glow(STX, STY, 22, 0.9 * v, "255,246,220");
            const L = 50 + 46 * v; ctx.lineCap = "round"; ctx.lineWidth = 4;     // destello en cruz, fijo y con puntas que se desvanecen
            for (const [dx, dy] of [[L, 0], [0, L * 0.72]]) {
              const gr = ctx.createLinearGradient(STX - dx, STY - dy, STX + dx, STY + dy);
              gr.addColorStop(0, "rgba(255,230,180,0)"); gr.addColorStop(0.5, `rgba(255,240,205,${0.6 * v})`); gr.addColorStop(1, "rgba(255,230,180,0)");
              ctx.strokeStyle = gr; ctx.beginPath(); ctx.moveTo(STX - dx, STY - dy); ctx.lineTo(STX + dx, STY + dy); ctx.stroke();
            }
          });
        } else {
          // HITO 2 · regalos completos: los paquetes brillan, una estela sube y la estrella da UN destello concentrado y más sostenido
          const env = Math.sin(Math.PI * Math.min(1, d / D)) * fade;
          S.presents.forEach((pr, i) => {
            const P = pr._pos; if (!P) return;
            glow(P.x, P.y - P.h * 0.5, P.w * 1.5, 0.3 * env, "255,170,190");
            for (let q = 0; q < 3; q++) {
              const u = (d - q * 0.3 - (i % 5) * 0.06) / 1.3; if (u <= 0 || u >= 1) continue;
              const x0 = P.x, y0 = P.y - P.h, cx = (x0 + STX) / 2 + (i % 2 ? 60 : -60), cy = Math.min(y0, STY) - 40;
              const x = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * cx + u * u * STX, y = (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * cy + u * u * STY;
              sparkle(x, y, 7, 0.65 * Math.sin(Math.PI * u) * fade);
            }
          });
          // un único destello concentrado y sostenido cuando llega la estela: sube 0,3 s, se mantiene 0,8 s y se apaga en 0,6 s
          const k = d - 1.45; if (k > 0 && k < 1.7) {
            const v = (k < 0.3 ? Math.sin(Math.PI / 2 * k / 0.3) : k < 1.1 ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * (k - 1.1) / 0.6)) * fade;
            const br = 1 + 0.06 * Math.sin(k * 5);
            glow(STX, STY, 125 * br, 0.46 * v, "255,186,196");
            glow(STX, STY, 50 * br, 0.8 * v, "255,226,214");
            glow(STX, STY, 18, 1.0 * v, "255,250,240");
          }
        }
      }
      /* ===== GRAN FINAL: todo el pueblo encendido + todos los regalos ===== */
      if (grandAt !== null && t >= grandAt - 0.6) {
        ctx.save(); globeClip();
        const d = t - grandAt;
        if (d < 0) { glow(STX, STY, 30 + 60 * (d + 0.6), 0.5 * (d + 0.6) / 0.6, "255,226,160"); }   // la estrella se "carga"
        else {
          const e1 = Math.exp(-d / 1.3);
          // 1) destello principal y baño de luz cálida dentro de la bola
          glow(STX, STY, 120 + 200 * Math.min(1, d / 0.35), 0.75 * e1, "255,232,180");
          glow(G.cx, G.cy - 80, G.r * 1.05, 0.16 * Math.exp(-d / 1.6), "255,200,140");
          // 2) haces de luz que giran despacio (quedan para siempre, muy suaves)
          const rayA = (d < 4 ? 0.26 * Math.min(1, d / 0.4) * (0.35 + 0.65 * Math.exp(-d / 2.2)) : 0) + 0.07 + 0.02 * Math.sin(t * 0.9);
          ctx.save(); ctx.translate(STX, STY); ctx.rotate(RM ? 0.13 : t * 0.06);
          for (let k = 0; k < 12; k++) {
            const L = (k % 2 ? 300 : 520) * (0.8 + 0.2 * Math.sin(t * 0.7 + k));
            const gr = ctx.createLinearGradient(0, 0, L, 0); gr.addColorStop(0, `rgba(255,230,170,${rayA})`); gr.addColorStop(1, "rgba(255,230,170,0)");
            ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L, -L * 0.035); ctx.lineTo(L, L * 0.035); ctx.closePath(); ctx.fill(); ctx.rotate(TAU / 12);
          }
          ctx.restore();
          // 3) dos ondas de luz que recorren toda la bola
          for (const off of [0, 0.35]) { const dd = d - off; if (dd > 0 && dd < 1.8) { ctx.strokeStyle = `rgba(255,226,170,${0.22 * (1 - dd / 1.8)})`; ctx.lineWidth = 10 - 4 * dd; ctx.beginPath(); ctx.arc(STX, STY, 30 + 420 * dd, 0, TAU); ctx.stroke(); } }
          // 4) la onda enciende con un pulso cada ventana a su paso
          for (const [i] of lit) { const sl = slots[i], dist = Math.hypot(sl.cx - STX, sl.cy - STY), k = d - dist / 420;
            if (k > 0 && k < 1.2) glow(sl.cx, sl.cy, 50 + Math.max(sl.gw || 10, sl.gh || 10) * 1.6, 0.3 * Math.sin(Math.PI * k / 1.2), "255,176,96"); }
          // estrella: brillo permanente más rico que antes
          glow(STX, STY, 26 + 4 * Math.sin(t * 2.2), 0.95, "255,240,200");
          glow(STX, STY, 95, 0.32 + 0.06 * Math.sin(t * 1.7), "255,214,140");
          // 5) polvo dorado: estalla desde la estrella y cae lento sobre el pueblo
          if (gold.length === 0 && d < 0.1) for (let k = 0; k < (RM ? 50 : 140); k++) { const a = rnd(0, TAU), v = rnd(120, 520); gold.push({ x: STX, y: STY, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, s: rnd(2.5, 6), ph: rnd(0, TAU), born: grandAt }); }
        }
        ctx.restore();
      }
      if (gold.length) {
        ctx.save(); globeClip();
        for (let k = gold.length - 1; k >= 0; k--) {
          const g = gold[k], age = t - g.born; if (age > 7.5) { gold.splice(k, 1); continue; }
          g.vx *= 1 - 1.8 * dt; g.vy += (34 - g.vy) * 1.5 * dt; g.x += (g.vx + Math.sin(t * 1.4 + g.ph) * 14) * dt; g.y += g.vy * dt;
          const a = Math.min(1, (7.5 - age) / 2) * (0.6 + 0.4 * Math.sin(t * 9 + g.ph));
          glow(g.x, g.y, g.s * 3, 0.85 * a, "255,214,140");
        }
        ctx.restore();
      }
      if (starBurst !== null && t >= starBurst && !(grandAt !== null && t >= grandAt - 0.6 && starBurst === grandAt)) {
        const d = t - starBurst, e = Math.exp(-d / 0.45);
        glow(STX, STY, 14 + 20 * Math.min(1, d / 0.25), 0.8 * e + 0.25 + 0.06 * Math.sin(t * 2.4), "255,222,150");
        glow(STX, STY, 90, 0.18 * e + 0.08, "255,210,130");
        if (d < 1.4) {
          ctx.save(); ctx.translate(STX, STY); ctx.rotate(d * 0.2); ctx.strokeStyle = `rgba(255,228,170,${0.75 * Math.exp(-d / 0.45)})`; ctx.lineCap = "round";
          ctx.shadowColor = "rgba(255,210,140,0.9)"; ctx.shadowBlur = 10;
          const L = 40 + 140 * Math.min(1, d / 0.45);
          for (let k = 0; k < 8; k++) { ctx.lineWidth = k % 2 ? 1.5 : 2.5; const ln = L * (k % 2 ? 0.55 : 1); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(k * TAU / 8) * ln, Math.sin(k * TAU / 8) * ln); ctx.stroke(); }
          ctx.restore();
        }
        if (d < 1.0) { ctx.strokeStyle = `rgba(255,220,160,${0.16 * (1 - d)})`; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(STX, STY, 28 + 260 * d, 0, TAU); ctx.stroke(); }
        if (d < 2.0) {
          if (!frame.sp || frame.spT !== starBurst) { frame.spT = starBurst; frame.sp = [...Array(24)].map(() => ({ a: rnd(0, TAU), v: rnd(70, 190), s: rnd(2, 4) })); }
          for (const s of frame.sp) { const r = s.v * d; glow(STX + Math.cos(s.a) * r, STY + Math.sin(s.a) * r + 18 * d * d, s.s * 3, 0.8 * (1 - d / 2), "255,226,160"); }
        }
      }
      ctx.globalCompositeOperation = "source-over";

      // trineo (dentro de la bola)
      ctx.save(); globeClip();
      if (sleigh && t >= sleigh.t) {
        const e = (t - sleigh.t) / 6.5;
        if (e > 1) sleigh = null; else {
          const x = G.cx + G.r * 0.95 - e * G.r * 1.9, y = G.cy - G.r * 0.66 + Math.sin(e * Math.PI) * -24 + Math.sin(t * 5) * 3;
          const w = 190, h = imgSleigh.height * (w / imgSleigh.width);
          dust.push({ x: x + w * 0.42, y: y + h * 0.15, t }); if (dust.length > 120) dust.shift();
          ctx.globalCompositeOperation = "lighter";
          for (const p of dust) { const a = 1 - (t - p.t) / 1.4; if (a > 0) glow(p.x + (t - p.t) * 8, p.y + (t - p.t) * 22, 5, 0.5 * a, "255,214,150"); }
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = clamp(Math.min(e, 1 - e) * 10, 0, 1); ctx.drawImage(imgSleigh, x - w / 2, y - h / 2, w, h); ctx.globalAlpha = 1;
        }
      }
      // nieve
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      const stormK = storm ? Math.max(0, 1 - (t - storm.t) / 5.5) : 0;
      if (storm && stormK <= 0) storm = null;
      for (let i = snow.length - 1; i >= 0; i--) {
        const f = snow[i];
        if (f.storm) {
          f.vx *= 1 - 0.9 * dt; f.vy += (40 - f.vy) * 0.8 * dt; f.vx += Math.sin(t * 2 + f.ph) * 40 * dt * stormK;
          if (stormK <= 0 && f.y > f.stop) { snow.splice(i, 1); continue; }
        } else { f.vy = 30 + 30 * (f.r / 4.2); f.vx = Math.sin(t * 0.8 + f.ph) * 10; }
        f.x += f.vx * dt; f.y += f.vy * dt;
        const dx = f.x - G.cx, dy = f.y - G.cy, dd = Math.sqrt(dx * dx + dy * dy);
        if (dd > GLASS_R - 6) { f.x = G.cx + dx / dd * (GLASS_R - 8); f.y = G.cy + dy / dd * (GLASS_R - 8); const nx = dx / dd, ny = dy / dd, vn = f.vx * nx + f.vy * ny; if (vn > 0) { f.vx -= 1.6 * vn * nx; f.vy -= 1.6 * vn * ny; } }
        if (f.y > GLASS_FLOOR - 4) { if (f.storm) { snow.splice(i, 1); continue; } Object.assign(f, spawnFlake(true)); continue; }
        if (!f.storm && f.y > f.stop) { Object.assign(f, spawnFlake(true)); continue; }
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill();
      }
      ctx.restore();
      // placa
      let big, small; const gT = Math.min(S.gifts, cfg.treeGoal);
      if (!S.treeLit && !lightsDone()) { big = `${cfg.lightsLabel} ${S.lights.length}/${needLights()}`; small = `${cfg.giftsLabel} ${gT}/${cfg.treeGoal} \u00b7 ${S.gifts >= cfg.treeGoal ? cfg.readyText : cfg.treeText}`; }
      else if (!S.treeLit) { big = `${cfg.giftsLabel} ${gT}/${cfg.treeGoal}`; small = cfg.treeText; }
      else { const pr = cfg.sleighGoal > 0 ? (S.gifts - S.treeAt) - S.sleighs * cfg.sleighGoal : 0; big = cfg.sleighGoal > 0 ? `${cfg.giftsLabel} ${Math.min(pr, cfg.sleighGoal)}/${cfg.sleighGoal}` : cfg.treeText; small = cfg.sleighText; }
      big = String(big).toUpperCase(); small = String(small).toUpperCase();
      const [px0, py0, px1, py1] = meta.plaque, pcx = (px0 + px1) / 2;
      ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const fit = (str, size, maxW) => { let f = size; ctx.font = `700 ${f}px Cinzel, 'Playfair Display', serif`; while (ctx.measureText(str).width > maxW && f > 14) { f -= 2; ctx.font = `700 ${f}px Cinzel, 'Playfair Display', serif`; } };
      const engrave = (str, y) => { ctx.fillStyle = "rgba(10,6,2,0.85)"; ctx.fillText(str, pcx, y + 2.5); ctx.fillStyle = "#f6e2ae"; ctx.fillText(str, pcx, y); };
      ctx.shadowColor = "rgba(255,214,140,0.45)"; ctx.shadowBlur = 6;
      fit(big, 58, px1 - px0 - 70); engrave(big, py0 + 64);
      fit(small, 30, px1 - px0 - 70); engrave(small, py0 + 122);
      ctx.restore();
      drawLabels(t);
      ctx.restore();
      if (!opts.manual && !destroyed) rafId = requestAnimationFrame(frame);
    }
    if (!opts.manual) rafId = requestAnimationFrame(frame);
    api.tick = (t) => { if (destroyed) return; manualT = t; frame(); };
    api.alive = () => !destroyed;
    api.destroy = () => {                               // detiene el bucle y libera temporizadores; el progreso guardado se conserva
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(rafId); rafId = 0;
      const pending = !!saveT || queue.length > 0 || pendCeleb.length > 0; clearTimeout(saveT); saveT = 0;
      if (storage && pending) writeNow();               // guarda lo pendiente (estado y cola) en vez de perderlo; si no hay nada pendiente no toca lo guardado
      queue.length = 0;
    };
    if (!DEMO) { delete api.preset; delete api.demoFill; }
    else { const dbg = api.debug; api.debug = () => Object.assign(dbg(), { frames, alive: !destroyed }); }
    api.ready = true;
    return api;
  }
  window.SnowGlobe = { create, DEFAULTS, HELP };
})();
