/* ============================================================
   English Yut Battle v3 — 윷놀이 규칙 엔진 (순수 함수)
   서버와 테스트가 함께 쓴다. 화면/통신 코드는 들어가지 않는다.
   ============================================================ */
import crypto from 'crypto';

export const rand = n => crypto.randomInt(n);
export const pick = arr => arr[rand(arr.length)];

/* ---------- 말판 ----------
   바깥 20칸(0~19), 모서리는 0·5·10·15.
   0번이 출발이자 도착 지점이다. 말은 0 → 1 → … → 19 → 도착 순서로 돈다.

   지름길 A: 5번 모서리 → 20 → 21 → 22(방) → 23 → 24 → 15번으로 합류
   지름길 B: 10번 모서리 → 25 → 26 → 22(방) → 27 → 28 → 도착
   22번(방)은 두 지름길이 만나는 한가운데 칸이다.                       */
export const RING = 20;
export const FINISH = 99;
export const CENTER = 22;
export const SC_A = [20, 21, 22, 23, 24];
export const SC_B = [25, 26, 22, 27, 28];
export const CORNERS = [0, 5, 10, 15];

/* 화면 좌표 (0~5 격자). 서버가 클라이언트에 그대로 내려 주므로
   말판 좌표가 양쪽에 따로 적혀 어긋나는 일이 없다. */
export const COORD = (() => {
  const c = {};
  for (let i = 0; i < 5; i++) c[i] = [5, 5 - i];        // 0~4  오른쪽 변 (위로)
  for (let i = 0; i < 5; i++) c[5 + i] = [5 - i, 0];    // 5~9  위쪽 변 (왼쪽으로)
  for (let i = 0; i < 5; i++) c[10 + i] = [0, i];       // 10~14 왼쪽 변 (아래로)
  for (let i = 0; i < 5; i++) c[15 + i] = [i, 5];       // 15~19 아래쪽 변 (오른쪽으로)
  c[20] = [4, 1]; c[21] = [3, 2]; c[22] = [2.5, 2.5]; c[23] = [2, 3]; c[24] = [1, 4];
  c[25] = [1, 1]; c[26] = [2, 2]; c[27] = [3, 3]; c[28] = [4, 4];
  return c;
})();

/* 일직선으로 이어진 칸들 — '사목'과 '바둑'이 쓴다. */
export const LINES = [
  [0, 1, 2, 3, 4, 5],                      // 오른쪽 변
  [5, 6, 7, 8, 9, 10],                     // 위쪽 변
  [10, 11, 12, 13, 14, 15],                // 왼쪽 변
  [15, 16, 17, 18, 19, 0],                 // 아래쪽 변
  [5, 20, 21, 22, 23, 24, 15],             // 대각선 A
  [10, 25, 26, 22, 27, 28, 0]              // 대각선 B
];

/* ---------- 윷 던지기 ----------
   윷가락 4개를 각각 던진다. 평평한 면이 몇 개인지로 결정한다.
   도 4/16, 개 6/16, 걸 4/16, 윷 1/16, 모 1/16 — 실제 윷과 같은 확률.
   윷가락 하나에는 표시가 있어, 평평한 면이 그것 하나뿐이면 '백도'(뒤로 한 칸)다. */
export const YUT = {
  '-1': { v: -1, name: '백도', animal: '쥐',   en: 'mouse', emoji: '🐭', back: true },
  1:    { v: 1,  name: '도',   animal: '돼지', en: 'pig',   emoji: '🐷' },
  2:    { v: 2,  name: '개',   animal: '개',   en: 'dog',   emoji: '🐶' },
  3:    { v: 3,  name: '걸',   animal: '양',   en: 'sheep', emoji: '🐑' },
  4:    { v: 4,  name: '윷',   animal: '소',   en: 'cow',   emoji: '🐮' },
  5:    { v: 5,  name: '모',   animal: '말',   en: 'horse', emoji: '🐴' },
  0:    { v: 0,  name: '꽝',   animal: '－',   en: 'none',  emoji: '💨' }
};

/* n개의 윷가락을 던진다. 0번 가락이 '표시된' 가락이다.
   backdo=false 로 두면 백도가 나오지 않는다(이도류 합산 등 내부 계산용). */
