/* ============================================================
   English Yut Battle 2차 버전 — 서버
   윷 던지기·채점·턴·승패를 서버가 모두 판정한다(학생이 조작할 수 없음).
   ============================================================ */
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import XLSX from 'xlsx';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  throwSticks, travel, pathOf, remain, progressOf, groupAt,
  COORD, CORNERS, RING, FINISH, CENTER, SC_A, SC_B, rand
} from './game.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 3e6 });
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const PIN = process.env.TEACHER_PIN || '2468';
const SAVE_DIR = process.env.DATA_DIR || 'data';
const SAVE_FILE = path.join(SAVE_DIR, 'rooms.json');
let saveOff = false;        // 디스크에 쓸 수 없는 환경이면 한 번만 알리고 끈다

/* ---------- 시간 제한 (ms) ---------- */
const T = { battle: 20000, capture: 15000, turn: 60000, choose: 25000 };

/* ---------- 증강 ---------- */
const AUG = [
  // 이동
  { id: 'boost',  name: '질주',       icon: '⚡', group: '이동', rarity: 'common',   desc: '내 말 하나를 2칸 더 보낸다' },
  { id: 'jump',   name: '도약',       icon: '🐇', group: '이동', rarity: 'rare',     desc: '내 말 하나를 4칸 보낸다' },
  { id: 'heal',   name: '부활',       icon: '🌱', group: '이동', rarity: 'common',   desc: '아직 못 나온 말 하나를 3칸 보낸다' },
  { id: 'double', name: '두 배 이동', icon: '✨', group: '이동', rarity: 'rare',     desc: '다음 윷 결과만큼 두 배로 간다' },
  { id: 'reroll', name: '다시 던지기', icon: '🎲', group: '이동', rarity: 'common',  desc: '윷을 한 번 더 던진다' },
  { id: 'fate',   name: '운명의 윷',  icon: '🔮', group: '이동', rarity: 'legend',   desc: '다음 윷 결과를 내가 고른다' },
  // 공격
  { id: 'freeze', name: '얼음 감옥',  icon: '❄️', group: '공격', rarity: 'rare',     desc: '상대 말 하나를 한 턴 묶는다' },
  { id: 'back',   name: '역행',       icon: '↩️', group: '공격', rarity: 'rare',     desc: '상대 말 하나를 3칸 뒤로 보낸다' },
  { id: 'trap',   name: '함정',       icon: '🕸️', group: '공격', rarity: 'rare',     desc: '내 말이 선 칸에 함정을 둔다' },
  { id: 'steal',  name: '능력 훔치기', icon: '🦊', group: '공격', rarity: 'legend',  desc: '상대의 증강 하나를 빼앗는다(방어막 무시)' },
  // 수비
  { id: 'shield', name: '방어막',     icon: '🛡️', group: '수비', rarity: 'common',   desc: '내 말 하나가 잡기를 한 번 막는다' },
  { id: 'guard',  name: '전체 보호',  icon: '🏰', group: '수비', rarity: 'legend',   desc: '내 모든 말이 잡기를 한 번 막는다' },
  { id: 'swap',   name: '순간이동',   icon: '🔄', group: '수비', rarity: 'legend',   desc: '내 말과 상대 말의 자리를 바꾼다' }
];
const SIMPLE_IDS = ['boost', 'shield', 'reroll', 'jump', 'heal', 'freeze', 'double', 'back'];
const augById = id => AUG.find(a => a.id === id);

/* ---------- 기본 문제 ---------- */
const STARTER = [
  { unit: 'Lesson 9', question: 'How can I get to the museum?', options: ['Take Bus Number 7.', 'It is delicious.', 'I am eleven.', 'She is tall.'], answer: 1, level: 'easy', explanation: '교통수단을 묻는 말에는 Take ~ 로 답합니다.' },
  { unit: 'Lesson 9', question: 'Get off ___ the station.', options: ['in', 'at', 'on', 'under'], answer: 2, level: 'easy', explanation: 'get off at + 장소' },
  { unit: 'Lesson 9', question: 'The bank is ___ the school. (학교 뒤에)', options: ['behind', 'between', 'next to', 'in front of'], answer: 1, level: 'easy', explanation: 'behind = ~ 뒤에' },
  { unit: 'Lesson 9', question: '"Go straight"의 뜻은?', options: ['왼쪽으로 돌다', '직진하다', '내리다', '오른쪽으로 돌다'], answer: 2, level: 'easy', explanation: 'go straight = 곧장 가다' },
  { unit: 'Lesson 9', question: 'The shop is ___ the bank and the park.', options: ['behind', 'under', 'between', 'next'], answer: 3, level: 'medium', explanation: 'between A and B = A와 B 사이에' },
  { unit: 'Lesson 9', question: 'Which is correct?', options: ['Take Subway Line 4 and get off at the zoo.', 'Take Subway Line 4 and get off in zoo.', 'Taking Subway Line 4 get off the zoo.', 'Take Subway Line 4 and get at off the zoo.'], answer: 1, level: 'medium', explanation: 'Take + 교통수단 + and get off at + 장소' },
  { unit: 'Lesson 9', question: '상대의 말을 못 들었을 때 다시 물어보는 말은?', options: ['Thank you.', 'Sorry?', 'You are welcome.', 'Good bye.'], answer: 2, level: 'easy', explanation: 'Sorry? 는 다시 말해 달라는 뜻입니다.' },
  { unit: 'Lesson 9', question: 'The toy store is ___ the bus stop. (바로 앞에)', options: ['behind', 'in front of', 'between', 'under'], answer: 2, level: 'medium', explanation: 'in front of = ~ 앞에' }
];
let bank = STARTER.slice();

