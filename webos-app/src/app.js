/*
 * LG webOS SSH Doctor TV app.
 *
 * A remote-friendly front end for ssh-doctor.sh, bundled in assets/.  Root
 * commands go through the Homebrew Channel's own root service
 * (luna://org.webosbrew.hbchannel.service/exec), never over SSH, so this works
 * even when SSH doesn't.  Plain ES5 for older webOS browsers.
 */
(function () {
    'use strict';

    var I18N = window.SD_I18N || null;
    var T = I18N ? I18N.T : function (t, v) { return v ? t.replace(/\{(\w+)\}/g, function (m, k) { return k in v ? v[k] : m; }) : t; };
    var TS = I18N ? I18N.TS : function (t) { return t; };

    var HBC_EXEC = 'luna://org.webosbrew.hbchannel.service/exec';
    var KEY = { UP: 38, DOWN: 40, ENTER: 13, BACK: 461, ESC: 27, BACKSPACE: 8 };
    var appDir = decodeURIComponent(window.location.pathname).replace(/\/[^\/]*$/, '');
    var SCRIPT = appDir + '/assets/ssh-doctor.sh';

    var state = null;
    var backups = [];
    var busy = false;
    var overlayMode = null; // null, 'busy', 'message', 'confirm', 'pair'
    var onConfirm = null;
    var pair = null;        // { timer, data, port, url, stage }

    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function shq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
    // Translated text with each {name} shown as code
    function TC(text, vars) {
        var v = vars || {};
        return esc(T(text)).replace(/\{(\w+)\}/g, function (m, k) { return k in v ? '<code>' + esc(v[k]) + '</code>' : m; });
    }
    function p(html) { return '<p>' + html + '</p>'; }
    function pre(s) { return '<pre>' + esc(s) + '</pre>'; }

    // ------------------------------------------------------------------ luna

    var bridges = [];
    function luna(uri, params, cb) {
        if (typeof window.PalmServiceBridge === 'undefined') {
            cb({ returnValue: false, errorText: 'Not running on a webOS TV' });
            return;
        }
        var bridge = new window.PalmServiceBridge();
        bridges.push(bridge);
        bridge.onservicecallback = function (msg) {
            var i = bridges.indexOf(bridge);
            if (i >= 0) { bridges.splice(i, 1); }
            var reply;
            try { reply = JSON.parse(msg); } catch (e) { reply = { returnValue: false, errorText: 'Unreadable reply' }; }
            cb(reply);
        };
        bridge.call(uri, JSON.stringify(params));
    }

    // Run the bundled script as root. cb(ok, stdout, stderr)
    function runScript(args, cb) {
        if (window.SD_DEMO) { window.SD_DEMO(args, cb); return; }
        luna(HBC_EXEC, { command: 'sh ' + shq(SCRIPT) + ' ' + args + ' 2>&1' }, function (r) {
            cb(r.returnValue !== false, r.stdoutString || '', r.errorText || r.stderrString || '');
        });
    }
    function parse(out) {
        var i = out.indexOf('{'), j = out.indexOf('[');
        var at = i < 0 ? j : (j < 0 ? i : Math.min(i, j));
        try { return JSON.parse(out.slice(at)); } catch (e) { return null; }
    }

    // ------------------------------------------------------------------ status

    // What each finding means, and what to do about it
    var FINDINGS = {
        'hbc-missing': 'The Homebrew Channel isn\'t installed, so there\'s no SSH server on this TV.  Install it from rootmy.tv or your rooting tool.',
        'failsafe': 'The Homebrew Channel is in failsafe mode after a crash at startup, so SSH didn\'t start.  Restart the TV.',
        'ssh-off': 'SSH is turned off in the Homebrew Channel.  Turn SSH on now fixes that without a restart.',
        'ssh-not-running': 'SSH is turned on, but its server isn\'t running.  Turn SSH on now starts it.',
        'ssh-off-next-boot': 'SSH is running, but it\'s off in the Homebrew Channel\'s settings, so it won\'t start after a restart.  Turn SSH on now keeps it on.',
        'no-way-in': 'Nobody can log in: there\'s a keys file but no key in it works, and keys turn the password off.  Fix my keys file, set up a key, or go back to password login.',
        'no-password': 'There\'s no key and no password, so nobody can log in.  Set up a key, or go back to password login.',
        'keys-private': 'A private key was pasted into the keys file.  It doesn\'t work there and shouldn\'t be on the TV: Fix my keys file moves it out.',
        'keys-fixable': 'The keys file has Windows line endings, hidden characters, a key split over several lines or a key in PuTTY\'s format.  Fix my keys file repairs that.',
        'keys-bad': 'The keys file has lines that aren\'t working keys.  Fix my keys file moves them to a side file.',
        'perms': 'Other users can change the keys file or a folder above it, so the SSH server ignores the keys.  Fix my keys file sets the right permissions.',
        'password-default': 'Anyone on your network can log in with the default password, alpine.  Set up a key to turn that off.',
        'telnet-off': 'Telnet is off, so if SSH breaks, this app is the only way back in.'
    };

    function find(code) {
        var f = (state && state.findings) || [];
        for (var i = 0; i < f.length; i++) { if (f[i].code === code) { return true; } }
        return false;
    }
    function problems() {
        return ((state && state.findings) || []).filter(function (f) { return f.level === 'problem'; });
    }
    function ip() { return (state && state.ips && state.ips[0]) || 'TV_IP'; }
    function canLogIn(s) {
        return s.listening && (s.password === 'alpine' || s.password === 'set' || s.keys > 0);
    }

    function refresh(cb) {
        runScript('status --json', function (ok, out, err) {
            var d = parse(out);
            if (!d || !d.findings) {
                showNoRoot(ok ? T('The script gave an unexpected answer.') : err);
                if (cb) { cb(null); }
                return;
            }
            state = d;
            runScript('backups', function (ok2, out2) {
                backups = (out2 || '').split('\n').filter(function (l) { return /^authorized_keys\.ssh-doctor-/.test(l); });
                render();
                if (cb) { cb(d); }
            });
        });
    }

    function showNoRoot(msg) {
        $('dot').className = 'dot dot-bad';
        $('headline').textContent = T('No root access');
        $('subline').textContent = T('This app runs as root through the Homebrew Channel.  Open the Homebrew Channel once, check it says the system is rooted, then come back.');
        $('facts').innerHTML = '';
        $('findings').innerHTML = msg ? '<li>' + esc(msg) + '</li>' : '';
    }

    function render() {
        var s = state;
        var probs = problems();
        var ok = canLogIn(s);
        $('meta').textContent = 'v' + s.version + (s.dropbear ? ' · dropbear ' + s.dropbear : '');
        $('dot').className = 'dot ' + (probs.length ? (ok ? 'dot-warn' : 'dot-bad') : 'dot-ok');
        $('headline').textContent = !probs.length ? T('SSH works') : (ok ? T('SSH works, with problems') : T('SSH needs fixing'));
        $('subline').textContent = ok
            ? T('Log in as root at {ip}, port 22.', { ip: ip() })
            : T('Nobody can log in over SSH right now.  The buttons on the right fix it.');

        var server = s.listening ? '<span class="ok">' + esc(T('running on port 22')) + '</span>'
            : (s.sshEnabled ? '<span class="bad">' + esc(T('on, but not running')) + '</span>' : '<span class="bad">' + esc(T('off')) + '</span>');
        var login;
        if (s.password === 'alpine') { login = '<span class="warn">' + esc(T('password alpine')) + '</span>' + (s.keys ? esc(T(', and {n} keys', { n: s.keys })) : ''); }
        else if (s.password === 'set') { login = esc(T('your password')) + (s.keys ? esc(T(', and {n} keys', { n: s.keys })) : ''); }
        else if (s.keys) { login = '<span class="ok">' + esc(s.keys === 1 ? T('1 key') : T('{n} keys', { n: s.keys })) + '</span>'; }
        else { login = '<span class="bad">' + esc(T('nobody can log in')) + '</span>'; }
        var keyfile = !s.keyFile ? esc(T('none')) : (s.keyProblems || s.permProblems ? '<span class="bad">' + esc(T('needs fixing')) + '</span>' : '<span class="ok">' + esc(T('fine')) + '</span>');
        var telnet = s.telnet ? esc(T('on, a way back in')) : '<span class="warn">' + esc(T('off')) + '</span>';
        var rows = [
            [T('SSH server'), server],
            [T('Log in with'), login],
            [T('Keys file'), keyfile],
            [T('Telnet'), telnet],
            [T('TV address'), esc((s.ips || []).join(', ') || T('no network'))]
        ];
        $('facts').innerHTML = rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + r[1] + '</td></tr>'; }).join('');

        var f = (s.findings || []).slice().sort(function (a, b) { return a.level === b.level ? 0 : (a.level === 'problem' ? -1 : 1); });
        $('findings').innerHTML = f.slice(0, f.length > 3 ? 3 : 4).map(function (x) {
            return '<li class="' + (x.level === 'tip' ? 'tip' : '') + '">' + esc(T(FINDINGS[x.code] || x.code)) + '</li>';
        }).join('');
        $('status').className = 'card' + (f.length > 2 ? ' compact' : '');

        show('sshon', find('ssh-off') || find('ssh-not-running') || find('ssh-off-next-boot'));
        show('fixkeys', find('keys-private') || find('keys-fixable') || find('keys-bad') || find('perms') || find('no-way-in'));
        show('restore', backups.length > 0);
        $('keys-hint').textContent = s.keys === 1 ? T('1 key') : T('{n} keys', { n: s.keys || 0 });
        var n = buttons().length;
        $('actions').className = 'actions' + (n >= 8 ? ' tighter' : (n >= 7 ? ' tight' : ''));
        if (!overlayMode) { focusCurrent(); }
    }

    function show(action, on) {
        document.querySelector('[data-action="' + action + '"]').style.display = on ? '' : 'none';
    }

    // ------------------------------------------------------------------ overlay

    function overlay(mode, title, bodyHtml, hint) {
        overlayMode = mode;
        $('overlay-title').textContent = title;
        $('overlay-body').innerHTML = bodyHtml;
        $('overlay-hint').textContent = hint || '';
        $('overlay').className = 'overlay';
    }
    function closeOverlay() {
        overlayMode = null;
        onConfirm = null;
        $('overlay').className = 'overlay hidden';
        focusCurrent();
    }
    function message(title, html) { overlay('message', title, html, T('Press OK or BACK to close.')); }
    function confirmThen(title, html, fn) {
        onConfirm = fn;
        overlay('confirm', title, html, T('Press OK to go ahead, or BACK to cancel.'));
    }

    // Run a script command with a busy screen, then show what it did
    function act(title, args) {
        if (busy) { return; }
        busy = true;
        overlay('busy', title, '<span class="spinner"></span>' + esc(T('Working on it…')), '');
        runScript(args, function (ok, out, err) {
            busy = false;
            var text = (out || err || '').trim();
            message(ok ? T('{title}: done', { title: title }) : T('{title}: something went wrong', { title: title }), pre(TS(text)));
            refresh();
        });
    }

    // ------------------------------------------------------------------ pairing

    function startPair() {
        if (busy) { return; }
        busy = true;
        overlay('busy', T('Set up a key'), '<span class="spinner"></span>' + esc(T('Starting the pairing page…')), '');
        runScript('pair-start', function (ok, out) {
            busy = false;
            var d = parse(out);
            if (!d || d.error || !d.port) {
                message(T('Set up a key'), p(esc(d && d.error === 'no-node'
                    ? T('This TV has no Node.js, which the pairing page needs.  Use How to log in to add a key over telnet instead.')
                    : T('The pairing page didn\'t start.'))) + (d && d.log ? pre(d.log) : ''));
                return;
            }
            pair = { data: d, port: d.port, url: 'http://' + ((d.ips && d.ips[0]) || ip()) + ':' + d.port, timer: null, stage: '' };
            overlayMode = 'pair';
            drawPair();
            pair.timer = setInterval(pollPair, 2000);
        });
    }

    function qrSvg(text) {
        if (!window.qrcode) { return ''; }
        var qr = window.qrcode(0, 'M');
        qr.addData(text);
        qr.make();
        return qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
    }

    function left(ms) {
        var s = Math.max(0, Math.round(ms / 1000));
        return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
    }

    function drawPair() {
        var d = pair.data;
        var st = d.state;
        if (st === 'pending' && d.key) {
            if (pair.stage === 'pending') { return; }
            pair.stage = 'pending';
            onConfirm = acceptKey;
            overlay('pair', T('Add this key?'),
                p(esc(T('A key was sent from {comment}.  Check that this matches what the other device shows:', { comment: d.key.comment || T('another device') })))
                + '<div class="fp">' + esc(d.key.type + (d.key.bits ? ' (' + d.key.bits + ')' : '') + '\n' + d.key.fp) + '</div>'
                + p(esc(state && state.password === 'alpine' && !state.keys
                    ? T('This is the first key: after the next restart the alpine password stops working, and only keys can log in.')
                    : T('It will be able to log in as root.'))),
                T('Press OK to add it, or BACK to turn it down.'));
            return;
        }
        var stateText = st === 'paired'
            ? T('Connected.  Choose a key on the other device.')
            : T('Waiting for a phone or computer…') + (d.triesLeft < 5 ? '  ' + T('{n} tries left for this code.', { n: d.triesLeft }) : '');
        var html = '<div class="pair">' + qrSvg(pair.url)
            + '<div class="pair-side">'
            + '<div class="pair-label">' + esc(T('Scan, or open on your computer')) + '</div>'
            + '<div class="pair-url">' + esc(pair.url) + '</div>'
            + '<div class="pair-label">' + esc(T('Then enter this code')) + '</div>'
            + '<div class="pair-code">' + esc(st === 'paired' ? '✓' : d.code) + '</div>'
            + '<div class="pair-state">' + esc(stateText) + '</div>'
            + '</div></div>';
        var hint = T('Closes in {time}.  Press BACK to stop.', { time: left(d.expires - new Date().getTime()) });
        if (pair.stage === st && $('overlay-body').innerHTML) {
            // Only the parts that change, so the QR code doesn't flicker
            var codeEl = document.querySelector('.pair-code'), stEl = document.querySelector('.pair-state');
            if (codeEl && stEl) {
                codeEl.textContent = st === 'paired' ? '✓' : d.code;
                stEl.textContent = stateText;
                $('overlay-hint').textContent = hint;
                return;
            }
        }
        pair.stage = st;
        overlay('pair', T('Set up a key'), html, hint);
    }

    function pollPair() {
        if (!pair) { return; }
        runScript('pair-status', function (ok, out) {
            if (!pair) { return; }
            var d = parse(out) || { state: 'stopped' };
            if (d.state === 'waiting' || d.state === 'paired' || d.state === 'pending') {
                pair.data = d;
                drawPair();
                return;
            }
            endPair();
            var why = {
                expired: T('Time ran out before a key was sent.  Nothing changed.'),
                locked: T('Too many wrong codes were typed, so the pairing page closed.  Nothing changed.'),
                stopped: T('The pairing page closed.  Nothing changed.')
            };
            message(T('Set up a key'), p(esc(why[d.state] || why.stopped)));
        });
    }

    function endPair(keepServer) {
        if (pair && pair.timer) { clearInterval(pair.timer); }
        pair = null;
        onConfirm = null;
        if (!keepServer) { runScript('pair-stop', function () {}); }
    }

    function acceptKey() {
        var p0 = pair;
        if (!p0) { return; }
        clearInterval(p0.timer);
        busy = true;
        overlay('busy', T('Add this key?'), '<span class="spinner"></span>' + esc(T('Adding the key…')), '');
        runScript('pair-accept', function (ok, out) {
            busy = false;
            pair = null;
            // The page stays up a little so the other device sees the answer
            setTimeout(function () { runScript('pair-stop', function () {}); }, 20000);
            message(ok ? T('Key added') : T('The key wasn\'t added'),
                pre(TS((out || '').trim())) + (ok ? p(esc(T('The other device now shows how to log in.'))) : ''));
            refresh();
        });
    }

    function rejectKey() {
        runScript('pair-reject', function () {
            setTimeout(function () { runScript('pair-stop', function () {}); }, 10000);
        });
        if (pair && pair.timer) { clearInterval(pair.timer); }
        pair = null;
        onConfirm = null;
        message(T('Set up a key'), p(esc(T('The key was turned down.  Nothing changed.'))));
    }

    // ------------------------------------------------------------------ actions

    function howTo() {
        var s = state || {};
        var h = '';
        var opts = s.legacyRsa ? '-o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa ' : '';
        h += p(esc(T('From a computer on the same network, in Terminal (Mac, Linux) or PowerShell (Windows):')));
        h += pre('ssh ' + opts + 'root@' + ip());
        if (s.legacyRsa) { h += p(esc(T('This TV\'s SSH server is old, so newer computers need the two -o options above.'))); }
        h += p(esc(s.password === 'alpine' ? T('The password is alpine.') : T('It logs in with your key.  No key yet?  Use Set up a key.')));
        h += p(TC('If ssh says REMOTE HOST IDENTIFICATION HAS CHANGED, the TV\'s SSH keys were made again (after a reset, for example).  Check the fingerprint below, then run {cmd} on the computer and try again.', { cmd: 'ssh-keygen -R ' + ip() }));
        var hk = (s.hostKeys || []).filter(function (k) { return k.type === 'ssh-ed25519'; })[0] || (s.hostKeys || [])[0];
        if (hk) { h += '<div class="fp">' + esc(hk.type + ' ' + hk.fp) + '</div>'; }
        message(T('How to log in'), h);
    }

    function keysList() {
        runScript('keys --json', function (ok, out) {
            var k = parse(out);
            if (!k || !k.length) {
                message(T('Keys on this TV'), p(esc(T('No key can log in yet.  Use Set up a key to add one.'))));
                return;
            }
            var rows = k.slice(0, 8).map(function (x) {
                return '<tr><td>' + esc(x.type.replace('ecdsa-sha2-', 'ecdsa ').replace('ssh-', '')) + '</td><td>' + esc(x.fp) + '<br><small>' + esc(x.comment || '') + '</small></td></tr>';
            }).join('');
            message(T('Keys on this TV'), '<table class="keys">' + rows + '</table>'
                + (k.length > 8 ? p(esc(T('And {n} more.', { n: k.length - 8 }))) : ''));
        });
    }

    var actions = {
        sshon: function () { act(T('Turn SSH on now'), 'ssh-on'); },
        fixkeys: function () {
            confirmThen(T('Fix my keys file'),
                p(esc(T('This keeps a backup of the keys file, moves anything that isn\'t a working public key to a side file, repairs line endings and keys split over several lines, and sets the permissions the SSH server wants.'))),
                function () { act(T('Fix my keys file'), 'fix-keys'); });
        },
        password: function () {
            confirmThen(T('Go back to password login'),
                p(esc(T('This sets the keys file aside (kept as a backup) and turns on the Homebrew Channel\'s default login: user root, password alpine.  Key logins stop working until you add a key again.'))) +
                p(esc(T('Anyone on your network can use that password, so set up a key again soon.'))),
                function () { act(T('Go back to password login'), 'password-on'); });
        },
        pair: startPair,
        howto: howTo,
        keys: keysList,
        restore: function () {
            var b = backups[backups.length - 1];
            if (!b) { return; }
            confirmThen(T('Undo a change'),
                p(TC('This puts back the most recent backup of the keys file, {name}.  The current keys file is backed up first.', { name: b })),
                function () { act(T('Undo a change'), 'restore ' + shq(b)); });
        },
        lang: function () {
            if (busy || !I18N) { return; }
            if (I18N.next()) {
                try { window.sessionStorage.setItem('sd.focus', 'lang'); } catch (e) { /* not kept */ }
                window.location.reload();
            }
        }
    };

    // ------------------------------------------------------------------ remote

    function buttons() {
        return Array.prototype.slice.call(document.querySelectorAll('.btn')).filter(function (b) { return b.style.display !== 'none'; });
    }
    var current = 0;
    function focusCurrent() {
        var list = buttons();
        if (!list.length) { return; }
        if (current >= list.length) { current = list.length - 1; }
        list[current].focus();
    }
    function exitApp() {
        if (pair) { endPair(); }
        if (window.PalmSystem && window.PalmSystem.platformBack) { window.PalmSystem.platformBack(); }
        else { window.close(); }
    }
    function isBack(k) { return k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE; }

    document.addEventListener('keydown', function (e) {
        var k = e.keyCode;
        if (overlayMode) {
            e.preventDefault();
            if (overlayMode === 'busy') { return; }
            if (overlayMode === 'pair') {
                if (k === KEY.ENTER && onConfirm) { var a = onConfirm; onConfirm = null; a(); }
                else if (isBack(k)) {
                    if (pair && pair.stage === 'pending') { rejectKey(); }
                    else { endPair(); closeOverlay(); }
                }
                return;
            }
            if (k === KEY.ENTER && overlayMode === 'confirm' && onConfirm) { var fn = onConfirm; onConfirm = null; fn(); }
            else if (k === KEY.ENTER || isBack(k)) { closeOverlay(); }
            return;
        }
        var list = buttons();
        if (k === KEY.DOWN) { current = Math.min(current + 1, list.length - 1); focusCurrent(); e.preventDefault(); }
        else if (k === KEY.UP) { current = Math.max(current - 1, 0); focusCurrent(); e.preventDefault(); }
        else if (k === KEY.ENTER) {
            var btn = list[current];
            if (btn && !busy) { actions[btn.getAttribute('data-action')](); }
            e.preventDefault();
        } else if (k === KEY.BACK || k === KEY.ESC) { exitApp(); e.preventDefault(); }
    });

    // Magic Remote pointer
    Array.prototype.slice.call(document.querySelectorAll('.btn')).forEach(function (btn) {
        btn.addEventListener('mouseover', function () { current = buttons().indexOf(btn); focusCurrent(); });
        btn.addEventListener('click', function () {
            current = buttons().indexOf(btn);
            if (!overlayMode && !busy) { actions[btn.getAttribute('data-action')](); }
        });
    });
    $('overlay').addEventListener('click', function () {
        if ((overlayMode === 'confirm' || overlayMode === 'pair') && onConfirm) { var fn = onConfirm; onConfirm = null; fn(); }
        else if (overlayMode === 'message') { closeOverlay(); }
    });

    document.addEventListener('webOSRelaunch', function () { if (!busy && !pair) { refresh(); } });
    document.addEventListener('visibilitychange', function () {
        if (document.hidden && pair) { endPair(); closeOverlay(); }
        else if (!document.hidden && !busy && !pair) { refresh(); }
    });
    window.addEventListener('unload', function () { if (pair) { endPair(); } });
    // Check again now and then, so a fix made elsewhere (over telnet) shows up
    setInterval(function () { if (!document.hidden && !busy && !overlayMode) { refresh(); } }, 20000);

    if (I18N) { I18N.translatePage(document.body); }
    $('lang-hint').textContent = I18N ? I18N.label() : 'English';
    try {
        if (window.sessionStorage.getItem('sd.focus') === 'lang') {
            window.sessionStorage.removeItem('sd.focus');
            current = buttons().indexOf(document.querySelector('[data-action="lang"]'));
        }
    } catch (e) { /* first row */ }
    focusCurrent();
    refresh();
}());
