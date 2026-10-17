'use strict';

/* Verschiebbare Gerätefenster mit Reitern (Konfiguration, Terminal, VLANs, Routing …). */

const Win = {
  wins: new Map(),
  terms: new Map(),   // Terminals bleiben erhalten, auch wenn das Fenster geschlossen wird
  z: 100,
  count: 0,

  open(dev, tab) {
    let w = this.wins.get(dev.id);
    if (!w) {
      w = this.create(dev);
      this.wins.set(dev.id, w);
    }
    this.focus(w);
    if (tab) this.showTab(w, tab);
    return w;
  },

  create(dev) {
    const el = document.createElement('div');
    el.className = 'win';
    el.innerHTML = `<div class="win-title"><span class="win-ico"></span><span class="win-name"></span>` +
      `<span class="win-kind"></span><button class="win-close" title="Schließen">✕</button></div>` +
      `<div class="win-tabs"></div><div class="win-body"></div>`;
    const n = this.count++ % 8;
    el.style.left = Math.max(10, Math.min(window.innerWidth - 580, 180 + n * 30)) + 'px';
    el.style.top = Math.max(10, Math.min(window.innerHeight - 540, 70 + n * 30)) + 'px';
    document.getElementById('windows').appendChild(el);

    const w = { id: dev.id, dev, el, panes: {}, tab: null };
    el.addEventListener('pointerdown', () => this.focus(w));
    el.querySelector('.win-close').addEventListener('click', () => this.close(w.id));
    this.makeDraggable(el, el.querySelector('.win-title'));
    this.build(w);
    return w;
  },

  build(w) {
    const dev = w.dev;
    const tabs = w.el.querySelector('.win-tabs');
    const body = w.el.querySelector('.win-body');
    tabs.innerHTML = '';
    body.innerHTML = '';
    w.panes = {};
    for (const [key, label, fn] of PANELS[dev.type]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.tab = key;
      b.addEventListener('click', () => this.showTab(w, key));
      tabs.appendChild(b);
      const pane = fn(dev);
      pane.el.hidden = true;
      body.appendChild(pane.el);
      w.panes[key] = pane;
    }
    w.el.querySelector('.win-ico').innerHTML = Icons.deviceSvg(dev.type, 18);
    this.showTab(w, w.tab && w.panes[w.tab] ? w.tab : PANELS[dev.type][0][0]);
    this.updateWin(w);
  },

  showTab(w, key) {
    if (!w.panes[key]) return;
    w.tab = key;
    w.el.querySelectorAll('.win-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === key));
    for (const k in w.panes) w.panes[k].el.hidden = k !== key;
    if (w.panes[key].onShow) w.panes[key].onShow();
  },

  updateWin(w) {
    w.el.querySelector('.win-name').textContent = w.dev.name;
    w.el.querySelector('.win-kind').textContent = DEVICE_TYPES[w.dev.type].label;
    for (const k in w.panes) if (w.panes[k].update) w.panes[k].update();
  },

  focus(w) {
    if (w.el.classList.contains('focused')) return;
    document.querySelectorAll('.win.focused').forEach(x => x.classList.remove('focused'));
    w.el.classList.add('focused');
    w.el.style.zIndex = ++this.z;
  },

  close(id) {
    const w = this.wins.get(id);
    if (!w) return;
    w.el.remove();
    this.wins.delete(id);
  },

  /** Nach jeder Modelländerung: Fenster aktualisieren, nach Rückgängig/Laden neu aufbauen. */
  sync() {
    for (const [id, t] of this.terms) {
      const d = Model.get(id);
      if (!d) this.terms.delete(id);
      else { t.dev = d; t.updatePrompt(); }
    }
    for (const [id, w] of [...this.wins]) {
      const d = Model.get(id);
      if (!d) { this.close(id); continue; }
      if (d !== w.dev) { w.dev = d; this.build(w); }
      else this.updateWin(w);
    }
  },

  makeDraggable(el, handle) {
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, ox = el.offsetLeft, oy = el.offsetTop;
      handle.setPointerCapture(e.pointerId);
      const move = ev => {
        el.style.left = clamp(ox + ev.clientX - sx, 80 - el.offsetWidth, window.innerWidth - 80) + 'px';
        el.style.top = clamp(oy + ev.clientY - sy, 0, window.innerHeight - 40) + 'px';
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  },
};

/* ================= Hilfsfunktionen für die Reiter ================= */

function commit() { Model.changed('edit'); }

function makePane(html, cls = '') {
  const el = document.createElement('div');
  el.className = 'pane ' + cls;
  el.innerHTML = html;
  return el;
}

function nameRow(dev) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = '<label>Gerätename</label><input type="text" maxlength="30" spellcheck="false">';
  const inp = row.querySelector('input');
  inp.value = dev.name;
  inp.addEventListener('change', () => {
    const v = inp.value.trim();
    if (v) { dev.name = v; commit(); } else inp.value = dev.name;
  });
  return { row, update() { if (document.activeElement !== inp) inp.value = dev.name; } };
}

/** Bindet ein Eingabefeld für IP-Adresse oder Maske an das Modell (mit Prüfung und Normalisierung). */
function bindIpInput(inp, kind, get, set) {
  const ok = v => v.trim() === '' || (kind === 'mask' ? IP.parseMask(v) !== null : IP.valid(v));
  inp.value = get() || '';
  inp.addEventListener('input', () => inp.classList.toggle('invalid', !ok(inp.value)));
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
  inp.addEventListener('change', () => {
    const v = inp.value.trim();
    if (!ok(v)) { inp.classList.add('invalid'); return; }
    inp.classList.remove('invalid');
    const norm = v === '' ? '' : kind === 'mask' ? IP.str(IP.parseMask(v)) : IP.str(IP.parse(v));
    inp.value = norm;
    set(norm);
    commit();
  });
  return {
    refresh() {
      if (document.activeElement !== inp && !inp.classList.contains('invalid')) inp.value = get() || '';
    },
  };
}

/** Bei leerer Maske eine klassenbasierte Standardmaske vorschlagen (wie Packet Tracer). */
function autoMask(obj, ipStr) {
  if (!ipStr || obj.mask) return;
  const m = IP.classfulMask(IP.parse(ipStr));
  if (m !== null) obj.mask = IP.str(m);
}

function peerText(dev, i) {
  const p = Sim.peer(dev, i);
  return p ? `${p.dev.name} (${p.dev.ports[p.port].name})` : '–';
}

function warnHtml(list) {
  return list.map(w => `<div>⚠ ${esc(w)}</div>`).join('');
}

/* ================= PC / Server ================= */

function hostConfigPane(dev) {
  const rn = 'ipmode-' + dev.id + '-' + Math.random().toString(36).slice(2, 7);
  const el = makePane(`
    <fieldset class="box">
      <legend>IP-Konfiguration · FastEthernet0</legend>
      <div class="radios">
        <label><input type="radio" name="${rn}" value="dhcp"> DHCP</label>
        <label><input type="radio" name="${rn}" value="static"> Statisch</label>
        <button type="button" class="btn btn-sm" data-act="renew">DHCP neu anfordern</button>
      </div>
      <div class="row"><label>IPv4-Adresse</label><input type="text" data-f="ip" placeholder="z. B. 192.168.1.10" spellcheck="false"></div>
      <div class="row"><label>Subnetzmaske</label><input type="text" data-f="mask" placeholder="255.255.255.0 oder /24" spellcheck="false"></div>
      <div class="row"><label>Standardgateway</label><input type="text" data-f="gateway" placeholder="z. B. 192.168.1.1" spellcheck="false"></div>
      <div class="note" data-dyn="dhcp"></div>
    </fieldset>
    <div class="warn" data-dyn="warn"></div>
    <p class="meta">Anschluss FastEthernet0: <span data-dyn="link"></span></p>
    <p class="meta">Tipp: Im Reiter „Terminal“ mit <code>ping</code> die Verbindung testen.</p>`);
  const name = nameRow(dev);
  el.prepend(name.row);
  const q = s => el.querySelector(s);
  const f = { ip: q('[data-f=ip]'), mask: q('[data-f=mask]'), gateway: q('[data-f=gateway]') };
  const binds = [
    bindIpInput(f.ip, 'ip', () => dev.ip.ip, v => { dev.ip.ip = v; autoMask(dev.ip, v); }),
    bindIpInput(f.mask, 'mask', () => dev.ip.mask, v => { dev.ip.mask = v; }),
    bindIpInput(f.gateway, 'ip', () => dev.ip.gateway, v => { dev.ip.gateway = v; }),
  ];
  el.querySelectorAll(`input[name="${rn}"]`).forEach(r => r.addEventListener('change', () => {
    dev.ip.mode = r.value;
    if (r.value === 'dhcp') Sim.dhcpRequest(dev); else Sim.release(dev);
    commit();
  }));
  q('[data-act=renew]').addEventListener('click', () => { Sim.dhcpRequest(dev); commit(); });

  const dhcpNote = () => {
    const l = dev.lease;
    if (!l) return 'Noch keine Adresse angefordert.';
    if (l.released) return 'Adresse freigegeben (ipconfig /release). „DHCP neu anfordern“ holt eine neue.';
    if (l.apipa) return 'Kein DHCP-Server erreichbar – automatische APIPA-Adresse vergeben.';
    const s = Model.get(l.server);
    return `Adresse vom DHCP-Server ${s ? s.name : '?'} erhalten.`;
  };

  return {
    el,
    update() {
      name.update();
      const dhcp = dev.ip.mode === 'dhcp';
      el.querySelectorAll(`input[name="${rn}"]`).forEach(r => { r.checked = r.value === dev.ip.mode; });
      q('[data-act=renew]').hidden = !dhcp;
      for (const k in f) {
        f[k].disabled = dhcp;
        if (dhcp) { f[k].value = (dev.lease && dev.lease[k]) || ''; f[k].classList.remove('invalid'); }
      }
      if (!dhcp) binds.forEach(b => b.refresh());
      q('[data-dyn=dhcp]').textContent = dhcp ? dhcpNote() : '';
      q('[data-dyn=warn]').innerHTML = warnHtml(Sim.hostWarnings(dev));
      q('[data-dyn=link]').textContent = Sim.peer(dev, 0) ? 'verbunden mit ' + peerText(dev, 0) : 'nicht verbunden';
    },
  };
}

function dhcpServicePane(dev) {
  const el = makePane(`
    <fieldset class="box">
      <legend>DHCP-Server</legend>
      <div class="row"><label>Dienst</label><label class="chk"><input type="checkbox" data-f="enabled"> aktiviert</label></div>
      <div class="row"><label>Standardgateway</label><input type="text" data-f="gateway" placeholder="z. B. 192.168.1.1" spellcheck="false"></div>
      <div class="row"><label>Start-IP-Adresse</label><input type="text" data-f="start" spellcheck="false"></div>
      <div class="row"><label>Subnetzmaske</label><input type="text" data-f="mask" spellcheck="false"></div>
      <div class="row"><label>Max. Anzahl Clients</label><input type="number" min="1" max="1000" data-f="max"></div>
      <div class="warn" data-dyn="warn"></div>
    </fieldset>
    <fieldset class="box">
      <legend>Vergebene Adressen</legend>
      <div data-dyn="leases"></div>
    </fieldset>
    <p class="meta">PCs/Server im selben Netzsegment (gleiches VLAN), die auf DHCP eingestellt sind, erhalten automatisch eine Adresse aus diesem Pool. Router leiten DHCP (noch) nicht weiter.</p>`);
  const c = dev.dhcp;
  const q = s => el.querySelector(s);
  const en = q('[data-f=enabled]'), max = q('[data-f=max]');
  en.addEventListener('change', () => { c.enabled = en.checked; commit(); });
  max.addEventListener('change', () => { c.max = clamp(parseInt(max.value, 10) || 1, 1, 1000); max.value = c.max; commit(); });
  const binds = [
    bindIpInput(q('[data-f=gateway]'), 'ip', () => c.gateway, v => { c.gateway = v; }),
    bindIpInput(q('[data-f=start]'), 'ip', () => c.start, v => { c.start = v; autoMask(c, v); }),
    bindIpInput(q('[data-f=mask]'), 'mask', () => c.mask, v => { c.mask = v; }),
  ];
  return {
    el,
    update() {
      en.checked = c.enabled;
      if (document.activeElement !== max) max.value = c.max;
      binds.forEach(b => b.refresh());
      const w = [];
      if (c.enabled && !Sim.poolValid(dev)) w.push('Pool unvollständig: Start-IP, Subnetzmaske und Anzahl angeben.');
      const st = IP.parse(c.start), mk = IP.parseMask(c.mask), gw = IP.parse(c.gateway);
      if (st !== null && mk !== null && gw !== null && !IP.sameNet(st, gw, mk)) w.push('Gateway liegt nicht im Subnetz des Pools.');
      if (c.enabled && !Sim.hostIface(dev)) w.push('Der Server selbst hat noch keine IP-Adresse.');
      q('[data-dyn=warn]').innerHTML = warnHtml(w);
      const rows = Model.devices
        .filter(d => Sim.isHost(d) && d.ip.mode === 'dhcp' && d.lease && d.lease.server === dev.id && !d.lease.apipa && !d.lease.released)
        .map(d => `<tr><td>${esc(d.name)}</td><td>${esc(d.lease.ip)}</td><td>${esc(Sim.mac(d))}</td></tr>`);
      q('[data-dyn=leases]').innerHTML = rows.length
        ? `<table class="tbl"><thead><tr><th>Client</th><th>IP-Adresse</th><th>MAC-Adresse</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
        : '<span class="meta">Noch keine Adressen vergeben.</span>';
    },
  };
}

function terminalPane(dev) {
  let term = Win.terms.get(dev.id);
  if (!term) { term = new Terminal(dev); Win.terms.set(dev.id, term); }
  term.dev = dev;
  const el = makePane('', 'pane-term');
  el.appendChild(term.el);
  return {
    el,
    onShow() { setTimeout(() => { term.focus(); term.scroll(); }, 0); },
  };
}

/* ================= Switch ================= */

const vlanSig = dev => dev.vlans.map(v => v.id + ':' + v.name).join('|');

function switchPortsPane(dev) {
  const el = makePane(`
    <table class="tbl">
      <thead><tr><th>Port</th><th>Verbunden mit</th><th style="width:110px">Modus</th><th style="width:170px">VLAN</th></tr></thead>
      <tbody></tbody>
    </table>
    <p class="meta"><b>Access</b>: Port gehört genau einem VLAN an (für PCs, Server, Router).<br>
    <b>Trunk</b>: Port überträgt alle VLANs zu einem anderen Switch (VLAN 1 ungetaggt als natives VLAN).</p>`);
  const name = nameRow(dev);
  el.prepend(name.row);
  const tb = el.querySelector('tbody');
  let sig = '';
  const render = () => {
    sig = vlanSig(dev);
    const opts = dev.vlans.map(v => `<option value="${v.id}">${v.id} – ${esc(v.name)}</option>`).join('');
    tb.innerHTML = dev.ports.map((p, i) => `<tr>
      <td><b>${esc(p.name)}</b></td>
      <td data-peer="${i}"></td>
      <td><select data-mode="${i}"><option value="access">Access</option><option value="trunk">Trunk</option></select></td>
      <td><select data-vlan="${i}">${opts}</select></td></tr>`).join('');
    tb.querySelectorAll('[data-mode]').forEach(s => s.addEventListener('change', () => {
      dev.ports[+s.dataset.mode].mode = s.value; commit();
    }));
    tb.querySelectorAll('[data-vlan]').forEach(s => s.addEventListener('change', () => {
      dev.ports[+s.dataset.vlan].vlan = Number(s.value); commit();
    }));
  };
  render();
  return {
    el,
    update() {
      name.update();
      if (vlanSig(dev) !== sig) render();
      dev.ports.forEach((p, i) => {
        tb.querySelector(`[data-peer="${i}"]`).textContent = peerText(dev, i);
        tb.querySelector(`[data-mode="${i}"]`).value = p.mode;
        const vs = tb.querySelector(`[data-vlan="${i}"]`);
        vs.value = String(p.vlan);
        vs.disabled = p.mode === 'trunk';
        vs.title = p.mode === 'trunk' ? 'Trunk-Ports übertragen alle VLANs' : '';
      });
    },
  };
}

function vlanPane(dev) {
  const el = makePane(`
    <table class="tbl">
      <thead><tr><th style="width:70px">VLAN</th><th>Name</th><th>Access-Ports</th><th style="width:36px"></th></tr></thead>
      <tbody></tbody>
    </table>
    <div class="add-row">
      <input type="number" data-new="id" min="2" max="4094" placeholder="VLAN-ID">
      <input type="text" data-new="name" placeholder="Name (optional), z. B. Verwaltung" maxlength="32">
      <button class="btn" data-act="add">VLAN anlegen</button>
    </div>
    <div class="err" data-dyn="err"></div>
    <p class="meta">VLAN 1 (default) ist immer vorhanden. Wird ein VLAN gelöscht, kommen seine Ports zurück in VLAN 1.</p>`);
  const tb = el.querySelector('tbody');
  const q = s => el.querySelector(s);
  const err = q('[data-dyn=err]');
  const portsIn = id => dev.ports.filter(p => p.mode === 'access' && p.vlan === id).map(p => p.name.replace('Fa0/', '')).join(', ') || '–';
  let sig = '';
  const render = () => {
    sig = vlanSig(dev);
    tb.innerHTML = dev.vlans.map(v => `<tr>
      <td><b>${v.id}</b></td>
      <td><input type="text" data-name="${v.id}" maxlength="32" ${v.id === 1 ? 'disabled' : ''}></td>
      <td data-ports="${v.id}"></td>
      <td>${v.id === 1 ? '' : `<button class="btn-icon" data-del="${v.id}" title="VLAN löschen">✕</button>`}</td></tr>`).join('');
    tb.querySelectorAll('[data-name]').forEach(inp => {
      const v = dev.vlans.find(x => x.id === Number(inp.dataset.name));
      inp.value = v.name;
      inp.addEventListener('change', () => {
        v.name = inp.value.trim() || 'VLAN' + String(v.id).padStart(4, '0');
        inp.value = v.name;
        commit();
      });
    });
    tb.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
      const id = Number(b.dataset.del);
      dev.ports.forEach(p => { if (p.vlan === id) p.vlan = 1; });
      dev.vlans = dev.vlans.filter(v => v.id !== id);
      commit();
    }));
  };
  const add = () => {
    const idInp = q('[data-new=id]'), nameInp = q('[data-new=name]');
    const id = Number(idInp.value);
    err.textContent = '';
    if (!Number.isInteger(id) || id < 2 || id > 4094) { err.textContent = 'Bitte eine VLAN-ID zwischen 2 und 4094 eingeben.'; return; }
    if (dev.vlans.some(v => v.id === id)) { err.textContent = `VLAN ${id} existiert bereits.`; return; }
    dev.vlans.push({ id, name: nameInp.value.trim() || 'VLAN' + String(id).padStart(4, '0') });
    dev.vlans.sort((a, b) => a.id - b.id);
    idInp.value = '';
    nameInp.value = '';
    commit();
    idInp.focus();
  };
  q('[data-act=add]').addEventListener('click', add);
  el.querySelectorAll('[data-new]').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') add(); }));
  render();
  return {
    el,
    update() {
      if (vlanSig(dev) !== sig) render();
      dev.vlans.forEach(v => { tb.querySelector(`[data-ports="${v.id}"]`).textContent = portsIn(v.id); });
    },
  };
}

const STP_ROLES = {
  root: 'Root-Port', designated: 'Designated', alternate: 'Alternate', backup: 'Backup', disabled: 'Deaktiviert',
};

function bidText(b) { return `Priorität ${b.prio} · MAC ${b.mac}`; }

function stpPane(dev) {
  const prios = Array.from({ length: 16 }, (_, k) => k * 4096);
  const el = makePane(`
    <fieldset class="box">
      <legend>Spanning Tree (PVST+)</legend>
      <div class="row"><label>Spanning Tree</label><label class="chk"><input type="checkbox" data-f="enabled"> aktiviert</label></div>
      <div class="row"><label>Bridge-Priorität</label>
        <select data-f="prio">${prios.map(p => `<option value="${p}">${p}${p === 32768 ? ' (Standard)' : ''}</option>`).join('')}</select></div>
      <p class="meta">Die kleinste Bridge-ID (Priorität, dann MAC-Adresse) wird Root-Bridge. Zur Priorität wird die
        VLAN-Nummer addiert (32768 + VLAN 1 = 32769). Pfadkosten je FastEthernet-Port: ${Sim.STP_COST}.</p>
    </fieldset>
    <div class="row"><label>Anzeige für VLAN</label><select data-f="vlan"></select></div>
    <div data-dyn="info"></div>
    <div class="warn" data-dyn="warn"></div>`);
  const q = s => el.querySelector(s);
  const en = q('[data-f=enabled]'), prio = q('[data-f=prio]'), vsel = q('[data-f=vlan]');
  let vlan = 1, sig = '';
  en.addEventListener('change', () => { dev.stp.enabled = en.checked; commit(); });
  prio.addEventListener('change', () => { dev.stp.priority = Number(prio.value); commit(); });
  vsel.addEventListener('change', () => { vlan = Number(vsel.value); update(); });

  function update() {
    en.checked = dev.stp.enabled;
    prio.value = String(dev.stp.priority);
    prio.disabled = !dev.stp.enabled;
    if (vlanSig(dev) !== sig) {
      sig = vlanSig(dev);
      vsel.innerHTML = dev.vlans.map(v => `<option value="${v.id}">${v.id} – ${esc(v.name)}</option>`).join('');
    }
    if (!dev.vlans.some(v => v.id === vlan)) vlan = 1;
    vsel.value = String(vlan);

    const data = Sim.stpData();
    q('[data-dyn=warn]').innerHTML = data.loops.has(vlan)
      ? warnHtml([`Schleife in VLAN ${vlan} ohne Spanning Tree – Broadcast-Sturm! Frames kreisen endlos, Pings scheitern.`]) : '';

    const info = q('[data-dyn=info]');
    if (!dev.stp.enabled) {
      info.innerHTML = '<p class="meta">Spanning Tree ist auf diesem Switch deaktiviert. Er leitet alle Frames weiter ' +
        'und reicht BPDUs anderer Switches unverändert durch.</p>';
      return;
    }
    const vd = data.vlans[vlan];
    const b = vd && vd.bridges[dev.id];
    if (!b) { info.innerHTML = ''; return; }
    const root = Model.get(b.rootId);
    const rows = [...vd.ports.values()].filter(p => p.sw === dev && p.active).map(p => {
      const [cls, label] = { forwarding: ['fwd', 'Forwarding'], blocking: ['blk', 'Blocking'], listening: ['lis', 'Listening/Learning'] }[p.state];
      return `<tr><td><b>${esc(dev.ports[p.port].name)}</b></td><td>${STP_ROLES[p.role]}</td>` +
        `<td><span class="stp-state ${cls}">${label}</span></td>` +
        `<td>${p.cost}</td><td>${Sim.STP_PORT_PRIO}.${p.port + 1}</td><td>${esc(peerText(dev, p.port))}</td></tr>`;
    });
    info.innerHTML = `
      <fieldset class="box"><legend>VLAN ${vlan}</legend>
        <table class="kv">
          <tr><th>Root-Bridge</th><td>${bidText(b.rootBid)} (${esc(root ? root.name : '?')})
            ${b.isRoot ? '<span class="stp-root">★ Diese Bridge ist Root</span>' : ''}</td></tr>
          <tr><th>Root-Pfadkosten</th><td>${b.rootCost}</td></tr>
          <tr><th>Root-Port</th><td>${b.rootPort === null ? '–' : esc(dev.ports[b.rootPort].name)}</td></tr>
          <tr><th>Diese Bridge</th><td>${bidText(b.bid)}</td></tr>
        </table>
        <table class="tbl">
          <thead><tr><th>Port</th><th>Rolle</th><th>Status</th><th>Kosten</th><th>Port-ID</th><th>Verbunden mit</th></tr></thead>
          <tbody>${rows.join('') || '<tr><td colspan="6" class="empty">Keine verbundenen Ports in diesem VLAN.</td></tr>'}</tbody>
        </table>
      </fieldset>
      <p class="meta">Nach einer Änderung durchlaufen Ports, die neu weiterleiten sollen, ${Sim.STP_DELAY / 1000} s lang
        Listening/Learning (rot) und leiten in dieser Zeit nichts weiter. Ports, die blockieren müssen, blockieren sofort.</p>`;
  }

  return { el, update };
}

/* ================= Router ================= */

function routerIfacePane(dev) {
  const el = makePane(dev.ports.map((p, i) => `
    <fieldset class="box">
      <legend>${longPortName(p.name)}</legend>
      <div class="row"><label>Port-Status</label>
        <div class="inline"><label class="chk"><input type="checkbox" data-up="${i}"> aktiv</label><span class="meta" data-st="${i}"></span></div></div>
      <div class="row"><label>IPv4-Adresse</label><input type="text" data-ip="${i}" placeholder="z. B. 192.168.${i + 1}.1" spellcheck="false"></div>
      <div class="row"><label>Subnetzmaske</label><input type="text" data-mask="${i}" placeholder="255.255.255.0 oder /24" spellcheck="false"></div>
      <div class="warn" data-w="${i}"></div>
    </fieldset>`).join(''));
  const name = nameRow(dev);
  el.prepend(name.row);
  const binds = [];
  dev.ports.forEach((p, i) => {
    binds.push(bindIpInput(el.querySelector(`[data-ip="${i}"]`), 'ip', () => p.ip, v => { p.ip = v; autoMask(p, v); }));
    binds.push(bindIpInput(el.querySelector(`[data-mask="${i}"]`), 'mask', () => p.mask, v => { p.mask = v; }));
    el.querySelector(`[data-up="${i}"]`).addEventListener('change', e => { p.up = e.target.checked; commit(); });
  });
  return {
    el,
    update() {
      name.update();
      binds.forEach(b => b.refresh());
      dev.ports.forEach((p, i) => {
        el.querySelector(`[data-up="${i}"]`).checked = !!p.up;
        const peer = Sim.peer(dev, i);
        const st = el.querySelector(`[data-st="${i}"]`);
        st.textContent = !p.up ? 'deaktiviert (shutdown)'
          : peer ? `verbunden mit ${peerText(dev, i)}` : 'kein Kabel';
        st.className = 'meta' + (p.up && peer ? ' ok-text' : '');
        el.querySelector(`[data-w="${i}"]`).innerHTML = warnHtml(Sim.routerPortWarnings(dev, i));
      });
    },
  };
}

function routingPane(dev) {
  const el = makePane(`
    <fieldset class="box">
      <legend>Statische Routen</legend>
      <table class="tbl">
        <thead><tr><th>Zielnetz</th><th>Next Hop</th><th>Status</th><th style="width:36px"></th></tr></thead>
        <tbody data-dyn="routes"></tbody>
      </table>
      <div class="add-row">
        <input type="text" data-new="route" placeholder="z. B. 192.168.1.0/24 via 192.168.2.254" spellcheck="false">
        <button class="btn" data-act="add">Route hinzufügen</button>
      </div>
      <div class="err" data-dyn="err"></div>
      <p class="meta">Formate: <code>Netz/Präfix via Next-Hop</code> · <code>Netz Maske Next-Hop</code> · <code>ip route …</code><br>
      Standardroute: <code>0.0.0.0/0 via &lt;Next-Hop&gt;</code></p>
    </fieldset>
    <fieldset class="box">
      <legend>Routingtabelle (aktiv)</legend>
      <table class="tbl mono"><tbody data-dyn="rt"></tbody></table>
    </fieldset>`);
  const q = s => el.querySelector(s);
  const inp = q('[data-new=route]'), err = q('[data-dyn=err]');
  const add = () => {
    err.textContent = '';
    if (!inp.value.trim()) return;
    const r = Sim.parseRoute(inp.value);
    if (r.error) { err.textContent = r.error; return; }
    if (dev.routes.some(x => x.network === r.route.network && x.mask === r.route.mask && x.nextHop === r.route.nextHop)) {
      err.textContent = 'Diese Route ist bereits eingetragen.';
      return;
    }
    dev.routes.push(r.route);
    inp.value = '';
    commit();
  };
  q('[data-act=add]').addEventListener('click', add);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  q('[data-dyn=routes]').addEventListener('click', e => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    dev.routes.splice(Number(b.dataset.del), 1);
    commit();
  });

  return {
    el,
    update() {
      const tb = q('[data-dyn=routes]');
      tb.innerHTML = dev.routes.length ? dev.routes.map((r, i) => {
        const nh = IP.parse(r.nextHop);
        const via = nh !== null ? Sim.lookup(dev, nh) : null;
        const st = via
          ? `<span class="ok-text">✓ über ${esc(dev.ports[via.port].name)}</span>`
          : '<span class="warn">⚠ Next Hop nicht erreichbar</span>';
        const net = IP.parse(r.network), mk = IP.parseMask(r.mask);
        const cidr = net !== null && mk !== null ? IP.cidr(net, mk) : `${r.network} ${r.mask}`;
        return `<tr><td>${esc(cidr)}</td><td>${esc(r.nextHop)}</td><td>${st}</td>` +
          `<td><button class="btn-icon" data-del="${i}" title="Route löschen">✕</button></td></tr>`;
      }).join('') : '<tr><td colspan="4" class="empty">Keine statischen Routen eingetragen.</td></tr>';

      const rt = Sim.routes(dev).map(e => {
        let via;
        if (e.code === 'C') via = `direkt verbunden, ${dev.ports[e.port].name}`;
        else via = `via ${IP.str(e.nextHop)}` + (Sim.lookup(dev, e.nextHop) ? '' : ' (inaktiv)');
        return { e, html: `<tr><td style="width:30px"><span class="badge ${e.code}">${e.code}</span></td><td>${IP.cidr(e.net, e.mask)}</td><td>${esc(via)}</td></tr>` };
      }).sort((a, b) => (a.e.net - b.e.net) || (IP.prefixLen(a.e.mask) - IP.prefixLen(b.e.mask)));
      q('[data-dyn=rt]').innerHTML = rt.length ? rt.map(x => x.html).join('')
        : '<tr><td class="empty">Leer – Schnittstellen konfigurieren und verkabeln.</td></tr>';
    },
  };
}

/* Reiter je Gerätetyp: [Schlüssel, Beschriftung, Fabrikfunktion] */
const PANELS = {
  pc: [['config', 'Konfiguration', hostConfigPane], ['terminal', 'Terminal', terminalPane]],
  server: [['config', 'Konfiguration', hostConfigPane], ['services', 'Dienste (DHCP)', dhcpServicePane], ['terminal', 'Terminal', terminalPane]],
  switch: [['ports', 'Ports', switchPortsPane], ['vlans', 'VLANs', vlanPane], ['stp', 'Spanning Tree', stpPane]],
  router: [['ifaces', 'Schnittstellen', routerIfacePane], ['routing', 'Routing', routingPane], ['terminal', 'CLI', terminalPane]],
};
