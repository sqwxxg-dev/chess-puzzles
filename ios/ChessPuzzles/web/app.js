'use strict';

/* ============================================================
   Chess Puzzles — app logic
   ============================================================ */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.prototype.slice.call(r.querySelectorAll(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FILES = 'abcdefgh';
const TYPES = { p: 'P', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };

/* ------------------------- storage ------------------------- */
const Store = {
  get(key, dflt) {
    let raw = null;
    if (window.NATIVE_STORAGE && Object.prototype.hasOwnProperty.call(window.NATIVE_STORAGE, key)) {
      raw = window.NATIVE_STORAGE[key];
    }
    if (raw == null) { try { raw = localStorage.getItem(key); } catch (e) { raw = null; } }
    if (raw == null) return dflt;
    try { return JSON.parse(raw); } catch (e) { return dflt; }
  },
  set(key, val) {
    const raw = JSON.stringify(val);
    if (!window.NATIVE_STORAGE) window.NATIVE_STORAGE = {};
    window.NATIVE_STORAGE[key] = raw;
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.store) {
      try { window.webkit.messageHandlers.store.postMessage({ key: key, value: raw }); } catch (e) {}
    }
    try { localStorage.setItem(key, raw); } catch (e) {}
  }
};

/* ------------------------- state ------------------------- */
const DIFFS = [
  { name: 'Лёгкий',         min: 0,    max: 1200, hint: 'рейтинг 600–1200' },
  { name: 'Средний',        min: 1200, max: 1600, hint: 'рейтинг 1200–1600' },
  { name: 'Сложный',        min: 1600, max: 2000, hint: 'рейтинг 1600–2000' },
  { name: 'Очень сложный',  min: 2000, max: 9999, hint: 'рейтинг 2000+' }
];

const S = {
  streak: Store.get('cp.streak', 0),
  best:   Store.get('cp.best', 0),
  solved: Store.get('cp.solved', 0),
  settings: Object.assign({ toolsSide: 'right', haptics: true, coords: true, diff: 1 }, Store.get('cp.settings', {})),
  current: null,
  bag: [],
  lastPuzzle: null
};

const THEMES_RU = {
  mateIn1: 'мат в 1', mateIn2: 'мат в 2', mateIn3: 'мат в 3', mateIn4: 'мат в 4',
  mateIn5: 'мат в 5', backRankMate: 'мат на последней', smotheredMate: 'спёртый мат',
  fork: 'вилка', pin: 'связка', skewer: 'рентген', discoveredAttack: 'вскрытое нападение',
  doubleCheck: 'двойной шах', sacrifice: 'жертва', deflection: 'отвлечение',
  attraction: 'привлечение', clearance: 'освобождение', promotion: 'превращение',
  hangingPiece: 'висящая фигура', trappedPiece: 'запертая фигура', xRayAttack: 'рентген',
  endgame: 'эндшпиль', middlegame: 'миттельшпиль', opening: 'дебют',
  defensiveMove: 'защита', intermezzo: 'промежуточный ход', zugzwang: 'цугцванг',
  capturingDefender: 'устранение защитника', interference: 'перекрытие',
  quietMove: 'тихий ход', doubleBishopMate: 'мат двумя слонами'
};

/* ------------------------- helpers ------------------------- */
function haptic(kind) {
  if (!S.settings.haptics) return;
  if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.haptic) {
    try { window.webkit.messageHandlers.haptic.postMessage(kind); } catch (e) {}
    return;
  }
  if (navigator.vibrate) navigator.vibrate(kind === 'error' ? [24, 40, 40] : 12);
}

function saveStats() {
  Store.set('cp.streak', S.streak);
  Store.set('cp.best', S.best);
  Store.set('cp.solved', S.solved);
}
function saveSettings() { Store.set('cp.settings', S.settings); }

function showScreen(name) {
  $$('.screen').forEach((el) => el.classList.toggle('active', el.id === 'screen-' + name));
}

let toastTimer = null;
function toast(text, kind) {
  const el = $('#toast');
  el.textContent = text;
  el.className = 'toast on' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast' + (kind ? ' ' + kind : ''); }, 1500);
}

function pieceImg(color, type) { return 'pieces/' + color + TYPES[type] + '.svg'; }

function fenToBoard(fen) {
  const rows = fen.split(' ')[0].split('/');
  const out = [];
  for (const row of rows) {
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') { for (let i = 0; i < +ch; i++) out.push(null); }
      else out.push(ch);
    }
  }
  return out;
}

