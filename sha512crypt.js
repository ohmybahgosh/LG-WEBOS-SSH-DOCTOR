/*
 * SHA-512 crypt ("$6$salt$hash"), the password hash glibc's crypt() checks,
 * so a password can be turned into a hash on the TV screen or on a phone and
 * only the hash is sent.  Plain ES5: runs in old webOS browsers, any phone
 * browser (with tweetnacl's nacl.hash for SHA-512) and Node.js.
 *
 *   SD_SHA512CRYPT.hash(password)            a hash with a new random salt
 *   SD_SHA512CRYPT.crypt(password, salt)     the hash for that salt
 *
 * Follows Ulrich Drepper's "Unix crypt using SHA-256 and SHA-512" with the
 * default 5000 rounds.
 */
(function (root) {
    'use strict';

    var ITOA = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

    function nodeCrypto() {
        try { return typeof require === 'function' ? require('crypto') : null; } catch (e) { return null; }
    }

    // SHA-512 of an array of bytes, as an array of bytes
    function sha512(bytes) {
        if (root.nacl && root.nacl.hash) { return Array.prototype.slice.call(root.nacl.hash(new Uint8Array(bytes))); }
        var c = nodeCrypto();
        if (c) {
            var b = typeof Buffer.from === 'function' ? Buffer.from(bytes) : new Buffer(bytes);
            return Array.prototype.slice.call(c.createHash('sha512').update(b).digest());
        }
        throw new Error('No SHA-512 here');
    }

    function utf8(s) {
        var u = unescape(encodeURIComponent(String(s)));
        var out = [];
        for (var i = 0; i < u.length; i++) { out.push(u.charCodeAt(i)); }
        return out;
    }

    // n bytes of src, repeated as needed
    function rep(src, n) {
        var out = [];
        for (var i = 0; i < n; i++) { out.push(src[i % src.length]); }
        return out;
    }

    function crypt(password, salt) {
        var P = utf8(password);
        var S = utf8(String(salt).slice(0, 16));
        var plen = P.length, slen = S.length, i;

        var B = sha512(P.concat(S, P));
        var a = P.concat(S);
        for (i = plen; i > 64; i -= 64) { a = a.concat(B); }
        a = a.concat(B.slice(0, i));
        for (i = plen; i > 0; i >>= 1) { a = a.concat(i & 1 ? B : P); }
        var A = sha512(a);

        var dp = [];
        for (i = 0; i < plen; i++) { dp = dp.concat(P); }
        var Pp = rep(sha512(dp), plen);
        var ds = [];
        for (i = 0; i < 16 + A[0]; i++) { ds = ds.concat(S); }
        var Ss = slen ? rep(sha512(ds), slen) : [];

        var C = A;
        for (i = 0; i < 5000; i++) {
            var x = (i & 1) ? Pp : C;
            if (i % 3) { x = x.concat(Ss); }
            if (i % 7) { x = x.concat(Pp); }
            x = x.concat((i & 1) ? C : Pp);
            C = sha512(x);
        }

        var out = '';
        function b64(b2, b1, b0, n) {
            var w = (b2 << 16) | (b1 << 8) | b0;
            while (n-- > 0) { out += ITOA.charAt(w & 0x3f); w >>= 6; }
        }
        var order = [[0, 21, 42], [22, 43, 1], [44, 2, 23], [3, 24, 45], [25, 46, 4], [47, 5, 26], [6, 27, 48],
            [28, 49, 7], [50, 8, 29], [9, 30, 51], [31, 52, 10], [53, 11, 32], [12, 33, 54], [34, 55, 13],
            [56, 14, 35], [15, 36, 57], [37, 58, 16], [59, 17, 38], [18, 39, 60], [40, 61, 19], [62, 20, 41]];
        for (i = 0; i < order.length; i++) { b64(C[order[i][0]], C[order[i][1]], C[order[i][2]], 4); }
        b64(0, 0, C[63], 2);
        return '$6$' + String(salt).slice(0, 16) + '$' + out;
    }

    function randomSalt() {
        var n = 16, bytes = [], i;
        if (root.crypto && root.crypto.getRandomValues) {
            var u = new Uint8Array(32);
            root.crypto.getRandomValues(u);
            bytes = Array.prototype.slice.call(u);
        } else {
            var c = nodeCrypto();
            if (!c) { throw new Error('No random numbers here'); }
            bytes = Array.prototype.slice.call(c.randomBytes(32));
        }
        var s = '';
        for (i = 0; i < bytes.length && s.length < n; i++) { s += ITOA.charAt(bytes[i] & 63); }
        return s;
    }

    var api = { crypt: crypt, hash: function (pw) { return crypt(pw, randomSalt()); } };
    root.SD_SHA512CRYPT = api;
    if (typeof module === 'object' && module.exports) { module.exports = api; }
}(typeof window !== 'undefined' ? window : this));