/* ---------- 방 보관 ---------- */
const rooms = new Map();
const timers = new Map();          // code → setTimeout 핸들 (저장 대상 아님)

function newCode() { let c; do { c = crypto.randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(c)); return c; }
function log(r, t) { r.log.push({ t, at: Date.now() }); if (r.log.length > 120) r.log.shift(); }
function cur(r) { return r.players[r.turn]; }
function fail(ack, msg) { ack?.({ ok: false, error: msg }); return false; }
function done(ack, obj = {}) { ack?.({ ok: true, ...obj }); return true; }
function byId(r, id) { return r.players.find(p => p.id === id); }

/* ---------- 상태 내려보내기 ----------
   정답 번호와 해설은 채점이 끝나기 전에는 절대 내려보내지 않는다. */
function view(r, forTeacher) {
  const p = r.pending;
  let pending = null;
  if (p) {
    pending = { kind: p.kind, deadline: p.deadline };
    if (p.kind === 'battle' || p.kind === 'capture') {
      pending.question = { unit: p.q.unit, question: p.q.question, options: p.q.options, level: p.q.level };
      pending.answered = Object.keys(p.answers);
      pending.thrower = p.thrower || null;
      pending.attacker = p.attacker || null;
      pending.defender = p.defender || null;
      if (p.revealed) { pending.answer = p.q.answer; pending.explanation = p.q.explanation; pending.result = p.result; }
    }
    if (p.kind === 'choose') { pending.player = p.player; pending.choices = p.choices; }
  }
  return {
    code: r.code, mode: r.mode, status: r.status, paused: r.paused,
    turn: r.turn, roll: r.roll, extra: r.extra, winner: r.winner, host: r.host,
    traps: r.traps, quizEvery: r.quizEvery, turnDeadline: r.turnDeadline,
    anim: r.anim || null,
    players: r.players.map(x => ({
      id: x.id, name: x.name, color: x.color, animal: x.animal, connected: !!x.sid,
      pieces: x.pieces, abilities: x.abilities, correct: x.correct, total: x.total,
      speed: x.speed, progress: progressOf(x), doubleNext: !!x.double, fate: !!x.fate
    })),
    pending, log: r.log.slice(-20), teacher: !!forTeacher,
    board: { coord: COORD, corners: CORNERS, ring: RING, scA: SC_A, scB: SC_B, center: CENTER }
  };
}
function push(r) {
  io.to(r.code).emit('state', view(r));
  io.to('teachers').emit('rooms', summaries());
  dirty = true;
}
function summaries() {
  return [...rooms.values()].map(r => ({
    code: r.code, mode: r.mode, status: r.status, paused: r.paused,
    turnName: cur(r)?.name || '-', winner: r.winner,
    minutes: Math.round((Date.now() - r.createdAt) / 60000),
    players: r.players.map(p => ({
      name: p.name, animal: p.animal, correct: p.correct, total: p.total,
      connected: !!p.sid, abilities: p.abilities.length, progress: progressOf(p)
    })),
    log: r.log.slice(-3).map(x => x.t)
  }));
}

/* ---------- 타이머 ---------- */
function clearTimer(r) { const h = timers.get(r.code); if (h) { clearTimeout(h); timers.delete(r.code); } }
function setTimer(r, ms, fn) {
  clearTimer(r);
  timers.set(r.code, setTimeout(() => { timers.delete(r.code); try { fn(); } catch (e) { console.error(e); } }, ms));
}

/* ============================================================
   턴 진행
   ============================================================ */
function startTurn(r) {
  const p = cur(r);
  if (!p) return;
  p.pieces.forEach(x => { x.frozen = false; });
  r.roll = null; r.anim = null;
  r.turnDeadline = Date.now() + T.turn;
  log(r, `${p.animal} ${p.name} 차례`);
  // 몇 턴마다 영어 배틀을 연다
  p.turns = (p.turns || 0) + 1;
  if (p.turns % r.quizEvery === 1 || r.quizEvery === 1) openBattle(r);
  else { push(r); armTurnTimer(r); }
}

function armTurnTimer(r) {
  setTimer(r, T.turn, () => {
    if (r.status !== 'playing' || r.paused || r.pending) return;
    log(r, `⏱️ ${cur(r)?.name} 시간 초과 — 차례를 넘깁니다`);
    r.roll = null; r.extra = 0;
    advance(r);
  });
}

