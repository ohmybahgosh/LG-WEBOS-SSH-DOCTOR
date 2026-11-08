// sha512crypt.js gives the same hashes as glibc's crypt() (through python3),
// in Node.js and with tweetnacl's SHA-512 (as in a browser).
//
//   node tests/check-sha512crypt.js [path/to/nacl-fast.min.js]
'use strict';
var cp = require('child_process');
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var C = require('../sha512crypt.js');
var src = fs.readFileSync(path.join(__dirname, '../sha512crypt.js'), 'utf8');
var bad = 0;
var cases = [
    ['alpine', 'saltsalt'], ['', 'abc'], ['correct horse battery staple', 'Zx./9aB'],
    [new Array(80).join('x'), '0123456789abcdef'], [new Array(140).join('pw'), 'q'], ['пароль ñandú', 'u8salt'],
    ['a', 'ABCDEFGHIJKLMNOPQRS']
];
var nacl = null;
if (process.argv[2]) {
    nacl = require(path.resolve(process.argv[2]));
}
cases.forEach(function (c) {
    var want = cp.execFileSync('python3', ['-c', 'import ctypes,ctypes.util,sys\nl=ctypes.CDLL(ctypes.util.find_library("crypt"))\nl.crypt.restype=ctypes.c_char_p\n' +
        'print(l.crypt(sys.stdin.buffer.read(), ("$6$"+sys.argv[1]+"$").encode()).decode())', c[1].slice(0, 16)], { input: Buffer.from(c[0], 'utf8') }).toString().trim();
    var got = C.crypt(c[0], c[1]);
    if (got !== want) { bad++; console.log('node mismatch for ' + JSON.stringify(c) + '\n  ' + got + '\n  ' + want); }
    if (nacl) {
        var w = { nacl: nacl, crypto: { getRandomValues: function (u) { return require('crypto').randomFillSync(u); } } };
        vm.runInNewContext(src, { window: w, unescape: unescape, encodeURIComponent: encodeURIComponent, Uint8Array: Uint8Array });
        var got2 = w.SD_SHA512CRYPT.crypt(c[0], c[1]);
        if (got2 !== want) { bad++; console.log('browser mismatch for ' + JSON.stringify(c)); }
    }
});
var h = C.hash('x');
if (!/^\$6\$[./0-9A-Za-z]{16}\$[./0-9A-Za-z]{86}$/.test(h)) { bad++; console.log('bad random hash ' + h); }
if (C.hash('x') === h) { bad++; console.log('salt not random'); }
console.log(bad ? bad + ' problems' : 'sha512crypt: ' + cases.length + ' hashes match glibc crypt()' + (nacl ? ', in Node.js and with tweetnacl' : ''));
process.exit(bad ? 1 : 0);
