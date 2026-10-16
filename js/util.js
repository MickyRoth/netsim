'use strict';

/*
 * IPv4-Hilfsfunktionen.
 * Adressen und Masken werden intern als vorzeichenlose 32-Bit-Zahlen behandelt.
 */
const IP = {
  parse(s) {
    if (typeof s !== 'string') return null;
    const m = s.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return null;
    let n = 0;
    for (let i = 1; i <= 4; i++) {
      const o = Number(m[i]);
      if (o > 255) return null;
      n = n * 256 + o;
    }
    return n >>> 0;
  },

  str(n) {
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  },

  valid(s) { return IP.parse(s) !== null; },

  fromPrefix(len) { return len <= 0 ? 0 : (0xFFFFFFFF << (32 - len)) >>> 0; },

  prefixLen(mask) {
    let n = 0;
    while (n < 32 && ((mask >>> (31 - n)) & 1)) n++;
    return n;
  },

  isMask(m) { return IP.fromPrefix(IP.prefixLen(m)) === (m >>> 0); },

  /** Akzeptiert "255.255.255.0", "/24" oder "24". Liefert die Maske als Zahl oder null. */
  parseMask(s) {
    s = String(s == null ? '' : s).trim();
    const m = s.match(/^\/?(\d{1,2})$/);
    if (m) {
      const l = Number(m[1]);
      return l <= 32 ? IP.fromPrefix(l) : null;
    }
    const n = IP.parse(s);
    return n !== null && IP.isMask(n) ? n : null;
  },

  network(ip, mask) { return (ip & mask) >>> 0; },
  broadcast(ip, mask) { return ((ip & mask) | ~mask) >>> 0; },
  sameNet(a, b, mask) { return IP.network(a, mask) === IP.network(b, mask); },

  /** true, wenn ip weder Netz- noch Broadcastadresse ist (/31 und /32 ausgenommen). */
  isHostAddr(ip, mask) {
    if (IP.prefixLen(mask) >= 31) return true;
    return ip !== IP.network(ip, mask) && ip !== IP.broadcast(ip, mask);
  },

  /** Klassenbasierte Standardmaske (wie Packet Tracer sie automatisch vorschlägt). */
  classfulMask(ip) {
    const a = ip >>> 24;
    if (a >= 1 && a < 128) return IP.fromPrefix(8);
    if (a >= 128 && a < 192) return IP.fromPrefix(16);
    if (a >= 192 && a < 224) return IP.fromPrefix(24);
    return null;
  },

  cidr(net, mask) { return IP.str(net) + '/' + IP.prefixLen(mask); },
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
