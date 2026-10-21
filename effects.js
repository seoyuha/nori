/* ============================================================
   증강 71종의 실제 효과
   서버가 넘겨주는 api 를 통해서만 판을 건드린다.
   api: { log, capture, sendHome, moveSteps, grant, eliminate, declareWin,
          players, alive, enemies, rand, pick, pieceOf }
   ============================================================ */
import * as G from './game.js';
import { byId } from './augments.js';

/* active 증강이 쓰기 전에 무엇을 골라야 하는지 */
export const NEEDS = {
  truck8t: 'myStack', combo3: 'myStack', heavenshield: 'myStack',
  timewarp: 'myPiece', sacrifice: 'myPiece', domain: 'myPiece', marathoner: 'waitingPiece',
  sniper: 'cell', alkkagi: 'myPiece',
  throwhit: 'player', illusion: 'player', rescue: 'outPlayer',
  handfast: 'yut', badook: 'none', fog: 'none', risky: 'none', lastdance: 'none',
  asplanned: 'rank'
};

const F = p => (p.flags ||= {});
const S = p => (p.stats ||= {});

/* ───────────────────────── 얻는 즉시 ───────────────────────── */
export const ON_ACQUIRE = {
  /* 패시브 — 깃발만 세운다 */
  vanguard:    (r, p, api) => convert(r, p, 'vanguard', api),
  cannon:      (r, p, api) => convert(r, p, 'cannon', api),
  pawn:        (r, p, api) => convert(r, p, 'pawn', api),
  dokkaebi:    (r, p, api) => convert(r, p, 'dokkaebi', api),
  kimcheomji:  (r, p, api) => { convert(r, p, 'kimcheomji', api); S(p).kimStart = r.round; },
  queen: (r, p, api) => {
    const i = p.pieces.findIndex(x => x.kind === 'normal');
    if (i < 0) return api.log('바꿀 일반말이 없습니다.');
    p.pieces[i].kind = 'queen'; p.pieces[i].pos = 10; p.pieces[i].route = 'outer';
    S(p).queenLives = 1; S(p).queenThrows = 0;
    api.log(`${p.name}의 중전마마가 왼쪽 위에 자리잡았습니다.`);
  },
  choir: (r, p, api) => {
    let n = 0;
    p.pieces.forEach(x => { if (x.kind === 'normal') { x.kind = 'choir'; n++; } });
    S(p).claps = 0;
    api.log(`${p.name}의 일반말 ${n}개가 합창단원이 되었습니다.`);
  },

  moonwalk:   (r, p, api) => { F(p).reverse = true; api.log(`${p.name}의 모든 말이 반대로 움직입니다.`); },
  moorado:    (r, p) => { F(p).moorado = true; },
  twosword:   (r, p) => { F(p).twosword = true; },
  sixyut:     (r, p) => { F(p).sixyut = true; },
  stepbystep: (r, p) => { F(p).stepbystep = true; },
  doberman:   (r, p) => { F(p).doberman = true; p.coins ||= {}; p.coins.dog ||= 0; },
  jajinmori:  (r, p) => { F(p).jajinmori = true; S(p).geol = 0; },
  friendshield: (r, p) => { F(p).friendShield = true; },
  selfhelp:   (r, p) => { F(p).noStack = true; F(p).selfCapture = true; },
  peace:      (r, p, api) => { F(p).peace = true; api.log(`${p.name}이(가) 평화 협정을 맺었습니다.`); },
  fisherman:  (r, p) => { F(p).fisherman = true; S(p).foeLost = 0; },
  betrayal:   (r, p) => { F(p).betrayal = true; },
  cat:        () => {},
  chosen:     (r, p, api) => { r.catRule = true; api.log('이제 고양이가 보이면 반드시 골라야 합니다.'); },

  /* 특수 승리 — 조건만 등록 */
  samok:    (r, p) => { F(p).winSamok = true; },
  backstep: (r, p) => { F(p).winBackstep = true; S(p).backdoCaptures = 0; },
  score:    (r, p) => { F(p).winScore = true; S(p).yutSeen = S(p).yutSeen || []; },
  catlover: (r, p) => { F(p).winCatlover = true; },
  ungnyeo:  (r, p, api) => {
    F(p).winGarlic = true; S(p).garlic = 0;
    for (let i = 0; i < 3; i++) addTile(r, 'garlic', null);
    api.log('윷판 아무 곳에 마늘 3개가 놓였습니다.');
  },
  onlyone:  (r, p) => { F(p).winOnlyOne = true; },
  triple7:  (r, p) => { F(p).winTriple7 = true; },
  nofriend: (r, p) => { F(p).winNoFriend = true; S(p).caughtBy = []; },
  streak4:  (r, p) => { F(p).winStreak4 = true; S(p).captured = S(p).captured || 0; },

  /* 즉시 발동 */
  notme: (r, p, api) => {
    const foes = api.enemies(p); if (!foes.length) return;
    const t = api.pick(foes);
    const idx = t.pieces.map((x, i) => i).filter(i => onBoard(t.pieces[i]));
    api.capture(t, idx, p, '나만 아니면 돼~');
    api.log(`🙈 ${t.name}의 말이 모두 잡혔습니다!`);
  },
  bigredbtn: (r, p, api) => {
    const inner = new Set([...G.SC_A, ...G.SC_B]);
    api.players().forEach(t => {
      const idx = t.pieces.map((x, i) => i).filter(i => inner.has(t.pieces[i].pos));
      if (idx.length) api.capture(t, idx, p, '크고 빨간 버튼');
    });
    api.log('🔴 지름길 위의 말이 모두 날아갔습니다!');
  },
  wait: (r, p, api) => {
    const foes = api.enemies(p); if (!foes.length) return;
    let best = null;
    foes.forEach(t => t.pieces.forEach(x => {
      if (!onBoard(x)) return;
      const d = G.remain(x.pos, x.route);
      if (!best || d < best.d) best = { t, x, d };
    }));
    if (!best) return api.log('묶을 말이 없습니다.');
    G.groupAt(best.t, best.x.pos).forEach(g => { g.p.frozen = 2; });
    api.log(`✋ ${best.t.name}의 가장 앞선 말이 2라운드 동안 묶였습니다.`);
  },
  mud: (r, p, api) => { const t = addTile(r, 'mud', p.id); api.log(`🟤 ${t}번 칸이 미끄러워졌습니다.`); },
  whoami: (r, p, api) => {
    r.hidden = 1;
    api.enemies(p).forEach(t => { if (api.rand(2) === 0) t.skip = (t.skip || 0) + 1; });
    api.log('❓ 잠깐 모든 것이 가려졌습니다. 색을 못 맞힌 사람은 한 번 쉽니다.');
  },
  vote: (r, p, api) => {
    const tally = new Map();
    api.alive().forEach(t => {
      const foes = api.alive().filter(x => x !== t); if (!foes.length) return;
      const target = api.pick(foes);
      tally.set(target.id, (tally.get(target.id) || 0) + (t === p ? 2 : 1));
    });
    let top = null;
    tally.forEach((v, id) => { if (!top || v > top.v) top = { id, v }; });
    if (!top) return;
    const t = api.players().find(x => x.id === top.id);
    t.skip = (t.skip || 0) + 1;
    api.log(`🗳️ 투표 결과 ${t.name}이(가) 한 번 쉽니다. (${top.v}표)`);
  },
  leech: (r, p, api) => {
    const foes = api.enemies(p); if (!foes.length) return;
    const t = api.pick(foes);
    const i = p.pieces.findIndex(x => !onBoard(x) && x.pos !== G.FINISH);
    if (i >= 0) { p.pieces.splice(i, 1); t.pieces.push(G.newPiece()); }
    F(p).leechOn = t.id;
    api.log(`🪱 ${p.name}이(가) ${t.name}에게 말을 하나 주고 운명을 함께합니다.`);
  },
  spinwheel: (r, p, api) => {
    const q = 1 + api.rand(3);
    rotateBoard(r, q, api);
    F(p).respin = true;
    api.log(`🎡 윷판이 ${q}칸 돌아갔습니다.`);
  },
  foldboard: (r, p, api) => { foldBoard(r, api.rand(4), api); },
  echo: (r, p, api) => { r.echo = true; api.log('🔁 이제 모두가 차례를 두 번씩 가집니다.'); },
  comeback: (r, p, api) => {
    for (let i = 0; i < 3; i++) api.grant(p, null);
    api.log(`🎁 ${p.name}이(가) 증강 3개를 얻었습니다.`);
  },
  bronze: (r, p, api) => { api.declareWin(p, '동메달도 잘한 거야', 3); },
  cancelall: (r, p, api) => { r.winners = []; api.players().forEach(x => { x.rank = null; }); api.log('🚫 지금까지의 모든 승리가 취소되었습니다.'); },
  lifegame: (r, p, api) => {
    r.lifeOwner = p.id;
    api.alive().forEach(t => { t.health = 3; });
    api.log('❤️ 모두에게 체력 3이 생겼습니다.');
  },
  duel: (r, p, api) => {
    const foes = api.enemies(p); if (!foes.length) return;
    const t = api.pick(foes);
    r.duel = { by: p.id, on: t.id, until: r.round + 3 };
    api.log(`🔥 ${p.name}이(가) ${t.name}에게 승부를 걸었습니다! 세 차례 안에 완주하지 못하면 탈락입니다.`);
  },
  detective: (r, p, api) => {
    const a = api.pick(api.poolIds());
    r.bannedAug = [...(r.bannedAug || []), a];
    api.log(`🔍 이번 증강 선택에서 「${byId(a)?.name}」이(가) 빠집니다.`);
  },
  delivery: (r, p, api) => {
    F(p).delivery = api.pick(api.poolIds());
    api.log(`📦 다음 증강 선택에 「${byId(F(p).delivery)?.name}」이(가) 반드시 나옵니다.`);
  },
  objection: (r, p, api) => { F(p).reroll = true; api.log('☝️ 증강을 다시 뽑습니다.'); },
  illusion: (r, p, api) => {
    const foes = api.enemies(p).filter(t => (t.augs || []).some(a => !a.spent));
    if (!foes.length) return api.log('바꿀 증강이 없습니다.');
    const t = api.pick(foes);
    const a = api.pick(t.augs.filter(x => !x.spent));
    a.catUntil = r.round + 3; a.wasId = a.id; a.id = 'cat';
    api.log(`🌀 ${t.name}의 증강 하나가 3라운드 동안 고양이가 되었습니다.`);
  },

  /* 시작 전용 */
  equaltrade: (r, p, api) => {
    if (p.pieces.length > 1) p.pieces.pop();
    F(p).sticks = Math.max(2, (F(p).sticks || 4) - 1);
    api.log(`⚖️ ${p.name}: 말 1개와 윷 1개를 줄였습니다.`);
  },
  burdenluck: (r, p, api) => {
    p.pieces.push(G.newPiece());
    F(p).sticks = Math.min(6, (F(p).sticks || 4) + 1);
    api.log(`🎒 ${p.name}: 말 1개와 윷 1개를 늘렸습니다.`);
  },
  speedgame: (r, p, api) => {
    api.players().forEach(t => { t.pieces = t.pieces.slice(0, 2); while (t.pieces.length < 2) t.pieces.push(G.newPiece()); });
    p.pieces[0].pos = 0; p.pieces[0].route = 'outer';
    if (p.pieces[1]) { p.pieces[1].pos = 1; p.pieces[1].route = 'outer'; }
    api.log('⏩ 모두의 말이 2개가 되었습니다.');
  },
  piggyback: (r, p, api) => {
    p.pieces.forEach(x => { x.pos = 0; x.route = 'outer'; });
    api.log(`🧑‍🤝‍🧑 ${p.name}의 모든 말이 업힌 채 출발합니다.`);
  },
  trapparty: (r, p, api) => {
    for (let i = 0; i < 6; i++) addTile(r, 'trap', p.id);
    for (let i = 0; i < 4; i++) addTile(r, 'reward', p.id);
    api.log('🎪 판에 함정 6개와 보상 4개가 놓였습니다.');
  }
};

