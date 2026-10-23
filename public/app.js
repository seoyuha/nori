/* ============================================================
   증강 윷놀이 — 화면
   ============================================================ */
const $ = id => document.getElementById(id);
const socket = io();

let S = null, me = null, mode = 'simple';
let teacherOn = false, teacherPin = '', watching = '';
let SETS = [], LAST_ROOMS = [];
let answered = false, lastPending = '', lastAnimSeq = -1, lastRound = 0;
let shownWins = new Set(), abilityOpen = null, tick = null;

try { me = JSON.parse(localStorage.getItem('yutMe') || 'null'); } catch (e) { }
const CLASS_CODE = (new URLSearchParams(location.search).get('class') || location.hash.replace('#', '')).toUpperCase().trim();

/* ---------- 작은 도구 ---------- */
function show(name) {
  ['landing', 'waiting', 'game', 'teacher'].forEach(x => $(x).classList.toggle('on', x === name));
}
let toastT;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600);
}
function cutin(text) {
  const c = $('cutin'); $('cutinText').textContent = text;
  c.hidden = false;
  const s = $('cutinText'); s.style.animation = 'none'; void s.offsetWidth; s.style.animation = '';
  setTimeout(() => { c.hidden = true; }, 1500);
}
function send(ev, data, cb) {
  socket.emit(ev, data, res => { if (res && !res.ok) toast(res.error || '할 수 없습니다.'); cb?.(res); });
}
const myP = () => S?.players.find(p => p.id === me?.id) || null;
const turnP = () => S?.players[S.turn] || null;
const isMyTurn = () => turnP()?.id === me?.id;
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ============================================================
   시작 화면
   ============================================================ */
$('myName').value = localStorage.getItem('yutName') || '';
$('modeSeg').addEventListener('click', e => {
  const b = e.target.closest('.btn'); if (!b) return;
  mode = b.dataset.mode;
  [...$('modeSeg').children].forEach(x => x.classList.toggle('on', x === b));
});
$('btnCreate').onclick = () => {
  const name = $('myName').value.trim();
  if (!name) return toast('닉네임을 먼저 써 주세요.');
  localStorage.setItem('yutName', name);
  send('create', { name, mode, pieceCount: +$('pieceCount').value, classCode: CLASS_CODE || undefined }, res => {
    if (res?.ok) { me = { code: res.code, id: res.id }; localStorage.setItem('yutMe', JSON.stringify(me)); }
  });
};
$('btnJoin').onclick = () => {
  const name = $('myName').value.trim();
  if (!name) return toast('닉네임을 먼저 써 주세요.');
  const code = $('roomCode').value.trim().toUpperCase();
  if (!code) return toast('방 코드를 넣어 주세요.');
  localStorage.setItem('yutName', name);
  send('join', { code, name }, res => {
    if (res?.ok) { me = { code: res.code, id: res.id }; localStorage.setItem('yutMe', JSON.stringify(me)); }
  });
};
$('roomCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoin').click(); });
$('btnStart').onclick = () => send('start', {});
function leave() { localStorage.removeItem('yutMe'); me = null; S = null; location.reload(); }
$('btnLeaveWait').onclick = () => { if (confirm('방에서 나갈까요?')) leave(); };
$('btnAgain').onclick = leave;
$('btnRetry').onclick = leave;

/* 메뉴 */
$('btnMenu').onclick = () => { $('ovMenu').hidden = false; };
$('mnClose').onclick = () => { $('ovMenu').hidden = true; };
$('mnGrade').onclick = () => { $('ovMenu').hidden = true; send('gradeNow', {}); };
$('mnSkip').onclick = () => { $('ovMenu').hidden = true; send('skipTurn', {}); };
$('mnLeave').onclick = () => { if (confirm('게임에서 나갈까요? 돌아올 수 없어요.')) leave(); };
$('mnKill').onclick = closeRoom;
$('btnKillRoom').onclick = closeRoom;
$('btnKillWait').onclick = closeRoom;

/* 방 없애기 — 방장만. 같은 방 친구들도 모두 나가게 된다. */
function closeRoom() {
  if (myP()?.id !== S?.host) return toast('방장만 방을 없앨 수 있습니다.');
  if (!confirm('이 방을 없앨까요? 같은 방 친구들도 모두 나가게 됩니다.')) return;
  send('closeRoom', {}, res => { if (res?.ok) { localStorage.removeItem('yutMe'); me = null; } });
}

if (CLASS_CODE) {
  fetch('/api/class/' + CLASS_CODE).then(r => r.json()).then(d => {
    if (!d || d.error) return;
    $('classBanner').hidden = false;
    $('classBanner').innerHTML = `이 주소의 문제 세트 — <b>${esc(d.name)}</b> (문제 ${d.count}개)`;
  }).catch(() => { });
}

