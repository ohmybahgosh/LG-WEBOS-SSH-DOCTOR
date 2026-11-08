/*
 * OpenSSH ed25519 key pairs, made with tweetnacl (window.nacl, or passed in).
 * The private key comes out in OpenSSH's own format, unencrypted, the same as
 * ssh-keygen -t ed25519 -N "".  Used by the pairing page; tests/check-sshkey.js
 * checks it against ssh-keygen.
 */
(function (root) {
    'use strict';
    // SSH wire format helpers
    function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
    function bytes(s) { var a = []; for (var i = 0; i < s.length; i++) { a.push(s.charCodeAt(i) & 255); } return a; }
    function str(a) { return u32(a.length).concat(a); }
    function arr(u8) { return Array.prototype.slice.call(u8); }
    function b64(a) {
        var s = '';
        for (var i = 0; i < a.length; i++) { s += String.fromCharCode(a[i]); }
        return btoa(s);
    }

    // An OpenSSH ed25519 key pair, unencrypted (like ssh-keygen -N "")
    function makeKey(comment) {
        var kp = nacl().sign.keyPair();
        var pub = arr(kp.publicKey), sec = arr(kp.secretKey); // sec = seed + pub
        var type = bytes('ssh-ed25519');
        var pubBlob = str(type).concat(str(pub));
        var check = u32(arr(nacl().randomBytes(4)).reduce(function (a, b) { return (a * 256 + b) >>> 0; }, 0));
        var priv = check.concat(check, str(type), str(pub), str(sec), str(bytes(comment)));
        for (var p = 1; priv.length % 8; p++) { priv.push(p); }
        var whole = bytes('openssh-key-v1').concat([0], str(bytes('none')), str(bytes('none')), str([]), u32(1), str(pubBlob), str(priv));
        var body = b64(whole).replace(/(.{70})/g, '$1\n');
        return {
            priv: '-----BEGIN OPENSSH PRIVATE KEY-----\n' + body.replace(/\n$/, '') + '\n-----END OPENSSH PRIVATE KEY-----\n',
            pub: 'ssh-ed25519 ' + b64(pubBlob) + ' ' + comment
        };
    }

    function nacl() { return root.nacl; }
    root.SD_SSHKEY = { makeKey: makeKey };
}(typeof window !== 'undefined' ? window : this));