/* ───────────────────────── 눌러서 쓰는 증강 ───────────────────────── */
export const ON_ACTIVATE = {
  truck8t: (r, p, api, prm) => {
    const g = G.groupAt(p, prm.pos);
    if (g.length < 2) return '말이 2개 이상인 말뭉치를 고르세요.';
    let moved = 0, pos = prm.pos, route = g[0].p.route;
    while (moved < 20) {
      const n = G.nextNode(pos, route);
      if (n.pos === G.FINISH) { pos = n.pos; route = n.route; moved++; break; }
      if (api.occupied(r, n.pos)) break;
      pos = n.pos; route = n.route; moved++;
    }
    g.forEach(x => { x.p.pos = pos; x.p.route = route; });
    api.log(`🚚 ${p.name}의 말뭉치가 ${moved}칸 밀고 나갔습니다.`);
  },
  combo3: (r, p, api, prm) => {
    const g = G.groupAt(p, prm.pos);
    if (g.length < 3) return '말이 3개 이상인 말뭉치를 고르세요.';
    api.players().forEach(t => {
      const idx = t.pieces.map((x, i) => i).filter(i => onBoard(t.pieces[i]) && !(t === p && t.pieces[i].pos === prm.pos));
      if (idx.length) api.capture(t, idx, p, '3단 합체 필살기');
    });
    api.log('💥 3단 합체 필살기!!! 윷판이 비었습니다.');
  },
  heavenshield: (r, p, api, prm) => {
    const g = G.groupAt(p, prm.pos);
    if (!g.length) return '내 말뭉치를 고르세요.';
    g.forEach(x => { x.p.shield++; });
    api.log(`🛡️ ${p.name}의 말뭉치가 보호막을 얻었습니다.`);
  },
  sacrifice: (r, p, api, prm) => {
    const pc = p.pieces[prm.idx];
    if (!pc || !onBoard(pc)) return '윷판 위의 내 말을 고르세요.';
    api.sendHome(pc);
    p.pieces.forEach(x => { if (onBoard(x)) x.shield++; });
    api.log(`🕊️ ${p.name}의 말 하나가 돌아가고, 남은 말이 보호막을 얻었습니다.`);
  },
  timewarp: (r, p, api, prm) => {
    const pc = p.pieces[prm.idx];
    if (!pc || !onBoard(pc)) return '윷판 위의 내 말을 고르세요.';
    const back = Math.min(10, Math.max(1, prm.steps | 0 || 3));
    const t = G.travel(pc.pos, pc.route, -back);
    pc.pos = t.pos; pc.route = t.route;
    api.log(`⏳ ${p.name}의 말이 ${back}칸 뒤로 돌아갔습니다.`);
  },
  sniper: (r, p, api, prm) => {
    if (p.throws <= 0) return '던지기 기회가 남아 있어야 합니다.';
    p.throws--;
    F(p).sniper = { pos: prm.pos, at: r.round + 1 };
    api.log(`🎯 ${p.name}이(가) ${prm.pos}번 칸을 겨눴습니다.`);
  },
  alkkagi: (r, p, api, prm) => {
    const pc = p.pieces[prm.idx];
    if (!pc || !onBoard(pc)) return '윷판 위의 내 말을 고르세요.';
    const foes = [];
    api.enemies(p).forEach(t => t.pieces.forEach((x, i) => { if (onBoard(x)) foes.push({ t, i, d: Math.abs(x.pos - pc.pos) }); }));
    if (!foes.length) return api.log('🫳 알까기 — 맞은 말이 없습니다.');
    foes.sort((a, b) => a.d - b.d);
    const hit = foes[0];
    if (api.rand(100) < 70) { api.capture(hit.t, [hit.i], p, '알까기'); api.log(`🫳 알까기 명중! ${hit.t.name}의 말이 튕겨 나갔습니다.`); }
    else api.log('🫳 알까기 — 살짝 빗나갔습니다.');
  },
  badook: (r, p, api) => {
    const mine = p.pieces.filter(onBoard).map(x => x.pos);
    const foeCells = [];
    api.enemies(p).forEach(t => t.pieces.forEach(x => { if (onBoard(x)) foeCells.push(x.pos); }));
    const hits = G.sandwiched(mine, foeCells);
    if (!hits.length) return api.log('⚫ 바둑 — 사이에 낀 말이 없습니다.');
    let n = 0;
    api.enemies(p).forEach(t => {
      const idx = t.pieces.map((x, i) => i).filter(i => hits.includes(t.pieces[i].pos));
      n += idx.length; if (idx.length) api.capture(t, idx, p, '바둑');
    });
    p.throws += n;
    api.log(`⚫ 바둑! ${n}개를 잡고 ${n}번 더 던집니다.`);
  },
  throwhit: (r, p, api, prm) => {
    const t = api.players().find(x => x.id === prm.playerId);
    if (!t || t === p) return '다른 사람을 고르세요.';
    t.skip = (t.skip || 0) + 2;
    api.log(`🪃 ${t.name}이(가) 윷에 맞아 두 번 쉽니다.`);
  },
  fog: (r, p, api) => { r.fog = 2; r.fogOwner = p.id; api.log('🌫️ 윷판에 안개가 꼈습니다.'); },
  handfast: (r, p, api, prm) => {
    const v = Math.max(-1, Math.min(5, prm.v | 0));
    F(p).forced = v;
    api.log(`✋ ${p.name}이(가) 다음 윷을 미리 정했습니다.`);
  },
  risky: (r, p, api) => {
    p.throws += 3; F(p).risky = true;
    api.log(`🍷 ${p.name}이(가) 던지기 기회 3번을 얻었습니다. 이번 차례에 모가 나오면 탈락합니다.`);
  },
  lastdance: (r, p, api) => {
    F(p).lastdance = true;
    api.log(`💃 ${p.name}의 마지막 춤 — 이번 차례 이동이 2배입니다.`);
  },
  rescue: (r, p, api, prm) => {
    const t = api.players().find(x => x.id === prm.playerId && x.eliminated);
    if (!t) return '탈락한 사람을 고르세요.';
    t.eliminated = false; t.health = t.health === 0 ? 1 : t.health;
    F(p).rescued = t.id;
    api.log(`🚑 ${p.name}이(가) ${t.name}을(를) 되살렸습니다.`);
  },
  marathoner: (r, p, api, prm) => {
    const i = p.pieces.findIndex((x, k) => (prm.idx != null ? k === prm.idx : true) && x.pos === -1);
    if (i < 0) return '아직 나오지 않은 말이 없습니다.';
    p.pieces[i].kind = 'marathoner';
    api.log(`🏃‍♀️ ${p.name}의 마라토너가 출발선에 섰습니다.`);
  },
  domain: (r, p, api, prm) => {
    const pc = p.pieces[prm.idx];
    if (!pc || !onBoard(pc)) return '윷판 위의 내 말을 고르세요.';
    pc.locked = true;
    F(p).domain = { idx: prm.idx, until: r.round + 2 };
    api.log(`🌐 ${p.name}이(가) 영역을 폈습니다. 두 차례를 버티면 승리합니다.`);
  },
  asplanned: (r, p, api, prm) => {
    const guess = prm.order || [];
    const real = api.alive().slice().sort((a, b) => G.progressOf(b) - G.progressOf(a)).map(x => x.id);
    const ok = guess.length === real.length && guess.every((id, i) => id === real[i]);
    if (ok) { r.winners = []; api.players().forEach(x => { x.rank = null; }); api.declareWin(p, '계획대로', 1); }
    else api.log(`📋 ${p.name}의 예상이 빗나갔습니다.`);
  },
  illusion: (r, p, api, prm) => {
    const t = api.players().find(x => x.id === prm.playerId);
    if (!t || t === p) return '다른 사람을 고르세요.';
    const list = (t.augs || []).filter(a => !a.spent && a.id !== 'cat');
    if (!list.length) return '바꿀 수 있는 증강이 없습니다.';
    const a = api.pick(list);
    a.catUntil = r.round + 3; a.wasId = a.id; a.id = 'cat';
    api.log(`🌀 ${t.name}의 증강 하나가 3라운드 동안 고양이가 되었습니다.`);
  }
};