function sqName(i) { return FILES[i % 8] + (8 - Math.floor(i / 8)); }

function findKing(fen, color) {
  const b = fenToBoard(fen);
  const k = color === 'w' ? 'K' : 'k';
  for (let i = 0; i < 64; i++) if (b[i] === k) return sqName(i);
  return null;
}

function inCheck(fen) {
  try {
    const g = new Chess(fen);
    return g.in_check() ? findKing(fen, g.turn()) : null;
  } catch (e) { return null; }
}

function uciToMove(uci) {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined
  };
}

function moveUci(m) { return m.from + m.to + (m.promotion || ''); }

/* ------------------------- puzzle selection ------------------------- */
function poolForDiff() {
  const all = (window.PUZZLES || []);
  const d = DIFFS[S.settings.diff] || DIFFS[1];
  const pool = all.filter((p) => p.r >= d.min && p.r < d.max);
  return pool.length >= 20 ? pool : all;
}

function refillBag() {
  const pool = poolForDiff();
  const bag = pool.slice();
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
  }
  if (bag.length > 1 && S.lastPuzzle && bag[0] === S.lastPuzzle) {
    const t = bag[0]; bag[0] = bag[1]; bag[1] = t;
  }
  S.bag = bag;
}

function nextPuzzleData() {
  if (!S.bag.length) refillBag();
  const p = S.bag.pop();
  S.lastPuzzle = p;
  return p;
}

/* ------------------------- session ------------------------- */
function startPuzzle(puzzle) {
  const game = new Chess(puzzle.f);
  const sol = puzzle.m.split(' ').filter(Boolean);
  const c = {
    puzzle: puzzle,
    game: game,
    sol: sol,
    solIdx: 1,
    side: null,
    hist: [{ fen: puzzle.f, san: null, from: null, to: null, color: null, captured: null }],
    review: null,
    phase: 'play',
    busy: false,
    sel: null,
    marks: new Set(),
    arrows: [],
    token: 0
  };

  // the first move of a lichess puzzle is played by the opponent
  const first = uciToMove(sol[0]);
  const m = game.move({ from: first.from, to: first.to, promotion: first.promotion });
  if (m) {
    c.hist.push({ fen: game.fen(), san: m.san, from: m.from, to: m.to, color: m.color, captured: m.captured || null });
  }
  c.side = game.turn();
  c.token++;

  S.current = c;
  render();
  showScreen('game');

  // animate the opponent's setup move
  if (m) {
    slideAnim(m.from, m.to);
    haptic('tick');
  }
  return c;
}

function applyScripted(uci, opts) {
  const c = S.current;
  if (!c) return false;
  const mv = uciToMove(uci);
  const m = c.game.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
  if (!m) return false;
  c.hist.push({ fen: c.game.fen(), san: m.san, from: m.from, to: m.to, color: m.color, captured: m.captured || null, sol: !!(opts && opts.solution) });
  c.solIdx++;
  return m;
}

/* ------------------------- rendering ------------------------- */
function currentViewIndex(c) {
  return c.review == null ? c.hist.length - 1 : c.review;
}

function render() {
  renderBoard();
  renderChrome();
}

