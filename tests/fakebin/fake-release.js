/*
 * A pretend GitHub for the update tests: the latest release's Homebrew
 * Channel manifest, its signature (by a key made for this run) and its
 * notes.  Writes "PORT PUBLIC-KEY" to READY_FILE.
 *
 *   node fake-release.js VERSION READY_FILE
 *
 * FAKE_IPK_URL or FAKE_IPK_V: a manifest that points somewhere it shouldn't.
 * FAKE_SIG=none|other-key|tampered: no signature, one by another key, or a
 * manifest changed after it was signed.
 */
'use strict';
var http = require('http');
var fs = require('fs');
var crypto = require('crypto');
var V = process.argv[2];
var IV = process.env.FAKE_IPK_V || V;
var NAME = 'org.ohmybahgosh.sshdoctor.manifest.json';

function keyPair() {
    var kp = crypto.generateKeyPairSync('ed25519');
    var der = kp.publicKey.export({ type: 'spki', format: 'der' });
    var pub = der.slice(der.length - 32);
    var id = crypto.createHash('sha256').update(pub).digest().slice(0, 8);
    return { priv: kp.privateKey, id: id, text: Buffer.concat([Buffer.from('Ed'), id, pub]).toString('base64') };
}
var KEY = keyPair(), OTHER = keyPair();

function minisig(k, data) {
    var sig = crypto.sign(null, data, k.priv);
    var trusted = 'timestamp:1794500000\tfile:' + NAME;
    var global = crypto.sign(null, Buffer.concat([sig, Buffer.from(trusted)]), k.priv);
    return 'untrusted comment: test\n' + Buffer.concat([Buffer.from('Ed'), k.id, sig]).toString('base64') + '\n'
        + 'trusted comment: ' + trusted + '\n' + global.toString('base64') + '\n';
}

var s = http.createServer(function (req, res) {
    var manifest = JSON.stringify({ id: 'org.ohmybahgosh.sshdoctor', version: V,
        ipkUrl: process.env.FAKE_IPK_URL || 'http://127.0.0.1:' + s.address().port + '/rel/download/v' + IV + '/org.ohmybahgosh.sshdoctor_' + IV + '_all.ipk',
        ipkHash: { sha256: 'ab'.repeat(32) } });
    var how = process.env.FAKE_SIG || '';
    if (req.url === '/rel/latest/download/' + NAME) {
        res.writeHead(302, { Location: '/files/manifest.json' }); res.end(); return;
    }
    if (req.url === '/files/manifest.json') {
        res.end(how === 'tampered' ? manifest.replace('"ipkHash"', '"x":1,"ipkHash"') : manifest);
        return;
    }
    if (req.url === '/rel/latest/download/' + NAME + '.minisig' && how !== 'none') {
        res.end(minisig(how === 'other-key' ? OTHER : KEY, Buffer.from(manifest)));
        return;
    }
    if (req.url === '/api/releases/latest') {
        res.end(JSON.stringify({ tag_name: 'v' + V, published_at: '2026-11-12T12:00:00Z', body: '### Added\n\n- **Something new.**' }));
        return;
    }
    res.statusCode = 404; res.end();
});
s.listen(0, '127.0.0.1', function () { fs.writeFileSync(process.argv[3], s.address().port + ' ' + KEY.text); });
setTimeout(function () { process.exit(0); }, 60000);
