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
  throwSticks, travel, pathOf, remain, progressOf, groupAt, newPiece,
  COORD, CORNERS, RING, FINISH, CENTER, SC_A, SC_B, LINES, PIECE_KIND, YUT, rand, pick
} from './game.js';
import { AUGMENTS, byId as augById, poolFor, PHASE_LABEL } from './augments.js';
import * as FX from './effects.js';

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
const T = { battle: 20000, capture: 12000, turn: 45000, choose: 20000, reveal: 6000 };

/* ---------- 증강 ---------- */
const AUG = AUGMENTS;

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
const BASE_NAME = '기본 문제 — 영어 9단원 길찾기';

/* ---------- 방 보관 ---------- */
const rooms = new Map();
const classes = new Map();         // 문제 세트 코드 → { code, name, bank, createdAt, builtin }
let activeSet = 'BASE';            // 학생이 그냥 주소로 들어왔을 때 쓰는 세트
const timers = new Map();          // code → setTimeout 핸들 (저장 대상 아님)

function newCode() { let c; do { c = crypto.randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(c)); return c; }
function log(r, t) { r.log.push({ t, at: Date.now() }); if (r.log.length > 120) r.log.shift(); }
function cur(r) { return r.players[r.turn]; }
function fail(ack, msg) { ack?.({ ok: false, error: msg }); return false; }
function done(ack, obj = {}) { ack?.({ ok: true, ...obj }); return true; }
function byId(r, id) { return r.players.find(p => p.id === id); }

/* ---------- 상태 내려보내기 ----------
   정답 번호와 해설은 채점이 끝나기 전에는 절대 내려보내지 않는다. */
/* 윷을 던진 뒤, 각 말이 어디로 갈지 미리 계산한다 (실제 이동과 같은 규칙) */
function movePreview(r) {
  if (!r.roll || r.roll.choices || r.pending || r.status !== 'playing') return null;
  const p = cur(r);
  if (!p || p.eliminated || p.rank) return null;
  const steps = FX.stepsFor(r, p, r.roll.v);
  const opts = { reverse: !!p.flags?.reverse, stopAt: FX.mudCells(r) };
  const list = [];
  p.pieces.forEach((pc, i) => {
    const no = i + 1;
    if (pc.pos === FINISH) return list.push({ i, no, skip: '이미 도착' });
    if (pc.frozen > 0) return list.push({ i, no, skip: '묶여 있음' });
    if (pc.locked) return list.push({ i, no, skip: '고정됨' });
    if (pc.kind === 'pawn') return list.push({ i, no, skip: '폰은 저절로' });
    if (steps === 0) return list.push({ i, no, skip: '움직일 수 없음' });
    if (steps < 0 && pc.pos < 0) return list.push({ i, no, skip: '아직 집' });

    const dest = travel(pc.pos, pc.route, steps, opts);
    if (dest.pos === pc.pos) return list.push({ i, no, skip: '움직일 수 없음' });
    const group = p.flags?.noStack ? [] : groupAt(p, pc.pos).map(x => x.i);
    const movers = group.length || 1;

    let capture = 0;
    r.players.forEach(o => {
      if (o.id === p.id || o.eliminated) return;
      o.pieces.forEach(x => { if (x.pos === dest.pos && FX.onBoard(x)) capture++; });
    });
    const own = dest.pos !== FINISH && p.pieces.some((x, k) =>
      k !== i && !group.includes(k) && x.pos === dest.pos && FX.onBoard(x));
    const tile = (r.tiles || []).find(t => t.pos === dest.pos);

    list.push({
      i, no, to: dest.pos, finish: dest.pos === FINISH,
      capture, own, movers, tile: tile ? tile.type : null
    });
  });
  return { player: p.id, steps, list };
}

