"""말 번호 · 업기 표시 · 방 없애기 버튼을 실제 브라우저로 확인한다."""
import subprocess, time, os, signal
from playwright.sync_api import sync_playwright

DIR = '/home/claude/yut/english_yut_battle_v3'
PORT = 3171
PIN = 'test1234'
OUT = '/home/claude/yut/shots'
os.makedirs(OUT, exist_ok=True)

env = dict(os.environ, PORT=str(PORT), DATA_DIR='/tmp/yut-nf', TEACHER_PIN=PIN)
srv = subprocess.Popen(['node', 'server.js'], cwd=DIR, env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
time.sleep(1.6)
URL = f'http://localhost:{PORT}'
errors, results = [], []

def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('  OK  ' if ok else '  실패 ') + name + (' — ' + detail if detail else ''))

def hookup(pg):
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)

def play(pages, rounds=18):
    """자동으로 몇 수 둬 본다"""
    for _ in range(rounds):
        for pg in pages:
            try:
                if pg.locator('#ovBattle:not([hidden])').count():
                    pg.click('.opt', timeout=800); continue
                if pg.locator('#ovChoose:not([hidden])').count():
                    pg.click('.augCard', timeout=800); continue
                if pg.locator('#btnGo').count():
                    pg.click('#btnGo', timeout=800); continue
                if pg.locator('[data-throw]').count():
                    pg.click('[data-throw]', timeout=800); time.sleep(0.2)
                if pg.locator('.pc.pick').count():
                    pg.locator('.pc.pick').first.click(timeout=800)
            except Exception:
                pass
        time.sleep(0.3)

try:
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        pages = []
        for i in range(3):
            pg = br.new_context(viewport={'width': 1440, 'height': 880}).new_page()
            hookup(pg); pg.goto(URL); pages.append(pg)
            pg.evaluate("() => document.querySelectorAll('details.moreBox').forEach(d=>d.open=true)")
        host, b, c = pages

        host.fill('#myName', '6-1 김하늘'); host.click('[data-mode="full"]')
        host.click('#btnCreate'); host.wait_for_selector('#waiting.on', timeout=8000)
        code = host.inner_text('#waitCode').strip()

        # 대기실에서 방장만 '방 없애기'가 보이는지
        check('대기실 — 방장에게 방 없애기 보임', host.locator('#btnKillWait:not([hidden])').count() == 1)

        for pg, nm in ((b, '6-1 이바다'), (c, '6-1 박나래')):
            pg.fill('#myName', nm); pg.fill('#roomCode', code); pg.click('#btnJoin')
            pg.wait_for_selector('#waiting.on', timeout=8000)
        time.sleep(0.5)
        check('대기실 — 방장 아닌 학생에게는 숨김', b.locator('#btnKillWait:not([hidden])').count() == 0)

        host.click('#btnStart')
        host.wait_for_selector('#ovBattle:not([hidden])', timeout=9000)
        play(pages, 20)
        time.sleep(0.6)

        # 말 칩에 번호가 보이는지
        nums = host.eval_on_selector_all('#mePanel .pc i', 'els=>els.map(e=>e.textContent.trim())')
        want = [str(i + 1) for i in range(len(nums))]
        check('내 말에 번호 표시', len(nums) >= 2 and nums == want, '번호 ' + ','.join(nums))

        wheres = host.eval_on_selector_all('#mePanel .pc .w', 'els=>els.map(e=>e.textContent.trim())')
        check('말이 어디 있는지 글자로 표시', all(w for w in wheres), ' / '.join(wheres))

        # 옆 학생 칸에도 번호가 보이는지
        side = host.eval_on_selector_all('#leftCol .pc i', 'els=>els.map(e=>e.textContent.trim())')
        check('옆 학생 칸에도 번호 표시', len(side) >= 3, '칩 ' + str(len(side)) + '개')

        host.screenshot(path=f'{OUT}/15_말번호.png')

        # 업기를 일부러 만들어 본다 — 서버 상태를 직접 겹쳐 놓는다
        host.evaluate("""() => {
          const my = S.players.find(p => p.id === me.id);
          my.pieces[0].pos = 7; my.pieces[0].route = 'outer';
          my.pieces[1].pos = 7; my.pieces[1].route = 'outer';
          render();
        }""")
        time.sleep(0.4)
        st = host.eval_on_selector_all('#mePanel .pc .st', 'els=>els.map(e=>e.textContent.trim())')
        stacked = host.locator('#mePanel .pc.stack').count()
        check('업기 표시 — 내 말 칸', stacked == 2 and any('업기 2' in x for x in st), ' / '.join(st) or '없음')

        ring = host.evaluate('() => document.querySelectorAll(String.fromCharCode(35) + "board circle").length && [...document.querySelectorAll("#board circle")].filter(c => c.getAttribute("r") === "19.5").length')
        check('업기 표시 — 말판에 겹친 테두리', ring >= 1, f'{ring}개')
        host.screenshot(path=f'{OUT}/16_업기표시.png')

        # 게임 중 메뉴에 방 없애기
        host.click('#btnMenu'); time.sleep(0.3)
        check('게임 메뉴에 방 없애기', host.locator('#mnKill').count() == 1)
        host.click('#mnClose')

        # 교사 관제실에서 방 없애기
        t = br.new_context(viewport={'width': 1280, 'height': 880}).new_page()
        hookup(t); t.goto(URL)
        t.evaluate("() => document.querySelectorAll('details.moreBox').forEach(d=>d.open=true)")
        t.click('details.teacherBox summary'); t.fill('#teacherPin', PIN); t.click('#btnTeacher')
        t.wait_for_selector('#teacher.on', timeout=8000); time.sleep(0.6)
        check('관제실 방 목록에 방 없애기', t.locator(f'[data-kill="{code}"]').count() == 1)
        t.screenshot(path=f'{OUT}/17_관제실_방없애기.png')

        # 관전 화면에도 있는지
        t.click(f'[data-watch="{code}"]'); time.sleep(0.8)
        check('관전 화면에도 방 없애기', t.locator(f'[data-kill="{code}"]').count() >= 1)

        # 실제로 눌러서 방이 닫히고 학생이 쫓겨나는지
        t.on('dialog', lambda d: d.accept())
        t.click(f'[data-kill="{code}"]')
        time.sleep(2.2)
        gone = t.inner_text('#toast')
        check('교사가 방 없애기 — 성공 메시지', '없앴습니다' in gone, gone)
        # 학생은 알림을 본 뒤 곧바로 첫 화면으로 돌아간다 (새로고침되며 알림은 지워진다)
        screen = b.evaluate("() => ['landing','waiting','game'].filter("
                            "x => document.getElementById(x).classList.contains('on'))")
        check('학생이 첫 화면으로 돌아감', screen == ['landing'], ', '.join(screen) or '없음')
        left = b.evaluate("() => localStorage.getItem('yutMe')")
        check('학생 기기에 남은 방 정보 삭제', left is None, str(left))

        br.close()
finally:
    srv.send_signal(signal.SIGTERM); time.sleep(0.4); srv.kill()
    err = srv.stderr.read().decode()[-800:] if srv.stderr else ''

print('\n' + '─' * 52)
bad = [r for r in results if not r[1]]
print(f'{len(results) - len(bad)} / {len(results)} 통과')
real = [e for e in errors if 'favicon' not in e and 'TUNNEL' not in e]
print('브라우저 오류:', sorted(set(real))[:6] if real else '없음')
if err.strip(): print('서버 stderr:', err[-400:])
