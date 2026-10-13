/* 학생 5명이 한 방에서 끝까지 플레이하는 자동 시험 */
import { io } from 'socket.io-client';
const URL = process.env.URL || 'http://localhost:3100';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function mk(name) {
  const s = io(URL, { transports: ['websocket'] });
  const me = { name, sock: s, id: null, code: null, state: null, answers: 0, chose: 0, threw: 0, moved: 0 };
  s.on('state', st => { me.state = st; });
  return me;
}
const ask = (s, ev, data) => new Promise(res => s.emit(ev, data, r => res(r)));

const log = [];
function note(t) { log.push(t); }

async function run() {
  const names = ['하늘', '바다', '구름', '별이', '달이'];
  const ps = names.map(mk);
  await sleep(600);

  const c = await ask(ps[0].sock, 'create', { name: names[0], mode: 'simple', pieceCount: 2 });
  if (!c.ok) throw new Error('방 만들기 실패: ' + c.error);
  ps[0].id = c.id; ps[0].code = c.code;
  note(`방 ${c.code} 생성`);

  for (let i = 1; i < ps.length; i++) {
    const j = await ask(ps[i].sock, 'join', { code: c.code, name: names[i] });
    if (!j.ok) throw new Error(`${names[i]} 입장 실패: ` + j.error);
    ps[i].id = j.id; ps[i].code = j.code;
  }
  await sleep(400);
  if (ps[4].state.players.length !== 5) throw new Error('5명이 모이지 않음');
  note('5명 입장 완료');

  const st = await ask(ps[0].sock, 'start', {});
  if (!st.ok) throw new Error('시작 실패: ' + st.error);
  await sleep(500);

  let guard = 0, battles = 0, captures = 0, stacks = 0, shortcutUse = 0;
  const S = () => ps[0].state;

  while (S() && S().status === 'playing' && guard++ < 4000) {
    const s = S();

    // 배틀/잡기 — 해당하는 학생이 모두 답한다
    if (s.pending && (s.pending.kind === 'battle' || s.pending.kind === 'capture') && !s.pending.answer) {
      if (s.pending.kind === 'battle') battles++;
      const who = s.pending.kind === 'capture'
        ? ps.filter(p => [s.pending.attacker, s.pending.defender].includes(p.id))
        : ps;
      for (const p of who) {
        if (s.pending.answered.includes(p.id)) continue;
        // 70%는 정답을 맞히도록 (실제 교실과 비슷하게)
        const right = p.state.pending?.question;
        if (!right) continue;
        const pick = Math.random() < 0.7 ? -1 : Math.floor(Math.random() * 4);
        // 정답 번호는 클라이언트에 오지 않으므로 무작위로 고른다 → 서버 채점을 신뢰
        await ask(p.sock, 'answer', { index: pick === -1 ? Math.floor(Math.random() * 4) : pick });
        p.answers++;
      }
      await sleep(120);
      continue;
    }
    if (s.pending && s.pending.answer) { await sleep(150); continue; }

    // 증강 선택
    if (s.pending && s.pending.kind === 'choose') {
      const p = ps.find(x => x.id === s.pending.player);
      if (p) {
        const pick = s.pending.choices[Math.floor(Math.random() * s.pending.choices.length)];
        const r = await ask(p.sock, 'choose', { id: pick.id });
        if (r.ok) p.chose++;
      }
      await sleep(120);
      continue;
    }

    const turnP = ps.find(x => x.id === s.players[s.turn].id);
    if (!turnP) break;

    // 가끔 증강을 써 본다
    const myAb = s.players[s.turn].abilities;
    if (myAb.length && !s.roll && Math.random() < 0.35) {
      const id = myAb[0];
      const others = s.players.filter(x => x.id !== turnP.id);
      const enemy = others.find(e => e.pieces.some(pc => pc.pos >= 0 && pc.pos !== 99));
      const myIdx = s.players[s.turn].pieces.findIndex(pc => pc.pos >= 0 && pc.pos !== 99);
      const homeIdx = s.players[s.turn].pieces.findIndex(pc => pc.pos === -1);
      const epIdx = enemy?.pieces.findIndex(pc => pc.pos >= 0 && pc.pos !== 99);
      await ask(turnP.sock, 'ability', {
        id,
        piece: id === 'heal' ? (homeIdx < 0 ? 0 : homeIdx) : (myIdx < 0 ? 0 : myIdx),
        target: enemy?.id, enemyPiece: epIdx < 0 ? 0 : epIdx, value: 4
      });
      await sleep(80);
      continue;
    }

    // 윷 던지기
    if (!s.roll) {
      const r = await ask(turnP.sock, 'throw', {});
      if (r.ok) turnP.threw++;
      await sleep(90);
      continue;
    }

    // 말 이동 — 움직일 수 있는 말 중 하나
    const pcs = s.players[s.turn].pieces;
    const cands = pcs.map((pc, i) => ({ pc, i })).filter(x => x.pc.pos !== 99 && !x.pc.frozen);
    if (!cands.length) { await sleep(120); continue; }
    const pick = cands[Math.floor(Math.random() * cands.length)];
    const before = JSON.stringify(s.players.map(p => p.pieces.map(x => x.pos)));
    const r = await ask(turnP.sock, 'move', { piece: pick.i });
    if (r.ok) turnP.moved++;
    await sleep(110);
    const after = ps[0].state;
    if (after?.pending?.kind === 'capture') captures++;
    // 업기 확인
    const grouped = after?.players.some(p => {
      const live = p.pieces.filter(x => x.pos >= 0 && x.pos !== 99).map(x => x.pos);
      return new Set(live).size < live.length;
    });
    if (grouped) stacks++;
    const onShort = after?.players.some(p => p.pieces.some(x => x.pos >= 20 && x.pos !== 99));
    if (onShort) shortcutUse++;
  }

  const fin = S();
  note(`턴 반복 ${guard}회`);
  note(`영어 배틀 ${battles}회 · 잡기 승부 ${captures}회`);
  note(`업기 발생 ${stacks > 0 ? '있음' : '없음'} · 지름길 사용 ${shortcutUse > 0 ? '있음' : '없음'}`);
  note(`상태: ${fin.status}  우승: ${fin.winner || '-'}`);
  console.log('\n'.padEnd(1) + log.map(x => '  ' + x).join('\n'));

  console.log('\n  학생별 기록');
  for (const p of ps) {
    const pl = fin.players.find(x => x.id === p.id);
    console.log(`    ${pl.animal} ${pl.name.padEnd(4)} 던지기 ${String(p.threw).padStart(3)}  이동 ${String(p.moved).padStart(3)}  영어 ${String(pl.correct).padStart(2)}/${String(pl.total).padStart(2)}  증강획득 ${p.chose}  속도점수 ${pl.speed}  완주 ${pl.pieces.filter(x => x.pos === 99).length}/${pl.pieces.length}`);
  }
  const totals = fin.players.map(p => p.total);
  console.log(`\n  영어 문제 푼 횟수: 최소 ${Math.min(...totals)} ~ 최대 ${Math.max(...totals)}  (차이 ${Math.max(...totals) - Math.min(...totals)})`);

  // 모두가 푸는 '영어 배틀'은 똑같이 나뉘고, 차이는 2명만 겨루는 '잡기 승부'에서만 생긴다.
  const ok = fin.status === 'finished' && !!fin.winner
    && battles > 0 && Math.max(...totals) - Math.min(...totals) <= 8;
  console.log(`\n  결과: ${ok ? '✅ 통과' : '❌ 확인 필요'}`);
  ps.forEach(p => p.sock.close());
  process.exit(ok ? 0 : 1);
}
run().catch(e => { console.error('실패:', e.message); process.exit(1); });
