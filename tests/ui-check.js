// Checks the TV app and the pairing page in a real browser (Playwright).
//
// TV app (webos-app/dist with scripts/screenshots/demo.js): each made-up TV,
// in each language, every button: nothing runs off the screen or past the
// footer, no page errors, and no English left in Russian or Spanish.
// Pairing page: the real pair-server.js on a fake TV, driven like a person
// would: type the code, let the browser make a key, confirm it on the "TV",
// and check ssh-keygen reads the key that was downloaded.
//
//   sh webos-app/build.sh --no-package && node tests/ui-check.js [OUT_DIR]
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'webos-app/dist');
const OUT = process.argv[2] || '';
let problems = 0;
const P = (m) => { problems++; console.log('PROBLEM ' + m); };

const SMALL = /\b(the|is|are|was|it|this|that|and|but|or|to|of|on|in|with|your|for|key|keys|press|log|set|fix|turn|now|check|nobody|password)\b/i;
const ENG = /[A-Za-z']{2,}(?:[ ,]+[A-Za-z'-]{2,}){2,}/;
const OKW = /SSH Doctor|Homebrew Channel|LG-WEBOS-SSH-DOCTOR|github\.com\S*|root@\S+|ssh(-keygen)? [^\n]*|SHA256:\S+|ssh-ed25519|ssh-rsa|ecdsa[^\s]*|authorized_keys\S*|\/home\/root\S*|bob@\S+|lgtv-\S+|alpine|PowerShell|Terminal|Mac|Linux|Windows|Telnet|telnet|Node\.js|dropbear [0-9.]+|\/\S*\/(dropbear|sshd)[^\n]*|REMOTE HOST IDENTIFICATION HAS CHANGED|crlf|private|rootmy\.tv|-o|\b(bash|tmux|nano|vim|htop|git|rsync)\b|Advanced, SSH, Authentication, Private key file|Settings, SFTP, Add key file|SSH Private Key/g;

