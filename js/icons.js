'use strict';

/* Gerätesymbole (SVG) im Packet-Tracer-Stil sowie Symbole für die Werkzeugleiste. */
const Icons = {
  pc() {
    return `<rect x="3" y="2" width="54" height="38" rx="3" fill="#e4eaf1" stroke="#455a64" stroke-width="1.5"/>
<rect x="8" y="7" width="44" height="28" rx="1.5" fill="#2f80d1"/>
<path d="M8 7h26L8 28z" fill="#ffffff" fill-opacity="0.18"/>
<rect x="25" y="40" width="10" height="8" fill="#90a4ae" stroke="#455a64" stroke-width="1"/>
<rect x="13" y="48" width="34" height="6" rx="2" fill="#cfd8dc" stroke="#455a64" stroke-width="1.2"/>`;
  },

  server() {
    let bays = '';
    for (let i = 0; i < 3; i++) {
      const y = 9 + i * 12;
      bays += `<rect x="10" y="${y}" width="32" height="8" rx="1" fill="#90a4ae" stroke="#607d8b" stroke-width="0.8"/>
<circle cx="37" cy="${y + 4}" r="1.8" fill="#22c55e"/><line x1="14" y1="${y + 4}" x2="28" y2="${y + 4}" stroke="#607d8b" stroke-width="1.2"/>`;
    }
    return `<rect x="5" y="2" width="42" height="64" rx="3" fill="#e4eaf1" stroke="#455a64" stroke-width="1.5"/>
${bays}
<rect x="10" y="47" width="32" height="13" rx="1.5" fill="#2f80d1"/>
<circle cx="26" cy="53.5" r="3.2" fill="none" stroke="#ffffff" stroke-width="1.4"/>`;
  },

  switch() {
    return `<rect x="0" y="0" width="220" height="44" rx="6" fill="#2f6fae" stroke="#1b4975" stroke-width="1.5"/>
<rect x="2" y="2" width="216" height="12" rx="5" fill="#ffffff" fill-opacity="0.14"/>
<g stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" fill="#ffffff">
<line x1="10" y1="15" x2="31" y2="15"/><path d="M31 11l7 4-7 4z" stroke="none"/>
<line x1="38" y1="27" x2="17" y2="27"/><path d="M17 23l-7 4 7 4z" stroke="none"/>
</g>`;
  },

  router() {
    return `<path d="M2 14V42A40 12 0 0 0 82 42V14Z" fill="#2f6fae" stroke="#1b4975" stroke-width="1.5"/>
<ellipse cx="42" cy="14" rx="40" ry="12" fill="#5b9bd8" stroke="#1b4975" stroke-width="1.5"/>
<g fill="#ffffff" stroke="#ffffff" stroke-width="2" stroke-linecap="round">
<line x1="16" y1="10" x2="32" y2="10"/><path d="M32 6.5l6 3.5-6 3.5z" stroke="none"/>
<line x1="68" y1="10" x2="52" y2="10"/><path d="M52 6.5l-6 3.5 6 3.5z" stroke="none"/>
<line x1="36" y1="18" x2="22" y2="18"/><path d="M22 14.5l-6 3.5 6 3.5z" stroke="none"/>
<line x1="48" y1="18" x2="62" y2="18"/><path d="M62 14.5l6 3.5-6 3.5z" stroke="none"/>
</g>`;
  },

  /** Komplettes SVG-Element eines Geräts (für Palette und Fenstertitel). */
  deviceSvg(type, maxH) {
    const t = DEVICE_TYPES[type];
    const ports = t.ports.map(p =>
      `<rect x="${p.x - 4}" y="${p.y - 4}" width="8" height="8" rx="1.5" fill="#f4f6f8" stroke="#37474f"/>`).join('');
    const vbW = t.w + 12, vbH = t.h + 12;
    const size = maxH ? `height="${maxH}" width="${Math.round(maxH * vbW / vbH)}"` : `width="${vbW}" height="${vbH}"`;
    return `<svg viewBox="-6 -6 ${vbW} ${vbH}" ${size} aria-hidden="true">${Icons[type]()}${ports}</svg>`;
  },

  ui(name, size = 16) {
    const p = {
      new: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
      open: '<path d="M3 19V6a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v2"/><path d="M3 19l2.6-7.2A2 2 0 0 1 7.5 10.5H21l-2.7 7.3a2 2 0 0 1-1.9 1.2z"/>',
      save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>',
      undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
      redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
      trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6"/>',
      copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
      image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
      download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
      network: '<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v5M5 17v-5h14v5"/>',
      help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
      zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>',
      zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>',
      fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
    }[name] || '';
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  },
};
