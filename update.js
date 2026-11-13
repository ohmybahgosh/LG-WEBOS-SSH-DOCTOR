/*
 * Is there a newer SSH Doctor?  Asks GitHub for the latest release: its
 * Homebrew Channel manifest (version, IPK address and SHA-256), the
 * manifest's signature, and the release notes.
 *
 *   node update.js check CURRENT_VERSION
 *
 * Prints {"current","latest","newer","ipkUrl","sha256","notes","published"}
 * or {"error":...}.  The manifest has to be signed by the project's release
 * key (below, and in SECURITY.md), whose private half is kept out of the
 * repository and only used by the release workflow, so a release put up by
 * anyone else isn't installed.  The Homebrew Channel downloads and checks
 * the IPK against the signed SHA-256 when it installs it.  Only the IPK at
 * this app's own release address for that version is accepted.
 * SD_RELEASE_BASE and SD_API_BASE point it at a test server, and only then
 * SD_RELEASE_PUBKEY replaces the key.  Plain ES5 for older Node.js.
 */
'use strict';
var http = require('http');
var https = require('https');
var url = require('url');
var path = require('path');
var crypto = require('crypto');

// The release signing key (minisign's format)
var RELEASE_PUBKEY = 'RWQO4W70hCxwfBnkZTxsuXAwvARiUkxv0tgpXimn2LcrBFHoM5DsT9i3';

var REPO = 'ohmybahgosh/LG-WEBOS-SSH-DOCTOR';
var APP = 'org.ohmybahgosh.sshdoctor';
var RELEASE_BASE = process.env.SD_RELEASE_BASE || 'https://github.com/' + REPO + '/releases';
var PUBKEY = (process.env.SD_RELEASE_BASE && process.env.SD_RELEASE_PUBKEY) || RELEASE_PUBKEY;
var API_BASE = process.env.SD_API_BASE || 'https://api.github.com/repos/' + REPO;

// The manifest and the release notes are small
var MAX_BYTES = 512 * 1024;
var VERSION_RE = /^[0-9]{1,4}(\.[0-9]{1,6}){1,3}$/;

function out(o) { process.stdout.write(JSON.stringify(o) + '\n'); }

// GET with redirects (GitHub's download links redirect to its file store)
function get(u, hops, cb) {
    var called = false;
    function done(e, b) { if (!called) { called = true; cb(e, b); } }
    var p = url.parse(u);
    var lib = p.protocol === 'http:' ? http : https;
    var req = lib.get({ hostname: p.hostname, port: p.port, path: p.path, headers: { 'User-Agent': 'LG-webOS-SSH-Doctor', Accept: 'application/json' } }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops > 0) {
            res.resume();
            var next = url.resolve(u, res.headers.location);
            // Never from https down to plain http
            if (p.protocol === 'https:' && url.parse(next).protocol !== 'https:') { return done('insecure-redirect'); }
            return get(next, hops - 1, done);
        }
        var chunks = [], size = 0;
        res.on('data', function (c) {
            size += c.length;
            if (size > MAX_BYTES) { req.abort(); done('too-big'); return; }
            chunks.push(c);
        });
        res.on('end', function () { done(res.statusCode === 200 ? null : 'http-' + res.statusCode, Buffer.concat(chunks).toString('utf8')); });
    });
    req.setTimeout(15000, function () { req.abort(); });
    req.on('error', function (e) { done(e.code || 'network'); });
}

