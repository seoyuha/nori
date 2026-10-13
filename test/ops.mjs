import { io } from 'socket.io-client';
const URL='http://localhost:3100';
const ask=(s,ev,d)=>new Promise(r=>s.emit(ev,d,x=>r(x)));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const mk=()=>io(URL,{transports:['websocket']});

const a=mk(),b=mk(),t=mk();
let aS=null,bS=null; a.on('state',s=>aS=s); b.on('state',s=>bS=s);
let rooms=null; t.on('rooms',l=>rooms=l);
await sleep(500);

const c=await ask(a,'create',{name:'가영',mode:'full',pieceCount:2});
const j=await ask(b,'join',{code:c.code,name:'나영'});
await ask(a,'start',{});
await sleep(400);
console.log('방 생성·시작:', aS.status==='playing'?'✓':'✗');

// 교사 로그인
const tl=await ask(t,'teacher:login',{pin:'1234'});
console.log('교사 로그인:', tl.ok?'✓':'✗ '+tl.error);
console.log('교사가 보는 방 수:', tl.rooms.length, '| 정답률 표시:', tl.rooms[0]?.players[0]?.total!==undefined?'✓':'✗');

// 일시정지
await ask(t,'teacher:pause',{code:c.code});
await sleep(300);
console.log('일시정지:', aS.paused?'✓':'✗');
const blocked=await ask(a,'throw',{});
console.log('멈춤 중 던지기 차단:', !blocked.ok?'✓':'✗');
await ask(t,'teacher:pause',{code:c.code});
await sleep(300);
console.log('재개:', !aS.paused?'✓':'✗');

// 내 차례가 아닌 학생이 던지기 시도
const wrongTurn = aS.players[aS.turn].id===j.id ? a : b;
const r2=await ask(wrongTurn,'throw',{});
console.log('남의 차례 던지기 차단:', !r2.ok?'✓ ('+r2.error+')':'✗');

// 재접속
const code=c.code,id=j.id;
b.close(); await sleep(400);
console.log('연결 끊김 표시:', aS.players.find(p=>p.id===id)?.connected===false?'✓':'✗');
const b2=mk(); let b2S=null; b2.on('state',s=>b2S=s);
await sleep(300);
const rj=await ask(b2,'rejoin',{code,id});
await sleep(300);
console.log('재접속:', rj.ok && b2S?.code===code?'✓':'✗');
console.log('재접속 후 연결 표시:', b2S.players.find(p=>p.id===id)?.connected?'✓':'✗');

// 방별 문제은행
const up=await fetch(`${URL}/api/questions?room=${code}`,{method:'POST',headers:{'x-teacher-pin':'1234'},
  body:await (await import('fs')).promises.readFile('/tmp/claude-0/-home-claude/26ac3424-1b12-527c-846d-d84ac0cdd7e9/scratchpad/korean_cols.xlsx')});
const upd=await up.json();
console.log('방별 문제은행 교체:', upd.ok&&upd.scope===code?'✓ ('+upd.count+'문제)':'✗');

console.log('\n저장 파일 확인용 방 코드:',code);
[a,t,b2].forEach(x=>x.close());
process.exit(0);
