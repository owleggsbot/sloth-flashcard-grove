// Sloth Flashcard Grove — offline-first spaced repetition, local-only.

const STORAGE_KEY = 'sfg:v1';

/** @typedef {{id:string, front:string, back:string, createdAt:number, srs:{ease:number, intervalDays:number, reps:number, due:number, lapses:number}}} Card */
/** @typedef {{id:string, name:string, createdAt:number, cards:Card[]}} Deck */
/** @typedef {{version:1, activeDeckId:string|null, decks:Deck[], today:{date:string, reviewed:number}}} State */

const $ = (id) => document.getElementById(id);

const ui = {
  btnDeck: $('btnDeck'),
  btnImport: $('btnImport'),
  btnExport: $('btnExport'),
  btnShare: $('btnShare'),
  btnHelp: $('btnHelp'),

  deckLabel: $('deckLabel'),
  dueLabel: $('dueLabel'),
  streakLabel: $('streakLabel'),

  cardFront: $('cardFront'),
  cardBack: $('cardBack'),
  btnFlip: $('btnFlip'),
  btnSpeak: $('btnSpeak'),
  btnStopSpeak: $('btnStopSpeak'),
  btnAgain: $('btnAgain'),
  btnHard: $('btnHard'),
  btnGood: $('btnGood'),
  btnEasy: $('btnEasy'),

  deckGrid: $('deckGrid'),
  btnNewDeck: $('btnNewDeck'),

  btnAdd: $('btnAdd'),
  btnEdit: $('btnEdit'),
  btnResetDay: $('btnResetDay'),

  dlgDeck: $('dlgDeck'),
  deckList: $('deckList'),
  dlgNewDeck: $('dlgNewDeck'),

  dlgImport: $('dlgImport'),
  importText: $('importText'),
  importDelimiter: $('importDelimiter'),
  importFrontCol: $('importFrontCol'),
  importBackCol: $('importBackCol'),
  importNormalizeWs: $('importNormalizeWs'),
  importWarnings: $('importWarnings'),
  importPreview: $('importPreview'),
  importDeck: $('importDeck'),
  importAppend: $('importAppend'),
  importStatus: $('importStatus'),
  btnDoImport: $('btnDoImport'),

  dlgEdit: $('dlgEdit'),
  deckName: $('deckName'),
  cardsText: $('cardsText'),
  editStatus: $('editStatus'),
  btnSaveDeck: $('btnSaveDeck'),
  btnDeleteDeck: $('btnDeleteDeck'),

  dlgShare: $('dlgShare'),
  shareUrl: $('shareUrl'),
  shareQr: $('shareQr'),
  btnCopyShare: $('btnCopyShare'),
  btnDownloadQr: $('btnDownloadQr'),
  btnShareNative: $('btnShareNative'),
  shareStatus: $('shareStatus'),

  dlgHelp: $('dlgHelp'),
};

// Optional capability: built-in text-to-speech (no network needed).
const CAN_SPEAK = ('speechSynthesis' in window) && (typeof SpeechSynthesisUtterance !== 'undefined');
if (!CAN_SPEAK) {
  ui.btnSpeak.disabled = true;
  ui.btnStopSpeak.disabled = true;
  ui.btnSpeak.title = 'Read aloud is not supported in this browser.';
  ui.btnStopSpeak.title = 'Read aloud is not supported in this browser.';
}

const nowMs = () => Date.now();
const todayISO = () => new Date().toISOString().slice(0,10);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const uid = () => Math.random().toString(16).slice(2) + '-' + Math.random().toString(16).slice(2);

function defaultState() {
  /** @type {State} */
  const s = {
    version: 1,
    activeDeckId: null,
    decks: [],
    today: { date: todayISO(), reviewed: 0 },
  };
  return s;
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) return defaultState();
    if (!parsed.today || typeof parsed.today.date !== 'string') parsed.today = { date: todayISO(), reviewed: 0 };
    return parsed;
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeTodayCounter() {
  const t = todayISO();
  if (state.today.date !== t) {
    state.today = { date: t, reviewed: 0 };
  }
}

