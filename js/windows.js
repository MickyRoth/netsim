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
    if (dev.type === 'l3switch') el.style.width = '660px';
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
      <div class="row"><label>DNS-Server</label><input type="text" data-f="dns" placeholder="z. B. 192.168.1.2" spellcheck="false"></div>
      <div class="note" data-dyn="dhcp"></div>
    </fieldset>
    <div class="warn" data-dyn="warn"></div>
    <p class="meta">Anschluss FastEthernet0: <span data-dyn="link"></span></p>
    <p class="meta">Tipp: Im Reiter „Terminal“ mit <code>ping</code> die Verbindung testen.</p>`);
  const name = nameRow(dev);
  el.prepend(name.row);
  const q = s => el.querySelector(s);
  const f = { ip: q('[data-f=ip]'), mask: q('[data-f=mask]'), gateway: q('[data-f=gateway]'), dns: q('[data-f=dns]') };
  const binds = [
    bindIpInput(f.ip, 'ip', () => dev.ip.ip, v => { dev.ip.ip = v; autoMask(dev.ip, v); }),
    bindIpInput(f.mask, 'mask', () => dev.ip.mask, v => { dev.ip.mask = v; }),
    bindIpInput(f.gateway, 'ip', () => dev.ip.gateway, v => { dev.ip.gateway = v; }),
    bindIpInput(f.dns, 'ip', () => dev.ip.dns, v => { dev.ip.dns = v; }),
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
    return `Adresse vom DHCP-Server ${s ? s.name : '?'}${l.pool ? ` (Pool ${l.pool})` : ''} erhalten.`;
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
      <div class="row"><label>DNS-Server</label><input type="text" data-f="dns" placeholder="z. B. 192.168.1.2" spellcheck="false"></div>
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
    bindIpInput(q('[data-f=dns]'), 'ip', () => c.dns, v => { c.dns = v; }),
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
      if (c.enabled && !Sim.poolValid(c)) w.push('Pool unvollständig: Start-IP, Subnetzmaske und Anzahl angeben.');
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

/** DNS-Server-Eintrag (ip name-server) für Router und L3-Switch. */
function dnsRow(dev) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = '<label>DNS-Server</label><input type="text" spellcheck="false" placeholder="ip name-server, z. B. 192.168.1.2">';
  const b = bindIpInput(row.querySelector('input'), 'ip', () => dev.dns, v => { dev.dns = v; });
  return { row, update() { b.refresh(); } };
}

function dnsServicePane(dev) {
  const c = dev.dns;
  const el = makePane(`
    <fieldset class="box">
      <legend>DNS-Server</legend>
      <div class="row"><label>Dienst</label><label class="chk"><input type="checkbox" data-f="enabled"> aktiviert</label></div>
      <div class="row"><label>Adresse dieses Servers</label><span data-dyn="addr"></span></div>
      <p class="meta">Clients, die diesen Server als DNS-Server eingetragen haben (statisch oder per DHCP), können Namen
        statt IP-Adressen verwenden, z.&nbsp;B. <code>ping www.schule.lan</code> oder <code>nslookup www.schule.lan</code>.</p>
    </fieldset>
    <fieldset class="box">
      <legend>Einträge (A-Records)</legend>
      <table class="tbl">
        <thead><tr><th>Name</th><th>IP-Adresse</th><th style="width:36px"></th></tr></thead>
        <tbody data-dyn="records"></tbody>
      </table>
      <div class="add-row">
        <input type="text" data-new="name" placeholder="Name, z. B. www.schule.lan" spellcheck="false">
        <input type="text" data-new="ip" placeholder="IP-Adresse" spellcheck="false" style="flex:0 0 150px">
        <button class="btn" data-act="add">Hinzufügen</button>
      </div>
      <div class="err" data-dyn="err"></div>
    </fieldset>
    <div class="warn" data-dyn="warn"></div>`);
  const q = s => el.querySelector(s);
  const en = q('[data-f=enabled]'), err = q('[data-dyn=err]');
  const nIn = q('[data-new=name]'), iIn = q('[data-new=ip]');
  en.addEventListener('change', () => { c.enabled = en.checked; commit(); });
  const add = () => {
    err.textContent = '';
    const name = nIn.value.trim().toLowerCase().replace(/\.$/, '');
    const ip = iIn.value.trim();
    if (!Sim.validHostname(name) || IP.valid(name)) { err.textContent = 'Ungültiger Name – erlaubt sind Buchstaben, Ziffern, Bindestrich und Punkt (z. B. www.schule.lan).'; return; }
    if (!IP.valid(ip)) { err.textContent = 'Bitte eine gültige IPv4-Adresse eingeben.'; return; }
    const ex = c.records.find(r => r.name === name);
    if (ex) ex.ip = IP.str(IP.parse(ip)); else c.records.push({ name, ip: IP.str(IP.parse(ip)) });
    c.records.sort((a, b) => a.name.localeCompare(b.name));
    nIn.value = ''; iIn.value = '';
    commit();
    nIn.focus();
  };
  q('[data-act=add]').addEventListener('click', add);
  [nIn, iIn].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') add(); }));
  q('[data-dyn=records]').addEventListener('click', e => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    c.records = c.records.filter(r => r.name !== b.dataset.del);
    commit();
  });
  return {
    el,
    update() {
      en.checked = c.enabled;
      const f = Sim.hostIface(dev);
      q('[data-dyn=addr]').innerHTML = f ? `<code>${IP.str(f.ip)}</code>` : '<span class="warn">keine IP-Adresse</span>';
      q('[data-dyn=records]').innerHTML = c.records.length ? c.records.map(r =>
        `<tr><td><code>${esc(r.name)}</code></td><td>${esc(r.ip)}</td>` +
        `<td><button class="btn-icon" data-del="${esc(r.name)}" title="Eintrag löschen">✕</button></td></tr>`).join('')
        : '<tr><td colspan="3" class="empty">Noch keine Einträge.</td></tr>';
      const w = [];
      if (c.enabled && !f) w.push('Der Server hat noch keine IP-Adresse – Clients können ihn nicht erreichen.');
      if (c.enabled && !c.records.length) w.push('Noch keine Einträge – Anfragen werden mit „Name nicht gefunden“ beantwortet.');
      q('[data-dyn=warn]').innerHTML = warnHtml(w);
    },
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
    <b>Trunk</b>: Port überträgt alle VLANs zu einem anderen Switch (VLAN 1 ungetaggt als natives VLAN).${dev.type === 'l3switch'
      ? '<br><b>Routed</b> (no switchport): Port arbeitet wie ein Router-Port mit eigener IP-Adresse (Reiter „SVI / L3“).' : ''}</p>`);
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
      <td><select data-mode="${i}"><option value="access">Access</option><option value="trunk">Trunk</option>${dev.type === 'l3switch' ? '<option value="routed">Routed</option>' : ''}</select></td>
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
        vs.disabled = p.mode !== 'access';
        vs.title = p.mode === 'trunk' ? 'Trunk-Ports übertragen alle VLANs'
          : p.mode === 'routed' ? 'Gerouteter Port – IP-Adresse im Reiter „SVI / L3“' : '';
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
      <details class="subifs" data-sub="${i}">
        <summary>Subinterfaces (802.1Q, „Router on a Stick“) <span class="meta" data-subcount="${i}"></span></summary>
        <table class="tbl">
          <thead><tr><th>Subinterface</th><th>VLAN</th><th>IPv4-Adresse</th><th>Subnetzmaske</th><th style="width:36px"></th></tr></thead>
          <tbody data-subrows="${i}"></tbody>
        </table>
        <div class="add-row">
          <input type="number" min="1" max="4094" placeholder="VLAN-ID" data-subnew="${i}">
          <button class="btn" data-subadd="${i}">Subinterface anlegen</button>
        </div>
        <div class="err" data-suberr="${i}"></div>
        <div class="warn" data-subw="${i}"></div>
        <p class="meta">Der Switchport auf der Gegenseite muss ein <b>Trunk</b> sein. Jedes Subinterface empfängt und sendet
          getaggte Frames seines VLANs (<code>encapsulation dot1Q</code>) und ist das Gateway dieses VLANs.
          VLAN 1 ist das native VLAN (ungetaggt).</p>
      </details>
    </fieldset>`).join(''));
  const name = nameRow(dev);
  const dnsR = dnsRow(dev);
  el.prepend(name.row, dnsR.row);
  const binds = [];
  dev.ports.forEach((p, i) => {
    binds.push(bindIpInput(el.querySelector(`[data-ip="${i}"]`), 'ip', () => p.ip, v => { p.ip = v; autoMask(p, v); }));
    binds.push(bindIpInput(el.querySelector(`[data-mask="${i}"]`), 'mask', () => p.mask, v => { p.mask = v; }));
    el.querySelector(`[data-up="${i}"]`).addEventListener('change', e => { p.up = e.target.checked; commit(); });

    // Subinterfaces dieses Ports
    const err = el.querySelector(`[data-suberr="${i}"]`);
    const addSub = () => {
      const inp = el.querySelector(`[data-subnew="${i}"]`);
      const v = Number(inp.value);
      err.textContent = '';
      if (!Number.isInteger(v) || v < 1 || v > 4094) { err.textContent = 'Bitte eine VLAN-ID zwischen 1 und 4094 eingeben.'; return; }
      if (dev.subifs.some(s => s.port === i && s.vlan === v)) { err.textContent = `${p.name}.${v} existiert bereits.`; return; }
      dev.subifs.push({ port: i, vlan: v, ip: '', mask: '' });
      dev.subifs.sort((a, b) => (a.port - b.port) || (a.vlan - b.vlan));
      inp.value = '';
      commit();
    };
    el.querySelector(`[data-subadd="${i}"]`).addEventListener('click', addSub);
    el.querySelector(`[data-subnew="${i}"]`).addEventListener('keydown', e => { if (e.key === 'Enter') addSub(); });
  });

  let subSig = null, subBinds = [];
  const renderSubs = () => {
    subBinds = [];
    dev.ports.forEach((p, i) => {
      const subs = dev.subifs.filter(s => s.port === i);
      const tb = el.querySelector(`[data-subrows="${i}"]`);
      tb.innerHTML = subs.length ? subs.map(s => `<tr>
          <td><b>${esc(p.name)}.${s.vlan}</b></td><td>${s.vlan}${s.vlan === 1 ? ' (nativ)' : ''}</td>
          <td><input type="text" data-sip="${s.vlan}" spellcheck="false" placeholder="z. B. 192.168.${s.vlan % 256}.1"></td>
          <td><input type="text" data-smask="${s.vlan}" spellcheck="false" placeholder="/24"></td>
          <td><button class="btn-icon" data-sdel="${s.vlan}" title="Subinterface löschen">✕</button></td></tr>`).join('')
        : '<tr><td colspan="5" class="empty">Keine Subinterfaces.</td></tr>';
      for (const s of subs) {
        subBinds.push(bindIpInput(tb.querySelector(`[data-sip="${s.vlan}"]`), 'ip', () => s.ip, v => { s.ip = v; autoMask(s, v); }));
        subBinds.push(bindIpInput(tb.querySelector(`[data-smask="${s.vlan}"]`), 'mask', () => s.mask, v => { s.mask = v; }));
        tb.querySelector(`[data-sdel="${s.vlan}"]`).addEventListener('click', () => {
          const k = s.port + '.' + s.vlan;
          dev.subifs = dev.subifs.filter(x => x !== s);
          dev.rip.passive = dev.rip.passive.filter(x => x !== k);
          commit();
        });
      }
      // Bereich mit vorhandenen Subinterfaces geöffnet anzeigen
      if (subs.length) el.querySelector(`[data-sub="${i}"]`).open = true;
    });
  };

  return {
    el,
    update() {
      name.update();
      dnsR.update();
      const sig = dev.subifs.map(s => s.port + '.' + s.vlan).join(',');
      if (sig !== subSig) { subSig = sig; renderSubs(); }
      binds.forEach(b => b.refresh());
      subBinds.forEach(b => b.refresh());
      dev.ports.forEach((p, i) => {
        const keys = dev.subifs.filter(s => s.port === i).map(s => s.port + '.' + s.vlan);
        el.querySelector(`[data-subcount="${i}"]`).textContent = keys.length ? `– ${keys.length} angelegt` : '';
        el.querySelector(`[data-subw="${i}"]`).innerHTML =
          warnHtml(keys.flatMap(k => Sim.ifaceWarnings(dev, k).map(w => `${Sim.ifaceName(dev, k)}: ${w}`)));
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
  const el = makePane(`${dev.type === 'l3switch' ? `
    <fieldset class="box">
      <legend>IP-Routing</legend>
      <div class="row"><label>ip routing</label><label class="chk"><input type="checkbox" data-f="iprouting"> IP-Routing aktiviert</label></div>
      <p class="meta">Wie bei Cisco standardmäßig aus. Ohne IP-Routing arbeitet der Switch nur auf Schicht 2: Seine
        IP-Schnittstellen sind erreichbar (z.&nbsp;B. zur Verwaltung), er routet aber nicht zwischen VLANs und Netzen;
        statische Routen und RIP werden nicht verwendet.</p>
    </fieldset>` : ''}
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
  const iprBox = q('[data-f=iprouting]');
  if (iprBox) iprBox.addEventListener('change', () => { dev.ipRouting = iprBox.checked; commit(); });
  q('[data-dyn=routes]').addEventListener('click', e => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    dev.routes.splice(Number(b.dataset.del), 1);
    commit();
  });

  return {
    el,
    update() {
      const ipr = q('[data-f=iprouting]');
      if (ipr) ipr.checked = !!dev.ipRouting;
      const tb = q('[data-dyn=routes]');
      tb.innerHTML = dev.routes.length ? dev.routes.map((r, i) => {
        const nh = IP.parse(r.nextHop);
        const via = nh !== null ? Sim.lookup(dev, nh) : null;
        const st = via
          ? `<span class="ok-text">✓ über ${esc(Sim.ifaceName(dev, via.port))}</span>`
          : '<span class="warn">⚠ Next Hop nicht erreichbar</span>';
        const net = IP.parse(r.network), mk = IP.parseMask(r.mask);
        const cidr = net !== null && mk !== null ? IP.cidr(net, mk) : `${r.network} ${r.mask}`;
        return `<tr><td>${esc(cidr)}</td><td>${esc(r.nextHop)}</td><td>${st}</td>` +
          `<td><button class="btn-icon" data-del="${i}" title="Route löschen">✕</button></td></tr>`;
      }).join('') : '<tr><td colspan="4" class="empty">Keine statischen Routen eingetragen.</td></tr>';

      const rt = Sim.routes(dev).map(e => {
        let via;
        if (e.code === 'C') via = `direkt verbunden, ${Sim.ifaceName(dev, e.port)}`;
        else {
          const r = Sim.lookup(dev, e.nextHop);
          via = (e.code === 'R' ? `[120/${e.metric}] ` : '[1/0] ') + `via ${IP.str(e.nextHop)}` +
            (r ? `, ${Sim.ifaceName(dev, r.port)}` : ' (inaktiv)');
        }
        return { e, html: `<tr><td style="width:30px"><span class="badge ${e.code}">${e.code}</span></td><td>${IP.cidr(e.net, e.mask)}</td><td>${esc(via)}</td></tr>` };
      }).sort((a, b) => (a.e.net - b.e.net) || (IP.prefixLen(a.e.mask) - IP.prefixLen(b.e.mask)));
      q('[data-dyn=rt]').innerHTML = rt.length ? rt.map(x => x.html).join('')
        : '<tr><td class="empty">Leer – Schnittstellen konfigurieren und verkabeln.</td></tr>';
    },
  };
}

