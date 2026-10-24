'use strict';

/*
 * Gerätetypen. Neue Geräte werden hier ergänzt (Größe, Anschlüsse, Standardwerte in Model.defaults,
 * Symbol in icons.js, Konfigurationsreiter in windows.js).
 * Portkoordinaten sind relativ zur linken oberen Ecke des Geräts.
 */
const SWITCH_W = 140, SWITCH_H = 40;

/** 8 Switchports wie auf der Front eines Cisco-Switches: ungerade Ports oben, gerade unten. */
function switchPorts() {
  return Array.from({ length: 8 }, (_, i) => ({
    name: 'Fa0/' + (i + 1),
    x: 62 + Math.floor(i / 2) * 20,
    y: i % 2 === 0 ? 0 : SWITCH_H,
  }));
}

const DEVICE_TYPES = {
  pc: {
    label: 'PC', sub: '', prefix: 'PC', w: 60, h: 56, startTtl: 128,
    ports: [{ name: 'Fa0', x: 30, y: 2 }],
  },
  server: {
    label: 'Server', sub: '', prefix: 'Server', w: 52, h: 68, startTtl: 128,
    ports: [{ name: 'Fa0', x: 26, y: 2 }],
  },
  switch: {
    label: 'Switch (L2)', sub: '8 Port', prefix: 'Switch', w: SWITCH_W, h: SWITCH_H,
    ports: switchPorts(),
  },
  l3switch: {
    label: 'Switch (L3)', sub: '8 Port · Routing', prefix: 'L3-Switch', w: SWITCH_W, h: SWITCH_H, startTtl: 255,
    ports: switchPorts(),
  },
  router: {
    label: 'Router', sub: '4 Port', prefix: 'Router', w: 84, h: 56, startTtl: 255,
    ports: [
      { name: 'Gi0/0', x: 2, y: 30 },    // links
      { name: 'Gi0/1', x: 82, y: 30 },   // rechts
      { name: 'Gi0/2', x: 26, y: 53 },   // unten links
      { name: 'Gi0/3', x: 58, y: 53 },   // unten rechts
    ],
  },
};

function longPortName(n) {
  return String(n).replace(/^Fa/, 'FastEthernet').replace(/^Gi/, 'GigabitEthernet');
}

const NOTE_DEFAULTS = { color: '#1f2933', size: 16, bold: false, italic: false };