function advance(r) {
  if (r.status !== 'playing') { push(r); return; }
  if (r.extra > 0) {
    r.extra--;
    r.roll = null; r.anim = null;
    r.turnDeadline = Date.now() + T.turn;
    log(r, `${cur(r).name} 한 번 더!`);
    push(r); armTurnTimer(r);
  } else {
    r.turn = (r.turn + 1) % r.players.length;
    startTurn(r);
  }
}

/* ============================================================
   영어 배틀 — 방의 모든 학생이 동시에 답한다
   ============================================================ */
function pickQuestion(r) {
  const pool = r.bank && r.bank.length ? r.bank : bank;
  return pool[rand(pool.length)];
}

function openBattle(r) {
  const q = pickQuestion(r);
  r.pending = { kind: 'battle', q, answers: {}, thrower: cur(r).id, deadline: Date.now() + T.battle, revealed: false };
  log(r, `📣 영어 배틀! 모두 답하세요`);
  push(r);
  setTimer(r, T.battle + 400, () => resolveBattle(r));
}

function resolveBattle(r) {
  const p = r.pending;
  if (!p || p.kind !== 'battle' || p.revealed) return;
  p.revealed = true;

  // 맞힌 사람을 빠른 순서대로
  const right = Object.entries(p.answers)
    .filter(([, a]) => a.correct)
    .sort((a, b) => a[1].at - b[1].at)
    .map(([pid]) => pid);

  const names = right.map(pid => byId(r, pid)?.name).filter(Boolean);
  p.result = {
    right, fastest: right[0] || null,
    text: names.length ? `정답: ${names.join(', ')}` : '정답자가 없어요'
  };

  // 속도 점수 (1등 3점, 2등 2점, 나머지 정답 1점)
  right.forEach((pid, i) => { const pl = byId(r, pid); if (pl) pl.speed += i === 0 ? 3 : i === 1 ? 2 : 1; });

  const thrower = byId(r, p.thrower);
  const throwerRight = right.includes(p.thrower);
  if (throwerRight) log(r, `✨ ${thrower.name} 정답! 증강을 고릅니다`);
  else log(r, `${thrower.name} 오답 — 증강 없이 윷만 던집니다`);
  if (right[0] && right[0] !== p.thrower) log(r, `⚡ ${byId(r, right[0]).name} 가장 빠른 정답! 보너스 증강`);

  push(r);

  // 해설을 2.5초 보여 준 뒤 다음 단계로
  setTimer(r, 2500, () => {
    const queue = [];
    if (throwerRight) queue.push({ pid: p.thrower, bonus: false });
    if (right[0] && right[0] !== p.thrower) queue.push({ pid: right[0], bonus: true });
    r.chooseQueue = queue;
    r.pending = null;
    nextChoose(r);
  });
}

/* 정답자가 증강을 고른다 (던진 사람 → 가장 빠른 사람 순서) */
function nextChoose(r) {
  const q = r.chooseQueue || [];
  if (!q.length) { r.pending = null; r.turnDeadline = Date.now() + T.turn; push(r); armTurnTimer(r); return; }
  const item = q.shift();
  const pl = byId(r, item.pid);
  if (!pl) return nextChoose(r);
  r.pending = { kind: 'choose', player: pl.id, choices: offerAugments(r, pl, item.bonus), deadline: Date.now() + T.choose };
  push(r);
  setTimer(r, T.choose + 300, () => {
    if (r.pending?.kind === 'choose' && r.pending.player === pl.id) {
      const pick = r.pending.choices[0];
      pl.abilities.push(pick.id);
      log(r, `${pl.name} 시간 초과 — ${pick.icon}${pick.name} 자동 선택`);
      nextChoose(r);
    }
  });
}

/* 역전 보정: 뒤처진 학생일수록 좋은 증강이 나올 확률이 올라간다 */
function offerAugments(r, player, bonusOnly) {
  const pool = AUG.filter(a => r.mode === 'full' || SIMPLE_IDS.includes(a.id));
  const progs = r.players.map(progressOf);
  const best = Math.max(...progs, 1), mine = progressOf(player);
  const behind = Math.max(0, (best - mine) / best);          // 0(선두) ~ 1(많이 뒤처짐)
  const w = { common: 60, rare: 30, legend: 10 };
  if (!bonusOnly) { w.rare += Math.round(behind * 25); w.legend += Math.round(behind * 20); w.common -= Math.round(behind * 45); }
  else { w.common += 25; w.legend = Math.max(2, w.legend - 6); }   // 보너스는 조금 약하게

  const picked = [];
  const bag = pool.slice();
  for (let i = 0; i < 3 && bag.length; i++) {
    const weights = bag.map(a => Math.max(1, w[a.rarity]));
    const total = weights.reduce((x, y) => x + y, 0);
    let t = rand(total), idx = 0;
    while (t >= weights[idx]) { t -= weights[idx]; idx++; }
    picked.push(bag[idx]); bag.splice(idx, 1);
  }
  return picked;
}

