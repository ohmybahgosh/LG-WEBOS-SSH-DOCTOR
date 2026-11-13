/*
 * Signs release files with the project's Ed25519 release key, in minisign's
 * format, so anyone can check them with minisign and the app can check an
 * update before it installs it.
 *
 *   RELEASE_SIGNING_KEY="$(cat key.pem)" node scripts/release-sign.js FILE...
 *       writes FILE.minisig next to each FILE
 *   node scripts/release-sign.js --new-key KEYFILE
 *       makes a new key: the private half in KEYFILE (PEM, readable by you
 *       only, never in the repository), the public key on stdout
 *   node scripts/release-sign.js --public-key
 *       the public key for the private key in RELEASE_SIGNING_KEY
 *
 * Signatures are minisign's original kind (Ed25519 over the file itself,
 * "Ed"), which the app checks with tweetnacl on any Node.js.  Check one by
 * hand with:  minisign -Vm FILE -P <public key from SECURITY.md>
 */
'use strict';
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

// The raw 32-byte public key, from a private key
function rawPublic(priv) {
    var der = crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' });
    return der.slice(der.length - 32);
}
// minisign's key id: 8 bytes, here the start of the public key's SHA-256
function keyId(pub) { return crypto.createHash('sha256').update(pub).digest().slice(0, 8); }
function idHex(id) { return Buffer.from(id).reverse().toString('hex').toUpperCase(); }

function publicKeyText(priv) {
    var pub = rawPublic(priv), id = keyId(pub);
    return Buffer.concat([Buffer.from('Ed'), id, pub]).toString('base64');
}

function sign(priv, file) {
    var pub = rawPublic(priv), id = keyId(pub);
    var data = fs.readFileSync(file);
    var sig = crypto.sign(null, data, priv);
    var trusted = 'timestamp:' + Math.floor(Date.now() / 1000) + '\tfile:' + path.basename(file);
    var global = crypto.sign(null, Buffer.concat([sig, Buffer.from(trusted)]), priv);
    fs.writeFileSync(file + '.minisig',
        'untrusted comment: signature from LG webOS SSH Doctor release key ' + idHex(id) + '\n'
        + Buffer.concat([Buffer.from('Ed'), id, sig]).toString('base64') + '\n'
        + 'trusted comment: ' + trusted + '\n'
        + global.toString('base64') + '\n');
}

function key() {
    var pem = process.env.RELEASE_SIGNING_KEY || '';
    if (!/BEGIN PRIVATE KEY/.test(pem)) { console.error('RELEASE_SIGNING_KEY is not set to the private key (PEM).'); process.exit(2); }
    return crypto.createPrivateKey(pem);
}

var a = process.argv.slice(2);
if (a[0] === '--new-key') {
    if (!a[1]) { console.error('Usage: node scripts/release-sign.js --new-key KEYFILE'); process.exit(2); }
    if (fs.existsSync(a[1])) { console.error(a[1] + ' already exists; not replacing a key.'); process.exit(1); }
    var kp = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(a[1], kp.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 384, flag: 'wx' });
    process.stdout.write(publicKeyText(kp.privateKey) + '\n');
} else if (a[0] === '--public-key') {
    process.stdout.write(publicKeyText(key()) + '\n');
} else if (a.length) {
    var k = key();
    a.forEach(function (f) { sign(k, f); console.log('Signed ' + f); });
} else {
    console.error('Usage: node scripts/release-sign.js FILE... | --new-key KEYFILE | --public-key');
    process.exit(2);
}