async function tv(b) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-ui-'));
    fs.cpSync(DIST, path.join(work, 'app'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts/screenshots/demo.js'), path.join(work, 'app/demo.js'));
    const index = path.join(work, 'app/index.html');
    fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('<script src="app.js">', '<script src="demo.js"></script>\n<script src="app.js">'));
    // SD_UI_ONLY=ru:custom checks just that language and TV
    const only = (process.env.SD_UI_ONLY || '').split(':');
    for (const lang of ['en', 'ru', 'es']) {
        if (only[0] && only[0] !== lang) { continue; }
        for (const s of ['healthy', 'alpine', 'locked', 'off', 'messy', 'custom', 'entware', 'exposed']) {
            if (only[1] && only[1] !== s) { continue; }
            const c = await b.newContext({ viewport: { width: 1920, height: 1080 } });
            const p = await c.newPage();
            const errs = [];
            p.on('pageerror', (e) => errs.push(String(e)));
            await p.addInitScript((l) => { try { localStorage.setItem('sd.lang', l); } catch (e) { /* none */ } }, lang);
            const check = async (where) => {
                const r = await p.evaluate(() => {
                    const out = { msgs: [] };
                    const ft = document.querySelector('footer').getBoundingClientRect().top;
                    const card = document.getElementById('status').getBoundingClientRect();
                    if (card.bottom > ft + 2) { out.msgs.push('card past the footer'); }
                    const st = document.getElementById('status');
                    if (st.scrollHeight > st.clientHeight + 2) { out.msgs.push('card text cut off'); }
                    document.querySelectorAll('.btn').forEach((x) => {
                        if (x.style.display === 'none') { return; }
                        const r = x.getBoundingClientRect();
                        if (r.bottom > ft + 2) { out.msgs.push('row past footer: ' + x.textContent.trim().slice(0, 30)); }
                        if (x.scrollWidth > x.clientWidth + 1) { out.msgs.push('row too wide: ' + x.textContent.trim().slice(0, 30)); }
                    });
                    const ov = document.getElementById('overlay');
                    if (!ov.classList.contains('hidden')) {
                        const pr = document.querySelector('.panel').getBoundingClientRect();
                        if (pr.top < 0 || pr.bottom > 1080) { out.msgs.push('panel off screen ' + Math.round(pr.top) + '..' + Math.round(pr.bottom)); }
                        // The report stays in English on purpose: it goes in a GitHub issue
                        const pc = document.querySelector('.panel').cloneNode(true);
                        pc.querySelectorAll('pre.report').forEach((x) => x.remove());
                        out.ov = pc.innerText;
                    }
                    out.app = document.getElementById('app').innerText;
                    return out;
                });
                r.msgs.forEach((m) => P(`${lang} ${s} ${where}: ${m}`));
                if (lang !== 'en') {
                    for (const t of [r.app, r.ov || '']) {
                        const left = t.replace(OKW, '');
                        const m = left.match(lang === 'ru' ? ENG : SMALL);
                        if (m) { P(`${lang} ${s} ${where}: English left: "${m[0]}" in "${left.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\n/g, ' | ')}"`); }
                    }
                }
            };
            await p.goto('file://' + index + '?s=' + s);
            await p.waitForTimeout(700);
            await check('load');
            if (OUT && lang === 'en') { await p.screenshot({ path: path.join(OUT, `tv-${s}.png`) }); }
            const acts = await p.evaluate(() => Array.from(document.querySelectorAll('.btn')).filter((x) => x.style.display !== 'none').map((x) => x.getAttribute('data-action')));
            for (const a of acts) {
                if (a === 'lang') { continue; }
                await p.evaluate((x) => document.querySelector('[data-action="' + x + '"]').click(), a);
                await p.waitForTimeout(a === 'pair' ? 600 : 400);
                await check('after ' + a);
                if (OUT && s === 'healthy') { await p.screenshot({ path: path.join(OUT, `tv-${lang}-${a}.png`) }); }
                const mode = await p.evaluate(() => document.getElementById('overlay-hint').textContent);
                const isMenu = await p.evaluate(() => !!document.querySelector('#overlay:not(.hidden) .menu'));
                if (isMenu) {
                    // Every row of the menu, and one level below it
                    const rows = await p.evaluate(() => document.querySelectorAll('.mrow').length);
                    const title = await p.evaluate(() => document.getElementById('overlay-title').textContent);
                    for (let i = 0; i < rows; i++) {
                        const there = await p.evaluate((t) => !!document.querySelector('#overlay:not(.hidden) .menu') && document.getElementById('overlay-title').textContent === t, title);
                        if (!there) {
                            for (let j = 0; j < 3; j++) { await p.keyboard.press('Escape'); await p.waitForTimeout(120); }
                            await p.evaluate(() => { const o = document.getElementById('overlay'); if (!o.classList.contains('hidden')) { o.className = 'overlay hidden'; } });
                            await p.evaluate((x) => document.querySelector('[data-action="' + x + '"]').click(), a);
                            await p.waitForTimeout(500);
                        }
                        for (let j = 0; j < i; j++) { await p.keyboard.press('ArrowDown'); }
                        await p.keyboard.press('Enter');
                        await p.waitForTimeout(600);
                        await check('after ' + a + ' row ' + i);
                        if (OUT && lang === 'en' && s === 'custom') { await p.screenshot({ path: path.join(OUT, `tv-${a}-${i}.png`) }); }
                        const sub = await p.evaluate(() => !!document.querySelector('#overlay:not(.hidden) .menu') ? document.querySelectorAll('.mrow').length : 0);
                        const subTitle = await p.evaluate(() => document.getElementById('overlay-title').textContent);
                        if (sub && subTitle !== title) {
                            for (let k = 0; k < sub; k++) {
                                for (let j = 0; j < k; j++) { await p.keyboard.press('ArrowDown'); }
                                await p.keyboard.press('Enter');
                                await p.waitForTimeout(500);
                                await check('after ' + a + ' row ' + i + '.' + k);
                                await p.keyboard.press('Escape');
                                await p.waitForTimeout(200);
                                const still = await p.evaluate((t) => document.getElementById('overlay-title').textContent === t, subTitle);
                                if (!still) { break; }
                                for (let j = 0; j < 8; j++) { await p.keyboard.press('ArrowUp'); }
                            }
                        }
                        await p.keyboard.press('Escape');
                        await p.waitForTimeout(200);
                        const back = await p.evaluate((t) => document.getElementById('overlay-title').textContent === t, title);
                        if (back) { for (let j = 0; j < 12; j++) { await p.keyboard.press('ArrowUp'); } }
                    }
                } else if (a === 'pair') {
                    // Let the made-up phone connect and send its key
                    await p.waitForTimeout(10500);
                    await check('pair pending');
                    if (OUT && s === 'alpine') { await p.screenshot({ path: path.join(OUT, `tv-${lang}-pair-pending.png`) }); }
                    await p.keyboard.press('Enter');
                    await p.waitForTimeout(500);
                    await check('pair accepted');
                } else if (/OK/.test(mode) && mode.indexOf('BACK') > 0 && a !== 'howto' && a !== 'keys') {
                    await p.keyboard.press('Enter');
                    await p.waitForTimeout(500);
                    await check('after ' + a + ' OK');
                }
                for (let i = 0; i < 2; i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(150); }
            }
            if (errs.length) { P(`${lang} ${s}: page errors ${JSON.stringify(errs)}`); }
            await c.close();
        }
    }
    if (OUT) {
        // The pairing screen while it waits for a phone, for the README
        const c = await b.newContext({ viewport: { width: 1920, height: 1080 } });
        const p = await c.newPage();
        await p.goto('file://' + index + '?s=alpine&pair=wait');
        await p.waitForTimeout(600);
        await p.evaluate(() => document.querySelector('[data-action="pair"]').click());
        await p.waitForTimeout(800);
        await p.screenshot({ path: path.join(OUT, 'tv-pair.png') });
        await c.close();
    }
    fs.rmSync(work, { recursive: true, force: true });
}