/* ============================================================
   잡기 승부 — 공격한 사람과 잡힌 사람만 1대1
   ============================================================ */
function openCapture(r, attacker, defender, ctx) {
  const q = pickQuestion(r);
  r.pending = {
    kind: 'capture', q, answers: {}, attacker: attacker.id, defender: defender.id,
    ctx, deadline: Date.now() + T.capture, revealed: false
  };
  log(r, `⚔️ ${attacker.name} vs ${defender.name} 잡기 승부!`);
  push(r);
  setTimer(r, T.capture + 400, () => resolveCapture(r));
}

function resolveCapture(r) {
  const p = r.pending;
  if (!p || p.kind !== 'capture' || p.revealed) return;
  p.revealed = true;
  const atk = byId(r, p.attacker), def = byId(r, p.defender);
  const a = p.answers[p.attacker], d = p.answers[p.defender];
  const aOK = !!a?.correct, dOK = !!d?.correct;

  let attackerWins;
  if (aOK && dOK) attackerWins = a.at <= d.at;        // 둘 다 맞히면 빠른 쪽
  else if (aOK) attackerWins = true;
  else if (dOK) attackerWins = false;
  else attackerWins = true;                          // 둘 다 틀리면 공격 성공 (원래 규칙대로)

  if (aOK) atk.speed += 2;
  if (dOK) def.speed += 2;

  const { pieceIdx, from, fromRoute, targets } = p.ctx;

  if (attackerWins) {
    let caught = 0;
    for (const t of targets) {
      const owner = byId(r, t.owner); if (!owner) continue;
      for (const i of t.pieces) {
        const ep = owner.pieces[i];
        if (ep.shield > 0) { ep.shield--; log(r, `🛡️ ${owner.name}의 방어막이 막았습니다`); continue; }
        ep.pos = -1; ep.route = 'outer'; caught++;
      }
    }
    p.result = { attackerWins: true, text: caught ? `${atk.name} 승리! ${def.name}의 말 ${caught}개를 잡았습니다` : `${atk.name} 승리! 하지만 방어막에 막혔습니다` };
    if (caught) { r.extra++; log(r, `🎯 ${atk.name}이(가) 말을 잡고 한 번 더!`); }
  } else {
    // 수비 성공 — 공격한 말이 원래 자리로 되돌아간다
    for (const i of groupAt(atk, atk.pieces[pieceIdx].pos).map(x => x.i)) {
      atk.pieces[i].pos = from; atk.pieces[i].route = fromRoute;
    }
    p.result = { attackerWins: false, text: `${def.name} 방어 성공! ${atk.name}의 말이 되돌아갑니다` };
    log(r, `🛡️ ${def.name} 방어 성공!`);
  }
  push(r);

  setTimer(r, 2800, () => {
    r.pending = null;
    checkWin(r, atk);
    if (r.status === 'playing') advance(r); else push(r);
  });
}

/* ============================================================
   말 이동
   ============================================================ */
function applyMove(r, player, pieceIdx, steps) {
  const piece = player.pieces[pieceIdx];
  if (!piece) return '말을 찾을 수 없습니다.';
  if (piece.pos === FINISH) return '이미 도착한 말입니다.';
  if (piece.frozen) return '얼음 감옥에 묶인 말입니다.';
  if (steps <= 0) return '이동할 수 없습니다.';

  // 업힌 말 — 같은 칸의 내 말들이 함께 움직인다
  const group = groupAt(player, piece.pos).map(x => x.i);
  const movers = group.length ? group : [pieceIdx];
  const from = piece.pos, fromRoute = piece.route;

  const dest = travel(piece.pos, piece.route, steps);
  const trail = pathOf(piece.pos, piece.route, steps);
  movers.forEach(i => { player.pieces[i].pos = dest.pos; player.pieces[i].route = dest.route; });

  r.anim = { player: player.id, pieces: movers, trail, seq: (r.anim?.seq || 0) + 1 };

  if (movers.length > 1) log(r, `${player.name}의 말 ${movers.length}개가 업혀서 함께 이동!`);

  if (dest.pos === FINISH) {
    log(r, `🏁 ${player.name}의 말 ${movers.length}개 완주!`);
    return { finished: true };
  }

  // 함정
  const trap = r.traps.find(t => t.pos === dest.pos && t.owner !== player.id);
  if (trap) {
    movers.forEach(i => { player.pieces[i].pos = -1; player.pieces[i].route = 'outer'; });
    r.traps = r.traps.filter(t => t !== trap);
    log(r, `🕸️ ${player.name}이(가) 함정에 걸려 처음으로!`);
    return { trapped: true };
  }

  // 잡기 대상 찾기
  const targets = [];
  for (const other of r.players) {
    if (other.id === player.id) continue;
    const hit = other.pieces.map((p, i) => ({ p, i })).filter(x => x.p.pos === dest.pos && x.p.pos >= 0 && x.p.pos !== FINISH);
    if (hit.length) targets.push({ owner: other.id, pieces: hit.map(x => x.i) });
  }
  if (targets.length) return { capture: { targets, pieceIdx: movers[0], from, fromRoute } };
  return {};
}