function ripPane(dev) {
  const el = makePane(`
    <fieldset class="box">
      <legend>RIP Version 2</legend>
      <div class="row"><label>RIPv2</label><label class="chk"><input type="checkbox" data-f="enabled"> aktiviert</label></div>
      <div class="row"><label>Status</label><span data-dyn="state"></span></div>
    </fieldset>
    <fieldset class="box">
      <legend>Netze (network)</legend>
      <table class="tbl">
        <thead><tr><th>Netz (klassenbasiert)</th><th>Erfasste Schnittstellen</th><th style="width:36px"></th></tr></thead>
        <tbody data-dyn="nets"></tbody>
      </table>
      <div class="add-row">
        <input type="text" data-new="net" placeholder="z. B. 192.168.1.0" spellcheck="false">
        <button class="btn" data-act="add">Netz hinzufügen</button>
      </div>
      <div class="err" data-dyn="err"></div>
      <div class="note" data-dyn="note"></div>
      <p class="meta">Wie bei Cisco klassenbasiert: 10.1.2.0 → 10.0.0.0 (Klasse A), 172.16.5.0 → 172.16.0.0 (Klasse B),
        192.168.1.0 bleibt (Klasse C). Alle Schnittstellen in diesem Netz senden und empfangen RIP-Updates und
        ihr Subnetz wird bekannt gegeben. Automatische Zusammenfassung ist aus (no auto-summary).</p>
    </fieldset>
    <fieldset class="box">
      <legend>Optionen</legend>
      <div class="row"><label>Passive Interfaces</label><div class="inline" data-dyn="passive"></div></div>
      <div class="row"><label>Standardroute</label><label class="chk"><input type="checkbox" data-f="orig"> an Nachbarn weitergeben (default-information originate)</label></div>
      <p class="meta">Passive Interfaces senden keine Updates (z. B. zu einem LAN nur mit PCs), ihr Netz wird aber weiterhin bekannt gegeben.</p>
    </fieldset>
    <fieldset class="box">
      <legend>RIP-Nachbarn</legend>
      <div data-dyn="nbrs"></div>
    </fieldset>
    <fieldset class="box">
      <legend>Gelernte RIP-Routen</legend>
      <table class="tbl mono">
        <thead><tr><th>Zielnetz</th><th>Hops</th><th>Next Hop</th><th>Schnittstelle</th><th>Status</th></tr></thead>
        <tbody data-dyn="routes"></tbody>
      </table>
      <p class="meta">Updates werden alle ${Sim.RIP_INTERVAL / 1000} s ausgetauscht: Netze, die n Hops entfernt sind,
        erscheinen nach n × ${Sim.RIP_INTERVAL / 1000} s – und verschwinden nach einem Ausfall ebenso Hop für Hop.</p>
    </fieldset>`);
  const q = s => el.querySelector(s);
  const c = dev.rip;
  const en = q('[data-f=enabled]'), orig = q('[data-f=orig]'), inp = q('[data-new=net]');
  const err = q('[data-dyn=err]'), note = q('[data-dyn=note]');
  en.addEventListener('change', () => { c.enabled = en.checked; commit(); });
  orig.addEventListener('change', () => { c.defaultOriginate = orig.checked; commit(); });
  // Passive Interfaces: Liste hängt beim L3-Switch von SVIs/gerouteten Ports ab
  const passiveBox = q('[data-dyn=passive]');
  let passiveSig = null;
  const ifKey = s => (/^\d+$/.test(s) ? Number(s) : s);
  passiveBox.addEventListener('change', e => {
    const cb = e.target.closest('[data-passive]');
    if (!cb) return;
    const k = ifKey(cb.dataset.passive);
    c.passive = cb.checked ? [...new Set([...c.passive, k])] : c.passive.filter(x => x !== k);
    commit();
  });
  const add = () => {
    err.textContent = '';
    note.textContent = '';
    const v = inp.value.trim();
    if (!v) return;
    const ip = IP.parse(v);
    const cn = ip === null ? null : IP.classfulNet(ip);
    if (cn === null) { err.textContent = 'Bitte eine gültige IPv4-Adresse der Klasse A, B oder C eingeben, z. B. 192.168.1.0.'; return; }
    const net = IP.str(cn);
    if (c.networks.includes(net)) { err.textContent = `network ${net} ist bereits eingetragen.`; return; }
    c.networks.push(net);
    c.networks.sort((a, b) => IP.parse(a) - IP.parse(b));
    if (net !== v) note.textContent = `Eingabe ${v} → klassenbasiert ${net} übernommen.`;
    inp.value = '';
    commit();
  };
  q('[data-act=add]').addEventListener('click', add);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  q('[data-dyn=nets]').addEventListener('click', e => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    c.networks = c.networks.filter(n => n !== b.dataset.del);
    commit();
  });

  return {
    el,
    update() {
      en.checked = c.enabled;
      orig.checked = c.defaultOriginate;
      const ifs = Sim.l3Ifaces(dev);
      const sig = ifs.join(',');
      if (sig !== passiveSig) {
        passiveSig = sig;
        passiveBox.innerHTML = ifs.length ? ifs.map(k =>
          `<label class="chk"><input type="checkbox" data-passive="${k}"> ${esc(Sim.ifaceName(dev, k))}</label>`).join('')
          : '<span class="meta">keine L3-Schnittstellen</span>';
      }
      passiveBox.querySelectorAll('[data-passive]').forEach(cb => { cb.checked = c.passive.includes(ifKey(cb.dataset.passive)); });

      const state = q('[data-dyn=state]');
      if (!c.enabled) { state.className = 'meta'; state.textContent = 'deaktiviert'; }
      else if (!Sim.routingOn(dev)) { state.className = 'warn'; state.textContent = 'inaktiv – IP-Routing ist ausgeschaltet (Reiter „Routing“)'; }
      else if (Sim.ripConverging()) { state.className = 'warn'; state.textContent = `Routing-Updates werden ausgetauscht … (${Sim.RIP_INTERVAL / 1000} s je Hop)`; }
      else { state.className = 'ok-text'; state.textContent = 'konvergiert'; }

      q('[data-dyn=nets]').innerHTML = c.networks.length ? c.networks.map(n => {
        const ifs = Sim.l3Ifaces(dev).filter(k => {
          const ip = IP.parse(Sim.ifaceConfig(dev, k).ip || '');
          return ip !== null && IP.classfulNet(ip) === IP.parse(n);
        }).map(k => Sim.ifaceName(dev, k));
        return `<tr><td><code>network ${esc(n)}</code></td><td>${ifs.length ? esc(ifs.join(', ')) : '<span class="warn">keine Schnittstelle in diesem Netz</span>'}</td>` +
          `<td><button class="btn-icon" data-del="${esc(n)}" title="Netz entfernen">✕</button></td></tr>`;
      }).join('') : '<tr><td colspan="3" class="empty">Noch keine Netze eingetragen.</td></tr>';

      const edges = c.enabled ? Sim.ripData().edges.filter(e => e.to === dev) : [];
      q('[data-dyn=nbrs]').innerHTML = edges.length
        ? `<table class="tbl"><thead><tr><th>Nachbar</th><th>Router</th><th>Über Schnittstelle</th></tr></thead><tbody>${edges.map(e =>
          `<tr><td>${IP.str(e.nh)}</td><td>${esc(e.from.name)}</td><td>${esc(Sim.ifaceName(dev, e.toPort))}</td></tr>`).join('')}</tbody></table>`
        : `<span class="meta">${c.enabled ? 'Keine RIP-Nachbarn erreichbar (Nachbar-Router brauchen ebenfalls RIP mit passendem network-Eintrag).' : '–'}</span>`;

      const rows = Sim.ripTable(dev).sort((a, b) => (a.net - b.net) || (IP.prefixLen(a.mask) - IP.prefixLen(b.mask))).map(e => {
        const inst = !Sim.ripSuperseded(dev, e.net, e.mask);
        return `<tr><td>${IP.cidr(e.net, e.mask)}</td><td>${e.metric}</td><td>${IP.str(e.nextHop)}</td><td>${esc(Sim.ifaceName(dev, e.port))}</td>` +
          `<td>${inst ? '<span class="ok-text">in Routingtabelle</span>' : '<span class="meta">ersetzt (direkt/statisch)</span>'}</td></tr>`;
      });
      q('[data-dyn=routes]').innerHTML = rows.join('') || '<tr><td colspan="5" class="empty">Keine gelernten Routen.</td></tr>';
    },
  };
}

