/* ============================================================
   English Yut Battle — 화면 쪽 코드
   ============================================================ */
'use strict';
const socket = io();
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ANIMALS = [
  { ko: '도', an: '돼지', en: 'pig', emo: '🐷', n: 1 },
  { ko: '개', an: '개', en: 'dog', emo: '🐶', n: 2 },
  { ko: '걸', an: '양', en: 'sheep', emo: '🐑', n: 3 },
  { ko: '윷', an: '소', en: 'cow', emo: '🐮', n: 4 },
  { ko: '모', an: '말', en: 'horse', emo: '🐴', n: 5 }
];
const FINISH = 99;

let me = null;                       // {code,id}
let S = null;                        // 서버가 내려준 방 상태
let AUG = [];                        // 증강 목록
let mode = 'simple', teacherOn = false, teacherPin = '', watching = '';
let answered = false, lastPendingKey = '', lastRollSeq = -1, lastAnimSeq = -1, lastWin = false;
let tickTimer = null;
let animating = null;                // 말 이동 애니메이션 중인 좌표

try { me = JSON.parse(localStorage.getItem('yutMe') || 'null'); } catch (e) { }
/* 주소에 붙은 수업 코드 — 예: .../?class=A1B2  또는  .../#A1B2 */
let CLASS = null;
const clsParam = (new URLSearchParams(location.search).get('class') || location.hash.replace('#', '')).toUpperCase().trim();

/* ---------- 작은 도구 ---------- */
function show(name) {
  ['landing', 'waiting', 'game', 'teacher'].forEach(x => $(x).classList.toggle('on', x === name));
  window.scrollTo(0, 0);
}
let toastT;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600);
}
function cutin(text) {
  const c = $('cutin'); $('cutinText').textContent = text;
  c.hidden = false; const s = $('cutinText');
  s.style.animation = 'none'; void s.offsetWidth; s.style.animation = '';
  setTimeout(() => { c.hidden = true; }, 1500);
}
function send(ev, data, cb) {
  socket.emit(ev, data, res => {
    if (res && !res.ok) toast(res.error || '할 수 없습니다.');
    cb?.(res);
  });
}
const myPlayer = () => S?.players.find(p => p.id === me?.id) || null;
const isMyTurn = () => S && S.players[S.turn]?.id === me?.id;

/* ============================================================
   시작 화면
   ============================================================ */
function buildStrip() {
  $('animalStrip').innerHTML = ANIMALS.map(a =>
    `<div><span>${a.emo}</span><b>${a.ko} · ${a.an}</b><em>${a.en}</em></div>`).join('');
}

$('modeSeg').addEventListener('click', e => {
  const b = e.target.closest('.seg'); if (!b) return;
  mode = b.dataset.mode;
  [...$('modeSeg').children].forEach(x => x.classList.toggle('on', x === b));
});

