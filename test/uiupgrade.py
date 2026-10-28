"""윷가락 굴리기 · 조건 진행도 · 이동 미리보기 · 차례 띠 · 던지기 기회 · 확인 창을 확인한다."""
import subprocess, time, os, signal
from playwright.sync_api import sync_playwright

DIR = '/home/claude/yut/english_yut_battle_v3'
PORT = 3221
OUT = '/home/claude/yut/shots'
os.makedirs(OUT, exist_ok=True)

env = dict(os.environ, PORT=str(PORT), DATA_DIR='/tmp/yut-ui', TEACHER_PIN='t')
srv = subprocess.Popen(['node', 'server.js'], cwd=DIR, env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
time.sleep(1.6)
URL = f'http://localhost:{PORT}'
errors, results = [], []


def check(name, ok, detail=''):
    results.append((name, ok))
    print(('  OK  ' if ok else '  실패 ') + name + (' — ' + detail if detail else ''))


def turnPage(pages, host):
    tid = host.evaluate("() => S && S.players[S.turn] && S.players[S.turn].id")
    for pg in pages:
        if pg.evaluate("() => me && me.id") == tid:
            return pg
    return host


def clearOverlays(pages):
    """문제·증강·확인 창이 떠 있으면 치운다."""
    for pg in pages:
        try:
            if pg.locator('#ovConfirm:not([hidden])').count():
                pg.click('#cfYes', timeout=700)
            if pg.locator('#ovBattle:not([hidden])').count():
                if pg.locator('#btnGo:visible').count():
                    pg.click('#btnGo', timeout=700)
                else:
                    pg.click('.opt', timeout=700)
            if pg.locator('#ovChoose:not([hidden])').count():
                pg.click('.augCard', timeout=700)
        except Exception:
            pass


try:
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        pages = []
        for i in range(3):
            pg = br.new_context(viewport={'width': 1440, 'height': 900}).new_page()
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)
            pg.goto(URL); pages.append(pg)
            pg.evaluate("() => document.querySelectorAll('details.moreBox').forEach(d=>d.open=true)")
        host, b, c = pages

        host.fill('#myName', '6-1 김하늘'); host.click('[data-mode="full"]')
        host.click('#btnCreate'); host.wait_for_selector('#waiting.on', timeout=8000)
        code = host.inner_text('#waitCode').strip()
        for pg, nm in ((b, '6-1 이바다'), (c, '6-1 박나래')):
            pg.fill('#myName', nm); pg.fill('#roomCode', code); pg.click('#btnJoin')
            pg.wait_for_selector('#waiting.on', timeout=8000)
        host.click('#btnStart')

        host.wait_for_selector('#ovBattle:not([hidden])', timeout=9000)
        for pg in pages:
            try: pg.click('.opt', timeout=1500)
            except Exception: pass
        time.sleep(1.0)
        try: host.click('#btnGo', timeout=2500)
        except Exception: pass
        host.wait_for_selector('#ovChoose:not([hidden])', timeout=10000)
        time.sleep(0.5)

        # 기존 기능 — 가이드가 그대로 있는지
        check('(기존) 카드마다 「이럴 때 좋아요」',
              host.locator('.augCard .wh').count() == 3)
        check('(기존) 고르는 요령 상자', '뒤처졌다면' in host.inner_text('#chooseGuide'))

        for pg in pages:
            try: pg.click('.augCard', timeout=2500)
            except Exception: pass
        time.sleep(0.5)
        for pg in pages:
            try: pg.click('.augCard', timeout=1500)
            except Exception: pass
        host.wait_for_selector('#ovChoose[hidden]', timeout=12000, state='attached')
        time.sleep(0.8)

        # ── 차례 순서 띠 ──
        strip = host.inner_text('#turnStrip').replace('\n', ' ')
        big = host.evaluate("() => document.querySelectorAll('#turnStrip .tp.now').length")
        nxt = host.evaluate("() => document.querySelectorAll('#turnStrip .tp b.nx').length")
        check('차례 순서 띠', big == 1 and nxt >= 1 and '라운드' in strip, strip[:60])

        # ── 윷가락 굴리기 ──
        t = turnPage(pages, host)
        t.click('[data-throw]')
        time.sleep(0.35)
        rolling = t.locator('#yutRow i.tumble').count()
        name_mid = t.inner_text('#rollName')
        check('윷가락이 구르는 연출', rolling >= 4 and '구르는' in name_mid, f'가락 {rolling}개 · "{name_mid}"')
        t.screenshot(path=f'{OUT}/20_윷가락_구르는중.png')

        t.wait_for_selector('#yutRow i.land', timeout=4000)
        time.sleep(0.3)
        name_end = t.inner_text('#rollName')
        check('구르고 나서 결과가 뜸', '구르는' not in name_end and len(name_end) > 1, name_end)

        # ── 남은 던지기 기회 ──
        tl = t.inner_text('#throwsLeft').replace('\n', ' ')
        check('남은 던지기 기회 표시', '남은 던지기 기회' in tl, tl[:40])

        pv = t.evaluate("() => S.preview && {me: S.preview.player === me.id, n: S.preview.list.length}")
        check('서버가 미리보기를 보내 줌', bool(pv and pv['me']), str(pv))

        # ── 이동 미리보기 — 실제로 움직일 수 있는 상황이 나올 때까지 게임을 진행 ──
        found = None
        for _ in range(40):
            clearOverlays(pages)
            t = turnPage(pages, host)
            st = t.evaluate("() => S && S.status")
            if st != 'playing':
                break
            # 윷을 아직 안 던졌으면 던진다
            try:
                if t.locator('[data-throw]:visible').count():
                    t.click('[data-throw]'); time.sleep(1.45)
            except Exception:
                pass
            clearOverlays(pages)

            info = t.evaluate("""() => {
              if (!S.preview || !me || S.preview.player !== me.id) return null;
              const ok = S.preview.list.filter(v => !v.skip && !v.finish && v.to != null);
              return ok.length ? { i: ok[0].i, to: ok[0].to, own: !!ok[0].own } : null;
            }""")
            if info:
                found = (t, info); break

            # 못 움직이면 말을 아무거나 옮기거나 차례를 넘긴다
            moved = False
            try:
                if t.locator('#mePanel .pc.pick').count():
                    t.locator('#mePanel .pc.pick').first.click(timeout=700); moved = True
            except Exception:
                pass
            if not moved:
                try: host.evaluate("() => send('skipTurn', {})")
                except Exception: pass
            time.sleep(0.6)

        if found:
            t, info = found
            gos = t.eval_on_selector_all('#mePanel .pc .go', 'els=>els.map(e=>e.textContent.trim())')
            check('말마다 어디로 갈지 표시', any('→' in g for g in gos), ' / '.join(g for g in gos if g) or '없음')

            rings = t.evaluate("() => document.querySelectorAll('#board circle.dest').length")
            check('말판에 도착 자리 표시(눌러서 이동)', rings >= 1, f'{rings}곳')
            t.screenshot(path=f'{OUT}/21_이동미리보기.png')

            onBoard = t.evaluate("() => { const p=S.players.find(x=>x.id===me.id);"
                                 "return p.pieces.some(x=>x.pos>=0&&x.pos!==99); }")
            tappable = t.evaluate("() => document.querySelectorAll('#board [data-piece]').length")
            check('말판 위의 내 말을 누를 수 있음', (tappable >= 1) if onBoard else True,
                  f'{tappable}개' + ('' if onBoard else ' (아직 판에 말 없음)'))

            t.click(f"#mePanel [data-piece='{info['i']}']")
            time.sleep(0.5)
            if info['own']:
                shown = t.locator('#ovConfirm:not([hidden])').count() == 1
                check('내 말이 있는 칸이면 확인 창', shown,
                      t.inner_text('#cfKind') if shown else '안 뜸')
                if shown:
                    t.screenshot(path=f'{OUT}/23_업기_확인창.png')
                    t.click('#cfYes')
            else:
                check('내 말이 있는 칸이면 확인 창', True, '이번 상황은 빈 칸 (창 없음이 정상)')
            time.sleep(1.2)
            after = t.evaluate("(i) => { const p=S.players.find(x=>x.id===me.id); return p.pieces[i].pos; }", info['i'])
            check('미리 본 자리로 실제 이동', after == info['to'], f"예상 {info['to']}번 → 실제 {after}번")
        else:
            for nm in ('말마다 어디로 갈지 표시', '말판에 도착 자리 표시(눌러서 이동)',
                       '말판 위의 내 말을 누를 수 있음', '내 말이 있는 칸이면 확인 창',
                       '미리 본 자리로 실제 이동'):
                check(nm, False, '움직일 수 있는 상황을 못 만듦')

        # 겹쳐 뜬 창이 있으면 치우고 이어서 확인한다
        clearOverlays(pages)
        time.sleep(0.6)
        clearOverlays(pages)
        time.sleep(0.4)

        # ── 업기 확인 창 (상황을 만들어 직접 확인) ──
        t.evaluate("""() => {
          const my = S.players.find(p => p.id === me.id);
          my.pieces[0].pos = 3; my.pieces[0].route = 'outer';
          my.pieces[1].pos = 5; my.pieces[1].route = 'outer';
          S.preview = { player: me.id, steps: 2,
            list: [{ i:0, no:1, to:5, own:true, capture:0, movers:1 }] };
          render(); tryMove(0);
        }""")
        time.sleep(0.4)
        shown = t.locator('#ovConfirm:not([hidden])').count() == 1
        txt = (t.inner_text('#cfKind') + ' / ' + t.inner_text('#cfTitle') + ' / ' + t.inner_text('#cfSub')) if shown else ''
        check('내 말이 있는 칸이면 확인 창', shown and '2번 말이 있어요' in txt, txt[:90])
        if shown:
            t.screenshot(path=f'{OUT}/23_업기_확인창.png')
            t.click('#cfNo')
            time.sleep(0.3)
            check('「말 선택 바꾸기」로 닫힘', t.locator('#ovConfirm:not([hidden])').count() == 0)
        else:
            check('「말 선택 바꾸기」로 닫힘', False, '-')

        # ── 조건 진행도 (막대 · 칸 나눈 막대 · 다 쓴 도장) ──
        t.evaluate("""() => {
          const my = S.players.find(p => p.id === me.id);
          my.augs = [
            { id:'streak4', name:'연승왕', icon:'🏅',
              desc:'상대 말을 4개 이상 잡으면 승리합니다.', when:'공격 증강을 가지고 있을 때',
              group:'중간', rarity:'legend', kind:'passive', win:true, spent:false, uses:1,
              needs:'none', prog:{ now:2, goal:4, label:'상대 말 잡기' } },
            { id:'score', name:'악보', icon:'🎼', desc:'윷 여섯 가지를 모두 모으면 승리합니다.',
              when:'게임이 길어질 때', group:'윷', rarity:'legend', kind:'passive', win:true,
              spent:false, uses:1, needs:'none',
              prog:{ now:3, goal:6, label:'모은 윷', seg:true } },
            { id:'done', name:'다 쓴 증강', icon:'✅', desc:'이미 사용했습니다.', when:'-',
              group:'이동', rarity:'common', kind:'active', win:false, spent:true, uses:0,
              needs:'none', prog:null }
          ];
          render();
        }""")
        time.sleep(0.4)
        bars = t.locator('#mePanel .aug .prog').count()
        check('증강 칸에 진행 막대', bars == 2, f'{bars}개')
        segs = t.evaluate("() => document.querySelectorAll('#mePanel .aug .prog .segs i').length")
        on = t.evaluate("() => document.querySelectorAll('#mePanel .aug .prog .segs i.on').length")
        check('모으는 조건은 칸 나눈 막대', segs == 6 and on == 3, f'칸 {segs}개 중 {on}개 찼음')
        stamp = t.evaluate("""() => { const el=[...document.querySelectorAll('#mePanel .aug')]
          .find(e=>e.classList.contains('spent'));
          if(!el) return null;
          const s=getComputedStyle(el,'::after');
          return { txt:s.content, col:s.borderTopColor }; }""")
        check('다 쓴 증강에 도장', bool(stamp and '다 씀' in (stamp['txt'] or '')), str(stamp))

        t.evaluate("() => { ['ovChoose','ovBattle','ovConfirm'].forEach(k => $(k).hidden = true); }")
        t.locator('#mePanel .aug:not(.empty)').first.click()
        time.sleep(0.4)
        info2 = t.inner_text('#abilBody')
        check('설명창에도 진행도', '2/4' in info2 and '상대 말 잡기' in info2, info2.replace('\n', ' / ')[:80])
        t.screenshot(path=f'{OUT}/22_조건_진행도.png')
        t.click('#abilCancel')

        # 기존 기능 — 말 번호·업기·방 없애기
        nums = t.eval_on_selector_all('#mePanel .pc i', 'els=>els.map(e=>e.textContent.trim())')
        check('(기존) 말 번호 그대로', nums == [str(i + 1) for i in range(len(nums))], ','.join(nums))
        check('(기존) 방 없애기 메뉴', t.locator('#mnKill').count() == 1)

        br.close()
finally:
    srv.send_signal(signal.SIGTERM); time.sleep(0.4); srv.kill()
    err = srv.stderr.read().decode()[-600:] if srv.stderr else ''

print('\n' + '─' * 52)
bad = [r for r in results if not r[1]]
print(f'{len(results) - len(bad)} / {len(results)} 통과')
real = [e for e in errors if 'favicon' not in e and 'TUNNEL' not in e]
print('브라우저 오류:', sorted(set(real))[:5] if real else '없음')
if err.strip(): print('서버 stderr:', err[-300:])
