/*
 * A pretend GitHub for the update tests: the latest release's Homebrew
 * Channel manifest and its notes.  Writes its port to READY_FILE.
 *
 *   node fake-release.js VERSION READY_FILE
 */
'use strict';
var http = require('http');
var fs = require('fs');
var V = process.argv[2];
var s = http.createServer(function (req, res) {
    if (req.url === '/rel/latest/download/org.ohmybahgosh.sshdoctor.manifest.json') {
        res.writeHead(302, { Location: '/files/manifest.json' }); res.end(); return;
    }
    if (req.url === '/files/manifest.json') {
        res.end(JSON.stringify({ id: 'org.ohmybahgosh.sshdoctor', version: V,
            ipkUrl: 'http://127.0.0.1:' + s.address().port + '/files/sd_' + V + '.ipk',
            ipkHash: { sha256: 'ab'.repeat(32) } }));
        return;
    }
    if (req.url === '/api/releases/latest') {
        res.end(JSON.stringify({ tag_name: 'v' + V, published_at: '2026-11-12T12:00:00Z', body: '### Added\n\n- **Something new.**' }));
        return;
    }
    res.statusCode = 404; res.end();
});
s.listen(0, '127.0.0.1', function () { fs.writeFileSync(process.argv[3], String(s.address().port)); });
setTimeout(function () { process.exit(0); }, 60000);
