'use strict';

/*
 * Simuliertes Terminal.
 *  - PC/Server: Windows-ähnliche Eingabeaufforderung (ping, tracert, ipconfig …)
 *  - Router: Cisco-ähnliche CLI (ping, traceroute, show ip route …)
 */
class Terminal {
  constructor(dev) {
    this.dev = dev;
    this.history = [];
    this.hpos = 0;
    this.busy = false;
    this.abort = false;

    this.el = document.createElement('div');
    this.el.className = 'term';
    this.out = document.createElement('div');
    this.out.className = 'term-out';
    this.line = document.createElement('div');
    this.line.className = 'term-line';
    this.pr = document.createElement('span');
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.spellcheck = false;
    this.input.autocomplete = 'off';
    this.input.setAttribute('aria-label', 'Befehlseingabe');
    this.line.append(this.pr, this.input);
    this.el.append(this.out, this.line);

    this.el.addEventListener('click', () => { if (!String(window.getSelection())) this.focus(); });
    this.input.addEventListener('keydown', e => this.onKey(e));

    this.println(this.isRouter()
      ? `NetSim CLI (${dev.name})\nGeben Sie "?" ein, um die verfügbaren Befehle anzuzeigen.\n`
      : 'NetSim Kommandozeile 1.0\nGeben Sie "help" ein, um die verfügbaren Befehle anzuzeigen.\n');
    this.updatePrompt();
  }

  static stormHint() {
    const v = [...Sim.stpData().loops];
    App.toast(`Broadcast-Sturm: Schleife ohne Spanning Tree${v.length ? ' in VLAN ' + v.join(', ') : ''} – Pakete gehen verloren.`, 'warn');
  }

  isRouter() { return Sim.isRouterLike(this.dev); }
  prompt() { return this.isRouter() ? this.dev.name + '#' : 'C:\\>'; }
  updatePrompt() { if (!this.busy) this.pr.textContent = this.prompt(); }
  focus() { this.input.focus({ preventScroll: true }); }
  scroll() { this.el.scrollTop = this.el.scrollHeight; }
  write(s) { this.out.appendChild(document.createTextNode(s)); this.scroll(); }
  println(s = '') { this.write(s + '\n'); }