function renderBoard() {
  const c = S.current;
  const boardEl = $('#board');
  if (!c) { boardEl.innerHTML = ''; return; }

  const viewIdx = currentViewIndex(c);
  const fen = c.hist[viewIdx].fen;
  const squares = fenToBoard(fen);
  const flip = c.side === 'b';
  const lastMove = viewIdx > 0 ? c.hist[viewIdx] : null;
  const checkSq = inCheck(fen);
  const c2 = S.current;

  // legal targets of the selected piece
  const targets = {};
  let captures = {};
  if (c2.sel && c2.phase === 'play' && c2.review == null && !c2.busy) {
    c2.game.moves({ square: c2.sel, verbose: true }).forEach((m) => {
      targets[m.to] = true;
      if (m.captured) captures[m.to] = true;
    });
  }

  const parts = [];
  for (let i = 0; i < 64; i++) {
    const idx = flip ? 63 - i : i;
    const file = idx % 8;
    const rank = 8 - Math.floor(idx / 8);
    const name = FILES[file] + rank;
    const isLight = (file + rank) % 2 === 0;
    const cls = ['sq', isLight ? 'light' : 'dark'];

    let ovCls = 'ov';
    if (lastMove) {
      if (lastMove.from === name || lastMove.to === name) {
        if (lastMove.sol) ovCls += ' hl-sol';
        else if (lastMove.color !== c.side) ovCls += ' hl-blue';
        else ovCls += ' hl-green';
      }
    }
    if (checkSq === name) ovCls += ' hl-check';
    if (targets[name]) ovCls += captures[name] ? ' ring' : ' dot';
    if (c2.sel === name) cls.push('sel');

    const piece = squares[idx];
    const img = piece
      ? '<div class="pc" style="background-image:url(' + pieceImg(piece === piece.toUpperCase() ? 'w' : 'b', piece.toLowerCase()) + ')"></div>'
      : '';

    let coords = '';
    if (S.settings.coords) {
      const bottomRow = i >= 56;
      if (bottomRow) coords += '<span class="cfile">' + name[0] + '</span>';
      const leftCol = i % 8 === 0;
      if (leftCol) coords += '<span class="crank">' + name[1] + '</span>';
    }

    const mark = c2.marks.has(name) ? '<div class="mark x"></div>' : '';

    parts.push('<div class="' + cls.join(' ') + '" data-sq="' + name + '">' +
      '<div class="' + ovCls + '"></div>' + img + mark + coords + '</div>');
  }

  boardEl.innerHTML = parts.join('') + arrowLayer();

  // temporary arrow element (used while drawing)
  const svg = boardEl.querySelector('svg.arrows');
  if (svg) {
    const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    tmp.setAttribute('id', 'tempArrow');
    tmp.setAttribute('points', '');
    tmp.setAttribute('opacity', '0');
    svg.appendChild(tmp);
  }
}

function posOf(name, flip) {
  const f = FILES.indexOf(name[0]);
  const r = +name[1];
  const col = flip ? 7 - f : f;
  const row = flip ? r - 1 : 8 - r;
  return { x: (col + 0.5) * 100, y: (row + 0.5) * 100 };
}

function arrowPolygon(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 2) return '';
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const w = 12;                 // shaft half width (in 800-unit board)
  const head = Math.min(34, len * 0.42);
  const ex = x2 - ux * 6, ey = y2 - uy * 6;
  const bx = ex - ux * head, by = ey - uy * head;
  const hw = w * 2.1;
  const pts = [
    [x1 + px * w, y1 + py * w],
    [bx + px * w, by + py * w],
    [bx + px * hw, by + py * hw],
    [ex, ey],
    [bx - px * hw, by - py * hw],
    [bx - px * w, by - py * w],
    [x1 - px * w, y1 - py * w]
  ];
  return pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
}

function arrowLayer() {
  const c = S.current;
  if (!c) return '';
  const flip = c.side === 'b';
  const fen = c.hist[currentViewIndex(c)].fen;
  const b = fenToBoard(fen);
  const out = [];
  for (const a of c.arrows) {
    const from = posOf(a[0], flip);
    const to = posOf(a[1], flip);
    const idx = flip ? 63 - (FILES.indexOf(a[0][0]) + (8 - +a[0][1]) * 8) : (FILES.indexOf(a[0][0]) + (8 - +a[0][1]) * 8);
    const p = b[idx];
    const light = !p || p === p.toUpperCase();
    const fill = light ? 'rgba(255,252,245,0.92)' : 'rgba(28,24,20,0.88)';
    out.push('<polygon points="' + arrowPolygon(from.x, from.y, to.x, to.y) + '" fill="' + fill + '" stroke="rgba(0,0,0,0.28)" stroke-width="2" stroke-linejoin="round"/>');
  }
  return '<svg class="arrows" viewBox="0 0 800 800" preserveAspectRatio="none">' + out.join('') + '</svg>';
}

function capturedList(c, upTo) {
  const out = [];
  for (let i = 1; i <= upTo; i++) {
    const h = c.hist[i];
    if (h.color && h.color !== c.side && h.captured) out.push(h.captured);
  }
  return out;
}