export function throwSticks(n = 4, { backdo = true } = {}) {
  const sticks = Array.from({ length: n }, () => rand(2));   // 1 = 평평한 면
  return readSticks(sticks, { backdo });
}

export function readSticks(sticks, { backdo = true } = {}) {
  const n = sticks.length;
  const flat = sticks.reduce((a, b) => a + b, 0);
  let v;
  if (n === 6) {
    if (flat === 6) v = 'out';                 // 과유불급 — 앞면 6개면 탈락
    else if (flat === 0) v = 5;                // 모
    else if (flat === 5) v = 4;                // 윷
    else v = flat;                             // 1~4 → 도·개·걸·윷
  } else {
    v = flat === 0 ? n + 1 : flat;             // 전부 둥근 면이면 모
    if (v > 5) v = 5;
  }
  if (v === 'out') return { sticks, out: true, ...YUT[0], name: '탈락', v: 0 };
  if (backdo && flat === 1 && sticks[0] === 1) v = -1;        // 표시된 가락만 평평 → 백도
  return { sticks, ...YUT[v] };
}

/* ---------- 한 칸 앞으로 ---------- */
export function nextNode(pos, route) {
  if (pos === -1) return { pos: 0, route: 'outer' };          // 출발점에 올려놓기

  if (route === 'A') {
    if (pos === 5) return { pos: SC_A[0], route: 'A' };
    const i = SC_A.indexOf(pos);
    if (i >= 0 && i < SC_A.length - 1) return { pos: SC_A[i + 1], route: 'A' };
    if (i === SC_A.length - 1) return { pos: 15, route: 'outer' };
  }
  if (route === 'B') {
    if (pos === 10) return { pos: SC_B[0], route: 'B' };
    const i = SC_B.indexOf(pos);
    if (i >= 0 && i < SC_B.length - 1) return { pos: SC_B[i + 1], route: 'B' };
    if (i === SC_B.length - 1) return { pos: FINISH, route: 'done' };
  }
  const n = pos + 1;
  if (n >= RING) return { pos: FINISH, route: 'done' };
  return { pos: n, route: 'outer' };
}

/* ---------- 한 칸 뒤로 (백도) ---------- */
export function prevNode(pos, route) {
  if (pos === -1 || pos === FINISH) return { pos, route };
  if (route === 'A') {
    const i = SC_A.indexOf(pos);
    if (i > 0) return { pos: SC_A[i - 1], route: 'A' };
    if (i === 0) return { pos: 5, route: 'outer' };
  }
  if (route === 'B') {
    const i = SC_B.indexOf(pos);
    if (i > 0) return { pos: SC_B[i - 1], route: 'B' };
    if (i === 0) return { pos: 10, route: 'outer' };
  }
  const n = pos - 1;
  if (n < 0) return { pos: RING - 1, route: 'outer' };        // 0번에서 백도 → 맨 뒤로
  return { pos: n, route: 'outer' };
}

/* ---------- 여러 칸 이동 ----------
   전통 규칙: 모서리에 '정확히 멈췄을 때만' 지름길로 들어간다.
   지나가기만 한 말은 바깥길을 계속 돈다.
   방(중앙)에 정확히 멈추면 도착으로 가는 가장 짧은 길로 빠진다.
   steps 가 음수면 백도처럼 뒤로 간다. reverse=true 면 '달걸음'처럼 방향이 뒤집힌다. */
export function travel(pos, route, steps, { reverse = false, stopAt = null } = {}) {
  const back = (steps < 0) !== reverse;
  const n = Math.abs(steps);
  let at = pos, rt = route || 'outer';
  if (back && at === -1) return { pos: -1, route: 'outer' };  // 아직 안 나온 말은 뒤로 못 간다

  for (let k = 0; k < n; k++) {
    if (at === FINISH) break;
    const nx = back ? prevNode(at, rt) : nextNode(at, rt);
    at = nx.pos; rt = nx.route;
    if (at === FINISH) break;
    if (stopAt && stopAt.has(at)) break;                      // 진흙을 밟으면 거기서 멈춘다
  }
  if (at !== FINISH && !back) {
    if (rt === 'outer' && at === 5) rt = 'A';
    else if (rt === 'outer' && at === 10) rt = 'B';
    else if (at === CENTER) rt = 'B';
  }
  return { pos: at, route: rt };
}