/* ───────────────────────── 던지기 보정 ───────────────────────── */
export function rollFor(r, p) {
  const f = F(p);

  if (f.forced != null) { const v = f.forced; f.forced = null; return { ...G.YUT[v], forced: true, sticks: [] }; }

  if (f.sixyut) {
    const res = G.throwSticks(6);
    if (res.out) return res;
    return res;
  }
  if (f.twosword) {
    const a = G.throwSticks(2, { backdo: false }), b = G.throwSticks(2, { backdo: false });
    let v = (a.v || 0) + (b.v || 0);
    if (v === 0) v = 5;
    if (v > 5) v = 5;
    if (v === 5) v = 1;                       // 모 → 도
    return { ...G.YUT[v], sticks: [...a.sticks, ...b.sticks] };
  }
  if (f.moorado) {
    const v = G.rand(2) ? 5 : 1;
    return { ...G.YUT[v], sticks: [] };
  }
  if (f.stepbystep) {
    return { ...G.YUT[1], sticks: [], choices: [1, 2] };       // 도/개 중 고름
  }
  const n = f.sticks || 4;
  return G.throwSticks(n);
}

/* 던진 뒤 기록 — 특수 승리와 코인 */
export function afterRoll(r, p, res, api) {
  const f = F(p), s = S(p);
  s.throwsThisTurn ||= [];
  s.throwsThisTurn.push(res.v);

  if (f.doberman && res.name === '개') { p.coins.dog = (p.coins.dog || 0) + 1; }
  if (f.jajinmori && res.name === '걸') {
    s.geol = (s.geol || 0) + 1;
    if (s.geol % 2 === 0) { p.throws++; f.nextForced = 2; api.log(`🥁 자진모리 — ${p.name}이(가) 개를 하나 더 얻었습니다.`); }
  }
  if (f.winScore) {
    s.yutSeen ||= [];
    if (!s.yutSeen.includes(res.v)) s.yutSeen.push(res.v);
  }
  if (f.risky && res.name === '모') { api.eliminate(p, '위험한 선물'); return; }
  if (res.out) { api.eliminate(p, '과유불급'); return; }
  if (s.queenLives != null) {
    s.queenThrows = (s.queenThrows || 0) + 1;
    if (s.queenThrows >= 12) api.declareWin(p, '중전마마를 지켜냄');
  }
}

