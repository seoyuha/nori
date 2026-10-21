/* 서버를 띄우고 4명이 자동으로 끝까지 둔다. 터지는 곳이 있는지 본다. */
import { spawn } from 'child_process';
import { io } from 'socket.io-client';

const DIR = '/home/claude/yut/english_yut_battle_v3';
const PORT = 3111;
const ROUNDS = Number(process.argv[2] || 1);
const MODE = process.argv[3] || 'full';
const PIECES = Number(process.argv[4] || 3);

const srv = spawn('node', ['server.js'], {
  cwd: DIR, env: { ...process.env, PORT, DATA_DIR: '/tmp/yut-test-data', TEACHER_PIN: 'testpin' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverErrors = [];
srv.stdout.on('data', d => { const t = d.toString(); if (/error|Error/.test(t)) serverErrors.push(t.trim()); });
srv.stderr.on('data', d => serverErrors.push(d.toString().trim()));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL = `http://localhost:${PORT}`;

function mk(name) {
  const s = io(URL, { transports: ['websocket'] });
  const p = { s, name, id: null, code: null, state: null, picks: 0, throws: 0, moves: 0, abilities: 0 };
  s.on('state', st => { p.state = st; });
  return p;
}
const ask = (p, ev, data) => new Promise(res => p.s.emit(ev, data, res));

let stats = { rounds: 0, picks: 0, throws: 0, moves: 0, abilities: 0, answers: 0, errors: [], wins: [], secs: [], seen: new Set(), used: new Set() };

async function playOne(gameNo) {
  const ps = ['가람', '나래', '다온', '라온'].map(mk);
  await Promise.all(ps.map(p => new Promise(r => p.s.on('connect', r))));

  let res = await ask(ps[0], 'create', { name: ps[0].name, mode: MODE, pieceCount: PIECES });
  if (!res.ok) throw new Error('방 생성 실패: ' + res.error);
  ps[0].code = res.code; ps[0].id = res.id;
  for (const p of ps.slice(1)) {
    const r2 = await ask(p, 'join', { code: ps[0].code, name: p.name });
    if (!r2.ok) throw new Error('입장 실패: ' + r2.error);
    p.id = r2.id;
  }
  await sleep(120);
  await ask(ps[0], 'start', {});

  const t0 = Date.now();
  const deadline = t0 + 70000;
  let lastRound = 0;
  while (Date.now() < deadline) {
    const st = ps[0].state;
    if (!st) { await sleep(40); continue; }
    if (st.status === 'finished') break;
    if (st.round > lastRound) { lastRound = st.round; stats.rounds++; }

    const pend = st.pending;
    if (pend?.kind === 'battle' || pend?.kind === 'capture') {
      for (const p of ps) {
        if ((pend.answered || []).includes(p.id)) continue;
        if (pend.kind === 'capture' && p.id !== pend.attacker && p.id !== pend.defender) continue;
        const idx = Math.random() < 0.6 ? (pend.question.options.length ? 0 : 0) : Math.floor(Math.random() * 4);
        const a = await ask(p, 'answer', { index: idx });
        if (a?.ok) stats.answers++;
      }
      if (pend.canContinue) await ask(ps[0], 'continue', {});
      await sleep(60); continue;
    }
    if (pend?.kind === 'choose') {
      for (const p of ps) {
        const offers = pend.offers?.[p.id];
        if (!offers || (pend.picked || []).includes(p.id)) continue;
        const a = await ask(p, 'choose', { id: offers[Math.floor(Math.random() * offers.length)].id });
        if (a?.ok) { stats.picks++; offers.forEach(o => stats.seen.add(o.id)); } else if (a?.error) stats.errors.push('choose: ' + a.error);
      }
      await sleep(60); continue;
    }

    /* 내 차례 */
    const turn = st.players[st.turn];
    const p = ps.find(x => x.id === turn?.id);
    if (!p) { await sleep(60); continue; }

    /* 가끔 증강을 써 본다 */
    const usable = (turn.augs || []).filter(a => a.kind === 'active' && !a.spent);
    if (usable.length && Math.random() < 0.5) {
      const a = usable[0];
      const prm = { id: a.id };
      const onBoard = turn.pieces.map((x, i) => ({ x, i })).filter(z => z.x.pos >= 0 && z.x.pos !== 99);
      switch (a.needs) {
        case 'myStack': prm.pos = onBoard[0]?.x.pos ?? 0; break;
        case 'myPiece': prm.idx = onBoard[0]?.i ?? 0; prm.steps = 3; break;
        case 'waitingPiece': prm.idx = turn.pieces.findIndex(x => x.pos === -1); break;
        case 'cell': prm.pos = Math.floor(Math.random() * 20); break;
        case 'player': case 'outPlayer': prm.playerId = st.players.find(x => x.id !== p.id)?.id; break;
        case 'yut': prm.v = 4; break;
        case 'rank': prm.order = st.players.map(x => x.id); break;
      }
      const r3 = await ask(p, 'ability', prm);
      if (r3?.ok) { stats.abilities++; stats.used.add(a.id); }
    }

    if (!st.roll && (turn.throws || 0) > 0) {
      const r4 = await ask(p, 'throw', {});
      if (r4?.ok) stats.throws++; else if (r4?.error) stats.errors.push('throw: ' + r4.error);
      await sleep(30); continue;
    }
    if (st.roll) {
      if (st.roll.choices) { await ask(p, 'throw', { choose: 1 }); await sleep(30); continue; }
      const movable = turn.pieces.map((x, i) => ({ x, i }))
        .filter(z => z.x.pos !== 99 && !z.x.frozen && !z.x.locked && z.x.kind !== 'pawn'
                  && !(st.roll.v < 0 && z.x.pos < 0));
      if (!movable.length) { await ask(ps[0], 'skipTurn', {}); await sleep(40); continue; }
      const pick = movable[Math.floor(Math.random() * movable.length)];
      const r5 = await ask(p, 'move', { piece: pick.i });
      if (r5?.ok) stats.moves++; else if (r5?.error && !/차례|던지|진행/.test(r5.error)) stats.errors.push('move: ' + r5.error);
      await sleep(30); continue;
    }
    await sleep(50);
  }

  const fin = ps[0].state;
  if (fin?.status === 'finished') {
    stats.secs.push(Math.round((Date.now()-t0)/1000));
    stats.wins.push(fin.players.slice().sort((a, b) => (a.rank || 99) - (b.rank || 99))
      .map(x => `${x.rank}위 ${x.name}(${x.winReason || '-'})`).join(', '));
  } else {
    stats.errors.push(`게임 ${gameNo}: 제한 시간 안에 끝나지 않음 (라운드 ${fin?.round})`);
  }
  ps.forEach(p => p.s.close());
}

await sleep(900);
try {
  for (let i = 1; i <= ROUNDS; i++) await playOne(i);
} catch (e) {
  stats.errors.push('치명적: ' + e.message);
}

console.log('── 자동 대국 결과 ──');
console.log(`라운드 ${stats.rounds} · 문제 응답 ${stats.answers} · 증강 선택 ${stats.picks} · 증강 사용 ${stats.abilities}`);
console.log(`윷 던지기 ${stats.throws} · 말 이동 ${stats.moves}`);
stats.wins.forEach((w, i) => console.log(`게임 ${i + 1} 결과: ${w}`));
const uniq = [...new Set(stats.errors)];
if (uniq.length) { console.log(`\n문제 ${uniq.length}종:`); uniq.slice(0, 25).forEach(e => console.log('  -', e)); }
else console.log('\n✅ 오류 없음');
console.log(`끝난 게임 길이(초): ${stats.secs.join(', ') || '-'} · 평균 ${stats.secs.length?Math.round(stats.secs.reduce((a,b)=>a+b,0)/stats.secs.length):'-'}초`);
console.log(`\n선택창에 등장한 증강 ${stats.seen.size}종 · 실제로 사용된 active 증강 ${stats.used.size}종`);
if (serverErrors.length) { console.log('\n서버 로그 오류:'); [...new Set(serverErrors)].slice(0, 15).forEach(e => console.log('  !', e.split('\n')[0])); }

srv.kill();
process.exit(0);
