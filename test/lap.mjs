/* 한 바퀴 돈 말(깃발) 규칙을 엔진에서 직접 확인한다. */
import { travel, remain, nextNode } from '../game.js';

let pass = 0, fail = 0;
const ok = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log(`  실패 ${name} — ${g} (기대: ${w})`); }
};

ok('도(1)에서 백도 → 출발지에 깃발', travel(1, 'outer', -1), { pos: 0, route: 'lap' });
ok('깃발 말이 도 → 완주', travel(0, 'lap', 1), { pos: 99, route: 'done' });
ok('깃발 말이 모 → 완주', travel(0, 'lap', 5), { pos: 99, route: 'done' });
ok('깃발 말이 백도 → 맨 뒷칸', travel(0, 'lap', -1), { pos: 19, route: 'outer' });
ok('집에 있는 말은 백도로 못 나감', travel(-1, 'outer', -1), { pos: -1, route: 'outer' });
ok('집에서 걸 → 2번 칸 (깃발 없음)', travel(-1, 'outer', 3), { pos: 2, route: 'outer' });
ok('막 나온 출발지 말은 깃발 없음', travel(-1, 'outer', 1).route, 'outer');
ok('깃발 말의 남은 거리 = 1', remain(0, 'lap'), 1);
ok('갓 나온 출발지 말의 남은 거리 = 20', remain(0, 'outer'), 20);
ok('19에서 도 → 완주', travel(19, 'outer', 1), { pos: 99, route: 'done' });
ok('2에서 백도 → 1번 칸 (깃발 없음)', travel(2, 'outer', -1), { pos: 1, route: 'outer' });
ok('5에 정확히 서면 지름길 A', travel(3, 'outer', 2), { pos: 5, route: 'A' });
ok('5를 지나가면 바깥길 그대로', travel(3, 'outer', 3), { pos: 6, route: 'outer' });
ok('깃발 말 다음 칸은 도착', nextNode(0, 'lap'), { pos: 99, route: 'done' });

console.log('\n' + '─'.repeat(44));
console.log(`${pass} / ${pass + fail} 통과`);
process.exit(fail ? 1 : 0);
