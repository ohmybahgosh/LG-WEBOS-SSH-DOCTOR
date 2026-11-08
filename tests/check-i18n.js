// Every text the TV app shows is translated in each language of
// webos-app/src/i18n.js, with the same {placeholders}, and every message the
// repairs print comes out with no English left in it.
//
//   node tests/check-i18n.js
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var SRC = path.join(__dirname, '../webos-app/src');
var app = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
var html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
var sh = fs.readFileSync(path.join(__dirname, '../ssh-doctor.sh'), 'utf8');

var box = { window: {}, navigator: { language: 'en-US' }, document: {} };
box.window.localStorage = { getItem: function () { return null; }, setItem: function () {} };
vm.runInNewContext(fs.readFileSync(path.join(SRC, 'i18n.js'), 'utf8'), box);
var I = box.window.SD_I18N;

function unq(s) { return s.replace(/\\'/g, "'").replace(/\\n/g, '\n'); }
var used = {};
var m;
var lit = /\bTC?\(\s*'((?:[^'\\]|\\.)*)'/g;
while ((m = lit.exec(app))) { used[unq(m[1])] = 1; }
var fb = app.match(/var FINDINGS = \{([\s\S]*?)\};/);
if (!fb) { console.log('FINDINGS not found in app.js'); process.exit(1); }
var fv = /:\s*'((?:[^'\\]|\\.)*)'/g;
while ((m = fv.exec(fb[1]))) { used[unq(m[1])] = 1; }
used['Auto ({lang})'] = 1;
html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/>([^<>]+)</g, function (all, t) {
    t = t.trim();
    if (t && /[A-Za-z]/.test(t) && !/^(OK|BACK|SSH Doctor|github\.com\/\S+)$/.test(t)) { used[t] = 1; }
    return all;
});
var texts = Object.keys(used);

// Every finding code the script can give has words in the app
var codes = {};
var cre = /\badd ([a-z-]+) (problem|tip)\b/g;
while ((m = cre.exec(sh))) { codes[m[1]] = 1; }
// Entware's findings, gathered by ent_check and added with their level later
var ere = /_ek_codes="\$_ek_codes ([a-z-]+)"/g;
while ((m = ere.exec(sh))) { codes[m[1]] = 1; }
var bad = 0;
Object.keys(codes).forEach(function (c) {
    if (fb[1].indexOf("'" + c + "'") < 0) { console.log('finding ' + c + ' has no text in app.js FINDINGS'); bad++; }
});

function ph(s) { return (s.match(/\{\w+\}/g) || []).sort().join(','); }
Object.keys(I.dicts).forEach(function (lang) {
    var d = I.dicts[lang];
    texts.forEach(function (t) {
        if (!Object.prototype.hasOwnProperty.call(d, t)) { console.log('missing ' + lang + ': ' + JSON.stringify(t)); bad++; }
        else if (ph(t) !== ph(d[t])) { console.log('placeholders differ ' + lang + ': ' + JSON.stringify(t)); bad++; }
    });
    Object.keys(d).forEach(function (t) { if (!used[t]) { console.log('unused ' + lang + ': ' + JSON.stringify(t)); } });
    console.log(lang + ': ' + texts.length + ' texts' + (bad ? '' : ', all translated'));
});

// The repairs' messages (what the app shows after one), with sample values
var REPAIRS = ['ssh_on', 'fix_keys', 'password_on', 'add_key', 'restore', 'backup', 'fix_perms'];
var msgs = [];
REPAIRS.forEach(function (fn) {
    var b = sh.match(new RegExp('\\n' + fn + '\\(\\) \\{([\\s\\S]*?)\\n\\}'));
    if (!b) { console.log('no function ' + fn + ' in ssh-doctor.sh'); bad++; return; }
    var r = /\b(?:say|die) "((?:[^"\\]|\\.)*)"/g;
    while ((m = r.exec(b[1]))) { msgs.push(m[1]); }
});
function fill(t) {
    return t.replace(/\$\{_found:-[^}]*\}/g, 'crlf bom').replace(/\$\(stamp\)/g, '20261108-120000')
        .replace(/\$\{?[A-Za-z_][A-Za-z_0-9]*\}?/g, function (v) {
            if (/_n\b|_n\}|_sp\b/.test(v)) { return /_sp/.test(v) ? '2222' : '2'; }
            return /_ow\b/.test(v) ? 'entware-openssh' : '/home/root/.ssh/authorized_keys';
        })
        .replace(/\\"/g, '"');
}
var smallWords = /\b(the|is|are|was|it|this|that|and|but|or|to|of|on|in|with|your|for|has|have|isn't|didn't|couldn't|can|now|already|there|after|only|until|back|key|keys)\b/i;
var latinRun = /[A-Za-z']{2,}(?:\s+[A-Za-z'.-]{2,}){2,}/;
var OK = /authorized_keys[\S]*|\/[\S]+|Homebrew Channel|root|alpine|SSH|crlf bom/g;
Object.keys(I.scripts).forEach(function (lang) {
    var english = /[A-Za-z]/.test(I.names[lang]) ? smallWords : latinRun;
    var box2 = { window: {}, navigator: { language: lang }, document: {} };
    box2.window.localStorage = { getItem: function () { return null; }, setItem: function () {} };
    vm.runInNewContext(fs.readFileSync(path.join(SRC, 'i18n.js'), 'utf8'), box2);
    var TS = box2.window.SD_I18N.TS;
    var n = 0;
    msgs.forEach(function (raw) {
        var t = fill(raw);
        if (/^No key file |^Not one of this script|^No backup called |^Just the file name/.test(t)) { return; } // only when the app is misused
        n++;
        var out = TS(t);
        if (english.test(out.replace(OK, ''))) { console.log('script message not translated (' + lang + '): ' + t + '\n  -> ' + out); bad++; }
    });
    console.log(lang + ': ' + n + ' repair messages checked');
});

if (I.T('{title}: done', { title: 'X' }) !== 'X: done') { console.log('T() placeholder fill broken'); bad++; }
process.exit(bad ? 1 : 0);