/* ============================================================
   말판
   ============================================================ */
function nodeXY(co, k) { const c = co[k]; return c ? [62 + c[0] * 95.2, 62 + c[1] * 95.2] : null; }

const TILE_ICON = { mud: '🟤', trap: '🕳️', reward: '🎁', garlic: '🧄' };

function drawBoard() {
  if (!S) return;
  const B = S.board, co = B.coord;
  const seg = (a, b) => {
    const p = nodeXY(co, a), q = nodeXY(co, b);
    return p && q ? `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="#BFC4BD" stroke-width="7" stroke-linecap="round"/>` : '';
  };
  let g = '';
  for (let i = 0; i < B.ring; i++) g += seg(i, (i + 1) % B.ring);
  g += seg(5, B.scA[0]);
  for (let i = 0; i < B.scA.length - 1; i++) g += seg(B.scA[i], B.scA[i + 1]);
  g += seg(B.scA.at(-1), 15);
  g += seg(10, B.scB[0]);
  for (let i = 0; i < B.scB.length - 1; i++) g += seg(B.scB[i], B.scB[i + 1]);
  g += seg(B.scB.at(-1), 0);

  const tileAt = p => (S.tiles || []).find(t => t.pos === p);

  for (const key of Object.keys(co)) {
    const k = +key, xy = nodeXY(co, k); if (!xy) continue;
    const corner = B.corners.includes(k), center = k === B.center, start = k === 0;
    if (start) {
      g += `<rect x="${xy[0] - 25}" y="${xy[1] - 25}" width="50" height="50" rx="4" fill="#FCFCFA" stroke="#1A1A1A" stroke-width="3"/>`;
    } else if (center) {
      g += `<circle cx="${xy[0]}" cy="${xy[1]}" r="31" fill="none" stroke="#DDE0DB" stroke-width="3"/>`;
      g += `<circle cx="${xy[0]}" cy="${xy[1]}" r="20" fill="#FCFCFA" stroke="#1A1A1A" stroke-width="3"/>`;
    } else {
      const r = corner ? 23 : 15;
      g += `<circle cx="${xy[0]}" cy="${xy[1]}" r="${r}" fill="#FCFCFA" stroke="#1A1A1A" stroke-width="${corner ? 3 : 2.5}"/>`;
    }
    const t = tileAt(k);
    if (t) g += `<text x="${xy[0]}" y="${xy[1] - 24}" text-anchor="middle" font-size="19">${TILE_ICON[t.type] || '•'}</text>`;
  }

  /* 말 */
  const spots = {};
  S.players.forEach(p => p.pieces.forEach((pc, i) => {
    if (pc.pos < 0 || pc.pos === 99) return;
    (spots[pc.pos] ||= []).push({ p, pc, i });
  }));
  const fogOn = S.fog > 0;
  for (const pos of Object.keys(spots)) {
    const xy = nodeXY(co, +pos); if (!xy) continue;
    const here = spots[pos];
    const groups = {};
    here.forEach(x => {
      const g0 = (groups[x.p.id] ||= { p: x.p, n: 0, kinds: [], idx: [] });
      g0.n++; g0.kinds.push(x.pc.kind); g0.idx.push(x.i);
    });
    const list = Object.values(groups);
    list.forEach((grp, gi) => {
      const off = list.length > 1 ? (gi - (list.length - 1) / 2) * 22 : 0;
      const cx = xy[0] + off, cy = xy[1];
      const mine = grp.p.id === me?.id;
      const hide = fogOn && !mine;
      /* 업힌 말은 바깥에 테두리를 한 겹 더 둘러 한눈에 보이게 한다 */
      if (grp.n > 1) g += `<circle cx="${cx}" cy="${cy}" r="19.5" fill="none" stroke="#1A1A1A" stroke-width="2"/>`;
      g += `<circle cx="${cx}" cy="${cy}" r="15" fill="${hide ? '#C9CDC7' : grp.p.color}" stroke="#1A1A1A" stroke-width="2.5"/>`;
      if (!hide) {
        /* 혼자면 말 번호, 업혔으면 번호를 가운뎃점으로 잇고, 셋 이상이면 개수로 */
        const ns = grp.idx.map(i => i + 1);
        const label = ns.length === 1 ? String(ns[0]) : ns.length === 2 ? ns.join('·') : '×' + ns.length;
        g += `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="${ns.length === 2 ? 11 : 13}" font-weight="800" fill="#fff" style="paint-order:stroke" stroke="#1A1A1A" stroke-width="2.5">${label}</text>`;
        const special = grp.kinds.find(k => k && k !== 'normal');
        if (special) g += `<text x="${cx}" y="${cy - 19}" text-anchor="middle" font-size="14">${kindIcon(special)}</text>`;
      }
    });
  }
  $('board').innerHTML = g;
}