function augView(p, r) {
  return (p.augs || []).map(a => {
    const d = augById(a.id) || {};
    let prog = null;
    try { prog = r ? FX.progressOf(r, p, a.id, r.players) : null; } catch (e) { prog = null; }
    return { id: a.id, name: d.name, icon: d.icon, desc: d.desc, when: d.when, group: d.group,
             rarity: d.rarity, kind: d.kind, phase: d.phase, win: !!d.win,
             needs: FX.NEEDS[a.id] || 'none', uses: a.uses, spent: !!a.spent, prog };
  });
}

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
      pending.canContinue = !!p.canContinue;
    }
    if (p.kind === 'choose') {
      pending.offers = p.offers; pending.picked = Object.keys(p.picked);
      pending.round = r.round; pending.phaseLabel = PHASE_LABEL[p.phase] || '';
    }
  }
  return {
    code: r.code, mode: r.mode, status: r.status, paused: r.paused,
    classCode: r.classCode || null, className: r.className || null,
    turn: r.turn, round: r.round, roll: r.roll, winner: r.winner, winners: r.winners || [], host: r.host,
    tiles: r.tiles || [], fog: r.fog || 0, hidden: r.hidden || 0, rotation: r.rotation || 0,
    quizEvery: r.quizEvery, turnDeadline: r.turnDeadline,
    auto: !!r.auto, autoSize: r.autoSize || null,
    anim: r.anim || null,
    players: r.players.map(x => ({
      id: x.id, name: x.name, color: x.color, animal: x.animal, connected: !!x.sid,
      pieces: x.pieces, augs: augView(x, r), correct: x.correct, total: x.total,
      speed: x.speed, progress: progressOf(x), throws: x.throws || 0,
      eliminated: !!x.eliminated, health: x.health, rank: x.rank, winReason: x.winReason || null,
      coins: x.coins || {}, claps: x.stats?.claps ?? null, skip: x.skip || 0
    })),
    preview: movePreview(r),
    pending, log: r.log.slice(-20), teacher: !!forTeacher,
    board: { coord: COORD, corners: CORNERS, ring: RING, scA: SC_A, scB: SC_B, center: CENTER, lines: LINES }
  };
}
function push(r) {
  io.to(r.code).emit('state', view(r));
  io.to('teachers').emit('rooms', summaries());
  io.to('teachers').emit('sets', setList());
  dirty = true;
}
function summaries() {
  return [...rooms.values()].map(r => ({
    code: r.code, mode: r.mode, status: r.status, paused: r.paused,
    className: r.className || null, classCode: r.classCode || null,
    turnName: cur(r)?.name || '-', winner: r.winner,
    minutes: Math.round((Date.now() - r.createdAt) / 60000),
    players: r.players.map(p => ({
      name: p.name, animal: p.animal, correct: p.correct, total: p.total,
      connected: !!p.sid, abilities: (p.augs || []).length, progress: progressOf(p), eliminated: !!p.eliminated
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
/* 증강 효과가 판을 건드릴 때 쓰는 창구 */
function makeApi(r) {
  return {
    log: t => log(r, t),
    rand, pick,
    players: () => r.players,
    alive: () => r.players.filter(x => !x.eliminated),
    enemies: me => r.players.filter(x => x !== me && !x.eliminated),
    poolIds: () => poolFor(phaseOf(r), r.mode).map(a => a.id),
    occupied: (rr, pos) => rr.players.some(t => t.pieces.some(x => x.pos === pos && FX.onBoard(x))),
    sendHome: pc => { pc.pos = -1; pc.route = 'outer'; pc.kind = pc.kind === 'queen' ? 'normal' : pc.kind; },
    capture: (victim, idxs, by, why) => doCapture(r, victim, idxs, by, why),
    grant: (p, id) => grantAug(r, p, id),
    eliminate: (p, why) => eliminate(r, p, why),
    declareWin: (p, why, rank) => declareWin(r, p, why, rank)
  };
}

function phaseOf(r) {
  if (r.round <= 1) return 'start';
  if (r.round <= 6) return 'mid';
  return 'final';
}

/* 증강을 하나 쥐여 준다 (id 가 없으면 무작위) */
function grantAug(r, p, id) {
  const pool = poolFor(phaseOf(r), r.mode);
  const a = id ? augById(id) : pick(pool);
  if (!a) return;
  p.augs.push({ id: a.id, uses: a.use || 1, spent: false });
  if (a.kind === 'instant' || a.kind === 'passive') applyAug(r, p, a);
}

function applyAug(r, p, a) {
  const fn = FX.ON_ACQUIRE[a.id];
  const rec = p.augs.find(x => x.id === a.id && !x.spent);
  try { if (fn) fn(r, p, makeApi(r)); } catch (e) { console.error('증강 오류', a.id, e); }
  if (a.kind === 'instant' && rec) rec.spent = true;
}

/* 잡기 — 보호막·친구 방패·평화 협정을 모두 거친다 */
function doCapture(r, victim, idxs, by, why) {
  if (!victim || !idxs?.length) return 0;
  if (victim.flags?.peace || by?.flags?.peace) { log(r, `🤝 평화 협정으로 ${victim.name}의 말은 무사합니다.`); return 0; }
  let list = idxs.slice();
  if (victim.flags?.friendShield && list.length > 1) list = [list[0]];
  let n = 0;
  for (const i of list) {
    const pc = victim.pieces[i];
    if (!pc || !FX.onBoard(pc)) continue;
    if (pc.shield > 0) { pc.shield--; log(r, `🛡️ ${victim.name}의 보호막이 막았습니다.`); continue; }
    pc.pos = -1; pc.route = 'outer'; pc.locked = false; n++;
  }
  if (n && by) {
    log(r, `⚔️ ${by.name}이(가) ${victim.name}의 말 ${n}개를 잡았습니다${why ? ` (${why})` : ''}`);
    try { FX.onCapture(r, by, victim, n, makeApi(r)); } catch (e) { console.error(e); }
  }
  return n;
}

function eliminate(r, p, why) {
  if (p.eliminated) return;
  p.eliminated = true;
  p.pieces.forEach(x => { x.pos = -1; x.route = 'outer'; });
  log(r, `❌ ${p.name} 탈락 — ${why}`);
  const left = r.players.filter(x => !x.eliminated);
  if (left.length === 1) declareWin(r, left[0], '마지막 생존');
  else if (left.length === 0) finishGame(r);
}

function nextRank(r) {
  return Math.max(0, ...r.players.map(x => x.rank || 0)) + 1;
}

function declareWin(r, p, why, rank) {
  if (!p || p.rank) return;
  r.winners ||= [];
  /* 지정 순위(예: 동메달 3위)가 이미 찼으면 다음 빈 순위로 민다 */
  if (rank && r.players.some(x => x.rank === rank)) rank = null;
  p.rank = rank || nextRank(r);
  p.winReason = why;
  r.winners.push({ id: p.id, name: p.name, rank: p.rank, why });
  log(r, `🏆 ${p.animal} ${p.name} — ${why}! (${p.rank}위)`);

  /* 거머리·구조대로 운명을 함께하는 사람 */
  r.players.forEach(t => {
    if (t === p || t.rank) return;
    if (t.flags?.leechOn === p.id || t.flags?.rescued === p.id) {
      t.rank = p.rank; t.winReason = '함께 승리';
      r.winners.push({ id: t.id, name: t.name, rank: t.rank, why: '함께 승리' });
      log(r, `🤝 ${t.name}도 함께 승리합니다.`);
    }
  });

  const rest = r.players.filter(x => !x.rank && !x.eliminated);
  if (rest.length <= 1) finishGame(r);
  return true;
}

function finishGame(r) {
  r.status = 'finished';
  clearTimer(r);
  const rest = r.players.filter(x => !x.rank)
    .sort((a, b) => (a.eliminated === b.eliminated ? progressOf(b) - progressOf(a) : (a.eliminated ? 1 : -1)));
  let next = nextRank(r);
  rest.forEach(x => { x.rank = next++; x.winReason = x.winReason || (x.eliminated ? '탈락' : '-'); });
  /* 1위부터 빈 번호 없이 다시 매긴다. 함께 승리한 사람은 같은 순위를 유지한다. */
  const order = [...new Set(r.players.map(x => x.rank).filter(Boolean))].sort((x, y) => x - y);
  const remap = new Map(order.map((v, i) => [v, i + 1]));
  r.players.forEach(x => { if (x.rank) x.rank = remap.get(x.rank); });

  r.winner = r.players.find(x => x.rank === 1)?.name || null;
  log(r, '게임이 끝났습니다.');
}

/* ============================================================
   라운드 → 영어 문제 → 전원 증강 선택 → 각자 차례
   ============================================================ */
function startRound(r) {
  r.round = (r.round || 0) + 1;
  r.bannedAug = [];
  if (r.fog > 0) r.fog--;
  r.hidden = 0;
  log(r, `── ${r.round}라운드 ──`);
  openBattle(r);
}

function startTurn(r) {
  const p = cur(r);
  if (!p) return;
  if (p.eliminated || p.rank) return advance(r);
  if (p.skip > 0) { p.skip--; log(r, `⏭️ ${p.name}은(는) 이번 차례를 쉽니다.`); return advance(r); }

  r.roll = null; r.anim = null;
  p.throws = 1 + (r.echo ? 1 : 0);
  try { FX.onTurnStart(r, p, makeApi(r)); } catch (e) { console.error(e); }
  if (r.status !== 'playing') { push(r); return; }

  /* 폰은 던질 때마다 저절로 앞으로 */
  r.turnDeadline = Date.now() + T.turn;
  log(r, `${p.animal} ${p.name} 차례`);
  push(r); armTurnTimer(r);
}

function armTurnTimer(r) {
  setTimer(r, T.turn, () => {
    if (r.status !== 'playing' || r.paused || r.pending) return;
    const c = cur(r);
    if (process.env.YUT_DEBUG) console.log('[시간초과]', JSON.stringify({
      name: c?.name, throws: c?.throws, roll: r.roll?.name, rollV: r.roll?.v,
      elim: c?.eliminated, rank: c?.rank, skip: c?.skip, conn: !!c?.sid,
      pieces: c?.pieces.map(x => `${x.pos}/${x.kind}${x.frozen ? 'F' : ''}${x.locked ? 'L' : ''}`)
    }));
    log(r, `⏱️ ${cur(r)?.name} 시간 초과 — 차례를 넘깁니다`);
    r.roll = null; if (cur(r)) cur(r).throws = 0;
    advance(r);
  });
}

function advance(r) {
  if (r.status !== 'playing') { push(r); return; }
  const me = cur(r);
  if (me && me.throws > 0 && me.sid && !me.eliminated && !me.rank) {
    r.roll = null; r.anim = null;
    r.turnDeadline = Date.now() + T.turn;
    log(r, `${me.name} 한 번 더!`);
    push(r); armTurnTimer(r);
    return;
  }
  if (me) { try { FX.onTurnEnd(r, me, makeApi(r)); } catch (e) { console.error(e); } }
  if (r.status !== 'playing') { push(r); return; }

  const n = r.players.length;
  let step = 1, skipped = [];
  while (step <= n) {
    const cand = r.players[(r.turn + step) % n];
    if (cand.sid && !cand.eliminated && !cand.rank) break;
    if (cand.sid && !cand.eliminated) skipped.push(cand.name);
    else if (!cand.sid) skipped.push(cand.name);
    step++;
  }
  if (step > n) { finishGame(r); push(r); return; }
  const wrapped = (r.turn + step) >= n;
  r.turn = (r.turn + step) % n;
  if (skipped.length) log(r, `⏭️ ${skipped.join(', ')} 건너뜁니다`);
  if (wrapped) startRound(r); else startTurn(r);
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
  r.pending = { kind: 'battle', q, answers: {}, thrower: cur(r)?.id || null, deadline: Date.now() + T.battle, revealed: false };
  log(r, `📣 영어 배틀! 모두 답하세요 — 맞히면 증강을 한 장 더 받습니다`);
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

  log(r, names.length
    ? `✨ ${names.join(', ')} 정답! 증강을 한 장 더 고릅니다`
    : '정답자가 없어요 — 모두 한 장씩만 고릅니다');
  if (right[0]) log(r, `⚡ 가장 빠른 정답: ${byId(r, right[0])?.name}`);

  // '계속'을 누르면 바로, 아무도 안 누르면 잠시 뒤 자동으로 넘어간다
  p.canContinue = true;
  p.deadline = Date.now() + T.reveal;
  push(r);
  setTimer(r, T.reveal, () => continueBattle(r));
}

function continueBattle(r) {
  const p = r.pending;
  if (!p || p.kind !== 'battle' || !p.revealed) return;
  clearTimer(r);
  const right = p.result?.right || [];
  r.pending = null;
  openChoose(r, right);
}

/* 모두가 동시에 증강 3장 중 1장을 고른다. 정답자는 한 장 더 고른다. */
function openChoose(r, right = []) {
  const alive = r.players.filter(x => !x.eliminated && !x.rank && x.sid);
  if (!alive.length) { startTurn(r); return; }
  const offers = {}, extra = {};
  alive.forEach(p => {
    offers[p.id] = offerAugments(r, p);
    if (right.includes(p.id)) extra[p.id] = 1;
  });
  r.pending = {
    kind: 'choose', phase: phaseOf(r),
    offers, picked: {}, extra, deadline: Date.now() + T.choose
  };
  push(r);
  setTimer(r, T.choose + 400, () => finishChoose(r, true));
}

function takePick(r, p, augId) {
  const pend = r.pending;
  const list = pend.offers[p.id] || [];
  const a = list.find(x => x.id === augId) || list[0];
  if (!a) return;
  log(r, `${p.name} → ${a.icon} ${a.name}`);
  grantAug(r, p, a.id);

  /* 이의있음! — 바로 다시 뽑는다 */
  if (p.flags?.reroll) { p.flags.reroll = false; pend.offers[p.id] = offerAugments(r, p); return; }

  if (pend.extra[p.id] > 0) {                       // 정답자 보너스 한 장 더
    pend.extra[p.id]--;
    pend.offers[p.id] = offerAugments(r, p, true);
    return;
  }
  pend.picked[p.id] = a.id;
}

function finishChoose(r, timeout) {
  const pend = r.pending;
  if (!pend || pend.kind !== 'choose') return;
  if (timeout) {
    Object.keys(pend.offers).forEach(id => {
      if (pend.picked[id]) return;
      const p = byId(r, id); if (!p) return;
      const a = pend.offers[id][0];
      log(r, `${p.name} 시간 초과 — ${a.icon}${a.name} 자동 선택`);
      grantAug(r, p, a.id);
      pend.picked[id] = a.id;
    });
  }
  clearTimer(r);
  r.pending = null;
  r.players.forEach(p => { if (!p.rank && !p.eliminated) FX.checkSpecialWin(r, p, makeApi(r)); });
  if (r.status !== 'playing') { push(r); return; }
  startTurn(r);
}

/* 뒤처진 학생일수록 좋은 증강이 나온다 */
function offerAugments(r, player, bonusOnly) {
  let pool = poolFor(phaseOf(r), r.mode)
    .filter(a => !(r.bannedAug || []).includes(a.id))
    .filter(a => !(player.augs || []).some(x => x.id === a.id));
  if (!pool.length) pool = poolFor(phaseOf(r), r.mode);

  const progs = r.players.map(progressOf);
  const best = Math.max(...progs, 1), mine = progressOf(player);
  const behind = Math.max(0, (best - mine) / best);
  const w = { common: 60, rare: 30, legend: 10 };
  if (!bonusOnly) { w.rare += Math.round(behind * 25); w.legend += Math.round(behind * 20); w.common -= Math.round(behind * 45); }
  else { w.common += 25; w.legend = Math.max(2, w.legend - 6); }

  const picked = [];
  const bag = pool.slice();

  /* 배달 — 지정한 증강이 반드시 나온다 */
  const want = player.flags?.delivery;
  if (want) {
    const d = bag.findIndex(a => a.id === want);
    if (d >= 0) { picked.push(bag[d]); bag.splice(d, 1); }
    player.flags.delivery = null;
  }
  while (picked.length < 3 && bag.length) {
    const weights = bag.map(a => Math.max(1, w[a.rarity]));
    const total = weights.reduce((x, y) => x + y, 0);
    let t = rand(total), idx = 0;
    while (t >= weights[idx]) { t -= weights[idx]; idx++; }
    picked.push(bag[idx]); bag.splice(idx, 1);
  }
  /* 간택 — 고양이가 보이면 고양이만 고를 수 있다 */
  if (r.catRule && picked.some(a => a.id === 'cat')) return picked.filter(a => a.id === 'cat');
  return picked.map(a => ({ id: a.id, name: a.name, icon: a.icon, desc: a.desc, when: a.when,
                            rarity: a.rarity, group: a.group, kind: a.kind, win: !!a.win }));
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
      caught += doCapture(r, owner, t.pieces, atk, '잡기 승부');
    }
    p.result = { attackerWins: true, text: caught ? `${atk.name} 승리! ${def.name}의 말 ${caught}개를 잡았습니다` : `${atk.name} 승리! 하지만 보호막에 막혔습니다` };
    if (caught) { atk.throws++; log(r, `🎯 ${atk.name}이(가) 말을 잡고 한 번 더!`); }
  } else {
    // 수비 성공 — 공격한 말이 원래 자리로 되돌아간다
    for (const i of groupAt(atk, atk.pieces[pieceIdx].pos).map(x => x.i)) {
      atk.pieces[i].pos = from; atk.pieces[i].route = fromRoute;
    }
    p.result = { attackerWins: false, text: `${def.name} 방어 성공! ${atk.name}의 말이 되돌아갑니다` };
    log(r, `🛡️ ${def.name} 방어 성공!`);
  }
  p.canContinue = true;
  p.deadline = Date.now() + T.reveal;
  push(r);
  setTimer(r, T.reveal, () => continueCapture(r));
}

function continueCapture(r) {
  const p = r.pending;
  if (!p || p.kind !== 'capture' || !p.revealed) return;
  clearTimer(r);
  const atk = byId(r, p.attacker);
  r.pending = null;
  if (atk) checkWin(r, atk);
  if (r.status === 'playing') advance(r); else push(r);
}

/* ============================================================
   말 이동
   ============================================================ */
function applyMove(r, player, pieceIdx, steps) {
  const piece = player.pieces[pieceIdx];
  if (!piece) return '말을 찾을 수 없습니다.';
  if (piece.pos === FINISH) return '이미 도착한 말입니다.';
  if (piece.frozen > 0) return '묶여 있는 말입니다.';
  if (piece.locked) return '영역 안에 고정된 말입니다.';
  if (piece.kind === 'pawn') return '폰은 직접 움직일 수 없습니다.';
  if (steps === 0) return '이동할 수 없습니다.';
  if (steps < 0 && piece.pos < 0) return '아직 나오지 않은 말은 뒤로 갈 수 없습니다.';

  const opts = { reverse: !!player.flags?.reverse, stopAt: FX.mudCells(r) };

  // 업힌 말 — 같은 칸의 내 말들이 함께 움직인다 (나를 희생해 = 업기 없음)
  const group = player.flags?.noStack ? [] : groupAt(player, piece.pos).map(x => x.i);
  const movers = group.length ? group : [pieceIdx];
  const from = piece.pos, fromRoute = piece.route;

  const dest = travel(piece.pos, piece.route, steps, opts);
  if (dest.pos === piece.pos) return '그 말은 지금 움직일 수 없습니다.';
  const trail = pathOf(piece.pos, piece.route, steps, opts);
  movers.forEach(i => { player.pieces[i].pos = dest.pos; player.pieces[i].route = dest.route; });

  r.anim = { player: player.id, pieces: movers, trail, seq: (r.anim?.seq || 0) + 1 };
  if (movers.length > 1) log(r, `${player.name}의 말 ${movers.length}개가 업혀서 함께 이동!`);
  if (dest.route === 'lap')
    log(r, `🚩 ${player.name}의 말이 한 바퀴 돈 것으로 쳐서 출발지에 섰습니다. 앞으로 가면 바로 완주!`);

  if (dest.pos === FINISH) {
    const kinds = movers.map(i => player.pieces[i].kind);
    log(r, `🏁 ${player.name}의 말 ${movers.length}개 완주!`);
    if (player.stats?.queenLives != null) player.stats.queenLives++;
    if (kinds.includes('queen')) { movers.forEach(i => { player.pieces[i].pos = 0; player.pieces[i].route = 'outer'; }); log(r, '👸 중전마마는 완주할 수 없어 되돌아갑니다.'); return {}; }
    return { finished: true };
  }

  // 멈춘 칸의 타일 (진흙·함정·보상·마늘)
  movers.forEach(i => FX.steppedOn(r, player, player.pieces[i], makeApi(r)));
  if (trail.length && FX.mudCells(r).has(dest.pos)) log(r, `🟤 ${player.name}의 말이 미끄러져 멈췄습니다.`);

  // 잡기 대상 찾기
  const targets = [];
  for (const other of r.players) {
    if (other.id === player.id) continue;
    const hit = other.pieces.map((p, i) => ({ p, i })).filter(x => x.p.pos === dest.pos && FX.onBoard(x.p));
    if (hit.length) targets.push({ owner: other.id, pieces: hit.map(x => x.i) });
  }
  if (targets.length) return { capture: { targets, pieceIdx: movers[0], from, fromRoute } };
  return {};
}

/* 폰은 윷을 던질 때마다 저절로 한 칸 */
function movePawns(r, player) {
  player.pieces.forEach((x, i) => {
    if (x.kind !== 'pawn' || x.pos === FINISH) return;
    const t = travel(x.pos, x.route, 1);
    x.pos = t.pos; x.route = t.route;
  });
}

function checkWin(r, player) {
  if (FX.checkSpecialWin(r, player, makeApi(r))) return true;
  if (player.pieces.length && player.pieces.every(p => p.pos === FINISH)) {
    return declareWin(r, player, '전원 완주');
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
    pieces: Array.from({ length: r.pieceCount }, () => newPiece()),
    augs: [], correct: 0, total: 0, speed: 0, turns: 0, throws: 0,
    coins: { dog: 0 }, flags: {}, stats: {},
    eliminated: false, health: null, rank: null, skip: 0
  };
  r.players.push(p);
  if (sock) { sock.data.room = r.code; sock.data.id = id; sock.join(r.code); }
  log(r, `${p.animal} ${p.name} 입장`);
  return p;
}

io.on('connection', s => {

  s.on('create', ({ name, mode, pieceCount, classCode }, ack) => {
    name = String(name || '').trim().slice(0, 12);
    if (!name) return fail(ack, '이름을 입력하세요.');
    const cls = classes.get(String(classCode || activeSet).toUpperCase()) || classes.get('BASE');
    const code = newCode(), id = crypto.randomUUID();
    const full = mode === 'full';
    const r = {
      code, mode: full ? 'full' : 'simple', status: 'waiting', paused: false,
      players: [], turn: 0, round: 0, roll: null, pending: null, log: [], winner: null, winners: [],
      host: id, tiles: [], bannedAug: [], fog: 0, hidden: 0, rotation: 0,
      catRule: false, echo: false, lifeOwner: null, duel: null, createdAt: Date.now(),
      pieceCount: Math.min(4, Math.max(2, Number(pieceCount) || (full ? 4 : 3))),
      quizEvery: full ? 1 : 2,
      bank: cls ? cls.bank : null,
      classCode: cls ? cls.code : null, className: cls ? cls.name : null,
      chooseQueue: []
    };
    rooms.set(code, r);
    addPlayer(r, s, name, id);
    done(ack, { code, id });
    push(r);
  });

  /* 자동 배정 — 수업 링크로 들어온 학생을 모둠 방에 알아서 나눠 넣는다.
     빈 자리가 있는 방부터 채우고, 없으면 새 방을 만든다. 정원이 차면 저절로 시작. */
  s.on('autoJoin', ({ classCode, name }, ack) => {
    name = String(name || '').trim().slice(0, 12);
    if (!name) return fail(ack, '이름을 입력하세요.');
    const cls = classes.get(String(classCode || activeSet || 'BASE').toUpperCase()) || classes.get('BASE');
    const size = Math.min(5, Math.max(2, Number(cls?.size) || 4));

    /* 같은 수업에서 자리가 남은 방 — 많이 찬 방부터 채운다 */
    const open = [...rooms.values()]
      .filter(r => r.auto && r.status === 'waiting' && r.classCode === (cls?.code || null)
                && r.players.length < size)
      .sort((a, b) => b.players.length - a.players.length || a.createdAt - b.createdAt);

    const id = crypto.randomUUID();
    let r = open[0];
    if (!r) {
      const full = (cls?.mode || 'full') === 'full';
      const code = newCode();
      r = {
        code, mode: full ? 'full' : 'simple', status: 'waiting', paused: false,
        players: [], turn: 0, round: 0, roll: null, pending: null, log: [], winner: null, winners: [],
        host: id, tiles: [], bannedAug: [], fog: 0, hidden: 0, rotation: 0,
        catRule: false, echo: false, lifeOwner: null, duel: null, createdAt: Date.now(),
        pieceCount: Math.min(4, Math.max(2, Number(cls?.pieces) || (full ? 4 : 3))),
        quizEvery: full ? 1 : 2,
        bank: cls ? cls.bank : null,
        classCode: cls ? cls.code : null, className: cls ? cls.name : null,
        chooseQueue: [], auto: true, autoSize: size
      };
      rooms.set(code, r);
      addPlayer(r, s, name, id);
      log(r, `🪄 ${size}명이 모이면 저절로 시작합니다.`);
    } else {
      addPlayer(r, s, name, id);
    }
    done(ack, { code: r.code, id, size, waiting: size - r.players.length });

    /* 정원이 차면 바로 시작 */
    if (r.players.length >= (r.autoSize || size) && r.status === 'waiting') {
      r.status = 'playing'; r.turn = 0; r.round = 0;
      log(r, '모두 모였습니다. 게임 시작!');
      startRound(r);
    } else push(r);
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
    r.status = 'playing'; r.turn = 0; r.round = 0;
    log(r, '게임 시작!');
    done(ack); startRound(r);
  });

  /* 윷 던지기 */
  s.on('throw', ({ choose } = {}, ack) => {
    const r = rooms.get(s.data.room);
    if (!r || r.status !== 'playing' || r.paused) return fail(ack, '게임이 진행 중이 아닙니다.');
    if (cur(r)?.sid !== s.id) return fail(ack, '내 차례가 아닙니다.');
    if (r.pending) return fail(ack, '먼저 진행 중인 것을 끝내세요.');
    const p = cur(r);

    /* '한 걸음씩' — 이미 던진 결과에서 도·개 중 하나를 고르는 중 */
    if (r.roll?.choices) {
      const v = Number(choose);
      if (!r.roll.choices.includes(v)) return fail(ack, '도 또는 개를 고르세요.');
      r.roll = { ...YUT[v], sticks: [] };
      const sv = (p.stats ||= {});
      if (sv.throwsThisTurn?.length) sv.throwsThisTurn[sv.throwsThisTurn.length - 1] = v;
      if (p.flags?.winScore) { sv.yutSeen ||= []; if (!sv.yutSeen.includes(v)) sv.yutSeen.push(v); }
      log(r, `${p.name}: ${r.roll.emoji} ${r.roll.name} 선택 (${r.roll.v}칸)`);
      r.turnDeadline = Date.now() + T.turn;
      push(r); armTurnTimer(r);
      return done(ack, { roll: r.roll });
    }

    if (r.roll) return fail(ack, '먼저 말을 움직이세요.');
    if ((p.throws || 0) <= 0) return fail(ack, '던질 기회가 없습니다.');
    p.throws--;

    /* 자진모리·어부지리로 예약된 결과 */
    if (p.flags?.nextForced != null) { p.flags.forced = p.flags.nextForced; p.flags.nextForced = null; }

    /* 도베르만 — 개 코인 2개로 모 만들기 */
    if (choose === 'dogcoin' && p.flags?.doberman && (p.coins.dog || 0) >= 2) {
      p.coins.dog -= 2; p.flags.forced = 5;
      log(r, `🐕 ${p.name}이(가) 개 코인 2개를 써서 모를 만듭니다.`);
    }

    let res;
    try { res = FX.rollFor(r, p); } catch (e) { console.error(e); res = throwSticks(); }

    /* 한 걸음씩 — 도·개 중에서 고른다 */
    if (res.choices && [1, 2].includes(Number(choose))) res = { ...YUT[Number(choose)], sticks: [] };

    r.roll = res;
    r.lastWasBackdo = res.v === -1;
    try { FX.afterRoll(r, p, res, makeApi(r)); } catch (e) { console.error(e); }
    if (r.status !== 'playing' || p.eliminated) { r.roll = null; push(r); return done(ack, { roll: res }), advance(r); }

    if (res.v >= 4) p.throws++;
    movePawns(r, p);
    log(r, `${p.name}: ${res.emoji} ${res.name} (${res.en}) ${res.v > 0 ? res.v + '칸' : res.v === -1 ? '뒤로 1칸' : ''}`);
    FX.checkSpecialWin(r, p, makeApi(r));
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

  /* 계속 — 정답을 본 뒤 바로 다음으로 (누구나 누를 수 있다) */
  s.on('continue', (_, ack) => {
    const r = rooms.get(s.data.room); if (!r) return fail(ack, '방이 없습니다.');
    const p = r.pending;
    if (!p || !p.canContinue) return fail(ack, '지금은 넘어갈 수 없습니다.');
    done(ack);
    if (p.kind === 'battle') continueBattle(r); else if (p.kind === 'capture') continueCapture(r);
  });

  /* 바로 채점 — 아직 답 안 한 친구를 기다리지 않는다 (방장만) */
  s.on('gradeNow', (_, ack) => {
    const r = rooms.get(s.data.room); if (!r) return fail(ack, '방이 없습니다.');
    const me = r.players.find(x => x.sid === s.id);
    if (!me || r.host !== me.id) return fail(ack, '방장만 할 수 있습니다.');
    const p = r.pending;
    if (!p || p.revealed || (p.kind !== 'battle' && p.kind !== 'capture')) return fail(ack, '지금은 채점할 수 없습니다.');
    done(ack);
    if (p.kind === 'battle') resolveBattle(r); else resolveCapture(r);
  });

  /* 차례 넘기기 — 멈춰 있는 친구를 건너뛴다 (방장만) */
  s.on('skipTurn', (_, ack) => {
    const r = rooms.get(s.data.room); if (!r || r.status !== 'playing') return fail(ack, '게임이 진행 중이 아닙니다.');
    const me = r.players.find(x => x.sid === s.id);
    if (!me || r.host !== me.id) return fail(ack, '방장만 할 수 있습니다.');
    if (r.pending) return fail(ack, '문제를 먼저 끝내세요.');
    log(r, `⏭️ 방장이 ${cur(r)?.name} 차례를 넘겼습니다`);
    r.roll = null; if (cur(r)) cur(r).throws = 0;
    done(ack);
    advance(r);
  });

  /* 방 없애기 — 방장이 직접 닫는다 */
  s.on('closeRoom', (_, ack) => {
    const r = rooms.get(s.data.room); if (!r) return fail(ack, '방이 없습니다.');
    const me = r.players.find(x => x.sid === s.id);
    if (!me || r.host !== me.id) return fail(ack, '방장만 방을 없앨 수 있습니다.');
    clearTimer(r);
    rooms.delete(r.code);
    io.to(r.code).emit('closed');
    io.to('teachers').emit('rooms', summaries());
    dirty = true;
    done(ack);
  });

  /* 증강 선택 — 모두가 동시에 고른다 */
  s.on('choose', ({ id }, ack) => {
    const r = rooms.get(s.data.room); if (!r) return fail(ack, '방이 없습니다.');
    const pend = r.pending;
    const me = r.players.find(x => x.sid === s.id);
    if (!pend || pend.kind !== 'choose' || !me) return fail(ack, '지금은 고를 수 없습니다.');
    if (pend.picked[me.id]) return fail(ack, '이미 골랐습니다.');
    if (!pend.offers[me.id]) return fail(ack, '이번에는 고를 차례가 아닙니다.');
    if (!pend.offers[me.id].some(c => c.id === id)) return fail(ack, '선택할 수 없는 증강입니다.');
    takePick(r, me, id);
    done(ack);
    const waiting = Object.keys(pend.offers).filter(pid => !pend.picked[pid]);
    if (!waiting.length) finishChoose(r, false); else push(r);
  });

  /* 말 이동 */
  s.on('move', ({ piece }, ack) => {
    const r = rooms.get(s.data.room);
    if (!r || r.status !== 'playing' || r.paused) return fail(ack, '게임이 진행 중이 아닙니다.');
    if (cur(r)?.sid !== s.id) return fail(ack, '내 차례가 아닙니다.');
    if (r.pending) return fail(ack, '먼저 진행 중인 것을 끝내세요.');
    if (!r.roll) return fail(ack, '먼저 윷을 던지세요.');
    const p = cur(r);
    const idx = Number(piece);
    if (!Number.isInteger(idx) || idx < 0 || idx >= p.pieces.length) return fail(ack, '말 번호가 잘못되었습니다.');
    const steps = FX.stepsFor(r, p, r.roll.v);
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
    if (checkWin(r, p)) {
      if (r.status !== 'playing') { push(r); return; }
      p.throws = 0; advance(r); return;           // 이겼어도 판은 계속 — 차례를 넘긴다
    }
    advance(r);
  });

  /* 증강 사용 */
  s.on('ability', (prm = {}, ack) => {
    const r = rooms.get(s.data.room);
    if (!r || r.status !== 'playing' || r.paused) return fail(ack, '게임이 진행 중이 아닙니다.');
    if (r.pending) return fail(ack, '먼저 진행 중인 것을 끝내세요.');
    const me = r.players.find(x => x.sid === s.id);
    if (!me) return fail(ack, '참가자가 아닙니다.');
    if (cur(r)?.id !== me.id) return fail(ack, '내 차례에만 쓸 수 있습니다.');

    const rec = (me.augs || []).find(a => a.id === prm.id && !a.spent);
    if (!rec) return fail(ack, '쓸 수 있는 증강이 아닙니다.');
    const a = augById(prm.id);
    if (!a || a.kind !== 'active') return fail(ack, '눌러서 쓰는 증강이 아닙니다.');
    if (a.turn && (me.throws || 0) <= 0) return fail(ack, '차례를 쓰는 증강입니다. 던지기 전에 쓰세요.');

    const fn = FX.ON_ACTIVATE[prm.id];
    if (!fn) return fail(ack, '아직 준비되지 않은 증강입니다.');
    let err = null;
    try { err = fn(r, me, makeApi(r), prm); } catch (e) { console.error('증강 사용 오류', prm.id, e); err = '증강을 쓰는 중 문제가 생겼습니다.'; }
    if (typeof err === 'string') return fail(ack, err);

    rec.uses = (rec.uses || 1) - 1;
    if (rec.uses <= 0) rec.spent = true;
    if (a.turn) me.throws = 0;
    log(r, `${a.icon} ${me.name} — ${a.name} 사용!`);
    done(ack);
    if (r.status !== 'playing') { push(r); return; }
    if (checkWin(r, me)) {
      if (r.status !== 'playing') { push(r); return; }
      me.throws = 0; advance(r); return;
    }
    if (a.turn) return advance(r);
    push(r);
  });

  /* 교사 */
  s.on('teacher:login', ({ pin }, ack) => {
    if (String(pin) !== PIN) return fail(ack, '교사 PIN이 다릅니다.');
    s.data.teacher = true; s.join('teachers');
    done(ack, { rooms: summaries(), augments: AUG, sets: setList() });
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
        const cur = classes.get(activeSet);
        if (cur && !cur.builtin) cur.bank = questions;
      }
      io.to('teachers').emit('sets', setList());
      res.json({
        ok: true, count: questions.length, scope: code || 'all',
        units: [...new Set(questions.map(q => q.unit).filter(Boolean))],
        levels: [...new Set(questions.map(q => q.level))],
        skipped: skipped.slice(0, 10)
      });
    } catch (e) { res.status(400).json({ error: '엑셀을 읽지 못했습니다: ' + e.message }); }
  });

/* 엑셀 기초 양식 내려받기 */
app.get('/api/template.xlsx', (_, res) => {
  const head = ['unit', 'question', 'option1', 'option2', 'option3', 'option4', 'answer', 'level', 'explanation'];
  const rows = [
    head,
    ['Lesson 9', 'How can I get to the museum?', 'Take Bus Number 7.', 'It is delicious.', 'I am eleven.', 'She is tall.', 1, 'easy', '교통수단을 묻는 말에는 Take ~ 로 답합니다.'],
    ['Lesson 9', 'Get off ___ the station.', 'in', 'at', 'on', 'under', 2, 'easy', 'get off at + 장소'],
    ['Lesson 9', 'The bank is ___ the school. (학교 뒤에)', 'behind', 'between', 'next to', 'in front of', 1, 'easy', 'behind = ~ 뒤에'],
    ['Lesson 9', 'The shop is ___ the bank and the park.', 'behind', 'under', 'between', 'next', 3, 'medium', 'between A and B = A와 B 사이에'],
    ['', '', '', '', '', '', '', '', '']
  ];
  const guide = [
    ['작성 방법'],
    [''],
    ['1. 첫 줄(열 제목)은 그대로 두세요. 한글 제목도 됩니다:'],
    ['   단원명 / 영어 문제 / 선택지 1 / 선택지 2 / 선택지 3 / 선택지 4 / 정답 번호 / 난이도 / 해설'],
    ['2. 한 줄에 문제 하나씩 씁니다. 줄 수는 제한이 없습니다.'],
    ['3. answer(정답 번호)는 1~4 중 하나입니다. 몇 번째 선택지가 정답인지 적습니다.'],
    ['4. level(난이도)은 easy / medium / hard 중 하나입니다. 문제 위에 표시됩니다.'],
    ['5. explanation(해설)은 채점이 끝난 뒤에만 학생에게 보입니다. 비워도 됩니다.'],
    ['6. 선택지 네 칸을 모두 채워야 합니다. 비어 있으면 그 줄은 건너뜁니다.'],
    [''],
    ['문제는 15~30개쯤이면 한 차시에 넉넉합니다.']
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 10 }, { wch: 38 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 9 }, { wch: 8 }, { wch: 34 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Questions');
  const ws2 = XLSX.utils.aoa_to_sheet(guide);
  ws2['!cols'] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(wb, ws2, '작성 안내');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="yut_questions_template.xlsx"');
  res.send(buf);
});

/* 문제 세트 목록 */
function setList() {
  const counts = {};
  for (const r of rooms.values()) counts[r.classCode || activeSet] = (counts[r.classCode || activeSet] || 0) + 1;
  return [...classes.values()]
    .sort((a, b) => (b.builtin ? 1 : 0) - (a.builtin ? 1 : 0) || a.createdAt - b.createdAt)
    .map(c => ({ code: c.code, name: c.name, count: c.bank.length, builtin: !!c.builtin, active: c.code === activeSet, rooms: counts[c.code] || 0 }));
}

/* 세트를 '지금 적용'으로 */
app.post('/api/class/:code/activate', (req, res) => {
  if (req.header('x-teacher-pin') !== PIN) return res.status(403).json({ error: '교사 인증 실패' });
  const c = classes.get(String(req.params.code || '').toUpperCase());
  if (!c) return res.status(404).json({ error: '문제 세트를 찾을 수 없습니다.' });
  activeSet = c.code; bank = c.bank; dirty = true;
  io.to('teachers').emit('sets', setList());
  res.json({ ok: true, code: c.code, name: c.name, count: c.bank.length });
});

/* 세트 지우기 (기본 문제는 지울 수 없다) */
app.delete('/api/class/:code', (req, res) => {
  if (req.header('x-teacher-pin') !== PIN) return res.status(403).json({ error: '교사 인증 실패' });
  const code = String(req.params.code || '').toUpperCase();
  const c = classes.get(code);
  if (!c) return res.status(404).json({ error: '문제 세트를 찾을 수 없습니다.' });
  if (c.builtin) return res.status(400).json({ error: '기본 문제는 지울 수 없습니다.' });
  classes.delete(code);
  if (activeSet === code) { activeSet = 'BASE'; bank = classes.get('BASE').bank; }
  dirty = true;
  io.to('teachers').emit('sets', setList());
  res.json({ ok: true });
});

/* 수업 만들기 — 교사가 문제은행과 함께 수업을 만들고 링크를 받는다 */
app.post('/api/class',
  express.raw({ type: () => true, limit: '3mb' }),
  (req, res) => {
    if (req.header('x-teacher-pin') !== PIN) return res.status(403).json({ error: '교사 인증 실패' });
    const name = String(req.query.name || '').trim().slice(0, 40) || '영어 수업';
    let questions = bank, skipped = [];
    if (req.body && req.body.length > 100) {
      try {
        const parsed = parseBank(req.body);
        questions = parsed.questions; skipped = parsed.skipped;
      } catch (e) { return res.status(400).json({ error: '엑셀을 읽지 못했습니다: ' + e.message }); }
      if (!questions.length) {
        return res.status(400).json({
          error: '읽을 수 있는 문제가 없습니다.',
          hint: '첫 행이 unit / question / option1~4 / answer 또는 단원명 / 영어 문제 / 선택지 1~4 / 정답 번호 인지 확인하세요.',
          skipped: skipped.slice(0, 10)
        });
      }
    }
    const size = Math.min(5, Math.max(2, Number(req.query.size) || 4));
    const mode = req.query.mode === 'simple' ? 'simple' : 'full';
    const pieces = Math.min(4, Math.max(2, Number(req.query.pieces) || (mode === 'full' ? 4 : 3)));
    let code; do { code = crypto.randomBytes(2).toString('hex').toUpperCase(); } while (classes.has(code));
    classes.set(code, { code, name, bank: questions, createdAt: Date.now(), size, mode, pieces });
    dirty = true;
    io.to('teachers').emit('sets', setList());
    res.json({ ok: true, code, name, count: questions.length, size, mode, pieces, skipped: skipped.slice(0, 10) });
  });

/* 학생이 수업 링크로 들어왔을 때 수업 정보 */
app.get('/api/class/:code', (req, res) => {
  const c = classes.get(String(req.params.code || '').toUpperCase());
  if (!c) return res.status(404).json({ error: '수업을 찾을 수 없습니다. 주소를 다시 확인하세요.' });
  res.json({
    ok: true, code: c.code, name: c.name, count: c.bank.length,
    size: c.size || 4, mode: c.mode || 'full', pieces: c.pieces || 4
  });
});

app.get('/healthz', (_, res) => res.json({
  ok: true, rooms: rooms.size, classes: classes.size,
  players: [...rooms.values()].reduce((n, r) => n + r.players.filter(p => p.sid).length, 0),
  uptimeMin: Math.round(process.uptime() / 60), bank: bank.length, save: saveOff ? 'off' : 'on'
}));

app.get('/api/info', (_, res) => res.json({ augments: AUG, needs: FX.NEEDS, board: { coord: COORD, corners: CORNERS, ring: RING, scA: SC_A, scB: SC_B, center: CENTER }, bankCount: bank.length }));

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
    fs.writeFileSync(SAVE_FILE, JSON.stringify({ savedAt: Date.now(), bank, activeSet, classes: [...classes.values()], rooms: data }));
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
    for (const c of d.classes || []) classes.set(c.code, c);
    if (d.activeSet) activeSet = d.activeSet;
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
/* 기본 문제 세트는 언제나 있어야 한다 */
if (!classes.has('BASE')) classes.set('BASE', { code: 'BASE', name: BASE_NAME, bank: STARTER.slice(), createdAt: 0, builtin: true });
else { const b = classes.get('BASE'); b.builtin = true; b.name = b.name || BASE_NAME; }
if (!classes.has(activeSet)) activeSet = 'BASE';
bank = classes.get(activeSet).bank;

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
