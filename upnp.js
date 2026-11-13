/*
 * Asks the home router which ports it forwards to the internet, the way
 * games and apps open ports on it (UPnP), so ssh-doctor.sh can tell whether
 * the TV's SSH or telnet can be reached from outside.
 *
 *   node upnp.js list "IP IP.." "PORT PORT.."
 *       the router's port forwards, as JSON, with "exposed": the ones that
 *       lead to one of these IP addresses (the TV's) and ports
 *   node upnp.js close "IP IP.." "PORT PORT.."
 *       takes those forwards off the router, then lists again
 *
 * Finds the router with an SSDP search on the home network, reads its
 * description, then asks its WANIPConnection (or WANPPPConnection) service.
 * Only routers with UPnP on answer, and ports forwarded by hand in the
 * router's settings usually aren't listed.  Only a description and control
 * address on the home network device that answered is used, and answers
 * are size-capped.  SD_SSDP_ADDR=HOST:PORT sends the search there instead of
 * the multicast address (for the tests, which also allows 127.0.0.1).
 * Plain ES5 for older Node.js.
 */
'use strict';
var dgram = require('dgram');
var http = require('http');
var url = require('url');

var TEST = !!process.env.SD_SSDP_ADDR;
var SSDP = (process.env.SD_SSDP_ADDR || '239.255.255.250:1900').split(':');
var WAIT_MS = parseInt(process.env.SD_SSDP_WAIT || '2500', 10);
var MAX_ENTRIES = 128;
var MAX_BYTES = 256 * 1024;
var SERVICES = [
    'urn:schemas-upnp-org:service:WANIPConnection:2',
    'urn:schemas-upnp-org:service:WANIPConnection:1',
    'urn:schemas-upnp-org:service:WANPPPConnection:1'
];

// Buffer.from where it exists (new Buffer warns on newer Node.js)
var hasFrom = typeof Buffer.from === 'function' && Buffer.from !== Uint8Array.from;
function bufFrom(s) { return hasFrom ? Buffer.from(s) : new Buffer(s); }

function out(o) { process.stdout.write(JSON.stringify(o) + '\n'); }
function fail(code) { out({ router: 'error', error: code, mappings: [] }); process.exit(1); }

// Only a description on the device that answered, at a home network
// address: anything on the network can answer a search, and it mustn't be
// able to send the TV to another machine, or to the TV's own services
function privateIp(h) {
    return /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)[0-9.]+$/.test(h) || (TEST && h === '127.0.0.1');
}
function locationOk(loc, from) {
    var p = url.parse(loc);
    return p.protocol === 'http:' && p.hostname === from && privateIp(p.hostname) && portOk(p.port);
}
function portOk(port) { return !port || (parseInt(port, 10) > 0 && parseInt(port, 10) < 65536); }

// The routers that answer an SSDP search, by their description URL
function discover(done) {
    var sock = dgram.createSocket('udp4');
    var found = {};
    var list = [];
    var finished = false;
    function finish() {
        if (finished) { return; }
        finished = true;
        try { sock.close(); } catch (e) { /* closed */ }
        done(list);
    }
    sock.on('error', finish);
    sock.on('message', function (msg, rinfo) {
        var m = String(msg).match(/^location:\s*(\S+)/im);
        if (m && !found[m[1]] && locationOk(m[1], rinfo.address)) { found[m[1]] = 1; list.push(m[1]); }
    });
    sock.bind(0, function () {
        ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2',
            'urn:schemas-upnp-org:service:WANIPConnection:1'].forEach(function (st) {
            var q = bufFrom('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ' + st + '\r\n\r\n');
            sock.send(q, 0, q.length, parseInt(SSDP[1], 10), SSDP[0]);
        });
        setTimeout(finish, WAIT_MS);
    });
}

function fetch(u, opts, body, cb) {
    var called = false;
    function done(e, code, text) { if (!called) { called = true; cb(e, code, text); } }
    var p = url.parse(u);
    var req = http.request({ hostname: p.hostname, port: p.port || 80, path: p.path, method: opts.method || 'GET', headers: opts.headers || {} }, function (res) {
        var chunks = [], size = 0, over = false;
        res.on('data', function (c) {
            size += c.length;
            // Router descriptions and answers are a few kilobytes
            if (size > MAX_BYTES) { if (!over) { over = true; req.abort(); done('too-big'); } return; }
            chunks.push(c);
        });
        res.on('end', function () { if (!over) { done(null, res.statusCode, Buffer.concat(chunks).toString('utf8')); } });
    });
    req.setTimeout(4000, function () { req.abort(); });
    req.on('error', function (e) { done(e); });
    if (body) { req.write(body); }
    req.end();
}