const KIND_ICON = { dokkaebi: '👺', vanguard: '🚩', cannon: '🏹', pawn: '♟️', kimcheomji: '🚶', queen: '👸', marathoner: '🏃', choir: '🎵' };
const PIECE_LABEL = { dokkaebi: '도깨비', vanguard: '선봉장', cannon: '포', pawn: '폰', kimcheomji: '김첨지', queen: '중전마마', marathoner: '마라토너', choir: '합창단원' };
const kindIcon = k => KIND_ICON[k] || '';

/* ============================================================
   플레이어 카드
   ============================================================ */
/* 말 한 개를 어디에 있는지 글자로 */
function whereText(pc) {
  if (pc.pos === 99) return '도착';
  if (pc.pos < 0) return '집';
  return pc.pos + '번 칸';
}

/* 같은 칸에 있는 내 말 = 업힌 말. 번호를 묶어서 돌려준다. */
function stackMap(p) {
  const m = {};
  p.pieces.forEach((pc, i) => {
    if (pc.pos < 0 || pc.pos === 99) return;
    (m[pc.pos] ||= []).push(i + 1);
  });
  return m;
}

function pieceRow(p, clickable) {
  const stacks = stackMap(p);
  return `<div class="pcs">` + p.pieces.map((pc, i) => {
    const on = pc.pos >= 0 && pc.pos !== 99;
    const mates = on ? stacks[pc.pos] : null;
    const stacked = mates && mates.length > 1;
    const cls = [
      pc.pos === 99 ? 'fin' : pc.pos < 0 ? 'home' : '',
      stacked ? 'stack' : '',
      pc.frozen > 0 || pc.locked ? 'held' : '',
      clickable && pc.pos !== 99 ? 'pick' : ''
    ].filter(Boolean).join(' ');
    const tip = `${i + 1}번 말 · ${whereText(pc)}` +
      (stacked ? ` · ${mates.join('+')}번이 함께 업힘` : '') +
      (pc.kind !== 'normal' ? ` · ${PIECE_LABEL[pc.kind] || ''}` : '');
    return `<button class="pc ${cls}" ${clickable && pc.pos !== 99 ? `data-piece="${i}"` : 'disabled'} title="${esc(tip)}">
      <i style="background:${p.color}">${i + 1}</i>
      <span class="w">${whereText(pc)}</span>
      ${pc.kind !== 'normal' ? `<span class="k">${kindIcon(pc.kind)}</span>` : ''}
      ${stacked ? `<span class="st">업기 ${mates.length}</span>` : ''}
      ${pc.frozen > 0 ? '<span class="st hold">묶임</span>' : pc.locked ? '<span class="st hold">고정</span>' : ''}
    </button>`;
  }).join('') + `</div>`;
}
function augChips(p, clickable) {
  const slots = [];
  (p.augs || []).forEach(a => {
    const use = clickable && a.kind === 'active' && !a.spent;
    slots.push(`<div class="aug ${a.spent ? 'spent' : ''} ${use ? 'usable' : ''} ${a.rarity === 'legend' ? 'legend' : ''}"
      ${use ? `data-use="${a.id}"` : ''} title="${esc(a.desc || '')}">${esc(a.name)}</div>`);
  });
  while (slots.length < 3) slots.push('<div class="aug empty">—</div>');
  return `<div class="augs">${slots.join('')}</div>`;
}
function hpRow(p) {
  if (p.health == null && p.claps == null && !(p.coins?.dog)) return '';
  let h = '<div class="hp">';
  if (p.health != null) { h += '체력'; for (let i = 0; i < 3; i++) h += `<i class="${i < p.health ? '' : 'off'}"></i>`; }
  if (p.claps != null) h += ` <span>박수 ${p.claps}/12</span>`;
  if (p.coins?.dog) h += ` <span>개 코인 ${p.coins.dog}</span>`;
  return h + '</div>';
}
function playerCard(p, opts = {}) {
  const isTurn = turnP()?.id === p.id;
  const done = p.pieces.filter(x => x.pos === 99).length;
  return `<div class="pcard ${isTurn ? 'turn' : ''} ${p.eliminated || p.rank ? 'out' : ''} ${p.connected ? '' : 'dim'}">
    <div class="head">
      <span class="dot" style="background:${p.color}"></span>
      <span class="nm">${esc(p.name)}</span>
      <span class="cnt">${p.rank ? p.rank + '위' : p.eliminated ? '탈락' : done + ' / ' + p.pieces.length}</span>
    </div>
    ${hpRow(p)}
    ${pieceRow(p, !!opts.pickable)}
    ${augChips(p, !!opts.clickable)}
  </div>`;
}