/* 말이 지나갈 칸들 — 화면에서 한 칸씩 뛰어가는 애니메이션에 쓴다. */
export function pathOf(pos, route, steps, opts = {}) {
  const back = (steps < 0) !== !!opts.reverse;
  const n = Math.abs(steps);
  const out = [];
  let at = pos, rt = route || 'outer';
  if (back && at === -1) return out;
  for (let k = 0; k < n; k++) {
    if (at === FINISH) break;
    const nx = back ? prevNode(at, rt) : nextNode(at, rt);
    at = nx.pos; rt = nx.route;
    out.push(at);
    if (at === FINISH) break;
    if (opts.stopAt && opts.stopAt.has(at)) break;
  }
  return out;
}

/* ---------- 거리 ---------- */
export function remain(pos, route) {
  if (pos === FINISH) return 0;
  let at = pos, rt = route || 'outer', n = 0;
  while (at !== FINISH && n < 40) { const x = nextNode(at, rt); at = x.pos; rt = x.route; n++; }
  return n;
}

export function progressOf(player) {
  return player.pieces.reduce((sum, p) => sum + (RING - remain(p.pos, p.route)), 0);
}

/* ---------- 업기 ----------
   같은 칸에 있는 내 말들은 하나로 묶여 함께 움직인다. */
export function groupAt(player, pos) {
  if (pos < 0 || pos === FINISH) return [];
  return player.pieces.map((p, i) => ({ p, i })).filter(x => x.p.pos === pos && x.p.route !== 'done');
}

/* ---------- 판 돌리기 / 접기 ----------
   바깥 20칸만 움직인다. 안쪽 지름길 말은 제자리에 둔다. */
export function rotatePos(pos, quarters) {
  if (pos < 0 || pos >= RING) return pos;
  return (pos + 5 * quarters + RING) % RING;
}

/* axis 0~3 : 어느 모서리를 기준으로 접을지. 바깥 칸을 거울처럼 뒤집는다. */
export function foldPos(pos, axis) {
  if (pos < 0 || pos >= RING) return pos;
  const a = axis * 5;
  return ((2 * a - pos) % RING + RING) % RING;
}

/* ---------- 사목 ----------
   내 말이 일직선으로 이어진 네 칸을 차지했는지 본다. */
export function hasFourInRow(positions) {
  const set = new Set(positions.filter(p => p >= 0 && p !== FINISH));
  for (const line of LINES) {
    let run = 0;
    for (const cell of line) {
      run = set.has(cell) ? run + 1 : 0;
      if (run >= 4) return true;
    }
  }
  return false;
}

/* ---------- 바둑 ----------
   일직선 위에서 내 두 말뭉치 사이에 낀 상대 칸들을 찾는다. */
export function sandwiched(myPositions, enemyPositions) {
  const mine = new Set(myPositions.filter(p => p >= 0 && p !== FINISH));
  const foe = new Set(enemyPositions.filter(p => p >= 0 && p !== FINISH));
  const caught = new Set();
  for (const line of LINES) {
    for (let i = 0; i < line.length; i++) {
      if (!mine.has(line[i])) continue;
      for (let j = i + 2; j < line.length; j++) {
        if (!mine.has(line[j])) continue;
        const between = line.slice(i + 1, j);
        if (between.length && between.every(c => foe.has(c))) between.forEach(c => caught.add(c));
        break;
      }
    }
  }
  return [...caught];
}

/* ---------- 말 종류 ----------
   kind 가 'normal' 이 아닌 말은 움직이는 방식이나 승리 조건이 다르다. */
export const PIECE_KIND = {
  normal:     { label: '말',       icon: '●'  },
  dokkaebi:   { label: '도깨비',   icon: '👺' },
  vanguard:   { label: '선봉장',   icon: '🚩' },
  cannon:     { label: '포',       icon: '🏹' },
  pawn:       { label: '폰',       icon: '♟️' },
  kimcheomji: { label: '김첨지',   icon: '🚶' },
  queen:      { label: '중전마마', icon: '👸' },
  marathoner: { label: '마라토너', icon: '🏃‍♀️' },
  choir:      { label: '합창단원', icon: '🎵' }
};

export function newPiece(kind = 'normal') {
  return { pos: -1, route: 'outer', kind, shield: 0, frozen: 0, locked: false };
}
