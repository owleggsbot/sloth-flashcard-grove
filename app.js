// Sloth Flashcard Grove — offline-first spaced repetition, local-only.

const STORAGE_KEY = 'sfg:v1';

/** @typedef {{id:string, front:string, back:string, createdAt:number, srs:{ease:number, intervalDays:number, reps:number, due:number, lapses:number}}} Card */
/** @typedef {{id:string, name:string, createdAt:number, cards:Card[]}} Deck */
/** @typedef {{version:1, activeDeckId:string|null, decks:Deck[], today:{date:string, reviewed:number}, stats?:{daily:Record<string,number>, bestStreak:number}}} State */

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
  btnSummary: $('btnSummary'),

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

  dlgSummary: $('dlgSummary'),
  summaryCanvas: $('summaryCanvas'),
  summaryText: $('summaryText'),
  btnCopySummary: $('btnCopySummary'),
  btnDownloadSummary: $('btnDownloadSummary'),
  summaryStatus: $('summaryStatus'),

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
    stats: { daily: {}, bestStreak: 0 },
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
    if (!parsed.stats || typeof parsed.stats !== 'object') parsed.stats = { daily: {}, bestStreak: 0 };
    if (!parsed.stats.daily || typeof parsed.stats.daily !== 'object') parsed.stats.daily = {};
    if (typeof parsed.stats.bestStreak !== 'number') parsed.stats.bestStreak = 0;
    // Keep today counter in sync with daily history.
    const t = todayISO();
    if (parsed.today.date !== t) {
      // Normalize to today; leave past daily entries intact.
      parsed.today = { date: t, reviewed: parsed.stats.daily[t] || 0 };
    } else {
      const v = parsed.stats.daily[t];
      if (typeof v === 'number') parsed.today.reviewed = v;
      else parsed.stats.daily[t] = parsed.today.reviewed || 0;
    }
    return parsed;
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function ensureStats() {
  if (!state.stats) state.stats = { daily: {}, bestStreak: 0 };
  if (!state.stats.daily) state.stats.daily = {};
  if (typeof state.stats.bestStreak !== 'number') state.stats.bestStreak = 0;
}

