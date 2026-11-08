/*
 * The pairing page's script.  It only talks to the TV it came from.  A key it
 * makes is an ed25519 pair made here with tweetnacl and this browser's random
 * numbers: the private key is saved as a file on this device and never sent.
 * A password is turned into a SHA-512 crypt hash here, and only the hash is
 * sent.
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
        ['step-code', 'step-key', 'step-password', 'step-confirm', 'step-done', 'step-end'].forEach(function (s) { $(s).className = s === id ? (s === 'step-key' ? '' : 'card') : 'hidden'; });
        if (id === 'step-key') { $(id).className = ''; }
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
                if (info.purpose === 'password') { show('step-password'); $('pw1').focus(); } else { show('step-key'); }
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

    function howto(os) {
        var host = HOST, f = made ? made.file : '', port = info.port || 22, pw = info.purpose === 'password';
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
        }
        $('howto').innerHTML = h;
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
        $('tabs').addEventListener('click', function (e) {
            var os2 = e.target.getAttribute && e.target.getAttribute('data-os');
            if (os2) { howto(os2); }
        });
    }

    codeEl.focus();
}());
