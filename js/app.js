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

let ALL_CARDS  = loadAllCards();
let activeCat  = 'All';
let deck       = [...ALL_CARDS];
let index      = 0;
let isFlipped  = false;
let known      = new Set();
let unknown    = new Set();
let studyMode  = 'all'; // 'all' | 'due'
let frontLang  = 'en';  // 'en'  | 'zh'

// ── Card stats (persistent progress tracking) ─────────────────

let cardStats = (() => {
  try { return JSON.parse(localStorage.getItem('cardStats') || '{}'); } catch { return {}; }
})();

function getCardKey(card) {
  return card.zh + '|' + card.cat;
}

/**
 * Returns one of: 'known' | 'practice' | 'struggling' | 'unseen'
 * SRS-aware when SM-2 data is present; falls back to legacy counts.
 *
 * - known:      SRS mature (interval ≥ 21d) OR legacy correct≥1 wrong=0
 * - practice:   SRS young  (interval 1-20d)  OR legacy correct≥1 wrong≥1
 * - struggling: SRS lapsed              OR legacy wrong≥3
 * - unseen:     never reviewed
 */
function getCardState(key) {
  const s = cardStats[key];
  if (!s) return 'unseen';
  if (s.interval !== undefined) {           // SRS mode
    if (s.repetitions === 0) return s.lapses > 0 ? 'struggling' : 'unseen';
    if (s.interval >= 21)    return 'known';
    if (s.lapses    >  0)    return 'struggling';
    return 'practice';
  }
  // Legacy fallback
  if (s.correct >= 1 && s.wrong === 0) return 'known';
  if (s.correct >= 1 && s.wrong >= 1)  return 'practice';
  if (s.wrong   >= 3)                  return 'struggling';
  return 'unseen';
}

function getProgressCounts() {
  const counts = { known: 0, practice: 0, struggling: 0, unseen: 0 };
  ALL_CARDS.forEach(c => counts[getCardState(getCardKey(c))]++);
  return counts;
}

function updateProgressWidget() {
  const total  = ALL_CARDS.length || 1;
  const counts = getProgressCounts();

  const pct = k => ((counts[k] / total) * 100).toFixed(1) + '%';
  document.getElementById('pwSegKnown').style.width      = pct('known');
  document.getElementById('pwSegPractice').style.width   = pct('practice');
  document.getElementById('pwSegStruggling').style.width = pct('struggling');
  document.getElementById('pwSegUnseen').style.width     = pct('unseen');

  document.getElementById('pwCountKnown').textContent      = counts.known;
  document.getElementById('pwCountPractice').textContent   = counts.practice;
  document.getElementById('pwCountStruggling').textContent = counts.struggling;
  document.getElementById('pwCountUnseen').textContent     = counts.unseen;
}

// ── Spaced Repetition — SM-2 ──────────────────────────────────

/**
 * Core SM-2 algorithm (Anki variant).
 * rating: 1=Again  2=Hard  3=Good  4=Easy
 * Returns a new stat object with updated SRS fields.
 */
function sm2(stat, rating) {
  let interval    = stat.interval    ?? 0;
  let easeFactor  = stat.easeFactor  ?? 2.5;
  let repetitions = stat.repetitions ?? 0;
  let lapses      = stat.lapses      ?? 0;

  if (rating === 1) {                          // Again — forgot
    if (repetitions > 1) lapses++;             // lapse only if card was graduated
    repetitions = 0;
    interval    = 1;
  } else {
    if (repetitions === 0) {
      interval = (rating === 4) ? 4 : 1;
    } else if (repetitions === 1) {
      if      (rating === 2) interval = 3;
      else if (rating === 4) interval = 8;
      else                   interval = 6;
    } else {
      const base = Math.round(interval * easeFactor);
      if      (rating === 2) interval = Math.max(interval + 1, Math.round(base * 0.8));
      else if (rating === 4) interval = Math.round(base * 1.3);
      else                   interval = base;
    }
    repetitions++;
  }

  // SM-2 ease-factor update (q: Again→1, Hard→3, Good→4, Easy→5)
  const q = [0, 1, 3, 4, 5][rating];
  easeFactor = Math.max(1.3,
    easeFactor + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)
  );

  const due = new Date();
  due.setDate(due.getDate() + interval);

  return {
    interval,
    easeFactor: +easeFactor.toFixed(3),
    repetitions,
    lapses,
    dueDate: due.toISOString().split('T')[0],
    // Preserve legacy fields for backward compat
    correct: (stat.correct ?? 0) + (rating >= 3 ? 1 : 0),
    wrong:   (stat.wrong   ?? 0) + (rating <= 2 ? 1 : 0),
  };
}

