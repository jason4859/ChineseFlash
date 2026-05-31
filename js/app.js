/**
 * app.js — Flashcard app logic
 *
 * Depends on: js/cards.js (must be loaded first via index.html)
 *
 * Features:
 *  - Category filtering
 *  - Card flip animation
 *  - Navigation (prev / next)
 *  - Shuffle
 *  - Known / Still-learning tracking
 *  - Dynamic vocab import with localStorage persistence
 *  - PWA service worker registration
 */

'use strict';

// ── State ─────────────────────────────────────────────────────

let ALL_CARDS = loadAllCards();
let activeCat  = 'All';
let deck       = [...ALL_CARDS];
let index      = 0;
let isFlipped  = false;
let known      = new Set();
let unknown    = new Set();

// ── Persistence ───────────────────────────────────────────────

/**
 * Merge seed cards (cards.js) with any user-imported cards saved in
 * localStorage, deduplicating on zh + cat.
 */
function loadAllCards() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem('flashcards') || '[]'); } catch {}
  const seen   = new Set(SEED_CARDS.map(c => c.zh + c.cat));
  const extras = saved.filter(c => !seen.has(c.zh + c.cat));
  return [...SEED_CARDS, ...extras];
}

/** Persist only the user-added cards (seed cards live in cards.js). */
function saveExtraCards() {
  const extras = ALL_CARDS.filter(
    c => !SEED_CARDS.some(s => s.zh === c.zh && s.cat === c.cat)
  );
  localStorage.setItem('flashcards', JSON.stringify(extras));
}

// ── Categories ────────────────────────────────────────────────

function getCategories() {
  return ['All', ...new Set(ALL_CARDS.map(c => c.cat))];
}

function buildCategoryButtons() {
  const container = document.getElementById('categories');
  container.innerHTML = '';
  getCategories().forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'cat-btn' + (cat === activeCat ? ' active' : '');
    btn.textContent = cat;
    btn.onclick = () => selectCategory(cat);
    container.appendChild(btn);
  });
}

function selectCategory(cat) {
  activeCat = cat;
  deck = cat === 'All' ? [...ALL_CARDS] : ALL_CARDS.filter(c => c.cat === cat);
  index = 0;
  known.clear();
  unknown.clear();
  buildCategoryButtons();
  showCard();
}

// ── Card display ──────────────────────────────────────────────

function showCard() {
  if (!deck.length) return;

  const card = document.getElementById('card');
  isFlipped = false;
  card.classList.remove('flipped');
  document.getElementById('feedbackBtns').style.display = 'none';

  const current = deck[index];
  document.getElementById('frontWord').textContent   = current.en;
  document.getElementById('frontCat').textContent    = current.cat;
  document.getElementById('backChars').textContent   = current.zh;
  document.getElementById('backPinyin').textContent  = current.pinyin;
  document.getElementById('backEnglish').textContent = current.en;

  const pct = ((index + 1) / deck.length) * 100;
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('counter').textContent     = `Card ${index + 1} of ${deck.length}`;
  document.getElementById('btnPrev').disabled        = index === 0;
  document.getElementById('btnNext').disabled        = index === deck.length - 1;

  updateStats();
}

function updateStats() {
  document.getElementById('statTotal').textContent   = deck.length;
  document.getElementById('statKnown').textContent   = known.size;
  document.getElementById('statUnknown').textContent = unknown.size;
}

// ── Card interactions ─────────────────────────────────────────

function flipCard() {
  isFlipped = !isFlipped;
  document.getElementById('card').classList.toggle('flipped', isFlipped);
  document.getElementById('feedbackBtns').style.display = isFlipped ? 'flex' : 'none';
}

function navigate(dir) {
  const next = index + dir;
  if (next < 0 || next >= deck.length) return;
  index = next;
  showCard();
}

function shuffle() {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  index = 0;
  known.clear();
  unknown.clear();
  showCard();
}

function markCard(isKnown) {
  const key = deck[index].en;
  if (isKnown) { known.add(key); unknown.delete(key); }
  else         { unknown.add(key); known.delete(key); }

  if (index < deck.length - 1) {
    index++;
    showCard();
  } else {
    updateStats();
    document.getElementById('feedbackBtns').style.display = 'none';
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────

document.addEventListener('keydown', e => {
  switch (e.key) {
    case 'ArrowLeft':  navigate(-1);  break;
    case 'ArrowRight': navigate(1);   break;
    case ' ':
    case 'Enter':      flipCard();    break;
  }
});

// ── Import panel ──────────────────────────────────────────────

function toggleImport() {
  document.getElementById('importPanel').classList.toggle('open');
}

function clearImportField() {
  document.getElementById('importText').value = '';
  document.getElementById('importFeedback').textContent = '';
}

/**
 * Parse a single line of pasted vocab.
 *
 * Supported formats:
 *   A)  汉字（pīnyīn）<TAB>English
 *   B)  汉字<TAB>pīnyīn<TAB>English
 *
 * Returns { zh, pinyin, en } or null if unparseable.
 */
function parseLine(line) {
  line = line.trim();
  if (!line) return null;

  // Format A — fullwidth or halfwidth parentheses
  const fmtA = line.match(/^([^（）()]+)[（(]([^）)]+)[）)]\s*\t+\s*(.+)$/);
  if (fmtA) return { zh: fmtA[1].trim(), pinyin: fmtA[2].trim(), en: fmtA[3].trim() };

  // Format B — three tab-separated columns
  const parts = line.split(/\t/);
  if (parts.length >= 3) return { zh: parts[0].trim(), pinyin: parts[1].trim(), en: parts[2].trim() };

  return null;
}

function importCards() {
  const fb  = document.getElementById('importFeedback');
  const raw = document.getElementById('importText').value;
  const cat = document.getElementById('importCat').value.trim();

  if (!cat) {
    fb.className = 'import-feedback error';
    fb.textContent = 'Please enter a category name.';
    return;
  }

  const lines   = raw.split('\n');
  const parsed  = [];
  const skipped = [];

  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const result = parseLine(line);
    if (result) parsed.push({ ...result, cat });
    else        skipped.push(i + 1);
  });

  if (!parsed.length) {
    fb.className = 'import-feedback error';
    fb.textContent = 'No cards could be parsed. Check the format and try again.';
    return;
  }

  const existing = new Set(ALL_CARDS.map(c => c.zh + c.cat));
  const fresh    = parsed.filter(c => !existing.has(c.zh + c.cat));

  if (!fresh.length) {
    fb.className = 'import-feedback error';
    fb.textContent = 'All cards already exist in the deck.';
    return;
  }

  ALL_CARDS = [...ALL_CARDS, ...fresh];
  saveExtraCards();

  activeCat = cat;
  deck      = ALL_CARDS.filter(c => c.cat === cat);
  index     = 0;
  known.clear();
  unknown.clear();
  buildCategoryButtons();
  showCard();

  const skipMsg = skipped.length
    ? ` (${skipped.length} line${skipped.length > 1 ? 's' : ''} skipped)`
    : '';
  fb.className  = 'import-feedback';
  fb.textContent = `✓ Added ${fresh.length} card${fresh.length > 1 ? 's' : ''} to "${cat}"${skipMsg}.`;
  document.getElementById('importText').value = '';
}

// ── PWA service worker ────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ── Init ──────────────────────────────────────────────────────

buildCategoryButtons();
showCard();