function renderChrome() {
  const c = S.current;
  if (!c) return;
  const done = c.phase === 'done';

  $('#side-text').textContent = c.side === 'w' ? 'Вы играете белыми' : 'Вы играете чёрными';
  $('#side-pill').classList.toggle('black', c.side === 'b');

  $('#g-streak').textContent = S.streak;

  const btn = $('#btn-action');
  btn.classList.remove('green', 'red', 'primary');
  if (c.phase === 'play') {
    btn.textContent = 'Посмотреть решение';
    btn.classList.add('green');
    btn.disabled = false;
  } else if (c.phase === 'reveal') {
    btn.textContent = 'Показываем решение…';
    btn.classList.add('green');
    btn.disabled = true;
  } else {
    btn.textContent = 'Перейти к след. головоломке';
    btn.classList.add('red');
    btn.disabled = false;
  }

  $('#screen-game').classList.toggle('has-review', done);
  $('#review-bar').classList.toggle('on', done);

  if (done) {
    const last = c.hist.length - 1;
    const idx = c.review == null ? last : c.review;
    $('#review-label').textContent = idx + ' / ' + last;
    $('#review-san').textContent = idx > 0 ? c.hist[idx].san : '';
    $('#btn-prev').disabled = idx <= 0;
    $('#btn-next').disabled = idx >= last;
  }

  // captured pieces (what the opponent took from us)
  const viewIdx = currentViewIndex(c);
  const lost = capturedList(c, viewIdx);
  const capEl = $('#captured');
  if (lost.length) {
    capEl.innerHTML = '<span class="cap-label">Оппонент забрал:</span>' +
      lost.map((t) => '<i class="cap-pc" style="background-image:url(' + pieceImg(c.side, t) + ')"></i>').join('');
  } else {
    capEl.innerHTML = '';
  }

  const meta = [];
  if (c.puzzle.r) meta.push('Рейтинг ' + c.puzzle.r);
  if (c.puzzle.t) {
    const first = c.puzzle.t.split(' ').map((t) => THEMES_RU[t] || t).slice(0, 2);
    if (first.length) meta.push(first.join(' · '));
  }
  $('#meta-rating').textContent = meta[0] || '';
  $('#meta-theme').textContent = meta[1] || '';
}

/* ------------------------- animations ------------------------- */
function sqEl(name) { return $('#board .sq[data-sq="' + name + '"]'); }

function slideAnim(from, to) {
  const target = $('#board .sq[data-sq="' + to + '"] .pc');
  const a = sqEl(from), b = sqEl(to);
  if (!target || !a || !b) return;
  const ra = a.getBoundingClientRect();
  const rb = b.getBoundingClientRect();
  const dx = ra.left - rb.left;
  const dy = ra.top - rb.top;
  target.style.transition = 'none';
  target.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
  void target.offsetWidth;
  target.style.transition = 'transform 190ms cubic-bezier(.2,.85,.3,1)';
  target.style.transform = 'translate(0,0)';
  setTimeout(() => { target.style.transition = ''; target.style.transform = ''; }, 230);
}

function flashWrong(name) {
  const el = sqEl(name);
  if (!el) return;
  const ov = el.querySelector('.ov');
  ov.classList.add('hl-bad');
  setTimeout(() => ov.classList.remove('hl-bad'), 900);
}

/* ------------------------- moving ------------------------- */
function canInteract() {
  const c = S.current;
  return !!c && c.phase === 'play' && c.review == null && !c.busy && !promoOpen;
}

function canAnnotate() {
  const c = S.current;
  return !!c && c.phase !== 'reveal' && !c.busy;
}

function attemptMove(from, to, promo) {
  const c = S.current;
  if (!c || c.phase !== 'play' || c.review != null || c.busy) return;
  const legal = c.game.moves({ square: from, verbose: true }).filter((m) => m.to === to && m.color === c.side);
  if (!legal.length) return; // not a legal move: silently ignore

  if (legal.length > 1) {
    if (!promo) { openPromotion(from, to, legal); return; }
    const pick = legal.find((m) => m.promotion === promo) || legal[0];
    resolveMove(pick);
    return;
  }
  resolveMove(legal[0]);
}

function resolveMove(mv) {
  const c = S.current;
  const expected = c.sol[c.solIdx];
  const played = moveUci(mv);
  c.sel = null;

  if (expected && played === expected) {
    c.busy = true;
    const m = c.game.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    c.hist.push({ fen: c.game.fen(), san: m.san, from: m.from, to: m.to, color: m.color, captured: m.captured || null });
    c.solIdx++;
    render();
    slideAnim(m.from, m.to);
    haptic('tick');
    setTimeout(afterUserMove, 220);
    return;
  }

  // legal but wrong move -> penalty
  wrongMove(mv.from, mv.to);
}

function afterUserMove() {
  const c = S.current;
  if (!c) return;

  if (c.solIdx >= c.sol.length) { finishSolved(); return; }

  setTimeout(() => {
    if (S.current !== c || c.phase !== 'play') return;
    const m = applyScripted(c.sol[c.solIdx], {});
    if (!m) { c.busy = false; return; }
    render();
    slideAnim(m.from, m.to);
    if (m.captured) haptic('tick');
    c.busy = false;
  }, 260);
}

