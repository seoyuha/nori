"""초시계 · 증강 예/아니오 · 한 바퀴 깃발 · 학생 자동 배정을 확인한다."""
import subprocess, time, os, signal, json, urllib.request
from playwright.sync_api import sync_playwright

DIR = '/home/claude/yut/english_yut_battle_v3'
PORT = 3233
OUT = '/home/claude/yut/shots'
PIN = 'tpin'
os.makedirs(OUT, exist_ok=True)

env = dict(os.environ, PORT=str(PORT), DATA_DIR='/tmp/yut-newui', TEACHER_PIN=PIN)
subprocess.run(['rm', '-rf', '/tmp/yut-newui'])
srv = subprocess.Popen(['node', 'server.js'], cwd=DIR, env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
time.sleep(1.6)
URL = f'http://localhost:{PORT}'
errors, results = [], []
OPEN = "() => document.querySelectorAll('details.moreBox').forEach(d=>d.open=true)"


def check(name, ok, detail=''):
    results.append((name, ok))
    print(('  OK  ' if ok else '  실패 ') + name + (' — ' + detail if detail else ''))


def api(path, method='POST', body=b''):
    req = urllib.request.Request(URL + path, data=body, method=method,
                                 headers={'x-teacher-pin': PIN, 'content-type': 'application/octet-stream'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


try:
    # ── 수업 만들기 (모둠 3명씩) ──
    from urllib.parse import quote
    cls = api('/api/class?name=' + quote('6-1 자동배정 시험') + '&size=3&mode=full&pieces=2')
    check('수업에 모둠 인원 저장', cls.get('size') == 3 and cls.get('pieces') == 2,
          f"{cls.get('size')}명씩 · 말 {cls.get('pieces')}개")
    code = cls['code']

    with sync_playwright() as pw:
        br = pw.chromium.launch()
        link = f'{URL}/?class={code}'

        def student(nm):
            pg = br.new_context(viewport={'width': 1440, 'height': 900}).new_page()
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)
            pg.goto(link)
            pg.wait_for_selector('#btnAuto', timeout=8000)
            pg.fill('#myName', nm)
            pg.click('#btnAuto')
            return pg

        hint = None
        kids = []
        for i, nm in enumerate(['6-1 김하늘', '6-1 이바다', '6-1 박나래', '6-1 최가람']):
            pg = student(nm)
            if i == 0:
                pg.wait_for_selector('#waiting.on', timeout=8000)
                hint = pg.inner_text('#waitInfo')
            kids.append(pg)
            time.sleep(0.6)

        check('이름만 쓰고 모둠에 들어감', '더 들어오면' in (hint or ''), hint or '')

        time.sleep(1.8)
        codes = [k.evaluate("() => S && S.code") for k in kids]
        check('앞의 3명이 같은 모둠', codes[0] == codes[1] == codes[2] and codes[0], ' / '.join(map(str, codes)))
        check('정원이 차면 저절로 시작',
              kids[0].evaluate("() => S && S.status") == 'playing',
              kids[0].evaluate("() => S && S.status"))
        check('4번째 학생은 새 모둠', codes[3] and codes[3] != codes[0], f'{codes[0]} → {codes[3]}')
        check('새 모둠은 아직 대기', kids[3].evaluate("() => S && S.status") == 'waiting')

        a, b, c = kids[0], kids[1], kids[2]
        for pg in (a, b, c):
            try: pg.click('.opt', timeout=2500)
            except Exception: pass
        time.sleep(1.0)
        try: a.click('#btnGo', timeout=2500)
        except Exception: pass
        a.wait_for_selector('#ovChoose:not([hidden])', timeout=10000)
        # 전원 선택 + 정답자 추가 선택이 끝날 때까지 눌러 준다
        for _ in range(10):
            left = 0
            for pg in (a, b, c):
                if pg.locator('#ovChoose:not([hidden])').count():
                    left += 1
                    try: pg.click('.augCard', timeout=1200)
                    except Exception: pass
            if not left:
                break
            time.sleep(0.8)
        time.sleep(0.8)

        # ── 초시계 ──
        box = a.evaluate("""() => {
          const c = document.getElementById('clock');
          if (!c || c.hidden) return null;
          const r = c.getBoundingClientRect();
          const bar = document.querySelector('.topBar');
          return { top: Math.round(r.top), w: Math.round(r.width),
                   inBar: !!(bar && bar.contains(c)),
                   num: document.getElementById('clockNum').textContent,
                   hand: !!document.getElementById('clockHand') };
        }""")
        check('초시계가 화면 위에 보임', bool(box and box['inBar'] and box['top'] < 160),
              str(box))
        check('초시계에 바늘과 숫자', bool(box and box['hand'] and box['num'].isdigit()),
              f"남은 {box['num']}초" if box else '-')
        num = lambda: int(a.evaluate("() => document.getElementById('clockNum').textContent"))
        n1 = num(); time.sleep(2.2); n2 = num()
        check('초가 줄어듦', n2 < n1, f'{n1}초 → {n2}초')
        a.screenshot(path=f'{OUT}/24_초시계.png')

        # ── 한 바퀴 돈 말 깃발 ──
        a.evaluate("""() => {
          const my = S.players.find(p => p.id === me.id);
          my.pieces[0].pos = 0; my.pieces[0].route = 'lap';
          if (my.pieces[1]) { my.pieces[1].pos = 3; my.pieces[1].route = 'outer'; }
          render();
        }""")
        time.sleep(0.4)
        rowTxt = a.inner_text('#mePanel .pcs').replace('\n', ' ')
        check('말 칸에 깃발과 「한 바퀴」', '🚩' in rowTxt and '한 바퀴' in rowTxt, rowTxt[:60])
        boardFlag = a.evaluate("() => document.querySelectorAll('#board path[fill=\"#E3B949\"]').length")
        check('말판 위 말에 노란 깃발', boardFlag >= 1, f'{boardFlag}개')
        a.screenshot(path=f'{OUT}/25_한바퀴_깃발.png')

        # ── 증강 카드 예 / 아니오 ──
        turnId = a.evaluate("() => S.players[S.turn].id")
        mine = next((p for p in (a, b, c) if p.evaluate("() => me.id") == turnId), a)
        other = next((p for p in (a, b, c) if p.evaluate("() => me.id") != turnId), b)

        FAKE = """(kind) => {
          const my = S.players.find(p => p.id === me.id);
          my.augs = [{ id:'oneStep', name:'한 걸음씩', icon:'👣',
            desc:'윷을 던지면 도 또는 개 중에서 고를 수 있습니다.',
            when:'딱 맞게 멈추고 싶을 때', group:'윷', rarity:'rare',
            kind:kind, win:false, spent:false, uses:1, needs:'none', prog:null }];
          render();
        }"""
        mine.evaluate(FAKE, 'active')
        time.sleep(0.3)
        mine.locator('#mePanel .aug:not(.empty)').first.click()
        time.sleep(0.4)
        body = mine.inner_text('#abilBody').replace('\n', ' ')
        yes = mine.locator('#abilBody [data-yes]').count()
        no = mine.locator('#abilBody [data-no]').count()
        check('내 차례 — 설명 뒤 「사용하시겠습니까?」',
              '사용하시겠습니까' in body and yes == 1 and no == 1, body[:70])
        check('내 차례 — 얼마나 썼는지도 나옴', '쓸 수 있어요' in body, body[:70])
        mine.screenshot(path=f'{OUT}/26_증강_사용확인.png')
        mine.click('#abilBody [data-no]')
        time.sleep(0.3)
        check('「아니오」로 닫힘', mine.locator('#ovAbility:not([hidden])').count() == 0)

        other.evaluate(FAKE, 'active')
        time.sleep(0.3)
        other.locator('#mePanel .aug:not(.empty)').first.click()
        time.sleep(0.4)
        body2 = other.inner_text('#abilBody').replace('\n', ' ')
        check('내 차례가 아니면 예/아니오 없음',
              other.locator('#abilBody [data-yes]').count() == 0 and '사용하시겠습니까' not in body2,
              body2[:60])
        check('내 차례가 아니어도 설명과 사용 현황',
              '윷을 던지면' in body2 and '쓸 수 있어요' in body2, body2[:70])
        other.click('#abilCancel')

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