function checkWin(r, player) {
  if (player.pieces.every(p => p.pos === FINISH)) {
    r.status = 'finished'; r.winner = player.name; clearTimer(r);
    log(r, `🏆 ${player.animal} ${player.name} 우승!`);
    return true;
  }
  return false;
}

/* ============================================================
   소켓
   ============================================================ */
const COLORS = ['#ef6b86', '#4a9bea', '#49b88a', '#f0b03c', '#9b7ae0'];
const ANIMALS = ['🐰', '🐻', '🐱', '🦊', '🐼'];

function addPlayer(r, sock, name, id) {
  const p = {
    id, name: name || '학생', sid: sock?.id || null,
    color: COLORS[r.players.length % COLORS.length],
    animal: ANIMALS[r.players.length % ANIMALS.length],
    pieces: Array.from({ length: r.pieceCount }, () => ({ pos: -1, route: 'outer', shield: 0, frozen: false })),
    abilities: [], correct: 0, total: 0, speed: 0, turns: 0, double: false, fate: false
  };
  r.players.push(p);
  if (sock) { sock.data.room = r.code; sock.data.id = id; sock.join(r.code); }
  log(r, `${p.animal} ${p.name} 입장`);
  return p;
}

io.on('connection', s => {

  s.on('create', ({ name, mode, pieceCount }, ack) => {
    name = String(name || '').trim().slice(0, 12);
    if (!name) return fail(ack, '이름을 입력하세요.');
    const code = newCode(), id = crypto.randomUUID();
    const full = mode === 'full';
    const r = {
      code, mode: full ? 'full' : 'simple', status: 'waiting', paused: false,
      players: [], turn: 0, roll: null, extra: 0, pending: null, log: [], winner: null,
      host: id, traps: [], createdAt: Date.now(),
      pieceCount: Math.min(4, Math.max(2, Number(pieceCount) || (full ? 4 : 3))),
      quizEvery: full ? 1 : 2, bank: null, chooseQueue: []
    };
    rooms.set(code, r);
    addPlayer(r, s, name, id);
    done(ack, { code, id });
    push(r);
  });

  s.on('join', ({ code, name }, ack) => {
    const r = rooms.get(String(code || '').toUpperCase().trim());
    if (!r) return fail(ack, '방을 찾을 수 없습니다. 코드를 확인하세요.');
    if (r.status !== 'waiting') return fail(ack, '이미 시작된 방입니다.');
    if (r.players.length >= 5) return fail(ack, '정원(5명)이 찼습니다.');
    name = String(name || '').trim().slice(0, 12);
    if (!name) return fail(ack, '이름을 입력하세요.');
    const id = crypto.randomUUID();
    addPlayer(r, s, name, id);
    done(ack, { code: r.code, id });
    push(r);
  });

  s.on('rejoin', ({ code, id }, ack) => {
    const r = rooms.get(code); const p = r?.players.find(x => x.id === id);
    if (!p) return fail(ack, '재접속 정보를 찾을 수 없습니다.');
    p.sid = s.id; s.data.room = code; s.data.id = id; s.join(code);
    log(r, `${p.name} 재접속`);
    done(ack, { code, id }); push(r);
  });

  s.on('start', (_, ack) => {
    const r = rooms.get(s.data.room);
    if (!r || r.host !== s.data.id) return fail(ack, '방장만 시작할 수 있습니다.');
    if (r.players.length < 2) return fail(ack, '2명 이상 모여야 시작할 수 있습니다.');
    r.status = 'playing'; r.turn = 0;
    log(r, '게임 시작!');
    done(ack); startTurn(r);
  });

  /* 윷 던지기 */
  s.on('throw', (_, ack) => {
    const r = rooms.get(s.data.room);
    if (!r || r.status !== 'playing' || r.paused) return fail(ack, '게임이 진행 중이 아닙니다.');
    if (cur(r)?.sid !== s.id) return fail(ack, '내 차례가 아닙니다.');
    if (r.pending) return fail(ack, '먼저 진행 중인 것을 끝내세요.');
    if (r.roll) return fail(ack, '먼저 말을 움직이세요.');
    const p = cur(r);
    let res = throwSticks();
    if (p.fate && p.fateValue) {           // 운명의 윷 — 미리 고른 값
      res = { ...res, ...{ v: p.fateValue } };
      const y = [null, '도', '개', '걸', '윷', '모'];
      res.name = y[p.fateValue];
      p.fate = false; p.fateValue = null;
      log(r, `🔮 ${p.name} 운명의 윷 발동!`);
    }
    r.roll = res;
    if (res.v >= 4) { r.extra++; }
    log(r, `${p.name}: ${res.emoji} ${res.name} (${res.en}) ${res.v}칸`);
    r.turnDeadline = Date.now() + T.turn;
    push(r); armTurnTimer(r); done(ack, { roll: res });
  });

  /* 배틀/잡기 답 제출 */
  s.on('answer', ({ index }, ack) => {
    const r = rooms.get(s.data.room); if (!r) return fail(ack, '방이 없습니다.');
    const p = r.pending;
    if (!p || (p.kind !== 'battle' && p.kind !== 'capture') || p.revealed) return fail(ack, '지금은 답할 수 없습니다.');
    const me = r.players.find(x => x.sid === s.id);
    if (!me) return fail(ack, '참가자가 아닙니다.');
    if (p.kind === 'capture' && me.id !== p.attacker && me.id !== p.defender) return fail(ack, '이번 승부의 당사자가 아닙니다.');
    if (p.answers[me.id]) return fail(ack, '이미 답을 냈습니다.');
    const idx = Number(index);
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) return fail(ack, '보기를 고르세요.');
    const correct = idx === p.q.answer - 1;
    p.answers[me.id] = { idx, at: Date.now(), correct };
    me.total++; if (correct) me.correct++;
    push(r);
    done(ack, { submitted: true });
    // 모두 답했으면 기다리지 않고 바로 채점
    const need = p.kind === 'battle' ? r.players.filter(x => x.sid).length : 2;
    if (Object.keys(p.answers).length >= need) {
      if (p.kind === 'battle') resolveBattle(r); else resolveCapture(r);
    }
  });

  /* 증강 선택 */
  s.on('choose', ({ id }, ack) => {
    const r = rooms.get(s.data.room); if (!r) return fail(ack, '방이 없습니다.');
    const p = r.pending;
    const me = r.players.find(x => x.sid === s.id);
    if (!p || p.kind !== 'choose' || !me || p.player !== me.id) return fail(ack, '지금은 고를 수 없습니다.');
    const a = p.choices.find(c => c.id === id);
    if (!a) return fail(ack, '선택할 수 없는 증강입니다.');
    me.abilities.push(a.id);
    log(r, `${me.name}이(가) ${a.icon}${a.name} 획득!`);
    done(ack);
    nextChoose(r);
  });

  /* 말 이동 */
  s.on('move', ({ piece }, ack) => {
    const r = rooms.get(s.data.room);
    if (!r || r.status !== 'playing' || r.paused) return fail(ack, '게임이 진행 중이 아닙니다.');
    if (cur(r)?.sid !== s.id) return fail(ack, '내 차례가 아닙니다.');
    if (r.pending) return fail(ack, '먼저 진행 중인 것을 끝내세요.');
    if (!r.roll) return fail(ack, '먼저 윷을 던지세요.');
    const idx = Number(piece);
    if (!Number.isInteger(idx) || idx < 0 || idx >= r.pieceCount) return fail(ack, '말 번호가 잘못되었습니다.');
    const p = cur(r);
    const steps = r.roll.v * (p.double ? 2 : 1);
    if (p.double) { p.double = false; log(r, `✨ ${p.name} 두 배 이동!`); }
    const out = applyMove(r, p, idx, steps);
    if (typeof out === 'string') return fail(ack, out);
    r.roll = null;
    done(ack);
    if (out.capture) {
      const def = byId(r, out.capture.targets[0].owner);
      clearTimer(r);
      openCapture(r, p, def, out.capture);
      return;
    }
    if (checkWin(r, p)) { push(r); return; }
    advance(r);
  });

  /* 증강 사용 */
  s.on('ability', ({ id, piece, target, enemyPiece, value }, ack) => {
    const r = rooms.get(s.data.room);
    if (!r || r.status !== 'playing' || r.paused) return fail(ack, '게임이 진행 중이 아닙니다.');
    if (cur(r)?.sid !== s.id) return fail(ack, '내 차례에만 쓸 수 있습니다.');
    if (r.pending) return fail(ack, '먼저 진행 중인 것을 끝내세요.');
    const me = cur(r);
    const at = me.abilities.indexOf(id);
    if (at < 0) return fail(ack, '가지고 있지 않은 증강입니다.');
    const a = augById(id);
    const myIdx = Number(piece) || 0;
    const my = me.pieces[myIdx];
    const enemy = r.players.find(x => x.id === target && x.id !== me.id);
    const ep = enemy?.pieces[Number(enemyPiece) || 0];
    let err = null, captured = null;

    switch (id) {
      case 'boost': case 'jump': case 'heal': {
        if (id === 'heal') { if (!my || my.pos !== -1) { err = '아직 나오지 않은 내 말을 고르세요.'; break; } }
        else if (!my || my.pos === FINISH) { err = '판 위의 내 말을 고르세요.'; break; }
        if (r.roll) { err = '윷을 던지기 전이나 말을 옮긴 뒤에 쓰세요.'; break; }
        const n = id === 'boost' ? 2 : id === 'jump' ? 4 : 3;
        const out = applyMove(r, me, myIdx, n);
        if (typeof out === 'string') { err = out; break; }
        if (out.capture) captured = out.capture;
        break;
      }
      case 'shield': if (!my) err = '말을 고르세요.'; else my.shield++; break;
      case 'guard':  me.pieces.forEach(x => x.shield++); break;
      case 'reroll': r.extra++; break;
      case 'double': me.double = true; break;
      case 'fate': {
        const v = Number(value);
        if (![1, 2, 3, 4, 5].includes(v)) { err = '도·개·걸·윷·모 중에서 고르세요.'; break; }
        me.fate = true; me.fateValue = v; break;
      }
      case 'freeze': if (!ep || ep.pos < 0 || ep.pos === FINISH) err = '판 위의 상대 말을 고르세요.'; else ep.frozen = true; break;
      case 'back': {
        if (!ep || ep.pos < 0 || ep.pos === FINISH) { err = '판 위의 상대 말을 고르세요.'; break; }
        let at2 = ep.pos;
        for (let k = 0; k < 3; k++) at2 = at2 > 0 ? at2 - 1 : 0;
        ep.pos = at2 < RING ? at2 : 0; ep.route = 'outer'; break;
      }
      case 'trap': if (!my || my.pos < 0 || my.pos === FINISH) err = '판 위의 내 말을 고르세요.'; else r.traps.push({ pos: my.pos, owner: me.id }); break;
      case 'steal': {
        if (!enemy || !enemy.abilities.length) { err = '증강을 가진 상대를 고르세요.'; break; }
        me.abilities.push(enemy.abilities.pop()); break;
      }
      case 'swap': {
        if (!ep || !my || ep.pos < 0 || my.pos < 0 || ep.pos === FINISH || my.pos === FINISH) { err = '판 위의 두 말을 고르세요.'; break; }
        [my.pos, ep.pos] = [ep.pos, my.pos];
        [my.route, ep.route] = [ep.route, my.route];
        break;
      }
      default: err = '알 수 없는 증강입니다.';
    }
    if (err) return fail(ack, err);
    me.abilities.splice(at, 1);
    log(r, `${a.icon} ${me.name} — ${a.name} 사용!`);
    done(ack);
    if (captured) { clearTimer(r); openCapture(r, me, byId(r, captured.targets[0].owner), captured); return; }
    if (checkWin(r, me)) { push(r); return; }
    push(r);
  });

  /* 교사 */
  s.on('teacher:login', ({ pin }, ack) => {
    if (String(pin) !== PIN) return fail(ack, '교사 PIN이 다릅니다.');
    s.data.teacher = true; s.join('teachers');
    done(ack, { rooms: summaries(), augments: AUG, bankCount: bank.length });
  });
  s.on('teacher:watch', ({ code }, ack) => {
    if (!s.data.teacher) return fail(ack, '권한이 없습니다.');
    const r = rooms.get(code); if (!r) return fail(ack, '방이 없습니다.');
    s.join(code); s.emit('state', view(r, true)); done(ack);
  });
  s.on('teacher:pause', ({ code }, ack) => {
    if (!s.data.teacher) return fail(ack, '권한이 없습니다.');
    const r = rooms.get(code); if (!r) return fail(ack, '방이 없습니다.');
    r.paused = !r.paused;
    if (r.paused) clearTimer(r); else { r.turnDeadline = Date.now() + T.turn; armTurnTimer(r); }
    log(r, r.paused ? '⏸️ 교사가 일시정지했습니다' : '▶️ 교사가 재개했습니다');
    push(r); done(ack);
  });
  s.on('teacher:close', ({ code }, ack) => {
    if (!s.data.teacher) return fail(ack, '권한이 없습니다.');
    const r = rooms.get(code); if (!r) return fail(ack, '방이 없습니다.');
    clearTimer(r); rooms.delete(code);
    io.to(code).emit('closed');
    io.to('teachers').emit('rooms', summaries());
    dirty = true; done(ack);
  });

  s.on('disconnect', () => {
    const r = rooms.get(s.data.room);
    if (!r) return;
    const p = r.players.find(x => x.id === s.data.id);
    if (p && p.sid === s.id) { p.sid = null; log(r, `${p.name} 연결 끊김`); push(r); }
  });
});

