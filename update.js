/*
 * Is there a newer SSH Doctor?  Asks GitHub for the latest release: its
 * Homebrew Channel manifest (version, IPK address and SHA-256) and its
 * release notes.
 *
 *   node update.js check CURRENT_VERSION
 *
 * Prints {"current","latest","newer","ipkUrl","sha256","notes","published"}
 * or {"error":...}.  The Homebrew Channel downloads and checks the IPK
 * against that SHA-256 when it installs it.  SD_RELEASE_BASE and SD_API_BASE
 * point it at a test server.  Plain ES5 for older Node.js.
 */
'use strict';
var http = require('http');
var https = require('https');
var url = require('url');

var REPO = 'ohmybahgosh/LG-WEBOS-SSH-DOCTOR';
var APP = 'org.ohmybahgosh.sshdoctor';
var RELEASE_BASE = process.env.SD_RELEASE_BASE || 'https://github.com/' + REPO + '/releases';
var API_BASE = process.env.SD_API_BASE || 'https://api.github.com/repos/' + REPO;

function out(o) { process.stdout.write(JSON.stringify(o) + '\n'); }

// GET with redirects (GitHub's download links redirect to its file store)
function get(u, hops, done) {
    var p = url.parse(u);
    var lib = p.protocol === 'http:' ? http : https;
    var req = lib.get({ hostname: p.hostname, port: p.port, path: p.path, headers: { 'User-Agent': 'LG-webOS-SSH-Doctor', Accept: 'application/json' } }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops > 0) {
            res.resume();
            return get(url.resolve(u, res.headers.location), hops - 1, done);
        }
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () { done(res.statusCode === 200 ? null : 'http-' + res.statusCode, Buffer.concat(chunks).toString('utf8')); });
    });
    req.setTimeout(15000, function () { req.abort(); });
    req.on('error', function (e) { done(e.code || 'network'); });
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

var cmd = process.argv[2];
var current = process.argv[3] || '0';
if (cmd !== 'check') { out({ error: 'bad-command' }); process.exit(2); }

get(RELEASE_BASE + '/latest/download/' + APP + '.manifest.json', 5, function (e, body) {
    var m = null;
    try { m = e ? null : JSON.parse(body); } catch (x) { m = null; }
    if (!m || !m.version || !m.ipkUrl || !m.ipkHash || !/^[0-9a-f]{64}$/.test(m.ipkHash.sha256 || '')) {
        out({ error: e || 'bad-manifest', current: current });
        process.exit(1);
    }
    var res = { current: current, latest: String(m.version), newer: newer(m.version, current), ipkUrl: m.ipkUrl, sha256: m.ipkHash.sha256, notes: '', published: '' };
    // Only GitHub release downloads of this app are installed
    if (!process.env.SD_RELEASE_BASE && m.ipkUrl.indexOf('https://github.com/' + REPO + '/releases/download/') !== 0) {
        out({ error: 'unexpected-url', current: current });
        process.exit(1);
    }
    get(API_BASE + '/releases/latest', 3, function (e2, b2) {
        try {
            var r = JSON.parse(b2);
            if (!e2 && r && r.tag_name === 'v' + m.version) { res.notes = String(r.body || ''); res.published = String(r.published_at || ''); }
        } catch (x) { /* notes are optional */ }
        out(res);
    });
});
