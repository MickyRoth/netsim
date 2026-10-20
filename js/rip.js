'use strict';

/*
 * RIP Version 2 (Distanzvektor-Routing), Erweiterung von Sim.
 *  - network-Einträge klassenbasiert wie bei Cisco; erfasste Schnittstellen senden/empfangen Updates
 *  - Router tauschen Routen in Runden aus (RIP_INTERVAL je Runde) → n Hops entfernte Netze
 *    erscheinen nach n Runden; verschwundene Netze werden ebenso Hop für Hop entfernt
 *  - Metrik = Hops, 16 = unerreichbar, Split Horizon, administrative Distanz 120
 *  - automatische Zusammenfassung ist aus (no auto-summary)
 */
Object.assign(Sim, {
  RIP_INTERVAL: 5000,
  RIP_INFINITY: 16,
  _rip: null,
  _ripCur: new Map(),   // Router-ID → Map("netz/präfix" → Route): aktueller (gelernter) Zustand
  _ripSettle: true,
  _ripTimer: null,
  _ripRounds: 0,
  _ripBusy: false,

  ripOn(d) { return this.isRouterLike(d) && this.routingOn(d) && !!d.rip && d.rip.enabled; },

  /** Wird Router-Schnittstelle i von einem network-Eintrag erfasst? */
  ripCovers(r, i) {
    const f = this.portIp(r, i);
    if (!f) return false;
    const cn = IP.classfulNet(f.ip);
    return cn !== null && r.rip.networks.includes(IP.str(cn));
  },

  ripIfaces(r) {
    return this.l3Ifaces(r).filter(i => this.portActive(r, i) && this.ripCovers(r, i));
  },

  /** Wer empfängt wessen Updates? (gleiches Netzsegment und Subnetz, Absender nicht passiv) */
  ripEdges() {
    const edges = [];
    for (const R of Model.devices) {
      if (!this.ripOn(R)) continue;
      for (const i of this.ripIfaces(R)) {
        if (R.rip.passive.includes(i)) continue;
        const fi = this.portIp(R, i);
        const reach = this.l2Reach(R, i);
        if (reach.loop) continue; // Broadcast-Sturm: Updates gehen unter
        for (const e of reach) {
          if (e.dev === R || !this.ripOn(e.dev) || !this.ripIfaces(e.dev).includes(e.port)) continue;
          const fe = this.portIp(e.dev, e.port);
          if (!IP.sameNet(fi.ip, fe.ip, fe.mask)) continue;
          edges.push({ from: R, fromPort: i, to: e.dev, toPort: e.port, nh: fi.ip });
        }
      }
    }
    return edges;
  },

  /** Hat der Router für dieses Präfix eine bessere Route (direkt verbunden oder statisch)? */
  ripSuperseded(r, net, mask) {
    const direct = h => this.l3Ifaces(r).some(i => {
      const f = this.portIp(r, i);
      return f && this.portActive(r, i) && IP.sameNet(h, f.ip, f.mask);
    });
    for (const i of this.l3Ifaces(r)) {
      const f = this.portIp(r, i);
      if (f && this.portActive(r, i) && f.mask === mask && IP.network(f.ip, f.mask) === net) return true;
    }
    for (const s of r.routes) {
      const n = IP.parse(s.network), m = IP.parseMask(s.mask), h = IP.parse(s.nextHop);
      if (n !== null && m === mask && h !== null && IP.network(n, m) === net && direct(h)) return true;
    }
    return false;
  },

  /** Inhalt eines Updates, das Router R über Schnittstelle port sendet. */
  ripAdverts(R, port, cur) {
    const out = [];
    for (const i of this.ripIfaces(R)) {
      const f = this.portIp(R, i);
      out.push({ net: IP.network(f.ip, f.mask), mask: f.mask, metric: 0 });
    }
    if (R.rip.defaultOriginate) out.push({ net: 0, mask: 0, metric: 0 });
    const t = cur.get(R.id);
    if (t) {
      for (const e of t.values()) {
        if (e.port === port) continue;                       // Split Horizon
        if (this.ripSuperseded(R, e.net, e.mask)) continue;  // nur installierte RIP-Routen
        out.push({ net: e.net, mask: e.mask, metric: e.metric });
      }
    }
    return out;
  },

  /** Eine Update-Runde: jeder Router lernt aus den Updates seiner Nachbarn (Zustand prev). */
  ripRound(prev, edges, filter) {
    const next = new Map();
    for (const S of Model.devices) {
      if (!this.ripOn(S)) continue;
      const t = new Map();
      const conn = new Set();
      for (const i of this.l3Ifaces(S)) {
        const f = this.portIp(S, i);
        if (f && this.portActive(S, i)) conn.add(IP.network(f.ip, f.mask) + '/' + IP.prefixLen(f.mask));
      }
      const old = prev.get(S.id) || new Map();
      const allowed = filter ? (filter.get(S.id) || new Map()) : null;
      for (const e of edges) {
        if (e.to !== S) continue;
        for (const a of this.ripAdverts(e.from, e.fromPort, prev)) {
          const metric = a.metric + 1;
          if (metric >= this.RIP_INFINITY) continue;
          const key = a.net + '/' + IP.prefixLen(a.mask);
          if (conn.has(key)) continue;
          // Für Netze, die nach der Änderung nicht mehr erreichbar sind, wird nur die bisherige
          // Route vom selben Next Hop aufgefrischt, aber kein neuer Weg gelernt (vereinfachtes
          // Holddown): die Route verschwindet Hop für Hop, ohne Count-to-Infinity.
          if (allowed && !allowed.has(key)) {
            const p = old.get(key);
            if (!p || p.nextHop !== e.nh) continue;
          }
          const cand = { net: a.net, mask: a.mask, metric, nextHop: e.nh, port: e.toPort, via: e.from.id };
          const cur = t.get(key);
          if (!cur || metric < cur.metric || (metric === cur.metric && this.ripPrefer(cand, cur, old.get(key)))) {
            t.set(key, cand);
          }
        }
      }
      next.set(S.id, t);
    }
    return next;
  },

  /** Bei gleicher Metrik: bisherigen Next Hop behalten, sonst den kleineren. */
  ripPrefer(a, b, prevEntry) {
    if (prevEntry) {
      if (a.nextHop === prevEntry.nextHop) return true;
      if (b.nextHop === prevEntry.nextHop) return false;
    }
    return a.nextHop < b.nextHop;
  },

  ripEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const [id, ta] of a) {
      const tb = b.get(id);
      if (!tb || tb.size !== ta.size) return false;
      for (const [k, e] of ta) {
        const f = tb.get(k);
        if (!f || f.metric !== e.metric || f.nextHop !== e.nextHop) return false;
      }
    }
    return true;
  },

  /** Nachbarschaften und Zielzustand berechnen; Update-Runden anstoßen, solange nicht konvergiert. */
  ripData() {
    if (this._rip) return this._rip;
    const edges = this.ripEdges();
    let target = new Map();
    for (let k = 0; k < this.RIP_INFINITY + 4; k++) {
      const n = this.ripRound(target, edges, null);
      if (this.ripEqual(n, target)) break;
      target = n;
    }

    // Laufzustand an die aktuelle Topologie anpassen: Routen über ausgefallene
    // oder nicht mehr erfasste Schnittstellen verschwinden sofort.
    const src = this._ripSettle ? target : this._ripCur;
    const cur = new Map();
    for (const R of Model.devices) {
      if (!this.ripOn(R)) continue;
      const t = new Map();
      for (const [k, e] of (src.get(R.id) || new Map())) {
        if (this.portActive(R, e.port) && this.ripCovers(R, e.port)) t.set(k, e);
      }
      cur.set(R.id, t);
    }
    this._ripCur = cur;
    this._ripSettle = false;
    this._rip = { edges, target };

    const converging = !this.ripEqual(cur, target);
    if (converging && !this._ripTimer) {
      this._ripTimer = setTimeout(() => this.ripTick(), this.RIP_INTERVAL);
      if (!this._ripBusy) App.status(`RIP: Routing-Updates werden ausgetauscht (${this.RIP_INTERVAL / 1000} s je Hop) …`);
    }
    if (!converging) {
      clearTimeout(this._ripTimer);
      this._ripTimer = null;
      this._ripRounds = 0;
      if (this._ripBusy) App.status('RIP konvergiert – alle Router kennen ihre Routen.');
    }
    this._ripBusy = converging;
    return this._rip;
  },

  ripTick() {
    this._ripTimer = null;
    const d = this.ripData();
    this._ripRounds++;
    this._ripCur = this._ripRounds > this.RIP_INFINITY + 4 ? d.target : this.ripRound(this._ripCur, d.edges, d.target);
    Model.changed('rip');
  },

  ripConverging() { this.ripData(); return this._ripBusy; },

  /** Gelernte RIP-Routen eines Routers (alle, auch durch bessere Routen ersetzte). */
  ripTable(r) {
    if (!this.ripOn(r)) return [];
    this.ripData();
    const t = this._ripCur.get(r.id);
    return t ? [...t.values()] : [];
  },

  /** In die Routingtabelle übernommene RIP-Routen. */
  ripRoutes(r) {
    return this.ripTable(r).filter(e => !this.ripSuperseded(r, e.net, e.mask));
  },
});
