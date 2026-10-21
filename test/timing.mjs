import { spawn } from 'child_process';
import { io } from 'socket.io-client';
const DIR='/home/claude/yut/english_yut_battle_v3', PORT=3177;
const srv=spawn('node',['server.js'],{cwd:DIR,env:{...process.env,PORT,DATA_DIR:'/tmp/yut-t',TEACHER_PIN:'t',YUT_DEBUG:'1'},stdio:'inherit'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const URL=`http://localhost:${PORT}`;
await sleep(900);
const ps=['가','나','다','라'].map(n=>{const s=io(URL,{transports:['websocket']});const p={s,name:n,id:null,state:null};s.on('state',st=>p.state=st);return p;});
await Promise.all(ps.map(p=>new Promise(r=>p.s.on('connect',r))));
const ask=(p,e,d)=>new Promise(r=>p.s.emit(e,d,r));
let res=await ask(ps[0],'create',{name:'가',mode:process.argv[2]||'simple',pieceCount:+(process.argv[3]||2)});
ps[0].id=res.id; const code=res.code;
for(const p of ps.slice(1)){const r2=await ask(p,'join',{code,name:p.name});p.id=r2.id;}
await sleep(100); const t0=Date.now(); await ask(ps[0],'start',{});
let lastRound=0, marks=[], phase={}, lastPhase=null, lastT=Date.now();
const end=Date.now()+60000;
while(Date.now()<end){
  const st=ps[0].state; if(!st){await sleep(30);continue;}
  const ph = st.status==='finished' ? 'finished' : st.pending?.kind || 'turn';
  if(ph!==lastPhase){ if(lastPhase) phase[lastPhase]=(phase[lastPhase]||0)+(Date.now()-lastT); lastPhase=ph; lastT=Date.now(); }
  if(st.status==='finished'){marks.push(['끝',Date.now()-t0]);break;}
  if(st.round>lastRound){lastRound=st.round;marks.push([st.round+'라운드',Date.now()-t0]);}
  const pd=st.pending;
  if(pd?.kind==='battle'||pd?.kind==='capture'){
    for(const p of ps){ if((pd.answered||[]).includes(p.id))continue;
      if(pd.kind==='capture'&&p.id!==pd.attacker&&p.id!==pd.defender)continue;
      await ask(p,'answer',{index:0}); }
    if(pd.canContinue) await ask(ps[0],'continue',{});
    await sleep(25); continue;
  }
  if(pd?.kind==='choose'){
    for(const p of ps){const o=pd.offers?.[p.id]; if(!o||(pd.picked||[]).includes(p.id))continue;
      await ask(p,'choose',{id:o[0].id});}
    await sleep(25); continue;
  }
  const turn=st.players[st.turn]; const p=ps.find(x=>x.id===turn?.id);
  if(!p){await sleep(30);continue;}
  if(st.roll?.choices){await ask(p,'throw',{choose:1});await sleep(20);continue;}
  if(!st.roll&&(turn.throws||0)>0){await ask(p,'throw',{});await sleep(20);continue;}
  if(st.roll){
    const mv=turn.pieces.map((x,i)=>({x,i})).filter(z=>z.x.pos!==99&&!z.x.frozen&&!z.x.locked&&z.x.kind!=='pawn'&&!(st.roll.v<0&&z.x.pos<0));
    if(!mv.length){await ask(ps[0],'skipTurn',{});await sleep(30);continue;}
    await ask(p,'move',{piece:mv[0].i}); await sleep(20); continue;
  }
  await sleep(40);
}
if(lastPhase) phase[lastPhase]=(phase[lastPhase]||0)+(Date.now()-lastT);
console.log('구간별 시각(초):', marks.map(([n,t])=>`${n} ${(t/1000).toFixed(1)}`).join(' | '));
console.log('단계별 누적 시간(초):', Object.entries(phase).map(([k,v])=>`${k} ${(v/1000).toFixed(1)}`).join(' · '));
const st=ps[0].state;
const rows=(st?.players||[]).slice().sort((a,b)=>(a.rank||99)-(b.rank||99));
console.log('최종 순위:', rows.map(x=>`${x.rank}위 ${x.name}(${x.winReason||'-'})`).join(', '));
const rk=rows.map(x=>x.rank);
const dupOK = rows.filter(x=>x.winReason==='함께 승리').length;
const dups = rk.filter((v,i)=>rk.indexOf(v)!==i).length;
if(dups>dupOK) console.log('⚠️ 설명되지 않는 중복 순위', dups-dupOK, '건');
if(rk.some(x=>!x)) console.log('⚠️ 순위가 비어 있는 사람 있음');
if(st?.status!=='finished') console.log('⚠️ 끝나지 않음 (라운드', st?.round, ')');
srv.kill(); process.exit(0);