/* ============================================================
   엑셀 문제은행
   한글 열 이름과 영어 열 이름을 모두 받아들인다.
   ============================================================ */
function cell(row, ...keys) {
  for (const k of keys) {
    for (const actual of Object.keys(row)) {
      if (actual.replace(/\s/g, '').toLowerCase() === k.replace(/\s/g, '').toLowerCase()) {
        const v = row[actual];
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
      }
    }
  }
  return '';
}
export function parseBank(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  const out = [], skipped = [];
  rows.forEach((row, i) => {
    const q = {
      unit: cell(row, '단원명', 'unit', '단원'),
      question: cell(row, '영어 문제', 'question', '문제'),
      options: [
        cell(row, '선택지 1', 'option1', '보기1', '선택지1'),
        cell(row, '선택지 2', 'option2', '보기2', '선택지2'),
        cell(row, '선택지 3', 'option3', '보기3', '선택지3'),
        cell(row, '선택지 4', 'option4', '보기4', '선택지4')
      ],
      answer: Number(cell(row, '정답 번호', 'answer', '정답')),
      level: (cell(row, '난이도', 'level') || 'easy').toLowerCase(),
      explanation: cell(row, '해설', 'explanation')
    };
    if (!q.question) { skipped.push(`${i + 2}행: 문제가 비었습니다`); return; }
    if (q.options.some(o => !o)) { skipped.push(`${i + 2}행: 선택지 4개를 모두 채워 주세요`); return; }
    if (!(q.answer >= 1 && q.answer <= 4)) { skipped.push(`${i + 2}행: 정답 번호는 1~4여야 합니다`); return; }
    out.push(q);
  });
  return { questions: out, skipped };
}

