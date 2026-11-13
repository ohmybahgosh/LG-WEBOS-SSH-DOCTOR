/*
 * Release signatures: scripts/release-sign.js signs in minisign's format,
 * and update.js accepts exactly those, with tweetnacl (what the TV uses)
 * and with Node.js's own crypto.  The key in update.js is the one
 * SECURITY.md publishes, and only a test server can replace it.
 *
 *   node tests/check-signing.js .cache/tweetnacl-1.0.3-nacl-fast.min.js
 */
'use strict';
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..');
var NACL = process.argv[2];
var bad = 0;
function ok(what, v) { if (!v) { bad++; console.log('not ok: ' + what); } }

var T = fs.mkdtempSync(path.join(os.tmpdir(), 'sdsign.'));
var key = path.join(T, 'k.pem');
var pub = cp.execFileSync('node', [path.join(ROOT, 'scripts/release-sign.js'), '--new-key', key]).toString().trim();
ok('key file private', (fs.statSync(key).mode & 63) === 0);
ok('no second key over the first', cp.spawnSync('node', [path.join(ROOT, 'scripts/release-sign.js'), '--new-key', key]).status !== 0);
var other = cp.execFileSync('node', [path.join(ROOT, 'scripts/release-sign.js'), '--new-key', path.join(T, 'o.pem')]).toString().trim();
var name = 'org.ohmybahgosh.sshdoctor.manifest.json';
var file = path.join(T, name);
fs.writeFileSync(file, '{"version":"9.9.9"}');
cp.execFileSync('node', [path.join(ROOT, 'scripts/release-sign.js'), file], { env: { PATH: process.env.PATH, RELEASE_SIGNING_KEY: fs.readFileSync(key, 'utf8') } });
var data = fs.readFileSync(file), sig = fs.readFileSync(file + '.minisig', 'utf8');

// With Node's crypto (no nacl next to update.js in the repository), then
// with tweetnacl, as on the TV
fs.copyFileSync(path.join(ROOT, 'update.js'), path.join(T, 'update.js'));
fs.copyFileSync(NACL, path.join(T, 'nacl-fast.min.js'));
[['crypto', require(path.join(ROOT, 'update.js'))], ['tweetnacl', require(path.join(T, 'update.js'))]].forEach(function (x) {
    var v = x[1].verify, w = x[0];
    ok(w + ': signed file accepted', v(data, sig, pub, name));
    ok(w + ': changed file refused', !v(Buffer.from('{"version":"9.9.8"}'), sig, pub, name));
    ok(w + ': other key refused', !v(data, sig, other, name));
    ok(w + ': signed for another file refused', !v(data, sig, pub, 'SHA256SUMS'));
    ok(w + ': changed trusted comment refused', !v(data, sig.replace('file:', 'file:x'), pub, null));
    ok(w + ': garbage refused', !v(data, 'nope', pub, name) && !v(data, sig, 'nope', name));
});

// minisign itself agrees, when it's installed
if (cp.spawnSync('minisign', ['-v']).status === 0) {
    ok('minisign verifies it', cp.spawnSync('minisign', ['-Vm', file, '-P', pub]).status === 0);
}

// The published key, and no swapping it without a test server
var u = require(path.join(ROOT, 'update.js'));
ok('update.js has the key from SECURITY.md', fs.readFileSync(path.join(ROOT, 'SECURITY.md'), 'utf8').indexOf(u.RELEASE_PUBKEY) >= 0);
var r = cp.spawnSync('node', ['-e', 'console.log(require(process.argv[1]).PUBKEY)', path.join(ROOT, 'update.js')], { env: { PATH: process.env.PATH, SD_RELEASE_PUBKEY: 'x' } });
ok('SD_RELEASE_PUBKEY alone changes nothing', String(r.stdout).trim() === u.RELEASE_PUBKEY);
// No Ed25519 private key (PKCS#8, as release-sign.js makes them) anywhere in
// the repository
var found = String(cp.spawnSync('git', ['-C', ROOT, 'grep', '--untracked', '-l', '-e', 'MC4CAQAwBQYDK2VwBCIE', '--', '.', ':!tests/check-signing.js']).stdout || '').trim();
ok('no private key in the repository: ' + found, found === '');

fs.rmSync(T, { recursive: true, force: true });
console.log(bad ? bad + ' signing checks failed' : 'signing: all checks pass');
process.exit(bad ? 1 : 0);