/* ============================================================
   화면 갱신
   ============================================================ */
function render() {
  if (!S) return;

  if (S.status === 'waiting') { renderWaiting(); show('waiting'); return; }
  show(watching ? 'teacher' : 'game');
  if (watching) { renderTeacher(); return; }

  drawBoard();

  const t = turnP();
  $('hudWho').innerHTML = t
    ? `<span class="dot" style="background:${t.color}"></span>${esc(t.name)} 차례`
    : '게임 종료';
  $('hudMeta').textContent = `${S.round}라운드 · ${S.mode === 'full' ? '본격 증강' : '간편 수업'}${S.fog ? ' · 안개' : ''}`;

  const others = S.players.filter(p => p.id !== me?.id);
  $('leftCol').innerHTML = others.map(p => playerCard(p)).join('');
  const my = myP();
  const canAct = isMyTurn() && !S.pending && S.status === 'playing';
  $('mePanel').innerHTML = my
    ? playerCard(my, { clickable: canAct, pickable: canAct && !!S.roll })
    : '';

  renderRoll();
  $('log').innerHTML = (S.log || []).slice(-30).map(x => `<div>${esc(x.t)}</div>`).join('');
  $('log').scrollTop = $('log').scrollHeight;

  renderOverlays();
  renderClock();
}

function renderWaiting() {
  $('waitCode').textContent = S.code;
  $('waitMode').textContent = S.mode === 'full' ? '본격 증강 (71종)' : '간편 수업';
  if (S.className) { $('waitClass').hidden = false; $('waitClass').textContent = S.className; }
  const seats = [];
  S.players.forEach(p => seats.push(
    `<div class="seat"><span class="dot" style="background:${p.color}"></span>
      <b>${esc(p.name)}</b>${p.id === S.host ? '<span class="chip">방장</span>' : ''}</div>`));
  for (let i = S.players.length; i < 5; i++) seats.push('<div class="seat empty">비어 있음</div>');
  $('waitSeats').innerHTML = seats.join('');
  $('waitInfo').textContent = S.players.length < 2 ? '2명 이상 모이면 시작할 수 있어요.' : '모두 모였으면 방장이 시작하세요.';
  const host = myP()?.id === S.host;
  $('btnStart').disabled = S.players.length < 2 || !host;
  $('btnKillWait').hidden = !host;
}

function renderRoll() {
  const my = myP(), mine = isMyTurn(), r = S.roll;
  const sticks = r?.sticks?.length ? r.sticks : [0, 0, 0, 0];
  $('yutRow').innerHTML = sticks.map((v, i) =>
    `<i class="${v ? 'flat' : ''} ${i === 0 ? 'mark' : ''}"></i>`).join('');
  $('rollName').textContent = r ? `${r.emoji} ${r.name}` : '—';
  $('rollSub').textContent = r
    ? `${r.en}${r.v > 0 ? ` · ${r.v}칸 앞으로` : r.v === -1 ? ' · 뒤로 1칸' : ''}`
    : (mine ? '윷을 던지세요' : `${turnP()?.name || ''} 차례`);

  const acts = [];
  if (S.status === 'playing' && mine && !S.pending) {
    if (!r && (my?.throws || 0) > 0) {
      acts.push(`<button class="btn pri lg" data-throw>윷 던지기 (${my.throws}회 남음)</button>`);
      if (my.coins?.dog >= 2) acts.push(`<button class="btn sm" data-throw="dogcoin" style="margin-top:6px">개 코인 2개로 모 만들기</button>`);
    }
    if (r?.choices) acts.push(`<div class="row" style="margin-top:6px">
      <button class="btn sm" data-pickyut="1">도 (1칸)</button><button class="btn sm" data-pickyut="2">개 (2칸)</button></div>`);
  }
  $('rollActs').innerHTML = acts.join('');
  $('actHint').textContent = !mine ? ''
    : r ? '옮길 말의 번호를 누르세요'
      : (my?.throws || 0) > 0 ? '' : '차례가 끝났어요';
}

/* 윷 던지기 · 증강 사용 버튼 */
document.addEventListener('click', e => {
  const th = e.target.closest('[data-throw]');
  if (th) return send('throw', { choose: th.dataset.throw || undefined });
  const py = e.target.closest('[data-pickyut]');
  if (py) return send('throw', { choose: +py.dataset.pickyut });
  const us = e.target.closest('[data-use]');
  if (us) return openAbility(us.dataset.use);
  const pc = e.target.closest('[data-piece]');
  if (pc) return send('move', { piece: +pc.dataset.piece });
});