function ensureSampleIfEmpty() {
  if (state.decks.length) return;
  const d = createDeck('Sloth basics');
  const sample = [
    ['What is spaced repetition?', 'Reviewing cards right before you forget them — like a sloth that never rushes, but always returns.'],
    ['Rule of the grove', 'Small bites. Often. Zero guilt.'],
    ['Shortcut: flip', 'Space'],
    ['Shortcut: grade', '1 Again • 2 Hard • 3 Good • 4 Easy'],
  ];
  d.cards = sample.map(([front, back]) => newCard(front, back));
  state.decks.push(d);
  state.activeDeckId = d.id;
  saveState();
}

function newCard(front, back) {
  /** @type {Card} */
  return {
    id: uid(),
    front: (front || '').trim(),
    back: (back || '').trim(),
    createdAt: nowMs(),
    srs: {
      ease: 2.5,
      intervalDays: 0,
      reps: 0,
      lapses: 0,
      due: nowMs(),
    },
  };
}

function createDeck(name) {
  /** @type {Deck} */
  return {
    id: uid(),
    name: (name || 'New deck').trim() || 'New deck',
    createdAt: nowMs(),
    cards: [],
  };
}

function getActiveDeck() {
  if (!state.activeDeckId) return null;
  return state.decks.find(d => d.id === state.activeDeckId) || null;
}

function countDue(deck) {
  const t = nowMs();
  return deck.cards.filter(c => c.srs.due <= t).length;
}

function pickNextDueCard(deck) {
  const t = nowMs();
  const due = deck.cards.filter(c => c.srs.due <= t);
  due.sort((a,b) => a.srs.due - b.srs.due);
  return due[0] || null;
}

function formatDue(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return 'today';
  return d.toISOString().slice(0,10);
}

// Simplified SM-2-ish scheduling.
// quality: 0 again, 1 hard, 2 good, 3 easy
function gradeCard(card, quality) {
  const s = card.srs;
  const t = nowMs();

  if (quality === 0) {
    s.lapses += 1;
    s.reps = 0;
    s.intervalDays = 0;
    s.ease = clamp(s.ease - 0.2, 1.3, 3.0);
    s.due = t + 10 * 60 * 1000; // 10 minutes
    return;
  }

  // update ease
  if (quality === 1) s.ease = clamp(s.ease - 0.15, 1.3, 3.0);
  if (quality === 2) s.ease = clamp(s.ease + 0.0, 1.3, 3.0);
  if (quality === 3) s.ease = clamp(s.ease + 0.12, 1.3, 3.0);

  s.reps += 1;

  if (s.reps === 1) s.intervalDays = 1;
  else if (s.reps === 2) s.intervalDays = 3;
  else {
    const mult = quality === 1 ? (s.ease * 0.85) : (quality === 3 ? (s.ease * 1.18) : s.ease);
    s.intervalDays = Math.max(1, Math.round(s.intervalDays * mult));
  }

  const jitter = Math.floor(Math.random() * 6 * 60 * 60 * 1000); // up to 6 hours
  s.due = t + s.intervalDays * 24 * 60 * 60 * 1000 + jitter;
}

let state = loadState();
normalizeTodayCounter();
ensureSampleIfEmpty();

let session = {
  showingBack: false,
  currentCardId: null,
};

function setNotice(el, msg) {
  if (!msg) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = msg;
}

function openDialog(dlg) {
  try { dlg.showModal(); } catch { /* ignore */ }
}

function closeDialog(dlg) {
  try { dlg.close(); } catch { /* ignore */ }
}

function updateImportDeckOptions() {
  ui.importDeck.innerHTML = '';
  for (const d of state.decks) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    ui.importDeck.appendChild(opt);
  }
  if (state.activeDeckId) ui.importDeck.value = state.activeDeckId;
}