$('btnCreate').onclick = () => {
  const name = $('myName').value.trim();
  if (!name) return toast('이름을 먼저 써 주세요.');
  localStorage.setItem('yutName', name);
  send('create', { name, mode, pieceCount: +$('pieceCount').value, classCode: CLASS?.code }, res => {
    if (res?.ok) { me = { code: res.code, id: res.id }; localStorage.setItem('yutMe', JSON.stringify(me)); }
  });
};
$('btnJoin').onclick = () => {
  const name = $('myName').value.trim();
  if (!name) return toast('이름을 먼저 써 주세요.');
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
$('btnLeaveGame').onclick = () => { if (confirm('게임에서 나갈까요? 돌아올 수 없어요.')) leave(); };
$('btnAgain').onclick = leave;

/* ============================================================
   말판 그리기
   ============================================================ */
function nodeXY(coord, k) {
  const c = coord[k]; if (!c) return null;
  return [62 + c[0] * 95.2, 62 + c[1] * 95.2];
}
function drawBoard() {
  if (!S) return;
  const B = S.board, co = B.coord;
  const L = (a, b, w, col, dash) => {
    const p = nodeXY(co, a), q = nodeXY(co, b); if (!p || !q) return '';
    return `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  };
  let g = `<rect x="6" y="6" width="588" height="588" rx="30" fill="#FFFCF4" stroke="#C9A678" stroke-width="5"/>`;
  // 바깥 길
  for (let i = 0; i < B.ring; i++) g += L(i, (i + 1) % B.ring, 11, '#E3CDA4');
  // 지름길
  g += L(5, B.scA[0], 9, '#E8D3AE', '3 12');
  for (let i = 0; i < B.scA.length - 1; i++) g += L(B.scA[i], B.scA[i + 1], 9, '#E8D3AE', '3 12');
  g += L(B.scA[B.scA.length - 1], 15, 9, '#E8D3AE', '3 12');
  g += L(10, B.scB[0], 9, '#E8D3AE', '3 12');
  for (let i = 0; i < B.scB.length - 1; i++) g += L(B.scB[i], B.scB[i + 1], 9, '#E8D3AE', '3 12');
  g += L(B.scB[B.scB.length - 1], 0, 9, '#E8D3AE', '3 12');

  // 칸
  const trapAt = p => S.traps.some(t => t.pos === p);
  for (const key of Object.keys(co)) {
    const k = +key, xy = nodeXY(co, k); if (!xy) continue;
    const corner = B.corners.includes(k), center = k === B.center, start = k === 0;
    const r = center ? 34 : corner ? 29 : 21;
    const fill = center ? '#FFE9BC' : start ? '#FFE0D8' : corner ? '#FFF1D6' : '#FFFDF7';
    const stroke = center ? '#E0A23C' : start ? '#E2524E' : corner ? '#D8A45A' : '#CBAE84';
    g += `<circle cx="${xy[0]}" cy="${xy[1]}" r="${r}" fill="${fill}" stroke="${center || start ? stroke : '#CBAE84'}" stroke-width="${center || corner ? 4 : 3}"/>`;
    if (center) g += `<text x="${xy[0]}" y="${xy[1] + 7}" text-anchor="middle" font-size="20" font-family="Jua" fill="#B8862B">방</text>`;
    else if (start) g += `<text x="${xy[0]}" y="${xy[1] + 6}" text-anchor="middle" font-size="15" font-family="Jua" fill="#E2524E">출발</text>`;
    if (trapAt(k)) g += `<text x="${xy[0]}" y="${xy[1] - 24}" text-anchor="middle" font-size="19">🕸️</text>`;
  }

  // 진행 방향 안내
  const a0 = nodeXY(co, 0), a1 = nodeXY(co, 1);
  if (a0 && a1) g += `<text x="${a0[0] + 2}" y="${(a0[1] + a1[1]) / 2 + 5}" text-anchor="middle" font-size="22" fill="#D98A86">▲</text>`;

  // 말 — 한 칸을 여러 명이 나눠 쓸 때만 자리를 벌린다
  const occupy = {};
  S.players.forEach(pl => {
    const stacks = {};
    pl.pieces.forEach((p, i) => { if (p.pos >= 0 && p.pos !== FINISH) (stacks[p.pos] = stacks[p.pos] || []).push(i); });
    Object.entries(stacks).forEach(([pos, idxs]) => { (occupy[pos] = occupy[pos] || []).push({ pl, idxs }); });
  });
  Object.entries(occupy).forEach(([pos, list]) => {
    const n = list.length;
    list.forEach((item, k) => {
      const { pl, idxs } = item;
      const live = animating && animating.player === pl.id && idxs.some(i => animating.pieces.includes(i));
      const base = live ? animating.xy : nodeXY(co, +pos);
      if (!base) return;
      let dx = 0, dy = 0;
      if (n > 1) { const ang = (Math.PI * 2 * k) / n - Math.PI / 2, rad = 15; dx = Math.cos(ang) * rad; dy = Math.sin(ang) * rad; }
      const x = base[0] + dx, y = base[1] + dy;
      const r = n > 1 ? 14 : 17;
      g += `<circle cx="${x}" cy="${y}" r="${r}" fill="${pl.color}" stroke="#fff" stroke-width="3.5"/>`;
      g += `<text x="${x}" y="${y + r * 0.37}" text-anchor="middle" font-size="${Math.round(r * 1.05)}">${pl.animal}</text>`;
      if (idxs.length > 1) g += `<circle cx="${x + r * .78}" cy="${y - r * .78}" r="9" fill="#3B2E23"/><text x="${x + r * .78}" y="${y - r * .78 + 4}" text-anchor="middle" font-size="11" fill="#fff" font-family="Jua">${idxs.length}</text>`;
      if (idxs.reduce((s, i) => s + (pl.pieces[i].shield || 0), 0)) g += `<text x="${x - r - 2}" y="${y - r * .5}" font-size="13">🛡️</text>`;
      if (idxs.some(i => pl.pieces[i].frozen)) g += `<text x="${x - r - 2}" y="${y + r + 6}" font-size="13">❄️</text>`;
    });
  });
  $('board').innerHTML = g;
}

/* 말이 한 칸씩 뛰어가는 애니메이션 */
function runAnim(anim) {
  if (!anim || !anim.trail || !anim.trail.length) return;
  const co = S.board.coord;
  const startPos = anim.trail;
  let i = 0;
  const hop = () => {
    if (i >= startPos.length) { animating = null; drawBoard(); return; }
    const to = startPos[i], toXY = nodeXY(co, to);
    if (!toXY) { i++; return hop(); }
    const fromXY = animating?.xy || nodeXY(co, i === 0 ? startPos[0] : startPos[i - 1]) || toXY;
    const t0 = performance.now(), dur = 160;
    const frame = now => {
      const k = Math.min(1, (now - t0) / dur);
      const x = fromXY[0] + (toXY[0] - fromXY[0]) * k;
      const y = fromXY[1] + (toXY[1] - fromXY[1]) * k - Math.sin(k * Math.PI) * 18;
      animating = { player: anim.player, pieces: anim.pieces, xy: [x, y] };
      drawBoard();
      if (k < 1) requestAnimationFrame(frame); else { i++; hop(); }
    };
    requestAnimationFrame(frame);
  };
  animating = { player: anim.player, pieces: anim.pieces, xy: nodeXY(co, startPos[0]) };
  hop();
}

/* ============================================================
   윷 결과
   ============================================================ */
function showRoll(roll) {
  const box = $('rollBox'), st = $('sticks'), rs = $('rollResult');
  box.hidden = false; rs.classList.remove('show'); rs.innerHTML = '';
  st.classList.add('rolling');
  [...st.children].forEach(c => c.classList.remove('flat'));
  setTimeout(() => {
    st.classList.remove('rolling');
    (roll.sticks || []).forEach((v, i) => st.children[i]?.classList.toggle('flat', !!v));
    const a = ANIMALS.find(x => x.n === roll.v) || ANIMALS[0];
    rs.innerHTML = `<div class="emo">${a.emo}</div><div class="ko">${a.ko} — ${a.an}</div>
      <div class="en">A ${a.en}! Move ${roll.v} ${roll.v === 1 ? 'space' : 'spaces'}.</div>
      <div class="mv">${roll.v}칸 이동${roll.v >= 4 ? ' · 한 번 더 던져요!' : ''}</div>`;
    rs.classList.add('show');
    setTimeout(() => { box.hidden = true; }, 1900);
  }, 850);
}

/* ============================================================
   화면 그리기
   ============================================================ */
function render() {
  if (!S) return;
  if (S.status === 'waiting') return renderWait();
  show('game');

  const turnPl = S.players[S.turn];
  $('gameCode').textContent = S.code;
  $('turnNow').textContent = S.paused ? '⏸️ 선생님이 잠시 멈췄어요'
    : S.status === 'finished' ? `🏆 ${S.winner} 우승!`
      : isMyTurn() ? '🔥 내 차례예요!' : `${turnPl?.animal || ''} ${turnPl?.name || ''} 차례`;

  renderMe();
  renderRoster();
  $('log').innerHTML = S.log.slice().reverse().map(l => `<div>${esc(l.t)}</div>`).join('');
  drawBoard();
  renderPending();

  if (S.status === 'finished' && !lastWin) { lastWin = true; renderWin(); }
}

function renderWait() {
  show('waiting');
  $('waitCode').textContent = S.code;
  $('waitMode').textContent = S.mode === 'full' ? '🔥 본격 증강' : '🌱 간편 수업';
  $('waitClass').textContent = S.className ? '📚 ' + S.className : '';
  $('waitClass').hidden = !S.className;
  let html = '';
  for (let i = 0; i < 5; i++) {
    const p = S.players[i];
    html += p
      ? `<div class="seat full"><span class="av">${p.animal}</span><span class="nm">${esc(p.name)}</span>${p.id === S.host ? '<span class="host">방장</span>' : ''}</div>`
      : `<div class="seat">빈자리</div>`;
  }
  $('waitSeats').innerHTML = html;
  const n = S.players.length, amHost = S.host === me?.id;
  $('waitInfo').textContent = n < 2 ? '친구를 기다리는 중이에요. (2명부터 시작)'
    : amHost ? '모두 모였으면 시작을 누르세요.' : '방장이 시작하기를 기다려요.';
  $('btnStart').hidden = !amHost;
  $('btnStart').disabled = n < 2;
}

function renderMe() {
  const p = myPlayer();
  if (!p) { $('mePanel').innerHTML = '<p class="empty">관전 중입니다.</p>'; return; }
  const my = isMyTurn() && S.status === 'playing' && !S.paused && !S.pending;
  const pct = p.total ? Math.round(p.correct / p.total * 100) : 0;

  let h = `<div class="meTop"><span class="av">${p.animal}</span>
    <span class="nm">${esc(p.name)}</span>
    <span class="sc">정답 ${p.correct}/${p.total} (${pct}%)<br>⚡ 속도점수 ${p.speed}</span></div>`;

  if (S.status === 'playing') {
    if (my && !S.roll) h += `<button class="btn big throwBtn" id="btnThrow">🎲 윷 던지기</button>`;
    else if (my && S.roll) h += `<div class="chip" style="display:block;text-align:center;margin-bottom:10px">
      ${ANIMALS.find(a => a.n === S.roll.v)?.emo || ''} <b>${S.roll.name}</b> — 움직일 말을 고르세요 (${S.roll.v}칸)</div>`;

    // 말
    h += `<div class="pieceRow">`;
    p.pieces.forEach((pc, i) => {
      const at = pc.pos === -1 ? '집' : pc.pos === FINISH ? '완주' : `${pc.pos}번`;
      const can = my && S.roll && pc.pos !== FINISH && !pc.frozen;
      h += `<button class="pieceBtn ${can ? 'can' : ''}" data-piece="${i}" ${can ? '' : 'disabled'}>
        <b>말 ${i + 1}</b>${at}${pc.shield ? ' 🛡️' : ''}${pc.frozen ? ' ❄️' : ''}</button>`;
    });
    h += `</div>`;

    // 증강
    h += `<h3 class="pt" style="margin-top:14px">내 증강 ${p.abilities.length ? `(${p.abilities.length})` : ''}</h3>`;
    if (!p.abilities.length) h += `<p class="empty">아직 없어요. 영어 배틀에서 정답을 맞히면 얻어요!</p>`;
    else {
      h += `<div class="augRow">`;
      p.abilities.forEach((id, i) => {
        const a = AUG.find(x => x.id === id); if (!a) return;
        h += `<button class="augChip ${a.rarity}" data-aug="${id}" data-slot="${i}" ${my ? '' : 'disabled'}>
          <span class="ic">${a.icon}</span>${a.name}</button>`;
      });
      h += `</div>`;
      if (!my) h += `<p class="empty">내 차례에 쓸 수 있어요.</p>`;
    }
    if (p.doubleNext) h += `<p class="empty">✨ 다음 이동은 두 배!</p>`;
    if (p.fate) h += `<p class="empty">🔮 운명의 윷을 예약했어요.</p>`;
    // 방장은 멈춰 있는 친구의 차례를 넘길 수 있다
    if (S.host === me?.id && !my && !S.pending && S.status === 'playing' && !S.paused) {
      const t = S.players[S.turn];
      h += `<button class="btn ghost sm" id="btnSkipTurn" style="width:100%;margin-top:10px">
        ⏭️ ${esc(t?.name || '')} 차례 넘기기${t && !t.connected ? ' (연결 끊김)' : ''}</button>`;
    }
  }
  $('mePanel').innerHTML = h;

  const bt = $('btnThrow');
  if (bt) bt.onclick = () => { bt.disabled = true; send('throw', {}); };
  $('mePanel').querySelectorAll('[data-piece]').forEach(b =>
    b.onclick = () => send('move', { piece: +b.dataset.piece }));
  $('mePanel').querySelectorAll('[data-aug]').forEach(b =>
    b.onclick = () => openAbility(b.dataset.aug));
  const sk = $('btnSkipTurn');
  if (sk) sk.onclick = () => { sk.disabled = true; send('skipTurn', {}); };
}

function renderRoster() {
  $('roster').innerHTML = S.players.map((p, i) => {
    const pct = p.total ? Math.round(p.correct / p.total * 100) : 0;
    const total = p.pieces.length * S.board.ring;
    const w = Math.min(100, Math.round(p.progress / total * 100));
    const home = p.pieces.filter(x => x.pos === FINISH).length;
    return `<div class="rost ${i === S.turn && S.status === 'playing' ? 'turn' : ''} ${p.connected ? '' : 'off'}">
      <span class="av">${p.animal}</span>
      <span class="nm">${esc(p.name)}${p.id === me?.id ? ' (나)' : ''}</span>
      <span class="st">🏁 ${home}/${p.pieces.length} · ✅ ${pct}%<br>
        <span class="bar"><i style="width:${w}%"></i></span></span>
    </div>`;
  }).join('');
}

/* ============================================================
   배틀·증강 선택
   ============================================================ */
function renderPending() {
  const p = S.pending;
  const key = p ? `${p.kind}:${p.deadline}:${p.revealed ? 'r' : ''}${p.result ? 'x' : ''}` : '';
  if (p && (p.kind === 'battle' || p.kind === 'capture')) {
    if (key !== lastPendingKey) { answered = false; openBattle(p); }
    else updateBattle(p);
    lastPendingKey = key;
    return;
  }
  $('ovBattle').hidden = true;
  if (p && p.kind === 'choose') {
    if (key !== lastPendingKey) openChoose(p);
    lastPendingKey = key;
    return;
  }
  $('ovChoose').hidden = true;
  lastPendingKey = key;
  stopTick();
}

function startTick(deadline, el) {
  stopTick();
  const paint = () => {
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    el.textContent = left;
    el.classList.toggle('warn', left <= 5);
  };
  paint(); tickTimer = setInterval(paint, 200);
}
function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }

function openBattle(p) {
  const capture = p.kind === 'capture';
  const amIn = !capture || [p.attacker, p.defender].includes(me?.id);
  $('battleKind').textContent = capture ? '⚔️ 잡기 승부' : '📣 영어 배틀';
  $('battleKind').className = 'badge' + (capture ? ' capture' : '');
  $('qUnit').textContent = [p.question.unit, p.question.level].filter(Boolean).join(' · ');
  $('qText').textContent = p.question.question;
  $('qOpts').innerHTML = p.question.options.map((o, i) =>
    `<button class="opt" data-i="${i}" ${amIn ? '' : 'disabled'}><span class="no">${i + 1}</span><span>${esc(o)}</span></button>`).join('');
  $('qOpts').querySelectorAll('.opt').forEach(b => b.onclick = () => {
    if (answered) return;
    answered = true;
    b.classList.add('picked');
    $('qOpts').querySelectorAll('.opt').forEach(x => x.disabled = true);
    send('answer', { index: +b.dataset.i });
  });
  $('qReveal').hidden = true;
  $('battleActs').innerHTML = '';
  $('ovBattle').hidden = false;
  startTick(p.deadline, $('battleTimer'));
  updateBattle(p);
  if (capture && amIn) cutin('⚔️ 잡기 승부!');
}

function updateBattle(p) {
  const list = p.kind === 'capture'
    ? S.players.filter(x => [p.attacker, p.defender].includes(x.id))
    : S.players.filter(x => x.connected);
  $('whoAnswered').innerHTML = list.map(x =>
    `<span class="${p.answered.includes(x.id) ? 'done' : ''}">${x.animal} ${esc(x.name)}${p.answered.includes(x.id) ? ' ✓' : ' …'}</span>`).join('');

  const acts = $('battleActs');
  if (p.answer) {
    const right = p.answer - 1;
    $('qOpts').querySelectorAll('.opt').forEach((b, i) => {
      b.disabled = true;
      if (i === right) b.classList.add('right');
      else if (b.classList.contains('picked')) b.classList.add('wrong');
    });
    $('qReveal').hidden = false;
    $('qReveal').innerHTML =
      `<b>정답: ${p.answer}번 — ${esc(p.question.options[right])}</b>` +
      (p.explanation ? `<br>${esc(p.explanation)}` : '') +
      (p.result ? `<br><br>${esc(p.result.text)}` : '');
    if (p.canContinue) {
      startTick(p.deadline, $('battleTimer'));
      if (!acts.querySelector('[data-go]')) {
        acts.innerHTML = `<button class="btn big" data-go="1">계속 ▶</button>`;
        acts.querySelector('[data-go]').onclick = e => { e.target.disabled = true; send('continue', {}); };
      }
    }
  } else {
    // 아직 채점 전 — 방장은 기다리지 않고 바로 채점할 수 있다
    const amHost = S.host === me?.id;
    const waiting = list.filter(x => !p.answered.includes(x.id)).length;
    if (amHost && waiting > 0 && answered) {
      if (!acts.querySelector('[data-grade]')) {
        acts.innerHTML = `<button class="btn alt" data-grade="1">⏩ 기다리지 않고 바로 채점</button>`;
        acts.querySelector('[data-grade]').onclick = e => { e.target.disabled = true; send('gradeNow', {}); };
      }
    } else if (!amHost || !answered) acts.innerHTML = '';
  }
}

function openChoose(p) {
  const mine = p.player === me?.id;
  $('ovChoose').hidden = false;
  const who = S.players.find(x => x.id === p.player);
  $('chooseWho').textContent = mine ? '마음에 드는 것을 고르세요!' : `${who?.animal || ''} ${who?.name || ''} 이(가) 고르는 중…`;
  $('augPick').innerHTML = p.choices.map(a =>
    `<button class="augCard ${a.rarity}" data-aug="${a.id}" ${mine ? '' : 'disabled'}>
      <span class="ic">${a.icon}</span><span class="nm">${a.name}</span><span class="ds">${a.desc}</span>
      <span class="rr">${a.rarity === 'legend' ? '전설' : a.rarity === 'rare' ? '희귀' : '일반'}</span></button>`).join('');
  $('augPick').querySelectorAll('[data-aug]').forEach(b => b.onclick = () => {
    b.disabled = true;
    send('choose', { id: b.dataset.aug });
  });
  startTick(p.deadline, $('chooseTimer'));
}

/* ============================================================
   증강 사용 (대상 고르기)
   ============================================================ */
function openAbility(id) {
  const a = AUG.find(x => x.id === id); if (!a) return;
  const p = myPlayer();
  $('abilTitle').textContent = `${a.icon} ${a.name}`;
  $('abilDesc').textContent = a.desc;
  const body = $('abilBody');
  const useIt = extra => { $('ovAbility').hidden = true; send('ability', { id, ...extra }); };

  const needMine = ['boost', 'jump', 'shield', 'trap', 'swap'].includes(id);
  const needHome = id === 'heal';
  const needEnemyPiece = ['freeze', 'back', 'swap'].includes(id);
  const needEnemy = id === 'steal';
  const needValue = id === 'fate';

  let h = '';
  if (needValue) {
    h = `<div class="pickList">${ANIMALS.map(x =>
      `<button data-v="${x.n}">${x.emo} ${x.ko} — ${x.an} (${x.en}) · ${x.n}칸</button>`).join('')}</div>`;
  } else if (needMine || needHome) {
    const list = p.pieces.map((pc, i) => ({ pc, i }))
      .filter(x => needHome ? x.pc.pos === -1 : (x.pc.pos !== FINISH && (id === 'trap' || id === 'swap' ? x.pc.pos >= 0 : true)));
    if (!list.length) h = `<p class="hint center">쓸 수 있는 내 말이 없어요.</p>`;
    else h = `<div class="pickList">${list.map(x =>
      `<button data-mine="${x.i}">말 ${x.i + 1} — ${x.pc.pos === -1 ? '집' : x.pc.pos + '번'}</button>`).join('')}</div>`;
  } else if (needEnemy || needEnemyPiece) {
    const rows = [];
    S.players.filter(x => x.id !== me.id).forEach(en => {
      if (needEnemy) { if (en.abilities.length) rows.push(`<button data-target="${en.id}">${en.animal} ${esc(en.name)} — 증강 ${en.abilities.length}개</button>`); }
      else en.pieces.forEach((pc, i) => {
        if (pc.pos >= 0 && pc.pos !== FINISH) rows.push(`<button data-target="${en.id}" data-ep="${i}">${en.animal} ${esc(en.name)}의 말 ${i + 1} — ${pc.pos}번</button>`);
      });
    });
    h = rows.length ? `<div class="pickList">${rows.join('')}</div>` : `<p class="hint center">고를 수 있는 상대가 없어요.</p>`;
  } else {
    h = `<div class="pickList"><button data-go="1">바로 사용하기</button></div>`;
  }
  body.innerHTML = h;
  $('ovAbility').hidden = false;

  body.querySelectorAll('[data-v]').forEach(b => b.onclick = () => useIt({ value: +b.dataset.v }));
  body.querySelectorAll('[data-go]').forEach(b => b.onclick = () => useIt({}));
  body.querySelectorAll('[data-mine]').forEach(b => b.onclick = () => {
    const piece = +b.dataset.mine;
    if (id === 'swap') { pickEnemyThen(id, piece); return; }
    useIt({ piece });
  });
  body.querySelectorAll('[data-target]').forEach(b => b.onclick = () =>
    useIt({ target: b.dataset.target, enemyPiece: b.dataset.ep ? +b.dataset.ep : 0 }));
}
function pickEnemyThen(id, piece) {
  const rows = [];
  S.players.filter(x => x.id !== me.id).forEach(en => en.pieces.forEach((pc, i) => {
    if (pc.pos >= 0 && pc.pos !== FINISH) rows.push(`<button data-target="${en.id}" data-ep="${i}">${en.animal} ${esc(en.name)}의 말 ${i + 1} — ${pc.pos}번</button>`);
  }));
  const body = $('abilBody');
  body.innerHTML = rows.length ? `<p class="hint center">자리를 바꿀 상대 말을 고르세요.</p><div class="pickList">${rows.join('')}</div>`
    : `<p class="hint center">바꿀 상대 말이 없어요.</p>`;
  body.querySelectorAll('[data-target]').forEach(b => b.onclick = () => {
    $('ovAbility').hidden = true;
    send('ability', { id, piece, target: b.dataset.target, enemyPiece: +b.dataset.ep });
  });
}
$('abilCancel').onclick = () => { $('ovAbility').hidden = true; };

/* ============================================================
   우승 화면
   ============================================================ */
function renderWin() {
  const sorted = S.players.slice().sort((a, b) =>
    (b.pieces.filter(p => p.pos === FINISH).length - a.pieces.filter(p => p.pos === FINISH).length)
    || (b.progress - a.progress));
  const medal = ['🥇', '🥈', '🥉', '4등', '5등'];
  $('winAnimal').textContent = S.players.find(p => p.name === S.winner)?.animal || '🏆';
  $('winTitle').textContent = `${S.winner} 우승!`;
  $('winRank').innerHTML = sorted.map((p, i) => {
    const pct = p.total ? Math.round(p.correct / p.total * 100) : 0;
    return `<div class="r ${p.id === me?.id ? 'me' : ''}">
      <span class="medal">${medal[i]}</span><span class="nm">${p.animal} ${esc(p.name)}</span>
      <span class="dt">영어 ${p.correct}/${p.total} (${pct}%)<br>⚡ 속도점수 ${p.speed}</span></div>`;
  }).join('');
  $('ovWin').hidden = false;
}

/* ============================================================
   교사 관제실
   ============================================================ */
$('btnTeacher').onclick = () => {
  const pin = $('teacherPin').value;
  send('teacher:login', { pin }, res => {
    if (!res?.ok) return;
    teacherOn = true; teacherPin = pin; AUG = res.augments || AUG;
    show('teacher');
    $('teacherInfo').textContent = `문제은행 ${res.bankCount}문제 · 수업 ${res.classes?.length || 0}개`;
    renderRooms(res.rooms);
    renderClassList(res.classes);
  });
};
$('btnTeacherOut').onclick = () => { teacherOn = false; show('landing'); };

function renderRooms(list) {
  const sel = $('uploadScope');
  const keep = sel.value;
  sel.innerHTML = `<option value="">모든 방에 적용</option>` +
    list.map(r => `<option value="${r.code}">${r.code} 방에만</option>`).join('');
  sel.value = keep;

  if (!list.length) { $('roomGrid').innerHTML = `<p class="hint">아직 열린 방이 없어요. 학생이 방을 만들면 여기에 나타납니다.</p>`; return; }
  $('roomGrid').innerHTML = list.map(r => `
    <div class="roomCard ${r.paused ? 'paused' : ''}">
      <h4>${r.code}</h4>
      <div class="meta">${r.mode === 'full' ? '🔥 본격' : '🌱 간편'} ·
        ${r.status === 'waiting' ? '대기 중' : r.status === 'finished' ? `🏆 ${esc(r.winner || '')}` : `${esc(r.turnName)} 차례`} ·
        ${r.minutes}분 ${r.paused ? '· ⏸️ 멈춤' : ''}</div>
      ${r.players.map(p => {
        const pct = p.total ? Math.round(p.correct / p.total * 100) : 0;
        return `<div class="tRow ${p.connected ? '' : 'off'}"><span>${p.animal}</span>
          <span class="nm">${esc(p.name)}</span>
          <span class="pct">${p.correct}/${p.total} (${pct}%)</span>
          <span>🎁${p.abilities}</span></div>`;
      }).join('')}
      <div class="acts">
        <button class="btn sm alt" data-watch="${r.code}">관전</button>
        <button class="btn sm ghost" data-pause="${r.code}">${r.paused ? '재개' : '일시정지'}</button>
        <button class="btn sm ghost" data-close="${r.code}">닫기</button>
      </div>
    </div>`).join('');

  $('roomGrid').querySelectorAll('[data-watch]').forEach(b => b.onclick = () => {
    watching = b.dataset.watch;
    send('teacher:watch', { code: watching }, res => { if (res?.ok) toast(`${watching} 방을 관전합니다.`); });
  });
  $('roomGrid').querySelectorAll('[data-pause]').forEach(b => b.onclick = () => send('teacher:pause', { code: b.dataset.pause }));
  $('roomGrid').querySelectorAll('[data-close]').forEach(b => b.onclick = () => {
    if (confirm(`${b.dataset.close} 방을 닫을까요? 되돌릴 수 없어요.`)) send('teacher:close', { code: b.dataset.close });
  });
}

$('btnUpload').onclick = async () => {
  const f = $('xlsxFile').files[0];
  if (!f) return toast('엑셀 파일을 고르세요.');
  $('uploadMsg').textContent = '올리는 중…';
  try {
    const scope = $('uploadScope').value;
    const res = await fetch('/api/questions' + (scope ? `?room=${scope}` : ''), {
      method: 'POST', headers: { 'x-teacher-pin': teacherPin }, body: await f.arrayBuffer()
    });
    const d = await res.json();
    if (!res.ok) {
      $('uploadMsg').innerHTML = `❌ ${esc(d.error)}<br>${esc(d.hint || '')}` +
        (d.skipped?.length ? `<br>건너뛴 줄: ${esc(d.skipped.join(' / '))}` : '');
      return;
    }
    $('uploadMsg').innerHTML = `✅ ${d.count}문제를 ${d.scope === 'all' ? '모든 방' : d.scope + ' 방'}에 적용했어요.` +
      (d.units.length ? `<br>단원: ${esc(d.units.join(', '))}` : '') +
      (d.skipped?.length ? `<br>⚠️ 건너뛴 줄: ${esc(d.skipped.join(' / '))}` : '');
  } catch (e) { $('uploadMsg').textContent = '❌ 올리지 못했어요: ' + e.message; }
};

/* ============================================================
   소켓
   ============================================================ */
socket.on('connect', () => {
  $('connChip').textContent = '🟢 연결됨';
  if (me) send('rejoin', me, res => { if (!res?.ok) { localStorage.removeItem('yutMe'); me = null; show('landing'); } });
});
socket.on('disconnect', () => { $('connChip').textContent = '🔴 연결 끊김'; });
socket.on('closed', () => { toast('선생님이 방을 닫았습니다.'); setTimeout(leave, 1200); });

socket.on('state', st => {
  if (teacherOn && st.code !== watching && !me) return;
  if (me && st.code !== me.code && !teacherOn) return;
  const prevTurn = S?.turn, prevStatus = S?.status;
  S = st;
  if (!AUG.length) fetch('/api/info').then(r => r.json()).then(d => { AUG = d.augments; render(); });

  // 윷 결과 연출
  if (st.roll && st.roll.seq !== undefined) { /* 서버가 seq를 쓰지 않으므로 아래 방식 사용 */ }
  const rollKey = st.roll ? `${st.turn}-${st.roll.v}-${st.log.length}` : '';
  if (st.roll && rollKey !== lastRollSeq) { lastRollSeq = rollKey; showRoll(st.roll); }
  if (!st.roll) lastRollSeq = -1;

  // 말 이동 연출
  if (st.anim && st.anim.seq !== lastAnimSeq) { lastAnimSeq = st.anim.seq; runAnim(st.anim); }

  if (teacherOn && !me) { show('teacher'); drawTeacherWatch(); return; }
  render();
  if (prevStatus === 'waiting' && st.status === 'playing') cutin('게임 시작!');
});
socket.on('rooms', list => { if (teacherOn) renderRooms(list); });

function drawTeacherWatch() {
  // 교사가 관전할 때는 말판과 명단만 보여 준다
  show('game');
  $('gameCode').textContent = S.code + ' (관전)';
  const t = S.players[S.turn];
  $('turnNow').textContent = S.paused ? '⏸️ 멈춤' : S.status === 'finished' ? `🏆 ${S.winner}` : `${t?.animal || ''} ${t?.name || ''} 차례`;
  $('mePanel').innerHTML = `<p class="empty">선생님 관전 모드입니다. 학생 화면과 같은 말판이 보입니다.</p>
    <button class="btn sm alt" onclick="location.reload()">관제실로</button>`;
  renderRoster();
  $('log').innerHTML = S.log.slice().reverse().map(l => `<div>${esc(l.t)}</div>`).join('');
  drawBoard();
  renderPending();
}

/* ============================================================
   수업 (교사가 만든 링크)
   ============================================================ */
async function loadClass() {
  if (!clsParam) return;
  try {
    const r = await fetch('/api/class/' + encodeURIComponent(clsParam));
    const d = await r.json();
    if (!r.ok) { $('classBanner').hidden = false; $('classBanner').innerHTML = `<b>수업을 찾을 수 없어요</b><span>${esc(d.error || '')}</span>`; return; }
    CLASS = d;
    $('classBanner').hidden = false;
    $('classBanner').innerHTML = `<b>📚 ${esc(d.name)}</b><span>이 수업의 문제 ${d.count}개로 게임해요 · 모둠끼리 방을 만드세요</span>`;
  } catch (e) { }
}

$('btnMakeClass').onclick = async () => {
  const name = $('className').value.trim() || '영어 수업';
  const f = $('classFile').files[0];
  const out = $('classOut');
  out.innerHTML = '<p class="hint">만드는 중…</p>';
  try {
    const body = f ? await f.arrayBuffer() : new ArrayBuffer(0);
    const res = await fetch('/api/class?name=' + encodeURIComponent(name), {
      method: 'POST', headers: { 'x-teacher-pin': teacherPin }, body
    });
    const d = await res.json();
    if (!res.ok) {
      out.innerHTML = `<p class="hint">❌ ${esc(d.error)}<br>${esc(d.hint || '')}` +
        (d.skipped?.length ? `<br>건너뛴 줄: ${esc(d.skipped.join(' / '))}` : '') + '</p>';
      return;
    }
    const url = location.origin + '/?class=' + d.code;
    out.innerHTML = `<div class="classOut">
      <b>✅ ${esc(d.name)} — 문제 ${d.count}개</b>
      <span class="url" id="classUrl">${esc(url)}</span>
      <div class="row">
        <button class="btn sm" id="btnCopyUrl">주소 복사</button>
        <button class="btn sm alt" id="btnOpenUrl">새 창에서 열어 보기</button>
      </div>
      <p class="hint">이 주소를 반 전체에 알려 주세요. 학생들이 들어가 모둠별로 방을 만듭니다.</p>
      ${d.skipped?.length ? `<p class="hint">⚠️ 건너뛴 줄: ${esc(d.skipped.join(' / '))}</p>` : ''}
    </div>`;
    $('btnCopyUrl').onclick = async () => {
      try { await navigator.clipboard.writeText(url); toast('주소를 복사했어요.'); }
      catch (e) { const r = document.createRange(); r.selectNode($('classUrl')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('주소를 길게 눌러 복사하세요.'); }
    };
    $('btnOpenUrl').onclick = () => window.open(url, '_blank');
    loadClassList();
  } catch (e) { out.innerHTML = `<p class="hint">❌ ${esc(e.message)}</p>`; }
};

function renderClassList(list) {
  if (!list || !list.length) { $('classList').innerHTML = ''; return; }
  $('classList').innerHTML = `<h3 class="pt" style="margin-top:14px">만들어 둔 수업</h3>` + list.map(c => {
    const url = location.origin + '/?class=' + c.code;
    return `<div class="classRow"><span class="nm">${esc(c.name)}</span>
      <span class="muted">문제 ${c.count}개</span>
      <button class="btn sm ghost" data-copy="${esc(url)}">주소 복사</button></div>`;
  }).join('');
  $('classList').querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('주소를 복사했어요.'); }
    catch (e) { prompt('이 주소를 복사하세요', b.dataset.copy); }
  });
}
function loadClassList() {
  send('teacher:login', { pin: teacherPin }, res => { if (res?.ok) renderClassList(res.classes); });
}

/* ---------- 시작 ---------- */
loadClass();
buildStrip();
$('myName').value = localStorage.getItem('yutName') || '';
fetch('/api/info').then(r => r.json()).then(d => { AUG = d.augments; });
if (!me) show('landing');
