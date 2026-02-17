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
  btnAnalytics: $('btnAnalytics'),
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

  dlgAnalytics: $('dlgAnalytics'),
  analyticsEmpty: $('analyticsEmpty'),
  analyticsBody: $('analyticsBody'),
  statCards: $('statCards'),
  statDueNow: $('statDueNow'),
  statLapses: $('statLapses'),
  statDaily: $('statDaily'),
  chartDue30: $('chartDue30'),
  chartEase: $('chartEase'),
  btnRefreshAnalytics: $('btnRefreshAnalytics'),

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

// --- Analytics (no external libs; inline SVG) ---
const DAY_MS = 24 * 60 * 60 * 1000;
function startOfTodayMs() {
  const d = new Date();
  d.setHours(0,0,0,0);
  return d.getTime();
}

function svgBarChart({ values, labels, height = 120, barColor = 'rgba(137,211,165,.75)', gridColor = 'rgba(255,255,255,.10)' }) {
  const n = values.length;
  const max = Math.max(1, ...values);
  const w = Math.max(320, n * 14);
  const padL = 28;
  const padR = 12;
  const padT = 10;
  const padB = 22;
  const plotW = w - padL - padR;
  const plotH = height - padT - padB;
  const barW = plotW / n;

  const grid = [0.25, 0.5, 0.75, 1].map((f) => {
    const y = padT + plotH * (1 - f);
    const v = Math.round(max * f);
    return `
      <line x1="${padL}" y1="${y}" x2="${w-padR}" y2="${y}" stroke="${gridColor}" stroke-width="1" />
      <text x="${padL-6}" y="${y+4}" text-anchor="end" font-size="10" fill="rgba(255,255,255,.55)" font-family="var(--sans)">${v}</text>`;
  }).join('');

  const bars = values.map((v, i) => {
    const bh = Math.round((v / max) * plotH);
    const x = padL + i * barW + 1;
    const y = padT + (plotH - bh);
    const bw = Math.max(1, Math.floor(barW - 2));
    const rx = 3;
    const lbl = labels?.[i] || '';
    const title = `${lbl || i}: ${v}`;
    return `
      <g>
        <title>${escapeHtml(title)}</title>
        <rect x="${x}" y="${y}" width="${bw}" height="${Math.max(1,bh)}" rx="${rx}" fill="${barColor}" />
      </g>`;
  }).join('');

  const xlabels = labels ? labels.map((lbl, i) => {
    if (!lbl) return '';
    // show only some labels to avoid clutter
    const show = (i === 0) || (i === labels.length - 1) || (labels.length <= 10) || (i % 5 === 0);
    if (!show) return '';
    const x = padL + i * barW + barW / 2;
    return `<text x="${x}" y="${height-6}" text-anchor="middle" font-size="10" fill="rgba(255,255,255,.55)" font-family="var(--sans)">${escapeHtml(lbl)}</text>`;
  }).join('') : '';

  return `
    <svg viewBox="0 0 ${w} ${height}" width="100%" height="${height}" role="img" aria-hidden="false" focusable="false">
      ${grid}
      ${bars}
      ${xlabels}
    </svg>`;
}

function escapeHtml(s) {
  return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}