function renderDeckGrid() {
  ui.deckGrid.innerHTML = '';
  for (const d of state.decks.slice().sort((a,b) => b.createdAt - a.createdAt)) {
    const el = document.createElement('div');
    el.className = 'deck';

    const due = countDue(d);
    const total = d.cards.length;
    const next = d.cards.length ? d.cards.slice().sort((a,b)=>a.srs.due-b.srs.due)[0] : null;

    el.innerHTML = `
      <div class="deck__row">
        <div class="deck__name"></div>
        <div class="deck__btns">
          <button class="btn btn--ghost" data-act="edit">Edit</button>
          <button class="btn btn--primary" data-act="study">Study</button>
        </div>
      </div>
      <div class="deck__meta">
        <span>Cards: <b>${total}</b></span>
        <span>Due: <b>${due}</b></span>
        <span>Next: <b>${next ? formatDue(next.srs.due) : '—'}</b></span>
      </div>
    `;
    el.querySelector('.deck__name').textContent = d.name;

    el.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'study') {
        state.activeDeckId = d.id;
        saveState();
        closeDialog(ui.dlgDeck);
        renderAll();
        return;
      }
      if (act === 'edit') {
        state.activeDeckId = d.id;
        saveState();
        openEdit();
        return;
      }
    });

    ui.deckGrid.appendChild(el);
  }
}

function renderDeckListDialog() {
  ui.deckList.innerHTML = '';
  const active = getActiveDeck();

  for (const d of state.decks.slice().sort((a,b) => a.name.localeCompare(b.name))) {
    const row = document.createElement('div');
    row.className = 'deck';
    const due = countDue(d);
    row.innerHTML = `
      <div class="deck__row">
        <div>
          <div class="deck__name"></div>
          <div class="deck__meta">
            <span>Cards: <b>${d.cards.length}</b></span>
            <span>Due: <b>${due}</b></span>
          </div>
        </div>
        <div class="deck__btns">
          <button class="btn" data-act="pick">${active && active.id === d.id ? 'Active' : 'Make active'}</button>
          <button class="btn btn--ghost" data-act="edit">Edit</button>
        </div>
      </div>
    `;
    row.querySelector('.deck__name').textContent = d.name;
    row.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'pick') {
        state.activeDeckId = d.id;
        saveState();
        renderAll();
        return;
      }
      if (act === 'edit') {
        state.activeDeckId = d.id;
        saveState();
        openEdit();
        return;
      }
    });
    ui.deckList.appendChild(row);
  }
}

function renderCard() {
  normalizeTodayCounter();
  const deck = getActiveDeck();

  ui.btnAgain.disabled = ui.btnHard.disabled = ui.btnGood.disabled = ui.btnEasy.disabled = true;
  ui.cardBack.hidden = true;
  session.showingBack = false;

  if (!deck) {
    ui.deckLabel.textContent = 'Deck: —';
    ui.dueLabel.textContent = 'Due now: —';
    ui.streakLabel.textContent = `Today: ${state.today.reviewed}`;
    ui.cardFront.textContent = 'Plant a deck to begin.';
    ui.cardBack.textContent = '';
    session.currentCardId = null;
    return;
  }

  const dueCount = countDue(deck);
  ui.deckLabel.textContent = `Deck: ${deck.name}`;
  ui.dueLabel.textContent = `Due now: ${dueCount}`;
  ui.streakLabel.textContent = `Today: ${state.today.reviewed}`;

  if (!deck.cards.length) {
    ui.cardFront.textContent = 'This deck is empty. Add a few cards and come back.';
    ui.cardBack.textContent = '';
    session.currentCardId = null;
    return;
  }

  const card = pickNextDueCard(deck);
  if (!card) {
    ui.cardFront.textContent = 'No cards due. Go be leafy.';
    ui.cardBack.textContent = 'Tip: hit Share to send this deck to another device.';
    ui.cardBack.hidden = false;
    session.showingBack = true;
    session.currentCardId = null;
    return;
  }

  session.currentCardId = card.id;
  ui.cardFront.textContent = card.front || '(blank front)';
  ui.cardBack.textContent = card.back || '(blank back)';
}

function stopSpeak() {
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
}

function speak(text) {
  const t = (text || '').toString().trim();
  if (!t) return;
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;

  // Reset any previous utterance for snappy UX.
  stopSpeak();

  const u = new SpeechSynthesisUtterance(t);
  u.rate = 0.95;
  u.pitch = 1.0;
  u.volume = 1.0;
  try { window.speechSynthesis.speak(u); } catch { /* ignore */ }
}

function speakVisibleSide() {
  // Prefer speaking the visible “answer” side when flipped.
  const text = session.showingBack ? ui.cardBack.textContent : ui.cardFront.textContent;
  speak(text);
}