/* ============================================================
   시계
   ============================================================ */
function renderClock() {
  const c = $('clock');
  const dl = S?.pending?.deadline || (isMyTurn() ? S?.turnDeadline : null);
  if (!dl || S.status !== 'playing') { c.hidden = true; clearInterval(tick); tick = null; return; }
  c.hidden = false;
  if (!$('clockTicks').innerHTML) {
    let g = '';
    for (let i = 0; i < 12; i++) {
      const a = i * 30 * Math.PI / 180;
      g += `<line x1="${50 + 36 * Math.sin(a)}" y1="${50 - 36 * Math.cos(a)}" x2="${50 + 41 * Math.sin(a)}" y2="${50 - 41 * Math.cos(a)}" stroke="#6B3A2E" stroke-width="2.5"/>`;
    }
    $('clockTicks').innerHTML = g;
  }
  clearInterval(tick);
  const paint = () => {
    const left = Math.max(0, Math.ceil((dl - Date.now()) / 1000));
    $('clockNum').textContent = left;
    c.classList.toggle('warn', left <= 5);
    if (left <= 0) clearInterval(tick);
  };
  paint(); tick = setInterval(paint, 300);
}

/* ============================================================
   겹쳐 뜨는 창
   ============================================================ */
function renderOverlays() {
  const p = S.pending;
  const key = p ? p.kind + (p.deadline || '') + (p.answered?.length || 0) + Object.keys(p.picked || {}).length + (p.result ? 'R' : '') : '';
  if (key !== lastPending) { if (p?.kind === 'battle' && !p.result) answered = false; lastPending = key; }

  $('ovBattle').hidden = !(p && (p.kind === 'battle' || p.kind === 'capture'));
  $('ovChoose').hidden = !(p && p.kind === 'choose' && p.offers?.[me?.id] && !p.picked?.includes(me?.id));
  if (p?.kind === 'battle' || p?.kind === 'capture') renderBattle(p);
  if (p?.kind === 'choose') renderChoose(p);

  /* 특수 승리 알림 */
  (S.winners || []).forEach(w => {
    if (shownWins.has(w.id + w.why)) return;
    shownWins.add(w.id + w.why);
    if (S.status === 'finished') return;
    showSpecial(w);
  });

  $('ovWin').hidden = S.status !== 'finished';
  if (S.status === 'finished') renderRank();
}

function renderBattle(p) {
  $('battleKind').textContent = p.kind === 'capture' ? '잡기 승부' : '영어 배틀';
  $('qUnit').textContent = p.question.unit || '';
  $('qText').textContent = p.question.question;
  const myAns = answered;
  $('qOpts').innerHTML = p.question.options.map((o, i) => {
    let cls = '';
    if (p.answer != null) cls = (i === p.answer - 1) ? 'right' : '';
    return `<button class="opt ${cls}" data-ans="${i}" ${p.answer != null ? 'disabled' : ''}>${i + 1}. ${esc(o)}</button>`;
  }).join('');
  $('qOpts').querySelectorAll('[data-ans]').forEach(b => b.onclick = () => {
    if (answered) return;
    answered = true;
    b.classList.add('mine');
    send('answer', { index: +b.dataset.ans });
  });
  $('whoAnswered').innerHTML = (p.answered || []).map(id => {
    const pl = S.players.find(x => x.id === id);
    return pl ? `<i style="background:${pl.color}" title="${esc(pl.name)}"></i>` : '';
  }).join('');
  const rv = $('qReveal');
  rv.hidden = p.answer == null;
  if (p.answer != null) {
    rv.innerHTML = `<b>${esc(p.result?.text || '')}</b>${p.explanation ? `<br><span class="muted">${esc(p.explanation)}</span>` : ''}`;
  }
  $('battleActs').innerHTML = p.canContinue
    ? `<button class="btn pri" id="btnGo">계속 ▶</button>`
    : (myP()?.id === S.host ? `<button class="btn sm ghost" id="btnGrade">기다리지 않고 바로 채점</button>` : '');
  if ($('btnGo')) $('btnGo').onclick = () => send('continue', {});
  if ($('btnGrade')) $('btnGrade').onclick = () => send('gradeNow', {});
}

