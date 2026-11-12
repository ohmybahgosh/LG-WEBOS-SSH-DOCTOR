// Made-up answers from ssh-doctor.sh, so the TV app can run in a desktop
// browser: load it before app.js.  Pick a TV with ?s=healthy, alpine, locked,
// off, messy, entware, exposed or custom (its own settings, a port change underway).  ?pair=password
// plays the pairing screen for a password.  The pairing screen plays out by itself: a phone connects,
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
        version: '0.3.0', hbc: true, sshEnabled: true, running: true, listening: true, dropbear: '2022.83',
        password: 'none', keys: 1, keyFile: true, keyProblems: '', permProblems: '', telnet: true, telnetRunning: true,
        failsafe: false, legacyRsa: false, ips: ['192.168.1.50'], hostKeys: host, findings: [],
        port: 22, portOwner: 'hbc', keysOnly: false, sftp: true, failedLogins: 0,
        settings: { port: 22, trial: null, keysOnly: false, keepalive: false, password: false, hook: false, applied: true, flags: '-R' },
        servers: [{ pid: 5550, kind: 'hbc', name: 'dropbear', ports: [22], cmd: '/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/bin/dropbear -R' }],
        sessions: { '22': 1 }, entwareInstalled: false
    };
    function f(code, level) { return { code: code, level: level || 'problem' }; }
    var TVS = {
        healthy: {},
        alpine: { password: 'alpine', keys: 0, keyFile: false, findings: [f('password-default', 'tip')] },
        locked: { keys: 0, keyProblems: 'crlf private nokeys', findings: [f('no-way-in'), f('keys-private'), f('keys-fixable'), f('telnet-off', 'tip')], telnet: false },
        off: { sshEnabled: false, running: false, listening: false, findings: [f('ssh-off')] },
        messy: { sshEnabled: false, listening: true, keys: 2, keyProblems: 'crlf wrapped bad', permProblems: 'file', legacyRsa: true, dropbear: '2019.78',
            findings: [f('keys-fixable'), f('keys-bad'), f('perms'), f('ssh-off-next-boot', 'tip')] },
        custom: { port: 2222, password: 'set', keys: 2, keysOnly: false, failedLogins: 7,
            settings: { port: 2222, trial: 22, keysOnly: false, keepalive: true, password: true, hook: true, applied: true, flags: '-R -p 2222 -p 22 -K 30' },
            servers: [{ pid: 5550, kind: 'hbc', name: 'dropbear', ports: [22, 2222], cmd: '/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/bin/dropbear -R -p 2222 -p 22 -K 30' },
                { pid: 7001, kind: 'entware-openssh', name: 'sshd', ports: [2200], cmd: '/opt/sbin/sshd' }],
            sessions: { '2222': 1, '22': 0 },
            findings: [f('port-trial', 'tip'), f('failed-logins', 'tip'), f('other-ssh', 'tip')] },
        // The Homebrew Channel's SSH off, Entware's OpenSSH on 22, Entware's dropbear installed but stopped
        entware: { sshEnabled: false, running: false, listening: false, portOwner: 'entware-openssh', active: 'entware-openssh', entwareInstalled: true,
            entwarePassword: 'none', entwareLogin: true,
            servers: [{ pid: 7001, kind: 'entware-openssh', name: 'sshd', ports: [22], cmd: '/opt/sbin/sshd' },
                { pid: 7300, kind: 'devmode', name: 'sshd', ports: [9922], cmd: '/usr/sbin/sshd -f /etc/devmode/sshd_config' }],
            entware: [{ kind: 'entware-openssh', running: true, ports: [22], port: 22, startScript: true, passwordOff: true, problems: ['sshd-keyfile-elsewhere'], detail: '' },
                { kind: 'entware-dropbear', running: false, ports: [], port: 22, startScript: true, passwordOff: false, problems: ['entware-port-clash'], detail: '' }],
            findings: [f('entware-port-clash'), f('ssh-is-entware', 'tip'), f('sshd-keyfile-elsewhere', 'tip')] },
        // The router forwards SSH and telnet to the internet; SSH was started at the last restart
        exposed: { password: 'alpine', keys: 0, keyFile: false,
            settings: { port: 22, trial: null, keysOnly: false, keepalive: false, bootFix: true, password: false, hook: true, applied: true, flags: '-R', lastBoot: { t: '2026-11-09T07:02:11', result: 'started' } },
            exposure: { router: 'found', name: 'ASUS GT-AXE16000', mappings: [], exposed: [
                { protocol: 'TCP', external: 2222, internal: 22, client: '192.168.1.50', enabled: true, remote: '', description: 'ssh' },
                { protocol: 'TCP', external: 23, internal: 23, client: '192.168.1.50', enabled: true, remote: '', description: '' }] },
            findings: [f('telnet-exposed'), f('ssh-exposed'), f('boot-started', 'tip'), f('password-default', 'tip')] }
    };
    var st = {};
    for (var k in base) { st[k] = base[k]; }
    var o = TVS[s] || {};
    for (k in o) { st[k] = o[k]; }

    var polls = 0;
    var purpose = 'key';
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
        'logins --json': JSON.stringify({ ok: 4, failed: st.failedLogins, since: '2026-11-08T09:12:40Z',
            events: [
                { t: '2026-11-08T12:31:05Z', kind: 'key', user: 'root', ip: '192.168.1.20', fp: 'SHA256:m3MvfV9IuUH4vKFN5CRBQGhIDOEanmNp29OKzXEOpRI' },
                { t: '2026-11-08T11:58:44Z', kind: 'bad-password', user: 'root', ip: '192.168.1.77', fp: '' },
                { t: '2026-11-08T11:58:40Z', kind: 'bad-user', user: '', ip: '192.168.1.77', fp: '' },
                { t: '2026-11-08T10:02:13Z', kind: 'password', user: 'root', ip: '192.168.1.20', fp: '' },
                { t: '2026-11-08T09:12:40Z', kind: 'key', user: 'root', ip: '192.168.1.21', fp: 'SHA256:LIutHwKSTuDLiEUKXphyCUxXto403BYsKDYyjfiNeLk' }
            ],
            failedFrom: st.failedLogins ? [{ ip: '192.168.1.77', n: st.failedLogins }] : [],
            lastUsed: { 'SHA256:m3MvfV9IuUH4vKFN5CRBQGhIDOEanmNp29OKzXEOpRI': '2026-11-08T12:31:05Z' } }),
        'hostkeys --json': JSON.stringify(host.map(function (h) { return { type: h.type, fp: h.fp, line: h.type + ' AAAA' }; })),
        'report': 'LG webOS SSH Doctor 0.3.0 report\nwebOS: 9.2.0\nKernel: 5.4.268\nHomebrew Channel: installed, SSH switch yes, telnet yes, failsafe no\ndropbear: 2022.83, running yes, port 22, owner hbc\nOptions: wanted -R, running -R\nLogin: password none, keys 1, keys only no\nFindings: \nLogins in the log: 4 logins, 0 failed tries',
        'pair-reject': '{"state":"rejected"}',
        'exposure --json': JSON.stringify(st.exposure || { router: 'found', name: 'ASUS GT-AXE16000', mappings: [], exposed: [] }),
        'kit-list --json': JSON.stringify([{ name: '20261109-071500', saved: '2026-11-09T07:15:00', version: '0.4.0', keys: 2, hostKeys: 3, settings: true, password: true }]),
        'kit-save': 'Saved to /tmp/usb/sda/sda1/ssh-doctor-kit/20261109-071500\nIt has the TV\'s private SSH keys in it, so keep the drive somewhere safe.',
        'kit-restore \'20261109-071500\'': 'Backed up /home/root/.ssh/authorized_keys to /home/root/.ssh/authorized_keys.ssh-doctor-20261109-071600\nPut back the keys file: 2 keys.\nBacked up the TV\'s SSH keys to /var/lib/webosbrew/sshd.ssh-doctor-20261109-071600\nPut back the TV\'s SSH keys, so computers that logged in before don\'t warn.\nPut back the SSH settings.\nPut back your own password.',
        'exposure-close': 'Took the forwards off the router.\nThe router doesn\'t forward SSH or telnet to this TV any more.'
    };
    function pairState() {
        polls++;
        var p = { state: 'waiting', purpose: purpose, code: 'K7F-3QX', port: 28622, ips: st.ips, expires: started + 300000, triesLeft: 5, key: null, password: false };
        if (q.pair === 'wait') { return p; }
        if (polls > 2) { p.state = 'paired'; p.code = ''; }
        if (polls > 4 && purpose === 'password') { p.state = 'pending'; p.password = true; return p; }
        if (polls > 4) {
            p.state = 'pending';
            p.key = { type: 'ssh-ed25519', fp: 'SHA256:m3MvfV9IuUH4vKFN5CRBQGhIDOEanmNp29OKzXEOpRI', comment: 'lgtv-192.168.1.50-20261108', bits: null };
        }
        return p;
    }
    window.SD_DEMO = function (args, cb) {
        setTimeout(function () {
            if (args === 'status --json') { return cb(true, JSON.stringify(st), ''); }
            if (args.indexOf('pair-start') === 0) { purpose = args.indexOf('password') > 0 ? 'password' : 'key'; started = new Date().getTime(); polls = 0; return cb(true, JSON.stringify(pairState()), ''); }
            if (args === 'pair-status') { return cb(true, JSON.stringify(pairState()), ''); }
            if (args.indexOf('restore') === 0) { return cb(true, 'Put authorized_keys.ssh-doctor-20261108-120000 back as authorized_keys.', ''); }
            cb(true, REPLIES[args] || '', '');
        }, 120);
    };
}());