const Model = {
  devices: [],
  links: [],
  notes: [],   // Textfelder auf der Arbeitsfläche
  seq: 1,
  listeners: [],

  newId(prefix) { return prefix + (this.seq++); },

  get(id) { return this.devices.find(d => d.id === id) || null; },

  nextName(type) {
    const p = DEVICE_TYPES[type].prefix;
    const names = new Set(this.devices.map(d => d.name));
    let n = 1; // bewusst ab 1 (Cisco Packet Tracer beginnt bei 0)
    while (names.has(p + n)) n++;
    return p + n;
  },

  defaults(type) {
    const t = DEVICE_TYPES[type];
    const ipCfg = () => ({ mode: 'static', ip: '', mask: '', gateway: '', dns: '' });
    switch (type) {
      case 'pc':
        return { ip: ipCfg(), lease: null, ports: [{ name: 'Fa0' }] };
      case 'server':
        return {
          ip: ipCfg(), lease: null, ports: [{ name: 'Fa0' }],
          dhcp: { enabled: false, gateway: '', dns: '', start: '192.168.1.100', mask: '255.255.255.0', max: 50, leases: {} },
          dns: { enabled: false, records: [] },  // DNS-Dienst: { name, ip }
        };
      case 'switch':
        return {
          stp: { enabled: true, priority: 32768 },
          vlans: [{ id: 1, name: 'default' }],
          ports: t.ports.map(p => ({ name: p.name, mode: 'access', vlan: 1 })),
        };
      case 'l3switch':
        return {
          stp: { enabled: true, priority: 32768 },
          vlans: [{ id: 1, name: 'default' }],
          ports: t.ports.map(p => ({ name: p.name, mode: 'access', vlan: 1, ip: '', mask: '' })),
          svis: [],          // VLAN-Schnittstellen: { vlan, ip, mask, up }
          dns: '',           // ip name-server
          ipRouting: false,  // wie bei Cisco standardmäßig aus
          routes: [],
          rip: { enabled: false, networks: [], passive: [], defaultOriginate: false },
        };
      case 'router':
        return {
          ports: t.ports.map(p => ({ name: p.name, ip: '', mask: '', up: true })),
          subifs: [],        // Subinterfaces (802.1Q): { port, vlan, ip, mask }
          dhcpd: { enabled: false, pools: [] },  // DHCP-Server: Pools wie beim Server
          dns: '',           // ip name-server
          routes: [],
          rip: { enabled: false, networks: [], passive: [], defaultOriginate: false },
        };
    }
    throw new Error('Unbekannter Gerätetyp: ' + type);
  },

  addDevice(type, x, y) {
    const d = Object.assign(
      { id: this.newId('d'), type, name: this.nextName(type), x: Math.round(x), y: Math.round(y) },
      this.defaults(type));
    this.devices.push(d);
    this.changed('add');
    return d;
  },

  removeDevice(id) {
    this.links = this.links.filter(l => l.a.dev !== id && l.b.dev !== id);
    this.devices = this.devices.filter(d => d.id !== id);
    for (const pool of Sim.allPools()) delete pool.leases[id];
    this.changed('remove');
  },

  linkAt(devId, port) {
    return this.links.find(l =>
      (l.a.dev === devId && l.a.port === port) || (l.b.dev === devId && l.b.port === port)) || null;
  },

  /** Gegenstelle eines Kabels aus Sicht von (devId, port). */
  peerOf(link, devId, port) {
    return (link.a.dev === devId && link.a.port === port) ? link.b : link.a;
  },

  addLink(a, ap, b, bp) {
    const da = this.get(a), db = this.get(b);
    if (!da || !db) return { error: 'Gerät nicht gefunden.' };
    if (a === b) return { error: 'Ein Gerät kann nicht mit sich selbst verbunden werden.' };
    if (this.linkAt(a, ap)) return { error: `${da.name} ${da.ports[ap].name} ist bereits belegt.` };
    if (this.linkAt(b, bp)) return { error: `${db.name} ${db.ports[bp].name} ist bereits belegt.` };
    const link = { id: this.newId('l'), a: { dev: a, port: ap }, b: { dev: b, port: bp } };
    this.links.push(link);
    this.changed('link');
    return { link };
  },

  removeLink(id) {
    this.links = this.links.filter(l => l.id !== id);
    this.changed('unlink');
  },

  getNote(id) { return this.notes.find(n => n.id === id) || null; },

  addNote(x, y, text = 'Text') {
    const n = Object.assign({ id: this.newId('n'), x: Math.round(x), y: Math.round(y), text }, NOTE_DEFAULTS);
    this.notes.push(n);
    this.changed('add');
    return n;
  },

  removeNote(id) {
    this.notes = this.notes.filter(n => n.id !== id);
    this.changed('remove');
  },

  onChange(fn) { this.listeners.push(fn); },

  /** Nach jeder Änderung aufrufen: aktualisiert DHCP und benachrichtigt die Oberfläche. */
  changed(kind) {
    Sim.invalidate(kind);
    Sim.autoDhcp();
    Sim.ripData(); // RIP-Updates ggf. anstoßen
    for (const fn of this.listeners) fn(kind);
  },

  serialize() {
    return { format: 'netsim', version: 1, devices: this.devices, links: this.links, notes: this.notes };
  },

  /** Lädt ein (z. B. aus JSON gelesenes) Netzwerk. Fehlende Felder werden mit Standardwerten ergänzt. */
  load(data, kind = 'load') {
    if (!data || data.format !== 'netsim' || !Array.isArray(data.devices) || !Array.isArray(data.links)) {
      throw new Error('Keine gültige NetSim-Datei.');
    }
    const devices = [];
    const ids = new Set();
    for (const raw of data.devices) {
      if (!raw || !DEVICE_TYPES[raw.type] || typeof raw.id !== 'string' || ids.has(raw.id)) continue;
      const def = this.defaults(raw.type);
      const d = {
        id: raw.id, type: raw.type,
        name: String(raw.name || DEVICE_TYPES[raw.type].prefix),
        x: Number(raw.x) || 0, y: Number(raw.y) || 0,
      };
      const rawPorts = Array.isArray(raw.ports) ? raw.ports : [];
      d.ports = def.ports.map((p, i) => Object.assign({}, p, rawPorts[i] || {}, { name: p.name }));
      if (def.ip) {
        d.ip = Object.assign(def.ip, raw.ip);
        d.lease = raw.lease && typeof raw.lease === 'object' ? Object.assign({}, raw.lease) : null;
      }
      if (def.dhcp) {
        d.dhcp = Object.assign(def.dhcp, raw.dhcp);
        const z = raw.dns && typeof raw.dns === 'object' ? raw.dns : {};
        d.dns = {
          enabled: !!z.enabled,
          records: (Array.isArray(z.records) ? z.records : [])
            .filter(r => r && r.name && IP.valid(String(r.ip)))
            .map(r => ({ name: String(r.name).toLowerCase(), ip: String(r.ip) })),
        };
        d.dhcp.leases = Object.assign({}, raw.dhcp && raw.dhcp.leases);
      }
      if (def.vlans) {
        d.vlans = (Array.isArray(raw.vlans) ? raw.vlans : [])
          .filter(v => v && Number.isInteger(v.id) && v.id >= 1 && v.id <= 4094)
          .map(v => ({ id: v.id, name: String(v.name || '') }));
        if (!d.vlans.some(v => v.id === 1)) d.vlans.unshift({ id: 1, name: 'default' });
        d.vlans.sort((a, b) => a.id - b.id);
        for (const p of d.ports) {
          if (p.mode !== 'trunk' && !(d.type === 'l3switch' && p.mode === 'routed')) p.mode = 'access';
          if (!d.vlans.some(v => v.id === p.vlan)) p.vlan = 1;
        }
      }
      if (def.stp) {
        const s = raw.stp || {};
        const prio = Number(s.priority);
        d.stp = {
          enabled: s.enabled !== false,
          priority: Number.isInteger(prio) && prio >= 0 && prio <= 61440 && prio % 4096 === 0 ? prio : 32768,
        };
      }
      if (def.rip) {
        const s = raw.rip || {};
        const nets = (Array.isArray(s.networks) ? s.networks : [])
          .map(n => { const ip = IP.parse(String(n)); const c = ip === null ? null : IP.classfulNet(ip); return c === null ? null : IP.str(c); })
          .filter(Boolean);
        d.rip = {
          enabled: !!s.enabled,
          networks: [...new Set(nets)],
          passive: (Array.isArray(s.passive) ? s.passive : [])
            .filter(i => (Number.isInteger(i) && i >= 0 && i < d.ports.length) || /^(v\d{1,4}|\d\.\d{1,4})$/.test(i)),
          defaultOriginate: !!s.defaultOriginate,
        };
      }
      if (def.subifs) {
        const seen = new Set();
        d.subifs = (Array.isArray(raw.subifs) ? raw.subifs : [])
          .filter(s => s && Number.isInteger(s.port) && s.port >= 0 && s.port < d.ports.length &&
            Number.isInteger(s.vlan) && s.vlan >= 1 && s.vlan <= 4094 && !seen.has(s.port + '.' + s.vlan) && seen.add(s.port + '.' + s.vlan))
          .map(s => ({ port: s.port, vlan: s.vlan, ip: String(s.ip || ''), mask: String(s.mask || '') }))
          .sort((a, b) => (a.port - b.port) || (a.vlan - b.vlan));
      }
      if (def.dhcpd) {
        const s = raw.dhcpd || {};
        d.dhcpd = {
          enabled: !!s.enabled,
          pools: (Array.isArray(s.pools) ? s.pools : []).filter(p => p && typeof p === 'object').map(p => ({
            name: String(p.name || 'LAN'), gateway: String(p.gateway || ''), dns: String(p.dns || ''), start: String(p.start || ''),
            mask: String(p.mask || ''), max: clamp(parseInt(p.max, 10) || 50, 1, 1000),
            leases: Object.assign({}, p.leases),
          })),
        };
      }
      if (def.svis) {
        const seen = new Set();
        d.svis = (Array.isArray(raw.svis) ? raw.svis : [])
          .filter(s => s && Number.isInteger(s.vlan) && s.vlan >= 1 && s.vlan <= 4094 && !seen.has(s.vlan) && seen.add(s.vlan))
          .map(s => ({ vlan: s.vlan, ip: String(s.ip || ''), mask: String(s.mask || ''), up: s.up !== false }))
          .sort((a, b) => a.vlan - b.vlan);
        d.ipRouting = !!raw.ipRouting;
      }
      if (typeof def.dns === 'string') d.dns = IP.valid(String(raw.dns || '')) ? String(raw.dns) : '';
      if (def.routes) {
        d.routes = (Array.isArray(raw.routes) ? raw.routes : []).map(r => ({
          network: String(r.network || ''), mask: String(r.mask || ''), nextHop: String(r.nextHop || ''),
        }));
      }
      ids.add(d.id);
      devices.push(d);
    }

    const links = [];
    const usedPorts = new Set();
    const okEnd = e => e && ids.has(e.dev) && Number.isInteger(e.port) &&
      e.port >= 0 && e.port < DEVICE_TYPES[devices.find(d => d.id === e.dev).type].ports.length &&
      !usedPorts.has(e.dev + ':' + e.port);
    for (const l of data.links) {
      if (!l || typeof l.id !== 'string' || !okEnd(l.a) || !okEnd(l.b) || l.a.dev === l.b.dev) continue;
      usedPorts.add(l.a.dev + ':' + l.a.port);
      usedPorts.add(l.b.dev + ':' + l.b.port);
      links.push({ id: l.id, a: { dev: l.a.dev, port: l.a.port }, b: { dev: l.b.dev, port: l.b.port } });
    }

    const notes = (Array.isArray(data.notes) ? data.notes : [])
      .filter(n => n && typeof n.id === 'string')
      .map(n => ({
        id: n.id, x: Number(n.x) || 0, y: Number(n.y) || 0,
        text: String(n.text == null ? '' : n.text),
        color: /^#[0-9a-f]{6}$/i.test(n.color) ? n.color : NOTE_DEFAULTS.color,
        size: clamp(Number(n.size) || NOTE_DEFAULTS.size, 8, 96),
        bold: !!n.bold, italic: !!n.italic,
      }));

    this.devices = devices;
    this.links = links;
    this.notes = notes;
    let max = 0;
    for (const o of [...devices, ...links, ...notes]) {
      const n = parseInt(String(o.id).replace(/\D/g, ''), 10);
      if (n > max) max = n;
    }
    this.seq = max + 1;
    this.changed(kind);
  },
};