// Ed25519: tweetnacl, bundled with the app, works on every Node.js; Node's
// own crypto has it from 12 on (the tests use that)
function ed25519(sig, msg, pub) {
    var nacl = null;
    try { nacl = require(path.join(__dirname, 'nacl-fast.min.js')); } catch (e) { nacl = null; }
    if (nacl && nacl.sign) { return nacl.sign.detached.verify(new Uint8Array(msg), new Uint8Array(sig), new Uint8Array(pub)); }
    if (!crypto.verify) { return false; }
    var spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub]);
    try { return crypto.verify(null, msg, crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' }), sig); } catch (e) { return false; }
}

// A minisign signature (the original kind, "Ed") of DATA by the key PUB, for
// a file called NAME: both the signature and its trusted comment
function verify(data, sigText, pubText, name) {
    var lines = String(sigText || '').replace(/\r/g, '').split('\n');
    if (lines.length < 4 || !/^untrusted comment: /.test(lines[0]) || !/^trusted comment: /.test(lines[2])) { return false; }
    var pk = Buffer.from(String(pubText), 'base64'), sg = Buffer.from(lines[1], 'base64'), gl = Buffer.from(lines[3], 'base64');
    if (pk.length !== 42 || sg.length !== 74 || gl.length !== 64) { return false; }
    if (pk.slice(0, 2).toString() !== 'Ed' || sg.slice(0, 2).toString() !== 'Ed') { return false; }
    if (!pk.slice(2, 10).equals(sg.slice(2, 10))) { return false; }
    var key = pk.slice(10), sig = sg.slice(10), trusted = lines[2].slice('trusted comment: '.length);
    if (!ed25519(sig, data, key)) { return false; }
    if (!ed25519(gl, Buffer.concat([sig, Buffer.from(trusted, 'utf8')]), key)) { return false; }
    // Signed for this file, not another one from the release
    return !name || trusted.split('\t').indexOf('file:' + name) >= 0;
}

// 1.10.0 > 1.9.2
function newer(a, b) {
    var x = String(a).split('.'), y = String(b).split('.');
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
        var m = parseInt(x[i] || '0', 10) || 0, n = parseInt(y[i] || '0', 10) || 0;
        if (m !== n) { return m > n; }
    }
    return false;
}

function check(current) {
    var MANIFEST = APP + '.manifest.json';
    get(RELEASE_BASE + '/latest/download/' + MANIFEST, 5, function (e, body) {
        if (e) { out({ error: e, current: current }); process.exit(1); }
        get(RELEASE_BASE + '/latest/download/' + MANIFEST + '.minisig', 5, function (es, sig) {
            if (es || !verify(Buffer.from(body, 'utf8'), sig, PUBKEY, MANIFEST)) {
                out({ error: 'bad-signature', current: current });
                process.exit(1);
            }
            checked(current, body);
        });
    });
}

function checked(current, body) {
    var e = null, m = null;
    try { m = JSON.parse(body); } catch (x) { m = null; }
    if (!m || typeof m.version !== 'string' || !VERSION_RE.test(m.version) || typeof m.ipkUrl !== 'string' || !m.ipkHash
        || !/^[0-9a-f]{64}$/.test(m.ipkHash.sha256 || '')) {
        out({ error: e || 'bad-manifest', current: current });
        process.exit(1);
    }
    // Only this app's own download for exactly that version, from its GitHub
    // releases: a manifest can't point at another file, or at an older
    // release dressed up as a newer one
    if (m.ipkUrl !== RELEASE_BASE + '/download/v' + m.version + '/' + APP + '_' + m.version + '_all.ipk') {
        out({ error: 'unexpected-url', current: current });
        process.exit(1);
    }
    var res = { current: current, latest: m.version, newer: newer(m.version, current), ipkUrl: m.ipkUrl, sha256: m.ipkHash.sha256, notes: '', published: '' };
    get(API_BASE + '/releases/latest', 3, function (e2, b2) {
        try {
            var r = JSON.parse(b2);
            if (!e2 && r && r.tag_name === 'v' + m.version) { res.notes = String(r.body || ''); res.published = String(r.published_at || ''); }
        } catch (x) { /* notes are optional */ }
        out(res);
    });
}

if (require.main === module) {
    if (process.argv[2] !== 'check') { out({ error: 'bad-command' }); process.exit(2); }
    check(process.argv[3] || '0');
}
module.exports = { verify: verify, PUBKEY: PUBKEY, RELEASE_PUBKEY: RELEASE_PUBKEY };
