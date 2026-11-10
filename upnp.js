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
 * router's settings usually aren't listed.  SD_SSDP_ADDR=HOST:PORT sends the
 * search there instead of the multicast address (for the tests).
 * Plain ES5 for older Node.js.
 */
'use strict';
var dgram = require('dgram');
var http = require('http');
var url = require('url');

var SSDP = (process.env.SD_SSDP_ADDR || '239.255.255.250:1900').split(':');
var WAIT_MS = parseInt(process.env.SD_SSDP_WAIT || '2500', 10);
var MAX_ENTRIES = 128;
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
    sock.on('message', function (msg) {
        var m = String(msg).match(/^location:\s*(\S+)/im);
        if (m && !found[m[1]]) { found[m[1]] = 1; list.push(m[1]); }
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

function fetch(u, opts, body, done) {
    var p = url.parse(u);
    var req = http.request({ hostname: p.hostname, port: p.port || 80, path: p.path, method: opts.method || 'GET', headers: opts.headers || {} }, function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () { done(null, res.statusCode, Buffer.concat(chunks).toString('utf8')); });
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
                    done({ type: SERVICES[i], control: url.resolve(base, tag(blocks[j], 'controlURL')), name: tag(xml, 'friendlyName') });
                    return;
                }
            }
        }
        done(null);
    });
}

function soap(svc, action, args, done) {
    var body = '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">'
        + '<s:Body><u:' + action + ' xmlns:u="' + svc.type + '">'
        + Object.keys(args).map(function (k) { return '<' + k + '>' + args[k] + '</' + k + '>'; }).join('')
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