function routerDhcpPane(dev) {
  const c = dev.dhcpd;
  const el = makePane(`
    <fieldset class="box">
      <legend>DHCP-Server</legend>
      <div class="row"><label>Dienst</label><label class="chk"><input type="checkbox" data-f="enabled"> aktiviert</label></div>
      <p class="meta">Der Router vergibt Adressen an Clients, deren Anfrage an einer Router-Schnittstelle (auch
        Subinterface) ankommt, die im Subnetz eines Pools liegt – z.&nbsp;B. ein Pool je VLAN bei „Router on a Stick“.</p>
    </fieldset>
    <div data-dyn="pools"></div>
    <button class="btn" data-act="add-pool" style="align-self:flex-start">+ Pool hinzufügen</button>
    <fieldset class="box">
      <legend>Vergebene Adressen</legend>
      <div data-dyn="leases"></div>
    </fieldset>`);
  const q = s => el.querySelector(s);
  const en = q('[data-f=enabled]');
  en.addEventListener('change', () => { c.enabled = en.checked; commit(); });
  q('[data-act=add-pool]').addEventListener('click', () => {
    // Vorschlag: Pool für das erste Subnetz einer Schnittstelle, das noch keinen Pool hat
    let start = '', mask = '255.255.255.0', gw = '';
    for (const k of Sim.l3Ifaces(dev)) {
      const f = Sim.portIp(dev, k);
      if (!f || c.pools.some(p => IP.parse(p.start) !== null && IP.sameNet(f.ip, IP.parse(p.start), f.mask))) continue;
      const net = IP.network(f.ip, f.mask);
      start = IP.str((net + Math.min(100, Math.max(1, IP.broadcast(f.ip, f.mask) - net - 51))) >>> 0);
      mask = IP.str(f.mask);
      gw = IP.str(f.ip);
      break;
    }
    let n = c.pools.length + 1;
    while (c.pools.some(p => p.name === 'POOL' + n)) n++;
    c.pools.push({ name: 'POOL' + n, gateway: gw, dns: dev.dns || '', start, mask, max: 50, leases: {} });
    commit();
  });

  let sig = null, binds = [];
  const render = () => {
    binds = [];
    const box = q('[data-dyn=pools]');
    box.innerHTML = c.pools.map((p, i) => `
      <fieldset class="box">
        <legend>Pool ${esc(p.name)}</legend>
        <div class="row"><label>Name</label><div class="inline">
          <input type="text" data-pname="${i}" maxlength="24" spellcheck="false">
          <button class="btn-icon" data-pdel="${i}" title="Pool löschen">✕</button></div></div>
        <div class="row"><label>Standardgateway</label><input type="text" data-pgw="${i}" spellcheck="false" placeholder="z. B. 192.168.10.1"></div>
        <div class="row"><label>DNS-Server</label><input type="text" data-pdns="${i}" spellcheck="false" placeholder="z. B. 192.168.1.2"></div>
        <div class="row"><label>Start-IP-Adresse</label><input type="text" data-pstart="${i}" spellcheck="false"></div>
        <div class="row"><label>Subnetzmaske</label><input type="text" data-pmask="${i}" spellcheck="false"></div>
        <div class="row"><label>Max. Anzahl Clients</label><input type="number" min="1" max="1000" data-pmax="${i}"></div>
        <div class="warn" data-pw="${i}"></div>
      </fieldset>`).join('') || '<p class="meta">Noch kein Pool angelegt.</p>';
    c.pools.forEach((p, i) => {
      const nm = box.querySelector(`[data-pname="${i}"]`);
      nm.value = p.name;
      nm.addEventListener('change', () => {
        const v = nm.value.trim().replace(/\s+/g, '_');
        if (v && !c.pools.some(x => x !== p && x.name === v)) p.name = v;
        nm.value = p.name;
        commit();
      });
      box.querySelector(`[data-pdel="${i}"]`).addEventListener('click', () => { c.pools.splice(i, 1); commit(); });
      binds.push(bindIpInput(box.querySelector(`[data-pgw="${i}"]`), 'ip', () => p.gateway, v => { p.gateway = v; }));
      binds.push(bindIpInput(box.querySelector(`[data-pdns="${i}"]`), 'ip', () => p.dns, v => { p.dns = v; }));
      binds.push(bindIpInput(box.querySelector(`[data-pstart="${i}"]`), 'ip', () => p.start, v => { p.start = v; autoMask(p, v); }));
      binds.push(bindIpInput(box.querySelector(`[data-pmask="${i}"]`), 'mask', () => p.mask, v => { p.mask = v; }));
      const mx = box.querySelector(`[data-pmax="${i}"]`);
      mx.addEventListener('change', () => { p.max = clamp(parseInt(mx.value, 10) || 1, 1, 1000); mx.value = p.max; commit(); });
    });
  };

  return {
    el,
    update() {
      en.checked = c.enabled;
      const s = c.pools.map(p => p.name).join('|');
      if (s !== sig) { sig = s; render(); }
      binds.forEach(b => b.refresh());
      c.pools.forEach((p, i) => {
        const mx = q(`[data-pmax="${i}"]`);
        if (document.activeElement !== mx) mx.value = p.max;
        const w = [];
        const st = IP.parse(p.start), mk = IP.parseMask(p.mask), gw = IP.parse(p.gateway);
        if (!Sim.poolValid(p)) w.push('Pool unvollständig: Start-IP, Subnetzmaske und Anzahl angeben.');
        else {
          if (gw !== null && !IP.sameNet(st, gw, mk)) w.push('Gateway liegt nicht im Subnetz des Pools.');
          const ifs = Sim.l3Ifaces(dev).filter(k => { const f = Sim.portIp(dev, k); return f && IP.sameNet(f.ip, st, mk); });
          if (!ifs.length) w.push('Keine Router-Schnittstelle liegt in diesem Subnetz – der Pool wird nicht verwendet.');
        }
        q(`[data-pw="${i}"]`).innerHTML = warnHtml(w);
      });
      const rows = Model.devices
        .filter(d => Sim.isHost(d) && d.ip.mode === 'dhcp' && d.lease && d.lease.server === dev.id && !d.lease.apipa && !d.lease.released)
        .map(d => `<tr><td>${esc(d.name)}</td><td>${esc(d.lease.ip)}</td><td>${esc(d.lease.pool || '')}</td><td>${esc(Sim.mac(d))}</td></tr>`);
      q('[data-dyn=leases]').innerHTML = rows.length
        ? `<table class="tbl"><thead><tr><th>Client</th><th>IP-Adresse</th><th>Pool</th><th>MAC-Adresse</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
        : '<span class="meta">Noch keine Adressen vergeben.</span>';
    },
  };
}

/* ================= L3-Switch ================= */

function l3IfacePane(dev) {
  const el = makePane(`
    <div data-dyn="iprstate"></div>
    <div data-dyn="dnsrow"></div>
    <fieldset class="box">
      <legend>VLAN-Schnittstellen (SVI)</legend>
      <table class="tbl">
        <thead><tr><th>Schnittstelle</th><th>Status</th><th>IPv4-Adresse</th><th>Subnetzmaske</th><th>aktiv</th><th style="width:36px"></th></tr></thead>
        <tbody data-dyn="svis"></tbody>
      </table>
      <div class="add-row"><select data-new="vlan"></select><button class="btn" data-act="add-svi">SVI anlegen</button></div>
      <div class="warn" data-dyn="sviwarn"></div>
      <p class="meta">Eine SVI (<code>interface Vlan…</code>) ist das Standardgateway der Geräte im VLAN. Sie ist nur „up“,
        wenn das VLAN existiert und mindestens ein Port dieses VLANs aktiv ist.</p>
    </fieldset>
    <fieldset class="box">
      <legend>Geroutete Ports (no switchport)</legend>
      <table class="tbl">
        <thead><tr><th>Port</th><th>Verbunden mit</th><th>IPv4-Adresse</th><th>Subnetzmaske</th></tr></thead>
        <tbody data-dyn="routed"></tbody>
      </table>
      <div class="warn" data-dyn="routedwarn"></div>
    </fieldset>`);
  const q = s => el.querySelector(s);
  const vsel = q('[data-new=vlan]');
  const dnsR = dnsRow(dev);
  q('[data-dyn=dnsrow]').replaceWith(dnsR.row);

  q('[data-act=add-svi]').addEventListener('click', () => {
    const v = Number(vsel.value);
    if (!v || dev.svis.some(s => s.vlan === v)) return;
    dev.svis.push({ vlan: v, ip: '', mask: '', up: true });
    dev.svis.sort((a, b) => a.vlan - b.vlan);
    commit();
  });

  let sig = null, binds = [];
  const routedIdx = () => dev.ports.map((p, i) => (p.mode === 'routed' ? i : null)).filter(i => i !== null);

  const render = () => {
    binds = [];
    const sv = q('[data-dyn=svis]');
    sv.innerHTML = dev.svis.length ? dev.svis.map(s => `<tr>
        <td><b>Vlan${s.vlan}</b></td><td data-st="${s.vlan}"></td>
        <td><input type="text" data-sip="${s.vlan}" spellcheck="false" placeholder="z. B. 192.168.${s.vlan % 256}.1"></td>
        <td><input type="text" data-smask="${s.vlan}" spellcheck="false" placeholder="/24"></td>
        <td><input type="checkbox" data-sup="${s.vlan}" title="no shutdown"></td>
        <td><button class="btn-icon" data-sdel="${s.vlan}" title="SVI löschen">✕</button></td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">Noch keine SVI angelegt.</td></tr>';
    for (const s of dev.svis) {
      binds.push(bindIpInput(sv.querySelector(`[data-sip="${s.vlan}"]`), 'ip', () => s.ip, v => { s.ip = v; autoMask(s, v); }));
      binds.push(bindIpInput(sv.querySelector(`[data-smask="${s.vlan}"]`), 'mask', () => s.mask, v => { s.mask = v; }));
      sv.querySelector(`[data-sup="${s.vlan}"]`).addEventListener('change', e => { s.up = e.target.checked; commit(); });
      sv.querySelector(`[data-sdel="${s.vlan}"]`).addEventListener('click', () => {
        dev.svis = dev.svis.filter(x => x !== s);
        dev.rip.passive = dev.rip.passive.filter(k => k !== 'v' + s.vlan);
        commit();
      });
    }
    const free = dev.vlans.filter(v => !dev.svis.some(s => s.vlan === v.id));
    vsel.innerHTML = free.map(v => `<option value="${v.id}">VLAN ${v.id} – ${esc(v.name)}</option>`).join('')
      || '<option value="">alle VLANs haben bereits eine SVI</option>';
    q('[data-act=add-svi]').disabled = !free.length;

    const rp = q('[data-dyn=routed]');
    const idx = routedIdx();
    rp.innerHTML = idx.length ? idx.map(i => `<tr>
        <td><b>${esc(dev.ports[i].name)}</b></td><td data-peer="${i}"></td>
        <td><input type="text" data-rip="${i}" spellcheck="false" placeholder="z. B. 10.0.0.1"></td>
        <td><input type="text" data-rmask="${i}" spellcheck="false" placeholder="/30"></td></tr>`).join('')
      : '<tr><td colspan="4" class="empty">Keine gerouteten Ports – im Reiter „Ports“ einen Port auf „Routed“ stellen.</td></tr>';
    for (const i of idx) {
      const p = dev.ports[i];
      binds.push(bindIpInput(rp.querySelector(`[data-rip="${i}"]`), 'ip', () => p.ip, v => { p.ip = v; autoMask(p, v); }));
      binds.push(bindIpInput(rp.querySelector(`[data-rmask="${i}"]`), 'mask', () => p.mask, v => { p.mask = v; }));
    }
  };

  const warnFor = keys => warnHtml(keys.flatMap(k => Sim.ifaceWarnings(dev, k).map(w => `${Sim.ifaceName(dev, k)}: ${w}`)));

  return {
    el,
    update() {
      dnsR.update();
      q('[data-dyn=iprstate]').innerHTML = dev.ipRouting
        ? '<div class="note">IP-Routing ist eingeschaltet – der Switch routet zwischen SVIs und gerouteten Ports.</div>'
        : warnHtml(['IP-Routing ist ausgeschaltet (Schalter im Reiter „Routing“) – die SVIs sind erreichbar, es wird aber nicht zwischen den VLANs geroutet.']);
      const s = dev.svis.map(x => x.vlan).join(',') + '|' + routedIdx().join(',') + '|' + vlanSig(dev);
      if (s !== sig) { sig = s; render(); }
      binds.forEach(b => b.refresh());
      for (const sv of dev.svis) {
        const k = 'v' + sv.vlan;
        const td = q(`[data-st="${sv.vlan}"]`);
        const up = Sim.sviLineUp(dev, k);
        td.innerHTML = up ? '<span class="ok-text">up</span>'
          : !sv.up ? '<span class="meta">shutdown</span>'
          : !dev.vlans.some(v => v.id === sv.vlan) ? '<span class="warn">down – VLAN fehlt</span>'
          : '<span class="warn">down – kein aktiver Port im VLAN</span>';
        q(`[data-sup="${sv.vlan}"]`).checked = sv.up;
      }
      for (const i of routedIdx()) q(`[data-peer="${i}"]`).textContent = peerText(dev, i);
      q('[data-dyn=sviwarn]').innerHTML = warnFor(dev.svis.map(x => 'v' + x.vlan));
      q('[data-dyn=routedwarn]').innerHTML = warnFor(routedIdx());
    },
  };
}

/* Reiter je Gerätetyp: [Schlüssel, Beschriftung, Fabrikfunktion] */
const PANELS = {
  pc: [['config', 'Konfiguration', hostConfigPane], ['terminal', 'Terminal', terminalPane]],
  server: [['config', 'Konfiguration', hostConfigPane], ['services', 'DHCP', dhcpServicePane], ['dns', 'DNS', dnsServicePane],
    ['terminal', 'Terminal', terminalPane]],
  switch: [['ports', 'Ports', switchPortsPane], ['vlans', 'VLANs', vlanPane], ['stp', 'Spanning Tree', stpPane]],
  l3switch: [['ports', 'Ports', switchPortsPane], ['vlans', 'VLANs', vlanPane], ['l3', 'SVI / L3', l3IfacePane],
    ['stp', 'Spanning Tree', stpPane], ['routing', 'Routing', routingPane], ['rip', 'RIP', ripPane], ['terminal', 'CLI', terminalPane]],
  router: [['ifaces', 'Schnittstellen', routerIfacePane], ['routing', 'Routing', routingPane], ['rip', 'RIP', ripPane],
    ['dhcp', 'DHCP', routerDhcpPane], ['terminal', 'CLI', terminalPane]],
};