function flip() {
  const deck = getActiveDeck();
  if (!deck) return;
  if (CAN_SPEAK) stopSpeak();

  const card = deck.cards.find(c => c.id === session.currentCardId) || null;
  if (!card) {
    // maybe not due
    if (!session.showingBack && deck.cards.length) {
      ui.cardBack.hidden = false;
      session.showingBack = true;
    }
    return;
  }

  session.showingBack = !session.showingBack;
  ui.cardBack.hidden = !session.showingBack;

  const canGrade = session.showingBack && !!session.currentCardId;
  ui.btnAgain.disabled = ui.btnHard.disabled = ui.btnGood.disabled = ui.btnEasy.disabled = !canGrade;
}

function grade(quality) {
  const deck = getActiveDeck();
  if (!deck) return;
  const card = deck.cards.find(c => c.id === session.currentCardId) || null;
  if (!card) return;
  if (CAN_SPEAK) stopSpeak();

  gradeCard(card, quality);
  state.today.reviewed += 1;
  saveState();
  renderAll();
}

function parseCardsText(text) {
  const lines = (text || '').split(/\r?\n/);
  const pairs = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let front = '';
    let back = '';
    if (trimmed.includes('\t')) {
      const [a, ...rest] = trimmed.split('\t');
      front = a;
      back = rest.join('\t');
    } else if (trimmed.includes(' | ')) {
      const [a, ...rest] = trimmed.split(' | ');
      front = a;
      back = rest.join(' | ');
    } else if (trimmed.includes('|')) {
      const [a, ...rest] = trimmed.split('|');
      front = a;
      back = rest.join('|');
    } else {
      front = trimmed;
      back = '';
    }
    pairs.push([front.trim(), back.trim()]);
  }
  return pairs;
}

function normalizeWhitespace(s) {
  return (s ?? '').toString()
    .replace(/\s+/g, ' ')
    .trim();
}

