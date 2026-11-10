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
    var overlayMode = null; // null, 'busy', 'message', 'confirm', 'pair', 'menu', 'input'
    var onConfirm = null;
    var pair = null;        // { timer, data, port, url, stage }
    var menuStack = [];     // open menus: { title, items, at }
    var inputDone = null;   // what OK does on an input screen

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
        'telnet-off': 'Telnet is off, so if SSH breaks, this app is the only way back in.',
        'port-taken': 'Another program already uses the SSH port, so the Homebrew Channel\'s SSH server can\'t start there.  More tools, SSH servers on this TV shows which one.',
        'keys-only-no-keys': 'Keys only is on, but no key works, so nobody can log in.  Set up a key, or go back to password login.',
        'hostkey-broken': 'One of the TV\'s own SSH keys is an empty file, which can stop SSH from starting.  Repair the TV\'s SSH keys fixes that.',
        'settings-not-applied': 'SSH isn\'t running with your settings (it was restarted another way).  Put my settings back fixes that.',
        'port-trial': 'SSH answers on two ports while you try the new one.  Log in on it, then keep it in SSH settings.',
        'failed-logins': 'Someone tried wrong passwords or user names recently.  More tools, Login history shows where from.',
        'other-ssh': 'Another SSH server runs on this TV too.  This app only changes the Homebrew Channel\'s.',
        'ssh-is-entware': 'SSH on this TV is Entware\'s, not the Homebrew Channel\'s.  This app checks it and fixes the keys file it reads, but leaves its settings alone.',
        'entware-no-way-in': 'Nobody can log in to Entware\'s SSH: there\'s no working key, and it won\'t take a password for root (Entware keeps its own, in /opt/etc/shadow).  Set up a key: Entware\'s SSH reads the same keys file.',
        'sshd-config-bad': 'Entware\'s OpenSSH refuses its settings file, /opt/etc/ssh/sshd_config, so it won\'t start.  More tools, SSH servers on this TV shows what it says is wrong.',
        'sshd-root-denied': 'Entware\'s OpenSSH doesn\'t let root log in (PermitRootLogin in /opt/etc/ssh/sshd_config).  Set it to prohibit-password to log in with keys.',
        'sshd-keyfile-elsewhere': 'Entware\'s OpenSSH reads keys from somewhere other than /home/root/.ssh/authorized_keys (AuthorizedKeysFile), so keys added here don\'t work there.',
        'sshd-hostkey-broken': 'Entware\'s OpenSSH has a missing or empty host key in /opt/etc/ssh, so it won\'t start.  Over telnet, ssh-keygen -A makes new ones.',
        'edb-hostkey-broken': 'Entware\'s dropbear has an empty host key file in /opt/etc/dropbear, which stops it from starting.  Delete that file and start it again to get a new one.',
        'entware-port-clash': 'Entware\'s SSH is set to a port another server already uses (usually the Homebrew Channel\'s, on 22), so it can\'t start.  Give one of them another port.',
        'entware-stopped': 'Entware\'s SSH is installed but not running.  Restart the TV, or over telnet run /opt/etc/init.d/rc.unslung start.',
        'entware-no-autostart': 'Nothing starts Entware when the TV starts, so its SSH won\'t come back after a restart.  The Entware installer adds a startup script for that.',
        'boot-started': 'SSH wasn\'t running after the last restart, so SSH Doctor started it.',
        'boot-perms': 'After the last restart, the keys file had loose permissions, so SSH Doctor fixed them.',
        'ssh-exposed': 'Your router forwards this TV\'s SSH port to the internet, so anyone online can try to log in.  Close it on the router takes that forward off.',
        'telnet-exposed': 'Your router forwards telnet to the internet: anyone online can get in as root with no password.  Close it on the router takes that forward off now.'
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
        if (!s.listening && isEntware(s)) { return !!s.entwareLogin; }
        return s.listening && (s.keys > 0 || (!s.keysOnly && (s.password === 'alpine' || s.password === 'set')));
    }
    // SSH answers through Entware's server, not the Homebrew Channel's
    function isEntware(s) { return /^entware-/.test((s && s.active) || ''); }
    // The port people log in on: the Homebrew Channel's, or Entware's when that's the one in use
    function loginPort(s) {
        if (!s.listening && isEntware(s)) {
            var e = (s.entware || []).filter(function (x) { return x.kind === s.active; })[0];
            if (e && e.ports.length) { return e.ports[0]; }
        }
        return s.port || 22;
    }
    function sset() { return (state && state.settings) || {}; }

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
                exposureBackground();
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
            ? T('Log in as root at {ip}, port {port}.', { ip: ip(), port: loginPort(s) })
            : T('Nobody can log in over SSH right now.  The buttons on the right fix it.');

        var server = s.listening ? '<span class="ok">' + esc(T('running on port {port}', { port: s.port || 22 })) + '</span>'
            + (sset().trial ? esc(T(' (and {port} for now)', { port: sset().trial })) : '')
            : isEntware(s) ? '<span class="ok">' + esc(T('Entware\'s, on port {port}', { port: loginPort(s) })) + '</span>'
            : (s.sshEnabled ? '<span class="bad">' + esc(T('on, but not running')) + '</span>' : '<span class="bad">' + esc(T('off')) + '</span>');
        var login;
        if (!s.listening && isEntware(s)) {
            login = s.keys ? '<span class="ok">' + esc(s.keys === 1 ? T('1 key') : T('{n} keys', { n: s.keys })) + '</span>'
                : (s.entwareLogin ? esc(T('Entware\'s password')) : '<span class="bad">' + esc(T('nobody can log in')) + '</span>');
        }
        else if (s.keysOnly) { login = '<span class="ok">' + esc(T('keys only')) + '</span>' + esc(T(', and {n} keys', { n: s.keys || 0 })); }
        else if (s.password === 'alpine') { login = '<span class="warn">' + esc(T('password alpine')) + '</span>' + (s.keys ? esc(T(', and {n} keys', { n: s.keys })) : ''); }
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
        show('apply', find('settings-not-applied'));
        show('hostfix', find('hostkey-broken'));
        show('exposed', find('ssh-exposed') || find('telnet-exposed'));
        show('password', find('no-way-in') || find('no-password') || find('keys-only-no-keys'));
        $('settings-hint').textContent = settingsHint();
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
        menuStack = [];
        inputDone = null;
        onConfirm = null;
        $('overlay').className = 'overlay hidden';
        focusCurrent();
    }
    function message(title, html) { overlay('message', title, html, T('Press OK or BACK to close.')); }
    function confirmThen(title, html, fn) {
        onConfirm = fn;
        overlay('confirm', title, html, T('Press OK to go ahead, or BACK to cancel.'));
    }

    // Run a script command with a busy screen, then show what it did: okHtml
    // when it worked (if given), otherwise the script's own words
    function act(title, args, okHtml) {
        if (busy) { return; }
        busy = true;
        menuStack = [];
        overlay('busy', title, '<span class="spinner"></span>' + esc(T('Working on it…')), '');
        runScript(args, function (ok, out, err) {
            busy = false;
            var text = (out || err || '').trim();
            if (ok && okHtml) { message(T('{title}: done', { title: title }), okHtml); }
            else { message(ok ? T('{title}: done', { title: title }) : T('{title}: something went wrong', { title: title }), pre(TS(text))); }
            refresh();
        });
    }

    // ------------------------------------------------------------------ pairing

    function pairTitle() { return pair && pair.purpose === 'password' ? T('Your own password') : T('Set up a key'); }

    function startPair(purpose) {
        if (busy) { return; }
        purpose = purpose === 'password' ? 'password' : 'key';
        busy = true;
        menuStack = [];
        var title = purpose === 'password' ? T('Your own password') : T('Set up a key');
        overlay('busy', title, '<span class="spinner"></span>' + esc(T('Starting the pairing page…')), '');
        runScript('pair-start ' + purpose, function (ok, out) {
            busy = false;
            var d = parse(out);
            if (!d || d.error || !d.port) {
                message(title, p(esc(d && d.error === 'no-node'
                    ? T('This TV has no Node.js, which the pairing page needs.  Use How to log in to add a key over telnet instead.')
                    : T('The pairing page didn\'t start.'))) + (d && d.log ? pre(d.log) : ''));
                return;
            }
            pair = { data: d, purpose: purpose, port: d.port, url: 'http://' + ((d.ips && d.ips[0]) || ip()) + ':' + d.port, timer: null, stage: '' };
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
        if (st === 'pending' && d.password) {
            if (pair.stage === 'pending') { return; }
            pair.stage = 'pending';
            onConfirm = acceptKey;
            overlay('pair', T('Set this password?'),
                p(esc(T('A new root password was typed on the other device.  Only its scrambled hash was sent.')))
                + p(esc(T('Once it\'s set, log in as root with it, also after restarts.'))),
                T('Press OK to set it, or BACK to turn it down.'));
            return;
        }
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
            ? (pair.purpose === 'password' ? T('Connected.  Type the password on the other device.') : T('Connected.  Choose a key on the other device.'))
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
        overlay('pair', pairTitle(), html, hint);
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
            message(pairTitle(), p(esc(why[d.state] || why.stopped)));
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
        var pw = p0.purpose === 'password';
        overlay('busy', pw ? T('Set this password?') : T('Add this key?'), '<span class="spinner"></span>' + esc(pw ? T('Setting the password…') : T('Adding the key…')), '');
        runScript('pair-accept', function (ok, out) {
            busy = false;
            pair = null;
            // The page stays up a little so the other device sees the answer
            setTimeout(function () { runScript('pair-stop', function () {}); }, 20000);
            if (pw) {
                message(ok ? T('Password set') : T('The password wasn\'t set'),
                    ok ? p(esc(T('Root\'s password is set.  Log in as root with it, also after restarts.'))) : pre(TS((out || '').trim())));
            } else {
                message(ok ? T('Key added') : T('The key wasn\'t added'),
                    pre(TS((out || '').trim())) + (ok ? p(esc(T('The other device now shows how to log in.'))) : ''));
            }
            refresh();
        });
    }

    function rejectKey() {
        runScript('pair-reject', function () {
            setTimeout(function () { runScript('pair-stop', function () {}); }, 10000);
        });
        var pw = pair && pair.purpose === 'password';
        if (pair && pair.timer) { clearInterval(pair.timer); }
        pair = null;
        onConfirm = null;
        message(pw ? T('Your own password') : T('Set up a key'), p(esc(pw ? T('The password was turned down.  Nothing changed.') : T('The key was turned down.  Nothing changed.'))));
    }

    // ------------------------------------------------------------------ menus
    //
    // A list in the overlay, moved through with UP/DOWN.  BACK goes to the
    // menu it came from.  Items: { label, hint, fn, fix }

    function menu(title, items, keepAt) {
        var top = menuStack[menuStack.length - 1];
        if (!keepAt || !top || top.title !== title) { menuStack.push({ title: title, items: items, at: 0 }); }
        else { top.items = items; }
        drawMenu();
    }
    function drawMenu() {
        var m = menuStack[menuStack.length - 1];
        if (!m) { closeOverlay(); return; }
        var items = m.items.filter(function (x) { return x; });
        m.items = items;
        if (m.at >= items.length) { m.at = items.length - 1; }
        overlay('menu', m.title, '<div class="menu' + (items.length > 8 ? ' many' : '') + '">' + items.map(function (x, i) {
            return '<div class="mrow' + (x.fix ? ' fix' : '') + (i === m.at ? ' focus' : '') + '" data-i="' + i + '"><span>' + esc(x.label)
                + '</span><small>' + esc(x.hint || '') + '</small></div>';
        }).join('') + '</div>', T('OK selects, BACK goes back.'));
        Array.prototype.slice.call(document.querySelectorAll('.mrow')).forEach(function (row) {
            row.addEventListener('mouseover', function () { m.at = +row.getAttribute('data-i'); markMenu(); });
            row.addEventListener('click', function (e) { e.stopPropagation(); m.at = +row.getAttribute('data-i'); pickMenu(); });
        });
    }
    function markMenu() {
        var m = menuStack[menuStack.length - 1];
        Array.prototype.slice.call(document.querySelectorAll('.mrow')).forEach(function (row, i) {
            row.className = row.className.replace(/ focus/g, '') + (i === m.at ? ' focus' : '');
        });
    }
    function pickMenu() {
        var m = menuStack[menuStack.length - 1];
        var it = m && m.items[m.at];
        if (it && it.fn) { it.fn(); }
    }
    function menuBack() {
        menuStack.pop();
        if (menuStack.length) { drawMenu(); } else { closeOverlay(); }
    }
    // Back to the menu after a message, if one was open
    function reopenMenu() {
        if (menuStack.length) { drawMenu(); return true; }
        return false;
    }

    // ------------------------------------------------------------------ typing
    //
    // Text boxes bring up the TV's on-screen keyboard.  fields: [{ id, label,
    // type, value }]; done(values) runs on OK in the last box.

    function ask(title, intro, fields, done) {
        inputDone = done;
        overlay('input', title, (intro ? p(esc(intro)) : '') + fields.map(function (f) {
            return '<label class="in-label" for="in-' + f.id + '">' + esc(f.label) + '</label>'
                + '<input class="in" id="in-' + f.id + '" type="' + (f.type || 'text') + '" value="' + esc(f.value || '') + '"'
                + (f.type === 'number' ? ' inputmode="numeric"' : '') + ' autocomplete="off" spellcheck="false">';
        }).join('') + '<p id="in-msg" class="bad"></p>', T('OK on the keyboard goes to the next box, then saves.  BACK cancels.'));
        var first = document.querySelector('.in');
        if (first) { setTimeout(function () { first.focus(); }, 50); }
    }
    function inputs() { return Array.prototype.slice.call(document.querySelectorAll('.in')); }
    function inputMsg(t) { var e = $('in-msg'); if (e) { e.textContent = t; } }
    function inputKey(e) {
        var k = e.keyCode, list = inputs(), i = list.indexOf(document.activeElement);
        if (k === KEY.ENTER) {
            e.preventDefault();
            if (i >= 0 && i < list.length - 1) { list[i + 1].focus(); return; }
            var vals = {};
            list.forEach(function (x) { vals[x.id.slice(3)] = x.value; });
            if (inputDone) { inputDone(vals); }
        } else if (k === KEY.DOWN && i >= 0 && i < list.length - 1) { e.preventDefault(); list[i + 1].focus(); }
        else if (k === KEY.UP && i > 0) { e.preventDefault(); list[i - 1].focus(); }
        else if (k === KEY.BACK || k === KEY.ESC) {
            e.preventDefault();
            inputDone = null;
            if (!reopenMenu()) { closeOverlay(); }
        }
    }

    // ------------------------------------------------------------------ SSH settings

    function settingsHint() {
        var st = sset(), bits = [];
        if (st.port && st.port !== 22) { bits.push(T('port {port}', { port: st.port })); }
        if (st.password) { bits.push(T('own password')); }
        if (st.keysOnly) { bits.push(T('keys only')); }
        if (st.keepalive) { bits.push(T('keepalive')); }
        if (st.bootFix) { bits.push(T('fixed at startup')); }
        return bits.length ? bits.join(', ') : T('Homebrew Channel defaults');
    }

    function settingsMenu(keep) {
        var st = sset(), s = state || {};
        var custom = st.password || st.keysOnly || st.keepalive || st.bootFix || (st.port && st.port !== 22) || st.trial;
        menu(T('SSH settings'), [
            { label: T('Your own password'), hint: st.password ? T('set') : (s.password === 'alpine' ? T('not set, alpine works') : T('not set')), fn: passwordMenu },
            { label: T('Keys only'), hint: st.keysOnly ? T('on: passwords don\'t log in') : T('off'), fn: keysOnlyToggle },
            { label: T('SSH port'), hint: st.trial ? T('{port}, and {old} for now', { port: st.port, old: st.trial }) : String(st.port || 22), fn: portMenu, fix: !!st.trial },
            { label: T('Keep idle sessions connected'), hint: st.keepalive ? T('on') : T('off'), fn: keepaliveToggle },
            { label: T('Fix SSH at startup'), hint: st.bootFix ? T('on') : T('off'), fn: bootFixToggle },
            custom ? { label: T('Reset to Homebrew Channel defaults'), hint: T('port 22, its usual password rules'), fn: resetSettings } : null
        ], keep);
    }

    function passwordMenu() {
        var st = sset();
        menu(T('Your own password'), [
            { label: T('Type it on the TV'), hint: T('with the on-screen keyboard'), fn: passwordOnTv },
            { label: T('Type it on my phone or computer'), hint: T('easier: scan a code'), fn: function () { startPair('password'); } },
            st.password ? { label: T('Remove my password'), hint: T('back to the Homebrew Channel\'s rules'), fn: function () {
                confirmThen(T('Remove my password'), p(esc(T('Root\'s password goes back to what the Homebrew Channel does: none when there\'s a keys file, alpine when there isn\'t.'))),
                    function () { act(T('Remove my password'), 'clear-password', p(esc(T('Your password is removed.')))); });
            } } : null
        ]);
    }

    function passwordOnTv() {
        ask(T('Your own password'), T('This becomes root\'s password for SSH, also after restarts.  Only a scrambled hash of it is kept on the TV.'), [
            { id: 'pw1', label: T('New password (at least 8 characters)'), type: 'password' },
            { id: 'pw2', label: T('The same password again'), type: 'password' }
        ], function (v) {
            if (v.pw1.length < 8) { inputMsg(T('Use at least 8 characters.')); return; }
            if (v.pw1 !== v.pw2) { inputMsg(T('The two passwords are different.')); return; }
            if (/^alpine$/i.test(v.pw1) || /^(password|12345678|123456789|qwertyui)$/i.test(v.pw1)) { inputMsg(T('Pick a password that\'s harder to guess.')); return; }
            if (!window.SD_SHA512CRYPT) { inputMsg(T('This part of the app didn\'t load.  Use your phone instead.')); return; }
            inputDone = null;
            overlay('busy', T('Your own password'), '<span class="spinner"></span>' + esc(T('Scrambling the password…')), '');
            setTimeout(function () {
                var h;
                try { h = window.SD_SHA512CRYPT.hash(v.pw1); } catch (e) { message(T('Your own password'), p(esc(String(e)))); return; }
                v.pw1 = v.pw2 = '';
                act(T('Your own password'), 'set-password ' + shq(h),
                    p(esc(T('Root\'s password is set.  Log in as root with it, also after restarts.')))
                    + (sset().keysOnly ? p(esc(T('Keys only is on, so the password works once you turn that off.'))) : ''));
            }, 60);
        });
    }

    function keysOnlyToggle() {
        var st = sset(), s = state || {};
        if (st.keysOnly) {
            act(T('Keys only'), 'set-keys-only off', p(esc(T('Keys only is off: passwords log in again.'))));
            return;
        }
        if (!s.keys) { message(T('Keys only'), p(esc(T('Add a key first (Set up a key): with keys only and no key, nobody could log in.')))); return; }
        confirmThen(T('Keys only'),
            p(esc(T('Passwords stop working for SSH, alpine and your own too.  Only the {n} keys on this TV can log in.', { n: s.keys })))
            + p(esc(T('If you lose your key, this app\'s Go back to password login turns passwords back on.'))),
            function () { act(T('Keys only'), 'set-keys-only on', p(esc(T('Keys only is on: passwords don\'t log in any more.')))); });
    }

    function keepaliveToggle() {
        var on = sset().keepalive;
        act(T('Keep idle sessions connected'), 'set-keepalive ' + (on ? 'off' : 'on'),
            p(esc(on ? T('Keepalive is off.') : T('The TV now checks on idle sessions every 30 seconds, so routers don\'t drop them.'))));
    }

    function bootFixToggle() {
        if (sset().bootFix) {
            act(T('Fix SSH at startup'), 'set-bootfix off', p(esc(T('SSH isn\'t checked at startup any more.'))));
            return;
        }
        confirmThen(T('Fix SSH at startup'),
            p(esc(T('After every restart, SSH Doctor checks that SSH came up.  If it didn\'t, it starts it, and it fixes keys file permissions the SSH server would refuse.  It never touches another program\'s port.'))),
            function () { act(T('Fix SSH at startup'), 'set-bootfix on', p(esc(T('SSH is checked at every start now, and started if it\'s down.')))); });
    }

    function portMenu() {
        var st = sset(), s = state || {};
        if (st.trial) {
            var n = (s.sessions || {})[String(st.port)] || 0;
            menu(T('SSH port'), [
                { label: T('Keep port {port}', { port: st.port }), hint: n ? T('someone is logged in on it, so it works') : T('log in on it first to be sure'), fix: n > 0, fn: function () {
                    var go = function () { act(T('SSH port'), 'port-keep', p(esc(T('SSH uses port {port} now.  Port {old} is closed.', { port: st.port, old: st.trial })))); };
                    if (n) { go(); } else {
                        confirmThen(T('Keep port {port}', { port: st.port }), p(esc(T('Nobody is logged in on port {port} right now.  Keep it anyway?', { port: st.port }))), go);
                    }
                } },
                { label: T('Go back to port {port}', { port: st.trial }), hint: T('undo the change'), fn: function () {
                    act(T('SSH port'), 'port-revert', p(esc(T('SSH is back on port {port}.', { port: st.trial }))));
                } }
            ]);
            return;
        }
        var cur = st.port || 22;
        var pick = function (n) {
            act(T('SSH port'), 'set-port ' + n, n === 22 ? p(esc(T('SSH is on port 22 again.')))
                : p(esc(T('SSH now answers on port {port} too.  Log in with this, then come back here and keep the new port:', { port: n })))
                + pre('ssh -p ' + n + ' root@' + ip()) + p(esc(T('Port {old} stays open until then, so you can\'t lock yourself out.', { old: cur }))));
        };
        menu(T('SSH port'), [
            cur !== 2222 ? { label: '2222', hint: T('a common choice'), fn: function () { pick(2222); } } : null,
            cur !== 22022 ? { label: '22022', hint: T('rarely scanned'), fn: function () { pick(22022); } } : null,
            { label: T('Another port…'), hint: T('1024 to 65535'), fn: function () {
                ask(T('SSH port'), T('Pick a port from 1024 to 65535 that nothing else on the TV uses.'), [{ id: 'port', label: T('Port'), type: 'number', value: '' }], function (v) {
                    var n = parseInt(v.port, 10);
                    if (!(n >= 1024 && n <= 65535)) { inputMsg(T('Pick a port from 1024 to 65535.')); return; }
                    inputDone = null;
                    pick(n);
                });
            } },
            cur !== 22 ? { label: T('22, the usual SSH port'), hint: T('back to the default'), fn: function () { pick(22); } } : null
        ]);
    }

    function resetSettings() {
        confirmThen(T('Reset to Homebrew Channel defaults'),
            p(esc(T('This removes your password, keys only, keepalive, the startup check and the port change.  SSH goes back to port 22 with the Homebrew Channel\'s usual password and key rules.  Keys stay.'))),
            function () { act(T('Reset to Homebrew Channel defaults'), 'reset-settings', p(esc(T('Every SSH setting is removed.')))); });
    }

    // ------------------------------------------------------------------ keys

    function keysMenu(lastUsed) {
        runScript('keys --json', function (ok, out) {
            var k = parse(out);
            if (!k || !k.length) {
                message(T('Keys on this TV'), p(esc(T('No key can log in yet.  Use Set up a key to add one.'))));
                return;
            }
            var go = function (used) {
                menu(T('Keys on this TV'), k.slice(0, 12).map(function (x) {
                    var when = used && used[x.fp] ? T('last used {t}', { t: used[x.fp].replace('T', ' ').slice(0, 16) }) : T('not used lately');
                    return { label: (x.comment || T('(no name)')) + '  ·  ' + x.type.replace('ecdsa-sha2-', 'ecdsa ').replace('ssh-', ''),
                        hint: x.fp.slice(0, 22) + '…  ' + when, fn: function () { keyMenu(x); } };
                }));
            };
            if (lastUsed) { go(lastUsed); return; }
            runScript('logins --json', function (ok2, out2) { var l = parse(out2); go(l && l.lastUsed); });
        });
    }

    function keyMenu(x) {
        menu(x.comment || T('(no name)'), [
            { label: T('Fingerprint'), hint: x.fp, fn: function () {} },
            { label: T('Rename'), hint: T('give it a name you\'ll know'), fn: function () {
                ask(T('Rename'), '', [{ id: 'name', label: T('Name'), value: x.comment || '' }], function (v) {
                    inputDone = null;
                    act(T('Rename'), 'key-rename ' + shq(x.fp) + ' ' + shq(v.name), p(esc(T('Renamed the key.  A backup of the keys file was kept.'))));
                });
            } },
            { label: T('Remove'), hint: T('it won\'t log in any more'), fn: function () {
                confirmThen(T('Remove this key?'), '<div class="fp">' + esc(x.type + '\n' + x.fp + '\n' + (x.comment || '')) + '</div>'
                    + p(esc(T('Whoever has this key can\'t log in any more.  A backup of the keys file is kept, so Undo a change can put it back.'))),
                    function () { act(T('Remove'), 'key-remove ' + shq(x.fp), p(esc(T('Removed the key.')))); });
            } }
        ]);
    }

    // ------------------------------------------------------------------ more tools

    function toolsMenu() {
        var s = state || {};
        menu(T('More tools'), [
            { label: T('Login history'), hint: s.failedLogins ? T('{n} failed tries lately', { n: s.failedLogins }) : T('who logged in, and from where'), fn: loginHistory },
            { label: T('This TV\'s SSH keys'), hint: T('fingerprints, or make new ones'), fn: hostKeysMenu },
            { label: T('Telnet'), hint: s.telnetRunning ? T('on, no password') : T('off'), fn: telnetToggle },
            { label: T('File transfer (SFTP)'), hint: s.sftp ? T('works') : T('missing'), fn: sftpInfo },
            { label: T('SSH servers on this TV'), hint: T('{n} found', { n: (s.servers || []).length }), fn: serversInfo },
            { label: T('Reachable from the internet?'), hint: exposureHint(), fn: exposureInfo, fix: find('ssh-exposed') || find('telnet-exposed') },
            { label: T('Save or restore my setup'), hint: T('on a USB drive, for after a reset'), fn: kitMenu },
            { label: T('Report for getting help'), hint: T('no private details'), fn: reportShow },
            backups.length ? { label: T('Undo a change'), hint: T('put a backup back'), fn: actions.restore } : null,
            { label: T('Go back to password login'), hint: T('if you\'re locked out'), fn: actions.password }
        ]);
    }

    // ------------------------------------------------------------------ exposure

    function exposureHint() {
        var x = (state || {}).exposure;
        if (!x) { return T('ask the router'); }
        if (x.router !== 'found') { return T('the router didn\'t answer'); }
        return x.exposed.length ? T('yes, the router forwards it') : T('no forwards found');
    }

    // Asked once each time the app opens, in the background: it takes a few seconds
    var exposureAsked = false;
    function exposureBackground() {
        if (exposureAsked) { return; }
        exposureAsked = true;
        runScript('exposure --json', function () { if (!busy && !overlayMode) { refresh(); } });
    }

    function exposureInfo() {
        if (busy) { return; }
        busy = true;
        overlay('busy', T('Reachable from the internet?'), '<span class="spinner"></span>' + esc(T('Asking the router…')), '');
        runScript('exposure --json', function (ok, out) {
            busy = false;
            var x = parse(out);
            if (!x || x.router === 'error') { message(T('Reachable from the internet?'), p(esc(T('The router couldn\'t be asked.')))); return; }
            if (x.router === 'none') {
                message(T('Reachable from the internet?'), p(esc(T('No router answered.  Its UPnP may be off, so this can\'t tell.  Check its port forwarding page for this TV\'s address and ports 22 and 23.'))));
                refresh();
                return;
            }
            var rows = x.exposed.map(function (m) {
                return '<tr><td class="bad">' + esc(m.protocol + ' ' + m.external) + '</td><td>' + esc(T('to this TV, port {port}', { port: m.internal })
                    + (m.internal === 23 ? ' (telnet)' : '')) + '<br><small>' + esc(m.description || '') + '</small></td></tr>';
            }).join('');
            if (!rows) {
                message(T('Reachable from the internet?'), p(esc(T('{name} doesn\'t forward SSH or telnet to this TV.', { name: x.name || T('The router') })))
                    + p(esc(T('Forwards set up by hand in the router\'s settings may not show here.'))));
                refresh();
                return;
            }
            refresh();
            confirmThen(T('Reachable from the internet?'),
                p(esc(T('{name} forwards these to this TV, so anyone on the internet can reach them:', { name: x.name || T('The router') })))
                + '<table class="keys">' + rows + '</table>'
                + p(esc(T('OK takes these forwards off the router.  If a program on your network asked for them, it may ask again.'))),
                closeExposure);
        });
    }
    function closeExposure() {
        act(T('Close it on the router'), 'exposure-close', p(esc(T('The router doesn\'t forward SSH or telnet to this TV any more.'))));
    }

    // ------------------------------------------------------------------ survival kit

    function kitMenu() {
        menu(T('Save or restore my setup'), [
            { label: T('Save to a USB drive'), hint: T('keys, the TV\'s SSH keys, settings'), fn: function () {
                confirmThen(T('Save to a USB drive'),
                    p(esc(T('This copies your keys, the TV\'s own SSH keys, your SSH settings and your password\'s hash to the first USB drive plugged into the TV.  After a factory reset and rooting again, Put back from a USB drive restores them, and computers won\'t warn that the TV changed.'))) +
                    p(esc(T('The TV\'s own SSH keys are private: keep the drive somewhere safe.'))),
                    function () { act(T('Save to a USB drive'), 'kit-save'); });
            } },
            { label: T('Put back from a USB drive'), hint: T('after a reset or rooting again'), fn: kitRestoreMenu }
        ]);
    }

    function kitRestoreMenu() {
        runScript('kit-list --json', function (ok, out) {
            var k = parse(out) || [];
            if (!k.length) { message(T('Put back from a USB drive'), p(esc(T('No saved setup was found.  Plug in the USB drive you saved it to, wait a few seconds, then try again.')))); return; }
            menu(T('Put back from a USB drive'), k.slice(0, 10).map(function (x) {
                var bits = [T('{n} keys', { n: x.keys })];
                if (x.hostKeys) { bits.push(T('the TV\'s SSH keys')); }
                if (x.settings) { bits.push(T('settings')); }
                if (x.password) { bits.push(T('password')); }
                return { label: (x.saved || x.name).replace('T', ' ').slice(0, 16), hint: bits.join(', '), fn: function () {
                    confirmThen(T('Put back from a USB drive'),
                        p(esc(T('This puts back what was saved: {what}.  Everything it replaces is backed up first.  If the saved port is different, the current one stays open until you keep the new one.', { what: bits.join(', ') }))),
                        function () { act(T('Put back from a USB drive'), 'kit-restore ' + shq(x.name)); });
                } };
            }));
        });
    }

    function loginHistory() {
        runScript('logins --json', function (ok, out) {
            var d = parse(out);
            if (!d || !d.events) { message(T('Login history'), p(esc(T('The TV\'s log couldn\'t be read.')))); return; }
            if (!d.events.length) { message(T('Login history'), p(esc(T('No SSH logins in the TV\'s log.  It keeps the last few hours.')))); return; }
            var KIND = { key: T('key'), password: T('password'), 'bad-password': T('wrong password'), 'bad-user': T('unknown user') };
            var rows = d.events.slice(0, 9).map(function (e) {
                var bad = /^bad/.test(e.kind);
                return '<tr><td>' + esc(e.t.replace('T', ' ').slice(5, 16)) + '</td><td class="' + (bad ? 'bad' : 'ok') + '">' + esc(KIND[e.kind] || e.kind)
                    + '</td><td>' + esc(e.ip) + '</td></tr>';
            }).join('');
            var outside = (d.failedFrom || []).some(function (f) { return !/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.|169\.254\.|fe80:|fd|::1|::ffff:(10|192\.168|127)\.)/i.test(f.ip); });
            var from = (d.failedFrom || []).sort(function (a, b) { return b.n - a.n; }).slice(0, 3).map(function (f) { return f.ip + ' (' + f.n + ')'; }).join(', ');
            message(T('Login history'), p(esc(T('{ok} logins and {bad} failed tries since {t}.', { ok: d.ok, bad: d.failed, t: (d.since || '').replace('T', ' ').slice(0, 16) })))
                + '<table class="keys">' + rows + '</table>'
                + (from ? p(esc(T('Failed tries came from: {list}', { list: from }))) : '')
                + (outside ? p(esc(T('Some tries came from outside your home network, so the TV can be reached from the internet: check your router\'s port forwarding.'))) : ''));
        });
    }

    function hostKeysMenu() {
        menu(T('This TV\'s SSH keys'), [
            { label: T('Show fingerprints'), hint: T('to check the first login'), fn: function () {
                runScript('hostkeys --json', function (ok, out) {
                    var k = parse(out) || [];
                    if (!k.length) { message(T('This TV\'s SSH keys'), p(esc(T('There are no keys yet.  They\'re made at the first login.')))); return; }
                    message(T('This TV\'s SSH keys'), p(esc(T('The first time a computer connects, it shows one of these.  It should match:')))
                        + '<div class="fp">' + esc(k.map(function (x) { return x.type + ' ' + x.fp; }).join('\n')) + '</div>');
                });
            } },
            { label: T('Make new keys'), hint: T('if they\'re broken or were copied'), fn: function () {
                confirmThen(T('Make new keys'), p(esc(T('The current keys are backed up, then new ones are made at the next login.  Computers that logged in before warn REMOTE HOST IDENTIFICATION HAS CHANGED once: run the ssh-keygen -R line from How to log in on them.'))),
                    function () { act(T('Make new keys'), 'hostkeys-reset', p(esc(T('Done.  New keys are made at the next login.')))); });
            } }
        ]);
    }

    function telnetToggle() {
        var s = state || {};
        if (s.telnetRunning || s.telnet) {
            confirmThen(T('Turn telnet off'), p(esc(T('Telnet lets anyone on your network in as root with no password.  Turning it off is safer once SSH works.  If SSH breaks later, this app can still fix it.'))),
                function () { act(T('Turn telnet off'), 'telnet-off', p(esc(T('Telnet is off, now and after restarts.')))); });
        } else {
            act(T('Turn telnet on'), 'telnet-on', p(esc(T('Telnet is on, on port 23, with no password.'))));
        }
    }

    function sftpInfo() {
        var s = state || {};
        if (!s.sftp) {
            message(T('File transfer (SFTP)'), p(esc(T('The Homebrew Channel\'s file transfer helper is missing.  Reinstall the Homebrew Channel to get it back.'))));
            return;
        }
        message(T('File transfer (SFTP)'), p(esc(T('Works.  In WinSCP, FileZilla or Cyberduck, choose SFTP and log in like SSH:')))
            + pre(T('Host: {host}\nPort: {port}\nUser: root', { host: ip(), port: s.port || 22 }))
            + p(esc(T('Your files are in /home/root, USB drives under /tmp/usb.'))));
    }

    function serversInfo() {
        var s = state || {};
        var NAMES = { hbc: T('Homebrew Channel (dropbear)'), 'entware-openssh': T('Entware OpenSSH'), 'entware-dropbear': T('Entware dropbear'), devmode: T('Developer Mode'), other: T('Something else') };
        var list = s.servers || [];
        // Entware's servers that are installed but not running, and what's wrong with each
        var stopped = (s.entware || []).filter(function (e) { return !e.running; });
        var detail = (s.entware || []).filter(function (e) { return e.detail; });
        if (!list.length && !stopped.length) { message(T('SSH servers on this TV'), p(esc(T('No SSH server is running.')))); return; }
        var dev = list.filter(function (x) { return x.kind === 'devmode'; }).length;
        message(T('SSH servers on this TV'), '<table class="keys">' + list.map(function (x) {
            return '<tr><td>' + esc(NAMES[x.kind] || x.kind) + '</td><td>' + esc(x.ports.length ? T('port {port}', { port: x.ports.join(', ') }) : T('no port')) + '<br><small>' + esc(x.cmd) + '</small></td></tr>';
        }).join('') + stopped.map(function (e) {
            return '<tr><td>' + esc(NAMES[e.kind] || e.kind) + '</td><td><span class="warn">' + esc(T('installed, not running')) + '</span><br><small>'
                + esc(T('set to port {port}', { port: e.port })) + '</small></td></tr>';
        }).join('') + '</table>'
            + detail.map(function (e) { return p(esc(T('{name} says: {detail}', { name: NAMES[e.kind] || e.kind, detail: e.detail }))); }).join('')
            + (dev ? p(esc(T('Developer Mode\'s SSH is separate from root: user prisoner, port 9922, with the key and passphrase from the Developer Mode app.  It stops when the Developer Mode session runs out.'))) : '')
            + (list.length + stopped.length > 1 ? p(esc(T('This app only changes the Homebrew Channel\'s server.  The others are left alone.'))) : ''));
    }

    function reportShow() {
        runScript('report', function (ok, out) {
            var r = (out || '').trim();
            message(T('Report for getting help'), '<div class="pair">' + qrSvg(r) + '<div class="pair-side">'
                + p(esc(T('Scan this with your phone to copy the report, then paste it in a GitHub issue or a forum post.  It has no addresses, keys or names in it.'))) + '</div></div>');
        });
    }

    // ------------------------------------------------------------------ actions

    function howTo() {
        var s = state || {};
        var h = '';
        var opts = s.legacyRsa ? '-o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa ' : '';
        h += p(esc(T('From a computer on the same network, in Terminal (Mac, Linux) or PowerShell (Windows):')));
        var ent = !s.listening && isEntware(s);
        if (ent) { opts = ''; }
        var lp = loginPort(s);
        var port = lp !== 22 ? '-p ' + lp + ' ' : '';
        h += pre('ssh ' + opts + port + 'root@' + ip());
        if (s.legacyRsa && !ent) { h += p(esc(T('This TV\'s SSH server is old, so newer computers need the two -o options above.'))); }
        if (ent) { h += p(esc(s.entwareLogin && !s.keys ? T('Use the root password you set for Entware.') : T('It logs in with your key.  No key yet?  Use Set up a key.'))); }
        else {
            h += p(esc(s.keysOnly || s.password === 'none' ? T('It logs in with your key.  No key yet?  Use Set up a key.')
                : (sset().password ? T('Use your own password, or your key.') : (s.password === 'alpine' ? T('The password is alpine.') : T('It logs in with your key.  No key yet?  Use Set up a key.')))));
        }
        h += p(TC('If ssh says REMOTE HOST IDENTIFICATION HAS CHANGED, the TV\'s SSH keys were made again (after a reset, for example).  Check the fingerprint below, then run {cmd} on the computer and try again.', { cmd: 'ssh-keygen -R ' + (lp !== 22 ? '[' + ip() + ']:' + lp : ip()) }));
        // The fingerprints are the Homebrew Channel's dropbear's, not Entware's
        var hk = ent ? null : (s.hostKeys || []).filter(function (k) { return k.type === 'ssh-ed25519'; })[0] || (s.hostKeys || [])[0];
        if (hk) { h += '<div class="fp">' + esc(hk.type + ' ' + hk.fp) + '</div>'; }
        message(T('How to log in'), h);
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
        pair: function () { startPair('key'); },
        howto: howTo,
        keys: function () { keysMenu(); },
        settings: function () { settingsMenu(); },
        tools: toolsMenu,
        apply: function () { act(T('Put my settings back'), 'apply', p(esc(T('SSH runs with your settings again.')))); },
        exposed: closeExposure,
        hostfix: function () { act(T('Repair the TV\'s SSH keys'), 'hostkeys-reset', p(esc(T('Done.  New keys are made at the next login.')))); },
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
        if (overlayMode === 'input') { inputKey(e); return; }
        if (overlayMode) {
            e.preventDefault();
            if (overlayMode === 'busy') { return; }
            if (overlayMode === 'menu') {
                var m = menuStack[menuStack.length - 1];
                if (k === KEY.DOWN) { m.at = Math.min(m.at + 1, m.items.length - 1); markMenu(); }
                else if (k === KEY.UP) { m.at = Math.max(m.at - 1, 0); markMenu(); }
                else if (k === KEY.ENTER) { pickMenu(); }
                else if (isBack(k)) { menuBack(); }
                return;
            }
            if (overlayMode === 'pair') {
                if (k === KEY.ENTER && onConfirm) { var a = onConfirm; onConfirm = null; a(); }
                else if (isBack(k)) {
                    if (pair && pair.stage === 'pending') { rejectKey(); }
                    else { endPair(); closeOverlay(); }
                }
                return;
            }
            if (k === KEY.ENTER && overlayMode === 'confirm' && onConfirm) { var fn = onConfirm; onConfirm = null; fn(); }
            else if (k === KEY.ENTER || isBack(k)) { onConfirm = null; if (!reopenMenu()) { closeOverlay(); } }
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
    $('overlay').addEventListener('click', function (e) {
        if (overlayMode === 'input' || overlayMode === 'menu') { return; }
        if ((overlayMode === 'confirm' || overlayMode === 'pair') && onConfirm) { var fn = onConfirm; onConfirm = null; fn(); }
        else if (overlayMode === 'message') { if (!reopenMenu()) { closeOverlay(); } }
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