/* ───────────────────────── 이동 거리 보정 ───────────────────────── */
export function stepsFor(r, p, base) {
  const f = F(p);
  let s = base;
  if (f.vanguardBonus) s += (s > 0 ? 1 : -1);
  if (f.lastdance) s *= 2;
  return s;
}

/* 매 차례 시작 */
export function onTurnStart(r, p, api) {
  const f = F(p), s = S(p);
  s.throwsThisTurn = [];

  /* 선봉장이 판에 있으면 모든 이동 +1 */
  f.vanguardBonus = p.pieces.some(x => x.kind === 'vanguard' && onBoard(x));

  /* 폰은 던질 때마다 저절로 한 칸 */
  /* 명사수 예약 */
  if (f.sniper && r.round >= f.sniper.at) {
    const pos = f.sniper.pos; f.sniper = null;
    let n = 0;
    api.players().forEach(t => {
      const idx = t.pieces.map((x, i) => i).filter(i => t.pieces[i].pos === pos);
      n += idx.length; if (idx.length) api.capture(t, idx, p, '명사수');
    });
    api.log(`🎯 명사수 — ${pos}번 칸의 말 ${n}개가 사라졌습니다.`);
  }
  /* 합창단 박수 */
  if (s.claps != null) {
    const n = p.pieces.filter(x => x.kind === 'choir').length;
    s.claps += n;
    if (s.claps >= 12) api.declareWin(p, '합창단 완성');
  }
  /* 영역 전개 */
  if (f.domain && r.round >= f.domain.until) {
    const pc = p.pieces[f.domain.idx];
    if (pc && onBoard(pc)) api.declareWin(p, '영역 전개');
    else api.eliminate(p, '영역 전개 실패');
    f.domain = null;
  }
  /* 김첨지 */
  if (s.kimStart != null) {
    const k = p.pieces.find(x => x.kind === 'kimcheomji');
    if (k && k.pos === G.FINISH) api.declareWin(p, '김첨지 완주');
    else if (r.round - s.kimStart >= 6) { s.kimStart = null; api.log(`🚶 ${p.name}의 김첨지가 시간 안에 못 들어왔습니다.`); }
  }
  /* 승부다! */
  if (r.duel && r.round >= r.duel.until) {
    const t = api.players().find(x => x.id === r.duel.on);
    const by = api.players().find(x => x.id === r.duel.by);
    const done = t && t.pieces.some(x => x.pos === G.FINISH);
    if (done) api.eliminate(by, '승부에서 짐'); else if (t) api.eliminate(t, '승부에서 짐');
    r.duel = null;
  }
  /* 묶인 말 풀기 */
  p.pieces.forEach(x => { if (x.frozen > 0) x.frozen--; });
}