function wrongMove(from, to) {
  const c = S.current;
  c.busy = true;
  c.sel = null;

  S.streak = 0;
  saveStats();
  haptic('error');
  renderChrome();

  const src = sqEl(from) ? sqEl(from).querySelector('.pc') : null;
  const dest = sqEl(to);
  if (dest) {
    const ov = dest.querySelector('.ov');
    if (ov) ov.classList.add('hl-bad');
  }
  toast('Неверный ход — серия сброшена', 'bad');

  if (!src || !dest) { c.busy = false; render(); return; }

  const ra = src.getBoundingClientRect();
  const rb = dest.getBoundingClientRect();
  const dx = rb.left - ra.left;
  const dy = rb.top - ra.top;

  const ghost = document.createElement('div');
  ghost.className = 'dragghost';
  ghost.style.left = ra.left + 'px';
  ghost.style.top = ra.top + 'px';
  ghost.style.width = ra.width + 'px';
  ghost.style.height = ra.height + 'px';
  ghost.style.backgroundImage = getComputedStyle(src).backgroundImage;
  const inner = document.createElement('div');
  inner.className = 'dragghost-inner';
  ghost.appendChild(inner);
  document.body.appendChild(ghost);
  src.style.visibility = 'hidden';

  ghost.style.transition = 'transform 130ms ease-out';
  ghost.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';

  setTimeout(() => {
    inner.classList.add('shake');
    setTimeout(() => {
      ghost.style.transition = 'transform 280ms cubic-bezier(.35,.05,.2,1)';
      ghost.style.transform = 'translate(0,0)';
      setTimeout(() => {
        ghost.remove();
        src.style.visibility = '';
        if (S.current === c) {
          c.busy = false;
          render();
        }
      }, 300);
    }, 260);
  }, 150);
}

/* ------------------------- solution / finish ------------------------- */
async function showSolution() {
  const c = S.current;
  if (!c || c.phase !== 'play') return;
  c.phase = 'reveal';
  c.busy = true;
  c.sel = null;
  S.streak = 0;
  saveStats();
  render();
  haptic('error');

  const token = ++c.token;
  while (c.solIdx < c.sol.length) {
    if (S.current !== c || c.token !== token) return;
    const m = applyScripted(c.sol[c.solIdx], { solution: true });
    if (!m) break;
    render();
    slideAnim(m.from, m.to);
    await sleep(480);
  }
  if (S.current !== c || c.token !== token) return;

  c.phase = 'done';
  c.busy = false;
  c.review = null;
  render();
}

function finishSolved() {
  const c = S.current;
  if (!c) return;
  c.phase = 'done';
  c.busy = false;
  c.review = null;
  S.streak += 1;
  if (S.streak > S.best) S.best = S.streak;
  S.solved += 1;
  saveStats();
  render();
  haptic('success');
  toast('Решено! Серия: ' + S.streak, 'good');
  const pill = $('#streak-pill');
  pill.classList.remove('bump');
  void pill.offsetWidth;
  pill.classList.add('bump');
}

function stepReview(delta) {
  const c = S.current;
  if (!c || c.phase !== 'done') return;
  const last = c.hist.length - 1;
  let idx = c.review == null ? last : c.review;
  idx += delta;
  if (idx < 0) idx = 0;
  if (idx >= last) c.review = null; else c.review = idx;
  render();
}

/* ------------------------- promotion ------------------------- */
let promoOpen = false;

function openPromotion(from, to, choices) {
  promoOpen = true;
  const boardEl = $('#board');
  const box = document.createElement('div');
  box.className = 'promo';
  box.innerHTML = '<div class="promo-row">' +
    ['q', 'n', 'r', 'b'].map((t) =>
      '<button data-promo="' + t + '"><i style="background-image:url(' + pieceImg(S.current.side, t) + ')"></i></button>'
    ).join('') + '</div>';
  boardEl.appendChild(box);
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-promo]');
    if (!btn) return;
    box.remove();
    promoOpen = false;
    attemptMove(from, to, btn.dataset.promo);
  });
}

/* ------------------------- input ------------------------- */
let drag = null;      // { from, ghost, elem, startX, startY, moved }
let arrowDraw = null; // { from, pointerId }
const boardEl = () => $('#board');

function sqFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  const sq = el && el.closest ? el.closest('.sq') : null;
  return sq ? sq.dataset.sq : null;
}

