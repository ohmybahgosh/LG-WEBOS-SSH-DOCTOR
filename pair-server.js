/*
 * The pairing page for LG webOS SSH Doctor.  Started by ssh-doctor.sh
 * pair-start while the TV shows its pairing screen:
 *
 *   node pair-server.js STATE_DIR PORT "IP IP..."
 *
 * Someone on the home network opens http://TV:PORT, types the code the TV
 * shows, and sends a public key (one they have, or one their browser makes:
 * the private key never leaves their device).  The key waits in
 * STATE_DIR/pending.pub until it's confirmed on the TV.  State for the TV app
 * is in STATE_DIR/state.json.  Plain ES5 for older Node.js.
 *
 * Stops itself: 5 minutes without a code, 5 minutes after pairing, after one
 * key is confirmed or turned down, after 15 wrong codes, or 30 seconds after
 * the TV stops asking for its state (the screen was closed).
 */
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var keyinfo = require('./keyinfo.js');

var DIR = process.argv[2];
var PORT = parseInt(process.argv[3], 10) || 28622;
var IPS = String(process.argv[4] || '').split(/\s+/).filter(function (s) { return /^[0-9.]+$/.test(s); });
var HERE = __dirname;

var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
var TRIES = 5;
var MAX_CODES = 3;
var WAIT_MS = 5 * 60 * 1000;
var ALIVE_MS = 30 * 1000;

var state = { state: 'starting', code: '', port: 0, ips: IPS, expires: 0, triesLeft: TRIES, key: null };
var codesLeft = MAX_CODES;
var token = null;
var server = null;
var finishing = false;

function now() { return new Date().getTime(); }

function save() {
    var tmp = DIR + '/state.json.tmp';
    var pub = {};
    for (var k in state) { if (state.hasOwnProperty(k)) { pub[k] = state[k]; } }
    fs.writeFileSync(tmp, JSON.stringify(pub));
    fs.renameSync(tmp, DIR + '/state.json');
}

// 6 characters with no look-alikes, shown and typed as ABC-DEF
function newCode() {
    var out = '';
    while (out.length < 6) {
        var b = crypto.randomBytes(16);
        for (var i = 0; i < b.length && out.length < 6; i++) {
            if (b[i] < 248) { out += CODE_CHARS[b[i] % 31]; } // 248 = 31 * 8, so no bias
        }
    }
    return out.slice(0, 3) + '-' + out.slice(3);
}

function norm(c) {
    return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Compare without leaking how much matched
function same(a, b) {
    if (a.length !== b.length) { return false; }
    var d = 0;
    for (var i = 0; i < a.length; i++) { d |= a.charCodeAt(i) ^ b.charCodeAt(i); }
    return d === 0;
}

function finish(st, delay) {
    if (finishing) { return; }
    finishing = true;
    if (st) { state.state = st; }
    state.code = '';
    try { save(); } catch (e) { /* the directory may be gone already */ }
    setTimeout(function () { process.exit(0); }, delay || 0);
}

// ------------------------------------------------------------------ http

function send(res, code, type, body) {
    res.writeHead(code, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    });
    res.end(body);
}

function json(res, code, obj) { send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj)); }

var FILES = {
    '/': ['pair.html', 'text/html; charset=utf-8'],
    '/pair.js': ['pair.js', 'application/javascript; charset=utf-8'],
    '/sshkey.js': ['sshkey.js', 'application/javascript; charset=utf-8'],
    '/nacl.js': ['nacl-fast.min.js', 'application/javascript; charset=utf-8']
};