function columnName(i) {
  // 0 -> A, 25 -> Z, 26 -> AA
  let n = i;
  let out = '';
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

function parseDelimited(text, delimiter) {
  // Simple delimited parser. Supports "" quotes for comma/pipe; tabs are treated as raw.
  const lines = (text || '').split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;

    // If delimiter is a tab, keep it straightforward.
    if (delimiter === '\t') {
      rows.push(line.split('\t'));
      continue;
    }

    const row = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; continue; }
        inQ = !inQ;
        continue;
      }
      if (ch === delimiter && !inQ) {
        row.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function detectDelimiter(text) {
  const candidates = ['\t', ',', '|'];
  const lines = (text || '').split(/\r?\n/).filter(l => l.trim()).slice(0, 12);
  if (!lines.length) return '\t';

  let best = { d: '\t', score: 0, cols: 0 };
  for (const d of candidates) {
    let colsTotal = 0;
    let counted = 0;
    for (const line of lines) {
      const cols = parseDelimited(line, d)[0]?.length || 0;
      if (cols > 0) { colsTotal += cols; counted++; }
    }
    if (!counted) continue;
    const avgCols = colsTotal / counted;
    const score = avgCols; // prefer higher column count
    if (score > best.score) best = { d, score, cols: avgCols };
  }

  // If everything looks like 1 column, default to tab because of Anki TSV.
  if (best.score <= 1.05) return '\t';
  return best.d;
}

function renderPreviewTable(tableEl, rows, colCount) {
  if (!tableEl) return;
  const head = `<thead><tr>${Array.from({ length: colCount }).map((_, i) => `<th>${columnName(i)}</th>`).join('')}</tr></thead>`;
  const bodyRows = rows.map(r => `<tr>${Array.from({ length: colCount }).map((_, i) => `<td>${escapeHtml((r[i] ?? '').toString())}</td>`).join('')}</tr>`).join('');
  tableEl.innerHTML = head + `<tbody>${bodyRows}</tbody>`;
}

function escapeHtml(s) {
  return (s ?? '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setImportMappingOptions(colCount) {
  const front = ui.importFrontCol;
  const back = ui.importBackCol;
  if (!front || !back) return;

  const opts = Array.from({ length: colCount }).map((_, i) => ({ value: String(i), label: `${columnName(i)} (col ${i + 1})` }));

  front.innerHTML = opts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  back.innerHTML = `<option value="-1">(empty)</option>` + opts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');

  // Sensible defaults: A=front, B=back (if exists)
  front.value = '0';
  back.value = colCount >= 2 ? '1' : '-1';
}

function updateImportPreview() {
  setNotice(ui.importStatus, '');
  setNotice(ui.importWarnings, '');

  const raw = (ui.importText.value || '').trim();
  if (!raw) {
    if (ui.importPreview) ui.importPreview.innerHTML = '';
    if (ui.importFrontCol) ui.importFrontCol.innerHTML = '';
    if (ui.importBackCol) ui.importBackCol.innerHTML = '';
    return;
  }

  // JSON import path (keep existing behavior, but show a small preview if possible).
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const data = JSON.parse(raw);
      let pairs = [];
      if (data?.kind === 'sfg-deck' && data?.deck?.cards) {
        pairs = data.deck.cards.map(c => [c.front || '', c.back || '']);
      } else if (Array.isArray(data)) {
        pairs = data.map(r => [r.front || '', r.back || '']);
      }
      if (pairs.length) {
        setImportMappingOptions(2);
        if (ui.importDelimiter) ui.importDelimiter.value = 'auto';
        renderPreviewTable(ui.importPreview, pairs.slice(0, 20), 2);
      }
      return;
    } catch {
      // Fall through to delimiter parsing.
    }
  }

  let delimiter = ui.importDelimiter?.value || 'auto';
  if (delimiter === 'auto') delimiter = detectDelimiter(raw);

  const rows = parseDelimited(raw, delimiter);
  const colCount = Math.max(1, ...rows.map(r => r.length));

  setImportMappingOptions(colCount);
  renderPreviewTable(ui.importPreview, rows.slice(0, 20), colCount);

  // Warnings
  const normalize = !!ui.importNormalizeWs?.checked;
  const frontIdx = parseInt(ui.importFrontCol?.value || '0', 10);
  const backIdx = parseInt(ui.importBackCol?.value || (colCount >= 2 ? '1' : '-1'), 10);

  let emptyRows = 0;
  let longFields = 0;
  const seen = new Set();
  let dupes = 0;
  for (const r of rows) {
    const any = r.some(v => (v ?? '').toString().trim().length);
    if (!any) { emptyRows++; continue; }

    const f0 = r[frontIdx] ?? '';
    const b0 = backIdx >= 0 ? (r[backIdx] ?? '') : '';
    const f = normalize ? normalizeWhitespace(f0) : (f0 ?? '').toString().trim();
    const b = normalize ? normalizeWhitespace(b0) : (b0 ?? '').toString().trim();

    if (f.length > 350 || b.length > 350) longFields++;

    const key = `${f}__${b}`;
    if (seen.has(key)) dupes++;
    else seen.add(key);
  }

  const warns = [];
  if (emptyRows) warns.push(`${emptyRows} empty row(s) will be ignored.`);
  if (dupes) warns.push(`${dupes} duplicate card(s) detected (same front+back).`);
  if (longFields) warns.push(`${longFields} very long field(s) (>350 chars). Consider trimming.`);

  if (warns.length) setNotice(ui.importWarnings, warns.join(' '));
}

function openEdit() {
  const deck = getActiveDeck();
  if (!deck) {
    // create one
    const d = createDeck('New deck');
    state.decks.push(d);
    state.activeDeckId = d.id;
    saveState();
  }

  const active = getActiveDeck();
  ui.deckName.value = active.name;
  ui.cardsText.value = active.cards.map(c => `${(c.front || '').replace(/\n/g,' ')}\t${(c.back || '').replace(/\n/g,' ')}`.trim()).join('\n');
  setNotice(ui.editStatus, '');
  openDialog(ui.dlgEdit);
}

