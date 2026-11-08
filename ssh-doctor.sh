#!/bin/sh
# LG webOS SSH Doctor: check and repair SSH on rooted LG webOS TVs.
#
# Runs as root under busybox sh, from the TV app (through the Homebrew
# Channel's exec service) or over telnet.  It only touches the Homebrew
# Channel's SSH switch, /home/root/.ssh and, to turn the alpine password back
# on, the same bind-mounted /etc/shadow the Homebrew Channel uses at boot.
# Every file it changes is backed up first.
#
# Usage: sh ssh-doctor.sh COMMAND [--json]
#   status [--json]   what decides whether SSH login works, and what's wrong
#   ssh-on            turn SSH on in the Homebrew Channel and start it now
#   fix-keys          repair /home/root/.ssh/authorized_keys and permissions
#   password-on       set authorized_keys aside and turn the alpine password on
#   add-key FILE      add the public key in FILE (one line, OpenSSH format)
#   keys [--json]     the keys that can log in, with fingerprints
#   backups [--json]  the backups this script made
#   restore NAME      put a backup of authorized_keys back
#   pair-start | pair-status | pair-accept | pair-reject | pair-stop
#                     the pairing page, for adding a key from a PC or phone
#   version
#
# Paths can be moved under SD_ROOT for the tests.

VERSION="0.1.0"
R="${SD_ROOT:-}"
HERE=$(cd "$(dirname "$0")" && pwd)

PREFS="$R/var/luna/preferences"
SSHD_FLAG="$PREFS/webosbrew_sshd_enabled"
TELNET_OFF="$PREFS/webosbrew_telnet_disabled"
FAILSAFE="$PREFS/webosbrew_failsafe"
HBC_SVC="$R/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service"
DROPBEAR="$HBC_SVC/bin/dropbear"
HOSTKEYS="$R/var/lib/webosbrew/sshd"
HOME_ROOT="$R/home/root"
SSH_DIR="$HOME_ROOT/.ssh"
AK="$SSH_DIR/authorized_keys"
SHADOW="$R/etc/shadow"
PASSWD="$R/etc/passwd"
PROC="$R/proc"
RUN="$R/tmp/ssh-doctor"
PAIR="$RUN/pair"
NODE="${SD_NODE:-}"
# The Homebrew Channel's placeholder password, crypt("alpine")
ALPINE_HASH='xGVw8H4GqkKg6'
PAIR_PORT="${SD_PAIR_PORT:-28622}"
# Who should own .ssh and the key file (root; the tests can't chown)
OWNER="${SD_OWNER:-0}"

say() { printf '%s\n' "$*"; }
die() { say "$*" >&2; exit 1; }

# JSON string, with the characters JSON needs escaped
js() {
    printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\000-\010\013-\037' | tr '\t\n' '  ')"
}

stamp() { date +%Y%m%d-%H%M%S; }

find_node() {
    [ -n "$NODE" ] && { say "$NODE"; return; }
    for n in /usr/bin/node /usr/local/bin/node; do
        [ -x "$R$n" ] && { say "$R$n"; return; }
    done
    command -v node 2>/dev/null
}

# ------------------------------------------------------------------ checks

# Is a dropbear process running?  Reads /proc, no ps needed
dropbear_running() {
    for c in "$PROC"/[0-9]*/comm; do
        [ -f "$c" ] || continue
        [ "$(cat "$c" 2>/dev/null)" = dropbear ] && return 0
    done
    return 1
}

# Is anything listening on TCP port $1?  (state 0A = LISTEN)
listening() {
    _hex=$(printf ':%04X' "$1")
    cat "$PROC/net/tcp" "$PROC/net/tcp6" 2>/dev/null | awk -v p="$_hex" '
        { n = split($2, a, ":"); if (":" a[n] == p && $4 == "0A") f = 1 }
        END { exit f ? 0 : 1 }'
}

dropbear_version() {
    [ -x "$DROPBEAR" ] || return 0
    "$DROPBEAR" -V 2>&1 | sed -n 's/.*Dropbear v\{0,1\}\([0-9][0-9.]*\).*/\1/p' | head -n 1
}

