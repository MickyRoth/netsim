'use strict';

/*
 * Netzwerksimulation.
 *  - Schicht 2: Ausbreitung von Frames über Kabel und Switches unter Beachtung von VLANs
 *    (Access-Ports ungetaggt, Trunk-Ports getaggt mit nativem VLAN 1).
 *  - Schicht 3: Hosts senden ins eigene Subnetz direkt, sonst ans Standardgateway;
 *    Router wählen per Longest-Prefix-Match aus direkt verbundenen und statischen Routen.
 *  - ARP wird implizit simuliert: der Next Hop muss in derselben Broadcast-Domäne erreichbar sein.
 *  - DHCP: Hosts erhalten Adressen von einem DHCP-Server in derselben Broadcast-Domäne.
 */
const Sim = {
  isHost(d) { return d.type === 'pc' || d.type === 'server'; },

  startTtl(d) { return DEVICE_TYPES[d.type].startTtl || 64; },

  /** Effektive IP-Konfiguration eines Hosts (statisch oder per DHCP) als Zahlen, oder null. */
  hostIface(d) {
    if (!this.isHost(d)) return null;
    const src = d.ip.mode === 'dhcp' ? d.lease : d.ip;
    if (!src) return null;
    const ip = IP.parse(src.ip || ''), mask = IP.parseMask(src.mask || '');
    if (ip === null || mask === null) return null;
    const gw = IP.parse(src.gateway || '');
    return { ip, mask, gw };
  },

  portUp(d, i) { return d.type === 'router' ? !!d.ports[i].up : true; },

  peer(d, i) {
    const l = Model.linkAt(d.id, i);
    if (!l) return null;
    const o = Model.peerOf(l, d.id, i);
    const od = Model.get(o.dev);
    return od ? { dev: od, port: o.port, link: l } : null;
  },

  /** Kabel gesteckt und beide Seiten aktiv. */
  portActive(d, i) {
    const p = this.peer(d, i);
    return !!p && this.portUp(d, i) && this.portUp(p.dev, p.port);
  },

  /** IP/Maske einer Schnittstelle oder null. */
  portIp(d, i) {
    if (this.isHost(d)) {
      const f = this.hostIface(d);
      return f && i === 0 ? { ip: f.ip, mask: f.mask } : null;
    }
    if (d.type === 'router') {
      const p = d.ports[i];
      if (!p || !p.up) return null;
      const ip = IP.parse(p.ip || ''), mask = IP.parseMask(p.mask || '');
      return ip !== null && mask !== null ? { ip, mask } : null;
    }
    return null;
  },

  /** Ist ip eine (aktive) Adresse dieses Geräts? */
  owns(d, ip) {
    return d.ports.some((_, i) => {
      const f = this.portIp(d, i);
      return f && f.ip === ip && (this.isHost(d) || this.portActive(d, i));
    });
  },

  /**
   * Alle Schicht-3-Endpunkte (Hosts/Router-Ports), die ein ungetaggter Frame erreicht,
   * der von (dev, portIdx) gesendet wird. Liefert je Endpunkt den Weg (hops) für die Animation.
   */
  l2Reach(dev, portIdx) {
    const result = [];
    const visited = new Set();
    const queue = [];

    const cross = (fromDev, fromPort, tag, hops) => {
      if (!this.portUp(fromDev, fromPort)) return;
      const p = this.peer(fromDev, fromPort);
      if (!p || !this.portUp(p.dev, p.port)) return;
      const nh = hops.concat([{ link: p.link.id, from: fromDev.id, to: p.dev.id }]);
      if (p.dev.type === 'switch') {
        const sp = p.dev.ports[p.port];
        let vlan;
        if (sp.mode === 'trunk') vlan = tag == null ? 1 : tag;
        else {
          if (tag != null) return; // getaggter Frame an Access-Port wird verworfen
          vlan = sp.vlan;
        }
        if (!p.dev.vlans.some(v => v.id === vlan)) return;
        const key = p.dev.id + ':' + vlan;
        if (visited.has(key)) return;
        visited.add(key);
        queue.push({ sw: p.dev, vlan, inPort: p.port, hops: nh });
      } else {
        if (tag != null) return; // Endgeräte/Router verstehen keine VLAN-Tags
        if (p.dev.id === dev.id && p.port === portIdx) return;
        result.push({ dev: p.dev, port: p.port, hops: nh });
      }
    };

    cross(dev, portIdx, null, []);
    while (queue.length) {
      const { sw, vlan, inPort, hops } = queue.shift();
      sw.ports.forEach((sp, i) => {
        if (i === inPort) return;
        if (sp.mode !== 'trunk' && sp.vlan !== vlan) return;
        const tag = sp.mode === 'trunk' && vlan !== 1 ? vlan : null;
        cross(sw, i, tag, hops);
      });
    }
    return result;
  },

  /* ---------------- Routing ---------------- */

  /** Routen eines Routers: direkt verbundene (C) und statische (S). */
  routes(r) {
    const list = [];
    r.ports.forEach((p, i) => {
      const f = this.portIp(r, i);
      if (f && this.portActive(r, i)) {
        list.push({ code: 'C', net: IP.network(f.ip, f.mask), mask: f.mask, port: i, ip: f.ip });
      }
    });
    for (const s of r.routes) {
      const net = IP.parse(s.network), mask = IP.parseMask(s.mask), nh = IP.parse(s.nextHop);
      if (net === null || mask === null || nh === null) continue;
      list.push({ code: 'S', net: IP.network(net, mask), mask, nextHop: nh });
    }
    return list;
  },

  /** Longest-Prefix-Match. Liefert { port, nextHop, code } oder null. */
  lookup(r, dst, depth = 0) {
    if (depth > 4) return null;
    let best = null, bestLen = -1;
    for (const e of this.routes(r)) {
      if (IP.network(dst, e.mask) !== e.net) continue;
      const len = IP.prefixLen(e.mask);
      if (len < bestLen || (len === bestLen && !(e.code === 'C' && best.code === 'S'))) continue;
      let cand;
      if (e.code === 'C') {
        cand = { port: e.port, nextHop: dst, code: 'C' };
      } else {
        const via = this.lookup(r, e.nextHop, depth + 1); // rekursive Auflösung des Next Hops
        if (!via) continue;
        cand = { port: via.port, nextHop: via.code === 'C' ? e.nextHop : via.nextHop, code: 'S' };
      }
      best = cand;
      bestLen = len;
    }
    return best;
  },

  /**
   * Sendet ein IP-Paket von src an dst (Zahl) und verfolgt es Hop für Hop.
   * status: ok | timeout | unreach | noroute | ttl | noip | nogw
   */
  forward(src, dst, ttl) {
    let cur = src, inPort = null, hops = [], srcIp = null;
    for (let step = 0; step < 64; step++) {
      const first = step === 0;
      if (this.owns(cur, dst)) {
        return { status: 'ok', dev: cur, ttl, hops, srcIp: srcIp === null ? dst : srcIp, local: first };
      }
      let outPort, nh;
      if (this.isHost(cur)) {
        if (!first) return { status: 'timeout', dev: cur, hops, srcIp }; // Hosts leiten nicht weiter
        const f = this.hostIface(cur);
        if (!f) return { status: 'noip', dev: cur, hops };
        srcIp = f.ip;
        outPort = 0;
        if (IP.sameNet(dst, f.ip, f.mask)) nh = dst;
        else if (f.gw !== null && IP.sameNet(f.gw, f.ip, f.mask)) nh = f.gw;
        else return { status: 'nogw', dev: cur, hops, srcIp };
      } else if (cur.type === 'router') {
        if (!first) {
          ttl--;
          if (ttl <= 0) return { status: 'ttl', dev: cur, from: this.ingressIp(cur, inPort), hops, srcIp };
        }
        const r = this.lookup(cur, dst);
        if (!r) {
          return first
            ? { status: 'noroute', dev: cur, hops }
            : { status: 'unreach', dev: cur, from: this.ingressIp(cur, inPort), hops, srcIp };
        }
        outPort = r.port;
        nh = r.nextHop;
        if (first) srcIp = this.portIp(cur, outPort).ip;
      } else {
        return { status: 'timeout', dev: cur, hops, srcIp };
      }
      const target = this.l2Reach(cur, outPort).find(e => {
        const f = this.portIp(e.dev, e.port);
        return f && f.ip === nh;
      });
      if (!target) return { status: 'timeout', dev: cur, hops, srcIp, arpFail: true };
      hops = hops.concat(target.hops);
      cur = target.dev;
      inPort = target.port;
    }
    return { status: 'timeout', dev: cur, hops, srcIp };
  },

  ingressIp(d, port) {
    const f = port == null ? null : this.portIp(d, port);
    return f ? f.ip : null;
  },

  /** Echo-Request + Echo-Reply (optional animiert). */
  async ping(src, dst, animate) {
    const req = this.forward(src, dst, this.startTtl(src));
    if (animate) {
      await Canvas.animatePacket(req.hops, '#f5b301');
      if (req.status !== 'ok') Canvas.flashMark(req.dev || src, false);
    }
    if (req.status !== 'ok') return req;
    if (req.local) return { status: 'ok', ttl: this.startTtl(src), time: 0 };
    const rep = this.forward(req.dev, req.srcIp, this.startTtl(req.dev));
    const ok = rep.status === 'ok' && rep.dev === src;
    if (animate) {
      await Canvas.animatePacket(rep.hops, '#2fbf71');
      Canvas.flashMark(ok ? src : (rep.dev || req.dev), ok);
    }
    if (!ok) return { status: 'timeout' };
    return { status: 'ok', ttl: rep.ttl, time: Math.max(0, this.startTtl(req.dev) - rep.ttl) };
  },

  /* ---------------- DHCP ---------------- */

  poolValid(s) {
    const c = s.dhcp;
    return c && IP.parse(c.start) !== null && IP.parseMask(c.mask) !== null && Number(c.max) > 0;
  },

  dhcpServers(d) {
    return this.l2Reach(d, 0).map(e => e.dev)
      .filter(s => s.type === 'server' && s.dhcp.enabled && this.poolValid(s));
  },

  usedIps(exceptId) {
    const used = new Set();
    for (const d of Model.devices) {
      if (d.id === exceptId) continue;
      if (this.isHost(d)) {
        const f = this.hostIface(d);
        if (f) used.add(f.ip);
      } else if (d.type === 'router') {
        for (const p of d.ports) { const ip = IP.parse(p.ip || ''); if (ip !== null) used.add(ip); }
      }
    }
    return used;
  },

  dhcpRequest(d) {
    const srv = this.dhcpServers(d)[0];
    if (!srv) {
      d.lease = this.apipa(d);
      return { ok: false, reason: 'noserver' };
    }
    const c = srv.dhcp;
    const start = IP.parse(c.start), mask = IP.parseMask(c.mask), max = Math.floor(Number(c.max));
    const used = this.usedIps(d.id);
    const inPool = x => x >= start && x < start + max && IP.sameNet(x, start, mask) && IP.isHostAddr(x, mask);
    let ip = null;
    const prev = IP.parse(c.leases[d.id] || '');
    if (prev !== null && inPool(prev) && !used.has(prev)) ip = prev;
    for (let k = 0; ip === null && k < max; k++) {
      const x = (start + k) >>> 0;
      if (inPool(x) && !used.has(x)) ip = x;
    }
    if (ip === null) {
      d.lease = this.apipa(d);
      return { ok: false, reason: 'full', server: srv };
    }
    for (const id of Object.keys(c.leases)) if (!Model.get(id)) delete c.leases[id];
    c.leases[d.id] = IP.str(ip);
    d.lease = { ip: IP.str(ip), mask: IP.str(mask), gateway: IP.valid(c.gateway) ? c.gateway : '', server: srv.id };
    return { ok: true, server: srv };
  },

  /** Lease zurückgeben. released=true: wie "ipconfig /release" (keine automatische Neuanfrage). */
  release(d, released = false) {
    for (const s of Model.devices) if (s.dhcp) delete s.dhcp.leases[d.id];
    d.lease = released ? { ip: '', mask: '', gateway: '', released: true } : null;
  },

  apipa(d) {
    const n = parseInt(d.id.replace(/\D/g, ''), 10) || 1;
    return { ip: `169.254.${(n * 37) % 254 + 1}.${(n * 91) % 253 + 2}`, mask: '255.255.0.0', gateway: '', apipa: true };
  },

  /** DHCP-Clients ohne gültige Adresse versuchen es nach jeder Änderung automatisch erneut. */
  autoDhcp() {
    for (const d of Model.devices) {
      if (this.isHost(d) && d.ip.mode === 'dhcp' && (!d.lease || d.lease.apipa)) this.dhcpRequest(d);
    }
  },

  /* ---------------- Hilfen für die Oberfläche ---------------- */

  mac(d) {
    const n = parseInt(d.id.replace(/\D/g, ''), 10) || 0;
    const h = (Math.imul(n + 7, 2654435761) >>> 0).toString(16).padStart(8, '0');
    return `00E0.${h.slice(0, 4)}.${h.slice(4, 8)}`.toUpperCase();
  },

  ipUsers(ip, except) {
    const names = [];
    for (const d of Model.devices) {
      if (d === except) continue;
      if (this.isHost(d)) {
        const f = this.hostIface(d);
        if (f && f.ip === ip) names.push(d.name);
      } else if (d.type === 'router') {
        d.ports.forEach(p => { if (IP.parse(p.ip || '') === ip) names.push(`${d.name} ${p.name}`); });
      }
    }
    return names;
  },

  hostWarnings(d) {
    const w = [];
    const src = d.ip.mode === 'dhcp' ? d.lease : d.ip;
    if (!src || !src.ip) {
      if (d.ip.mode === 'static') w.push('Keine IP-Adresse konfiguriert.');
      return w;
    }
    const ip = IP.parse(src.ip), mask = IP.parseMask(src.mask || '');
    if (ip === null) return w;
    if (mask === null) { w.push('Subnetzmaske fehlt.'); return w; }
    if (!IP.isHostAddr(ip, mask)) w.push('Die IP-Adresse ist die Netz- oder Broadcastadresse des Subnetzes.');
    const gw = IP.parse(src.gateway || '');
    if (gw === null) w.push('Kein Standardgateway – nur das eigene Subnetz ist erreichbar.');
    else if (!IP.sameNet(ip, gw, mask)) w.push('Das Standardgateway liegt nicht im eigenen Subnetz.');
    const others = this.ipUsers(ip, d);
    if (others.length) w.push('IP-Adresse doppelt vergeben: ' + others.join(', '));
    return w;
  },

  routerPortWarnings(r, i) {
    const w = [];
    const p = r.ports[i];
    const ip = IP.parse(p.ip || ''), mask = IP.parseMask(p.mask || '');
    if (ip === null) return w;
    if (mask === null) { w.push('Subnetzmaske fehlt.'); return w; }
    if (!IP.isHostAddr(ip, mask)) w.push('Netz- oder Broadcastadresse ist als Schnittstellenadresse ungültig.');
    r.ports.forEach((q, j) => {
      if (j === i) return;
      const qi = IP.parse(q.ip || ''), qm = IP.parseMask(q.mask || '');
      if (qi === null || qm === null) return;
      const m = IP.fromPrefix(Math.min(IP.prefixLen(mask), IP.prefixLen(qm)));
      if (IP.sameNet(ip, qi, m)) w.push(`Subnetz überschneidet sich mit ${q.name}.`);
    });
    const others = this.ipUsers(ip, r);
    if (others.length) w.push('IP-Adresse doppelt vergeben: ' + others.join(', '));
    return w;
  },

  /**
   * Statische Route aus Text lesen:
   *   "192.168.1.0/24 via 192.168.2.254", "192.168.1.0 255.255.255.0 192.168.2.254",
   *   "ip route 192.168.1.0 255.255.255.0 192.168.2.254"
   */
  parseRoute(text) {
    const t = String(text).trim().replace(/\s+/g, ' ').replace(/^ip route /i, '');
    let m = t.match(/^(\S+?) ?\/ ?(\d{1,2}) (?:via )?(\S+)$/i);
    let net, mask, nh;
    if (m) { net = m[1]; mask = m[2]; nh = m[3]; }
    else {
      m = t.match(/^(\S+) (\S+) (?:via )?(\S+)$/i);
      if (!m) return { error: 'Format nicht erkannt. Beispiel: 192.168.1.0/24 via 192.168.2.254' };
      net = m[1]; mask = m[2]; nh = m[3];
    }
    const n = IP.parse(net), mk = IP.parseMask(mask), h = IP.parse(nh);
    if (n === null) return { error: `Ungültige Netzadresse: ${net}` };
    if (mk === null) return { error: `Ungültige Maske/Präfixlänge: ${mask}` };
    if (h === null) return { error: `Ungültiger Next Hop: ${nh}` };
    return { route: { network: IP.str(IP.network(n, mk)), mask: IP.str(mk), nextHop: IP.str(h) } };
  },
};