function saveEdit() {
  const deck = getActiveDeck();
  if (!deck) return;

  const newName = (ui.deckName.value || '').trim() || 'Untitled deck';
  const pairs = parseCardsText(ui.cardsText.value);
  if (!pairs.length) {
    setNotice(ui.editStatus, 'Give the deck at least one card (or close and delete it).');
    return;
  }

  // Keep existing cards by matching exact front/back when possible.
  const existing = new Map(deck.cards.map(c => [`${c.front}__${c.back}`, c]));
  const nextCards = [];
  for (const [front, back] of pairs) {
    const key = `${front}__${back}`;
    const found = existing.get(key);
    if (found) nextCards.push(found);
    else nextCards.push(newCard(front, back));
  }

  deck.name = newName;
  deck.cards = nextCards;
  saveState();
  setNotice(ui.editStatus, 'Saved. The grove approves.');
  renderAll();
}

function deleteActiveDeck() {
  const deck = getActiveDeck();
  if (!deck) return;
  const ok = confirm(`Delete deck "${deck.name}"? This cannot be undone.`);
  if (!ok) return;
  state.decks = state.decks.filter(d => d.id !== deck.id);
  state.activeDeckId = state.decks[0]?.id || null;
  saveState();
  closeDialog(ui.dlgEdit);
  renderAll();
}

function exportActiveDeck() {
  const deck = getActiveDeck();
  if (!deck) return;

  const payload = {
    kind: 'sfg-deck',
    version: 1,
    exportedAt: new Date().toISOString(),
    deck: {
      name: deck.name,
      cards: deck.cards.map(c => ({ front: c.front, back: c.back })),
    }
  };
  const json = JSON.stringify(payload, null, 2);

  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${deck.name.replace(/[^a-z0-9\-\_]+/gi,'-').slice(0,40) || 'deck'}.sfg.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);

  // Also copy CSV as a convenience.
  const csv = deck.cards.map(c => `${csvEscape(c.front)},${csvEscape(c.back)}`).join('\n');
  navigator.clipboard?.writeText(csv).catch(()=>{});
}