/** Preview next interval without committing. */
function previewInterval(stat, rating) {
  return sm2(stat || {}, rating).interval;
}

/** Human-readable interval label. */
function formatInterval(days) {
  if (days <= 1)  return '1d';
  if (days < 7)   return days + 'd';
  if (days < 30)  return Math.round(days / 7) + 'w';
  if (days < 365) return Math.round(days / 30) + 'mo';
  return Math.round(days / 365) + 'yr';
}

/** True if card is due today (or new). */
function isCardDue(card) {
  const s = cardStats[getCardKey(card)];
  if (!s || !s.dueDate) return true;
  return s.dueDate <= new Date().toISOString().split('T')[0];
}

function getDueCount(fromCards) {
  return (fromCards || ALL_CARDS).filter(isCardDue).length;
}

/** Refresh the "📅 Due: N" button label and state. */
function updateDueBadge() {
  const pool = activeCat === 'All'
    ? ALL_CARDS
    : ALL_CARDS.filter(c => c.cat === activeCat);
  const n   = getDueCount(pool);
  const el  = document.getElementById('dueCount');
  const btn = document.getElementById('btnStudyDue');
  if (el)  el.textContent = n;
  if (btn) {
    btn.disabled = (n === 0 && studyMode !== 'due');
    btn.classList.toggle('active', studyMode === 'due');
  }
}

/** Toggle due-card study mode. */
function enterDueMode() {
  if (studyMode === 'due') {
    // Exit — return to browse
    studyMode = 'all';
    deck  = activeCat === 'All' ? [...ALL_CARDS] : ALL_CARDS.filter(c => c.cat === activeCat);
    index = 0; known.clear(); unknown.clear();
    showCard(); updateDueBadge();
    return;
  }
  const pool = activeCat === 'All' ? ALL_CARDS : ALL_CARDS.filter(c => c.cat === activeCat);
  const due  = pool.filter(isCardDue);
  if (!due.length) return;
  studyMode = 'due';
  deck  = due;
  index = 0; known.clear(); unknown.clear();
  showCard(); updateDueBadge();
}

/** Update interval-preview labels on the four SRS buttons. */
function updateSrsButtons(card) {
  const stat = cardStats[getCardKey(card)] || {};
  ['Again', 'Hard', 'Good', 'Easy'].forEach((name, i) => {
    const el = document.getElementById('srs' + name);
    if (el) el.textContent = formatInterval(previewInterval(stat, i + 1));
  });
}

// ── Language direction toggle ──────────────────────────────────

/**
 * Apply the current frontLang to the card face visibility and button label.
 * Called by showCard() and toggleFrontLang().
 */
function applyLangMode() {
  const enFirst = frontLang === 'en';

  // Hints
  const fh = document.getElementById('frontHint');
  const bh = document.getElementById('backHint');
  if (fh) fh.textContent = enFirst ? 'English' : 'Chinese';
  if (bh) bh.textContent = enFirst ? 'Chinese' : 'English';

  // Front face
  const show = (id, vis) => { const el = document.getElementById(id); if (el) el.style.display = vis ? '' : 'none'; };
  show('frontEn',    enFirst);
  show('frontZh',   !enFirst);
  show('frontPinyin',!enFirst);

  // Back face
  show('backZh',       enFirst);
  show('backPinyin',   enFirst);
  show('backEnLabel',  enFirst);
  show('backEnWord',  !enFirst);

  // Toggle button label + style
  const btn = document.getElementById('btnLangToggle');
  if (btn) {
    btn.textContent = enFirst ? 'EN → 中' : '中 → EN';
    btn.classList.toggle('zh-first', !enFirst);
  }
}

function toggleFrontLang() {
  frontLang = frontLang === 'en' ? 'zh' : 'en';
  // Re-render current card from scratch (unflipped)
  if (deck.length) showCard();
  else applyLangMode();
}

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
  studyMode = 'all';
  deck = cat === 'All' ? [...ALL_CARDS] : ALL_CARDS.filter(c => c.cat === cat);
  index = 0;
  known.clear();
  unknown.clear();
  buildCategoryButtons();
  showCard();
  updateDueBadge();
}

// ── Card display ──────────────────────────────────────────────