function renderAnalytics() {
  const deck = getActiveDeck();
  if (!deck) {
    setNotice(ui.analyticsEmpty, 'Plant or select a deck first.');
    ui.analyticsBody.hidden = true;
    return;
  }

  ui.analyticsBody.hidden = false;
  setNotice(ui.analyticsEmpty, '');

  const tNow = nowMs();
  const cards = deck.cards || [];
  const dueNow = cards.filter(c => c.srs.due <= tNow).length;
  const lapses = cards.reduce((acc, c) => acc + (c.srs.lapses || 0), 0);

  // Due histogram next 30 days (bar 0 = today + overdue)
  const days = 30;
  const t0 = startOfTodayMs();
  const dueBins = Array.from({ length: days }, () => 0);
  for (const c of cards) {
    const due = c?.srs?.due ?? tNow;
    let idx = 0;
    if (due > tNow) {
      idx = Math.floor((due - t0) / DAY_MS);
      idx = clamp(idx, 0, days - 1);
    }
    dueBins[idx] += 1;
  }

  const totalDue7 = dueBins.slice(0, 7).reduce((a,b)=>a+b, 0);
  const suggestedDaily = Math.max(1, Math.ceil(totalDue7 / 7));

  ui.statCards.textContent = String(cards.length);
  ui.statDueNow.textContent = String(dueNow);
  ui.statLapses.textContent = String(lapses);
  ui.statDaily.textContent = String(suggestedDaily);

  const labels30 = Array.from({ length: days }, (_, i) => i === 0 ? '0' : String(i));
  ui.chartDue30.innerHTML = svgBarChart({ values: dueBins, labels: labels30, height: 130, barColor: 'rgba(255,209,138,.70)' });

  // Ease distribution buckets
  const buckets = [0,0,0,0,0];
  const bucketLabels = ['<1.6', '1.6–2.0', '2.0–2.4', '2.4–2.8', '≥2.8'];
  for (const c of cards) {
    const e = Number(c?.srs?.ease ?? 2.5);
    if (e < 1.6) buckets[0]++;
    else if (e < 2.0) buckets[1]++;
    else if (e < 2.4) buckets[2]++;
    else if (e < 2.8) buckets[3]++;
    else buckets[4]++;
  }
  ui.chartEase.innerHTML = svgBarChart({ values: buckets, labels: bucketLabels, height: 120, barColor: 'rgba(137,211,165,.75)' });
}

function openAnalytics() {
  renderAnalytics();
  openDialog(ui.dlgAnalytics);
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
  const text = (ui.importText.value || '').trim();
  if (!text) { setNotice(ui.importStatus, 'Paste some CSV or JSON first.'); return; }

  const targetId = ui.importDeck.value;
  const deck = state.decks.find(d => d.id === targetId) || getActiveDeck();
  if (!deck) { setNotice(ui.importStatus, 'No target deck found.'); return; }

  let cards = [];

  // Try JSON format
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const data = JSON.parse(text);
      if (data?.kind === 'sfg-deck' && data?.deck?.cards) {
        cards = data.deck.cards.map(c => [c.front || '', c.back || '']);
      } else if (Array.isArray(data)) {
        cards = data.map(r => [r.front || '', r.back || '']);
      } else {
        setNotice(ui.importStatus, 'JSON parsed but format not recognized.');
        return;
      }
    } catch {
      // fall through to CSV
    }
  }

  if (!cards.length) {
    // CSV: front,back (commas inside quotes allowed-ish)
    cards = parseCsv(text);
  }

  cards = cards
    .map(([f,b]) => [String(f||'').trim(), String(b||'').trim()])
    .filter(([f,b]) => f.length || b.length)
    .slice(0, 800);

  if (!cards.length) { setNotice(ui.importStatus, 'No cards found.'); return; }

  if (ui.importAppend.checked) {
    for (const [front, back] of cards) deck.cards.push(newCard(front, back));
  } else {
    deck.cards = cards.map(([front, back]) => newCard(front, back));
  }

  state.activeDeckId = deck.id;
  saveState();
  setNotice(ui.importStatus, `Imported ${cards.length} cards into “${deck.name}”.`);
  renderAll();
}

function parseCsv(text) {
  // very small CSV parser for two columns
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = [];
    let cur = '';
    let inQ = false;
    for (let i=0;i<trimmed.length;i++) {
      const ch = trimmed[i];
      if (ch === '"') {
        if (inQ && trimmed[i+1] === '"') { cur += '"'; i++; continue; }
        inQ = !inQ;
        continue;
      }
      if (ch === ',' && !inQ) { row.push(cur); cur=''; continue; }
      cur += ch;
    }
    row.push(cur);
    const front = row[0] ?? '';
    const back = row.slice(1).join(',') ?? '';
    out.push([front, back]);
  }
  return out;
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

ui.btnImport.addEventListener('click', () => { ui.importText.value=''; setNotice(ui.importStatus,''); updateImportDeckOptions(); openDialog(ui.dlgImport); });
ui.btnDoImport.addEventListener('click', () => doImport());
ui.btnExport.addEventListener('click', () => exportActiveDeck());
ui.btnShare.addEventListener('click', () => openShareDialog());
ui.btnAnalytics.addEventListener('click', () => openAnalytics());
ui.btnRefreshAnalytics.addEventListener('click', () => renderAnalytics());
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
  if (ui.dlgEdit.open || ui.dlgImport.open || ui.dlgDeck.open || ui.dlgShare.open || ui.dlgAnalytics.open || ui.dlgHelp.open) return;

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
