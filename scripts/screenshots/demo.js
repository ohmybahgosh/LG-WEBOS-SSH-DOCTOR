// Made-up answers from ssh-doctor.sh, so the TV app can run in a desktop
// browser: load it before app.js.  Pick a TV with ?s=healthy, alpine, locked,
// off or messy.  The pairing screen plays out by itself: a phone connects,
// then sends a key.
(function () {
    'use strict';
    var q = {};
    location.search.replace(/[?&]([^=&]+)=([^&]*)/g, function (m, k, v) { q[k] = decodeURIComponent(v); });
    var s = q.s || 'healthy';
    var host = [
        { type: 'ecdsa-sha2-nistp256', fp: 'SHA256:B5C9KdfzASiX45I7uRBUmHj9smXwnI7jxbdGvWkPQcQ' },
        { type: 'ssh-ed25519', fp: 'SHA256:oSe4QYniN2UbVtd+XkwQEqjqJ6GPF2e9qDFHwLc4j2s' },
        { type: 'ssh-rsa', fp: 'SHA256:0+Bbg/DcPTyzN9cG2jg00lDOV26ns23I1ilRaGycXM8' }
    ];
    var base = {
        version: '0.1.0', hbc: true, sshEnabled: true, running: true, listening: true, dropbear: '2022.83',
        password: 'none', keys: 1, keyFile: true, keyProblems: '', permProblems: '', telnet: true, telnetRunning: true,
        failsafe: false, legacyRsa: false, ips: ['192.168.1.50'], hostKeys: host, findings: []
    };
    function f(code, level) { return { code: code, level: level || 'problem' }; }
    var TVS = {
        healthy: {},
        alpine: { password: 'alpine', keys: 0, keyFile: false, findings: [f('password-default', 'tip')] },
        locked: { keys: 0, keyProblems: 'crlf private nokeys', findings: [f('no-way-in'), f('keys-private'), f('keys-fixable'), f('telnet-off', 'tip')], telnet: false },
        off: { sshEnabled: false, running: false, listening: false, findings: [f('ssh-off')] },
        messy: { sshEnabled: false, listening: true, keys: 2, keyProblems: 'crlf wrapped bad', permProblems: 'file', legacyRsa: true, dropbear: '2019.78',
            findings: [f('keys-fixable'), f('keys-bad'), f('perms'), f('ssh-off-next-boot', 'tip')] }
    };
    var st = {};
    for (var k in base) { st[k] = base[k]; }
    var o = TVS[s] || {};
    for (k in o) { st[k] = o[k]; }

    var polls = 0;
    var started = 0;
    var REPLIES = {
        'backups': s === 'messy' ? 'authorized_keys.ssh-doctor-20261108-120000\n' : '',
        'keys --json': JSON.stringify(st.keys ? [
            { type: 'ssh-ed25519', fp: 'SHA256:m3MvfV9IuUH4vKFN5CRBQGhIDOEanmNp29OKzXEOpRI', comment: 'bob@laptop', bits: null },
            { type: 'ssh-rsa', fp: 'SHA256:LIutHwKSTuDLiEUKXphyCUxXto403BYsKDYyjfiNeLk', comment: 'bob@desktop', bits: 4096 }
        ].slice(0, st.keys) : []),
        'ssh-on': 'Turned SSH on in the Homebrew Channel\'s settings.\nStarted the SSH server on port 22.',
        'fix-keys': 'Backed up /home/root/.ssh/authorized_keys to /home/root/.ssh/authorized_keys.ssh-doctor-20261108-120000\nMoved what isn\'t a public key to /home/root/.ssh/authorized_keys.rejected-20261108-120000\nRewrote /home/root/.ssh/authorized_keys (found: crlf private)\nUsable keys now: 1',
        'password-on': 'Set the keys file aside as /home/root/.ssh/authorized_keys.ssh-doctor-off-20261108-120000\nPassword login is on: user root, password alpine.  It stays on after a restart until a key is added.',
        'pair-accept': 'Backed up /home/root/.ssh/authorized_keys to /home/root/.ssh/authorized_keys.ssh-doctor-20261108-120100\nAdded the key.\nThis is the first key, so after the next restart the alpine password stops working and only keys can log in.',
        'pair-stop': '{"state":"stopped"}',
        'pair-reject': '{"state":"rejected"}'
    };
    function pairState() {
        polls++;
        var p = { state: 'waiting', code: 'K7F-3QX', port: 28622, ips: st.ips, expires: started + 300000, triesLeft: 5, key: null };
        if (q.pair === 'wait') { return p; }
        if (polls > 2) { p.state = 'paired'; p.code = ''; }
        if (polls > 4) {
            p.state = 'pending';
            p.key = { type: 'ssh-ed25519', fp: 'SHA256:m3MvfV9IuUH4vKFN5CRBQGhIDOEanmNp29OKzXEOpRI', comment: 'lgtv-192.168.1.50-20261108', bits: null };
        }
        return p;
    }
    window.SD_DEMO = function (args, cb) {
        setTimeout(function () {
            if (args === 'status --json') { return cb(true, JSON.stringify(st), ''); }
            if (args === 'pair-start') { started = new Date().getTime(); polls = 0; return cb(true, JSON.stringify(pairState()), ''); }
            if (args === 'pair-status') { return cb(true, JSON.stringify(pairState()), ''); }
            if (args.indexOf('restore') === 0) { return cb(true, 'Put authorized_keys.ssh-doctor-20261108-120000 back as authorized_keys.', ''); }
            cb(true, REPLIES[args] || '', '');
        }, 120);
    };
}());
