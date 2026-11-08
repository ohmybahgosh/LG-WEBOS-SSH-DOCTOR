// The pairing page's key pairs (sshkey.js) are real OpenSSH keys: ssh-keygen
// reads each private key, derives the same public key, and signs with it.
//
//   node tests/check-sshkey.js NACL_JS   (tweetnacl's nacl-fast.min.js)
'use strict';
var fs = require('fs');
var os = require('os');
var path = require('path');
var vm = require('vm');
var cp = require('child_process');

var naclFile = process.argv[2];
if (!naclFile) { console.error('Usage: node tests/check-sshkey.js NACL_JS'); process.exit(2); }

var box = { btoa: function (s) { return Buffer.from(s, 'binary').toString('base64'); }, crypto: require('crypto').webcrypto };
box.self = box;
box.window = box;
vm.createContext(box);
vm.runInContext(fs.readFileSync(naclFile, 'utf8'), box);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../sshkey.js'), 'utf8'), box);

var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sshkey-'));
var bad = 0;
for (var i = 0; i < 20; i++) {
    var k = box.SD_SSHKEY.makeKey('lgtv-test-' + i);
    var f = path.join(dir, 'k' + i);
    fs.writeFileSync(f, k.priv, { mode: 384 });
    var pub = cp.execFileSync('ssh-keygen', ['-y', '-f', f]).toString().trim();
    var want = k.pub.split(' ').slice(0, 2).join(' ');
    if (pub.split(' ').slice(0, 2).join(' ') !== want) { console.log('public key differs: ' + pub + ' vs ' + want); bad++; }
    fs.writeFileSync(f + '.msg', 'hello');
    try {
        cp.execFileSync('ssh-keygen', ['-Y', 'sign', '-f', f, '-n', 'test', f + '.msg'], { stdio: 'pipe' });
        fs.writeFileSync(f + '.allowed', 'me ' + k.pub + '\n');
        cp.execFileSync('ssh-keygen', ['-Y', 'verify', '-f', f + '.allowed', '-I', 'me', '-n', 'test', '-s', f + '.msg.sig'],
            { input: 'hello', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { console.log('signing failed: ' + (e.stderr || e.message)); bad++; }
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(bad ? bad + ' problems' : '20 keys: ssh-keygen reads them and signs with them');
process.exit(bad ? 1 : 0);