function tag(xml, name) {
    var m = xml.match(new RegExp('<(?:\\w+:)?' + name + '>([\\s\\S]*?)</(?:\\w+:)?' + name + '>', 'i'));
    return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() : '';
}

// The port-mapping service in a router's description: { type, control, name }
function service(loc, done) {
    fetch(loc, {}, null, function (e, code, xml) {
        if (e || code !== 200) { done(null); return; }
        var base = tag(xml, 'URLBase') || loc;
        var blocks = xml.split(/<service>/i).slice(1);
        for (var i = 0; i < SERVICES.length; i++) {
            for (var j = 0; j < blocks.length; j++) {
                if (tag(blocks[j], 'serviceType') === SERVICES[i]) {
                    var control = url.resolve(base, tag(blocks[j], 'controlURL'));
                    // Only the router that answered, over plain http
                    var cp = url.parse(control);
                    if (cp.protocol !== 'http:' || cp.hostname !== url.parse(loc).hostname) { done(null); return; }
                    done({ type: SERVICES[i], control: control, name: tag(xml, 'friendlyName').slice(0, 100) });
                    return;
                }
            }
        }
        done(null);
    });
}

function xmlEsc(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function soap(svc, action, args, done) {
    var body = '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">'
        + '<s:Body><u:' + action + ' xmlns:u="' + svc.type + '">'
        + Object.keys(args).map(function (k) { return '<' + k + '>' + xmlEsc(args[k]) + '</' + k + '>'; }).join('')
        + '</u:' + action + '></s:Body></s:Envelope>';
    fetch(svc.control, { method: 'POST', headers: {
        'Content-Type': 'text/xml; charset="utf-8"', 'SOAPAction': '"' + svc.type + '#' + action + '"', 'Content-Length': Buffer.byteLength(body)
    } }, body, done);
}

// Every port forward the router lists, one entry at a time until it says no more
function mappings(svc, done) {
    var list = [];
    (function next(i) {
        if (i >= MAX_ENTRIES) { done(list); return; }
        soap(svc, 'GetGenericPortMappingEntry', { NewPortMappingIndex: i }, function (e, code, xml) {
            if (e || code !== 200) { done(list); return; }
            list.push({
                protocol: tag(xml, 'NewProtocol').toUpperCase(),
                external: parseInt(tag(xml, 'NewExternalPort'), 10) || 0,
                internal: parseInt(tag(xml, 'NewInternalPort'), 10) || 0,
                client: tag(xml, 'NewInternalClient'),
                enabled: tag(xml, 'NewEnabled') !== '0',
                remote: tag(xml, 'NewRemoteHost'),
                description: tag(xml, 'NewPortMappingDescription')
            });
            next(i + 1);
        });
    }(0));
}

// The first router that has a port-mapping service
function router(done) {
    discover(function (locs) {
        (function next(i) {
            if (i >= locs.length) { done(null); return; }
            service(locs[i], function (svc) { if (svc) { done(svc); } else { next(i + 1); } });
        }(0));
    });
}

var cmd = process.argv[2] || 'list';
var IPS = String(process.argv[3] || '').split(/\s+/).filter(function (x) { return x; });
var PORTS = String(process.argv[4] || '').split(/\s+/).map(function (x) { return parseInt(x, 10); }).filter(function (x) { return x > 0; });

// Forwards that reach one of the TV's ports from the internet
function exposed(list) {
    return list.filter(function (m) { return m.enabled && IPS.indexOf(m.client) >= 0 && PORTS.indexOf(m.internal) >= 0; });
}

function report(svc, extra) {
    mappings(svc, function (list) {
        var o = { router: 'found', name: svc.name, mappings: list, exposed: exposed(list) };
        for (var k in extra) { if (extra.hasOwnProperty(k)) { o[k] = extra[k]; } }
        out(o);
    });
}

if (cmd !== 'list' && cmd !== 'close') { fail('bad-command'); }
router(function (svc) {
    if (!svc) { out({ router: 'none', mappings: [], exposed: [] }); return; }
    if (cmd === 'list') { report(svc, {}); return; }
    mappings(svc, function (list) {
        var todo = exposed(list), closed = [], failed = [];
        (function next(i) {
            if (i >= todo.length) { report(svc, { closed: closed, failed: failed }); return; }
            var m = todo[i];
            soap(svc, 'DeletePortMapping', { NewRemoteHost: m.remote, NewExternalPort: m.external, NewProtocol: m.protocol }, function (e, code) {
                (e || code !== 200 ? failed : closed).push({ protocol: m.protocol, external: m.external, internal: m.internal });
                next(i + 1);
            });
        }(0));
    });
});