function body(req, cb) {
    var chunks = [], size = 0, done = false;
    req.on('data', function (c) {
        size += c.length;
        if (size > 20000 && !done) { done = true; cb(null); req.destroy(); return; }
        chunks.push(c);
    });
    req.on('end', function () {
        if (done) { return; }
        done = true;
        try { cb(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { cb(null); }
    });
}

function authed(t) { return token !== null && typeof t === 'string' && same(t, token); }

function apiCode(req, res) {
    body(req, function (b) {
        if (!b) { return json(res, 400, { error: 'bad-request' }); }
        if (state.state !== 'waiting') { return json(res, 409, { error: state.state === 'starting' ? 'not-ready' : 'busy' }); }
        if (same(norm(b.code), norm(state.code))) {
            token = crypto.randomBytes(16).toString('hex');
            state.state = 'paired';
            state.code = '';
            state.expires = now() + WAIT_MS;
            save();
            return json(res, 200, { ok: true, token: token });
        }
        state.triesLeft--;
        if (state.triesLeft > 0) { save(); return json(res, 403, { error: 'wrong', triesLeft: state.triesLeft }); }
        codesLeft--;
        if (codesLeft <= 0) { json(res, 403, { error: 'locked' }); return finish('locked'); }
        state.code = newCode();
        state.triesLeft = TRIES;
        state.expires = now() + WAIT_MS;
        save();
        return json(res, 403, { error: 'new-code' });
    });
}

function apiKey(req, res) {
    body(req, function (b) {
        if (!b || !authed(b.token)) { return json(res, 403, { error: 'not-paired' }); }
        if (state.state !== 'paired') { return json(res, 409, { error: 'busy' }); }
        var text = String(b.key || '');
        if (/PRIVATE KEY|PuTTY-User-Key-File/.test(text)) { return json(res, 400, { error: 'private' }); }
        var lines = text.replace(/\r/g, '').split('\n').filter(function (l) { return /\S/.test(l) && !/^\s*#/.test(l); });
        if (lines.length !== 1) { return json(res, 400, { error: lines.length ? 'one-key' : 'empty' }); }
        var k = keyinfo.parseLine(lines[0]);
        if (!k) { return json(res, 400, { error: 'not-a-key' }); }
        // Only type, key and a tidy comment: no options from the network
        var comment = k.comment.replace(/[^\x20-\x7e]/g, '').slice(0, 80);
        fs.writeFileSync(DIR + '/pending.pub', k.type + ' ' + k.blob + (comment ? ' ' + comment : '') + '\n', { mode: 384 });
        state.state = 'pending';
        state.key = { type: k.type, fp: k.fp, comment: comment, bits: k.bits };
        state.expires = now() + WAIT_MS;
        save();
        json(res, 200, { ok: true, type: k.type, fp: k.fp });
    });
}

function apiStatus(req, res, q) {
    if (!authed(q.token)) { return json(res, 403, { error: 'not-paired' }); }
    json(res, 200, { state: state.state, key: state.key, ips: IPS });
}

function query(url) {
    var q = {};
    var i = url.indexOf('?');
    if (i < 0) { return q; }
    url.slice(i + 1).split('&').forEach(function (p) {
        var kv = p.split('=');
        try { q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || ''); } catch (e) { /* skip */ }
    });
    return q;
}

function handle(req, res) {
    var url = req.url || '/';
    var p = url.split('?')[0];
    if (req.method === 'GET' && FILES[p]) {
        var f = FILES[p];
        fs.readFile(path.join(HERE, f[0]), function (err, data) {
            if (err) { return send(res, 404, 'text/plain', 'Not found'); }
            send(res, 200, f[1], data);
        });
        return;
    }
    if (req.method === 'POST' && p === '/api/code') { return apiCode(req, res); }
    if (req.method === 'POST' && p === '/api/key') { return apiKey(req, res); }
    if (req.method === 'GET' && p === '/api/status') { return apiStatus(req, res, query(url)); }
    send(res, 404, 'text/plain', 'Not found');
}

// ------------------------------------------------------------------ watch

function tick() {
    if (finishing) { return; }
    if (fs.existsSync(DIR + '/stop')) { return finish('stopped'); }
    var alive = 0;
    try { alive = fs.statSync(DIR + '/alive').mtime.getTime(); } catch (e) { return finish('stopped'); }
    if (now() - alive > ALIVE_MS) { return finish('stopped'); }
    if (state.state === 'pending') {
        var d = '';
        try { d = String(fs.readFileSync(DIR + '/decision')).replace(/\s+/g, ''); } catch (e) { d = ''; }
        if (d === 'accepted' || d === 'rejected' || d === 'failed') {
            state.state = d;
            save();
            // Stay up long enough for the browser to see the answer
            finishing = true;
            setTimeout(function () { process.exit(0); }, 60000);
            return;
        }
    }
    if (state.expires && now() > state.expires && (state.state === 'waiting' || state.state === 'paired' || state.state === 'pending')) {
        finish('expired');
    }
}

function listen(port, triesLeft) {
    server = http.createServer(handle);
    server.on('error', function (e) {
        if (e.code === 'EADDRINUSE' && triesLeft > 0) { return listen(port + 1, triesLeft - 1); }
        console.error('Could not listen: ' + e.message);
        process.exit(1);
    });
    server.listen(port, function () {
        state.port = port;
        state.state = 'waiting';
        state.code = newCode();
        state.expires = now() + WAIT_MS;
        save();
        setInterval(tick, 1000);
    });
}

if (!DIR) { console.error('Usage: node pair-server.js STATE_DIR PORT "IPS"'); process.exit(2); }
process.on('SIGTERM', function () {
    if (!finishing) { state.state = 'stopped'; state.code = ''; try { save(); } catch (e) { /* gone */ } }
    process.exit(0);
});
listen(PORT, 9);
