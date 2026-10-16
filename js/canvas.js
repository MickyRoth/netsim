'use strict';

/* Arbeitsfläche: Darstellung (SVG), Auswahl, Verschieben, Verkabeln, Zoom, Export, Paketanimation. */

const SVGNS = 'http://www.w3.org/2000/svg';
const HALO = 'paint-order="stroke" stroke="#ffffff" stroke-width="3.5" stroke-linejoin="round"';
const GRID = 10;
const snap = v => Math.round(v / GRID) * GRID;

const Canvas = {
  view: { x: 60, y: 40, z: 1 },
  sel: null,            // { kind: 'device' | 'link', id }
  drag: null,
  lastClick: { id: null, t: 0 },
  spaceDown: false,
  settings: { portLabels: true, showIP: true, animate: true },
  onView: null,

  init() {
    this.svg = document.getElementById('ws');
    this.vp = document.getElementById('viewport');
    this.gLinks = document.getElementById('layer-links');
    this.gNotes = document.getElementById('layer-notes');
    this.gDevs = document.getElementById('layer-devices');
    this.gOver = document.getElementById('layer-overlay');
    this.grid = document.getElementById('grid');

    const s = this.svg;
    s.addEventListener('pointerdown', e => this.onDown(e));
    s.addEventListener('pointermove', e => this.onMove(e));
    s.addEventListener('pointerup', e => this.onUp(e));
    s.addEventListener('pointercancel', () => this.cancelDrag());
    s.addEventListener('wheel', e => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.zoomAt(Math.exp(clamp(-dy, -300, 300) * 0.0015), e.clientX, e.clientY);
    }, { passive: false });
    s.addEventListener('contextmenu', e => this.onContext(e));

    // Geräte aus der Palette per Drag & Drop
    s.addEventListener('dragover', e => {
      if ([...e.dataTransfer.types].includes('application/x-netsim')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    s.addEventListener('drop', e => {
      const type = e.dataTransfer.getData('application/x-netsim');
      if (type === 'text') { e.preventDefault(); this.addNoteAt(e.clientX, e.clientY); return; }
      if (!DEVICE_TYPES[type]) return;
      e.preventDefault();
      this.addDeviceAt(type, e.clientX, e.clientY);
    });

    this.applyView();
  },

  addDeviceAt(type, clientX, clientY) {
    const t = DEVICE_TYPES[type];
    const w = this.toWorld(clientX, clientY);
    const d = Model.addDevice(type, snap(w.x - t.w / 2), snap(w.y - t.h / 2));
    this.select('device', d.id);
    App.status(`${d.name} hinzugefügt – Doppelklick zum Konfigurieren, Anschlüsse mit der Maus verbinden.`);
    return d;
  },

  /** Neues Textfeld einfügen und sofort den Formatierungs-Editor öffnen. */
  addNoteAt(clientX, clientY) {
    const w = this.toWorld(clientX, clientY);
    const n = Model.addNote(snap(w.x - 20), snap(w.y - 10));
    this.select('note', n.id);
    NoteEditor.open(n, true);
    return n;
  },

  /* ---------------- Koordinaten & Ansicht ---------------- */

  toWorld(cx, cy) {
    const r = this.svg.getBoundingClientRect();
    return { x: (cx - r.left - this.view.x) / this.view.z, y: (cy - r.top - this.view.y) / this.view.z };
  },

  portPos(dev, i) {
    const p = DEVICE_TYPES[dev.type].ports[i];
    return { x: dev.x + p.x, y: dev.y + p.y };
  },

  applyView() {
    const { x, y, z } = this.view;
    const tf = `translate(${x},${y}) scale(${z})`;
    this.vp.setAttribute('transform', tf);
    this.grid.setAttribute('patternTransform', tf);
    if (this.onView) this.onView();
    NoteEditor.reposition();
  },

  zoomAt(f, cx, cy) {
    const r = this.svg.getBoundingClientRect();
    if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    const px = cx - r.left, py = cy - r.top;
    const nz = clamp(this.view.z * f, 0.25, 3);
    const k = nz / this.view.z;
    this.view.x = px - (px - this.view.x) * k;
    this.view.y = py - (py - this.view.y) * k;
    this.view.z = nz;
    this.applyView();
  },

  resetZoom() { this.zoomAt(1 / this.view.z); },

  /** Bereich, den alle Geräte inkl. Beschriftung belegen. */
  contentBounds() {
    if (!Model.devices.length && !Model.notes.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const d of Model.devices) {
      const t = DEVICE_TYPES[d.type];
      x0 = Math.min(x0, d.x - 30);
      y0 = Math.min(y0, d.y - 30);
      x1 = Math.max(x1, d.x + t.w + (d.type === 'switch' ? 80 : 30));
      y1 = Math.max(y1, d.y + t.h + 45);
    }
    for (const n of Model.notes) {
      const lines = n.text.split('\n');
      x0 = Math.min(x0, n.x - 10);
      y0 = Math.min(y0, n.y - 10);
      x1 = Math.max(x1, n.x + Math.max(...lines.map(l => l.length)) * n.size * 0.6 + 10);
      y1 = Math.max(y1, n.y + lines.length * n.size * 1.25 + 10);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  },

  fit() {
    const b = this.contentBounds();
    const r = this.svg.getBoundingClientRect();
    if (!b || !r.width) { this.view = { x: 60, y: 40, z: 1 }; this.applyView(); return; }
    const z = clamp(Math.min(r.width / (b.w + 40), r.height / (b.h + 40)), 0.25, 1.5);
    this.view = { z, x: (r.width - b.w * z) / 2 - b.x * z, y: (r.height - b.h * z) / 2 - b.y * z };
    this.applyView();
  },

  /* ---------------- Darstellung ---------------- */

  render() {
    if (this.sel) {
      const exists = this.sel.kind === 'device' ? Model.get(this.sel.id)
        : this.sel.kind === 'note' ? Model.getNote(this.sel.id)
        : Model.links.some(l => l.id === this.sel.id);
      if (!exists) this.sel = null;
    }
    this.renderLinks();
    this.renderNotes();
    this.renderDevices();
    document.getElementById('empty-hint').hidden = Model.devices.length > 0 || Model.notes.length > 0;
    NoteEditor.reposition();
  },

  renderNotes() {
    this.gNotes.innerHTML = Model.notes.map(n =>
      `<g class="note" data-id="${n.id}" transform="translate(${n.x},${n.y})">${this.noteText(n)}</g>`).join('');
    // Unsichtbare Klickfläche bzw. Auswahlrahmen in Textgröße
    for (const g of this.gNotes.children) {
      const t = g.querySelector('text');
      const b = t.getBBox();
      const selected = this.sel && this.sel.kind === 'note' && this.sel.id === g.dataset.id;
      const r = document.createElementNS(SVGNS, 'rect');
      const pad = 5;
      const attrs = {
        class: 'no-export', x: b.x - pad, y: b.y - pad, rx: 4,
        width: Math.max(b.width, 10) + 2 * pad, height: Math.max(b.height, 10) + 2 * pad,
        fill: selected ? '#3b82f6' : 'transparent', 'fill-opacity': selected ? 0.08 : 1,
        stroke: selected ? '#3b82f6' : 'none', 'stroke-width': 1.5, 'stroke-dasharray': '5 3',
      };
      for (const k in attrs) r.setAttribute(k, attrs[k]);
      g.insertBefore(r, t);
    }
  },

  noteText(n) {
    const lh = (n.size * 1.25).toFixed(1);
    const tspans = (n.text || '').split('\n').map((l, i) =>
      `<tspan x="0"${i ? ` dy="${lh}"` : ''}>${esc(l) || ' '}</tspan>`).join('');
    return `<text x="0" y="${n.size}" font-size="${n.size}" fill="${n.color}" font-weight="${n.bold ? 700 : 400}" ` +
      `font-style="${n.italic ? 'italic' : 'normal'}" ${HALO}>${tspans}</text>`;
  },

  renderDevices() {
    this.gDevs.innerHTML = Model.devices.map(d =>
      `<g class="device" data-id="${d.id}" transform="translate(${d.x},${d.y})">${this.deviceInner(d)}</g>`).join('');
  },

  deviceInner(d) {
    const t = DEVICE_TYPES[d.type];
    const selected = this.sel && this.sel.kind === 'device' && this.sel.id === d.id;
    let s = '';
    if (selected) {
      s += `<rect class="no-export" x="-9" y="-9" width="${t.w + 18}" height="${t.h + 18}" rx="8" fill="#3b82f6" fill-opacity="0.08" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="5 3"/>`;
    }
    s += `<g class="dev-body">${Icons[d.type]()}</g>`;
    if (d.type === 'switch') {
      s += t.ports.map((p, i) =>
        `<text x="${p.x}" y="${p.y - 10}" font-size="9" fill="#dbe8f6" text-anchor="middle">${i + 1}</text>`).join('');
    }
    s += t.ports.map((p, i) => this.portMarkup(d, i, p)).join('');
    s += this.labelMarkup(d, t);
    return s;
  },

  portMarkup(d, i, p) {
    const peer = Sim.peer(d, i);
    const up = Sim.portUp(d, i);
    const fill = !up ? '#ef4444' : peer ? '#22c55e' : '#f4f6f8';
    let title = `${longPortName(d.ports[i].name)} – ` +
      (peer ? `verbunden mit ${peer.dev.name} (${peer.dev.ports[peer.port].name})` : 'frei, zum Verbinden ziehen');
    if (!up) title += ' – deaktiviert';
    return `<g class="port${peer ? ' used' : ''}" data-port="${i}" transform="translate(${p.x},${p.y})">` +
      `<circle class="no-export" r="9" fill="transparent"/>` +
      `<rect x="-5" y="-5" width="10" height="10" rx="2" fill="${fill}" stroke="#37474f" stroke-width="1.2"/>` +
      `<title>${esc(title)}</title></g>`;
  },

  labelMarkup(d, t) {
    let x = t.w / 2, y = t.h + 18, anchor = 'middle';
    if (d.type === 'switch') { x = t.w + 10; y = t.h / 2 + 4; anchor = 'start'; }
    else if (d.type === 'router') { y = -9; }
    let s = `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="12" font-weight="600" fill="#1f2933" ${HALO}>${esc(d.name)}</text>`;
    if (this.settings.showIP && Sim.isHost(d)) {
      const f = Sim.hostIface(d);
      let txt = f ? `${IP.str(f.ip)}/${IP.prefixLen(f.mask)}` : (d.ip.mode === 'dhcp' ? 'DHCP – keine Adresse' : 'keine IP');
      if (f && d.ip.mode === 'dhcp') txt += ' (DHCP)';
      s += `<text x="${x}" y="${y + 14}" text-anchor="${anchor}" font-size="10.5" fill="${f ? '#475569' : '#b45309'}" ${HALO}>${esc(txt)}</text>`;
    }
    return s;
  },

  /** Weg entlang u, bis ein Strahl ab p das Gerät verlässt (damit Beschriftungen nicht verdeckt werden). */
  exitDist(dev, p, ux, uy) {
    const t = DEVICE_TYPES[dev.type];
    const x0 = dev.x - 3, y0 = dev.y - 3, x1 = dev.x + t.w + 3, y1 = dev.y + t.h + 3;
    let d = Infinity;
    if (ux > 1e-9) d = Math.min(d, (x1 - p.x) / ux); else if (ux < -1e-9) d = Math.min(d, (x0 - p.x) / ux);
    if (uy > 1e-9) d = Math.min(d, (y1 - p.y) / uy); else if (uy < -1e-9) d = Math.min(d, (y0 - p.y) / uy);
    return d === Infinity ? 0 : Math.max(0, d);
  },

  renderLinks() {
    const out = [];
    for (const l of Model.links) {
      const da = Model.get(l.a.dev), db = Model.get(l.b.dev);
      if (!da || !db) continue;
      const pa = this.portPos(da, l.a.port), pb = this.portPos(db, l.b.port);
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      const selected = this.sel && this.sel.kind === 'link' && this.sel.id === l.id;
      const ok = Sim.portUp(da, l.a.port) && Sim.portUp(db, l.b.port);
      const xy = `x1="${pa.x}" y1="${pa.y}" x2="${pb.x}" y2="${pb.y}"`;
      let s = `<g class="link" data-id="${l.id}">`;
      s += `<line class="no-export" ${xy} stroke="transparent" stroke-width="14"/>`;
      if (selected) s += `<line class="no-export" ${xy} stroke="#f59e0b" stroke-width="7" stroke-opacity="0.5" stroke-linecap="round"/>`;
      s += `<line class="link-line" ${xy} stroke="#263238" stroke-width="2"/>`;

      const ends = [
        { dev: da, port: l.a.port, p: pa, ux, uy },
        { dev: db, port: l.b.port, p: pb, ux: -ux, uy: -uy },
      ];
      for (const e of ends) e.ex = this.exitDist(e.dev, e.p, e.ux, e.uy);
      const free = len - ends[0].ex - ends[1].ex;
      for (const e of ends) {
        if (free > 26) {
          const k = e.ex + 8;
          s += `<circle cx="${(e.p.x + e.ux * k).toFixed(1)}" cy="${(e.p.y + e.uy * k).toFixed(1)}" r="3.6" fill="${ok ? '#22c55e' : '#ef4444'}" stroke="#ffffff" stroke-width="1"/>`;
        }
        if (this.settings.portLabels && free > 90) {
          const k = e.ex + 30;
          const lx = (e.p.x + e.ux * k).toFixed(1), ly = (e.p.y + e.uy * k).toFixed(1);
          let txt = `<tspan x="${lx}" dy="0">${esc(e.dev.ports[e.port].name)}</tspan>`;
          if (this.settings.showIP && e.dev.type === 'router') {
            const pr = e.dev.ports[e.port];
            const ip = IP.parse(pr.ip || ''), mk = IP.parseMask(pr.mask || '');
            if (ip !== null) txt += `<tspan x="${lx}" dy="12">${IP.str(ip)}${mk !== null ? '/' + IP.prefixLen(mk) : ''}</tspan>`;
          }
          s += `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="10" fill="#334155" ${HALO}>${txt}</text>`;
        }
      }
      s += '</g>';
      out.push(s);
    }
    this.gLinks.innerHTML = out.join('');
  },

  select(kind, id) {
    this.sel = kind ? { kind, id } : null;
    this.render();
  },

  deleteSelection() {
    const s = this.sel;
    if (!s) return;
    this.sel = null;
    if (s.kind === 'device') {
      const d = Model.get(s.id);
      if (d) { Win.close(d.id); Model.removeDevice(d.id); App.status(`${d.name} gelöscht.`); }
    } else if (s.kind === 'note') {
      NoteEditor.close(false);
      Model.removeNote(s.id);
      App.status('Text gelöscht.');
    } else {
      Model.removeLink(s.id);
      App.status('Verbindung gelöscht.');
    }
  },

  /* ---------------- Maus ---------------- */

  hit(target) {
    const devEl = target.closest('.device');
    const portEl = target.closest('.port');
    const linkEl = target.closest('.link');
    const noteEl = target.closest('.note');
    return {
      dev: devEl ? Model.get(devEl.dataset.id) : null,
      port: portEl ? Number(portEl.dataset.port) : null,
      link: linkEl ? Model.links.find(l => l.id === linkEl.dataset.id) : null,
      note: noteEl ? Model.getNote(noteEl.dataset.id) : null,
    };
  },

  portAt(cx, cy) {
    const el = document.elementFromPoint(cx, cy);
    const p = el && el.closest && el.closest('.port');
    const dv = p && p.closest('.device');
    return p && dv ? { dev: Model.get(dv.dataset.id), port: Number(p.dataset.port), el: p } : null;
  },

  onDown(e) {
    App.hideMenu();
    if (e.button === 1 || (e.button === 0 && this.spaceDown)) { e.preventDefault(); this.startPan(e); return; }
    if (e.button !== 0) return;
    const h = this.hit(e.target);

    if (h.dev && h.port !== null) {
      const l = Model.linkAt(h.dev.id, h.port);
      if (l) {
        this.select('link', l.id);
        App.status(`${h.dev.name} ${h.dev.ports[h.port].name} ist bereits verbunden. Kabel ausgewählt – mit Entf löschen.`);
        return;
      }
      const start = this.portPos(h.dev, h.port);
      const line = document.createElementNS(SVGNS, 'line');
      line.setAttribute('x1', start.x); line.setAttribute('y1', start.y);
      line.setAttribute('x2', start.x); line.setAttribute('y2', start.y);
      line.setAttribute('stroke', '#1f6feb'); line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-dasharray', '6 4');
      this.gOver.appendChild(line);
      this.drag = { mode: 'link', dev: h.dev, port: h.port, line, target: null };
      this.svg.classList.add('linking');
      this.svg.setPointerCapture(e.pointerId);
      App.status(`Kabel von ${h.dev.name} ${h.dev.ports[h.port].name} – auf einen freien Anschluss ziehen.`);
      return;
    }

    // Gerät oder Textfeld: Klick wählt aus und verschiebt, Doppelklick öffnet Fenster bzw. Texteditor
    const obj = h.dev || h.note;
    if (obj) {
      const kind = h.dev ? 'device' : 'note';
      const now = performance.now();
      if (this.lastClick.id === obj.id && now - this.lastClick.t < 400) {
        this.lastClick = { id: null, t: 0 };
        if (kind === 'device') Win.open(obj); else NoteEditor.open(obj);
        return;
      }
      this.lastClick = { id: obj.id, t: now };
      if (NoteEditor.note && NoteEditor.note !== obj) NoteEditor.close();
      if (!(this.sel && this.sel.kind === kind && this.sel.id === obj.id)) this.select(kind, obj.id);
      const w = this.toWorld(e.clientX, e.clientY);
      this.drag = {
        mode: 'move', obj, kind, ox: w.x - obj.x, oy: w.y - obj.y, moved: false,
        el: (kind === 'device' ? this.gDevs : this.gNotes).querySelector(`[data-id="${obj.id}"]`),
      };
      this.svg.setPointerCapture(e.pointerId);
      return;
    }

    NoteEditor.close();

    if (h.link) { this.select('link', h.link.id); return; }

    if (this.sel) this.select(null);
    this.startPan(e);
  },

  startPan(e) {
    this.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y };
    this.svg.classList.add('panning');
    this.svg.setPointerCapture(e.pointerId);
  },

  onMove(e) {
    const d = this.drag;
    if (!d) return;
    if (d.mode === 'pan') {
      this.view.x = d.vx + e.clientX - d.sx;
      this.view.y = d.vy + e.clientY - d.sy;
      this.applyView();
    } else if (d.mode === 'move') {
      const w = this.toWorld(e.clientX, e.clientY);
      const nx = snap(w.x - d.ox), ny = snap(w.y - d.oy);
      if (nx !== d.obj.x || ny !== d.obj.y) {
        d.obj.x = nx; d.obj.y = ny; d.moved = true;
        if (d.el) d.el.setAttribute('transform', `translate(${nx},${ny})`);
        if (d.kind === 'device') this.renderLinks();
        else NoteEditor.reposition();
      }
    } else if (d.mode === 'link') {
      const w = this.toWorld(e.clientX, e.clientY);
      d.line.setAttribute('x2', w.x);
      d.line.setAttribute('y2', w.y);
      const t = this.portAt(e.clientX, e.clientY);
      if (d.target && (!t || t.el !== d.target)) { d.target.classList.remove('drop-ok', 'drop-bad'); d.target = null; }
      if (t && !(t.dev.id === d.dev.id && t.port === d.port)) {
        const bad = t.dev.id === d.dev.id || !!Model.linkAt(t.dev.id, t.port);
        t.el.classList.add(bad ? 'drop-bad' : 'drop-ok');
        d.target = t.el;
      }
    }
  },

  onUp(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    try { this.svg.releasePointerCapture(e.pointerId); } catch (_) { /* bereits freigegeben */ }
    this.svg.classList.remove('panning', 'linking');
    if (d.mode === 'move' && d.moved) {
      Model.changed('move');
    } else if (d.mode === 'link') {
      d.line.remove();
      const t = this.portAt(e.clientX, e.clientY);
      if (!t) { App.status('Verbinden abgebrochen.'); return; }
      if (t.dev.id === d.dev.id && t.port === d.port) { App.status('Bereit.'); return; }
      const r = Model.addLink(d.dev.id, d.port, t.dev.id, t.port);
      if (r.error) App.toast(r.error, 'error');
      else App.status(`Verbunden: ${d.dev.name} ${d.dev.ports[d.port].name} ↔ ${t.dev.name} ${t.dev.ports[t.port].name}`);
    }
  },

  cancelDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.svg.classList.remove('panning', 'linking');
    if (d.mode === 'link') d.line.remove();
    if (d.mode === 'move' && d.moved) Model.changed('move');
  },

  onContext(e) {
    e.preventDefault();
    const h = this.hit(e.target);
    if (h.dev) {
      const d = h.dev;
      this.select('device', d.id);
      const items = [{ label: 'Konfigurieren …', action: () => Win.open(d) }];
      if (d.type !== 'switch') {
        items.push({ label: d.type === 'router' ? 'CLI öffnen …' : 'Terminal öffnen …', action: () => Win.open(d, 'terminal') });
      }
      items.push('-', { label: 'Alle Kabel dieses Geräts lösen', action: () => {
        Model.links = Model.links.filter(l => l.a.dev !== d.id && l.b.dev !== d.id);
        Model.changed('unlink');
      } });
      items.push({ label: 'Löschen', danger: true, action: () => { this.select('device', d.id); this.deleteSelection(); } });
      App.showMenu(e.clientX, e.clientY, items);
    } else if (h.note) {
      const n = h.note;
      this.select('note', n.id);
      App.showMenu(e.clientX, e.clientY, [
        { label: 'Text bearbeiten / formatieren …', action: () => NoteEditor.open(n) },
        '-',
        { label: 'Löschen', danger: true, action: () => { this.select('note', n.id); this.deleteSelection(); } },
      ]);
    } else if (h.link) {
      this.select('link', h.link.id);
      App.showMenu(e.clientX, e.clientY, [
        { label: 'Verbindung löschen', danger: true, action: () => { this.select('link', h.link.id); this.deleteSelection(); } },
      ]);
    } else {
      App.showMenu(e.clientX, e.clientY, [
        ...Object.keys(DEVICE_TYPES).map(type => ({
          label: `${DEVICE_TYPES[type].label} hier einfügen`,
          action: () => this.addDeviceAt(type, e.clientX, e.clientY),
        })),
        '-',
        { label: 'Text hier einfügen', action: () => this.addNoteAt(e.clientX, e.clientY) },
      ]);
    }
  },

  /* ---------------- Paketanimation ---------------- */

  animatePacket(hops, color) {
    return new Promise(resolve => {
      const segs = [];
      for (const h of hops || []) {
        const l = Model.links.find(x => x.id === h.link);
        if (!l) continue;
        const from = l.a.dev === h.from ? l.a : l.b;
        const to = from === l.a ? l.b : l.a;
        segs.push({ from, to });
      }
      if (!segs.length) { resolve(); return; }
      const g = document.createElementNS(SVGNS, 'g');
      g.innerHTML = `<rect x="-10" y="-7" width="20" height="14" rx="2" fill="${color}" stroke="#1f2933" stroke-width="1.2"/>` +
        `<path d="M-10 -7L0 1L10 -7" fill="none" stroke="#1f2933" stroke-width="1.2"/>`;
      this.gOver.appendChild(g);
      const per = 320;
      let i = 0, t0 = null;
      const step = ts => {
        if (t0 === null) t0 = ts;
        let k = (ts - t0) / per;
        if (k >= 1) {
          i++; t0 = ts; k = 0;
          if (i >= segs.length) { g.remove(); resolve(); return; }
        }
        const s = segs[i];
        const da = Model.get(s.from.dev), db = Model.get(s.to.dev);
        if (!da || !db) { g.remove(); resolve(); return; }
        const a = this.portPos(da, s.from.port), b = this.portPos(db, s.to.port);
        g.setAttribute('transform', `translate(${a.x + (b.x - a.x) * k},${a.y + (b.y - a.y) * k})`);
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  },

  /** Kurzes Symbol (✓ / ✕) über einem Gerät. */
  flashMark(dev, ok) {
    if (!dev || !Model.get(dev.id)) return;
    const t = DEVICE_TYPES[dev.type];
    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('transform', `translate(${dev.x + t.w / 2},${dev.y + t.h / 2})`);
    g.innerHTML = `<circle r="13" fill="${ok ? '#16a34a' : '#dc2626'}" stroke="#fff" stroke-width="2"/>` +
      (ok ? '<path d="M-6 0l4 4 8-8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
          : '<path d="M-5 -5l10 10M5 -5l-10 10" stroke="#fff" stroke-width="3" stroke-linecap="round"/>');
    this.gOver.appendChild(g);
    setTimeout(() => g.remove(), 900);
  },

  /* ---------------- Export ---------------- */

  exportSVG() {
    this.svg.classList.add('exporting');
    let box = null;
    try {
      for (const g of [this.gLinks, this.gDevs, this.gNotes]) {
        if (!g.childNodes.length) continue;
        const b = g.getBBox();
        if (!b.width && !b.height) continue;
        box = box
          ? { x0: Math.min(box.x0, b.x), y0: Math.min(box.y0, b.y), x1: Math.max(box.x1, b.x + b.width), y1: Math.max(box.y1, b.y + b.height) }
          : { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height };
      }
    } finally {
      this.svg.classList.remove('exporting');
    }
    if (!box) return null;
    const pad = 24;
    const x = Math.floor(box.x0 - pad), y = Math.floor(box.y0 - pad);
    const w = Math.ceil(box.x1 - box.x0 + 2 * pad), h = Math.ceil(box.y1 - box.y0 + 2 * pad);
    const ser = new XMLSerializer();
    const part = g => {
      const c = g.cloneNode(true);
      c.removeAttribute('id');
      c.querySelectorAll('.no-export, title').forEach(n => n.remove());
      return ser.serializeToString(c);
    };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" ` +
      `font-family="Segoe UI, Arial, Helvetica, sans-serif"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>` +
      `${part(this.gLinks)}${part(this.gDevs)}${part(this.gNotes)}</svg>`;
    return { svg, w, h };
  },

  async renderPNG(scale = 2) {
    const ex = this.exportSVG();
    if (!ex) throw new Error('Das Netzwerk ist leer.');
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(ex.svg);
    await img.decode();
    const c = document.createElement('canvas');
    c.width = Math.round(ex.w * scale);
    c.height = Math.round(ex.h * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('PNG konnte nicht erzeugt werden.'))), 'image/png'));
  },
};
