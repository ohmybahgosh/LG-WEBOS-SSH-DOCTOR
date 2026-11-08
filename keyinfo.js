/*
 * Key details for LG webOS SSH Doctor: types, SHA256 fingerprints (the same
 * ones ssh-keygen -lf and ssh show) and comments.  Plain ES5 for the Node.js
 * versions on older TVs.  Used by ssh-doctor.sh and pair-server.js.
 *
 *   node keyinfo.js host DIR          fingerprints of dropbear's host keys
 *   node keyinfo.js list FILE [--json] the public keys in an authorized_keys file
 */
'use strict';
var crypto = require('crypto');
var fs = require('fs');

var TYPES = ['ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384',
    'ecdsa-sha2-nistp521', 'sk-ssh-ed25519@openssh.com', 'sk-ecdsa-sha2-nistp256@openssh.com'];

// Buffer.from where it exists (new Buffer warns on newer Node.js)
var hasFrom = typeof Buffer.from === 'function' && Buffer.from !== Uint8Array.from;
function bufFrom(s, enc) { return hasFrom ? Buffer.from(s, enc) : new Buffer(s, enc); }
function bufAlloc(n) { return typeof Buffer.alloc === 'function' ? Buffer.alloc(n) : new Buffer(n); }
function b64(buf) { return buf.toString('base64'); }
function fromB64(s) { return bufFrom(s, 'base64'); }

function fingerprint(blob) {
    return 'SHA256:' + crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
}

// Read SSH wire-format strings (uint32 length, then the bytes) from buf
function reader(buf) {
    var pos = 0;
    return {
        str: function () {
            if (pos + 4 > buf.length) { throw new Error('short'); }
            var n = buf.readUInt32BE(pos);
            if (pos + 4 + n > buf.length) { throw new Error('short'); }
            var s = buf.slice(pos + 4, pos + 4 + n);
            pos += 4 + n;
            return s;
        },
        pos: function () { return pos; }
    };
}

// A public key line: options, type, base64 blob, comment.  Returns null if
// the type inside the blob doesn't match, or the blob is cut short
function parseLine(line) {
    var f = String(line).replace(/^\s+|\s+$/g, '').split(/\s+/);
    for (var i = 0; i < f.length; i++) {
        if (TYPES.indexOf(f[i]) >= 0 && f[i + 1]) {
            var type = f[i], blobText = f[i + 1];
            if (!/^[A-Za-z0-9+\/]+=*$/.test(blobText)) { return null; }
            var blob = fromB64(blobText);
            try {
                var r = reader(blob);
                if (r.str().toString() !== type) { return null; }
                // The rest of the key has to be whole too
                if (type === 'ssh-ed25519') { if (r.str().length !== 32) { return null; } }
                else if (type === 'ssh-rsa') { r.str(); if (r.str().length < 128) { return null; } }
                else { r.str(); r.str(); }
                if (r.pos() !== blob.length && type.indexOf('sk-') !== 0) { return null; }
            } catch (e) { return null; }
            return {
                options: f.slice(0, i).join(' '),
                type: type,
                blob: blobText,
                comment: f.slice(i + 2).join(' '),
                fp: fingerprint(blob),
                bits: type === 'ssh-rsa' ? rsaBits(blob) : null
            };
        }
    }
    return null;
}

function rsaBits(blob) {
    try {
        var r = reader(blob);
        r.str(); r.str();
        var n = r.str();
        var i = 0;
        while (i < n.length && n[i] === 0) { i++; }
        return (n.length - i) * 8;
    } catch (e) { return null; }
}

// SSH wire string from a buffer
function wire(buf) {
    var len = bufAlloc(4);
    len.writeUInt32BE(buf.length, 0);
    return Buffer.concat([len, buf]);
}

// The public half of a dropbear host key file
function dropbearPublic(file) {
    var buf = fs.readFileSync(file);
    var r = reader(buf);
    var type = r.str();
    var t = type.toString();
    if (t === 'ssh-ed25519') {
        var k = r.str();
        return { type: t, blob: Buffer.concat([wire(type), wire(k.slice(32, 64))]) };
    }
    if (t === 'ssh-rsa') {
        var start = 0;
        r.str(); r.str();
        return { type: t, blob: buf.slice(start, r.pos()) };
    }
    if (t.indexOf('ecdsa-sha2-') === 0) {
        r.str(); r.str();
        return { type: t, blob: buf.slice(0, r.pos()) };
    }
    return null;
}

function hostKeys(dir) {
    var out = [];
    var names = [];
    try { names = fs.readdirSync(dir).sort(); } catch (e) { return out; }
    names.forEach(function (n) {
        if (!/^dropbear_.*_host_key$/.test(n)) { return; }
        try {
            var k = dropbearPublic(dir + '/' + n);
            if (k) { out.push({ type: k.type, fp: fingerprint(k.blob), line: k.type + ' ' + b64(k.blob) }); }
        } catch (e) { /* unreadable: skip */ }
    });
    return out;
}

module.exports = { bufFrom: bufFrom, parseLine: parseLine, fingerprint: fingerprint, hostKeys: hostKeys, TYPES: TYPES };

if (require.main === module) {
    var cmd = process.argv[2], arg = process.argv[3], json = process.argv[4] === '--json';
    if (cmd === 'host') {
        hostKeys(arg).forEach(function (k) { console.log(k.type + ' ' + k.fp); });
    } else if (cmd === 'list') {
        var keys = [];
        String(fs.readFileSync(arg)).split('\n').forEach(function (l) {
            var k = parseLine(l);
            if (k) { keys.push({ type: k.type, fp: k.fp, comment: k.comment, bits: k.bits, options: k.options }); }
        });
        if (json) { console.log(JSON.stringify(keys)); }
        else { keys.forEach(function (k) { console.log(k.type + ' ' + k.fp + (k.comment ? ' ' + k.comment : '')); }); }
    } else if (cmd === 'hostpub') {
        // The TV's public host keys, as known_hosts would hold them
        var hk = hostKeys(arg);
        if (json || process.argv[4] === '--json') { console.log(JSON.stringify(hk)); }
        else { hk.forEach(function (k) { console.log(k.line + ' ' + k.fp); }); }
    } else if (cmd === 'edit') {
        // edit FILE remove FP | edit FILE rename FP NAME: the new file on stdout
        var what = process.argv[4], fp = process.argv[5], name = process.argv[6] || '';
        var hit = 0;
        var out = [];
        String(fs.readFileSync(arg)).split('\n').forEach(function (l) {
            var k = parseLine(l);
            if (!k || k.fp !== fp) { out.push(l); return; }
            hit++;
            if (what === 'rename') {
                var nm = String(name).replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').replace(/^ | $/g, '').slice(0, 60);
                out.push((k.options ? k.options + ' ' : '') + k.type + ' ' + k.blob + (nm ? ' ' + nm : ''));
            }
        });
        if (!hit || (what !== 'remove' && what !== 'rename')) { process.exit(3); }
        process.stdout.write(out.join('\n'));
    } else {
        console.error('Usage: node keyinfo.js host DIR | hostpub DIR [--json] | list FILE [--json] | edit FILE remove FP | edit FILE rename FP NAME');
        process.exit(2);
    }
}
