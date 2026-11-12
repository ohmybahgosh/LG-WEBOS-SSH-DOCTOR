/*
 * The pairing page's script.  It only talks to the TV it came from.  A key it
 * makes is an ed25519 pair made here with tweetnacl and this browser's random
 * numbers: the private key is saved as a file on this device and never sent.
 * A password is turned into a SHA-512 crypt hash here, and only the hash is
 * sent.  Opened from How to log in, the report or the TV's keys, it's a
 * read-only page with everything ready to copy.  The QR code on the TV puts
 * the code after # in the address, so scanning it connects straight away.
 */
(function () {
    'use strict';

    // ------------------------------------------------------------ language

    var DICTS = window.SD_PAIR_DICTS || {};
    var lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
    var dict = DICTS[lang] || {};
    function T(t, v) {
        var s = dict.hasOwnProperty(t) ? dict[t] : t;
        return v ? s.replace(/\{(\w+)\}/g, function (m, k) { return v.hasOwnProperty(k) ? v[k] : m; }) : s;
    }
    if (DICTS[lang]) {
        document.documentElement.lang = lang;
        var els = document.querySelectorAll('[data-t]');
        for (var i = 0; i < els.length; i++) { els[i].textContent = T(els[i].textContent.replace(/\s+/g, ' ').trim()); }
        document.title = T(document.title);
    }

    function $(id) { return document.getElementById(id); }
    function show(id) {
        ['step-code', 'step-key', 'step-password', 'step-confirm', 'step-done', 'step-info', 'step-end'].forEach(function (s) { $(s).className = s === id ? (s === 'step-key' || s === 'step-info' ? '' : 'card') : 'hidden'; });
    }
    function text(id, t, cls) { var e = $(id); e.textContent = t; if (cls) { e.className = cls; } }

    var HOST = location.hostname;
    var token = null;
    var made = null;        // { priv, pub, file } when this page made the key
    var keyType = '';
    var info = { purpose: 'key', port: 22, legacyRsa: false, hostKeys: [] };
    function portOpt() { return info.port && info.port !== 22 ? '-p ' + info.port + ' ' : ''; }

    function api(method, url, data, cb) {
        var x = new XMLHttpRequest();
        x.open(method, url, true);
        x.setRequestHeader('Content-Type', 'application/json');
        x.onreadystatechange = function () {
            if (x.readyState !== 4) { return; }
            var r = null;
            try { r = JSON.parse(x.responseText); } catch (e) { r = null; }
            cb(x.status, r || { error: x.status ? 'bad-reply' : 'offline' });
        };
        x.send(data ? JSON.stringify(data) : null);
    }

    function endWith(title, msg) {
        show('step-end');
        text('end-title', title);
        text('end-msg', msg);
    }

    var ERRORS = {
        'wrong': 'That code doesn\'t match.  Check the TV and try again ({n} tries left).',
        'new-code': 'Too many wrong tries, so the TV has a new code now.  Type the new one.',
        'locked': 'Too many wrong codes.  Open Set up a key on the TV again to start over.',
        'busy': 'Another device is already using this code.  Open Set up a key on the TV again to start over.',
        'not-ready': 'The TV isn\'t ready yet.  Try again in a moment.',
        'offline': 'Can\'t reach the TV.  Is the Set up a key screen still open on it?',
        'private': 'That\'s a private key.  Never share it: send the .pub file instead.',
        'one-key': 'Send one key at a time.',
        'empty': 'Pick a file or paste a key first.',
        'not-a-key': 'That doesn\'t look like a public key.  It should start with ssh-ed25519, ssh-rsa or ecdsa-sha2.',
        'not-paired': 'This page has timed out.  Open Set up a key on the TV again to start over.',
        'not-a-hash': 'The TV didn\'t take that password.  Try again.',
        'wrong-purpose': 'The TV is waiting for something else.  Start over on the TV.'
    };
    function errText(r) {
        return T(ERRORS[r.error] || 'Something went wrong ({e}).', { n: r.triesLeft, e: r.error });
    }

    // ------------------------------------------------------------ step 1

    var codeEl = $('code');
    codeEl.addEventListener('input', function () {
        var v = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        codeEl.value = v.length > 3 ? v.slice(0, 3) + '-' + v.slice(3) : v;
    });
    codeEl.addEventListener('keydown', function (e) { if (e.keyCode === 13) { sendCode(); } });
    $('code-go').addEventListener('click', sendCode);

    function sendCode() {
        var c = codeEl.value.replace(/[^A-Z0-9]/gi, '');
        if (c.length !== 6) { text('code-msg', T('The code has 6 letters and numbers.')); return; }
        $('code-go').disabled = true;
        api('POST', '/api/code', { code: c }, function (status, r) {
            $('code-go').disabled = false;
            if (r.ok && r.token) {
                token = r.token;
                if (r.info) { info = r.info; }
                if (info.purpose === 'info') { doneInfo(); } else if (info.purpose === 'password') { show('step-password'); $('pw1').focus(); } else { show('step-key'); }
                return;
            }
            if (r.error === 'new-code') { codeEl.value = ''; }
            if (r.error === 'locked' || r.error === 'busy') { endWith(T('Start over on the TV'), errText(r)); return; }
            text('code-msg', errText(r));
        });
    }

    // ------------------------------------------------------------ step 2

    var makeKey = window.SD_SSHKEY.makeKey;

    function save(name, content) {
        var blob = new Blob([content], { type: 'application/octet-stream' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.parentNode.removeChild(a); }, 1000);
    }

    $('make').addEventListener('click', function () {
        if (!window.nacl || !window.crypto || !window.crypto.getRandomValues) {
            text('make-msg', T('This browser can\'t make keys.  Use a key you already have, or try another browser.'), 'err');
            return;
        }
        var d = new Date();
        var stamp = d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
        var k = makeKey('lgtv-' + HOST.replace(/[^0-9a-z.]/gi, '') + '-' + stamp);
        made = { priv: k.priv, pub: k.pub, file: 'lgtv_ed25519' };
        save(made.file, made.priv);
        text('make-msg', T('Saved {file} to your downloads.  Keep it private: whoever has it can log in to your TV.', { file: made.file }), 'ok');
        sendKey(made.pub);
    });

    $('file').addEventListener('change', function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f) { return; }
        if (f.size > 16000) { text('send-msg', T(ERRORS['not-a-key'])); return; }
        var rd = new FileReader();
        rd.onload = function () { $('paste').value = String(rd.result); };
        rd.readAsText(f);
    });

    $('send').addEventListener('click', function () {
        made = null;
        sendKey($('paste').value);
    });

    function sendKey(key) {
        text('send-msg', '');
        api('POST', '/api/key', { token: token, key: key }, function (status, r) {
            if (!r.ok) {
                if (r.error === 'not-paired' || r.error === 'busy') { endWith(T('Start over on the TV'), errText(r)); return; }
                text(made ? 'make-msg' : 'send-msg', errText(r), 'err');
                return;
            }
            keyType = r.type;
            text('fp', r.type + ' ' + r.fp);
            show('step-confirm');
            poll();
        });
    }

    // ------------------------------------------------------------ step 2, password

    $('pw-show').addEventListener('change', function () {
        var t = $('pw-show').checked ? 'text' : 'password';
        $('pw1').type = t; $('pw2').type = t;
    });
    $('pw2').addEventListener('keydown', function (e) { if (e.keyCode === 13) { sendPassword(); } });
    $('pw-go').addEventListener('click', sendPassword);

    function sendPassword() {
        var a = $('pw1').value, b = $('pw2').value;
        if (a.length < 8) { text('pw-msg', T('Use at least 8 characters.')); return; }
        if (a !== b) { text('pw-msg', T('The two passwords are different.')); return; }
        if (/^alpine$/i.test(a) || /^(password|12345678|123456789|qwertyui)$/i.test(a)) { text('pw-msg', T('Pick a password that\'s harder to guess.')); return; }
        if (!window.SD_SHA512CRYPT || !window.nacl) { text('pw-msg', T('This browser can\'t do this.  Try another browser.')); return; }
        $('pw-go').disabled = true;
        text('pw-msg', T('Scrambling the password…'), 'dim');
        setTimeout(function () {
            var h;
            try { h = window.SD_SHA512CRYPT.hash(a); } catch (e) { $('pw-go').disabled = false; text('pw-msg', T('This browser can\'t do this.  Try another browser.'), 'err'); return; }
            $('pw1').value = ''; $('pw2').value = '';
            api('POST', '/api/password', { token: token, hash: h }, function (status, r) {
                $('pw-go').disabled = false;
                if (!r.ok) {
                    if (r.error === 'not-paired' || r.error === 'busy' || r.error === 'wrong-purpose') { endWith(T('Start over on the TV'), errText(r)); return; }
                    text('pw-msg', errText(r), 'err');
                    return;
                }
                text('confirm-intro', T('Your TV is asking whether to set this password.  Press OK on the remote.'));
                text('fp', '');
                show('step-confirm');
                poll();
            });
        }, 30);
    }

    // ------------------------------------------------------------ step 3

    function poll() {
        api('GET', '/api/status?token=' + encodeURIComponent(token), null, function (status, r) {
            if (r.state === 'accepted') { done(); return; }
            if (r.state === 'rejected') {
                endWith(T('Not changed'), info.purpose === 'password' ? T('The password was turned down on the TV.  Nothing changed.') : T('The key was turned down on the TV.  Nothing changed.'));
                return;
            }
            if (r.state === 'failed') {
                endWith(T('Not changed'), info.purpose === 'password' ? T('The TV couldn\'t set the password.  Check the SSH Doctor screen on the TV.') : T('The TV couldn\'t add the key.  Check the SSH Doctor screen on the TV.'));
                return;
            }
            if (r.state === 'expired' || r.state === 'stopped' || r.error) {
                endWith(T('Start over on the TV'), T('The pairing screen closed before the key was confirmed.  Nothing changed.'));
                return;
            }
            setTimeout(poll, 2000);
        });
    }

    // ------------------------------------------------------------ step 4

    function esc(x) { return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function pre(x) { return '<pre>' + esc(x) + '</pre>'; }
    function p(x) { return '<p>' + esc(x) + '</p>'; }
    var legacyOpts = function () { return info.legacyRsa ? '-o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa ' : ''; };

    // Logs in with a password rather than a key: after setting one, or on the
    // read-only page when the TV has no key yet
    function usesPassword() {
        if (info.purpose === 'password') { return true; }
        return info.purpose === 'info' && !(info.keys && info.keys.length);
    }

    function howto(os) {
        var host = HOST, f = made ? made.file : '', port = info.port || 22, pw = usesPassword();
        var cmd = 'ssh ' + legacyOpts() + portOpt();
        var h = '';
        if (os === 'unix') {
            if (made) {
                h += p(T('In Terminal, make the key private (ssh refuses it otherwise), then log in:'));
                h += pre('chmod 600 ~/Downloads/' + f + '\n' + cmd + '-i ~/Downloads/' + f + ' root@' + host);
                h += p(T('To keep it, move it to ~/.ssh/ and use that path instead.'));
            } else {
                h += p(T('In Terminal:'));
                h += pre(cmd + 'root@' + host);
            }
        } else if (os === 'win') {
            if (made) {
                h += p(T('In PowerShell, make the key readable only by you (Windows ssh refuses it otherwise), then log in:'));
                h += pre('icacls "$HOME\\Downloads\\' + f + '" /inheritance:r /grant:r "$($env:USERNAME):R"\n' + cmd + '-i "$HOME\\Downloads\\' + f + '" root@' + host);
            } else {
                h += p(T('In PowerShell or Command Prompt:'));
                h += pre(cmd + 'root@' + host);
            }
            h += p(T('For a Windows Terminal tab that opens the TV, add this to the profiles list in its settings.json (after the config below is in place):'));
            h += pre('{ "name": "LG TV", "commandline": "ssh lgtv" }');
        } else if (os === 'putty') {
            if (made) {
                h += p(T('PuTTY needs its own key format.  Open PuTTYgen, choose Load, pick {file} (show All files), then Save private key as {file}.ppk.', { file: f }));
            }
            h += p(pw ? T('In PuTTY, enter {host} on port {port}.  Log in as root with your password.', { host: host, port: port })
                : T('In PuTTY, enter {host} on port {port}.  Under Connection, SSH, Auth, Credentials, choose your .ppk file.  Log in as root.', { host: host, port: port }));
        } else if (os === 'files') {
            h += p(T('Your TV can send and receive files over SFTP.  In WinSCP, FileZilla or Cyberduck, choose SFTP, then:'));
            h += pre(T('Host: {host}\nPort: {port}\nUser: root', { host: host, port: port }));
            if (!pw) { h += p(T('Pick your key file as the private key (WinSCP and FileZilla offer to convert it).')); }
            h += p(T('Or from a terminal:'));
            h += pre('scp ' + (port !== 22 ? '-P ' + port + ' ' : '') + (made ? '-i ' + f + ' ' : '') + 'myfile.txt root@' + host + ':/home/root/');
        } else {
            h += p(T('In an SSH app like Termius, add a host: {host}, port {port}, user root.', { host: host, port: port }));
            if (made) { h += p(T('Import {file} from your downloads as its key.', { file: f })); }
            h += '<a class="btn" href="ssh://root@' + esc(host) + (port !== 22 ? ':' + port : '') + '">' + esc(T('Open in an SSH app')) + '</a>';
        }
        if (info.purpose === 'info' && info.password === 'alpine' && !(info.keys && info.keys.length)) {
            h += p(T('The password is alpine.  Set up a key on the TV to turn that off.'));
        }
        $('howto').innerHTML = h;
        addCopies($('howto'));
        var b = $('tabs').getElementsByTagName('button');
        for (var i = 0; i < b.length; i++) { b[i].className = b[i].getAttribute('data-os') === os ? 'on' : ''; }
    }

    function sshConfig() {
        var c = 'Host lgtv\n    HostName ' + HOST + '\n    User root\n';
        if (info.port && info.port !== 22) { c += '    Port ' + info.port + '\n'; }
        if (made) { c += '    IdentityFile ~/.ssh/' + made.file + '\n    IdentitiesOnly yes\n'; }
        if (info.legacyRsa) { c += '    HostKeyAlgorithms +ssh-rsa\n    PubkeyAcceptedAlgorithms +ssh-rsa\n'; }
        return c;
    }
    function knownHosts() {
        var name = info.port && info.port !== 22 ? '[' + HOST + ']:' + info.port : HOST;
        return (info.hostKeys || []).map(function (k) { return name + ' ' + k.line; }).join('\n');
    }

    // ------------------------------------------------------------ copying

    // A Copy button above each block of text.  The page is plain http, where
    // browsers don't offer the clipboard API, so a selected text area and
    // execCommand do it there.
    function copyText(t, btn) {
        var ok = false;
        var ta = document.createElement('textarea');
        ta.value = t;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.left = '0'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        try { ta.setSelectionRange(0, t.length); } catch (e) { /* older browsers */ }
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        if (!ok && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(t).then(function () { mark(btn, true); }, function () { mark(btn, false); });
            return;
        }
        mark(btn, ok);
    }
    function mark(btn, ok) {
        btn.textContent = ok ? T('Copied') : T('Select and copy it by hand');
        btn.className = 'copy' + (ok ? ' done' : '');
        setTimeout(function () { btn.textContent = T('Copy'); btn.className = 'copy'; }, 2500);
    }
    function addCopies(root) {
        var pres = root.getElementsByTagName('pre');
        for (var i = 0; i < pres.length; i++) {
            (function (pr) {
                if (pr.getAttribute('data-copy') || !pr.textContent) { return; }
                pr.setAttribute('data-copy', '1');
                var b = document.createElement('button');
                b.className = 'copy';
                b.type = 'button';
                b.textContent = T('Copy');
                b.addEventListener('click', function () { copyText(pr.textContent, b); });
                var w = document.createElement('div');
                w.className = 'cp';
                pr.parentNode.insertBefore(w, pr);
                w.appendChild(b);
                w.appendChild(pr);
            }(pres[i]));
        }
    }

    // ------------------------------------------------------------ read-only page

    function doneInfo() {
        done();
        document.title = T('Your LG TV, ready to copy');
        text('page-title', T('Your LG TV'));
        text('done-title', T('Your TV'));
        $('done-title').className = '';
        text('done-intro', T('Log in like this.  Everything on this page is ready to copy.'));
        text('alpine-note', '');
        $('step-info').className = '';
        var name = info.port && info.port !== 22 ? '[' + HOST + ']:' + info.port : HOST;
        var fps = (info.hostKeys || []).map(function (k) { return k.type + ' ' + k.fp; }).join('\n');
        $('info-tv').style.display = fps ? '' : 'none';
        $('info-fps').textContent = fps;
        $('info-forget').textContent = 'ssh-keygen -R ' + name;
        var keys = info.keys || [];
        $('info-keylist').innerHTML = keys.length ? '<table class="keys">' + keys.map(function (k) {
            return '<tr><td>' + esc(k.comment || T('(no name)')) + '<br><span class="dim">' + esc(k.type.replace('ssh-', '')) + '</span></td><td class="fp">' + esc(k.fp) + '</td></tr>';
        }).join('') + '</table>' : '<p class="dim">' + esc(T('No key can log in yet.  Use Set up a key on the TV to add one.')) + '</p>';
        $('info-report').style.display = info.report ? '' : 'none';
        $('info-report-text').textContent = info.report || '';
        addCopies($('step-info'));
        addCopies($('config-box'));
        if (START.s === 'files') { howto('files'); }
        var go = { report: 'info-report', keys: 'info-keys', tv: 'info-tv', files: 'step-done' }[START.s];
        if (go && $(go).scrollIntoView) { setTimeout(function () { $(go).scrollIntoView(); }, 50); }
    }

    function done() {
        show('step-done');
        if (info.purpose === 'password') {
            text('done-title', T('Done: the TV\'s password is set'));
            text('done-intro', T('Log in as root with the password you just chose, like this:'));
            text('alpine-note', '');
        } else {
            text('done-intro', made
                ? T('Your new key is saved as {file}.  Log in like this:', { file: made.file })
                : T('Log in with the key you sent, like this:'));
            text('alpine-note', T('If the TV still had its default alpine password, it stops working after the TV\'s next restart: from then on, only keys can log in.'));
        }
        $('config-box').className = '';
        $('config').textContent = sshConfig();
        var kh = knownHosts();
        $('known').textContent = kh;
        $('known').style.display = $('known-save').style.display = $('known-intro').style.display = kh ? '' : 'none';
        $('config-save').onclick = function () { save('lgtv-ssh-config.txt', sshConfig()); };
        $('known-save').onclick = function () { save('lgtv-known_hosts.txt', kh + '\n'); };
        var ua = navigator.userAgent;
        var os = /Windows/.test(ua) ? 'win' : /Android|iPhone|iPad/.test(ua) ? 'phone' : 'unix';
        howto(os);
        if (!tabsWired) {
            tabsWired = true;
            $('tabs').addEventListener('click', function (e) {
                var os2 = e.target.getAttribute && e.target.getAttribute('data-os');
                if (os2) { howto(os2); }
            });
        }
        addCopies($('config-box'));
    }
    var tabsWired = false;

    // The QR code on the TV: #c=CODE (and s=section), so scanning connects
    // straight away.  The code leaves the address bar right after.
    var START = {};
    String(location.hash || '').replace(/^#/, '').split('&').forEach(function (kv) {
        var i = kv.indexOf('=');
        if (i > 0) { START[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); }
    });
    if (location.hash && window.history && history.replaceState) { history.replaceState(null, '', location.pathname); }
    // Scanning a QR code while this page is already open only changes the #:
    // start over with the new code
    window.addEventListener('hashchange', function () { if (/[#&]c=/.test(location.hash)) { location.reload(); } });
    if (START.c && /^[A-Za-z0-9-]{6,7}$/.test(START.c)) {
        var c0 = START.c.toUpperCase().replace(/[^A-Z0-9]/g, '');
        codeEl.value = c0.slice(0, 3) + '-' + c0.slice(3);
        sendCode();
    } else {
        codeEl.focus();
    }
}());