export function onTurnEnd(r, p, api) {
  const f = F(p), s = S(p);
  if (f.lastdance) { f.lastdance = false; api.eliminate(p, '라스트 댄스'); }
  if (f.risky) f.risky = false;
  if (f.winTriple7) {
    const t = s.throwsThisTurn || [];
    const cnt = {}; t.forEach(v => cnt[v] = (cnt[v] || 0) + 1);
    if (Object.values(cnt).some(n => n >= 3)) api.declareWin(p, '777');
  }
}

/* ───────────────────────── 잡기 ───────────────────────── */
export function onCapture(r, by, victim, n, api) {
  const f = F(by), s = S(by);
  s.captured = (s.captured || 0) + n;

  if (f.winStreak4 && s.captured >= 4) api.declareWin(by, '연승왕');
  if (f.winBackstep && r.lastWasBackdo) {
    s.backdoCaptures = (s.backdoCaptures || 0) + 1;
    if (s.backdoCaptures >= 2) api.declareWin(by, '소 뒷걸음질');
  }
  if (f.betrayal && G.progressOf(victim) > G.progressOf(by)) { by.throws++; api.log(`🏃 따라잡기 — ${by.name}이(가) 한 번 더 던집니다.`); }
  if (r.lifeOwner === by.id && victim.health != null) {
    victim.health--;
    api.log(`❤️ ${victim.name}의 체력이 ${victim.health} 남았습니다.`);
    if (victim.health <= 0) api.eliminate(victim, '체력 0');
  }
  /* 어부지리 — 잡힌 쪽이 내가 아닐 때 다른 사람들이 이득 */
  api.players().forEach(t => {
    if (t === by || t === victim) return;
    if (!F(t).fisherman) return;
    S(t).foeLost = (S(t).foeLost || 0) + n;
    while (S(t).foeLost >= 2) { S(t).foeLost -= 2; t.throws++; F(t).nextForced = 2; api.log(`🎣 어부지리 — ${t.name}이(가) 개를 얻었습니다.`); }
  });
  /* 나만 친구 없어 */
  const vf = F(victim);
  if (vf.winNoFriend) {
    const sv = S(victim); sv.caughtBy ||= [];
    if (!sv.caughtBy.includes(by.id)) sv.caughtBy.push(by.id);
    const others = api.alive().filter(x => x !== victim).map(x => x.id);
    if (others.length && others.every(id => sv.caughtBy.includes(id))) api.declareWin(victim, '나만 친구 없어');
  }
  /* 중전마마가 잡히면 탈락 */
  if (S(victim).queenLives != null && !victim.pieces.some(x => x.kind === 'queen' && onBoard(x))) {
    S(victim).queenLives--;
    if (S(victim).queenLives < 0) api.eliminate(victim, '중전마마를 잃음');
  }
}