function renderChoose(p) {
  const list = p.offers[me?.id] || [];
  $('chooseTitle').textContent = `${p.round}라운드 증강 선택`;
  $('chooseSub').textContent = (p.phaseLabel ? `${p.phaseLabel} · ` : '') + '이 후보는 나에게만 보입니다. 세 장 중 하나를 고르세요.';
  $('augPick').innerHTML = list.map(a => `
    <button class="augCard ${a.rarity === 'legend' ? 'legend' : ''}" data-pick="${a.id}">
      <span class="nm">${esc(a.name)}</span>
      <span class="ds">${esc(a.desc)}</span>
      <span class="tag">${esc(a.group)} · ${a.rarity === 'legend' ? '전설' : a.rarity === 'rare' ? '희귀' : '일반'}</span>
    </button>`).join('');
  $('augPick').querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
    b.classList.add('sel');
    send('choose', { id: b.dataset.pick });
  });
  const waiting = Object.keys(p.offers).filter(id => !(p.picked || []).includes(id)).length;
  $('chooseWait').textContent = waiting > 1 ? `아직 고르는 중인 친구 ${waiting}명` : '';
}

function showSpecial(w) {
  const pl = S.players.find(x => x.id === w.id); if (!pl) return;
  $('spName').textContent = w.why;
  $('spWho').textContent = pl.name;
  $('spFlow').innerHTML = `
    <div class="box"><i style="background:${pl.color}"></i><span><u></u><u></u></span></div>
    <span class="arrow">→</span>
    <div class="box to"><b>${w.rank}위</b></div>`;
  $('spDesc').textContent = `${pl.name}님이 ${w.why}(으)로 ${w.rank}위를 확보했습니다.`;
  $('ovSpecial').hidden = false;
}
$('spOk').onclick = () => { $('ovSpecial').hidden = true; };

function renderRank() {
  const host = myP()?.id === S.host;
  $('btnKillRoom').hidden = !host;
  $('killHint').hidden = !host;
  const rows = S.players.slice().sort((a, b) => (a.rank || 99) - (b.rank || 99));
  $('winRank').innerHTML = rows.map(p => `
    <tr>
      <td class="${p.rank === 1 ? 'top' : ''}">${p.rank || '-'}위</td>
      <td><span class="nm"><i style="background:${p.color}"></i>${esc(p.name)}</span></td>
      <td>${esc(p.winReason || (p.eliminated ? '탈락' : '-'))}</td>
    </tr>`).join('');
}

/* ============================================================
   증강 사용 — 필요한 대상을 고르게 한다
   ============================================================ */
const NEED_LABEL = {
  myStack: '내 말뭉치를 고르세요', myPiece: '내 말을 고르세요', waitingPiece: '아직 안 나온 내 말을 고르세요',
  cell: '칸을 고르세요', player: '대상을 고르세요', outPlayer: '되살릴 사람을 고르세요',
  yut: '낼 윷을 고르세요', rank: '최종 순위를 맞혀 보세요', none: ''
};
function openAbility(id) {
  const my = myP(); if (!my) return;
  const a = (my.augs || []).find(x => x.id === id && !x.spent); if (!a) return;
  abilityOpen = a;
  $('abilTitle').textContent = a.name;
  $('abilDesc').textContent = a.desc;
  const need = a.needs || 'none';
  let body = '';
  const uniq = arr => [...new Set(arr)];

  if (need === 'none') body = `<button class="btn pri" data-go>사용하기</button>`;
  else if (need === 'myStack') {
    const cells = uniq(my.pieces.filter(p => p.pos >= 0 && p.pos !== 99).map(p => p.pos));
    body = cells.length ? cells.map(c => `<button class="btn" data-pos="${c}">${c}번 칸 (${my.pieces.filter(p => p.pos === c).length}개)</button>`).join('')
      : '<p class="muted">판 위에 내 말이 없습니다.</p>';
  } else if (need === 'myPiece' || need === 'waitingPiece') {
    const ok = my.pieces.map((p, i) => ({ p, i })).filter(x => need === 'waitingPiece' ? x.p.pos === -1 : (x.p.pos >= 0 && x.p.pos !== 99));
    body = ok.length ? ok.map(x => `<button class="btn" data-idx="${x.i}">${x.i + 1}번 말${x.p.pos >= 0 ? ` (${x.p.pos}번 칸)` : ''}</button>`).join('')
      : '<p class="muted">고를 수 있는 말이 없습니다.</p>';
  } else if (need === 'cell') {
    body = '<p class="muted" style="width:100%">겨눌 칸 번호</p>' +
      Array.from({ length: 20 }, (_, i) => `<button class="btn sm" data-pos="${i}">${i}</button>`).join('');
  } else if (need === 'player' || need === 'outPlayer') {
    const list = S.players.filter(p => p.id !== me.id && (need === 'outPlayer' ? p.eliminated : !p.eliminated));
    body = list.length ? list.map(p => `<button class="btn" data-pid="${p.id}">${esc(p.name)}</button>`).join('')
      : '<p class="muted">고를 수 있는 사람이 없습니다.</p>';
  } else if (need === 'yut') {
    body = [[-1, '백도'], [1, '도'], [2, '개'], [3, '걸'], [4, '윷'], [5, '모']]
      .map(([v, n]) => `<button class="btn" data-v="${v}">${n}</button>`).join('');
  } else if (need === 'rank') {
    body = `<p class="muted" style="width:100%">1위부터 순서대로 누르세요.</p>` +
      S.players.filter(p => !p.eliminated).map(p => `<button class="btn" data-rank="${p.id}">${esc(p.name)}</button>`).join('') +
      `<div style="width:100%;margin-top:8px"><b id="rankPick"></b></div>
       <button class="btn pri" data-go style="margin-top:8px">이 순서로 확정</button>`;
  }
  $('abilBody').innerHTML = body;

  const order = [];
  $('abilBody').onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.rank) {
      if (!order.includes(b.dataset.rank)) order.push(b.dataset.rank);
      $('rankPick').textContent = order.map(id => S.players.find(p => p.id === id)?.name).join(' → ');
      return;
    }
    const prm = { id };
    if (b.dataset.pos != null) prm.pos = +b.dataset.pos;
    if (b.dataset.idx != null) prm.idx = +b.dataset.idx;
    if (b.dataset.pid) prm.playerId = b.dataset.pid;
    if (b.dataset.v != null) prm.v = +b.dataset.v;
    if (b.hasAttribute('data-go') && need === 'rank') prm.order = order;
    closeAbility();
    send('ability', prm);
  };
  $('ovAbility').hidden = false;
}
function closeAbility() { $('ovAbility').hidden = true; abilityOpen = null; }
$('abilCancel').onclick = closeAbility;