function showCard() {
  if (!deck.length) return;

  const card = document.getElementById('card');
  isFlipped = false;
  card.classList.remove('flipped');
  document.getElementById('feedbackBtns').style.display = 'none';

  const current = deck[index];
  // Populate all card fields (visibility controlled by applyLangMode)
  document.getElementById('frontEn').textContent      = current.en;
  document.getElementById('frontZh').textContent      = current.zh;
  document.getElementById('frontPinyin').textContent  = current.pinyin;
  document.getElementById('frontCat').textContent     = current.cat;
  document.getElementById('backZh').textContent       = current.zh;
  document.getElementById('backPinyin').textContent   = current.pinyin;
  document.getElementById('backEnLabel').textContent  = current.en;
  document.getElementById('backEnWord').textContent   = current.en;
  applyLangMode();

  const pct = ((index + 1) / deck.length) * 100;
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('counter').textContent     = studyMode === 'due'
    ? `Due: ${index + 1} of ${deck.length}`
    : `Card ${index + 1} of ${deck.length}`;
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
  if (isFlipped && deck[index]) updateSrsButtons(deck[index]);
}

function navigate(dir) {
  const next = index + dir;
  if (next < 0 || next >= deck.length) return;
  index = next;
  showCard();
}

function shuffle() {
  studyMode = 'all';
  deck = activeCat === 'All' ? [...ALL_CARDS] : ALL_CARDS.filter(c => c.cat === activeCat);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  index = 0;
  known.clear();
  unknown.clear();
  showCard();
  updateDueBadge();
}

function markCard(rating) {
  // rating: 1=Again  2=Hard  3=Good  4=Easy
  const card = deck[index];
  const key  = getCardKey(card);

  // Apply SM-2 and persist
  cardStats[key] = sm2(cardStats[key] || {}, rating);
  localStorage.setItem('cardStats', JSON.stringify(cardStats));

  // Legacy session sets
  if (rating >= 3) { known.add(card.en); unknown.delete(card.en); }
  else             { unknown.add(card.en); known.delete(card.en); }

  updateProgressWidget();
  updateDueBadge();

  // ── Due-mode navigation ──────────────────────────────────────
  if (studyMode === 'due') {
    deck.splice(index, 1);
    if (rating === 1) deck.push(card); // Again → see it again this session

    if (!deck.length) {
      document.getElementById('feedbackBtns').style.display = 'none';
      document.getElementById('counter').textContent = '🎉 All due cards reviewed!';
      document.getElementById('progressBar').style.width = '100%';
      studyMode = 'all';
      updateDueBadge();
      return;
    }
    if (index >= deck.length) index = deck.length - 1;
    showCard();
    return;
  }

  // ── Browse-mode navigation ───────────────────────────────────
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
    case 'ArrowLeft':  navigate(-1); break;
    case 'ArrowRight': navigate(1);  break;
    case ' ':
    case 'Enter':      flipCard();   break;
    // SRS ratings (only when card is flipped)
    case '1': if (isFlipped) markCard(1); break; // Again
    case '2': if (isFlipped) markCard(2); break; // Hard
    case '3': if (isFlipped) markCard(3); break; // Good
    case '4': if (isFlipped) markCard(4); break; // Easy
  }
});

// ── Import panel ──────────────────────────────────────────────

// ── Panel toggles ─────────────────────────────────────────────