function setHover(name) {
  $$('#board .sq.hover').forEach((el) => el.classList.remove('hover'));
  if (name) { const el = sqEl(name); if (el) el.classList.add('hover'); }
}

function onBoardDown(e) {
  const c = S.current;
  if (!c) return;
  const target = e.target.closest ? e.target.closest('.sq') : null;
  if (!target) return;
  const name = target.dataset.sq;

  const tool = activeTool();

  if (tool === 'move') {
    if (!canInteract()) return;
  } else if (!canAnnotate()) {
    return;
  }
  e.preventDefault();

  if (tool === 'mark') {
    if (c.marks.has(name)) c.marks.delete(name); else c.marks.add(name);
    render();
    haptic('tick');
    return;
  }

  if (tool === 'erase') {
    eraseAt(name);
    return;
  }

  if (tool === 'arrow') {
    const targets = arrowTargets(name);
    if (!Object.keys(targets).length) { haptic('error'); return; }
    arrowDraw = { from: name, targets: targets };
    $$('#board .sq').forEach((el) => el.classList.toggle('alo', !!targets[el.dataset.sq]));
    try { boardEl().setPointerCapture(e.pointerId); } catch (err) {}
    updateTempArrow(name, e.clientX, e.clientY);
    haptic('tick');
    return;
  }

  // move tool
  const piece = fenToBoard(c.hist[currentViewIndex(c)].fen)[
    FILES.indexOf(name[0]) + (8 - +name[1]) * 8
  ];
  const own = piece && (c.side === 'w' ? piece === piece.toUpperCase() : piece === piece.toLowerCase());

  if (c.sel && c.sel !== name) {
    const legal = c.game.moves({ square: c.sel, verbose: true }).some((m) => m.to === name);
    if (legal) { attemptMove(c.sel, name); return; }
  }

  if (own) {
    const el = sqEl(name);
    const pcEl = el.querySelector('.pc');
    const r = pcEl.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'dragghost';
    ghost.style.left = r.left + 'px';
    ghost.style.top = r.top + 'px';
    ghost.style.width = r.width + 'px';
    ghost.style.height = r.height + 'px';
    ghost.style.backgroundImage = getComputedStyle(pcEl).backgroundImage;
    document.body.appendChild(ghost);
    pcEl.style.opacity = '0';

    drag = { from: name, ghost: ghost, elem: pcEl, startX: e.clientX, startY: e.clientY, moved: false, w: r.width, h: r.height };
    c.sel = name;
    renderBoard();
    // restore ghost visibility state after re-render
    const newPc = sqEl(name) ? sqEl(name).querySelector('.pc') : null;
    if (newPc) newPc.style.opacity = '0';
    moveGhost(e.clientX, e.clientY);
    try { boardEl().setPointerCapture(e.pointerId); } catch (err) {}
    return;
  }

  c.sel = null;
  render();
}

function moveGhost(x, y) {
  if (!drag) return;
  drag.ghost.style.transform = 'translate(' + (x - drag.w / 2 - drag.ghost.offsetLeft) + 'px,' + (y - drag.h / 2 - drag.ghost.offsetTop) + 'px)';
}

function onBoardMove(e) {
  const c = S.current;
  if (!c) return;

  if (drag) {
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 7) drag.moved = true;
    moveGhost(e.clientX, e.clientY);
    setHover(sqFromPoint(e.clientX, e.clientY));
    return;
  }

  if (arrowDraw) {
    const name = sqFromPoint(e.clientX, e.clientY);
    updateTempArrow(arrowDraw.from, e.clientX, e.clientY, name, !!(name && arrowDraw.targets[name]));
  }
}

function onBoardUp(e) {
  const c = S.current;
  if (!c) return;

  if (drag) {
    const d = drag;
    drag = null;
    const over = sqFromPoint(e.clientX, e.clientY);
    setHover(null);
    d.ghost.remove();
    const pc = sqEl(d.from) ? sqEl(d.from).querySelector('.pc') : null;
    if (pc) pc.style.opacity = '';

    if (!d.moved) {
      // tap: keep selection (or toggle off)
      if (c.sel !== d.from) c.sel = d.from;
      render();
      return;
    }
    if (!over || over === d.from) { render(); return; }
    attemptMove(d.from, over);
    return;
  }

  if (arrowDraw) {
    const a = arrowDraw;
    arrowDraw = null;
    const target = sqFromPoint(e.clientX, e.clientY);
    hideTempArrow();
    $$('#board .sq.alo').forEach((el) => el.classList.remove('alo'));
    if (target && target !== a.from) {
      if (!a.targets[target]) { haptic('error'); return; }
      const exists = c.arrows.findIndex((x) => x[0] === a.from && x[1] === target);
      if (exists >= 0) c.arrows.splice(exists, 1); else c.arrows.push([a.from, target]);
      haptic('tick');
      render();
    } else if (target === a.from) {
      const before = c.arrows.length;
      c.arrows = c.arrows.filter((x) => x[0] !== a.from && x[1] !== a.from);
      if (c.arrows.length !== before) render();
    }
    return;
  }
}

