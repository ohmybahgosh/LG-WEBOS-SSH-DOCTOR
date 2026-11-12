#!/bin/sh
# Tests for ssh-doctor.sh against a fake TV: a temporary folder holds the
# Homebrew Channel, /home/root/.ssh, /etc/shadow and a fake /proc.  Nothing
# outside it is touched.  Needs node (for fingerprints and the pairing page)
# and curl.
#
#   tests/run.sh [busybox|dash|bash] [NAME-FILTER]
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
SHELL_NAME=${1:-busybox}
FILTER=${2:-}
case "$SHELL_NAME" in busybox) SH="busybox sh" ;; *) SH=$SHELL_NAME ;; esac
pass=0; fail=0; failed=''

setup() {
    T=$(mktemp -d "${TMPDIR:-/tmp}/sdtest.XXXXXX")
    SD_OWNER=$(id -u); SD_NODE=$(command -v node)
    export SD_OWNER SD_NODE SD_ROOT="$T/root" SD_NOMOUNT=1 SD_IPS="192.168.1.50"
    export SD_PAIR_PORT=$((29000 + $$ % 900))
    mkdir -p "$SD_ROOT/var/luna/preferences" "$SD_ROOT/home/root/.ssh" "$SD_ROOT/etc" "$SD_ROOT/proc/net" \
        "$SD_ROOT/var/lib/webosbrew/sshd" "$SD_ROOT/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/bin"
    chmod 755 "$SD_ROOT/home/root"; chmod 700 "$SD_ROOT/home/root/.ssh"
    BIN="$SD_ROOT/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/bin"
    cp "$HERE/fakebin/dropbear" "$HERE/fakebin/telnetd" "$HERE/fakebin/fakeproc.sh" "$BIN/"
    chmod 755 "$BIN/dropbear" "$BIN/telnetd"
    export SD_FAKEKILL="$HERE/fakebin/fakeproc.sh" SD_LOGDIR="$T/log"
    mkdir -p "$T/log"
    printf 'root:*:15069:0:99999:7:::\nbin:*:15069:0:99999:7:::\n' > "$SD_ROOT/etc/shadow"
    printf 'root:x:0:0:root:/home/root:/bin/sh\n' > "$SD_ROOT/etc/passwd"
    printf '  sl  local_address rem_address   st\n' > "$SD_ROOT/proc/net/tcp"
    : > "$SD_ROOT/proc/net/tcp6"
    for k in ed rsa; do
        rm -f "$T/k_$k" "$T/k_$k.pub"
        case $k in ed) ssh-keygen -q -t ed25519 -N '' -C "me@$k" -f "$T/k_$k" ;; rsa) ssh-keygen -q -t rsa -b 2048 -N '' -C "me@$k" -f "$T/k_$k" ;; esac
    done
}
teardown() { $SH "$ROOT/ssh-doctor.sh" pair-stop >/dev/null 2>&1; rm -rf "$T"; }

# A running, listening dropbear, like after the Homebrew Channel started it
sshd_up() { "$BIN/dropbear" -R; }
fake_pids() { for _d in "$SD_ROOT"/proc/[0-9]*; do [ -d "$_d" ] && echo "${_d##*/}"; done; }
# shellcheck source=/dev/null
. "$HERE/fakebin/fakeproc.sh"
flag_on() { : > "$SD_ROOT/var/luna/preferences/webosbrew_sshd_enabled"; }
alpine() { sed -i 's/^root:[^:]*:/root:xGVw8H4GqkKg6:/' "$SD_ROOT/etc/shadow"; }
AK() { printf '%s' "$SD_ROOT/home/root/.ssh/authorized_keys"; }

run() { OUT=$($SH "$ROOT/ssh-doctor.sh" "$@" 2>&1); RC=$?; }
json() { run status --json; printf '%s' "$OUT" > "$T/s.json"; }
has() { printf '%s' "$OUT" | grep -q -F -- "$1"; }
lacks() { ! has "$1"; }
finding() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if any(f['code']==sys.argv[2] for f in d['findings']) else 1)" "$T/s.json" "$1"; }
nofinding() { ! finding "$1"; }
field() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(json.dumps(d[sys.argv[2]]))" "$T/s.json" "$1"; }
is() { [ "$1" = "$2" ]; }

check() {
    _what=$1; shift
    if "$@"; then :; else echo "    not ok: $_what"; CASE_OK=0; fi
}

t() {
    case "$1" in *"$FILTER"*) ;; *) return ;; esac
    CASE_OK=1
    setup
    $2
    teardown
    if [ $CASE_OK = 1 ]; then pass=$((pass + 1)); echo "ok   $1"; else fail=$((fail + 1)); failed="$failed $1"; echo "FAIL $1"; fi
}

# ---------------------------------------------------------------- cases

test_healthy() {
    flag_on; sshd_up
    cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"
    json
    check "valid JSON with no findings" python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert d['findings']==[], d['findings']" "$T/s.json"
    check "one key" is "$(field keys)" 1
    check "password none" is "$(field password)" '"none"'
    check "listening" is "$(field listening)" true
    check "the IP" is "$(field ips)" '["192.168.1.50"]'
    check "no Entware" is "$(field entwareInstalled)" false
}

test_ssh_off_then_on() {
    cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"
    json
    check "ssh-off found" finding ssh-off
    run ssh-on
    check "turned on" has "Turned SSH on"
    check "started" has "Started the SSH server"
    check "flag set" test -f "$SD_ROOT/var/luna/preferences/webosbrew_sshd_enabled"
    check "host key folder made" test -d "$SD_ROOT/var/lib/webosbrew/sshd"
    json
    check "no longer off" nofinding ssh-off
    check "not not-running" nofinding ssh-not-running
}

test_flag_but_not_running() {
    flag_on
    json
    check "not running found" finding ssh-not-running
    run ssh-on
    check "started" has "Started the SSH server"
    check "no 'turned on' (it was on)" lacks "Turned SSH on"
}

test_running_but_off_next_boot() {
    sshd_up
    json
    check "tip: off at next boot" finding ssh-off-next-boot
}

test_locked_out_then_password() {
    flag_on; sshd_up
    : > "$(AK)"; chmod 600 "$(AK)"
    json
    check "no way in" finding no-way-in
    run password-on
    check "says alpine" has "password alpine"
    check "keys set aside" test ! -f "$(AK)"
    check "set aside file kept" sh -c "ls '$SD_ROOT/home/root/.ssh/' | grep -q 'authorized_keys.ssh-doctor-off-'"
    check "shadow has alpine" grep -q '^root:xGVw8H4GqkKg6:' "$SD_ROOT/etc/shadow"
    check "other users untouched" grep -q '^bin:\*:' "$SD_ROOT/etc/shadow"
    json
    check "no longer locked out" nofinding no-way-in
    check "default password tip" finding password-default
}

test_no_keys_no_password() {
    flag_on; sshd_up; rm -f "$(AK)"
    json
    check "no password found" finding no-password
}