# root's password: alpine (the Homebrew Channel's placeholder), set, or none
password_state() {
    _h=$(awk -F: '$1 == "root" { print $2; exit }' "$SHADOW" 2>/dev/null)
    case "$_h" in
        "$ALPINE_HASH") say alpine ;;
        ''|'*'|'!'|'!!'|x|'*'*|'!'*) say none ;;
        *) say set ;;
    esac
}

telnet_running() {
    for c in "$PROC"/[0-9]*/comm; do
        [ -f "$c" ] || continue
        [ "$(cat "$c" 2>/dev/null)" = telnetd ] && return 0
    done
    return 1
}

perm_of() { stat -c %a "$1" 2>/dev/null; }
owner_of() { stat -c %u "$1" 2>/dev/null; }

# Group- or world-writable?  dropbear refuses keys behind such a path
loose() {
    _lp=$(perm_of "$1")
    [ -n "$_lp" ] || return 1
    _g=$(printf '%s' "$_lp" | tail -c 2 | head -c 1)
    _o=$(printf '%s' "$_lp" | tail -c 1)
    case "$_g$_o" in *[2367]*) return 0 ;; esac
    return 1
}

ips() {
    if [ -n "${SD_IPS:-}" ]; then say "$SD_IPS"; return; fi
    ip -4 -o addr show 2>/dev/null | awk '$2 != "lo" { sub(/\/.*/, "", $4); print $4 }' | tr '\n' ' '
}