/* ───────────────────────── 특수 승리 검사 ───────────────────────── */
export function checkSpecialWin(r, p, api) {
  const f = F(p);
  if (f.winSamok) {
    const pos = p.pieces.filter(onBoard).map(x => x.pos);
    const biggest = Math.max(0, ...pos.map(c => G.groupAt(p, c).length));
    if (G.hasFourInRow(pos) || biggest >= 4) return api.declareWin(p, '사목');
  }
  if (f.winScore) {
    const seen = S(p).yutSeen || [];
    if ([-1, 1, 2, 3, 4, 5].every(v => seen.includes(v))) return api.declareWin(p, '악보 완성');
  }
  if (f.winCatlover && api.players().some(t => (t.augs || []).some(a => a.id === 'cat'))) return api.declareWin(p, '애묘인');
  if (f.winOnlyOne) {
    let stacks = 0;
    api.players().forEach(t => { const seen = new Set(); t.pieces.forEach(x => { if (onBoard(x)) seen.add(x.pos); }); stacks += seen.size; });
    if (stacks === 1 && p.pieces.some(onBoard)) return api.declareWin(p, '천상천하 유아독존');
  }
  if (f.winGarlic && S(p).garlic >= 3) return api.declareWin(p, '웅녀');
  const mara = p.pieces.find(x => x.kind === 'marathoner');
  if (mara && mara.pos === G.FINISH) return api.declareWin(p, '마라토너 완주');
  return false;
}