test_messy_key_file() {
    flag_on; sshd_up; alpine
    {
        printf '\357\273\277'
        printf '%s\r\n' "$(cat "$T/k_ed.pub")"
        # an RSA key wrapped at 64 columns, comment on its own line
        _l=$(cut -d' ' -f1,2 "$T/k_rsa.pub")
        printf '%s\n' "$(printf '%s' "$_l" | cut -c1-64)"
        printf '%s' "$_l" | cut -c65- | fold -w 64; echo
        echo "me@rsa"
        # PuTTYgen's export of the ed25519 key
        echo '---- BEGIN SSH2 PUBLIC KEY ----'
        echo 'Comment: "putty-key"'
        cut -d' ' -f2 "$T/k_ed.pub" | fold -w 40
        echo '---- END SSH2 PUBLIC KEY ----'
        cat "$T/k_ed"
        echo 'this is not a key'
        echo '# a comment that stays'
    } > "$(AK)"
    chmod 666 "$(AK)"
    json
    check "fixable found" finding keys-fixable
    check "private found" finding keys-private
    check "bad found" finding keys-bad
    check "perms found" finding perms
    run fix-keys
    check "backed up" sh -c "ls '$SD_ROOT/home/root/.ssh/' | grep -q 'authorized_keys.ssh-doctor-2'"
    check "rejected file" sh -c "ls '$SD_ROOT/home/root/.ssh/' | grep -q 'authorized_keys.rejected-'"
    check "private key moved out" sh -c "! grep -q PRIVATE '$(AK)'"
    check "private key in rejected" sh -c "grep -q PRIVATE '$SD_ROOT'/home/root/.ssh/authorized_keys.rejected-*"
    check "no CR left" sh -c "! grep -q \"\$(printf '\\r')\" '$(AK)'"
    check "rsa key whole again" grep -q -F "$(cut -d' ' -f1,2 "$T/k_rsa.pub")" "$(AK)"
    check "putty key converted" grep -q -F "$(cut -d' ' -f1,2 "$T/k_ed.pub") putty-key" "$(AK)"
    check "comment kept" grep -q '^# a comment that stays' "$(AK)"
    check "perms 600" is "$(stat -c %a "$(AK)")" 600
    check "3 usable keys" has "Usable keys now: 3"
    check "ssh-keygen reads every line" sh -c "grep -v '^#' '$(AK)' | while read -r l; do printf '%s\n' \"\$l\" > '$T/one'; ssh-keygen -lf '$T/one' >/dev/null || exit 1; done"
    json
    check "clean now" python3 -c "import json,sys; d=json.load(open(sys.argv[1])); assert [f['code'] for f in d['findings']]==['password-default'], d['findings']" "$T/s.json"
}

test_loose_home() {
    flag_on; sshd_up
    cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"
    chmod 777 "$SD_ROOT/home/root"; chmod 775 "$SD_ROOT/home/root/.ssh"
    json
    check "perms found" finding perms
    run fix-keys
    check "home fixed" is "$(stat -c %a "$SD_ROOT/home/root")" 755
    check "dir fixed" is "$(stat -c %a "$SD_ROOT/home/root/.ssh")" 700
    json
    check "perms gone" nofinding perms
}

test_add_key() {
    flag_on; sshd_up; alpine; rm -f "$(AK)"
    run add-key "$T/k_ed.pub"
    check "added" has "Added the key"
    check "first-key warning" has "alpine password stops working"
    run add-key "$T/k_ed.pub"
    check "duplicate noticed" has "already there"
    run add-key "$T/k_rsa.pub"
    check "second added" has "Added the key"
    check "no warning the second time" lacks "stops working"
    check "two keys" is "$(grep -c . "$(AK)")" 2
    run add-key "$T/k_ed"
    check "private key refused" is "$RC" 1
    run keys --json
    check "keys listed with fingerprints" sh -c "printf '%s' '$OUT' | python3 -c \"import json,sys; k=json.load(sys.stdin); assert len(k)==2 and all(x['fp'].startswith('SHA256:') for x in k)\""
    check "fingerprint matches ssh-keygen" has "$(ssh-keygen -lf "$T/k_ed.pub" | cut -d' ' -f2)"
}

test_restore() {
    cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"
    run add-key "$T/k_rsa.pub"
    _b=$($SH "$ROOT/ssh-doctor.sh" backups | head -n 1)
    check "a backup listed" test -n "$_b"
    run restore "$_b"
    check "restored" has "Put $_b back"
    check "one key again" is "$(grep -c . "$(AK)")" 1
    run restore ../../etc/shadow
    check "refuses other paths" is "$RC" 1
}

test_legacy_dropbear() {
    flag_on; sshd_up
    export FAKE_DB_VER=2019.78
    json
    check "legacy rsa" is "$(field legacyRsa)" true
    check "version read" is "$(field dropbear)" '"2019.78"'
    unset FAKE_DB_VER
    json
    check "modern" is "$(field legacyRsa)" false
}

test_host_fingerprints() {
    # A real dropbear ed25519 host key layout: string type, string(seed+pub)
    python3 - "$SD_ROOT/var/lib/webosbrew/sshd/dropbear_ed25519_host_key" "$T/k_ed.pub" <<'EOF'
import sys, base64, struct
blob = base64.b64decode(open(sys.argv[2]).read().split()[1])
pub = blob[-32:]
def s(b): return struct.pack('>I', len(b)) + b
open(sys.argv[1], 'wb').write(s(b'ssh-ed25519') + s(b'\x01' * 32 + pub))
EOF
    json
    check "host key fingerprint" sh -c "grep -q -F \"$(ssh-keygen -lf "$T/k_ed.pub" | cut -d' ' -f2)\" '$T/s.json'"
}

test_failsafe_and_telnet() {
    flag_on; sshd_up
    cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"
    : > "$SD_ROOT/var/luna/preferences/webosbrew_failsafe"
    : > "$SD_ROOT/var/luna/preferences/webosbrew_telnet_disabled"
    json
    check "failsafe" finding failsafe
    check "telnet off tip" finding telnet-off
}

