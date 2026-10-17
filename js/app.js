'use strict';

/* Anwendung: Werkzeugleiste, Palette, Dateien, Export, Rückgängig, Tastatur. */

const PALETTE = [
  { group: 'Endgeräte', items: ['pc', 'server'] },
  { group: 'Netzwerkgeräte', items: ['switch', 'router'] },
  { group: 'Werkzeuge', items: ['text'] },
];

const TEXT_TOOL_SVG = `<svg viewBox="0 0 64 40" width="64" height="40" aria-hidden="true">
  <rect x="1" y="1" width="62" height="38" rx="5" fill="#ffffff" stroke="#94a3b8" stroke-dasharray="4 3"/>
  <text x="32" y="28" text-anchor="middle" font-size="22" font-family="Georgia, 'Times New Roman', serif" fill="#1f2933"><tspan font-weight="700">A</tspan><tspan font-style="italic" fill="#2563eb">a</tspan></text>
</svg>`;

const App = {
  fileName: 'Unbenannt',
  fileHandle: null,
  undoStack: [],
  redoStack: [],
  snap: '',
  addCount: 0,

  init() {
    Canvas.init();
    NoteEditor.init();
    Canvas.onView = () => this.updateInfo();
    this.buildPalette();
    document.querySelectorAll('[data-icon]').forEach(b => b.insertAdjacentHTML('afterbegin', Icons.ui(b.dataset.icon)));
    this.bindCommands();
    this.bindKeys();
    Model.onChange(kind => this.onModelChange(kind));

    let restored = false;
    try {
      const s = localStorage.getItem('netsim.autosave');
      if (s) {
        const data = JSON.parse(s);
        if (data && Array.isArray(data.devices) && (data.devices.length || (data.notes && data.notes.length))) {
          Model.load(data, 'init');
          this.setFileName(localStorage.getItem('netsim.filename') || 'Unbenannt');
          restored = true;
        }
      }
    } catch (e) { console.warn('Autosave nicht lesbar:', e); }
    if (!restored) Model.changed('init');
    if (restored) {
      requestAnimationFrame(() => Canvas.fit());
      this.toast('Letzte Sitzung wiederhergestellt.');
    }
  },

  onModelChange(kind) {
    Canvas.render();
    Win.sync();
    const s = JSON.stringify(Model.serialize());
    if (kind !== 'undo' && kind !== 'init' && s !== this.snap) {
      this.undoStack.push(this.snap);
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack = [];
    }
    this.snap = s;
    const loops = [...Sim.stpData().loops].join(', ');
    if (loops !== (this.loopKey || '')) {
      if (loops) {
        this.toast(`Schleife ohne Spanning Tree in VLAN ${loops} – Broadcast-Sturm!`, 'warn');
        this.status(`⚠ Schleife ohne Spanning Tree in VLAN ${loops}: Frames kreisen endlos, die Kommunikation bricht zusammen.`);
      } else if (this.loopKey) {
        this.status('Schleife aufgelöst – Spanning Tree blockiert redundante Wege.');
      }
      this.loopKey = loops;
    }
    try {
      localStorage.setItem('netsim.autosave', s);
      localStorage.setItem('netsim.filename', this.fileName);
    } catch (_) { /* Speicher nicht verfügbar */ }
    this.updateInfo();
  },

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snap);
    Model.load(JSON.parse(this.undoStack.pop()), 'undo');
    this.status('Rückgängig gemacht.');
  },

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snap);
    Model.load(JSON.parse(this.redoStack.pop()), 'undo');
    this.status('Wiederhergestellt.');
  },

  updateInfo() {
    const n = Model.devices.length, m = Model.links.length;
    document.getElementById('status-info').textContent =
      `${n} ${n === 1 ? 'Gerät' : 'Geräte'} · ${m} ${m === 1 ? 'Verbindung' : 'Verbindungen'}`;
    document.getElementById('zoom-label').textContent = Math.round(Canvas.view.z * 100) + ' %';
    const q = c => document.querySelector(`[data-cmd="${c}"]`);
    q('undo').disabled = !this.undoStack.length;
    q('redo').disabled = !this.redoStack.length;
  },

  /* ---------------- Palette ---------------- */

  buildPalette() {
    const pal = document.getElementById('palette');
    let html = '';
    for (const g of PALETTE) {
      html += `<div class="pal-group">${esc(g.group)}</div>`;
      for (const type of g.items) {
        if (type === 'text') {
          html += `<div class="pal-item pal-tool" draggable="true" data-type="text" title="Text – auf die Arbeitsfläche ziehen oder anklicken, danach formatieren">` +
            `${TEXT_TOOL_SVG}<span>Text</span><small>Beschriftung</small></div>`;
          continue;
        }
        const t = DEVICE_TYPES[type];
        const [main, sub] = t.label.split(' (');
        html += `<div class="pal-item" draggable="true" data-type="${type}" title="${esc(t.label)} – auf die Arbeitsfläche ziehen oder anklicken">` +
          `${Icons.deviceSvg(type)}<span>${esc(main)}</span>${sub ? `<small>${esc(sub.replace(')', ''))}</small>` : ''}</div>`;
      }
    }
    html += '<div class="pal-hint">Geräte auf die Arbeitsfläche ziehen. Weitere Gerätetypen folgen.</div>';
    pal.innerHTML = html;
    pal.querySelectorAll('.pal-item').forEach(item => {
      item.addEventListener('dragstart', e => {
        e.dataTransfer.setData('application/x-netsim', item.dataset.type);
        e.dataTransfer.setData('text/plain', item.dataset.type);
        e.dataTransfer.effectAllowed = 'copy';
        const svg = item.querySelector('svg');
        if (svg) e.dataTransfer.setDragImage(svg, svg.clientWidth / 2, svg.clientHeight / 2);
      });
      item.addEventListener('click', () => {
        const r = Canvas.svg.getBoundingClientRect();
        const off = (this.addCount++ % 6) * 30;
        if (item.dataset.type === 'text') {
          Canvas.addNoteAt(r.left + r.width / 2 + off - 75, r.top + r.height / 2 + off - 75);
          return;
        }
        Canvas.addDeviceAt(item.dataset.type, r.left + r.width / 2 + off - 75, r.top + r.height / 2 + off - 75);
      });
    });
  },

  /* ---------------- Befehle ---------------- */

  bindCommands() {
    const cmds = {
      'new': () => this.newFile(),
      'open': () => this.open(),
      'save': e => this.save(e && e.shiftKey),
      'undo': () => this.undo(),
      'redo': () => this.redo(),
      'delete': () => Canvas.deleteSelection(),
      'copy-image': () => this.copyImage(),
      'export-png': () => this.exportPNG(),
      'export-svg': () => this.exportSVG(),
      'demo': () => this.loadDemo(),
      'help': () => { document.getElementById('help').hidden = false; },
      'help-close': () => { document.getElementById('help').hidden = true; },
      'zoom-in': () => Canvas.zoomAt(1.2),
      'zoom-out': () => Canvas.zoomAt(1 / 1.2),
      'zoom-reset': () => Canvas.resetZoom(),
      'fit': () => Canvas.fit(),
    };
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-cmd]');
      if (b && cmds[b.dataset.cmd] && !b.disabled) cmds[b.dataset.cmd](e);
    });
    document.getElementById('help').addEventListener('click', e => {
      if (e.target.id === 'help') e.currentTarget.hidden = true;
    });

    const opt = (id, key) => {
      const cb = document.getElementById(id);
      try { const v = localStorage.getItem('netsim.opt.' + key); if (v !== null) cb.checked = v === '1'; } catch (_) { /* */ }
      Canvas.settings[key] = cb.checked;
      cb.addEventListener('change', () => {
        Canvas.settings[key] = cb.checked;
        try { localStorage.setItem('netsim.opt.' + key, cb.checked ? '1' : '0'); } catch (_) { /* */ }
        Canvas.render();
      });
    };
    opt('opt-ports', 'portLabels');
    opt('opt-ip', 'showIP');
    opt('opt-anim', 'animate');

    document.getElementById('file-input').addEventListener('change', async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) this.loadText(await f.text(), f.name, null);
    });

    document.addEventListener('pointerdown', e => {
      if (!e.target.closest('#ctxmenu')) this.hideMenu();
    });
    window.addEventListener('blur', () => this.hideMenu());
  },

  bindKeys() {
    document.addEventListener('keydown', e => {
      const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 's') { e.preventDefault(); this.save(e.shiftKey); return; }
      if (mod && k === 'o') { e.preventDefault(); this.open(); return; }
      if (e.key === 'F1') { e.preventDefault(); document.getElementById('help').hidden = false; return; }
      if (e.key === 'Escape') {
        NoteEditor.close();
        this.hideMenu();
        Canvas.cancelDrag();
        document.getElementById('help').hidden = true;
        return;
      }
      if (typing) return;
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); this.redo(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); Canvas.deleteSelection(); return; }
      if (e.key === '+' || e.key === '=') { Canvas.zoomAt(1.2); return; }
      if (e.key === '-') { Canvas.zoomAt(1 / 1.2); return; }
      if (e.key === ' ') { e.preventDefault(); Canvas.spaceDown = true; Canvas.svg.classList.add('space'); }
    });
    document.addEventListener('keyup', e => {
      if (e.key === ' ') { Canvas.spaceDown = false; Canvas.svg.classList.remove('space'); }
    });
  },

  /* ---------------- Dateien ---------------- */

  setFileName(n) {
    this.fileName = n || 'Unbenannt';
    document.getElementById('file-name').textContent = this.fileName;
    document.title = `${this.fileName} – NetSim`;
  },

  baseName() {
    return (this.fileName === 'Unbenannt' ? 'netzwerk' : this.fileName).replace(/\.(netsim|json)$/i, '');
  },

  newFile() {
    if (Model.devices.length && !confirm('Das aktuelle Netzwerk verwerfen und ein neues beginnen?\n(Rückgängig ist mit Strg+Z möglich.)')) return;
    for (const id of [...Win.wins.keys()]) Win.close(id);
    Win.terms.clear();
    Model.load({ format: 'netsim', devices: [], links: [] }, 'load');
    this.fileHandle = null;
    this.setFileName('Unbenannt');
    Canvas.view = { x: 60, y: 40, z: 1 };
    Canvas.applyView();
    this.status('Neues Netzwerk.');
  },

  async save(saveAs = false) {
    const text = JSON.stringify(Model.serialize(), null, 2);
    if (window.showSaveFilePicker) {
      try {
        if (!this.fileHandle || saveAs) {
          this.fileHandle = await window.showSaveFilePicker({
            suggestedName: this.baseName() + '.netsim',
            types: [{ description: 'NetSim-Netzwerk', accept: { 'application/json': ['.netsim'] } }],
          });
        }
        const w = await this.fileHandle.createWritable();
        await w.write(text);
        await w.close();
        this.setFileName(this.fileHandle.name);
        this.toast(`Gespeichert: ${this.fileHandle.name}`);
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
        console.warn('Dateisystem-API nicht nutzbar, verwende Download:', e);
        this.fileHandle = null;
      }
    }
    const name = this.baseName() + '.netsim';
    this.download(new Blob([text], { type: 'application/json' }), name);
    this.setFileName(name);
    this.toast(`Als Download gespeichert: ${name}`);
  },

  async open() {
    if (window.showOpenFilePicker) {
      try {
        const [h] = await window.showOpenFilePicker({
          types: [{ description: 'NetSim-Netzwerk', accept: { 'application/json': ['.netsim', '.json'] } }],
        });
        const f = await h.getFile();
        this.loadText(await f.text(), f.name, h);
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
        console.warn('Dateisystem-API nicht nutzbar, verwende Dateiauswahl:', e);
      }
    }
    document.getElementById('file-input').click();
  },

  loadText(text, name, handle) {
    try {
      const data = JSON.parse(text);
      for (const id of [...Win.wins.keys()]) Win.close(id);
      Win.terms.clear();
      Model.load(data, 'load');
      this.fileHandle = handle || null;
      this.setFileName(name);
      Canvas.select(null);
      Canvas.fit();
      this.toast(`Geöffnet: ${name}`);
    } catch (e) {
      this.toast('Datei konnte nicht geöffnet werden: ' + e.message, 'error');
    }
  },

  download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },

  /* ---------------- Export ---------------- */

  async copyImage() {
    if (!Model.devices.length && !Model.notes.length) { this.toast('Das Netzwerk ist leer.', 'warn'); return; }
    try {
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error('Zwischenablage wird von diesem Browser nicht unterstützt');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': Canvas.renderPNG(2) })]);
      this.toast('Netzwerkgrafik in die Zwischenablage kopiert – z. B. in Word/PowerPoint mit Strg+V einfügen.');
    } catch (e) {
      console.warn(e);
      try {
        this.download(await Canvas.renderPNG(2), this.baseName() + '.png');
        this.toast(`Kopieren nicht möglich (${e.message}). Die Grafik wurde stattdessen als PNG gespeichert.`, 'warn');
      } catch (e2) {
        this.toast('Grafik konnte nicht erzeugt werden: ' + e2.message, 'error');
      }
    }
  },

  async exportPNG() {
    if (!Model.devices.length && !Model.notes.length) { this.toast('Das Netzwerk ist leer.', 'warn'); return; }
    try {
      this.download(await Canvas.renderPNG(2), this.baseName() + '.png');
    } catch (e) {
      this.toast('PNG konnte nicht erzeugt werden: ' + e.message, 'error');
    }
  },

  exportSVG() {
    const ex = Canvas.exportSVG();
    if (!ex) { this.toast('Das Netzwerk ist leer.', 'warn'); return; }
    this.download(new Blob([ex.svg], { type: 'image/svg+xml' }), this.baseName() + '.svg');
  },

  /* ---------------- Beispielnetz ---------------- */

  loadDemo() {
    if (Model.devices.length && !confirm('Das aktuelle Netzwerk durch das Beispielnetzwerk ersetzen?\n(Rückgängig ist mit Strg+Z möglich.)')) return;
    const mk = (id, type, name, x, y) => Object.assign({ id, type, name, x, y }, Model.defaults(type));

    const r0 = mk('d1', 'router', 'Router0', 380, 40);
    r0.ports[1].ip = '192.168.2.1'; r0.ports[1].mask = '255.255.255.0';
    r0.ports[2].ip = '192.168.1.1'; r0.ports[2].mask = '255.255.255.0';
    r0.routes.push({ network: '10.0.0.0', mask: '255.255.255.0', nextHop: '192.168.2.2' });

    const r1 = mk('d2', 'router', 'Router1', 700, 40);
    r1.ports[0].ip = '192.168.2.2'; r1.ports[0].mask = '255.255.255.0';
    r1.ports[2].ip = '10.0.0.1'; r1.ports[2].mask = '255.255.255.0';
    r1.routes.push({ network: '192.168.1.0', mask: '255.255.255.0', nextHop: '192.168.2.1' });

    const s0 = mk('d3', 'switch', 'Switch0', 230, 180);
    const s1 = mk('d4', 'switch', 'Switch1', 640, 180);

    const pc0 = mk('d5', 'pc', 'PC0', 240, 310);
    Object.assign(pc0.ip, { ip: '192.168.1.10', mask: '255.255.255.0', gateway: '192.168.1.1' });
    const pc1 = mk('d6', 'pc', 'PC1', 340, 310);
    pc1.ip.mode = 'dhcp';
    const srv = mk('d7', 'server', 'Server0', 450, 300);
    Object.assign(srv.ip, { ip: '192.168.1.2', mask: '255.255.255.0', gateway: '192.168.1.1' });
    Object.assign(srv.dhcp, { enabled: true, gateway: '192.168.1.1', start: '192.168.1.100', mask: '255.255.255.0', max: 50 });

    const pc2 = mk('d8', 'pc', 'PC2', 680, 310);
    Object.assign(pc2.ip, { ip: '10.0.0.10', mask: '255.255.255.0', gateway: '10.0.0.1' });
    const pc3 = mk('d9', 'pc', 'PC3', 790, 310);
    Object.assign(pc3.ip, { ip: '10.0.0.11', mask: '255.255.255.0', gateway: '10.0.0.1' });

    const L = (id, a, ap, b, bp) => ({ id, a: { dev: a, port: ap }, b: { dev: b, port: bp } });
    const data = {
      format: 'netsim', version: 1,
      devices: [r0, r1, s0, s1, pc0, pc1, srv, pc2, pc3],
      links: [
        L('l10', 'd1', 1, 'd2', 0),   // Router0 Gi0/1 – Router1 Gi0/0
        L('l11', 'd1', 2, 'd3', 7),   // Router0 Gi0/2 – Switch0 Fa0/8
        L('l12', 'd2', 2, 'd4', 7),   // Router1 Gi0/2 – Switch1 Fa0/8
        L('l13', 'd5', 0, 'd3', 0),   // PC0 – Switch0 Fa0/1
        L('l14', 'd6', 0, 'd3', 1),   // PC1 – Switch0 Fa0/2
        L('l15', 'd7', 0, 'd3', 2),   // Server0 – Switch0 Fa0/3
        L('l16', 'd8', 0, 'd4', 0),   // PC2 – Switch1 Fa0/1
        L('l17', 'd9', 0, 'd4', 1),   // PC3 – Switch1 Fa0/2
      ],
    };
    for (const id of [...Win.wins.keys()]) Win.close(id);
    Win.terms.clear();
    Model.load(data, 'load');
    this.fileHandle = null;
    this.setFileName('Beispiel');
    Canvas.select(null);
    Canvas.fit();
    this.toast('Beispiel geladen: Doppelklick auf PC0 → Terminal → „ping 10.0.0.10“');
  },

  /* ---------------- Meldungen & Menü ---------------- */

  status(msg) { document.getElementById('status-text').textContent = msg; },

  toast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, type === 'info' ? 3200 : 5500);
  },

  showMenu(x, y, items) {
    const m = document.getElementById('ctxmenu');
    m.innerHTML = '';
    for (const it of items) {
      if (it === '-') { m.appendChild(document.createElement('hr')); continue; }
      const b = document.createElement('button');
      b.textContent = it.label;
      if (it.danger) b.className = 'danger';
      b.addEventListener('click', () => { this.hideMenu(); it.action(); });
      m.appendChild(b);
    }
    m.hidden = false;
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, window.innerWidth - r.width - 6) + 'px';
    m.style.top = Math.min(y, window.innerHeight - r.height - 6) + 'px';
  },

  hideMenu() { document.getElementById('ctxmenu').hidden = true; },
};

document.addEventListener('DOMContentLoaded', () => App.init());
