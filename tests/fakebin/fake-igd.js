/*
 * A pretend home router for the tests: answers an SSDP search on 127.0.0.1,
 * serves a UPnP description, and lists or removes port forwards kept in a
 * JSON file.  Writes "SSDP_PORT" to READY_FILE once it's listening.
 *
 *   node fake-igd.js MAPPINGS.json READY_FILE
 */
'use strict';
var dgram = require('dgram');
var http = require('http');
var fs = require('fs');

var FILE = process.argv[2];
var READY = process.argv[3];
var TYPE = 'urn:schemas-upnp-org:service:WANIPConnection:1';

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return []; } }
function tag(xml, n) { var m = xml.match(new RegExp('<' + n + '>([^<]*)</' + n + '>')); return m ? m[1] : ''; }

var web = http.createServer(function (req, res) {
    var body = '';
    req.on('data', function (c) { body += c; });
    req.on('end', function () {
        if (req.url === '/desc.xml') {
            res.end('<?xml version="1.0"?><root><device><friendlyName>Test router</friendlyName><deviceList><device><serviceList>'
                + '<service><serviceType>' + TYPE + '</serviceType><controlURL>/ctl/IPConn</controlURL></service>'
                + '</serviceList></device></deviceList></device></root>');
            return;
        }
        var act = String(req.headers.soapaction || '').replace(/"/g, '').split('#')[1];
        var list = load();
        if (act === 'GetGenericPortMappingEntry') {
            var m = list[parseInt(tag(body, 'NewPortMappingIndex'), 10)];
            if (!m) { res.statusCode = 500; res.end('<errorCode>713</errorCode>'); return; }
            res.end('<s:Envelope><s:Body><u:GetGenericPortMappingEntryResponse>'
                + '<NewRemoteHost></NewRemoteHost><NewExternalPort>' + m.external + '</NewExternalPort><NewProtocol>' + m.protocol + '</NewProtocol>'
                + '<NewInternalPort>' + m.internal + '</NewInternalPort><NewInternalClient>' + m.client + '</NewInternalClient>'
                + '<NewEnabled>1</NewEnabled><NewPortMappingDescription>' + (m.description || '') + '</NewPortMappingDescription>'
                + '</u:GetGenericPortMappingEntryResponse></s:Body></s:Envelope>');
            return;
        }
        if (act === 'DeletePortMapping') {
            var port = parseInt(tag(body, 'NewExternalPort'), 10), proto = tag(body, 'NewProtocol');
            var left = list.filter(function (x) { return !(x.external === port && x.protocol === proto); });
            if (left.length === list.length) { res.statusCode = 500; res.end('<errorCode>714</errorCode>'); return; }
            fs.writeFileSync(FILE, JSON.stringify(left));
            res.end('<s:Envelope><s:Body><u:DeletePortMappingResponse/></s:Body></s:Envelope>');
            return;
        }
        res.statusCode = 500; res.end('<errorCode>401</errorCode>');
    });
});

var udp = dgram.createSocket('udp4');
web.listen(0, '127.0.0.1', function () {
    var loc = 'http://127.0.0.1:' + web.address().port + '/desc.xml';
    udp.on('message', function (msg, rinfo) {
        if (!/M-SEARCH/.test(String(msg))) { return; }
        var r = Buffer.from('HTTP/1.1 200 OK\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\nLOCATION: ' + loc + '\r\n\r\n');
        udp.send(r, 0, r.length, rinfo.port, rinfo.address);
    });
    udp.bind(0, '127.0.0.1', function () { fs.writeFileSync(READY, String(udp.address().port)); });
});
setTimeout(function () { process.exit(0); }, 60000);
