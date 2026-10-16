'use strict';

/*
 * Textwerkzeug: schwebender Editor für Textfelder auf der Arbeitsfläche.
 * Erscheint direkt nach dem Einfügen und per Doppelklick auf einen Text.
 * Formatierung: Farbe, Schriftgröße, Normal / Fett / Kursiv.
 */

const NOTE_COLORS = ['#1f2933', '#64748b', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777'];
const NOTE_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64];

const NoteEditor = {
  el: null,
  note: null,
  before: '',

  init() {
    const el = document.createElement('div');
    el.className = 'note-editor';
    el.hidden = true;
    el.innerHTML = `
      <div class="ne-bar">
        <div class="ne-colors">
          ${NOTE_COLORS.map(c => `<button class="ne-swatch" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}
          <label class="ne-custom" title="Eigene Farbe wählen"><input type="color"></label>
        </div>
        <span class="ne-sep"></span>
        <select class="ne-size" title="Schriftgröße"></select>
        <span class="ne-sep"></span>
        <div class="ne-seg">
          <button data-style="normal" title="Normal">Normal</button>
          <button data-style="bold" title="Fett"><b>F</b></button>
          <button data-style="italic" title="Kursiv"><i>K</i></button>
        </div>
        <span class="ne-grow"></span>
        <button class="btn-icon ne-del" title="Text löschen">${Icons.ui('trash', 15)}</button>
        <button class="btn btn-sm primary ne-done" title="Fertig (Strg+Enter)">Fertig</button>
      </div>
      <textarea rows="2" spellcheck="false" placeholder="Text eingeben …"></textarea>`;
    document.body.appendChild(el);
    this.el = el;
    this.ta = el.querySelector('textarea');
    this.size = el.querySelector('.ne-size');
    this.color = el.querySelector('input[type=color]');

    el.querySelectorAll('.ne-swatch').forEach(b => b.addEventListener('click', () => this.apply({ color: b.dataset.color })));
    this.color.addEventListener('input', () => this.apply({ color: this.color.value }));
    this.size.addEventListener('change', () => this.apply({ size: Number(this.size.value) }));
    el.querySelectorAll('[data-style]').forEach(b => b.addEventListener('click', () => {
      const n = this.note;
      if (!n) return;
      if (b.dataset.style === 'normal') this.apply({ bold: false, italic: false });
      else if (b.dataset.style === 'bold') this.apply({ bold: !n.bold });
      else this.apply({ italic: !n.italic });
    }));
    this.ta.addEventListener('input', () => this.apply({ text: this.ta.value }, false));
    this.ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.close(); }
    });
    el.querySelector('.ne-done').addEventListener('click', () => this.close());
    el.querySelector('.ne-del').addEventListener('click', () => {
      const n = this.note;
      this.close(false);
      if (n && Model.getNote(n.id)) Model.removeNote(n.id);
    });
    // Klicks im Editor sollen weder Kontextmenü noch Arbeitsfläche beeinflussen
    el.addEventListener('pointerdown', e => e.stopPropagation());
  },

  open(note, fresh = false) {
    if (this.note && this.note !== note) this.close();
    this.note = note;
    this.before = JSON.stringify(note);
    this.ta.value = note.text;
    this.sync();
    this.el.hidden = false;
    this.reposition();
    this.ta.focus();
    if (fresh) this.ta.select();
    App.status('Text bearbeiten: Farbe, Größe und Stil oben wählen – Strg+Enter oder „Fertig“ schließt den Editor.');
  },

  /** Änderung sofort anzeigen; ins Modell (Rückgängig, Autosave) wird beim Schließen übernommen. */
  apply(props, refocus = true) {
    const n = this.note;
    if (!n) return;
    Object.assign(n, props);
    this.sync();
    Canvas.renderNotes();
    this.reposition();
    if (refocus) this.ta.focus();
  },

  sync() {
    const n = this.note;
    if (!n) return;
    const sizes = NOTE_SIZES.includes(n.size) ? NOTE_SIZES : [...NOTE_SIZES, n.size].sort((a, b) => a - b);
    this.size.innerHTML = sizes.map(s => `<option value="${s}">${s} px</option>`).join('');
    this.size.value = String(n.size);
    this.color.value = n.color;
    this.el.querySelectorAll('.ne-swatch').forEach(b => b.classList.toggle('active', b.dataset.color.toLowerCase() === n.color.toLowerCase()));
    this.el.querySelector('[data-style=normal]').classList.toggle('active', !n.bold && !n.italic);
    this.el.querySelector('[data-style=bold]').classList.toggle('active', n.bold);
    this.el.querySelector('[data-style=italic]').classList.toggle('active', n.italic);
    this.ta.style.color = n.color === '#ffffff' ? '#1f2933' : n.color;
    this.ta.style.fontWeight = n.bold ? '700' : '400';
    this.ta.style.fontStyle = n.italic ? 'italic' : 'normal';
  },

  close(commit = true) {
    const n = this.note;
    if (!n) return;
    this.note = null;
    this.el.hidden = true;
    if (!commit || Model.getNote(n.id) !== n) return;
    if (!n.text.trim()) { Model.removeNote(n.id); App.status('Leerer Text entfernt.'); return; }
    if (JSON.stringify(n) !== this.before) Model.changed('edit');
    App.status('Bereit.');
  },

  /** Editor über (bzw. unter) dem Text platzieren; schließen, falls der Text nicht mehr existiert. */
  reposition() {
    const n = this.note;
    if (!n || !this.el) return;
    if (Model.getNote(n.id) !== n) { this.close(false); return; }
    const g = Canvas.gNotes.querySelector(`[data-id="${n.id}"]`);
    if (!g) return;
    const r = g.getBoundingClientRect();
    const ew = this.el.offsetWidth, eh = this.el.offsetHeight;
    let top = r.top - eh - 10;
    if (top < 56) top = r.bottom + 10;
    this.el.style.left = clamp(r.left, 8, window.innerWidth - ew - 8) + 'px';
    this.el.style.top = clamp(top, 8, window.innerHeight - eh - 8) + 'px';
  },
};