  async onKey(e) {
    if (this.busy) {
      if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) { this.abort = true; e.preventDefault(); }
      else if (e.key === 'Enter') e.preventDefault();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.hpos > 0) this.input.value = this.history[--this.hpos];
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this.hpos < this.history.length) this.input.value = this.history[++this.hpos] || '';
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();

    const cmd = this.input.value;
    this.input.value = '';
    this.println(this.prompt() + cmd);
    if (cmd.trim() && this.history[this.history.length - 1] !== cmd) this.history.push(cmd);
    this.hpos = this.history.length;

    this.busy = true;
    this.abort = false;
    this.input.readOnly = true;
    this.pr.textContent = '';
    try {
      await (this.isRouter() ? this.routerCmd(cmd) : this.hostCmd(cmd));
    } catch (err) {
      console.error(err);
      this.println('Interner Fehler: ' + err.message);
    }
    this.busy = false;
    this.input.readOnly = false;
    this.updatePrompt();
    this.scroll();
  }

  /* ================= PC / Server ================= */

  async hostCmd(line) {
    const a = line.trim().split(/\s+/).filter(Boolean);
    if (!a.length) return;
    const c = a[0].toLowerCase();
    switch (c) {
      case 'help': case '?':
        this.println([
          'Verfügbare Befehle:',
          '  ping [-n Anzahl] [-t] <Ziel>  Erreichbarkeit testen (Strg+C bricht ab)',
          '  tracert <Ziel>                Route zum Ziel verfolgen',
          '  nslookup <Name>               Namen per DNS auflösen',
          '  (Ziel = IP-Adresse oder Name, z. B. www.schule.lan)',
          '  ipconfig [/all]               IP-Konfiguration anzeigen',
          '  ipconfig /release | /renew    DHCP-Adresse freigeben / neu anfordern',
          '  hostname                      Gerätenamen anzeigen',
          '  cls                           Bildschirm löschen',
          '',
        ].join('\n'));
        break;
      case 'cls': case 'clear':
        this.out.textContent = '';
        break;
      case 'hostname':
        this.println(this.dev.name);
        break;
      case 'ipconfig':
        this.ipconfig(a.slice(1));
        break;
      case 'ping':
        await this.hostPing(a.slice(1));
        break;
      case 'tracert': case 'traceroute':
        await this.tracert(a[1]);
        break;
      case 'nslookup':
        await this.nslookup(a[1]);
        break;
      default:
        this.println('Invalid Command.\n');
    }
  }

  ipconfig(args) {
    const d = this.dev;
    const opt = (args[0] || '').toLowerCase();
    if (opt && !['/all', '/release', '/renew'].includes(opt)) {
      this.println('Error: unrecognized or incomplete command line.\n');
      return;
    }
    if (opt === '/release' || opt === '/renew') {
      if (d.ip.mode !== 'dhcp') {
        this.println('\nDie Schnittstelle FastEthernet0 ist statisch konfiguriert – DHCP ist nicht aktiviert.\n');
        return;
      }
      if (opt === '/release') {
        Sim.release(d, true);
      } else {
        const r = Sim.dhcpRequest(d);
        if (!r.ok) {
          this.println('\nAn error occurred while renewing interface FastEthernet0 : ' +
            (r.reason === 'full' ? 'the DHCP address pool is exhausted.' : 'unable to contact your DHCP server.'));
        }
      }
      Model.changed('edit');
    }
    const f = Sim.hostIface(d);
    const L = (label, v) => this.println(`   ${label.padEnd(32, '.')}: ${v}`);
    this.println('\nFastEthernet0 Connection:(default port)\n');
    if (opt === '/all') {
      L('Physical Address', Sim.mac(d));
      L('DHCP Enabled', d.ip.mode === 'dhcp' ? 'Yes' : 'No');
      if (d.ip.mode === 'dhcp' && d.lease && d.lease.server) {
        const s = Model.get(d.lease.server);
        // Server: seine Adresse; Router: die Schnittstelle im Subnetz des Clients
        let sip = s && Sim.hostIface(s) ? Sim.hostIface(s).ip : null;
        if (s && sip === null && Sim.isRouterLike(s)) {
          const lip = IP.parse(d.lease.ip), lm = IP.parseMask(d.lease.mask);
          const k = Sim.l3Ifaces(s).find(k => { const f = Sim.portIp(s, k); return f && IP.sameNet(f.ip, lip, lm); });
          if (k !== undefined) sip = Sim.portIp(s, k).ip;
        }
        L('DHCP Server', sip !== null ? IP.str(sip) : '0.0.0.0');
      }
    }
    L('Connection-specific DNS Suffix', '');
    L('IPv4 Address', f ? IP.str(f.ip) : '0.0.0.0');
    L('Subnet Mask', f ? IP.str(f.mask) : '0.0.0.0');
    L('Default Gateway', f && f.gw !== null ? IP.str(f.gw) : '0.0.0.0');
    if (opt === '/all') {
      const dns = Sim.dnsServerOf(d);
      L('DNS Servers', dns !== null ? IP.str(dns) : '0.0.0.0');
    }
    this.println('');
  }

  async hostPing(args) {
    let count = 4, target = null;
    for (let i = 0; i < args.length; i++) {
      const o = args[i].toLowerCase();
      if (o === '-n') count = clamp(parseInt(args[++i], 10) || 4, 1, 100);
      else if (o === '-t') count = 1000;
      else target = args[i];
    }
    if (!target) { this.println('Usage: ping [-n count] [-t] target_name\n'); return; }
    const res = await this.resolveTarget(target);
    if (res.ip === undefined) {
      this.println(`Ping request could not find host ${target}. Please check the name and try again.\n`);
      return;
    }
    const dst = res.ip;
    const ipStr = IP.str(dst);
    this.println(`\nPinging ${res.name ? `${res.name} [${ipStr}]` : ipStr} with 32 bytes of data:\n`);
    let sent = 0, recv = 0, storm = false;
    const times = [];
    for (let i = 0; i < count && !this.abort; i++) {
      const r = await Sim.ping(this.dev, dst, i === 0 && Canvas.settings.animate);
      sent++;
      if (r.storm) storm = true;
      if (r.status === 'ok') {
        recv++;
        times.push(r.time);
        this.println(`Reply from ${ipStr}: bytes=32 time${r.time === 0 ? '<1' : '=' + r.time}ms TTL=${r.ttl}`);
      } else if (r.status === 'unreach') {
        this.println(`Reply from ${r.from !== null ? IP.str(r.from) : ipStr}: Destination host unreachable.`);
      } else if (r.status === 'ttl') {
        this.println(`Reply from ${IP.str(r.from)}: TTL expired in transit.`);
      } else if (r.status === 'noip' || r.status === 'nogw') {
        this.println('PING: transmit failed. General failure.');
      } else {
        this.println('Request timed out.');
      }
      if (i < count - 1 && !this.abort) await sleep(r.status === 'ok' ? 400 : 900);
    }
    if (this.abort) this.println('Control-C\n^C');
    const lost = sent - recv;
    this.println(`\nPing statistics for ${ipStr}:`);
    this.println(`    Packets: Sent = ${sent}, Received = ${recv}, Lost = ${lost} (${Math.round(lost / Math.max(1, sent) * 100)}% loss),`);
    if (recv) {
      const min = Math.min(...times), max = Math.max(...times);
      const avg = Math.round(times.reduce((s, t) => s + t, 0) / times.length);
      this.println('Approximate round trip times in milli-seconds:');
      this.println(`    Minimum = ${min}ms, Maximum = ${max}ms, Average = ${avg}ms`);
    }
    this.println('');
    if (storm) Terminal.stormHint();
  }

  /** Ziel als IP-Adresse oder per DNS auflösen. Liefert { ip, name } oder { error }. */
  async resolveTarget(target) {
    const ip = IP.parse(target || '');
    if (ip !== null) return { ip };
    if (!Sim.validHostname(target)) return { error: 'invalid' };
    const r = await Sim.dnsQuery(this.dev, target, Canvas.settings.animate);
    return r.status === 'ok' ? { ip: r.ip, name: r.name, dns: r.dns } : { error: r.status, dns: r.dns };
  }

  /** Router-CLI: Namen wie bei Cisco übersetzen ("Translating ..."). */
  async routerResolve(target) {
    if (!target) { this.println('% Incomplete command.\n'); return null; }
    const ip = IP.parse(target);
    if (ip !== null) return ip;
    if (!Sim.validHostname(target)) { this.println('% Unrecognized host or address, or protocol not running.\n'); return null; }
    const dns = Sim.dnsServerOf(this.dev);
    this.write(`Translating "${target}"...domain server (${dns !== null ? IP.str(dns) : '255.255.255.255'})`);
    const r = await this.resolveTarget(target);
    if (r.ip === undefined) {
      this.println('\n% Unrecognized host or address, or protocol not running.\n');
      return null;
    }
    this.println(' [OK]');
    return r.ip;
  }

  async nslookup(name) {
    if (!name) { this.println('Usage: nslookup <Name>\n'); return; }
    const dns = Sim.dnsServerOf(this.dev);
    if (dns === null) {
      this.println('*** Default servers are not available');
      this.println('Server:  UnKnown');
      this.println('Address:  127.0.0.1\n');
      this.println(`*** UnKnown can't find ${name}: No response from server\n`);
      return;
    }
    this.println(`Server: [${IP.str(dns)}]`);
    this.println(`Address:  ${IP.str(dns)}\n`);
    const r = await Sim.dnsQuery(this.dev, name, Canvas.settings.animate);
    if (r.status === 'ok') {
      this.println('Non-authoritative answer:');
      this.println(`Name:     ${r.name}`);
      this.println(`Address:  ${IP.str(r.ip)}\n`);
    } else if (r.status === 'nxdomain') {
      this.println(`*** ${IP.str(dns)} can't find ${name}: Non-existent domain\n`);
    } else {
      this.println('DNS request timed out.');
      this.println('    timeout was 2 seconds.');
      this.println(`*** Request to ${IP.str(dns)} timed-out\n`);
    }
  }

  async tracert(target) {
    if (!target) { this.println('Usage: tracert target_name\n'); return; }
    const res = await this.resolveTarget(target);
    if (res.ip === undefined) { this.println(`Unable to resolve target system name ${target}.\n`); return; }
    const dst = res.ip;
    target = IP.str(dst);
    this.println(`\nTracing route to ${res.name ? `${res.name} [${target}]` : target} over a maximum of 30 hops: \n`);
    for (let ttl = 1; ttl <= 30 && !this.abort; ttl++) {
      const r = Sim.forward(this.dev, dst, ttl);
      const n = String(ttl).padStart(3);
      const ms = `${String(ttl - 1).padStart(2)} ms`;
      const times = `${ms}     ${ms}     ${ms}     `;
      if (r.status === 'ok') { this.println(`${n}   ${times}${target}`); break; }
      if (r.status === 'noip' || r.status === 'nogw') { this.println('Unable to contact IP driver. General failure.'); break; }
      if (r.status === 'ttl') this.println(`${n}   ${times}${IP.str(r.from)}`);
      else if (r.status === 'unreach') {
        this.println(`${n}   ${r.from !== null ? IP.str(r.from) : '*'}   reports: Destination host unreachable.`);
        break;
      } else this.println(`${n}     *        *        *     Request timed out.`);
      await sleep(r.status === 'ttl' ? 150 : 400);
    }
    this.println('\nTrace complete.\n');
  }

  /* ================= Router-CLI ================= */

  async routerCmd(line) {
    const a = line.trim().split(/\s+/).filter(Boolean);
    if (!a.length) return;
    // Abkürzungen wie bei Cisco: "sh ip int br", "sh ip ro"
    const is = (tok, full, min = 1) => !!tok && tok.length >= min && full.startsWith(tok.toLowerCase());

    if (a[0] === '?' || is(a[0], 'help', 2)) {
      this.println([
        'Verfügbare Befehle:',
        '  ping <IP|Name>                ICMP-Echo senden',
        '  traceroute <IP|Name>          Route verfolgen',
        '  show ip route                 Routingtabelle',
        '  show ip interface brief       Schnittstellenübersicht',
        '  show running-config           aktuelle Konfiguration',
        '  show ip protocols             Routing-Protokolle (RIP)',
        ...(this.dev.type === 'l3switch' ? ['  show vlan brief               VLAN-Übersicht'] : []),
        ...(this.dev.type === 'router' ? ['  show ip dhcp binding          vergebene DHCP-Adressen'] : []),
        '  clear                         Bildschirm löschen',
        '',
      ].join('\n'));
    } else if (is(a[0], 'ping', 2)) {
      await this.routerPing(a[1]);
    } else if (is(a[0], 'traceroute', 3) || a[0].toLowerCase() === 'tracert') {
      await this.routerTrace(a[1]);
    } else if (is(a[0], 'show', 2) && is(a[1], 'ip', 2) && is(a[2], 'route', 1)) {
      this.showIpRoute();
    } else if (is(a[0], 'show', 2) && is(a[1], 'ip', 2) && is(a[2], 'interface', 3) && is(a[3], 'brief', 1)) {
      this.showIpIntBrief();
    } else if (this.dev.type === 'router' && is(a[0], 'show', 2) && is(a[1], 'ip', 2) && is(a[2], 'dhcp', 2) && is(a[3], 'binding', 1)) {
      this.showDhcpBinding();
    } else if (is(a[0], 'show', 2) && is(a[1], 'ip', 2) && is(a[2], 'protocols', 4)) {
      this.showIpProtocols();
    } else if (this.dev.type === 'l3switch' && is(a[0], 'show', 2) && is(a[1], 'vlan', 1) && (!a[2] || is(a[2], 'brief', 1))) {
      this.showVlanBrief();
    } else if (is(a[0], 'show', 2) && (is(a[1], 'running-config', 3) || is(a[1], 'run', 3))) {
      this.showRun();
    } else if (is(a[0], 'clear', 3) || a[0].toLowerCase() === 'cls') {
      this.out.textContent = '';
    } else {
      this.println(`${' '.repeat(this.prompt().length)}^\n% Invalid input detected at '^' marker.\n`);
    }
  }

  async routerPing(target) {
    const dst = await this.routerResolve(target);
    if (dst === null) return;
    target = IP.str(dst);
    this.println('Type escape sequence to abort.');
    this.println(`Sending 5, 100-byte ICMP Echos to ${target}, timeout is 2 seconds:`);
    let ok = 0, sent = 0, storm = false;
    const times = [];
    for (let i = 0; i < 5 && !this.abort; i++) {
      const r = await Sim.ping(this.dev, dst, i === 0 && Canvas.settings.animate);
      sent++;
      if (r.storm) storm = true;
      if (r.status === 'ok') { ok++; times.push(r.time); this.write('!'); }
      else if (r.status === 'unreach') this.write('U');
      else this.write('.');
      await sleep(r.status === 'ok' ? 250 : 600);
    }
    this.println('');
    let s = `Success rate is ${Math.round(ok / Math.max(1, sent) * 100)} percent (${ok}/${sent})`;
    if (ok) {
      const avg = Math.round(times.reduce((x, y) => x + y, 0) / ok);
      s += `, round-trip min/avg/max = ${Math.min(...times)}/${avg}/${Math.max(...times)} ms`;
    }
    this.println(s + '\n');
    if (storm) Terminal.stormHint();
  }

  async routerTrace(target) {
    const dst = await this.routerResolve(target);
    if (dst === null) return;
    target = IP.str(dst);
    this.println('Type escape sequence to abort.');
    this.println(`Tracing the route to ${target}\n`);
    for (let ttl = 1; ttl <= 30 && !this.abort; ttl++) {
      const r = Sim.forward(this.dev, dst, ttl);
      const n = String(ttl).padStart(3);
      if (r.status === 'ok') { this.println(`${n} ${target} 0 msec 0 msec 0 msec`); break; }
      if (r.status === 'ttl') this.println(`${n} ${IP.str(r.from)} 0 msec 0 msec 0 msec`);
      else if (r.status === 'unreach') { this.println(`${n} ${r.from !== null ? IP.str(r.from) : '*'} !H  !H  !H`); break; }
      else if (r.status === 'noroute') { this.println('% No route to host.'); break; }
      else this.println(`${n}  *    *    *`);
      await sleep(r.status === 'ttl' ? 150 : 400);
    }
    this.println('');
  }

  showIpRoute() {
    const r = this.dev;
    if (!Sim.routingOn(r)) {
      // L3-Switch ohne "ip routing": wie bei Cisco keine Routingtabelle
      this.println('Default gateway is not set\n');
      this.println('Host               Gateway           Last Use    Total Uses  Interface');
      this.println('ICMP redirect cache is empty\n');
      this.println('% IP-Routing ist deaktiviert (ip routing im Reiter „Routing“ einschalten).\n');
      return;
    }
    const entries = [];
    for (const i of Sim.l3Ifaces(r)) {
      const f = Sim.portIp(r, i);
      if (f && Sim.portActive(r, i)) {
        const n = Sim.ifaceLong(r, i);
        entries.push({ net: IP.network(f.ip, f.mask), len: IP.prefixLen(f.mask), text: `C    ${IP.cidr(IP.network(f.ip, f.mask), f.mask)} is directly connected, ${n}` });
        entries.push({ net: f.ip, len: 32, text: `L    ${IP.str(f.ip)}/32 is directly connected, ${n}` });
      }
    }
    let gw = null;
    for (const s of r.routes) {
      const net = IP.parse(s.network), mask = IP.parseMask(s.mask), nh = IP.parse(s.nextHop);
      if (net === null || mask === null || nh === null || !Sim.lookup(r, nh)) continue;
      const len = IP.prefixLen(mask);
      if (len === 0 && gw === null) gw = s.nextHop;
      entries.push({ net, len, text: `${len === 0 ? 'S*' : 'S '}   ${IP.cidr(net, mask)} [1/0] via ${s.nextHop}` });
    }
    for (const e of Sim.ripRoutes(r)) {
      const len = IP.prefixLen(e.mask);
      if (len === 0 && gw === null) gw = IP.str(e.nextHop);
      entries.push({ net: e.net, len, text: `${len === 0 ? 'R*' : 'R '}   ${IP.cidr(e.net, e.mask)} [120/${e.metric}] via ${IP.str(e.nextHop)}, 00:00:0${Math.floor(Math.random() * 5)}, ${Sim.ifaceLong(r, e.port)}` });
    }
    entries.sort((x, y) => (x.net - y.net) || (x.len - y.len));
    this.println('Codes: L - local, C - connected, S - static, R - RIP, O - OSPF');
    this.println('       * - candidate default\n');
    this.println(gw ? `Gateway of last resort is ${gw} to network 0.0.0.0\n` : 'Gateway of last resort is not set\n');
    for (const e of entries) this.println(e.text);
    this.println('');
  }

  showIpProtocols() {
    const r = this.dev;
    if (!Sim.ripOn(r)) { this.println(''); return; }
    const sec = Sim.RIP_INTERVAL / 1000;
    const L = [
      'Routing Protocol is "rip"',
      `Sending updates every ${sec} seconds (NetSim; Cisco: 30 seconds)`,
      'Outgoing update filter list for all interfaces is not set',
      'Incoming update filter list for all interfaces is not set',
      'Redistributing: rip',
      'Default version control: send version 2, receive 2',
      '  Interface             Send  Recv  Triggered RIP  Key-chain',
    ];
    for (const i of Sim.ripIfaces(r)) {
      if (!r.rip.passive.includes(i)) L.push(`  ${Sim.ifaceLong(r, i).padEnd(22)}2     2`);
    }
    L.push('Automatic network summarization is not in effect', 'Maximum path: 1', 'Routing for Networks:');
    for (const n of r.rip.networks) L.push(`    ${n}`);
    const passive = r.rip.passive.filter(k => Sim.l3Ifaces(r).includes(k));
    if (passive.length) {
      L.push('Passive Interface(s):');
      for (const i of passive) L.push(`    ${Sim.ifaceLong(r, i)}`);
    }
    L.push('Routing Information Sources:', '    Gateway         Distance      Last Update');
    for (const e of Sim.ripData().edges.filter(e => e.to === r)) L.push(`    ${IP.str(e.nh).padEnd(16)}120           00:00:0${Math.floor(Math.random() * 5)}`);
    L.push('Distance: (default is 120)', '');
    this.println(L.join('\n'));
  }

  showIpIntBrief() {
    const r = this.dev;
    const row = (name, ipStr, status, proto) => this.println(
      `${name.padEnd(23)}${(ipStr || 'unassigned').padEnd(16)}YES ${(ipStr ? 'manual' : 'unset').padEnd(7)}${status.padEnd(22)}${proto}`);
    this.println('Interface              IP-Address      OK? Method Status                Protocol');
    r.ports.forEach((p, i) => {
      const c = Sim.ifaceConfig(r, i);
      const ip = c ? IP.parse(c.ip || '') : null;
      const admin = r.type === 'router' && !p.up;
      const act = Sim.portActive(r, i);
      row(longPortName(p.name), ip !== null ? IP.str(ip) : '', admin ? 'administratively down' : act ? 'up' : 'down', act ? 'up' : 'down');
    });
    for (const s of r.subifs || []) {
      const k = s.port + '.' + s.vlan;
      const ip = IP.parse(s.ip || '');
      const act = Sim.portActive(r, k);
      row(Sim.ifaceLong(r, k), ip !== null ? IP.str(ip) : '', !r.ports[s.port].up ? 'administratively down' : act ? 'up' : 'down', act ? 'up' : 'down');
    }
    for (const s of r.svis || []) {
      const ip = IP.parse(s.ip || '');
      const up = Sim.sviLineUp(r, 'v' + s.vlan);
      row(`Vlan${s.vlan}`, ip !== null ? IP.str(ip) : '', !s.up ? 'administratively down' : up ? 'up' : 'down', up ? 'up' : 'down');
    }
    this.println('');
  }

  showDhcpBinding() {
    const r = this.dev;
    this.println('IP address       Client-ID/              Lease expiration        Type');
    this.println('                 Hardware address');
    for (const d of Model.devices) {
      if (!Sim.isHost(d) || d.ip.mode !== 'dhcp' || !d.lease || d.lease.server !== r.id || d.lease.apipa || d.lease.released) continue;
      this.println(`${d.lease.ip.padEnd(17)}${Sim.mac(d).padEnd(24)}--                      Automatic`);
    }
    this.println('');
  }

  showVlanBrief() {
    const r = this.dev;
    this.println('VLAN Name                             Status    Ports');
    this.println('---- -------------------------------- --------- -------------------------------');
    for (const v of r.vlans) {
      const ports = r.ports.filter(p => p.mode === 'access' && p.vlan === v.id).map(p => p.name).join(', ');
      this.println(`${String(v.id).padEnd(5)}${v.name.slice(0, 32).padEnd(33)}active    ${ports}`);
    }
    this.println('');
  }

  showRun() {
    const r = this.dev;
    const L = [];
    const addr = c => {
      const ip = IP.parse(c.ip || ''), mask = IP.parseMask(c.mask || '');
      return ip !== null && mask !== null ? ` ip address ${IP.str(ip)} ${IP.str(mask)}` : ' no ip address';
    };
    L.push('Building configuration...\n', '!', `hostname ${r.name}`, '!');
    if (IP.valid(r.dns || '')) L.push(`ip name-server ${r.dns}`, '!');
    if (r.type === 'l3switch') {
      if (r.ipRouting) L.push('ip routing', '!');
      if (!r.stp.enabled) L.push(`no spanning-tree vlan ${r.vlans.map(v => v.id).join(',')}`);
      else {
        L.push('spanning-tree mode pvst');
        if (r.stp.priority !== 32768) L.push(`spanning-tree vlan ${r.vlans.map(v => v.id).join(',')} priority ${r.stp.priority}`);
      }
      L.push('!');
      for (const v of r.vlans) if (v.id !== 1) L.push(`vlan ${v.id}`, ` name ${v.name}`, '!');
      for (const p of r.ports) {
        L.push(`interface ${longPortName(p.name)}`);
        if (p.mode === 'routed') L.push(' no switchport', addr(p));
        else if (p.mode === 'trunk') L.push(' switchport trunk encapsulation dot1q', ' switchport mode trunk');
        else { if (p.vlan !== 1) L.push(` switchport access vlan ${p.vlan}`); L.push(' switchport mode access'); }
        L.push('!');
      }
      for (const s of r.svis) {
        L.push(`interface Vlan${s.vlan}`, addr(s));
        if (!s.up) L.push(' shutdown');
        L.push('!');
      }
    } else {
      r.ports.forEach((p, i) => {
        L.push(`interface ${longPortName(p.name)}`, addr(p));
        if (!p.up) L.push(' shutdown');
        L.push('!');
        for (const s of r.subifs.filter(x => x.port === i)) {
          L.push(`interface ${Sim.ifaceLong(r, s.port + '.' + s.vlan)}`, ` encapsulation dot1Q ${s.vlan}${s.vlan === 1 ? ' native' : ''}`, addr(s), '!');
        }
      });
      if (r.dhcpd && r.dhcpd.pools.length) {
        if (!r.dhcpd.enabled) L.push('no service dhcp', '!');
        for (const p of r.dhcpd.pools) {
          const st = IP.parse(p.start), mk = IP.parseMask(p.mask);
          L.push(`ip dhcp pool ${p.name}`);
          if (st !== null && mk !== null) L.push(` network ${IP.str(IP.network(st, mk))} ${IP.str(mk)}`);
          if (IP.valid(p.gateway)) L.push(` default-router ${p.gateway}`);
          if (st !== null) L.push(` ! NetSim: vergibt ab ${p.start}, max. ${p.max} Adressen`);
          L.push('!');
        }
      }
    }
    for (const s of r.routes) L.push(`ip route ${s.network} ${s.mask} ${s.nextHop}`);
    if (r.routes.length) L.push('!');
    if (r.rip.enabled) {
      L.push('router rip', ' version 2');
      for (const i of r.rip.passive) {
        if (Sim.l3Ifaces(r).includes(i)) L.push(` passive-interface ${Sim.ifaceLong(r, i)}`);
      }
      for (const n of r.rip.networks) L.push(` network ${n}`);
      if (r.rip.defaultOriginate) L.push(' default-information originate');
      L.push(' no auto-summary', '!');
    }
    L.push('end', '');
    this.println(L.join('\n'));
  }
}
