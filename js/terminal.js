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
      ? `NetSim Router-CLI (${dev.name})\nGeben Sie "?" ein, um die verfügbaren Befehle anzuzeigen.\n`
      : 'NetSim Kommandozeile 1.0\nGeben Sie "help" ein, um die verfügbaren Befehle anzuzeigen.\n');
    this.updatePrompt();
  }

  static stormHint() {
    const v = [...Sim.stpData().loops];
    App.toast(`Broadcast-Sturm: Schleife ohne Spanning Tree${v.length ? ' in VLAN ' + v.join(', ') : ''} – Pakete gehen verloren.`, 'warn');
  }

  isRouter() { return this.dev.type === 'router'; }
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
          '  ping [-n Anzahl] [-t] <IP>    Erreichbarkeit testen (Strg+C bricht ab)',
          '  tracert <IP>                  Route zum Ziel verfolgen',
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
        const sf = s && Sim.hostIface(s);
        L('DHCP Server', sf ? IP.str(sf.ip) : '0.0.0.0');
      }
    }
    L('Connection-specific DNS Suffix', '');
    L('IPv4 Address', f ? IP.str(f.ip) : '0.0.0.0');
    L('Subnet Mask', f ? IP.str(f.mask) : '0.0.0.0');
    L('Default Gateway', f && f.gw !== null ? IP.str(f.gw) : '0.0.0.0');
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
    const dst = IP.parse(target);
    if (dst === null) {
      this.println(`Ping request could not find host ${target}. Please check the name and try again.\n`);
      return;
    }
    this.println(`\nPinging ${target} with 32 bytes of data:\n`);
    let sent = 0, recv = 0, storm = false;
    const times = [];
    for (let i = 0; i < count && !this.abort; i++) {
      const r = await Sim.ping(this.dev, dst, i === 0 && Canvas.settings.animate);
      sent++;
      if (r.storm) storm = true;
      if (r.status === 'ok') {
        recv++;
        times.push(r.time);
        this.println(`Reply from ${target}: bytes=32 time${r.time === 0 ? '<1' : '=' + r.time}ms TTL=${r.ttl}`);
      } else if (r.status === 'unreach') {
        this.println(`Reply from ${r.from !== null ? IP.str(r.from) : target}: Destination host unreachable.`);
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
    this.println(`\nPing statistics for ${target}:`);
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

  async tracert(target) {
    if (!target) { this.println('Usage: tracert target_name\n'); return; }
    const dst = IP.parse(target);
    if (dst === null) { this.println(`Unable to resolve target system name ${target}.\n`); return; }
    this.println(`\nTracing route to ${target} over a maximum of 30 hops: \n`);
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
        '  ping <IP>                     ICMP-Echo senden',
        '  traceroute <IP>               Route verfolgen',
        '  show ip route                 Routingtabelle',
        '  show ip interface brief       Schnittstellenübersicht',
        '  show running-config           aktuelle Konfiguration',
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
    } else if (is(a[0], 'show', 2) && (is(a[1], 'running-config', 3) || is(a[1], 'run', 3))) {
      this.showRun();
    } else if (is(a[0], 'clear', 3) || a[0].toLowerCase() === 'cls') {
      this.out.textContent = '';
    } else {
      this.println(`${' '.repeat(this.prompt().length)}^\n% Invalid input detected at '^' marker.\n`);
    }
  }

  async routerPing(target) {
    const dst = IP.parse(target || '');
    if (dst === null) { this.println('% Unrecognized host or address.\n'); return; }
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
    const dst = IP.parse(target || '');
    if (dst === null) { this.println('% Unrecognized host or address.\n'); return; }
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
    const entries = [];
    r.ports.forEach((p, i) => {
      const f = Sim.portIp(r, i);
      if (f && Sim.portActive(r, i)) {
        entries.push({ net: IP.network(f.ip, f.mask), len: IP.prefixLen(f.mask), text: `C    ${IP.cidr(IP.network(f.ip, f.mask), f.mask)} is directly connected, ${longPortName(p.name)}` });
        entries.push({ net: f.ip, len: 32, text: `L    ${IP.str(f.ip)}/32 is directly connected, ${longPortName(p.name)}` });
      }
    });
    let gw = null;
    for (const s of r.routes) {
      const net = IP.parse(s.network), mask = IP.parseMask(s.mask), nh = IP.parse(s.nextHop);
      if (net === null || mask === null || nh === null || !Sim.lookup(r, nh)) continue;
      const len = IP.prefixLen(mask);
      if (len === 0 && gw === null) gw = s.nextHop;
      entries.push({ net, len, text: `${len === 0 ? 'S*' : 'S '}   ${IP.cidr(net, mask)} [1/0] via ${s.nextHop}` });
    }
    entries.sort((x, y) => (x.net - y.net) || (x.len - y.len));
    this.println('Codes: L - local, C - connected, S - static, R - RIP, O - OSPF');
    this.println('       * - candidate default\n');
    this.println(gw ? `Gateway of last resort is ${gw} to network 0.0.0.0\n` : 'Gateway of last resort is not set\n');
    for (const e of entries) this.println(e.text);
    this.println('');
  }

  showIpIntBrief() {
    const r = this.dev;
    this.println('Interface              IP-Address      OK? Method Status                Protocol');
    r.ports.forEach((p, i) => {
      const ip = IP.parse(p.ip || '');
      const status = !p.up ? 'administratively down' : Sim.portActive(r, i) ? 'up' : 'down';
      const proto = p.up && Sim.portActive(r, i) ? 'up' : 'down';
      this.println(`${longPortName(p.name).padEnd(23)}${(ip !== null ? IP.str(ip) : 'unassigned').padEnd(16)}YES ${(ip !== null ? 'manual' : 'unset').padEnd(7)}${status.padEnd(22)}${proto}`);
    });
    this.println('');
  }

  showRun() {
    const r = this.dev;
    const L = [];
    L.push('Building configuration...\n', '!', `hostname ${r.name}`, '!');
    for (const p of r.ports) {
      L.push(`interface ${longPortName(p.name)}`);
      const ip = IP.parse(p.ip || ''), mask = IP.parseMask(p.mask || '');
      L.push(ip !== null && mask !== null ? ` ip address ${IP.str(ip)} ${IP.str(mask)}` : ' no ip address');
      if (!p.up) L.push(' shutdown');
      L.push('!');
    }
    for (const s of r.routes) L.push(`ip route ${s.network} ${s.mask} ${s.nextHop}`);
    if (r.routes.length) L.push('!');
    L.push('end', '');
    this.println(L.join('\n'));
  }
}