async function pairing(b) {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-pair-'));
    const env = Object.assign({}, process.env, {
        SD_ROOT: T + '/root', SD_NOMOUNT: '1', SD_IPS: '127.0.0.1', SD_OWNER: String(process.getuid()),
        SD_NODE: process.execPath, SD_PAIR_PORT: String(29100 + (process.pid % 700))
    });
    for (const d of ['home/root/.ssh', 'etc', 'proc/net', 'var/luna/preferences']) { fs.mkdirSync(path.join(T, 'root', d), { recursive: true }); }
    fs.writeFileSync(path.join(T, 'root/etc/shadow'), 'root:xGVw8H4GqkKg6:15069:0:99999:7:::\n');
    const sd = (a) => cp.execFileSync('sh', [path.join(DIST, 'assets/ssh-doctor.sh')].concat(a), { env }).toString();
    const st = JSON.parse(sd(['pair-start']));
    const url = 'http://127.0.0.1:' + st.port + '/';
    for (const vp of [{ name: 'phone', width: 390, height: 844, mobile: true }, { name: 'desktop', width: 1280, height: 800, mobile: false }]) {
        if (vp.name === 'desktop') {
            sd(['pair-stop']);
            Object.assign(st, JSON.parse(sd(['pair-start'])));
        }
        const c = await b.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, acceptDownloads: true, userAgent: vp.mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' : undefined });
        const p = await c.newPage();
        const errs = [];
        p.on('pageerror', (e) => errs.push(String(e)));
        // The wrong code on purpose answers 403, which the browser logs
        p.on('console', (m) => { if (m.type() === 'error' && !/status of 403/.test(m.text())) { errs.push(m.text()); } });
        await p.goto(url);
        if (OUT) { await p.screenshot({ path: path.join(OUT, `pair-${vp.name}-1.png`), fullPage: true }); }
        await p.fill('#code', 'ZZZZZZ');
        await p.click('#code-go');
        await p.waitForTimeout(400);
        const wrong = await p.textContent('#code-msg');
        if (!/4 tries left/.test(wrong)) { P(`pair ${vp.name}: wrong code message: ${wrong}`); }
        await p.fill('#code', st.code.toLowerCase().replace('-', ''));
        await p.click('#code-go');
        await p.waitForSelector('#make', { state: 'visible', timeout: 5000 }).catch(() => P(`pair ${vp.name}: key step not shown`));
        if (OUT) { await p.screenshot({ path: path.join(OUT, `pair-${vp.name}-2.png`), fullPage: true }); }
        const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }), p.click('#make')]);
        const keyFile = path.join(T, 'dl-' + vp.name);
        await dl.saveAs(keyFile);
        fs.chmodSync(keyFile, 0o600);
        if (dl.suggestedFilename() !== 'lgtv_ed25519') { P(`pair ${vp.name}: download named ${dl.suggestedFilename()}`); }
        await p.waitForSelector('#step-confirm', { state: 'visible', timeout: 5000 }).catch(() => P(`pair ${vp.name}: confirm step not shown`));
        const fpShown = await p.textContent('#fp');
        const pub = cp.execFileSync('ssh-keygen', ['-y', '-f', keyFile]).toString().trim();
        fs.writeFileSync(keyFile + '.pub', pub + '\n');
        const fp = cp.execFileSync('ssh-keygen', ['-lf', keyFile + '.pub']).toString().split(' ')[1];
        if (fpShown.indexOf(fp) < 0) { P(`pair ${vp.name}: page shows ${fpShown}, the downloaded key is ${fp}`); }
        const tvState = JSON.parse(sd(['pair-status']));
        if (tvState.state !== 'pending' || tvState.key.fp !== fp) { P(`pair ${vp.name}: TV sees ${JSON.stringify(tvState)}`); }
        if (OUT) { await p.screenshot({ path: path.join(OUT, `pair-${vp.name}-3.png`), fullPage: true }); }
        sd(['pair-accept']);
        await p.waitForSelector('#step-done', { state: 'visible', timeout: 8000 }).catch(() => P(`pair ${vp.name}: done step not shown`));
        const how = await p.textContent('#howto');
        const want = vp.mobile ? 'Termius' : 'ssh -i ~/Downloads/lgtv_ed25519 root@127.0.0.1';
        if (how.indexOf(want) < 0) { P(`pair ${vp.name}: instructions missing "${want}": ${how}`); }
        if (OUT) { await p.screenshot({ path: path.join(OUT, `pair-${vp.name}-4.png`), fullPage: true }); }
        const ak = fs.readFileSync(path.join(T, 'root/home/root/.ssh/authorized_keys'), 'utf8');
        if (ak.indexOf(pub.split(' ')[1]) < 0) { P(`pair ${vp.name}: key not in authorized_keys`); }
        const conf = await p.textContent('#config');
        if (!/Host lgtv/.test(conf) || !/IdentityFile ~\/.ssh\/lgtv_ed25519/.test(conf)) { P(`pair ${vp.name}: ssh config: ${conf}`); }
        const over = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        if (over) { P(`pair ${vp.name}: page wider than the screen`); }
        if (errs.length) { P(`pair ${vp.name}: page errors ${JSON.stringify(errs)}`); }
        await c.close();
    }
    sd(['pair-stop']);

    // A password typed on a phone: only the hash reaches the TV, and it checks out
    const pw = 'correct horse 42';
    const ps = JSON.parse(sd(['pair-start', 'password']));
    {
        const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
        const p = await c.newPage();
        const errs = [];
        const posted = [];
        p.on('pageerror', (e) => errs.push(String(e)));
        p.on('request', (r) => { if (r.method() === 'POST') { posted.push(r.postData() || ''); } });
        await p.goto('http://127.0.0.1:' + ps.port + '/');
        await p.fill('#code', ps.code);
        await p.click('#code-go');
        await p.waitForSelector('#pw1', { state: 'visible', timeout: 5000 }).catch(() => P('pair password: password step not shown'));
        if (OUT) { await p.screenshot({ path: path.join(OUT, 'pair-phone-password.png'), fullPage: true }); }
        await p.fill('#pw1', 'short');
        await p.fill('#pw2', 'short');
        await p.click('#pw-go');
        if (!/8 characters/.test(await p.textContent('#pw-msg'))) { P('pair password: short password not refused'); }
        await p.fill('#pw1', pw);
        await p.fill('#pw2', pw);
        await p.click('#pw-go');
        await p.waitForSelector('#step-confirm', { state: 'visible', timeout: 8000 }).catch(() => P('pair password: confirm step not shown'));
        if (posted.some((x) => x.indexOf(pw) >= 0)) { P('pair password: the password itself was sent'); }
        const tv = JSON.parse(sd(['pair-status']));
        if (tv.state !== 'pending' || !tv.password) { P('pair password: TV sees ' + JSON.stringify(tv)); }
        sd(['pair-accept']);
        await p.waitForSelector('#step-done', { state: 'visible', timeout: 8000 }).catch(() => P('pair password: done step not shown'));
        const sh = fs.readFileSync(path.join(T, 'root/etc/shadow'), 'utf8');
        const hash = (sh.match(/^root:([^:]*):/m) || [])[1] || '';
        const ok = cp.execFileSync('python3', ['-c', 'import ctypes,ctypes.util,sys\nl=ctypes.CDLL(ctypes.util.find_library("crypt"))\nl.crypt.restype=ctypes.c_char_p\nprint(l.crypt(sys.argv[1].encode(), sys.argv[2].encode()).decode()==sys.argv[2])', pw, hash]).toString().trim();
        if (ok !== 'True') { P('pair password: shadow hash ' + hash + ' does not match the password'); }
        if (errs.length) { P('pair password: page errors ' + JSON.stringify(errs)); }
        await c.close();
    }
    sd(['pair-stop']);

    // The read-only page from How to log in: the QR code's #c= connects
    // straight away, on a phone and a computer at once, and everything copies
    const is = JSON.parse(sd(['pair-start', 'info']));
    for (const vp of [{ name: 'phone', width: 390, height: 844, mobile: true }, { name: 'desktop', width: 1280, height: 800, mobile: false }]) {
        const c = await b.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, permissions: ['clipboard-read', 'clipboard-write'],
            userAgent: vp.mobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' : undefined });
        const p = await c.newPage();
        const errs = [];
        p.on('pageerror', (e) => errs.push(String(e)));
        await p.goto('http://127.0.0.1:' + is.port + '/#c=' + is.code.replace('-', '') + (vp.mobile ? '&s=report' : ''));
        await p.waitForSelector('#step-info', { state: 'visible', timeout: 5000 }).catch(() => P(`info ${vp.name}: page not shown`));
        if (/#c=/.test(p.url())) { P(`info ${vp.name}: the code stayed in the address bar`); }
        const how = await p.textContent('#howto');
        const want = vp.mobile ? 'Open in an SSH app' : 'ssh root@127.0.0.1';
        if (how.indexOf(want) < 0) { P(`info ${vp.name}: instructions missing "${want}": ${how}`); }
        if ((await p.textContent('#info-report-text')).indexOf('SSH Doctor') < 0) { P(`info ${vp.name}: no report`); }
        const copies = await p.$$('button.copy');
        if (copies.length < 3) { P(`info ${vp.name}: only ${copies.length} copy buttons`); }
        await copies[0].click();
        const label = await copies[0].textContent();
        if (label !== 'Copied') { P(`info ${vp.name}: copy button says ${label}`); }
        if (OUT) { await p.screenshot({ path: path.join(OUT, `info-${vp.name}.png`), fullPage: true }); }
        const over = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        if (over) { P(`info ${vp.name}: page wider than the screen`); }
        if (errs.length) { P(`info ${vp.name}: page errors ${JSON.stringify(errs)}`); }
        await c.close();
    }
    if (JSON.parse(sd(['pair-status'])).state !== 'waiting') { P('info: the page stopped after two devices'); }
    sd(['pair-stop', 'info']);
    fs.rmSync(T, { recursive: true, force: true });
}

(async () => {
    if (OUT) { fs.mkdirSync(OUT, { recursive: true }); }
    const b = await chromium.launch();
    // SD_UI_ONLY=pair checks just the pairing page
    if (process.env.SD_UI_ONLY !== 'pair') { await tv(b); }
    if (!process.env.SD_UI_ONLY || process.env.SD_UI_ONLY === 'pair') { await pairing(b); }
    await b.close();
    console.log('problems: ' + problems);
    process.exit(problems ? 1 : 0);
})();