function csvEscape(s) {
  const t = (s ?? '').toString().replace(/\r?\n/g,' ');
  if (/[\",\n]/.test(t)) return `"${t.replace(/"/g,'""')}"`;
  return t;
}

function buildShareUrl(deck) {
  const data = {
    v: 1,
    name: deck.name,
    cards: deck.cards.map(c => ({ f: c.front, b: c.back })),
  };

  const json = JSON.stringify(data);
  const b64 = base64UrlEncode(utf8Encode(json));
  const url = new URL(location.href);
  url.hash = `share=${b64}`;
  return url.toString();
}

function renderQr(text, canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // qrcode-generator provides a global `qrcode` function.
  // Type 0 = auto.
  let qr;
  try {
    // @ts-ignore
    qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
  } catch {
    // If the library is missing, fail silently.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const count = qr.getModuleCount();
  const quiet = 3;
  const modules = count + quiet * 2;

  // Fit modules into the canvas.
  const size = Math.min(canvas.width, canvas.height);
  const scale = Math.floor(size / modules);
  const drawSize = scale * modules;
  const ox = Math.floor((canvas.width - drawSize) / 2);
  const oy = Math.floor((canvas.height - drawSize) / 2);

  // Background
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Modules
  ctx.fillStyle = '#0d1b12';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (!qr.isDark(r, c)) continue;
      const x = ox + (c + quiet) * scale;
      const y = oy + (r + quiet) * scale;
      ctx.fillRect(x, y, scale, scale);
    }
  }
}

function openShareDialog() {
  const deck = getActiveDeck();
  if (!deck) return;

  const url = buildShareUrl(deck);
  ui.shareUrl.value = url;
  renderQr(url, ui.shareQr);
  setNotice(ui.shareStatus, '');
  ui.shareStatus.hidden = true;

  openDialog(ui.dlgShare);

  // Best-effort: copy immediately for convenience.
  navigator.clipboard?.writeText(url).then(() => {
    setNotice(ui.shareStatus, 'Link copied.');
  }).catch(() => {
    // ignore
  });
}

function utf8Encode(str) {
  return new TextEncoder().encode(str);
}

function base64UrlEncode(bytes) {
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  const b64 = btoa(bin);
  return b64.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function base64UrlDecodeToBytes(s) {
  const pad = '==='.slice((s.length + 3) % 4);
  const b64 = (s + pad).replace(/-/g,'+').replace(/_/g,'/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function maybeHandleSharedDeck() {
  const h = location.hash || '';
  if (!h.startsWith('#share=')) return;
  const encoded = h.slice('#share='.length);
  try {
    const bytes = base64UrlDecodeToBytes(encoded);
    const json = new TextDecoder().decode(bytes);
    const data = JSON.parse(json);
    if (!data || data.v !== 1 || !Array.isArray(data.cards)) return;

    // create a new deck (read-only import)
    const name = (data.name || 'Shared deck').toString().slice(0, 60);
    const d = createDeck(`${name} (shared)`);
    d.cards = data.cards.slice(0, 600).map((c) => newCard(c.f || '', c.b || ''));

    state.decks.push(d);
    state.activeDeckId = d.id;
    saveState();

    // remove hash for cleanliness
    history.replaceState(null, '', location.pathname + location.search);

    alert('Shared deck planted into your grove.');
  } catch {
    // ignore
  }
}

function doImport() {
  const raw = (ui.importText.value || '').trim();
  if (!raw) { setNotice(ui.importStatus, 'Paste some CSV/TSV or JSON first.'); return; }

  const targetId = ui.importDeck.value;
  const deck = state.decks.find(d => d.id === targetId) || getActiveDeck();
  if (!deck) { setNotice(ui.importStatus, 'No target deck found.'); return; }

  const normalize = !!ui.importNormalizeWs?.checked;

  /** @type {Array<[string,string]>} */
  let pairs = [];

  // JSON formats
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const data = JSON.parse(raw);
      if (data?.kind === 'sfg-deck' && data?.deck?.cards) {
        pairs = data.deck.cards.map(c => [c.front || '', c.back || '']);
      } else if (Array.isArray(data)) {
        pairs = data.map(r => [r.front || '', r.back || '']);
      }
    } catch {
      // not JSON
    }
  }

  // Delimited/text formats
  if (!pairs.length) {
    let delimiter = ui.importDelimiter?.value || 'auto';
    if (delimiter === 'auto') delimiter = detectDelimiter(raw);

    const rows = parseDelimited(raw, delimiter);
    const colCount = Math.max(1, ...rows.map(r => r.length));

    const frontIdx = clamp(parseInt(ui.importFrontCol?.value || '0', 10), 0, colCount - 1);
    const backIdxRaw = parseInt(ui.importBackCol?.value || (colCount >= 2 ? '1' : '-1'), 10);
    const backIdx = backIdxRaw >= 0 ? clamp(backIdxRaw, 0, colCount - 1) : -1;

    pairs = rows.map((r) => {
      const f0 = r[frontIdx] ?? '';
      const b0 = backIdx >= 0 ? (r[backIdx] ?? '') : '';
      const f = normalize ? normalizeWhitespace(f0) : (f0 ?? '').toString().trim();
      const b = normalize ? normalizeWhitespace(b0) : (b0 ?? '').toString().trim();
      return [f, b];
    });
  }

  pairs = pairs
    .map(([f, b]) => [String(f || '').trim(), String(b || '').trim()])
    .filter(([f, b]) => f.length || b.length)
    .slice(0, 800);

  if (!pairs.length) { setNotice(ui.importStatus, 'No cards found.'); return; }

  if (ui.importAppend.checked) {
    for (const [front, back] of pairs) deck.cards.push(newCard(front, back));
  } else {
    deck.cards = pairs.map(([front, back]) => newCard(front, back));
  }

  state.activeDeckId = deck.id;
  saveState();
  setNotice(ui.importStatus, `Imported ${pairs.length} cards into “${deck.name}”.`);
  renderAll();
}

function plantNewDeck() {
  const name = prompt('Name your new deck (be gentle):', 'New deck');
  if (name == null) return;
  const d = createDeck(name);
  d.cards = [newCard('Front', 'Back')];
  state.decks.push(d);
  state.activeDeckId = d.id;
  saveState();
  renderAll();
  openEdit();
}

function renderAll() {
  normalizeTodayCounter();
  renderCard();
  renderDeckGrid();
  renderDeckListDialog();
  updateImportDeckOptions();
}

// Events
ui.btnDeck.addEventListener('click', () => { renderDeckListDialog(); openDialog(ui.dlgDeck); });
ui.dlgNewDeck.addEventListener('click', () => plantNewDeck());
ui.btnNewDeck.addEventListener('click', () => plantNewDeck());

ui.btnImport.addEventListener('click', () => {
  ui.importText.value = '';
  if (ui.importDelimiter) ui.importDelimiter.value = 'auto';
  if (ui.importNormalizeWs) ui.importNormalizeWs.checked = true;
  setNotice(ui.importStatus, '');
  setNotice(ui.importWarnings, '');
  if (ui.importPreview) ui.importPreview.innerHTML = '';
  updateImportDeckOptions();
  openDialog(ui.dlgImport);
  updateImportPreview();
});

ui.importText?.addEventListener('input', () => updateImportPreview());
ui.importDelimiter?.addEventListener('change', () => updateImportPreview());
ui.importNormalizeWs?.addEventListener('change', () => updateImportPreview());
ui.importFrontCol?.addEventListener('change', () => updateImportPreview());
ui.importBackCol?.addEventListener('change', () => updateImportPreview());

ui.btnDoImport.addEventListener('click', () => doImport());
ui.btnExport.addEventListener('click', () => exportActiveDeck());
ui.btnShare.addEventListener('click', () => openShareDialog());
ui.btnHelp.addEventListener('click', () => openDialog(ui.dlgHelp));

ui.btnCopyShare.addEventListener('click', () => {
  const url = ui.shareUrl.value || '';
  if (!url) return;
  navigator.clipboard?.writeText(url).then(() => {
    setNotice(ui.shareStatus, 'Link copied.');
  }).catch(() => {
    setNotice(ui.shareStatus, 'Could not copy automatically. Select and copy the link manually.');
  });
});

ui.btnDownloadQr.addEventListener('click', async () => {
  const c = ui.shareQr;
  if (!c) return;
  try {
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('no blob');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sloth-flashcard-grove-qr.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch {
    setNotice(ui.shareStatus, 'Could not download QR in this browser.');
  }
});

ui.btnShareNative.addEventListener('click', async () => {
  const url = ui.shareUrl.value || '';
  const deck = getActiveDeck();
  if (!url) return;
  if (!navigator.share) {
    setNotice(ui.shareStatus, 'Native sharing is not available here. Use Copy link instead.');
    return;
  }
  try {
    await navigator.share({
      title: 'Sloth Flashcard Grove — shared deck',
      text: deck ? `Shared deck: ${deck.name}` : 'Shared deck',
      url,
    });
  } catch {
    // user cancelled or failed
  }
});

ui.btnFlip.addEventListener('click', () => flip());
ui.btnSpeak.addEventListener('click', () => { if (CAN_SPEAK) speakVisibleSide(); });
ui.btnStopSpeak.addEventListener('click', () => { if (CAN_SPEAK) stopSpeak(); });
ui.btnAgain.addEventListener('click', () => grade(0));
ui.btnHard.addEventListener('click', () => grade(1));
ui.btnGood.addEventListener('click', () => grade(2));
ui.btnEasy.addEventListener('click', () => grade(3));

ui.btnAdd.addEventListener('click', () => openEdit());
ui.btnEdit.addEventListener('click', () => openEdit());
ui.btnSaveDeck.addEventListener('click', () => saveEdit());
ui.btnDeleteDeck.addEventListener('click', () => deleteActiveDeck());
ui.btnResetDay.addEventListener('click', () => {
  state.today = { date: todayISO(), reviewed: 0 };
  saveState();
  renderAll();
});

window.addEventListener('keydown', (e) => {
  if (ui.dlgEdit.open || ui.dlgImport.open || ui.dlgDeck.open || ui.dlgHelp.open) return;

  if (e.key === ' ') { e.preventDefault(); flip(); }
  if (e.key === '1') grade(0);
  if (e.key === '2') grade(1);
  if (e.key === '3') grade(2);
  if (e.key === '4') grade(3);

  // Read aloud (accessibility / hands-free)
  if ((e.key === 'r' || e.key === 'R') && CAN_SPEAK) { e.preventDefault(); speakVisibleSide(); }
  if ((e.key === 's' || e.key === 'S') && CAN_SPEAK) { e.preventDefault(); stopSpeak(); }
});

// SW
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  });
}

maybeHandleSharedDeck();
renderAll();