app.post('/api/questions',
  express.raw({ type: () => true, limit: '3mb' }),
  (req, res) => {
    if (req.header('x-teacher-pin') !== PIN) return res.status(403).json({ error: '교사 인증 실패' });
    try {
      const { questions, skipped } = parseBank(req.body);
      if (!questions.length) {
        return res.status(400).json({
          error: '읽을 수 있는 문제가 없습니다.',
          hint: '첫 행(열 제목)이 unit / question / option1~4 / answer 또는 단원명 / 영어 문제 / 선택지 1~4 / 정답 번호 인지 확인하세요.',
          skipped: skipped.slice(0, 10)
        });
      }
      const code = String(req.query.room || '').toUpperCase();
      if (code && rooms.get(code)) {
        rooms.get(code).bank = questions;
        log(rooms.get(code), `📚 문제은행 교체 (${questions.length}문제)`);
        push(rooms.get(code));
      } else {
        bank = questions;
      }
      res.json({
        ok: true, count: questions.length, scope: code || 'all',
        units: [...new Set(questions.map(q => q.unit).filter(Boolean))],
        levels: [...new Set(questions.map(q => q.level))],
        skipped: skipped.slice(0, 10)
      });
    } catch (e) { res.status(400).json({ error: '엑셀을 읽지 못했습니다: ' + e.message }); }
  });