/* ============================================================
   통신
   ============================================================ */
socket.on('connect', () => { if (me?.code) send('rejoin', { code: me.code, id: me.id }); });
socket.on('state', st => {
  const prev = S;
  S = st;
  if (prev && st.round > (prev.round || 0) && st.round > 1) cutin(`${st.round}라운드`);
  if (st.anim && st.anim.seq !== lastAnimSeq) lastAnimSeq = st.anim.seq;
  render();
});
socket.on('closed', () => {
  /* 선생님은 관전만 하던 것이므로 관제실에 그대로 남는다 */
  if (teacherOn) {
    watching = ''; S = null;
    toast('방이 닫혔습니다.');
    renderTeacher();
    return;
  }
  toast('방이 닫혔습니다.');
  setTimeout(leave, 1200);
});
socket.on('rooms', rs => { LAST_ROOMS = rs; if (teacherOn && !watching) renderTeacher(); });
socket.on('sets', ss => { SETS = ss; if (teacherOn && !watching) renderTeacher(); });

/* ============================================================
   교사 관제실
   ============================================================ */
$('btnTeacher').onclick = () => {
  teacherPin = $('teacherPin').value;
  send('teacher:login', { pin: teacherPin }, res => {
    if (!res?.ok) return;
    teacherOn = true; watching = ''; LAST_ROOMS = res.rooms || []; SETS = res.sets || [];
    show('teacher'); renderTeacher();
  });
};
$('btnTeacherOut').onclick = () => { if (watching) { watching = ''; renderTeacher(); } else { teacherOn = false; show('landing'); } };
$('btnNewSet').onclick = () => { $('newSetBox').hidden = false; };
$('btnCancelSet').onclick = () => { $('newSetBox').hidden = true; };

/* 교사용 요청 — PIN은 서버가 x-teacher-pin 헤더로 받는다 */
async function teacherFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), 'x-teacher-pin': teacherPin }
  });
  let d = null;
  try { d = await res.json(); } catch (e) { d = null; }
  if (!res.ok || d?.error) {
    const msg = d?.error || `요청이 실패했습니다 (${res.status})`;
    toast(res.status === 403 ? '교사 PIN이 다릅니다. 관제실을 다시 열어 주세요.' : msg);
    if (d?.hint) $('classOut').innerHTML = `<p class="hint">${esc(d.hint)}</p>`;
    return null;
  }
  return d;
}

