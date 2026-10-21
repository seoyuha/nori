"""서버를 띄우고 실제 화면을 사람 눈으로 확인할 수 있게 찍는다."""
import subprocess, time, os, sys, signal
from playwright.sync_api import sync_playwright

DIR = '/home/claude/yut/english_yut_battle_v3'
PORT = 3122
OUT = '/home/claude/yut/shots'
os.makedirs(OUT, exist_ok=True)

env = dict(os.environ, PORT=str(PORT), DATA_DIR='/tmp/yut-shot-data', TEACHER_PIN='testpin')
srv = subprocess.Popen(['node', 'server.js'], cwd=DIR, env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
time.sleep(1.5)
URL = f'http://localhost:{PORT}'
errors = []

try:
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        pages = []
        for i in range(3):
            ctx = br.new_context(viewport={'width': 1440, 'height': 860})
            pg = ctx.new_page()
            pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.on('console', lambda m: errors.append('console: ' + m.text) if m.type == 'error' else None)
            pg.goto(URL)
            pages.append(pg)

        host, b, c = pages

        # ── 시작 화면 ──
        host.fill('#myName', '6-1 김하늘')
        host.click('[data-mode="full"]')
        host.screenshot(path=f'{OUT}/01_시작화면.png')

        host.click('#btnCreate')
        host.wait_for_selector('#waiting.on', timeout=8000)
        code = host.inner_text('#waitCode').strip()
        print('방 코드:', code)

        for pg, nm in ((b, '6-1 이바다'), (c, '6-1 박나래')):
            pg.fill('#myName', nm)
            pg.fill('#roomCode', code)
            pg.click('#btnJoin')
            pg.wait_for_selector('#waiting.on', timeout=8000)
        time.sleep(0.6)
        host.screenshot(path=f'{OUT}/02_대기실.png')

        # ── 게임 시작 → 영어 문제 ──
        host.click('#btnStart')
        host.wait_for_selector('#ovBattle:not([hidden])', timeout=8000)
        time.sleep(0.5)
        host.screenshot(path=f'{OUT}/03_영어배틀.png')

        for pg in pages:
            try: pg.click('.opt', timeout=2500)
            except Exception: pass
        time.sleep(1.0)
        host.screenshot(path=f'{OUT}/04_정답공개.png')

        # ── 증강 선택 ──
        try:
            host.click('#btnGo', timeout=3000)
        except Exception:
            pass
        host.wait_for_selector('#ovChoose:not([hidden])', timeout=10000)
        time.sleep(0.5)
        host.screenshot(path=f'{OUT}/05_증강선택.png')

        for pg in pages:
            try: pg.click('.augCard', timeout=3000)
            except Exception: pass
        time.sleep(0.6)
        # 정답자는 한 장 더
        for pg in pages:
            try: pg.click('.augCard', timeout=1500)
            except Exception: pass

        # ── 판 ──
        host.wait_for_selector('#ovChoose[hidden]', timeout=12000, state='attached')
        time.sleep(0.8)
        host.screenshot(path=f'{OUT}/06_게임판.png')

        # 몇 수 둬 본다
        for _ in range(14):
            for pg in pages:
                try:
                    if pg.locator('#ovBattle:not([hidden])').count():
                        pg.click('.opt', timeout=900)
                        continue
                    if pg.locator('#ovChoose:not([hidden])').count():
                        pg.click('.augCard', timeout=900)
                        continue
                    if pg.locator('#btnGo').count():
                        pg.click('#btnGo', timeout=900)
                        continue
                    if pg.locator('[data-throw]').count():
                        pg.click('[data-throw]', timeout=900)
                        time.sleep(0.25)
                    if pg.locator('#mePanel .pcs i').count():
                        pg.locator('#mePanel .pcs i').first.click(timeout=900)
                except Exception:
                    pass
            time.sleep(0.35)

        time.sleep(0.6)
        host.screenshot(path=f'{OUT}/07_진행중.png')

        # ── 증강 사용 창 ──
        try:
            if host.locator('.aug.usable').count():
                host.locator('.aug.usable').first.click(timeout=1500)
                time.sleep(0.4)
                host.screenshot(path=f'{OUT}/08_증강사용.png')
                host.click('#abilCancel')
        except Exception as e:
            print('증강 사용 창 건너뜀:', e)

        # ── 교사 관제실 ──
        t = br.new_context(viewport={'width': 1280, 'height': 860}).new_page()
        t.goto(URL)
        t.click('details.teacherBox summary')
        t.fill('#teacherPin', 'testpin')
        t.click('#btnTeacher')
        t.wait_for_selector('#teacher.on', timeout=8000)
        time.sleep(0.6)
        t.screenshot(path=f'{OUT}/09_교사관제실.png')

        # ── 휴대폰 크기 ──
        m = br.new_context(viewport={'width': 390, 'height': 780}).new_page()
        m.goto(URL)
        m.fill('#myName', '학생')
        m.screenshot(path=f'{OUT}/10_휴대폰.png', full_page=True)

        br.close()
finally:
    srv.send_signal(signal.SIGTERM)
    time.sleep(0.4)
    srv.kill()
    err = srv.stderr.read().decode()[-1500:] if srv.stderr else ''

print('\n저장한 화면:', ', '.join(sorted(os.listdir(OUT))))
real = [e for e in errors if 'favicon' not in e]
if real:
    print(f'\n브라우저 오류 {len(set(real))}종:')
    for e in sorted(set(real))[:12]:
        print('  !', e[:200])
else:
    print('\n브라우저 오류 없음')
if err.strip():
    print('\n서버 stderr:', err[-600:])