test_pairing() {
    flag_on; sshd_up; alpine
    run pair-start
    check "started with a code" has '"state":"waiting"'
    _port=$(printf '%s' "$OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["port"])')
    _code=$(printf '%s' "$OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["code"])')
    check "code looks right" sh -c "printf '%s' '$_code' | grep -Eq '^[A-HJKMNP-Z2-9]{3}-[A-HJKMNP-Z2-9]{3}$'"
    _u="http://127.0.0.1:$_port"
    check "page served" sh -c "curl -s '$_u/' | grep -q 'Enter the code'"
    check "key maker served" sh -c "curl -s '$_u/sshkey.js' | grep -q makeKey"
    _r=$(curl -s -X POST -d '{"code":"AAA-AAA"}' "$_u/api/code")
    check "wrong code refused" sh -c "printf '%s' '$_r' | grep -q '\"triesLeft\":4'"
    _r=$(curl -s -X POST -d "{\"code\":\"$(printf '%s' "$_code" | tr '[:upper:]' '[:lower:]' | tr -d -)\"}" "$_u/api/code")
    _tok=$(printf '%s' "$_r" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))')
    check "right code (any case, no dash) gives a token" test -n "$_tok"
    _r=$(curl -s -X POST -d "{\"code\":\"$_code\"}" "$_u/api/code")
    check "code works only once" sh -c "printf '%s' '$_r' | grep -q busy"
    _r=$(curl -s -X POST -d "{\"token\":\"nope\",\"key\":\"x\"}" "$_u/api/key")
    check "key needs the token" sh -c "printf '%s' '$_r' | grep -q not-paired"
    _priv=$(python3 -c 'import json,sys; print(json.dumps(open(sys.argv[1]).read()))' "$T/k_ed")
    _r=$(curl -s -X POST -d "{\"token\":\"$_tok\",\"key\":$_priv}" "$_u/api/key")
    check "private key refused" sh -c "printf '%s' '$_r' | grep -q private"
    _pub=$(python3 -c 'import json,sys; print(json.dumps("command=\"evil\" " + open(sys.argv[1]).read()))' "$T/k_ed.pub")
    _r=$(curl -s -X POST -d "{\"token\":\"$_tok\",\"key\":$_pub}" "$_u/api/key")
    check "public key accepted" sh -c "printf '%s' '$_r' | grep -q '\"ok\":true'"
    run pair-status
    check "pending on the TV" has '"state":"pending"'
    check "fingerprint shown" has "$(ssh-keygen -lf "$T/k_ed.pub" | cut -d' ' -f2)"
    run pair-accept
    check "added" has "Added the key"
    check "options from the network dropped" sh -c "! grep -q evil '$(AK)'"
    check "key in place" grep -q -F "$(cut -d' ' -f2 "$T/k_ed.pub")" "$(AK)"
    sleep 1.5
    _r=$(curl -s "$_u/api/status?token=$_tok")
    check "browser sees accepted" sh -c "printf '%s' '$_r' | grep -q accepted"
    run pair-stop
    check "stopped" has stopped
    check "server gone" sh -c "! curl -s -m 2 '$_u/' >/dev/null"
}

test_pairing_wrong_codes() {
    run pair-start
    _port=$(printf '%s' "$OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["port"])')
    _first=$(printf '%s' "$OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["code"])')
    for _ in 1 2 3 4 5; do _r=$(curl -s -X POST -d '{"code":"AAAAAA"}' "http://127.0.0.1:$_port/api/code"); done
    check "new code after 5 wrong" sh -c "printf '%s' '$_r' | grep -q new-code"
    run pair-status
    check "TV shows a different code" lacks "$_first"
    for _ in 1 2 3 4 5 6 7 8 9 10; do _r=$(curl -s -X POST -d '{"code":"AAAAAA"}' "http://127.0.0.1:$_port/api/code"); done
    check "locked after 3 codes" sh -c "printf '%s' '$_r' | grep -q locked"
    sleep 1
    run pair-status
    check "server stopped" sh -c "printf '%s' '$OUT' | grep -Eq 'locked|stopped'"
}

test_pairing_screen_closed() {
    run pair-start
    _port=$(printf '%s' "$OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["port"])')
    touch -d '-60 seconds' "$SD_ROOT/tmp/ssh-doctor/pair/alive"
    sleep 2
    check "server stops when the TV stops asking" sh -c "! curl -s -m 2 'http://127.0.0.1:$_port/' >/dev/null"
}

conf() { cat "$SD_ROOT/var/lib/webosbrew/ssh-doctor/settings" 2>/dev/null; }
flags() { "$SD_NODE" -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(d.settings.flags)' "$T/s.json"; }
HOOKF() { printf '%s' "$SD_ROOT/var/lib/webosbrew/init.d/60-ssh-doctor"; }
# shellcheck disable=SC2016
HASH='$6$saltsalt$qbHuK7xFlN1yPTwzI.kPmEsoEXGtxTSFwPd18L8Oxkg2kjbOIRsbAkOfHQ7tl.bqWj3ywXHXP3uDz3n0Pbgt0/'

test_servers() {
    flag_on; sshd_up
    _hbc=$(fake_pids | head -n 1)
    fake_proc dropbear "$BIN/dropbear -R -2 9" "$_hbc" > /dev/null          # a session
    fake_proc sshd "/opt/sbin/sshd -D" 1 2222 > /dev/null                 # Entware OpenSSH
    fake_proc sshd "/usr/sbin/sshd -f /etc/devmode/sshd_config" 1 9922 > /dev/null
    run servers --json
    check "three servers" sh -c "printf '%s' '$OUT' | python3 -c \"import json,sys; d=json.load(sys.stdin); assert sorted(x['kind'] for x in d)==['devmode','entware-openssh','hbc'], d\""
    check "hbc on 22" sh -c "printf '%s' '$OUT' | python3 -c \"import json,sys; d=json.load(sys.stdin); assert [x['ports'] for x in d if x['kind']=='hbc']==[[22]], d\""
    json
    check "other ssh tip" finding other-ssh
    check "no port problem" nofinding port-taken
}

test_port_taken() {
    flag_on
    fake_proc sshd "/opt/sbin/sshd -D" 1 22 > /dev/null
    json
    check "port taken" finding port-taken
    check "not called ssh-off" nofinding ssh-not-running
    run ssh-on
    check "ssh-on refuses" is "$RC" 1
    check "says who" has "entware-openssh"
}

test_port_change() {
    flag_on; sshd_up; cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"
    run set-port 80
    check "low port refused" is "$RC" 1
    fake_proc sshd "/opt/sbin/sshd -D" 1 2200 > /dev/null
    run set-port 2200
    check "used port refused" is "$RC" 1
    run set-port 2222
    check "set" is "$RC" 0
    check "both ports" sh -c "grep -q ':0016 ' '$SD_ROOT/proc/net/tcp' && grep -q ':08AE ' '$SD_ROOT/proc/net/tcp'"
    check "conf" sh -c "printf '%s' '$(conf)' | grep -q 'PORT=2222' && printf '%s' '$(conf)' | grep -q 'TRIAL=22'"
    check "hook installed" test -x "$(HOOKF)"
    check "hook has a script" test -f "$SD_ROOT/var/lib/webosbrew/ssh-doctor/ssh-doctor.sh"
    json
    check "port 2222" is "$(field port)" 2222
    check "trial tip" finding port-trial
    check "applied" is "$(flags)" "-R -p 2222 -p 22"
    check "no not-applied" nofinding settings-not-applied
    run port-keep
    check "kept" has "Kept port 2222"
    check "22 closed" sh -c "! grep -q ':0016 ' '$SD_ROOT/proc/net/tcp'"
    run set-port 2223
    run port-revert
    check "back to 2222" has "back on port 2222"
    json
    check "running on 2222 only" is "$(flags)" "-R -p 2222"
    export FAKE_DB_FAIL=2224
    run set-port 2224
    unset FAKE_DB_FAIL
    check "failed start reported" is "$RC" 1
    check "rolled back" sh -c "printf '%s' '$(conf)' | grep -q 'PORT=2222' && ! printf '%s' '$(conf)' | grep -q TRIAL"
    json
    check "running again after the failure" is "$(field listening)" true
    run set-port 22
    run port-keep
    json
    check "back to plain -R" is "$(flags)" "-R"
    check "no hook when nothing is set" test ! -e "$(HOOKF)"
}

test_password() {
    flag_on; sshd_up; cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"
    run set-password 'alpine'
    check "plain text refused" is "$RC" 1
    run set-password "$HASH"
    check "set" has "Set root's password"
    check "shadow has it" grep -q -F "root:$HASH:" "$SD_ROOT/etc/shadow"
    check "hash kept private" is "$(stat -c %a "$SD_ROOT/var/lib/webosbrew/ssh-doctor/root.hash")" 600
    check "hook" test -x "$(HOOKF)"
    json
    check "password set" is "$(field password)" '"set"'
    check "not the default tip" nofinding password-default
    run clear-password
    check "cleared, keys file kept password off" grep -q '^root:\*:' "$SD_ROOT/etc/shadow"
    check "hook gone" test ! -e "$(HOOKF)"
    run set-password "$HASH"
    rm -f "$(AK)"
    run clear-password
    check "no keys file: alpine back" grep -q '^root:xGVw8H4GqkKg6:' "$SD_ROOT/etc/shadow"
}

test_keys_only() {
    flag_on; sshd_up; alpine; rm -f "$(AK)"
    run set-keys-only on
    check "refused without a key" is "$RC" 1
    cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"
    run set-keys-only on
    check "on" has "Keys only is on"
    json
    check "-s" is "$(flags)" "-R -s"
    check "keysOnly" is "$(field keysOnly)" true
    check "no alpine tip with keys only" nofinding password-default
    run key-remove "$(ssh-keygen -lf "$T/k_ed.pub" | cut -d' ' -f2)"
    check "last key kept while keys only" is "$RC" 1
    run set-password "$HASH"
    run password-on
    check "locked-out fix drops keys only" sh -c "! printf '%s' '$(conf)' | grep -q KEYSONLY"
    check "and the own password" test ! -f "$SD_ROOT/var/lib/webosbrew/ssh-doctor/root.hash"
    check "alpine on" grep -q '^root:xGVw8H4GqkKg6:' "$SD_ROOT/etc/shadow"
    json
    check "running plain again" is "$(flags)" "-R"
}

test_keepalive_and_reset() {
    flag_on; sshd_up; cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"
    run set-keepalive on
    json
    check "-K" is "$(flags)" "-R -K 30"
    run set-port 2222
    run set-password "$HASH"
    run reset-settings
    check "reset says so" has "Removed every SSH setting"
    check "no settings dir" test ! -e "$SD_ROOT/var/lib/webosbrew/ssh-doctor"
    check "no hook" test ! -e "$(HOOKF)"
    json
    check "plain -R" is "$(flags)" "-R"
    check "port 22" is "$(field port)" 22
}

test_settings_not_applied_and_boot() {
    flag_on; sshd_up; cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"
    run set-keepalive on
    # A restart: the Homebrew Channel starts dropbear its own way, then the hook runs
    for p in $(fake_pids); do fake_kill "$p"; done
    sshd_up
    json
    check "noticed" finding settings-not-applied
    # As at a real boot: the Homebrew Channel's failsafe flag is there while
    # init.d runs, and goes away a few seconds later
    : > "$SD_ROOT/var/luna/preferences/webosbrew_failsafe"
    ( sleep 2; rm -f "$SD_ROOT/var/luna/preferences/webosbrew_failsafe" ) &
    $SH "$SD_ROOT/var/lib/webosbrew/ssh-doctor/ssh-doctor.sh" boot > "$T/boot.log" 2>&1
    check "boot waited for the failsafe flag" sh -c "grep -q applying '$T/boot.log'"
    check "no error copying the script onto itself" sh -c "! grep -q 'same file' '$T/boot.log'"
    json
    check "boot applied it" is "$(flags)" "-R -K 30"
    check "nothing pending" nofinding settings-not-applied
}

test_logins() {
    flag_on; sshd_up
    _fp=$(ssh-keygen -lf "$T/k_ed.pub" | cut -d' ' -f2)
    {
        echo "2026-11-08T01:00:00.1Z [1.0] authpriv.notice dropbear[100] Pubkey auth succeeded for 'root' with ssh-ed25519 key $_fp from 192.168.1.10:5000"
        echo "2026-11-08T01:00:01.1Z [1.0] user.info someone[1] Pubkey auth succeeded for nothing"
    } | gzip > "$T/log/legacy-log.1.gz"
    {
        echo "2026-11-08T02:00:00.1Z [1.0] authpriv.notice dropbear[101] Password auth succeeded for 'root' from 192.168.1.11:5001"
        for i in 1 2 3 4 5; do echo "2026-11-08T02:0$i:00.1Z [1.0] authpriv.warn dropbear[10$i] Bad password attempt for 'root' from 10.0.0.9:600$i"; done
        echo "2026-11-08T02:09:00.1Z [1.0] authpriv.warn dropbear[109] Login attempt for nonexistent user from <10.0.0.9:6009>"
    } > "$T/log/legacy-log"
    run logins --json
    check "counts" sh -c "printf '%s' '$OUT' | python3 -c \"import json,sys; d=json.load(sys.stdin); assert d['ok']==2 and d['failed']==6, d\""
    check "newest first" sh -c "printf '%s' '$OUT' | python3 -c \"import json,sys; d=json.load(sys.stdin); assert d['events'][0]['kind']=='bad-user' and d['events'][0]['ip']=='10.0.0.9', d['events'][0]\""
    check "key last used" sh -c "printf '%s' '$OUT' | python3 -c \"import json,sys; d=json.load(sys.stdin); assert d['lastUsed']['$_fp'].startswith('2026-11-08T01'), d['lastUsed']\""
    check "failed from" sh -c "printf '%s' '$OUT' | python3 -c \"import json,sys; d=json.load(sys.stdin); assert d['failedFrom']==[{'ip':'10.0.0.9','n':6}], d['failedFrom']\""
    json
    check "failed logins tip" finding failed-logins
    check "count in status" is "$(field failedLogins)" 6
}

test_host_keys() {
    flag_on; sshd_up
    python3 - "$SD_ROOT/var/lib/webosbrew/sshd/dropbear_ed25519_host_key" "$T/k_ed.pub" <<'PY'
import sys, base64, struct
blob = base64.b64decode(open(sys.argv[2]).read().split()[1])
def s(b): return struct.pack('>I', len(b)) + b
open(sys.argv[1], 'wb').write(s(b'ssh-ed25519') + s(b'\x01' * 32 + blob[-32:]))
PY
    run hostkeys --json
    check "public line matches" has "$(cut -d' ' -f1,2 "$T/k_ed.pub")"
    : > "$SD_ROOT/var/lib/webosbrew/sshd/dropbear_rsa_host_key"
    json
    check "empty key noticed" finding hostkey-broken
    run hostkeys-reset
    check "backed up" sh -c "ls -d '$SD_ROOT'/var/lib/webosbrew/sshd.ssh-doctor-* >/dev/null"
    check "keys gone" sh -c "! ls '$SD_ROOT'/var/lib/webosbrew/sshd/dropbear_* 2>/dev/null"
    check "backup has the old key" sh -c "ls '$SD_ROOT'/var/lib/webosbrew/sshd.ssh-doctor-*/dropbear_ed25519_host_key"
    json
    check "fine now" nofinding hostkey-broken
    check "still running" is "$(field listening)" true
}

test_telnet() {
    flag_on; sshd_up; "$BIN/telnetd" -l /bin/sh
    run telnet-off
    check "refused with no way in" is "$RC" 1
    cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"
    run telnet-off
    check "off" has "Turned telnet off"
    check "flag" test -f "$SD_ROOT/var/luna/preferences/webosbrew_telnet_disabled"
    json
    check "not running" is "$(field telnetRunning)" false
    run telnet-on
    check "on" has "Turned telnet on"
    json
    check "running" is "$(field telnetRunning)" true
    check "flag gone" test ! -f "$SD_ROOT/var/luna/preferences/webosbrew_telnet_disabled"
}

test_key_edit() {
    flag_on; sshd_up
    cat "$T/k_ed.pub" "$T/k_rsa.pub" > "$(AK)"; chmod 600 "$(AK)"
    _fp=$(ssh-keygen -lf "$T/k_rsa.pub" | cut -d' ' -f2)
    run key-rename "$_fp" "Living room laptop"
    check "renamed" grep -q "Living room laptop" "$(AK)"
    check "key itself kept" grep -q -F "$(cut -d' ' -f2 "$T/k_rsa.pub")" "$(AK)"
    check "backup made" sh -c "ls '$SD_ROOT/home/root/.ssh/' | grep -q 'authorized_keys.ssh-doctor-'"
    run key-remove "$_fp"
    check "removed" has "Removed the key"
    check "one left" is "$(grep -c . "$(AK)")" 1
    run key-remove "SHA256:nope"
    check "unknown refused" is "$RC" 1
}

test_report() {
    flag_on; sshd_up; cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"
    echo "2026-11-08T02:00:00.1Z [1.0] authpriv.notice dropbear[101] Password auth succeeded for 'root' from 192.168.1.11:5001" > "$T/log/legacy-log"
    run report
    check "has versions" has "SSH Doctor 0.5.0"
    check "has findings line" has "Findings:"
    check "no IP addresses" sh -c "! printf '%s' '$OUT' | grep -Eq '([0-9]{1,3}\.){3}[0-9]{1,3}'"
    check "no key fingerprints" lacks "SHA256:"
}

# ---------------------------------------------------------------- Entware

OPTD() { printf '%s' "$SD_ROOT/opt"; }
# Entware's OpenSSH installed, with its start script; "auto" also starts
# Entware at boot the way the Entware installer does
entware_sshd() {
    mkdir -p "$(OPTD)/sbin" "$(OPTD)/etc/ssh" "$(OPTD)/etc/init.d"
    cp "$HERE/fakebin/sshd" "$(OPTD)/sbin/sshd"; chmod 755 "$(OPTD)/sbin/sshd"
    printf '#!/bin/sh\n' > "$(OPTD)/etc/init.d/S40sshd"; chmod 755 "$(OPTD)/etc/init.d/S40sshd"
    : > "$(OPTD)/etc/ssh/sshd_config"
    printf 'x' > "$(OPTD)/etc/ssh/ssh_host_ed25519_key"
    if [ "${1:-}" = auto ]; then
        mkdir -p "$SD_ROOT/var/lib/webosbrew/init.d"
        printf '#!/bin/sh\n/opt/etc/init.d/rc.unslung start\n' > "$SD_ROOT/var/lib/webosbrew/init.d/S99entware"
    fi
}
# ...and running, listening on PORT
entware_sshd_up() { fake_proc sshd "/opt/sbin/sshd" 1 "${1:-22}" > /dev/null; }
ent_root_password() { mkdir -p "$(OPTD)/etc"; printf 'root:%s:15069:0:99999:7:::\n' "$1" > "$(OPTD)/etc/shadow"; }
levels() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(' '.join(sorted(set(f['level'] for f in d['findings']))))" "$T/s.json"; }
level_of() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print([f['level'] for f in d['findings'] if f['code']==sys.argv[2]][0])" "$T/s.json" "$1"; }
ent() { python3 -c "import json,sys; d=json.load(open(sys.argv[1])); e=[x for x in d['entware'] if x['kind']==sys.argv[2]][0]; print(json.dumps(e[sys.argv[3]]))" "$T/s.json" "$1" "$2"; }

test_entware_openssh_in_use() {
    # The Homebrew Channel's SSH is off; Entware's OpenSSH answers on 2200
    entware_sshd auto; entware_sshd_up 2200
    cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"
    json
    check "no ssh-off" nofinding ssh-off
    check "port 22 isn't 'taken'" nofinding port-taken
    check "says Entware's is in use" finding ssh-is-entware
    check "no other-ssh as well" nofinding other-ssh
    check "only tips" is "$(levels)" tip
    mkdir -p "$(OPTD)/bin"; printf '#!/bin/sh\n' > "$(OPTD)/bin/opkg"; chmod 755 "$(OPTD)/bin/opkg"
    json
    check "active" is "$(field active)" '"entware-openssh"'
    check "Entware installed" is "$(field entwareInstalled)" true
    check "can log in" is "$(field entwareLogin)" true
    check "running, on 2200" is "$(ent entware-openssh ports)" '[2200]'
    run status
    check "text names it" has "Logging in goes through entware-openssh"
    run entware --json
    check "entware command" has '"kind":"entware-openssh"'
    run pair-start
    check "pairing page uses Entware's port" grep -q '"port":2200,"legacyRsa":false,"hostKeys":\[\]' "$SD_ROOT/tmp/ssh-doctor/pair/info.json"
    # Both: Entware's on 22 too, so the Homebrew Channel's can't be turned on there
    entware_sshd_up 22
    json
    check "still not a problem while the Homebrew Channel's is off" nofinding port-taken
}

test_entware_openssh_root_password() {
    entware_sshd auto; entware_sshd_up 22; rm -f "$(AK)"
    # alpine is in /etc/shadow, but Entware's programs read /opt/etc/shadow
    alpine
    json
    check "no Entware password: locked out" finding entware-no-way-in
    check "not the Homebrew Channel's lockout" nofinding no-password
    check "no alpine tip (not used here)" nofinding password-default
    ent_root_password "$HASH"
    json
    check "OpenSSH turns root's password off by default" finding entware-no-way-in
    check "passwordOff" is "$(ent entware-openssh passwordOff)" true
    echo 'PermitRootLogin yes' > "$(OPTD)/etc/ssh/sshd_config"
    json
    check "PermitRootLogin yes and a password: fine" nofinding entware-no-way-in
    echo 'PermitRootLogin no' > "$(OPTD)/etc/ssh/sshd_config"
    json
    check "root not allowed at all" finding sshd-root-denied
    check "a problem, since it's the way in" is "$(level_of sshd-root-denied)" problem
}

test_entware_openssh_broken() {
    flag_on; sshd_up; cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"
    entware_sshd auto
    printf 'Port 2222\nBROKEN yes\n' > "$(OPTD)/etc/ssh/sshd_config"
    json
    check "config refused" finding sshd-config-bad
    check "a tip while the Homebrew Channel's works" is "$(level_of sshd-config-bad)" tip
    check "sshd's words kept" sh -c "python3 -c \"import json,sys; d=json.load(open('$T/s.json')); assert 'Bad configuration option' in d['entware'][0]['detail']\""
    check "Homebrew Channel still the way in" is "$(field active)" '"hbc"'
    printf 'Port 2222\nAuthorizedKeysFile /opt/etc/keys/%%u\n' > "$(OPTD)/etc/ssh/sshd_config"
    : > "$(OPTD)/etc/ssh/ssh_host_ed25519_key"
    json
    check "keys read from elsewhere" finding sshd-keyfile-elsewhere
    check "empty host key" finding sshd-hostkey-broken
    check "stopped, port free" finding entware-stopped
    printf 'x' > "$(OPTD)/etc/ssh/ssh_host_ed25519_key"
    export FAKE_SSHD_NOKEYS=1
    json
    unset FAKE_SSHD_NOKEYS
    check "no host keys counts as a host key problem" finding sshd-hostkey-broken
    check "not as a settings problem" nofinding sshd-config-bad
    # Nothing answers now: Entware's problems are problems
    for p in $(fake_pids); do fake_kill "$p"; done
    rm -f "$SD_ROOT/var/luna/preferences/webosbrew_sshd_enabled"
    json
    check "a problem with nothing else running" is "$(level_of entware-stopped)" problem
}

test_entware_port_clash() {
    flag_on; sshd_up; cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"
    entware_sshd
    json
    check "can't start on the Homebrew Channel's port" finding entware-port-clash
    check "not called stopped" nofinding entware-stopped
    check "no autostart noticed" finding entware-no-autostart
    check "SSH itself is fine" is "$(levels)" tip
    # Both turned on, Entware's won the port: the Homebrew Channel's can't start
    for p in $(fake_pids); do fake_kill "$p"; done
    entware_sshd_up 22
    json
    check "port taken, since the Homebrew Channel's is turned on" finding port-taken
}

test_entware_dropbear() {
    flag_on; sshd_up; cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"
    mkdir -p "$(OPTD)/sbin" "$(OPTD)/etc/dropbear" "$(OPTD)/etc/init.d"
    printf '#!/bin/sh\nexit 0\n' > "$(OPTD)/sbin/dropbear"; chmod 755 "$(OPTD)/sbin/dropbear"
    printf '#!/bin/sh\nARGS="-p 2222 -a"\n' > "$(OPTD)/etc/init.d/S51dropbear"
    : > "$(OPTD)/etc/dropbear/dropbear_ed25519_host_key"
    json
    check "empty host key" finding edb-hostkey-broken
    check "stopped" finding entware-stopped
    check "port from its start script" is "$(ent entware-dropbear port)" 2222
    fake_proc dropbear "/opt/sbin/dropbear -p 2222" 1 2222 > /dev/null
    json
    check "running now" is "$(ent entware-dropbear running)" true
    check "not stopped" nofinding entware-stopped
    run report
    check "report names it" has "Entware entware-dropbear: installed, running yes, port 2222"
}

# ---------------------------------------------------------------- startup check, kit, exposure

boot_result() { awk 'NR == 1 { $1 = ""; sub(/^ /, ""); print }' "$SD_ROOT/var/lib/webosbrew/ssh-doctor/boot.last" 2>/dev/null; }
restart_tv() { for p in $(fake_pids); do fake_kill "$p"; done; }

test_boot_fix() {
    flag_on; sshd_up; cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"
    run set-bootfix on
    check "on" has "checked at every start"
    check "hook installed for it" test -x "$(HOOKF)"
    json
    check "bootFix in settings" sh -c "python3 -c \"import json; d=json.load(open('$T/s.json')); assert d['settings']['bootFix'] is True\""
    check "the hook prefers the app's own script" grep -q 'org.ohmybahgosh.sshdoctor/assets/ssh-doctor.sh' "$(HOOKF)"
    # A start where the Homebrew Channel's dropbear didn't come up, and the keys file got loose permissions
    restart_tv; chmod 666 "$(AK)"
    $SH "$SD_ROOT/var/lib/webosbrew/ssh-doctor/ssh-doctor.sh" boot > "$T/boot.log" 2>&1
    check "started and fixed" is "$(boot_result)" "started perms"
    check "permissions fixed" is "$(stat -c %a "$(AK)")" 600
    json
    check "running again" is "$(field listening)" true
    check "says it started SSH" finding boot-started
    check "says it fixed permissions" finding boot-perms
    check "lastBoot in settings" sh -c "python3 -c \"import json; d=json.load(open('$T/s.json')); assert d['settings']['lastBoot']['result']=='started perms'\""
    # A normal start
    $SH "$ROOT/ssh-doctor.sh" boot > "$T/boot.log" 2>&1
    check "ok when nothing's wrong" is "$(boot_result)" ok
    json
    check "no old news" nofinding boot-started
    # Off: only noted, nothing started
    run set-bootfix off
    restart_tv
    $SH "$ROOT/ssh-doctor.sh" boot > "$T/boot.log" 2>&1
    check "down, left alone" is "$(boot_result)" down
    json
    check "not started" is "$(field listening)" false
    # Another program on the port: never touched
    run set-bootfix on
    fake_proc sshd "/opt/sbin/sshd" 1 22 > /dev/null
    $SH "$ROOT/ssh-doctor.sh" boot > "$T/boot.log" 2>&1
    check "port taken, left alone" is "$(boot_result)" port-taken
    check "the other server still there" sh -c "grep -l -x sshd '$SD_ROOT'/proc/*/comm >/dev/null"
    run reset-settings
    check "reset removes the record" test ! -e "$SD_ROOT/var/lib/webosbrew/ssh-doctor/boot.last"
}

host_key() {
    python3 - "$SD_ROOT/var/lib/webosbrew/sshd/dropbear_ed25519_host_key" "$T/k_ed.pub" <<'PY'
import sys, base64, struct
blob = base64.b64decode(open(sys.argv[2]).read().split()[1])
def s(b): return struct.pack('>I', len(b)) + b
open(sys.argv[1], 'wb').write(s(b'ssh-ed25519') + s(b'\x01' * 32 + blob[-32:]))
PY
}
USB() { printf '%s' "$SD_ROOT/tmp/usb/sda/sda1"; }

test_kit() {
    flag_on; sshd_up; cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"; host_key
    run kit-save
    check "no USB drive: refused" is "$RC" 1
    mkdir -p "$(USB)"
    run set-port 2222; run port-keep; run set-keepalive on; run set-password "$HASH"
    run kit-save
    check "saved" has "Saved to $(USB)/ssh-doctor-kit/"
    check "warns about the private keys" has "keep the drive somewhere safe"
    run kit-list --json
    _name=$(printf '%s' "$OUT" | python3 -c 'import json,sys; k=json.load(sys.stdin); assert len(k)==1 and k[0]["keys"]==1 and k[0]["hostKeys"]==1 and k[0]["settings"] and k[0]["password"], k; print(k[0]["name"])')
    check "listed" test -n "$_name"
    cp "$SD_ROOT/var/lib/webosbrew/sshd/dropbear_ed25519_host_key" "$T/hk.orig"
    # A factory reset and re-root: no keys, new host keys, no settings, port 22
    run reset-settings
    rm -f "$(AK)" "$SD_ROOT"/var/lib/webosbrew/sshd/*
    printf 'new' > "$SD_ROOT/var/lib/webosbrew/sshd/dropbear_ed25519_host_key"
    alpine
    run kit-restore "../$_name"
    check "odd names refused" is "$RC" 1
    run kit-restore "$_name"
    check "restored" is "$RC" 0
    check "keys back" grep -q -F "$(cut -d' ' -f2 "$T/k_ed.pub")" "$(AK)"
    check "keys file permissions" is "$(stat -c %a "$(AK)")" 600
    check "host key back, byte for byte" cmp -s "$T/hk.orig" "$SD_ROOT/var/lib/webosbrew/sshd/dropbear_ed25519_host_key"
    check "new host key backed up" sh -c "grep -q new '$SD_ROOT'/var/lib/webosbrew/sshd.ssh-doctor-*/dropbear_ed25519_host_key"
    check "password back" grep -q -F "root:$HASH:" "$SD_ROOT/etc/shadow"
    check "port tried, old one kept open" has "until you keep port 2222"
    json
    check "running with the settings" is "$(flags)" "-R -p 2222 -p 22 -K 30"
    check "trial" is "$(field port)" 2222
    # A kit saying keys only, with no key in it: keys only isn't put back
    _k2="$(USB)/ssh-doctor-kit/20260101-000000"
    mkdir -p "$_k2"; printf 'KEYSONLY=1\nPORT=80\nEVIL=1\n' > "$_k2/settings"; echo 'keys=0' > "$_k2/manifest"
    rm -f "$(AK)"
    run kit-restore 20260101-000000
    check "keys only not put back without a key" sh -c "! grep -q KEYSONLY '$SD_ROOT/var/lib/webosbrew/ssh-doctor/settings'"
    check "unknown settings dropped" sh -c "! grep -q EVIL '$SD_ROOT/var/lib/webosbrew/ssh-doctor/settings'"
    check "low port ignored (port 22)" sh -c "! grep -q 'PORT=80' '$SD_ROOT/var/lib/webosbrew/ssh-doctor/settings'"
}

IGD_PID=''
igd_start() {
    printf '%s' "$1" > "$T/igd.json"
    rm -f "$T/igd.ready"
    node "$HERE/fakebin/fake-igd.js" "$T/igd.json" "$T/igd.ready" > /dev/null 2>&1 &
    IGD_PID=$!
    _i=0; while [ ! -s "$T/igd.ready" ] && [ $_i -lt 50 ]; do sleep 0.1; _i=$((_i + 1)); done
    SD_SSDP_ADDR="127.0.0.1:$(cat "$T/igd.ready")"
    export SD_SSDP_ADDR SD_SSDP_WAIT=400
}
igd_stop() { [ -n "$IGD_PID" ] && kill "$IGD_PID" 2>/dev/null; IGD_PID=''; unset SD_SSDP_ADDR SD_SSDP_WAIT; }

test_exposure() {
    flag_on; sshd_up; cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"
    igd_start '[{"external":2222,"internal":22,"protocol":"TCP","client":"192.168.1.50","description":"tv"},{"external":8080,"internal":80,"protocol":"TCP","client":"192.168.1.9"}]'
    run exposure
    check "found" has "forwards these TV ports to the internet: 22"
    json
    check "a problem" finding ssh-exposed
    check "not telnet" nofinding telnet-exposed
    run exposure-close
    check "closed" has "any more"
    check "only the TV's forward removed" sh -c "! grep -q '\"internal\":22' '$T/igd.json' && grep -q 8080 '$T/igd.json'"
    json
    check "gone" nofinding ssh-exposed
    igd_stop
    igd_start '[{"external":23,"internal":23,"protocol":"TCP","client":"192.168.1.50"}]'
    run exposure --json
    check "json" has '"router":"found"'
    json
    check "telnet exposed" finding telnet-exposed
    igd_stop
    export SD_SSDP_ADDR=127.0.0.1:9 SD_SSDP_WAIT=300
    run exposure
    unset SD_SSDP_ADDR SD_SSDP_WAIT
    check "no router" has "No router answered"
    json
    check "no finding without an answer" nofinding ssh-exposed
}

test_sessions_kept() {
    # Found on a real TV: after dropbear restarts, its open sessions are left
    # with init as their parent.  They must not count as the server, or the
    # next restart closes them.
    flag_on; sshd_up; cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"
    _hbc=$(fake_pids | head -n 1)
    _s1=$(fake_proc dropbear "$BIN/dropbear -R -2 9" 1)
    _s2=$(fake_proc dropbear "$BIN/dropbear -R" 1)
    run servers --json
    check "only the server listed" sh -c "printf '%s' '$OUT' | python3 -c \"import json,sys; d=json.load(sys.stdin); assert [x['pid'] for x in d]==[$_hbc], d\""
    run set-keepalive on
    json
    check "restarted with the setting" is "$(flags)" "-R -K 30"
    check "session (-2) still open" test -d "$SD_ROOT/proc/$_s1"
    check "session (old style) still open" test -d "$SD_ROOT/proc/$_s2"
    run set-keepalive off
    check "still open after a second restart" test -d "$SD_ROOT/proc/$_s1"
    # The server gone, only sessions left: SSH isn't running
    for p in $(fake_pids); do [ "$p" = "$_s1" ] || [ "$p" = "$_s2" ] || fake_kill "$p"; done
    json
    check "not running" is "$(field running)" false
    check "found as not running" finding ssh-not-running
}

test_pairing_info() {
    flag_on; sshd_up; cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"; host_key
    run pair-start info
    check "started" has '"state":"waiting"'
    _port=$(printf '%s' "$OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["port"])')
    _code=$(printf '%s' "$OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["code"])')
    _u="http://127.0.0.1:$_port"
    _t1=$(curl -s -X POST -d "{\"code\":\"$_code\"}" "$_u/api/code" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))')
    _t2=$(curl -s -X POST -d "{\"code\":\"$_code\"}" "$_u/api/code" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token",""))')
    check "the code works for a phone" test -n "$_t1"
    check "and for a computer too" test -n "$_t2"
    run pair-status
    check "the code stays on the TV" has "\"code\":\"$_code\""
    _r=$(curl -s "$_u/api/status?token=$_t2")
    check "report, keys and fingerprints" sh -c "printf '%s' '$_r' | python3 -c \"import json,sys; i=json.load(sys.stdin)['info']; assert i['purpose']=='info' and 'SSH Doctor' in i['report'] and '\\\\n' in i['report'] and len(i['keys'])==1 and i['hostKeys'] and i['sftp'] is False, i\""
    check "no addresses in the report" sh -c "! printf '%s' '$_r' | python3 -c \"import json,sys; print(json.load(sys.stdin)['info']['report'])\" | grep -Eq '([0-9]{1,3}\.){3}[0-9]{1,3}'"
    _r=$(curl -s -X POST -d "{\"token\":\"$_t1\",\"key\":\"$(cat "$T/k_rsa.pub")\"}" "$_u/api/key")
    check "read only: no keys added" sh -c "printf '%s' '$_r' | grep -q wrong-purpose"
    check "keys file untouched" is "$(grep -c . "$(AK)")" 1
    run pair-stop key
    check "stopping a key page leaves it" has '"other"'
    check "still up" sh -c "curl -s -m 2 '$_u/' | grep -q code"
    run pair-stop info
    check "stopped" has stopped
}

REL_PID=''
release_start() {
    rm -f "$T/rel.ready"
    node "$HERE/fakebin/fake-release.js" "$1" "$T/rel.ready" > /dev/null 2>&1 &
    REL_PID=$!
    _i=0; while [ ! -s "$T/rel.ready" ] && [ $_i -lt 50 ]; do sleep 0.1; _i=$((_i + 1)); done
    SD_RELEASE_BASE="http://127.0.0.1:$(cat "$T/rel.ready")/rel"
    SD_API_BASE="http://127.0.0.1:$(cat "$T/rel.ready")/api"
    export SD_RELEASE_BASE SD_API_BASE SD_LUNA="$HERE/fakebin/luna-send" FAKE_LUNA_LOG="$T/luna.log"
}
release_stop() { [ -n "$REL_PID" ] && kill "$REL_PID" 2>/dev/null; REL_PID=''; unset SD_RELEASE_BASE SD_API_BASE SD_LUNA FAKE_LUNA_LOG FAKE_LUNA_FAIL; }
upd_wait() { _i=0; while [ $_i -lt 50 ]; do grep -q "\"state\":\"$1\"" "$SD_ROOT/tmp/ssh-doctor/update/state.json" 2>/dev/null && return 0; sleep 0.2; _i=$((_i + 1)); done; return 1; }

test_update() {
    flag_on; sshd_up; cat "$T/k_ed.pub" > "$(AK)"; chmod 600 "$(AK)"
    release_start 9.9.9
    run update-check
    check "newer found" has '"newer":true'
    check "its notes" has 'Something new'
    json
    check "shown on the main screen" finding update-available
    check "in the status" sh -c "python3 -c \"import json; d=json.load(open('$T/s.json')); assert d['update']['latest']=='9.9.9'\""
    run update-install
    check "started" has '"state":"starting"'
    check "installed" upd_wait "done"
    check "through the Homebrew Channel, with the hash" grep -q "hbchannel.service/install.*sd_9.9.9.ipk.*\"ipkHash\":\"abab" "$T/luna.log"
    _i=0; while [ $_i -lt 30 ] && ! grep -q applicationManager "$T/luna.log"; do sleep 0.2; _i=$((_i + 1)); done
    check "then the app opens again with what's new" grep -q 'applicationManager/launch.*"updated":"9.9.9"' "$T/luna.log"
    json
    check "no update left to offer" nofinding update-available
    # A download that doesn't match its hash
    run update-check
    export FAKE_LUNA_FAIL=1
    run update-install
    check "failure noticed" upd_wait failed
    check "with the reason" grep -q "Invalid file checksum" "$SD_ROOT/tmp/ssh-doctor/update/state.json"
    release_stop
    # Nothing newer: nothing to install
    release_start "$(sed -n 's/^VERSION="\(.*\)"$/\1/p' "$ROOT/ssh-doctor.sh")"
    run update-check
    check "same version: not newer" has '"newer":false'
    run update-install
    check "install refused" is "$RC" 1
    release_stop
    run changes 0.4.0
    check "what changed in a version" has "Fix SSH at startup"
}

test_main_address() {
    mkdir -p "$T/bin"; cp "$HERE/fakebin/ip" "$T/bin/ip"
    # Wired eth0 is the main connection, Wi-Fi a backup with a higher metric
    # shellcheck disable=SC2086
    _ip_json() { env -u SD_IPS PATH="$T/bin:$PATH" FAKE_ROUTES="$1" FAKE_ADDRS="$2" $SH "$ROOT/ssh-doctor.sh" status --json > "$T/s.json" 2>&1; }
    _ip_json 'default via 192.168.50.1 dev wlan0 metric 600\ndefault via 192.168.50.1 dev eth0 metric 100' \
        '1: lo    inet 127.0.0.1/8 scope host lo\n3: wlan0    inet 192.168.50.97/24 scope global wlan0\n4: eth0    inet 192.168.50.96/24 scope global eth0'
    check "eth0 first" is "$(field ips)" '["192.168.50.96", "192.168.50.97"]'
    _ip_json 'default via 192.168.50.1 dev wlan0' \
        '3: eth0    inet 10.0.0.5/24 scope global eth0\n4: wlan0    inet 192.168.50.97/24 scope global wlan0'
    check "Wi-Fi first when it has the route" is "$(field ips)" '["192.168.50.97", "10.0.0.5"]'
    # Seen on a real TV: the adapter got no DHCP answer, so eth0 has a 169.254
    # address and a default route with no gateway
    _ip_json 'default dev eth0 scope link' \
        '3: wlan0    inet 192.168.50.97/24 scope global wlan0\n8: eth0    inet 169.254.240.141/16 scope global eth0'
    check "no link-local address, Wi-Fi it is" is "$(field ips)" '["192.168.50.97"]'
}

for c in update main_address pairing_info sessions_kept boot_fix kit exposure entware_openssh_in_use entware_openssh_root_password entware_openssh_broken entware_port_clash entware_dropbear \
    healthy ssh_off_then_on flag_but_not_running running_but_off_next_boot locked_out_then_password \
    no_keys_no_password messy_key_file loose_home add_key restore legacy_dropbear host_fingerprints \
    failsafe_and_telnet pairing pairing_wrong_codes pairing_screen_closed servers port_taken port_change \
    password keys_only keepalive_and_reset settings_not_applied_and_boot logins host_keys telnet key_edit report; do
    t "$c" "test_$c"
done

echo
echo "$SHELL_NAME: $pass passed, $fail failed${failed:+ ($failed )}"
[ $fail = 0 ]