# The key file, cleaned up: prints good key lines on fd 1, and writes what it
# set aside to $2 and a list of what it found to $3.  $1 is the input file.
# Handles Windows line endings, a UTF-8 BOM, keys wrapped over several lines,
# PuTTYgen's "SSH2 PUBLIC KEY" export, and private keys pasted by mistake.
clean_keys() {
    _in=$1; _rej=$2; _found=$3
    : > "$_rej"; : > "$_found"
    _tmp="$RUN/clean.$$"
    mkdir -p "$RUN"
    # BOM and carriage returns
    if [ "$(head -c 3 "$_in" | od -An -tx1 | tr -d ' \n')" = efbbbf ]; then
        say bom >> "$_found"
        tail -c +4 "$_in" > "$_tmp.a"
    else
        cat "$_in" > "$_tmp.a"
    fi
    if grep -q "$(printf '\r')" "$_tmp.a"; then say crlf >> "$_found"; fi
    tr -d '\r' < "$_tmp.a" > "$_tmp.b"
    awk -v REJ="$_rej" -v FOUND="$_found" '
    function ktype(b) {
        if (b ~ /^AAAAC3NzaC1lZDI1NTE5/) return "ssh-ed25519"
        if (b ~ /^AAAAB3NzaC1yc2E/) return "ssh-rsa"
        if (b ~ /^AAAAE2VjZHNhLXNoYTItbmlzdHAyNTY/) return "ecdsa-sha2-nistp256"
        if (b ~ /^AAAAE2VjZHNhLXNoYTItbmlzdHAzODQ/) return "ecdsa-sha2-nistp384"
        if (b ~ /^AAAAE2VjZHNhLXNoYTItbmlzdHA1MjE/) return "ecdsa-sha2-nistp521"
        if (b ~ /^AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29t/) return "sk-ssh-ed25519@openssh.com"
        if (b ~ /^AAAAInNrLWVjZHNhLXNoYTItbmlzdHAyNTZAb3BlbnNzaC5jb20/) return "sk-ecdsa-sha2-nistp256@openssh.com"
        return ""
    }
    function istype(w) {
        return w == "ssh-ed25519" || w == "ssh-rsa" || w ~ /^ecdsa-sha2-nistp(256|384|521)$/ || w ~ /^sk-(ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com$/
    }
    function note(w) { if (!(w in noted)) { noted[w] = 1; print w >> FOUND } }
    function reject(l) { print l >> REJ }
    # A key line is good if its type matches the type inside its base64 blob
    # and the blob is long enough to be whole
    function flush(   n, f, i, t, b, ok) {
        if (cur == "") return
        n = split(cur, f, " ")
        ok = 0
        for (i = 1; i <= n; i++) if (istype(f[i])) { t = f[i]; b = f[i + 1]; break }
        if (t != "" && b ~ /^[A-Za-z0-9+\/]+=*$/ && ktype(b) == t) {
            if (t == "ssh-ed25519" && length(b) == 68) ok = 1
            else if (t == "ssh-rsa" && length(b) >= 200) ok = 1
            else if (t ~ /^ecdsa/ && length(b) >= 100) ok = 1
            else if (t ~ /^sk-/ && length(b) >= 80) ok = 1
        }
        if (ok) { print cur; good++; if (wrapped) note("wrapped") }
        else { reject(cur); note(t == "" ? "bad" : "broken") }
        cur = ""; wrapped = 0
    }
    BEGIN { cur = ""; good = 0; inpriv = 0; inrfc = 0 }
    {
        line = $0
        sub(/^[ \t]+/, "", line); sub(/[ \t]+$/, "", line)
        if (inpriv) { reject($0); if (line ~ /^-----END .*PRIVATE KEY-----$/) inpriv = 0; next }
        if (line ~ /^-----BEGIN .*PRIVATE KEY-----$/ || line ~ /^PuTTY-User-Key-File/) {
            flush(); note("private"); reject($0); inpriv = 1; next
        }
        if (inrfc) {
            if (line ~ /^---- END SSH2 PUBLIC KEY ----$/) {
                t = ktype(rfcb)
                if (t != "") { cur = t " " rfcb (rfcc != "" ? " " rfcc : ""); flush(); note("putty") }
                else { reject("(a broken SSH2 PUBLIC KEY block)"); note("broken") }
                inrfc = 0; next
            }
            if (line ~ /^Comment: */) { c = line; sub(/^Comment: */, "", c); gsub(/"/, "", c); rfcc = c; next }
            if (line ~ /^[A-Za-z-]+: /) next
            gsub(/[ \t]/, "", line); rfcb = rfcb line; next
        }
        if (line ~ /^---- BEGIN SSH2 PUBLIC KEY ----$/) { flush(); inrfc = 1; rfcb = ""; rfcc = ""; next }
        if (line == "") next
        if (line ~ /^#/) { flush(); print line; next }
        n = split(line, f, " ")
        hastype = 0
        for (i = 1; i <= n; i++) if (istype(f[i])) { hastype = 1; break }
        if (hastype) { flush(); cur = line; next }
        # More base64 for the key above it, if that key has no comment yet
        if (cur != "" && line ~ /^[A-Za-z0-9+\/=]+$/) {
            m = split(cur, g, " ")
            if (istype(g[m - 1]) || m == 2) { cur = cur line; wrapped = 1; next }
        }
        # The comment of a wrapped key, on a line of its own
        if (cur != "" && wrapped && line !~ /^[A-Za-z0-9+\/=]+$/) { cur = cur " " line; flush(); next }
        flush(); reject($0); note("bad")
    }
    END { flush(); if (!good) note("nokeys") }
    ' "$_tmp.b"
    rm -f "$_tmp.a" "$_tmp.b"
}

# What's wrong with the key file, as a space-separated list (empty: nothing)
key_problems() {
    [ -f "$AK" ] || { say missing; return; }
    clean_keys "$AK" "$RUN/rej.$$" "$RUN/found.$$" > "$RUN/good.$$"
    tr '\n' ' ' < "$RUN/found.$$"
    rm -f "$RUN/rej.$$" "$RUN/found.$$" "$RUN/good.$$"
}

key_count() {
    [ -f "$AK" ] || { say 0; return; }
    clean_keys "$AK" "$RUN/rej.$$" "$RUN/found.$$" > "$RUN/good.$$"
    grep -c -v '^#' "$RUN/good.$$"
    rm -f "$RUN/rej.$$" "$RUN/found.$$" "$RUN/good.$$"
}

perm_problems() {
    _p=''
    loose "$HOME_ROOT" && _p="$_p home"
    if [ -d "$SSH_DIR" ]; then
        loose "$SSH_DIR" && _p="$_p dir"
        [ "$(owner_of "$SSH_DIR")" = "$OWNER" ] || _p="$_p dirowner"
    fi
    if [ -f "$AK" ]; then
        loose "$AK" && _p="$_p file"
        [ "$(owner_of "$AK")" = "$OWNER" ] || _p="$_p fileowner"
    fi
    say "${_p# }"
}

# Fingerprints of the TV's host keys, "type SHA256:..." per line (needs node)
host_fingerprints() {
    _n=$(find_node)
    [ -n "$_n" ] && [ -d "$HOSTKEYS" ] || return 0
    "$_n" "$HERE/keyinfo.js" host "$HOSTKEYS" 2>/dev/null
}

# ------------------------------------------------------------------ status

# Each finding is "code level" (level: problem, tip); the app words them
collect() {
    FIND=''
    add() { FIND="$FIND$1 $2
"; }
    _flag=no; [ -f "$SSHD_FLAG" ] && _flag=yes
    _run=no; dropbear_running && _run=yes
    _listen=no; listening 22 && _listen=yes
    _pw=$(password_state)
    _kp=$(key_problems | sed 's/ *$//')
    _kc=$(key_count)
    _pp=$(perm_problems)
    _tel=yes; [ -f "$TELNET_OFF" ] && _tel=no
    _telrun=no; telnet_running && _telrun=yes

    [ -d "$HBC_SVC" ] || add hbc-missing problem
    [ -f "$FAILSAFE" ] && add failsafe problem
    if [ "$_flag" = no ] && [ "$_listen" = no ]; then add ssh-off problem
    elif [ "$_flag" = yes ] && [ "$_listen" = no ]; then add ssh-not-running problem
    elif [ "$_flag" = no ] && [ "$_listen" = yes ]; then add ssh-off-next-boot tip
    fi
    # Locked out: keys only, and none of them usable
    if [ "$_pw" != alpine ] && [ "$_pw" != set ] && [ "$_kc" = 0 ]; then
        if [ -f "$AK" ]; then add no-way-in problem; else add no-password problem; fi
    fi
    case " $_kp " in *" private "*) add keys-private problem ;; esac
    case " $_kp " in *" crlf "*|*" bom "*|*" wrapped "*|*" putty "*) add keys-fixable problem ;; esac
    case " $_kp " in *" bad "*|*" broken "*) add keys-bad problem ;; esac
    [ -n "$_pp" ] && add perms problem
    [ "$_pw" = alpine ] && add password-default tip
    [ "$_tel" = no ] && add telnet-off tip
}

status_json() {
    collect
    _ver=$(dropbear_version)
    printf '{"version":%s,' "$(js "$VERSION")"
    printf '"hbc":%s,' "$([ -d "$HBC_SVC" ] && echo true || echo false)"
    printf '"sshEnabled":%s,"running":%s,"listening":%s,' \
        "$([ "$_flag" = yes ] && echo true || echo false)" \
        "$([ "$_run" = yes ] && echo true || echo false)" \
        "$([ "$_listen" = yes ] && echo true || echo false)"
    printf '"dropbear":%s,"password":%s,"keys":%s,' "$(js "$_ver")" "$(js "$_pw")" "${_kc:-0}"
    printf '"keyFile":%s,' "$([ -f "$AK" ] && echo true || echo false)"
    printf '"keyProblems":%s,"permProblems":%s,' "$(js "$_kp")" "$(js "$_pp")"
    printf '"telnet":%s,"telnetRunning":%s,' \
        "$([ "$_tel" = yes ] && echo true || echo false)" \
        "$([ "$_telrun" = yes ] && echo true || echo false)"
    printf '"failsafe":%s,' "$([ -f "$FAILSAFE" ] && echo true || echo false)"
    printf '"legacyRsa":%s,' "$(legacy_rsa "$_ver" && echo true || echo false)"
    printf '"ips":['
    _f=1
    for i in $(ips); do [ $_f = 1 ] || printf ','; _f=0; printf '%s' "$(js "$i")"; done
    printf '],"hostKeys":['
    _f=1
    host_fingerprints | while read -r t fp; do
        [ $_f = 1 ] || printf ','; _f=0
        printf '{"type":%s,"fp":%s}' "$(js "$t")" "$(js "$fp")"
    done
    printf '],"findings":['
    _f=1
    printf '%s' "$FIND" | while read -r code level; do
        [ -n "$code" ] || continue
        [ $_f = 1 ] || printf ','; _f=0
        printf '{"code":%s,"level":%s}' "$(js "$code")" "$(js "$level")"
    done
    printf ']}\n'
}

# Dropbear before 2020.79 only offers ssh-rsa with SHA-1, which OpenSSH 8.8
# and later turn off by default
legacy_rsa() {
    [ -n "$1" ] || return 1
    _y=${1%%.*}
    [ "$_y" -lt 2020 ] 2>/dev/null && return 0
    [ "$_y" = 2020 ] && [ "${1#*.}" -lt 79 ] 2>/dev/null && return 0
    return 1
}

status_text() {
    collect
    say "LG webOS SSH Doctor $VERSION"
    say "SSH switch in the Homebrew Channel: $_flag"
    say "SSH server running: $_run, listening on port 22: $_listen"
    say "Password login: $_pw"
    say "Usable keys in $AK: ${_kc:-0}${_kp:+ (found: $_kp)}"
    [ -n "$_pp" ] && say "Permissions to fix: $_pp"
    say "Telnet: $_tel"
    say "IP addresses: $(ips)"
    if [ -n "$FIND" ]; then
        say "Findings:"
        printf '%s' "$FIND" | sed 's/^/  /'
    else
        say "No problems found."
    fi
}

# ------------------------------------------------------------------ repairs

backup() {
    [ -f "$1" ] || return 0
    _b="$1.ssh-doctor-$(stamp)"
    _i=2
    while [ -e "$_b" ]; do _b="$1.ssh-doctor-$(stamp)-$_i"; _i=$((_i + 1)); done
    cp -p "$1" "$_b" && say "Backed up $1 to $_b"
}

fix_perms() {
    if loose "$HOME_ROOT"; then chmod go-w "$HOME_ROOT" && say "Made $HOME_ROOT writable by root only"; fi
    if [ -d "$SSH_DIR" ]; then
        chown 0:0 "$SSH_DIR" 2>/dev/null
        chmod 700 "$SSH_DIR"
    fi
    if [ -f "$AK" ]; then
        chown 0:0 "$AK" 2>/dev/null
        chmod 600 "$AK"
    fi
}

ssh_on() {
    [ -d "$HBC_SVC" ] || die "The Homebrew Channel isn't installed, so there's no SSH server to start."
    mkdir -p "$PREFS"
    if [ ! -f "$SSHD_FLAG" ]; then
        : > "$SSHD_FLAG" && say "Turned SSH on in the Homebrew Channel's settings."
    fi
    if listening 22; then say "The SSH server is already running."; return 0; fi
    [ -x "$DROPBEAR" ] || die "The Homebrew Channel's SSH server ($DROPBEAR) is missing.  Reinstall the Homebrew Channel."
    # Started the same way the Homebrew Channel's startup script does
    mkdir -p "$HOSTKEYS"
    "$DROPBEAR" -R
    _i=0
    while [ $_i -lt 10 ]; do
        listening 22 && { say "Started the SSH server on port 22."; return 0; }
        sleep 1; _i=$((_i + 1))
    done
    die "The SSH server didn't start.  Restart the TV, then check again."
}

fix_keys() {
    mkdir -p "$RUN"
    if [ ! -f "$AK" ]; then fix_perms; say "There's no authorized_keys file to fix."; return 0; fi
    clean_keys "$AK" "$RUN/rej" "$RUN/found" > "$RUN/good"
    _found=$(tr '\n' ' ' < "$RUN/found")
    if [ -s "$RUN/rej" ] || ! cmp -s "$RUN/good" "$AK"; then
        backup "$AK"
        if [ -s "$RUN/rej" ]; then
            _rj="$SSH_DIR/authorized_keys.rejected-$(stamp)"
            cp "$RUN/rej" "$_rj" && chmod 600 "$_rj"
            say "Moved what isn't a public key to $_rj"
        fi
        cat "$RUN/good" > "$AK"
        say "Rewrote $AK (found: ${_found:-nothing wrong})"
    fi
    fix_perms
    _n=$(grep -c -v '^#' "$AK")
    say "Usable keys now: $_n"
    if [ "$_n" = 0 ] && [ "$(password_state)" != alpine ] && [ "$(password_state)" != set ]; then
        say "No key works and there's no password: use Go back to password login, or add a key."
    fi
    rm -f "$RUN/rej" "$RUN/found" "$RUN/good"
}

# Like the Homebrew Channel's startup script: root's password becomes alpine
# through a bind mount, so /etc stays untouched
password_on() {
    if [ -f "$AK" ]; then
        _off="$AK.ssh-doctor-off-$(stamp)"
        mv "$AK" "$_off" && say "Set the keys file aside as $_off"
    fi
    if [ "$(password_state)" = alpine ]; then say "Password login is on: user root, password alpine."; return 0; fi
    mkdir -p "$RUN"
    sed -r 's/^root:[^:]*:/root:'"$ALPINE_HASH"':/' "$SHADOW" > "$RUN/shadow"
    chmod 400 "$RUN/shadow"
    if [ -n "${SD_NOMOUNT:-}" ]; then
        cat "$RUN/shadow" > "$SHADOW"
    else
        grep -q ' /etc/shadow ' /proc/mounts 2>/dev/null && umount /etc/shadow 2>/dev/null
        mount --bind "$RUN/shadow" "$SHADOW" || die "Couldn't turn the password on."
    fi
    if grep -q '^root:\*:' "$PASSWD" 2>/dev/null; then
        sed 's/^root:\*:/root:x:/' "$PASSWD" > "$RUN/passwd"
        chmod 444 "$RUN/passwd"
        if [ -n "${SD_NOMOUNT:-}" ]; then cat "$RUN/passwd" > "$PASSWD"; else mount --bind "$RUN/passwd" "$PASSWD"; fi
    fi
    say "Password login is on: user root, password alpine.  It stays on after a restart until a key is added."
}

# One public key line, checked like fix-keys does, then appended
add_key() {
    [ -f "$1" ] || die "No key file $1"
    mkdir -p "$RUN" "$SSH_DIR"
    clean_keys "$1" "$RUN/rej" "$RUN/found" | grep -v '^#' > "$RUN/new"
    _n=$(wc -l < "$RUN/new" | tr -d ' ')
    [ "$_n" = 1 ] || { rm -f "$RUN/new"; die "That isn't exactly one public key."; }
    _blob=$(awk '{ for (i = 1; i <= NF; i++) if ($i ~ /^AAAA/) { print $i; exit } }' "$RUN/new")
    if [ -f "$AK" ] && grep -q -F "$_blob" "$AK"; then
        rm -f "$RUN/new"; say "That key is already there."; return 0
    fi
    _first=yes
    [ -f "$AK" ] && [ "$(key_count)" != 0 ] && _first=no
    backup "$AK"
    if [ -s "$AK" ] && [ -n "$(tail -c 1 "$AK")" ]; then echo >> "$AK"; fi
    cat "$RUN/new" >> "$AK"
    rm -f "$RUN/new" "$RUN/rej" "$RUN/found"
    fix_perms
    say "Added the key."
    if [ "$_first" = yes ] && [ "$(password_state)" = alpine ]; then
        say "This is the first key, so after the next restart the alpine password stops working and only keys can log in."
    fi
}

keys_list() {
    [ -f "$AK" ] || { [ "$1" = --json ] && say '[]'; return 0; }
    _n=$(find_node)
    clean_keys "$AK" "$RUN/rej" "$RUN/found" | grep -v '^#' > "$RUN/list"
    rm -f "$RUN/rej" "$RUN/found"
    if [ -n "$_n" ]; then
        "$_n" "$HERE/keyinfo.js" list "$RUN/list" ${1:+"$1"}
    elif [ "$1" = --json ]; then
        printf '['; _f=1
        while read -r l; do
            [ $_f = 1 ] || printf ','; _f=0
            printf '{"line":%s}' "$(js "$l")"
        done < "$RUN/list"
        printf ']\n'
    else
        cat "$RUN/list"
    fi
    rm -f "$RUN/list"
}

backups() {
    for f in "$SSH_DIR"/authorized_keys.ssh-doctor-*; do
        [ -f "$f" ] && say "${f##*/}"
    done
    return 0
}

restore() {
    case "$1" in authorized_keys.ssh-doctor-*) ;; *) die "Not one of this script's backups: $1" ;; esac
    case "$1" in */*) die "Just the file name, please." ;; esac
    [ -f "$SSH_DIR/$1" ] || die "No backup called $1"
    backup "$AK"
    cp "$SSH_DIR/$1" "$AK"
    fix_perms
    say "Put $1 back as authorized_keys."
}

# ------------------------------------------------------------------ pairing
#
# pair-server.js runs the page a PC or phone opens to send a public key.  It
# keeps its state in $PAIR/state.json; the app polls pair-status (which also
# tells the server the screen is still open), and the person confirms the key
# on the TV with pair-accept.  The server stops itself after 5 minutes, after
# one key, or 30 seconds after the screen stops asking.

pair_pid() { cat "$PAIR/pid" 2>/dev/null; }
pair_alive() { _p=$(pair_pid); [ -n "$_p" ] && kill -0 "$_p" 2>/dev/null; }

pair_stop() {
    if pair_alive; then
        : > "$PAIR/stop"
        kill "$(pair_pid)" 2>/dev/null
    fi
    rm -rf "$PAIR"
    say '{"state":"stopped"}'
}

pair_start() {
    _n=$(find_node)
    [ -n "$_n" ] || die '{"error":"no-node"}'
    pair_stop > /dev/null
    mkdir -p "$PAIR"
    chmod 700 "$PAIR"
    : > "$PAIR/alive"
    if command -v setsid >/dev/null 2>&1; then
        setsid "$_n" "$HERE/pair-server.js" "$PAIR" "$PAIR_PORT" "$(ips)" < /dev/null > "$PAIR/log" 2>&1 &
    else
        "$_n" "$HERE/pair-server.js" "$PAIR" "$PAIR_PORT" "$(ips)" < /dev/null > "$PAIR/log" 2>&1 &
    fi
    say $! > "$PAIR/pid"
    _i=0
    while [ $_i -lt 50 ]; do
        [ -s "$PAIR/state.json" ] && { cat "$PAIR/state.json"; echo; return 0; }
        pair_alive || break
        sleep 0.2 2>/dev/null || sleep 1
        _i=$((_i + 1))
    done
    printf '{"error":"no-start","log":%s}\n' "$(js "$(tail -n 5 "$PAIR/log" 2>/dev/null)")"
    rm -rf "$PAIR"
    return 1
}

pair_status() {
    [ -d "$PAIR" ] || { say '{"state":"stopped"}'; return 0; }
    : > "$PAIR/alive"
    if ! pair_alive; then
        _s=$(cat "$PAIR/state.json" 2>/dev/null)
        case "$_s" in *'"accepted"'*|*'"rejected"'*|*'"expired"'*) say "$_s" ;; *) say '{"state":"stopped"}' ;; esac
        return 0
    fi
    cat "$PAIR/state.json"; echo
}

pair_accept() {
    grep -q '"state":"pending"' "$PAIR/state.json" 2>/dev/null || die '{"error":"nothing-pending"}'
    if add_key "$PAIR/pending.pub" > "$PAIR/added" 2>&1; then
        say accepted > "$PAIR/decision"
        cat "$PAIR/added"
    else
        say failed > "$PAIR/decision"
        cat "$PAIR/added" >&2
        return 1
    fi
}

pair_reject() {
    [ -d "$PAIR" ] && say rejected > "$PAIR/decision"
    say '{"state":"rejected"}'
}

# ------------------------------------------------------------------ main

CMD=${1:-status}
[ $# -gt 0 ] && shift
mkdir -p "$RUN" 2>/dev/null
case "$CMD" in
    status) if [ "${1:-}" = --json ]; then status_json; else status_text; fi ;;
    ssh-on) ssh_on ;;
    fix-keys) fix_keys ;;
    password-on) password_on ;;
    add-key) add_key "${1:-}" ;;
    keys) keys_list "${1:-}" ;;
    backups) backups ;;
    restore) restore "${1:-}" ;;
    pair-start) pair_start ;;
    pair-status) pair_status ;;
    pair-accept) pair_accept ;;
    pair-reject) pair_reject ;;
    pair-stop) pair_stop ;;
    version) say "$VERSION" ;;
    -h|--help|help) sed -n '2,24s/^# \{0,1\}//p' "$0" ;;
    *) die "Unknown command: $CMD (try: sh $0 help)" ;;
esac
