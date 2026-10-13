/* ============================================================
   English Yut Battle — 윷놀이 규칙 엔진 (순수 함수)
   서버와 테스트가 함께 쓴다. 화면/통신 코드는 들어가지 않는다.
   ============================================================ */
import crypto from 'crypto';

export const rand = n => crypto.randomInt(n);

/* ---------- 말판 ----------
   바깥 20칸(0~19), 모서리는 0·5·10·15.
   0번이 출발이자 도착 지점이다. 말은 0 → 1 → … → 19 → 도착 순서로 반시계 방향으로 돈다.

   지름길 A: 5번 모서리 → 20 → 21 → 22(방) → 23 → 24 → 15번으로 합류
   지름길 B: 10번 모서리 → 25 → 26 → 22(방) → 27 → 28 → 도착
   22번(방)은 두 지름길이 만나는 한가운데 칸이다.                       */
export const RING = 20;
export const FINISH = 99;
export const CENTER = 22;
export const SC_A = [20, 21, 22, 23, 24];
export const SC_B = [25, 26, 22, 27, 28];

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

export const CORNERS = [0, 5, 10, 15];

/* ---------- 윷 던지기 ----------
   윷가락 4개를 각각 던진다. 평평한 면이 몇 개 나왔는지로 결정한다.
   도 4/16, 개 6/16, 걸 4/16, 윷 1/16, 모 1/16 — 실제 윷과 같은 확률. */
export const YUT = [
  null,
  { v: 1, name: '도', animal: '돼지', en: 'pig',   emoji: '🐷' },
  { v: 2, name: '개', animal: '개',   en: 'dog',   emoji: '🐶' },
  { v: 3, name: '걸', animal: '양',   en: 'sheep', emoji: '🐑' },
  { v: 4, name: '윷', animal: '소',   en: 'cow',   emoji: '🐮' },
  { v: 5, name: '모', animal: '말',   en: 'horse', emoji: '🐴' }
];

export function throwSticks() {
  const sticks = [0, 0, 0, 0].map(() => rand(2));   // 1 = 평평한 면
  const flat = sticks.reduce((a, b) => a + b, 0);
  const v = flat === 0 ? 5 : flat;                  // 전부 둥근 면이면 모
  return { sticks, ...YUT[v] };
}

/* ---------- 한 칸 이동 ---------- */
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

/* ---------- 여러 칸 이동 ----------
   전통 규칙: 모서리에 '정확히 멈췄을 때만' 지름길로 들어간다.
   지나가기만 한 말은 바깥길을 계속 돈다.
   방(중앙)에 정확히 멈추면 도착으로 가는 가장 짧은 길로 빠진다. */
export function travel(pos, route, steps) {
  let at = pos, rt = route || 'outer';
  for (let k = 0; k < steps; k++) {
    if (at === FINISH) break;
    const n = nextNode(at, rt);
    at = n.pos; rt = n.route;
    if (at === FINISH) break;
  }
  if (at !== FINISH) {
    if (rt === 'outer' && at === 5) rt = 'A';        // 5번에 멈췄다 → 다음 턴에 지름길
    else if (rt === 'outer' && at === 10) rt = 'B';
    else if (at === CENTER) rt = 'B';                // 방에 멈췄다 → 도착 쪽 지름길
  }
  return { pos: at, route: rt };
}

/* 말이 지나갈 칸들을 미리 계산한다. 화면에서 한 칸씩 뛰어가는 애니메이션에 쓴다. */
export function pathOf(pos, route, steps) {
  const out = [];
  let at = pos, rt = route || 'outer';
  for (let k = 0; k < steps; k++) {
    if (at === FINISH) break;
    const n = nextNode(at, rt);
    at = n.pos; rt = n.route;
    out.push(at);
    if (at === FINISH) break;
  }
  return out;
}

/* 완주까지 남은 칸 수 — 누가 앞서는지 재는 데 쓴다 (역전 보정·순위 표시) */
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