$('btnMakeClass').onclick = async () => {
  const name = $('className').value.trim();
  if (!name) return toast('세트 이름을 써 주세요.');
  const f = $('classFile').files[0];
  const btn = $('btnMakeClass');
  btn.disabled = true; btn.textContent = '올리는 중…';
  try {
    const body = f ? await f.arrayBuffer() : new ArrayBuffer(0);
    const d = await teacherFetch('/api/class?name=' + encodeURIComponent(name), {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body
    });
    if (!d) return;
    const url = location.origin + '/?class=' + d.code;
    $('classOut').innerHTML =
      `<p class="hint">만들었습니다 — 문제 ${d.count}개<br>학생 주소: <b>${esc(url)}</b></p>` +
      (d.skipped?.length ? `<p class="hint">못 읽은 줄 ${d.skipped.length}개: ${esc(d.skipped.join(', '))}</p>` : '');
    $('className').value = ''; $('classFile').value = '';
  } catch (e) {
    toast('만들지 못했습니다: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '만들기';
  }
};

function renderTeacher() {
  if (watching) return renderWatch();
  $('teacherInfo').textContent = `방 ${LAST_ROOMS.length}개 · 문제 세트 ${SETS.length}개`;
  $('setList').innerHTML = SETS.map(s => `
    <div class="setRow">
      <span class="nm">${esc(s.name)}</span>
      <span class="chip ${s.active ? 'live' : ''}">${s.active ? '지금 적용 중' : '문제 ' + s.count + '개'}</span>
      <button class="btn sm" data-act="${s.code}">지금 적용</button>
      <button class="btn sm" data-copy="${s.code}">주소 복사</button>
      ${s.builtin ? '' : `<button class="btn sm ghost" data-del="${s.code}">삭제</button>`}
    </div>`).join('');
  $('roomGrid').innerHTML = LAST_ROOMS.map(r => `
    <div class="roomCard">
      <h4>${r.code}</h4>
      <div class="muted tiny">${r.className || '기본 문제'} · ${r.status === 'playing' ? '진행 중' : r.status === 'waiting' ? '대기' : '끝남'} · ${r.minutes}분</div>
      <div class="pl">${r.players.map(p => `${esc(p.name)} — ${p.correct}/${p.total} 정답${p.eliminated ? ' (탈락)' : ''}`).join('<br>')}</div>
      <div class="row" style="margin-top:8px">
        <button class="btn sm" data-watch="${r.code}">관전</button>
        <button class="btn sm ghost" data-pause="${r.code}">${r.paused ? '재개' : '일시정지'}</button>
        <button class="btn sm danger" data-kill="${r.code}">방 없애기</button>
      </div>
    </div>`).join('');
}
function renderWatch() {
  $('teacherInfo').textContent = `${watching} 관전 중`;
  $('setList').innerHTML = `<div class="row" style="max-width:360px">
      <button class="btn sm" data-back>관전 끝내기</button>
      <button class="btn sm danger" data-kill="${watching}">이 방 없애기</button>
    </div>`;
  $('roomGrid').innerHTML = S ? `<div class="roomCard" style="grid-column:1/-1">
    <h4>${S.code} — ${S.round}라운드</h4>
    <div class="pl">${S.players.map(p => `${esc(p.name)} — 말 ${p.pieces.filter(x => x.pos === 99).length}/${p.pieces.length} 도착 · 증강 ${(p.augs || []).length}개${p.eliminated ? ' (탈락)' : ''}`).join('<br>')}</div>
    <div class="log" style="margin-top:10px">${(S.log || []).slice(-14).map(x => `<div>${esc(x.t)}</div>`).join('')}</div>
  </div>` : '';
}
$('teacher').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.watch) { watching = b.dataset.watch; send('teacher:watch', { code: watching }); renderTeacher(); }
  if (b.hasAttribute('data-back')) { watching = ''; renderTeacher(); }
  if (b.dataset.pause) send('teacher:pause', { code: b.dataset.pause });
  if (b.dataset.kill) {
    const code = b.dataset.kill;
    if (!confirm(`${code} 방을 없앨까요? 그 방 학생들은 모두 시작 화면으로 돌아갑니다.`)) return;
    send('teacher:close', { code }, res => {
      if (!res?.ok) return;
      toast(`${code} 방을 없앴습니다.`);
      if (watching === code) { watching = ''; S = null; }
      renderTeacher();
    });
  }
  if (b.dataset.act) teacherFetch('/api/class/' + b.dataset.act + '/activate', { method: 'POST' })
    .then(d => { if (d) toast(`「${d.name}」을(를) 적용했습니다. (문제 ${d.count}개)`); });
  if (b.dataset.copy) {
    const url = location.origin + '/?class=' + b.dataset.copy;
    navigator.clipboard?.writeText(url).then(() => toast('주소를 복사했습니다: ' + url), () => toast(url));
  }
  if (b.dataset.del && confirm('이 문제 세트를 지울까요?'))
    teacherFetch('/api/class/' + b.dataset.del, { method: 'DELETE' })
      .then(d => { if (d) toast('지웠습니다.'); });
});

show('landing');