function toggleImport(panel) {
  const panels = {
    manual:  document.getElementById('importPanel'),
    youtube: document.getElementById('ytPanel'),
    hsk:     document.getElementById('hskPanel'),
    log:     document.getElementById('logPanel'),
  };
  const target = panels[panel];
  const isOpen = target.classList.contains('open');

  Object.values(panels).forEach(el => el.classList.remove('open'));
  if (!isOpen) {
    target.classList.add('open');
    if (panel === 'hsk') initHskPanel();
    if (panel === 'log') renderImportLog();
  }
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

function importCards(groupByHsk = false) {
  const fb  = document.getElementById('importFeedback');
  const raw = document.getElementById('importText').value;
  const cat = document.getElementById('importCat').value.trim();

  if (!cat && !groupByHsk) {
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
    if (result) {
      const assignedCat = groupByHsk
        ? (HSK_LOOKUP[result.zh] ? `HSK ${HSK_LOOKUP[result.zh]}` : (cat || 'Imported'))
        : cat;
      parsed.push({ ...result, cat: assignedCat });
    } else {
      skipped.push(i + 1);
    }
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

  const addedCat = fresh[0].cat;
  activeCat = addedCat;
  deck      = ALL_CARDS.filter(c => c.cat === addedCat);
  index     = 0;
  known.clear();
  unknown.clear();
  buildCategoryButtons();
  showCard();

  const cats    = [...new Set(fresh.map(c => c.cat))];
  const catLabel = cats.length === 1 ? `"${cats[0]}"` : cats.map(c => `"${c}"`).join(', ');
  const skipMsg  = skipped.length ? ` (${skipped.length} line${skipped.length > 1 ? 's' : ''} skipped)` : '';
  fb.className   = 'import-feedback';
  fb.textContent = `✓ Added ${fresh.length} card${fresh.length > 1 ? 's' : ''} to ${catLabel}${skipMsg}.`;
  document.getElementById('importText').value = '';
  cats.forEach(c => logImport('csv', c, fresh.filter(x => x.cat === c).length));
}

// ── Import history log ────────────────────────────────────────

function loadImportLog() {
  try { return JSON.parse(localStorage.getItem('importLog') || '[]'); } catch { return []; }
}

function saveImportLog(log) {
  localStorage.setItem('importLog', JSON.stringify(log));
}

function logImport(source, category, count) {
  const log = loadImportLog();
  log.unshift({ source, category, count, timestamp: new Date().toISOString() });
  saveImportLog(log.slice(0, 100)); // keep last 100 entries
}

function renderImportLog() {
  const log     = loadImportLog();
  const table   = document.getElementById('logTable');
  const empty   = document.getElementById('logEmpty');

  if (!log.length) {
    table.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  table.innerHTML = log.map(entry => {
    const d     = new Date(entry.timestamp);
    const date  = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const time  = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const src   = entry.source;
    const cls   = src === 'youtube' ? 'log-source-youtube' : src === 'hsk' ? 'log-source-hsk' : 'log-source-csv';
    const label = src === 'youtube' ? '▶ YouTube' : src === 'hsk' ? '📚 HSK' : '📄 CSV';
    return `
      <div class="log-row">
        <span class="log-source ${cls}">${label}</span>
        <span class="log-cat">${entry.category}</span>
        <span class="log-count">+${entry.count} word${entry.count !== 1 ? 's' : ''}</span>
        <span class="log-time">${date} ${time}</span>
      </div>`;
  }).join('');
}

function clearImportLog() {
  localStorage.removeItem('importLog');
  renderImportLog();
}

// ── HSK browser ───────────────────────────────────────────────

let activeHskLevel = 1;

function initHskPanel() {
  buildHskTabs();
  renderHskLevel(activeHskLevel);
}

function buildHskTabs() {
  const tabs = document.getElementById('hskLevelTabs');
  tabs.innerHTML = '';
  [1, 2, 3, 4, 5, 6].forEach(lvl => {
    const btn = document.createElement('button');
    btn.className = 'hsk-tab' + (lvl === activeHskLevel ? ' active' : '');
    btn.textContent = `HSK ${lvl} (${(HSK_DATA[lvl] || []).length})`;
    btn.onclick = () => { activeHskLevel = lvl; buildHskTabs(); renderHskLevel(lvl); };
    tabs.appendChild(btn);
  });
}

function renderHskLevel(lvl) {
  const words = HSK_DATA[lvl] || [];
  const table = document.getElementById('hskWordTable');
  const info  = document.getElementById('hskLevelInfo');
  const label = document.getElementById('hskAddLabel');

  info.textContent = `${words.length} words at HSK level ${lvl}`;
  label.textContent = lvl;

  table.innerHTML = words.map(w => `
    <div class="yt-preview-row">
      <span class="yt-zh">${w.zh}</span>
      <span class="yt-pinyin">${w.pinyin}</span>
      <span class="yt-en">${w.en}</span>
    </div>`).join('');
}

function addHskLevelToDeck() {
  const fb    = document.getElementById('hskFeedback');
  const lvl   = activeHskLevel;
  const words = HSK_DATA[lvl] || [];
  const cat   = `HSK ${lvl}`;

  const existing = new Set(ALL_CARDS.map(c => c.zh + c.cat));
  const fresh    = words
    .map(w => ({ zh: w.zh, pinyin: w.pinyin, en: w.en, cat }))
    .filter(c => !existing.has(c.zh + c.cat));

  if (!fresh.length) {
    fb.className   = 'import-feedback error';
    fb.textContent = `All HSK ${lvl} words are already in your deck.`;
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

  fb.className   = 'import-feedback';
  fb.textContent = `✓ Added ${fresh.length} HSK ${lvl} word${fresh.length !== 1 ? 's' : ''} to your deck.`;
  logImport('hsk', cat, fresh.length);
}

// ── YouTube import ────────────────────────────────────────────

const API_URL = 'http://localhost:8001';
let ytPendingCards = [];

async function extractFromYoutube() {
  const url      = document.getElementById('ytUrl').value.trim();
  const maxWords = parseInt(document.getElementById('ytMaxWords').value) || 20;
  const fb       = document.getElementById('ytFeedback');
  const btn      = document.getElementById('btnYtExtract');

  fb.className   = 'import-feedback';
  fb.textContent = '';

  if (!url) {
    fb.className = 'import-feedback error';
    fb.textContent = 'Please paste a YouTube URL.';
    return;
  }

  // Check API server is up
  try {
    const health = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok) throw new Error();
  } catch {
    fb.className = 'import-feedback error';
    fb.textContent = 'API server is not running. Start it with: python3 scripts/api_server.py';
    return;
  }

  // Start loading state
  btn.disabled = true;
  btn.classList.add('loading');
  document.getElementById('ytBtnText').textContent = 'Extracting…';
  clearYtPreview();

  try {
    const res = await fetch(`${API_URL}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, max_words: maxWords }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `Server error ${res.status}`);
    }

    // Auto-fill category from video title
    const catInput = document.getElementById('ytCat');
    if (!catInput.value.trim()) catInput.value = data.category;

    ytPendingCards = data.cards.map(c => ({ ...c, cat: data.category }));
    renderYtPreview(ytPendingCards, data.category);

    fb.textContent = '';
  } catch (err) {
    fb.className   = 'import-feedback error';
    fb.textContent = `Error: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    document.getElementById('ytBtnText').textContent = 'Extract Vocabulary';
  }
}

function hskBadgeHtml(zh) {
  const lvl = HSK_LOOKUP[zh];
  return lvl
    ? `<span class="hsk-badge hsk-badge-${lvl}">HSK ${lvl}</span>`
    : `<span class="hsk-none">—</span>`;
}

function renderYtPreview(cards, defaultCat) {
  const preview = document.getElementById('ytPreview');
  const table   = document.getElementById('ytPreviewTable');
  const count   = document.getElementById('ytPreviewCount');

  const matched = cards.filter(c => HSK_LOOKUP[c.zh]).length;

  table.innerHTML = cards.map(c => `
    <div class="yt-preview-row">
      <span class="yt-zh">${c.zh}</span>
      <span class="yt-pinyin">${c.pinyin}</span>
      <span class="yt-en">${c.en}</span>
      ${hskBadgeHtml(c.zh)}
    </div>`).join('');

  const matchNote = matched > 0 ? `, ${matched} matched to HSK` : '';
  count.textContent = `${cards.length} card${cards.length !== 1 ? 's' : ''} extracted${matchNote}`;
  preview.style.display = 'block';
}

function clearYtPreview() {
  ytPendingCards = [];
  document.getElementById('ytPreview').style.display = 'none';
  document.getElementById('ytPreviewTable').innerHTML = '';
}

function addYtCards(groupByHsk = false) {
  const fb      = document.getElementById('ytFeedback');
  const catInput = document.getElementById('ytCat').value.trim();

  if (!ytPendingCards.length) return;

  const assignCat = c => {
    if (groupByHsk) {
      const lvl = HSK_LOOKUP[c.zh];
      return lvl ? `HSK ${lvl}` : (catInput || c.cat);
    }
    return catInput || c.cat;
  };

  const cards    = ytPendingCards.map(c => ({ ...c, cat: assignCat(c) }));
  const existing = new Set(ALL_CARDS.map(c => c.zh + c.cat));
  const fresh    = cards.filter(c => !existing.has(c.zh + c.cat));

  if (!fresh.length) {
    fb.className = 'import-feedback error';
    fb.textContent = 'All extracted cards already exist in the deck.';
    return;
  }

  ALL_CARDS = [...ALL_CARDS, ...fresh];
  saveExtraCards();

  // Jump to the first newly-added category
  const addedCat = fresh[0].cat;
  activeCat = addedCat;
  deck      = ALL_CARDS.filter(c => c.cat === addedCat);
  index     = 0;
  known.clear();
  unknown.clear();
  buildCategoryButtons();
  showCard();

  const cats = [...new Set(fresh.map(c => c.cat))];
  const catLabel = cats.length === 1 ? `"${cats[0]}"` : cats.map(c => `"${c}"`).join(', ');
  fb.className   = 'import-feedback';
  fb.textContent = `✓ Added ${fresh.length} card${fresh.length !== 1 ? 's' : ''} to ${catLabel}.`;
  cats.forEach(c => logImport('youtube', c, fresh.filter(x => x.cat === c).length));
  clearYtPreview();
  document.getElementById('ytUrl').value = '';
  document.getElementById('ytCat').value = '';
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
updateProgressWidget();
updateDueBadge();