/* ───────────────────────── 도우미 ───────────────────────── */
export const onBoard = x => x.pos >= 0 && x.pos !== G.FINISH;

function convert(r, p, kind, api) {
  const i = p.pieces.findIndex(x => x.kind === 'normal');
  if (i < 0) return api.log('바꿀 일반말이 없습니다.');
  p.pieces[i].kind = kind;
  api.log(`${p.name}의 말 하나가 ${G.PIECE_KIND[kind].label}이(가) 되었습니다.`);
}

export function addTile(r, type, owner) {
  r.tiles ||= [];
  const used = new Set(r.tiles.map(t => t.pos));
  let pos, guard = 0;
  do { pos = G.rand(G.RING); guard++; } while (used.has(pos) && guard < 40);
  r.tiles.push({ pos, type, owner });
  return pos;
}

export function rotateBoard(r, quarters, api) {
  api.players().forEach(t => t.pieces.forEach(x => { if (onBoard(x)) x.pos = G.rotatePos(x.pos, quarters); }));
  (r.tiles || []).forEach(t => { t.pos = G.rotatePos(t.pos, quarters); });
  r.rotation = ((r.rotation || 0) + quarters) % 4;
}

export function foldBoard(r, axis, api) {
  api.players().forEach(t => t.pieces.forEach(x => { if (onBoard(x)) x.pos = G.foldPos(x.pos, axis); }));
  (r.tiles || []).forEach(t => { t.pos = G.foldPos(t.pos, axis); });
  api.log(`📐 윷판이 접혔습니다. 말들의 자리가 뒤집혔습니다.`);
}

/* 말이 멈춘 칸의 타일 처리 */
export function steppedOn(r, p, piece, api) {
  const t = (r.tiles || []).find(x => x.pos === piece.pos);
  if (!t) return;
  if (t.type === 'garlic') {
    if (F(p).winGarlic) { S(p).garlic = (S(p).garlic || 0) + 1; api.log(`🧄 ${p.name}이(가) 마늘을 모았습니다. (${S(p).garlic}/3)`); }
    r.tiles = r.tiles.filter(x => x !== t);
  } else if (t.type === 'trap' && t.owner !== p.id) {
    api.sendHome(piece);
    api.log(`🎪 ${p.name}의 말이 함정에 걸려 돌아갔습니다.`);
    r.tiles = r.tiles.filter(x => x !== t);
  } else if (t.type === 'reward') {
    const m = G.travel(piece.pos, piece.route, 3);
    piece.pos = m.pos; piece.route = m.route;
    api.log(`🎁 ${p.name}의 말이 보상을 밟아 3칸 앞으로 갑니다.`);
    r.tiles = r.tiles.filter(x => x !== t);
  }
}

export const mudCells = r => new Set((r.tiles || []).filter(t => t.type === 'mud').map(t => t.pos));