function normalizeTodayCounter() {
  ensureStats();
  const t = todayISO();
  if (state.today.date !== t) {
    state.today = { date: t, reviewed: state.stats.daily[t] || 0 };
  }
  if (typeof state.stats.daily[t] !== 'number') state.stats.daily[t] = state.today.reviewed || 0;
  state.today.reviewed = state.stats.daily[t] || 0;
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

function isoAddDays(iso, days) {
  const d = new Date(iso + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getDailyCount(iso) {
  ensureStats();
  const v = state.stats.daily[iso];
  return typeof v === 'number' ? v : 0;
}

function computeCurrentStreak() {
  normalizeTodayCounter();
  let s = 0;
  let day = todayISO();
  for (;;) {
    if (getDailyCount(day) <= 0) break;
    s += 1;
    day = isoAddDays(day, -1);
    // Hard cap to avoid infinite loops if someone has a huge history.
    if (s > 5000) break;
  }
  return s;
}

function computeBestStreak() {
  ensureStats();
  const dates = Object.keys(state.stats.daily).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (!dates.length) return 0;
  dates.sort();

  let best = 0;
  let cur = 0;
  let prev = '';

  for (const d of dates) {
    const has = (state.stats.daily[d] || 0) > 0;
    if (!has) { cur = 0; prev = d; continue; }

    if (!prev) {
      cur = 1;
    } else {
      const expected = isoAddDays(prev, 1);
      cur = (expected === d) ? (cur + 1) : 1;
    }

    if (cur > best) best = cur;
    prev = d;
  }

  return best;
}

function computeLastNDays(n) {
  normalizeTodayCounter();
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = isoAddDays(todayISO(), -i);
    out.push({ date: d, count: getDailyCount(d) });
  }
  return out;
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
  normalizeTodayCounter();
  const t = todayISO();
  state.stats.daily[t] = (state.stats.daily[t] || 0) + 1;
  state.today.reviewed = state.stats.daily[t];
  state.stats.bestStreak = Math.max(state.stats.bestStreak || 0, computeBestStreak());
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

function buildSessionSummaryText(deck) {
  normalizeTodayCounter();
  const reviewedToday = state.today.reviewed || 0;
  const totalCards = deck ? deck.cards.length : 0;
  const dueNow = deck ? countDue(deck) : 0;
  const currentStreak = computeCurrentStreak();
  const bestStreak = Math.max(state.stats?.bestStreak || 0, computeBestStreak());
  const last7 = computeLastNDays(7);
  const bars = last7.map(d => d.count);
  const max = Math.max(1, ...bars);
  const mini = bars.map(n => {
    const h = Math.round((n / max) * 8);
    return '▁▂▃▄▅▆▇█'[clamp(h, 0, 7)];
  }).join('');

  const deckName = deck ? deck.name : '—';
  return [
    `Sloth Flashcard Grove — session summary`,
    `Deck: ${deckName}`,
    `Reviewed today: ${reviewedToday}`,
    `Due now: ${dueNow} • Total cards: ${totalCards}`,
    `Streak: ${currentStreak} day(s) • Best: ${bestStreak}`,
    `Last 7 days: ${mini}`,
  ].join('\n');
}

function drawSummaryPostcard(ctx, w, h, deck) {
  normalizeTodayCounter();
  const reviewedToday = state.today.reviewed || 0;
  const totalCards = deck ? deck.cards.length : 0;
  const dueNow = deck ? countDue(deck) : 0;
  const currentStreak = computeCurrentStreak();
  const bestStreak = Math.max(state.stats?.bestStreak || 0, computeBestStreak());
  const last7 = computeLastNDays(7);

  // Background
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#21402e');
  g.addColorStop(1, '#0f2219');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Soft vignette
  const vg = ctx.createRadialGradient(w*0.35, h*0.25, 10, w*0.35, h*0.25, Math.max(w,h));
  vg.addColorStop(0, 'rgba(255,255,255,0.10)');
  vg.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);

  const pad = Math.round(w * 0.06);

  // Title
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = `600 ${Math.round(h*0.06)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
  ctx.textBaseline = 'top';
  ctx.fillText('Session summary', pad, pad);

  // Deck line
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `500 ${Math.round(h*0.045)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
  ctx.fillText(deck ? `Deck: ${deck.name}` : 'Deck: —', pad, pad + Math.round(h*0.085));

  // Stats block
  const statY = pad + Math.round(h*0.16);
  ctx.font = `500 ${Math.round(h*0.05)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
  const lines = [
    `Reviewed today: ${reviewedToday}`,
    `Due now: ${dueNow}   Total cards: ${totalCards}`,
    `Streak: ${currentStreak} day(s)   Best: ${bestStreak}`,
  ];
  lines.forEach((t, i) => ctx.fillText(t, pad, statY + i * Math.round(h*0.07)));

  // Sloth + leaves motif (simple vector)
  const cx = w - pad - Math.round(w*0.22);
  const cy = pad + Math.round(h*0.26);
  const r = Math.round(h*0.16);

  // Leafy halo
  ctx.save();
  ctx.translate(cx, cy);
  for (let i=0;i<8;i++) {
    const a = (i/8) * Math.PI * 2;
    ctx.rotate(a);
    ctx.beginPath();
    ctx.fillStyle = `rgba(129, 214, 138, ${0.22 + (i%2)*0.08})`;
    ctx.ellipse(r*0.9, 0, r*0.35, r*0.16, 0.4, 0, Math.PI*2);
    ctx.fill();
    ctx.rotate(-a);
  }
  ctx.restore();

  // Face
  ctx.beginPath();
  ctx.fillStyle = 'rgba(245, 236, 220, 0.92)';
  ctx.ellipse(cx, cy, r*1.05, r*0.95, 0, 0, Math.PI*2);
  ctx.fill();

  // Mask
  ctx.beginPath();
  ctx.fillStyle = 'rgba(100, 78, 62, 0.55)';
  ctx.ellipse(cx - r*0.35, cy + r*0.05, r*0.55, r*0.45, -0.15, 0, Math.PI*2);
  ctx.ellipse(cx + r*0.35, cy + r*0.05, r*0.55, r*0.45, 0.15, 0, Math.PI*2);
  ctx.fill();

  // Eyes
  ctx.fillStyle = 'rgba(20,20,20,0.85)';
  ctx.beginPath();
  ctx.arc(cx - r*0.32, cy + r*0.02, r*0.08, 0, Math.PI*2);
  ctx.arc(cx + r*0.32, cy + r*0.02, r*0.08, 0, Math.PI*2);
  ctx.fill();

  // Smile
  ctx.strokeStyle = 'rgba(60,40,30,0.6)';
  ctx.lineWidth = Math.max(2, Math.round(h*0.006));
  ctx.beginPath();
  ctx.arc(cx, cy + r*0.18, r*0.25, 0.15*Math.PI, 0.85*Math.PI);
  ctx.stroke();

  // Last 7 days mini-chart
  const chartW = Math.round(w * 0.55);
  const chartH = Math.round(h * 0.16);
  const chartX = pad;
  const chartY = h - pad - chartH;

  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  const rr = Math.round(h*0.02);
  ctx.beginPath();
  // Rounded rect path (avoid relying on ctx.roundRect)
  ctx.moveTo(chartX + rr, chartY);
  ctx.lineTo(chartX + chartW - rr, chartY);
  ctx.quadraticCurveTo(chartX + chartW, chartY, chartX + chartW, chartY + rr);
  ctx.lineTo(chartX + chartW, chartY + chartH - rr);
  ctx.quadraticCurveTo(chartX + chartW, chartY + chartH, chartX + chartW - rr, chartY + chartH);
  ctx.lineTo(chartX + rr, chartY + chartH);
  ctx.quadraticCurveTo(chartX, chartY + chartH, chartX, chartY + chartH - rr);
  ctx.lineTo(chartX, chartY + rr);
  ctx.quadraticCurveTo(chartX, chartY, chartX + rr, chartY);
  ctx.closePath();
  ctx.fill();

  const max = Math.max(1, ...last7.map(d => d.count));
  const barGap = Math.round(chartW * 0.02);
  const barW = Math.floor((chartW - barGap * 8) / 7);

  for (let i=0;i<7;i++) {
    const v = last7[i].count;
    const bh = Math.round((v / max) * (chartH - Math.round(h*0.05)));
    const x = chartX + barGap + i * (barW + barGap);
    const y = chartY + chartH - barGap - bh;

    ctx.fillStyle = 'rgba(129, 214, 138, 0.85)';
    ctx.fillRect(x, y, barW, bh);
  }

  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.font = `500 ${Math.round(h*0.035)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
  ctx.fillText('Last 7 days', chartX + Math.round(h*0.03), chartY + Math.round(h*0.02));

  // Footer brand
  ctx.fillStyle = 'rgba(255,255,255,0.70)';
  ctx.font = `500 ${Math.round(h*0.032)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
  ctx.fillText('Sloth Flashcard Grove • offline-first', pad, h - pad + Math.round(h*0.01));
}

function renderSummaryPreview() {
  const deck = getActiveDeck();
  ui.summaryText.value = buildSessionSummaryText(deck);
  setNotice(ui.summaryStatus, '');

  const c = ui.summaryCanvas;
  const ctx = c?.getContext('2d');
  if (!c || !ctx) return;
  ctx.clearRect(0, 0, c.width, c.height);
  drawSummaryPostcard(ctx, c.width, c.height, deck);
}

function openSummaryDialog() {
  renderSummaryPreview();
  openDialog(ui.dlgSummary);
}

async function downloadSummaryPng() {
  const deck = getActiveDeck();
  const w = 1200;
  const h = 630;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  drawSummaryPostcard(ctx, w, h, deck);

  try {
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('no blob');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const safeDeck = (deck?.name || 'deck').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,40);
    a.download = `sfg-session-summary-${safeDeck || 'deck'}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch {
    setNotice(ui.summaryStatus, 'Could not download PNG in this browser.');
  }
}

// Events
ui.btnDeck.addEventListener('click', () => { renderDeckListDialog(); openDialog(ui.dlgDeck); });
ui.dlgNewDeck.addEventListener('click', () => plantNewDeck());
ui.btnNewDeck.addEventListener('click', () => plantNewDeck());

ui.btnImport.addEventListener('click', () => { ui.importText.value=''; setNotice(ui.importStatus,''); updateImportDeckOptions(); openDialog(ui.dlgImport); });
ui.btnDoImport.addEventListener('click', () => doImport());
ui.btnExport.addEventListener('click', () => exportActiveDeck());
ui.btnShare.addEventListener('click', () => openShareDialog());
ui.btnSummary.addEventListener('click', () => openSummaryDialog());
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

ui.btnCopySummary.addEventListener('click', () => {
  const text = ui.summaryText.value || '';
  if (!text) return;
  navigator.clipboard?.writeText(text).then(() => {
    setNotice(ui.summaryStatus, 'Copied.');
  }).catch(() => {
    setNotice(ui.summaryStatus, 'Could not copy automatically. Select and copy the text manually.');
  });
});

ui.btnDownloadSummary.addEventListener('click', async () => {
  await downloadSummaryPng();
});

ui.dlgSummary.addEventListener('close', () => {
  // Clear any transient notices.
  setNotice(ui.summaryStatus, '');
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
  ensureStats();
  const t = todayISO();
  state.stats.daily[t] = 0;
  state.today = { date: t, reviewed: 0 };
  saveState();
  renderAll();
});

window.addEventListener('keydown', (e) => {
  if (ui.dlgEdit.open || ui.dlgImport.open || ui.dlgDeck.open || ui.dlgShare.open || ui.dlgSummary.open || ui.dlgHelp.open) return;

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
