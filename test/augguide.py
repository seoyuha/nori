"""증강 설명 보기와 선택 가이드를 실제 브라우저로 확인한다."""
import subprocess, time, os, signal
from playwright.sync_api import sync_playwright

DIR = '/home/claude/yut/english_yut_battle_v3'
PORT = 3201
OUT = '/home/claude/yut/shots'
os.makedirs(OUT, exist_ok=True)

env = dict(os.environ, PORT=str(PORT), DATA_DIR='/tmp/yut-ag', TEACHER_PIN='t')
srv = subprocess.Popen(['node', 'server.js'], cwd=DIR, env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
time.sleep(1.6)
URL = f'http://localhost:{PORT}'
errors, results = [], []

def check(name, ok, detail=''):
    results.append((name, ok))
    print(('  OK  ' if ok else '  실패 ') + name + (' — ' + detail if detail else ''))

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

        # 영어 문제 → 증강 선택
        host.wait_for_selector('#ovBattle:not([hidden])', timeout=9000)
        for pg in pages:
            try: pg.click('.opt', timeout=1500)
            except Exception: pass
        time.sleep(1.0)
        try: host.click('#btnGo', timeout=2500)
        except Exception: pass
        host.wait_for_selector('#ovChoose:not([hidden])', timeout=10000)
        time.sleep(0.6)

        # ── 선택 화면의 가이드 ──
        whens = host.eval_on_selector_all('.augCard .wh', 'els=>els.map(e=>e.textContent.trim())')
        check('카드마다 「이럴 때 좋아요」 안내', len(whens) == 3, whens[0][:48] if whens else '없음')

        guide = host.inner_text('#chooseGuide')
        check('고르는 요령 상자', '뒤처졌다면' in guide and '앞서고 있다면' in guide,
              guide.replace('\n', ' / ')[:90])

        tags = host.eval_on_selector_all('.augCard .tag', 'els=>els.map(e=>e.textContent.trim())')
        check('분류 · 등급 표시', len(tags) == 3, ' | '.join(tags))
        host.screenshot(path=f'{OUT}/18_증강선택_가이드.png')

        # 상황에 맞는 추천이 뜨는지 (판에 말이 없으니 이동·시작 계열이 추천되어야 함)
        need = host.evaluate("() => myNeeds()")
        rec = host.locator('.augCard.fit').count()
        check('지금 상황 읽기', len(need['tags']) > 0, f"갈래 {','.join(need['tags'])} · 추천표시 {rec}장")

        for pg in pages:
            try: pg.click('.augCard', timeout=2500)
            except Exception: pass
        time.sleep(0.5)
        for pg in pages:
            try: pg.click('.augCard', timeout=1500)
            except Exception: pass
        host.wait_for_selector('#ovChoose[hidden]', timeout=12000, state='attached')
        time.sleep(0.8)

        # ── 내 증강 칸을 눌러 설명 보기 ──
        n = host.locator('#mePanel .aug:not(.empty)').count()
        check('내 증강이 칸에 보임', n >= 1, f'{n}개')
        host.locator('#mePanel .aug:not(.empty)').first.click()
        time.sleep(0.5)
        opened = host.locator('#ovAbility:not([hidden])').count() == 1
        title = host.inner_text('#abilTitle') if opened else ''
        body = host.inner_text('#abilBody') if opened else ''
        check('증강 칸을 누르면 설명 창', opened, title)
        check('설명 창에 내용과 쓰임새', len(body) > 20 and ('이럴 때 좋아요' in body or '적용' in body or '발동' in body),
              body.replace('\n', ' / ')[:90])
        host.screenshot(path=f'{OUT}/19_증강설명.png')
        host.click('#abilCancel')

        # ── 친구 증강도 눌러 볼 수 있는지 ──
        time.sleep(0.3)
        if host.locator('#leftCol .aug:not(.empty)').count():
            host.locator('#leftCol .aug:not(.empty)').first.click()
            time.sleep(0.4)
            check('친구 증강도 설명이 보임', host.locator('#ovAbility:not([hidden])').count() == 1,
                  host.inner_text('#abilTitle'))
            # 남의 것에는 사용 단추가 없어야 한다
            check('친구 증강에는 사용 단추 없음', host.locator('[data-usenow]').count() == 0)
            host.click('#abilCancel')
        else:
            check('친구 증강도 설명이 보임', False, '친구 증강 칸을 찾지 못함')

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