app.get('/healthz', (_, res) => res.json({
  ok: true, rooms: rooms.size,
  players: [...rooms.values()].reduce((n, r) => n + r.players.filter(p => p.sid).length, 0),
  uptimeMin: Math.round(process.uptime() / 60), bank: bank.length, save: saveOff ? 'off' : 'on'
}));

app.get('/api/info', (_, res) => res.json({ augments: AUG, board: { coord: COORD, corners: CORNERS, ring: RING, scA: SC_A, scB: SC_B, center: CENTER }, bankCount: bank.length }));

/* ============================================================
   저장 — 서버가 꺼졌다 켜져도 진행 중이던 방이 살아남는다
   ============================================================ */
let dirty = false;
function save() {
  if (!dirty || saveOff) return;
  dirty = false;
  try {
    fs.mkdirSync(SAVE_DIR, { recursive: true });
    const data = [...rooms.values()].map(r => ({ ...r, players: r.players.map(p => ({ ...p, sid: null })) }));
    fs.writeFileSync(SAVE_FILE, JSON.stringify({ savedAt: Date.now(), bank, rooms: data }));
  } catch (e) {
    saveOff = true;
    console.warn('저장을 끕니다 (디스크에 쓸 수 없는 환경):', e.message);
    console.warn('게임은 그대로 작동합니다. 다만 서버가 다시 시작되면 진행 중이던 방이 사라집니다.');
  }
}
function load() {
  try {
    if (!fs.existsSync(SAVE_FILE)) return;
    const d = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    if (Array.isArray(d.bank) && d.bank.length) bank = d.bank;
    for (const r of d.rooms || []) {
      r.players.forEach(p => { p.sid = null; });
      r.pending = null; r.roll = null; r.chooseQueue = [];
      rooms.set(r.code, r);
    }
    if (rooms.size) console.log(`이전 방 ${rooms.size}개를 복구했습니다.`);
  } catch (e) { console.error('복구 실패:', e.message); }
}
setInterval(save, 4000);
process.on('SIGINT', () => { dirty = true; save(); process.exit(0); });

load();
server.listen(PORT, '0.0.0.0', () => {
  const host = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  console.log(`\n  English Yut Battle 2차 버전`);
  console.log(`  주소: ${host}`);
  if (!process.env.TEACHER_PIN) {
    console.warn('  ⚠️  TEACHER_PIN이 설정되지 않아 기본값(2468)을 씁니다.');
    console.warn('      인터넷에 올릴 때는 반드시 환경변수로 바꾸세요.');
  } else {
    console.log('  교사 PIN: 환경변수로 설정됨');
  }
  console.log('');
});