/* Squares an arrow may point to, following the movement rules of the piece
   standing on the origin square (blocked rays stop, own pieces block). */
function arrowTargets(from) {
  const c = S.current;
  if (!c) return {};
  const board = fenToBoard(c.hist[currentViewIndex(c)].fen);
  const at = (f, r) => (f < 0 || f > 7 || r < 1 || r > 8) ? undefined : board[f + (8 - r) * 8];
  const f0 = FILES.indexOf(from[0]);
  const r0 = +from[1];
  const piece = at(f0, r0);
  if (!piece || f0 < 0) return {};

  const white = piece === piece.toUpperCase();
  const type = piece.toLowerCase();
  const out = {};

  const add = (f, r) => {
    if (f < 0 || f > 7 || r < 1 || r > 8) return false;
    const p = at(f, r);
    const name = FILES[f] + r;
    if (p) {
      if ((p === p.toUpperCase()) === white) return false; // own piece blocks
      out[name] = true;
      return false;                                        // capture ends the ray
    }
    out[name] = true;
    return true;
  };

  const RAYS = {
    b: [[1, 1], [1, -1], [-1, -1], [-1, 1]],
    r: [[0, 1], [1, 0], [0, -1], [-1, 0]],
    q: [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]]
  };
  const STEPS = {
    n: [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]],
    k: [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]]
  };

  if (RAYS[type]) {
    for (const d of RAYS[type]) {
      let f = f0 + d[0], r = r0 + d[1];
      while (add(f, r)) { f += d[0]; r += d[1]; }
    }
    return out;
  }
  if (STEPS[type]) {
    for (const d of STEPS[type]) add(f0 + d[0], r0 + d[1]);
    return out;
  }
  if (type === 'p') {
    const dir = white ? 1 : -1;
    const startRank = white ? 2 : 7;
    const r1 = r0 + dir;
    if (r1 >= 1 && r1 <= 8 && !at(f0, r1)) {
      out[FILES[f0] + r1] = true;
      const r2 = r0 + dir * 2;
      if (r0 === startRank && r2 >= 1 && r2 <= 8 && !at(f0, r2)) out[FILES[f0] + r2] = true;
    }
    for (const df of [-1, 1]) {
      const f = f0 + df, r = r0 + dir;
      if (f < 0 || f > 7 || r < 1 || r > 8) continue;
      const p = at(f, r);
      if (p && (p === p.toUpperCase()) !== white) out[FILES[f] + r] = true;
    }
  }
  return out;
}

function updateTempArrow(from, x, y, toName, ok) {
  const svg = $('#board svg.arrows');
  const tmp = $('#tempArrow');
  if (!svg || !tmp) return;
  const r = $('#board').getBoundingClientRect();
  const flip = S.current.side === 'b';
  const a = posOf(from, flip);
  let bx, by;
  if (toName) { const b = posOf(toName, flip); bx = b.x; by = b.y; }
  else { bx = (x - r.left) / r.width * 800; by = (y - r.top) / r.height * 800; }
  tmp.setAttribute('points', arrowPolygon(a.x, a.y, bx, by));
  tmp.setAttribute('fill', ok === false ? 'rgba(229,72,77,0.55)' : 'rgba(255,252,245,0.9)');
  tmp.setAttribute('stroke', 'rgba(0,0,0,0.3)');
  tmp.setAttribute('stroke-width', '2');
  tmp.setAttribute('opacity', ok === false ? '0.35' : '0.85');
}

function hideTempArrow() {
  const tmp = $('#tempArrow');
  if (tmp) tmp.setAttribute('opacity', '0');
}

function eraseAt(name) {
  const c = S.current;
  const hadMark = c.marks.delete(name);
  const before = c.arrows.length;
  c.arrows = c.arrows.filter((a) => a[0] !== name && a[1] !== name);
  const hadArrows = c.arrows.length !== before;
  if (!hadMark && !hadArrows) {
    // nothing here -> clear everything
    if (c.marks.size || c.arrows.length) {
      c.marks.clear();
      c.arrows = [];
      toast('Заметки очищены');
    }
  }
  render();
  haptic('tick');
}

