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
    cp "$HERE/fakebin/dropbear" "$SD_ROOT/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/bin/dropbear"
    chmod 755 "$SD_ROOT/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/bin/dropbear"
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
sshd_up() {
    mkdir -p "$SD_ROOT/proc/4242"; echo dropbear > "$SD_ROOT/proc/4242/comm"
    echo '   0: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0' >> "$SD_ROOT/proc/net/tcp"
}
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

for c in healthy ssh_off_then_on flag_but_not_running running_but_off_next_boot locked_out_then_password \
    no_keys_no_password messy_key_file loose_home add_key restore legacy_dropbear host_fingerprints \
    failsafe_and_telnet pairing pairing_wrong_codes pairing_screen_closed; do
    t "$c" "test_$c"
done

echo
echo "$SHELL_NAME: $pass passed, $fail failed${failed:+ ($failed )}"
[ $fail = 0 ]