function activeTool() {
  const el = $('#dock .tool.active');
  return el ? el.dataset.tool : 'move';
}

/* ------------------------- UI wiring ------------------------- */
function renderMenuStats() {
  $('#m-streak').textContent = S.streak;
  $('#m-best').textContent = S.best;
  $('#m-solved').textContent = S.solved;
  $('#stat-streak').textContent = S.streak;
  $('#stat-best').textContent = S.best;
  $('#stat-solved').textContent = S.solved;
}

function applySettings() {
  // tools side
  $('.board-wrap').style.flexDirection = S.settings.toolsSide === 'left' ? 'row' : 'row-reverse';
  $$('#opt-side button').forEach((b) => b.classList.toggle('active', b.dataset.side === S.settings.toolsSide));
  $('#opt-haptics').setAttribute('aria-checked', S.settings.haptics ? 'true' : 'false');
  $('#opt-coords').setAttribute('aria-checked', S.settings.coords ? 'true' : 'false');
  // difficulty
  const d = DIFFS[S.settings.diff] || DIFFS[1];
  $('#diff').value = String(S.settings.diff);
  $('#diff-name').textContent = d.name;
  $('#diff-hint').textContent = d.hint;
  $('#diff').style.setProperty('--fill', (S.settings.diff / 3 * 100) + '%');
  if (S.current) render();
}

function openSheet(id) { $('#' + id).classList.add('on'); }
function closeSheet(id) { $('#' + id).classList.remove('on'); }

function startNewPuzzle() {
  if (S.current) S.current.token++;
  const data = nextPuzzleData();
  if (!data) { toast('Нет данных головоломок'); return; }
  startPuzzle(data);
}

function init() {
  // menu
  $('#btn-start').addEventListener('click', () => {
    haptic('tick');
    startNewPuzzle();
  });
  $('#btn-burger').addEventListener('click', () => { renderMenuStats(); openSheet('sheet-stats'); });
  $('#btn-settings').addEventListener('click', () => openSheet('sheet-settings'));
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => closeSheet(b.dataset.close)));
  $$('.sheet').forEach((sh) => sh.addEventListener('click', (e) => { if (e.target === sh) sh.classList.remove('on'); }));

  // difficulty
  $('#diff').addEventListener('input', (e) => {
    S.settings.diff = +e.target.value;
    saveSettings();
    applySettings();
    S.bag = [];
    haptic('tick');
  });

  // settings
  $$('#opt-side button').forEach((b) => b.addEventListener('click', () => {
    S.settings.toolsSide = b.dataset.side;
    saveSettings();
    applySettings();
  }));
  $('#opt-haptics').addEventListener('click', () => {
    S.settings.haptics = !S.settings.haptics;
    saveSettings();
    applySettings();
    haptic('tick');
  });
  $('#opt-coords').addEventListener('click', () => {
    S.settings.coords = !S.settings.coords;
    saveSettings();
    applySettings();
    haptic('tick');
  });
  $('#btn-reset').addEventListener('click', () => {
    S.streak = 0; S.best = 0; S.solved = 0;
    saveStats();
    renderMenuStats();
    if (S.current) render();
    toast('Прогресс сброшен');
  });

  // game
  $('#btn-back').addEventListener('click', () => {
    if (S.current) S.current.token++;
    showScreen('menu');
    renderMenuStats();
  });
  $('#btn-action').addEventListener('click', () => {
    const c = S.current;
    if (!c) return;
    if (c.phase === 'play') showSolution();
    else if (c.phase === 'done') startNewPuzzle();
  });
  $('#btn-prev').addEventListener('click', () => stepReview(-1));
  $('#btn-next').addEventListener('click', () => stepReview(1));

  // tools
  $$('#dock .tool').forEach((b) => b.addEventListener('click', () => {
    $$('#dock .tool').forEach((x) => x.classList.toggle('active', x === b));
    haptic('tick');
  }));

  // board input
  const b = $('#board');
  b.addEventListener('pointerdown', onBoardDown);
  b.addEventListener('pointermove', onBoardMove);
  b.addEventListener('pointerup', onBoardUp);
  b.addEventListener('pointercancel', onBoardUp);
  b.addEventListener('contextmenu', (e) => e.preventDefault());

  applySettings();
  renderMenuStats();
  showScreen('menu');
}

document.addEventListener('DOMContentLoaded', init);
