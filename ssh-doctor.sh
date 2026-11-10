#!/bin/sh
# LG webOS SSH Doctor: check and repair SSH on rooted LG webOS TVs.
#
# Runs as root under busybox sh, from the TV app (through the Homebrew
# Channel's exec service) or over telnet.  It only touches the Homebrew
# Channel's SSH and telnet switches, /home/root/.ssh, the Homebrew Channel's
# dropbear (restarted with your settings), its host keys (backed up first),
# and root's password through the same bind-mounted /etc/shadow the Homebrew
# Channel uses at boot.  Settings live in /var/lib/webosbrew/ssh-doctor and a
# startup hook in /var/lib/webosbrew/init.d puts them back after a restart.
# Every file it changes is backed up first.  Entware's OpenSSH and dropbear
# are checked (sshd -T only reads), never changed, started or stopped.
#
# Usage: sh ssh-doctor.sh COMMAND [ARGS]
#   status [--json]   what decides whether SSH login works, and what's wrong
#   ssh-on            turn SSH on in the Homebrew Channel and start it now
#   fix-keys          repair /home/root/.ssh/authorized_keys and permissions
#   password-on       set authorized_keys aside and turn the alpine password on
#   add-key FILE      add the public key in FILE (one line, OpenSSH format)
#   keys [--json]     the keys that can log in, with fingerprints
#   backups [--json]  the backups this script made
#   restore NAME      put a backup of authorized_keys back
#   key-remove FP | key-rename FP NAME
#                     take one key out, or change its name (by fingerprint)
#   servers [--json]  every SSH server running on the TV, and its ports
#   entware [--json]  Entware's OpenSSH and dropbear: checked, never changed
#   settings [--json] the SSH settings this script manages
#   set-password HASH root's own password, as a SHA-512 crypt hash ($6$...)
#   clear-password    back to the Homebrew Channel's password handling
#   set-keys-only on|off, set-keepalive on|off
#   set-port PORT     move SSH to PORT; the old port stays open until
#   port-keep | port-revert   you keep the new one, or go back
#   reset-settings    remove every setting and go back to the defaults
#   apply             restart SSH with the saved settings
#   logins [--json]   recent SSH logins and failed tries, from the TV's log
#   hostkeys [--json] | hostkeys-reset   the TV's own SSH keys
#   telnet-off | telnet-on
#   set-bootfix on|off  check SSH at every start, and start it if it's down
#   kit-save [DIR] | kit-list [--json] | kit-restore NAME
#                     save keys, the TV's SSH keys and settings to a USB
#                     drive, and put them back after a reset or re-root
#   exposure [--json] | exposure-close
#                     does the router forward SSH or telnet to the internet
#                     (UPnP)?  exposure-close takes those forwards off
#   report            a short report for asking for help, private bits left out
#   pair-start [key|password] | pair-status | pair-accept | pair-reject |
#   pair-stop         the pairing page, for a key or password from a PC or phone
#   version
#
# Paths can be moved under SD_ROOT for the tests.

VERSION="0.3.0"
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
TELNETD="$HBC_SVC/bin/telnetd"
SFTP_SERVER="$HBC_SVC/bin/sftp-server"
# This script's settings, and the startup hook that puts them back after a
# restart (the Homebrew Channel runs init.d with run-parts after starting SSH)
SDDIR="$R/var/lib/webosbrew/ssh-doctor"
CONF="$SDDIR/settings"
PWHASH="$SDDIR/root.hash"
HOOK="$R/var/lib/webosbrew/init.d/60-ssh-doctor"
# Developer Mode's SSH: its own server, user prisoner, port 9922
DEVMODE_PORT=9922
# What the startup hook found at the last start: "TIME RESULT..."
BOOTLAST="$SDDIR/boot.last"
# USB drives (/tmp/usb/sda/sda1), and the folder the survival kit goes in
USBROOT="$R/tmp/usb"
KITNAME=ssh-doctor-kit
# The router's port forwards from the last exposure check (upnp.js)
EXPOSURE="$RUN/exposure.json"
# Entware's own SSH servers: checked, never changed or restarted.  Entware's
# programs read /opt/etc for their settings and its passwd and shadow, so its
# root password isn't the one in /etc/shadow.
OPT="$R/opt"
ENT_SSHD="$OPT/sbin/sshd"
ENT_SSHD_CONF="$OPT/etc/ssh/sshd_config"
ENT_SSH_DIR="$OPT/etc/ssh"
ENT_DROPBEAR="$OPT/sbin/dropbear"
ENT_DB_DIR="$OPT/etc/dropbear"
ENT_INITD="$OPT/etc/init.d"
ENT_SHADOW="$OPT/etc/shadow"
# Where Entware gets started at boot (rc.unslung, from an init.d script or
# the Homebrew Channel's startup.sh)
INITD="$R/var/lib/webosbrew/init.d"
STARTUP="$R/var/lib/webosbrew/startup.sh"
# webOS's system log, where dropbear writes logins and failed tries
LOGDIR="${SD_LOGDIR:-$R/tmp/var/log}"
# Seconds between keepalives when that setting is on
KEEPALIVE_SECS=30
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

# One grep over every process's name: a loop with cat per process takes
# seconds on a busy TV
procs_named() { grep -l -x -E "$1" "$PROC"/[0-9]*/comm 2>/dev/null; }

# Is anything listening on TCP port $1?  (state 0A = LISTEN)
listening() {
    _hex=$(printf ':%04X' "$1")
    cat "$PROC/net/tcp" "$PROC/net/tcp6" 2>/dev/null | awk -v p="$_hex" '
        { n = split($2, a, ":"); if (":" a[n] == p && $4 == "0A") f = 1 }
        END { exit f ? 0 : 1 }'
}

# Open connections (ESTABLISHED, 01) to local TCP port $1
sessions_on() {
    _hex=$(printf ':%04X' "$1")
    cat "$PROC/net/tcp" "$PROC/net/tcp6" 2>/dev/null | awk -v p="$_hex" '
        { n = split($2, a, ":"); if (":" a[n] == p && $4 == "01") c++ }
        END { print c + 0 }'
}

dropbear_version() {
    [ -x "$DROPBEAR" ] || return 0
    "$DROPBEAR" -V 2>&1 | sed -n 's/.*Dropbear v\{0,1\}\([0-9][0-9.]*\).*/\1/p' | awk 'NR == 1'
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

telnet_running() { [ -n "$(procs_named telnetd)" ]; }

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

# ------------------------------------------------------------------ settings

conf_get() {
    _cv=$(sed -n "s/^$1=//p" "$CONF" 2>/dev/null | tail -n 1)
    say "${_cv:-$2}"
}
# conf_set KEY VALUE (an empty VALUE removes the setting)
conf_set() {
    mkdir -p "$SDDIR" && chmod 700 "$SDDIR"
    { grep -v "^$1=" "$CONF" 2>/dev/null; [ -n "$2" ] && say "$1=$2"; } > "$CONF.tmp"
    mv "$CONF.tmp" "$CONF"
}
ssh_port() { conf_get PORT 22; }
trial_port() { conf_get TRIAL ''; }
# The ports SSH should listen on: the port, and the old one during a change
ssh_ports() { _tp=$(trial_port); say "$(ssh_port)${_tp:+ $_tp}"; }
keys_only() { [ "$(conf_get KEYSONLY 0)" = 1 ]; }
keepalive() { [ "$(conf_get KEEPALIVE 0)" = 1 ]; }
boot_fix() { [ "$(conf_get BOOTFIX 0)" = 1 ]; }
# Anything set that the Homebrew Channel wouldn't do by itself?
customized() {
    [ -f "$PWHASH" ] || [ "$(ssh_port)" != 22 ] || [ -n "$(trial_port)" ] || keys_only || keepalive || boot_fix
}

# The options dropbear should run with; just -R (like the Homebrew Channel)
# when nothing is set
dropbear_flags() {
    _df="-R"
    _dp=$(ssh_ports)
    if [ "$_dp" != 22 ]; then for _x in $_dp; do _df="$_df -p $_x"; done; fi
    keys_only && _df="$_df -s"
    keepalive && _df="$_df -K $KEEPALIVE_SECS"
    say "$_df"
}

# ------------------------------------------------------------------ servers
#
# Every SSH server on the TV, read from /proc: the Homebrew Channel's
# dropbear, Entware's OpenSSH or dropbear, Developer Mode's sshd (port 9922),
# or something else.  Sessions (children of a server) are left out.

# "PID PPID COMM" for each dropbear, sshd and telnetd process
ssh_procs() {
    for _cf in $(procs_named 'dropbear|sshd|telnetd'); do
        _d=${_cf%/comm}
        _c=$(cat "$_cf" 2>/dev/null) || continue
        _pp=$(sed 's/^.*) [A-Za-z] \([0-9]*\).*/\1/' "$_d/stat" 2>/dev/null)
        say "${_d##*/} ${_pp:-0} $_c"
    done
}

cmdline_of() { tr '\000' ' ' < "$PROC/$1/cmdline" 2>/dev/null | sed 's/ *$//'; }

# Server processes: those whose parent isn't the same kind of server
server_pids() {
    ssh_procs > "$RUN/procs.$$"
    awk 'NR == FNR { c[$1] = $3; next } c[$2] != $3 { print $1, $3 }' "$RUN/procs.$$" "$RUN/procs.$$"
    rm -f "$RUN/procs.$$"
}

# "INODE PORT" for each listening TCP socket
listen_inodes() {
    cat "$PROC/net/tcp" "$PROC/net/tcp6" 2>/dev/null | awk '$4 == "0A" { n = split($2, a, ":"); print $10, a[n] }' |
        while read -r _in _hx; do printf '%s %d\n' "$_in" "0x$_hx"; done
}

# The ports PID listens on, space-separated
ports_of() {
    for _fd in "$PROC/$1"/fd/*; do
        _l=$(readlink "$_fd" 2>/dev/null) || continue
        case "$_l" in socket:\[*\]) _in=${_l#socket:[}; say "${_in%]}" ;; esac
    done | sort -u > "$RUN/inodes.$$"
    listen_inodes | awk 'NR == FNR { s[$1] = 1; next } ($1 in s) { print $2 }' "$RUN/inodes.$$" - | sort -n -u | tr '\n' ' ' | sed 's/ *$//'
    rm -f "$RUN/inodes.$$"
}

# hbc, entware-openssh, entware-dropbear, devmode or other
server_kind() {
    _cl=$(cmdline_of "$1")
    case "$_cl" in
        "$DROPBEAR"*|*/org.webosbrew.hbchannel.service/bin/dropbear*) say hbc; return ;;
        /opt/*) if [ "$2" = sshd ]; then say entware-openssh; else say entware-dropbear; fi; return ;;
    esac
    case " $3 " in *" $DEVMODE_PORT "*) say devmode; return ;; esac
    case "$_cl" in *devmode*|*developer*) [ "$2" = sshd ] && { say devmode; return; } ;; esac
    say other
}

# "PID KIND NAME PORTS..." per SSH server (not telnet).  Kept for the rest
# of this run, since a status check asks several times; servers_fresh forgets
# it after starting or stopping a server
servers_list() {
    if [ ! -f "$RUN/servers.$$" ]; then
        server_pids | while read -r _p _c; do
            [ "$_c" = telnetd ] && continue
            _ps=$(ports_of "$_p")
            say "$_p $(server_kind "$_p" "$_c" "$_ps") $_c $_ps"
        done > "$RUN/servers.$$.tmp"
        mv "$RUN/servers.$$.tmp" "$RUN/servers.$$"
    fi
    cat "$RUN/servers.$$"
}
servers_fresh() { rm -f "$RUN/servers.$$"; }

hbc_masters() { servers_list | awk '$2 == "hbc" { print $1 }'; }

# Who listens on port $1: hbc, another kind, "unknown" (no process found), or nothing
port_owner() {
    # No "exit" in awk: reading to the end keeps the pipe open (see running_flags)
    _o=$(servers_list | awk -v p="$1" '!f { for (i = 4; i <= NF; i++) if ($i == p) { print $2; f = 1; break } }')
    if [ -n "$_o" ]; then say "$_o"; elif listening "$1"; then say unknown; fi
}

servers_json() {
    printf '['; _f=1
    servers_list | while read -r _p _k _c _ps; do
        [ $_f = 1 ] || printf ','; _f=0
        printf '{"pid":%s,"kind":%s,"name":%s,"ports":[%s],"cmd":%s}' "$_p" "$(js "$_k")" "$(js "$_c")" \
            "$(printf '%s' "$_ps" | tr ' ' ',')" "$(js "$(cmdline_of "$_p")")"
    done
    printf ']'
}

# The running Homebrew Channel dropbear's options, to compare with ours
running_flags() {
    # awk, not head: head closing the pipe early makes some shells' printf fail
    _m=$(hbc_masters | awk 'NR == 1')
    [ -n "$_m" ] || return 0
    cmdline_of "$_m" | sed 's/^[^ ]*//; s/^ *//'
}
settings_applied() {
    [ -f "$SSHD_FLAG" ] || return 0
    [ -n "$(hbc_masters)" ] || return 0
    [ "$(running_flags)" = "$(dropbear_flags)" ]
}

# Stop the Homebrew Channel's dropbear (open sessions stay up: they're
# separate processes) and start it again with our options.  If it won't come
# up that way, start it the Homebrew Channel's way so SSH isn't left off.
kill_pid() {
    servers_fresh
    if [ -n "$R" ]; then
        # The tests' fake /proc
        # shellcheck source=/dev/null
        if [ -n "${SD_FAKEKILL:-}" ]; then . "$SD_FAKEKILL"; fake_kill "$1"; else rm -rf "${PROC:?}/$1"; fi
    else
        kill "$1" 2>/dev/null
    fi
}
restart_dropbear() {
    if [ ! -f "$SSHD_FLAG" ]; then
        say "SSH is off in the Homebrew Channel, so the settings take effect when it's turned on."
        return 0
    fi
    [ -x "$DROPBEAR" ] || die "The Homebrew Channel's SSH server ($DROPBEAR) is missing.  Reinstall the Homebrew Channel."
    _want=$(ssh_ports)
    for _x in $_want; do
        _ow=$(port_owner "$_x")
        if [ -n "$_ow" ] && [ "$_ow" != hbc ]; then
            die "Port $_x is already used by another program ($_ow), so SSH wasn't moved there."
        fi
    done
    for _m in $(hbc_masters); do kill_pid "$_m"; done
    _i=0
    while [ $_i -lt 10 ] && [ -n "$(hbc_masters)" ]; do sleep 0.3 2>/dev/null || sleep 1; _i=$((_i + 1)); servers_fresh; done
    mkdir -p "$HOSTKEYS"
    # shellcheck disable=SC2046
    "$DROPBEAR" $(dropbear_flags); servers_fresh
    _i=0
    while [ $_i -lt 20 ]; do
        _ok=1
        for _x in $_want; do listening "$_x" || _ok=0; done
        [ $_ok = 1 ] && { say "Restarted the SSH server on port$( [ "${_want#* }" != "$_want" ] && printf 's') $(echo "$_want" | sed 's/ / and /')."; return 0; }
        sleep 0.5 2>/dev/null || sleep 1; _i=$((_i + 1))
    done
    for _m in $(hbc_masters); do kill_pid "$_m"; done
    "$DROPBEAR" -R; servers_fresh
    die "The SSH server didn't start with these settings, so it was started the usual way, on port 22."
}

# root's password through a bind-mounted copy of /etc/shadow (and /etc/passwd
# when root's entry there is "*"), the way the Homebrew Channel does it
shadow_with() {
    mkdir -p "$RUN"
    _src="$SHADOW"
    if [ -z "${SD_NOMOUNT:-}" ] && grep -q ' /etc/shadow ' /proc/mounts 2>/dev/null; then
        umount /etc/shadow 2>/dev/null
    fi
    # Read-only from last time; rm so non-root test runs can write it again
    rm -f "$RUN/shadow"
    sed -r 's|^root:[^:]*:|root:'"$1"':|' "$_src" > "$RUN/shadow"
    chmod 400 "$RUN/shadow"
    if [ -n "${SD_NOMOUNT:-}" ]; then
        cat "$RUN/shadow" > "$SHADOW"
    else
        mount --bind "$RUN/shadow" "$SHADOW" || die "Couldn't change root's password."
    fi
    if grep -q '^root:\*:' "$PASSWD" 2>/dev/null; then
        rm -f "$RUN/passwd"
        sed 's/^root:\*:/root:x:/' "$PASSWD" > "$RUN/passwd"
        chmod 444 "$RUN/passwd"
        if [ -n "${SD_NOMOUNT:-}" ]; then cat "$RUN/passwd" > "$PASSWD"; else mount --bind "$RUN/passwd" "$PASSWD"; fi
    fi
}
# Back to what the Homebrew Channel does at boot: alpine if there's no keys
# file, otherwise the TV's own shadow (no password)
shadow_default() {
    if [ -n "${SD_NOMOUNT:-}" ]; then
        if [ -f "$AK" ]; then shadow_with '*'; else shadow_with "$ALPINE_HASH"; fi
        return 0
    fi
    grep -q ' /etc/shadow ' /proc/mounts 2>/dev/null && umount /etc/shadow 2>/dev/null
    [ -f "$AK" ] || shadow_with "$ALPINE_HASH"
}

# The startup hook: a copy of this script in $SDDIR, run by the Homebrew
# Channel's run-parts after it starts SSH
install_hook() {
    mkdir -p "$SDDIR" "${HOOK%/*}" && chmod 700 "$SDDIR"
    # At boot this runs from that copy itself
    [ "$HERE/ssh-doctor.sh" -ef "$SDDIR/ssh-doctor.sh" ] || cp "$HERE/ssh-doctor.sh" "$SDDIR/ssh-doctor.sh"
    cat > "$HOOK" <<'EOF'
#!/bin/sh
# Added by LG webOS SSH Doctor: puts its SSH settings back after a restart.
# Remove them with Reset to defaults in the app, or: sh /var/lib/webosbrew/ssh-doctor/ssh-doctor.sh reset-settings
# The app's own copy when it's installed (always the newest), or the one kept here
S=/var/lib/webosbrew/ssh-doctor/ssh-doctor.sh
A=/media/developer/apps/usr/palm/applications/org.ohmybahgosh.sshdoctor/assets/ssh-doctor.sh
[ -f "$A" ] && S=$A
[ -f "$S" ] && (sh "$S" boot < /dev/null > /var/lib/webosbrew/ssh-doctor/boot.log 2>&1 &)
exit 0
EOF
    chmod 755 "$HOOK"
}
remove_hook() { rm -f "$HOOK" "$SDDIR/ssh-doctor.sh"; }

# Save-and-use: the password, the hook, and dropbear's options
apply() {
    if [ -f "$PWHASH" ]; then shadow_with "$(cat "$PWHASH")"; fi
    if customized; then install_hook; else remove_hook; fi
    if settings_applied && [ "${1:-}" != force ]; then say "SSH already runs with these settings."; return 0; fi
    restart_dropbear
}

# At boot, from the hook.  The Homebrew Channel sets its failsafe flag while
# it starts up and runs init.d, then clears it 10 seconds later; it only
# skips init.d when the flag was still there from a boot that went wrong.
# So wait for the flag to go (and for its dropbear), then apply.
boot() {
    _i=0
    while [ $_i -lt 90 ] && [ -f "$FAILSAFE" ]; do sleep 1; _i=$((_i + 1)); done
    if [ -f "$FAILSAFE" ]; then
        say "$(date): the failsafe flag stayed, so the settings weren't applied."
        boot_record failsafe
        return 0
    fi
    _i=0
    while [ $_i -lt 30 ] && [ -f "$SSHD_FLAG" ] && [ -z "$(hbc_masters)" ]; do sleep 1; _i=$((_i + 1)); servers_fresh; done
    say "$(date): applying $(dropbear_flags)"
    # In a subshell: if dropbear won't start with the settings, apply gives up
    # (after starting it the usual way), and the check below still runs
    (apply)
    servers_fresh
    boot_heal
}

boot_record() {
    mkdir -p "$SDDIR"
    printf '%s %s\n' "$(date +%Y-%m-%dT%H:%M:%S)" "$*" > "$BOOTLAST.tmp" && mv "$BOOTLAST.tmp" "$BOOTLAST"
}

# After the settings are back: is SSH up?  With "Fix SSH at startup" on,
# start it when it should be running and isn't, and fix permissions that
# make dropbear ignore the keys.  Never touches another program's port.
boot_heal() {
    _bh=''
    _bp=$(ssh_port)
    if [ -f "$SSHD_FLAG" ] && [ "$(port_owner "$_bp")" != hbc ]; then
        if [ -n "$(port_owner "$_bp")" ]; then _bh="$_bh port-taken"
        elif ! boot_fix; then _bh="$_bh down"
        elif (ssh_on); then _bh="$_bh started"
        else _bh="$_bh failed"
        fi
    fi
    if boot_fix && [ -n "$(perm_problems)" ]; then
        fix_perms
        _bh="$_bh perms"
    fi
    _bh=${_bh# }
    boot_record "${_bh:-ok}"
    say "$(date): at startup: $(boot_result)"
}

# The last start's result: ok, started, perms, down, failed, port-taken or
# failsafe (several, space-separated), or nothing before the first one
boot_result() { sed -n 's/^[^ ]* //p' "$BOOTLAST" 2>/dev/null | awk 'NR == 1'; }
boot_time() { awk 'NR == 1 { print $1 }' "$BOOTLAST" 2>/dev/null; }

settings_json() {
    printf '{"port":%s,"trial":%s,"keysOnly":%s,"keepalive":%s,"bootFix":%s,"password":%s,"hook":%s,"applied":%s,"flags":%s,"lastBoot":{"t":%s,"result":%s}}' \
        "$(ssh_port)" "$( [ -n "$(trial_port)" ] && trial_port || echo null)" \
        "$(keys_only && echo true || echo false)" "$(keepalive && echo true || echo false)" \
        "$(boot_fix && echo true || echo false)" \
        "$([ -f "$PWHASH" ] && echo true || echo false)" "$([ -f "$HOOK" ] && echo true || echo false)" \
        "$(settings_applied && echo true || echo false)" "$(js "$(running_flags)")" \
        "$(js "$(boot_time)")" "$(js "$(boot_result)")"
}

# ------------------------------------------------------------------ Entware
#
# Entware's OpenSSH and dropbear, for people who use them instead of (or as
# well as) the Homebrew Channel's.  Read only: nothing here changes, starts
# or stops them.  OpenSSH is asked for its settings with "sshd -T", which
# only reads its files.

# The Entware SSH servers that are installed
ent_kinds() {
    if [ -x "$ENT_SSHD" ]; then say entware-openssh; fi
    if [ -x "$ENT_DROPBEAR" ]; then say entware-dropbear; fi
    return 0
}

# Entware's start script for KIND (S40sshd, S51dropbear and so on), if any
ent_initscript() {
    case "$1" in entware-openssh) _ip='sshd' ;; *) _ip='dropbear' ;; esac
    for _f in "$ENT_INITD"/S[0-9]*"$_ip"; do
        if [ -f "$_f" ]; then say "$_f"; return 0; fi
    done
    return 0
}

# The port a running Entware SSH server listens on, if any
entware_port() { servers_list | awk '$2 ~ /^entware-/ && NF >= 4 { print $4 }' | awk 'NR == 1'; }

# Does anything start Entware at boot?
ent_autostart() { grep -q -s 'rc\.unslung' "$INITD"/* "$STARTUP" 2>/dev/null; }

# OpenSSH's own settings (sshd -T), one value: sshd_get KEY.  Asked once per
# run; empty when sshd refuses its settings (sshd_err says why)
sshd_load() {
    [ -f "$RUN/sshdT.$$" ] && return 0
    if "$ENT_SSHD" -T -f "$ENT_SSHD_CONF" > "$RUN/sshdT.$$.tmp" 2> "$RUN/sshdE.$$" < /dev/null; then :; else : > "$RUN/sshdT.$$.tmp"; fi
    mv "$RUN/sshdT.$$.tmp" "$RUN/sshdT.$$"
}
sshd_get() {
    sshd_load
    awk -v k="$1" '$1 == k { $1 = ""; sub(/^ +/, ""); print }' "$RUN/sshdT.$$" | awk 'NR == 1'
}
sshd_err() { sshd_load; grep -v '^[[:space:]]*$' "$RUN/sshdE.$$" 2>/dev/null | awk 'NR == 1'; }

# The port Entware's dropbear is set to start on: -p in its start script
edb_port() {
    _ei=$(ent_initscript entware-dropbear)
    _p=''
    [ -n "$_ei" ] && _p=$(sed -n 's/.*-p[[:space:]]*\([0-9.]*:\)\{0,1\}\([0-9][0-9]*\).*/\2/p' "$_ei" | awk 'NR == 1')
    say "${_p:-22}"
}

# root's password for Entware's programs, from /opt/etc/shadow: set or none
ent_password_state() {
    _h=$(awk -F: '$1 == "root" { print $2 }' "$ENT_SHADOW" 2>/dev/null | awk 'NR == 1')
    case "$_h" in
        ''|'*'|'!'|'!!'|x|'*'*|'!'*) say none ;;
        *) say set ;;
    esac
}

# Check one Entware server.  Sets:
#   _ek_run    yes or no
#   _ek_ports  the ports it listens on
#   _ek_port   the port it's set to use
#   _ek_codes  what's wrong, space-separated
#   _ek_pwoff  yes when it won't take root's password
#   _ek_detail OpenSSH's own error, when it refuses its settings
ent_check() {
    _ek=$1; _ek_codes=''; _ek_detail=''; _ek_pwoff=no
    _ek_ports=$(servers_list | awk -v k="$_ek" '$2 == k { for (i = 4; i <= NF; i++) printf "%s ", $i }' | sed 's/ *$//')
    _ek_run=no
    [ -n "$(servers_list | awk -v k="$_ek" '$2 == k { print $1 }')" ] && _ek_run=yes
    _ek_init=$(ent_initscript "$_ek")
    _ek_hk=no
    if [ "$_ek" = entware-openssh ]; then
        for _h in "$ENT_SSH_DIR"/ssh_host_*_key; do
            if [ -e "$_h" ] && [ ! -s "$_h" ]; then _ek_hk=yes; fi
        done
        sshd_load
        if [ ! -s "$RUN/sshdT.$$" ]; then
            _ek_detail=$(sshd_err)
            case "$_ek_detail" in
                *[Hh]ost[Kk]ey*|*[Hh]ost\ [Kk]ey*) _ek_hk=yes ;;
                *) _ek_codes="$_ek_codes sshd-config-bad" ;;
            esac
        else
            case "$(sshd_get permitrootlogin)" in
                no|forced-commands-only) _ek_codes="$_ek_codes sshd-root-denied" ;;
                prohibit-password|without-password) _ek_pwoff=yes ;;
            esac
            [ "$(sshd_get passwordauthentication)" = no ] && _ek_pwoff=yes
            case " $(sshd_get authorizedkeysfile) " in
                *" .ssh/authorized_keys "*|*" %h/.ssh/authorized_keys "*|*" /home/root/.ssh/authorized_keys "*) ;;
                *) _ek_codes="$_ek_codes sshd-keyfile-elsewhere" ;;
            esac
        fi
        [ $_ek_hk = yes ] && _ek_codes="$_ek_codes sshd-hostkey-broken"
        _ek_port=$(sshd_get port)
        _ek_port=${_ek_port:-22}
    else
        for _h in "$ENT_DB_DIR"/dropbear_*_host_key; do
            if [ -e "$_h" ] && [ ! -s "$_h" ]; then _ek_hk=yes; fi
        done
        [ $_ek_hk = yes ] && _ek_codes="$_ek_codes edb-hostkey-broken"
        _ek_port=$(edb_port)
    fi
    if [ -n "$_ek_init" ]; then
        if [ $_ek_run = no ]; then
            if [ -n "$(port_owner "$_ek_port")" ]; then _ek_codes="$_ek_codes entware-port-clash"
            else _ek_codes="$_ek_codes entware-stopped"; fi
        fi
        ent_autostart || _ek_codes="$_ek_codes entware-no-autostart"
    fi
    _ek_codes=${_ek_codes# }
}

# [{"kind":..,"running":..,"ports":[..],"port":..,"startScript":..,
#   "problems":[..],"detail":..}] for each installed Entware SSH server
ent_json() {
    printf '['; _f=1
    for _k in $(ent_kinds); do
        ent_check "$_k"
        [ $_f = 1 ] || printf ','; _f=0
        printf '{"kind":%s,"running":%s,"ports":[%s],"port":%s,"startScript":%s,"passwordOff":%s,"problems":[%s],"detail":%s}' \
            "$(js "$_k")" "$([ $_ek_run = yes ] && echo true || echo false)" \
            "$(printf '%s' "$_ek_ports" | tr ' ' ',')" "$_ek_port" \
            "$([ -n "$_ek_init" ] && echo true || echo false)" "$([ $_ek_pwoff = yes ] && echo true || echo false)" \
            "$(for _c in $_ek_codes; do printf '"%s",' "$_c"; done | sed 's/,$//')" "$(js "$_ek_detail")"
    done
    printf ']'
}

ent_text() {
    for _k in $(ent_kinds); do
        ent_check "$_k"
        say "$_k: installed, running $_ek_run, port $_ek_port${_ek_ports:+ (listening on $_ek_ports)}, start script $([ -n "$_ek_init" ] && echo yes || echo no)"
        [ -n "$_ek_codes" ] && say "  found: $_ek_codes"
        [ -n "$_ek_detail" ] && say "  sshd says: $_ek_detail"
    done
    return 0
}

# ------------------------------------------------------------------ status

# Each finding is "code level" (level: problem, tip); the app words them
collect() {
    FIND=''
    # Each code once
    add() {
        case "
$FIND" in *"
$1 "*) return 0 ;; esac
        FIND="$FIND$1 $2
"
    }
    _port=$(ssh_port)
    _trial=$(trial_port)
    _flag=no; [ -f "$SSHD_FLAG" ] && _flag=yes
    _run=no; [ -n "$(hbc_masters)" ] && _run=yes
    _owner=$(port_owner "$_port")
    _listen=no; [ "$_owner" = hbc ] && _listen=yes
    _pw=$(password_state)
    _kp=$(key_problems | sed 's/ *$//')
    _kc=$(key_count)
    _pp=$(perm_problems)
    _tel=yes; [ -f "$TELNET_OFF" ] && _tel=no
    _telrun=no; telnet_running && _telrun=yes
    _ko=no; keys_only && _ko=yes
    _others=$(servers_list | awk '$2 != "hbc"' | wc -l | tr -d ' ')
    _badpw=$(bad_logins_recent)

    # Entware's SSH servers.  When the Homebrew Channel's isn't answering
    # and one of Entware's is, that's how people get in: its problems count,
    # and the Homebrew Channel's SSH being off isn't one.
    _entrun=''; _entc=''; _entpwoff=no
    for _k in $(ent_kinds); do
        ent_check "$_k"
        if [ $_ek_run = yes ]; then
            _entrun="$_entrun $_k"
            [ $_ek_pwoff = yes ] && _entpwoff=yes
        fi
        _entc="$_entc $_ek_codes"
    done
    _entrun=${_entrun# }
    _active=''
    if [ "$_listen" = yes ]; then _active=hbc
    elif [ -n "$_entrun" ]; then _active=${_entrun%% *}
    fi
    # Can root log in on Entware's SSH?  Keys are the same file; the password
    # is Entware's own, and OpenSSH may not take one for root at all
    _entpw=$(ent_password_state)
    _entlogin=no
    if [ "$_kc" != 0 ]; then _entlogin=yes
    elif [ "$_entpw" = set ] && [ $_entpwoff = no ]; then _entlogin=yes
    fi

    [ -d "$HBC_SVC" ] || add hbc-missing problem
    [ -f "$FAILSAFE" ] && add failsafe problem
    if [ -n "$_owner" ] && [ "$_owner" != hbc ]; then
        # Entware's SSH on the port, with the Homebrew Channel's turned off:
        # that's a choice, not a problem
        case "$_owner" in
            entware-*) [ "$_flag" = yes ] && add port-taken problem ;;
            *) add port-taken problem ;;
        esac
    elif [ "$_flag" = no ] && [ "$_listen" = no ]; then
        [ -n "$_entrun" ] || add ssh-off problem
    elif [ "$_flag" = yes ] && [ "$_listen" = no ]; then add ssh-not-running problem
    elif [ "$_flag" = no ] && [ "$_listen" = yes ]; then add ssh-off-next-boot tip
    fi
    case "$_active" in entware-*) add ssh-is-entware tip ;; esac
    # Locked out: keys only, and none of them usable
    if [ "$_kc" = 0 ]; then
        if [ "$_active" != "${_active#entware-}" ]; then
            [ $_entlogin = yes ] || add entware-no-way-in problem
        elif [ "$_ko" = yes ]; then add keys-only-no-keys problem
        elif [ "$_pw" != alpine ] && [ "$_pw" != set ]; then
            if [ -f "$AK" ]; then add no-way-in problem; else add no-password problem; fi
        fi
    fi
    # What's wrong with Entware's servers: a problem when nothing else lets
    # people in, otherwise a tip
    for _c in $_entc; do
        case "$_c" in
            entware-no-autostart|sshd-keyfile-elsewhere) add "$_c" tip ;;
            *) if [ "$_listen" = yes ]; then add "$_c" tip; else add "$_c" problem; fi ;;
        esac
    done
    case " $_kp " in *" private "*) add keys-private problem ;; esac
    case " $_kp " in *" crlf "*|*" bom "*|*" wrapped "*|*" putty "*) add keys-fixable problem ;; esac
    case " $_kp " in *" bad "*|*" broken "*) add keys-bad problem ;; esac
    [ -n "$_pp" ] && add perms problem
    hostkeys_broken && add hostkey-broken problem
    if [ "$_listen" = yes ] && ! settings_applied; then add settings-not-applied problem; fi
    [ -n "$_trial" ] && add port-trial tip
    # alpine is the Homebrew Channel's: Entware's SSH has its own password
    if [ "$_pw" = alpine ] && [ "$_ko" = no ] && [ "$_active" = "${_active#entware-}" ]; then
        add password-default tip
    fi
    [ "${_badpw:-0}" -ge 5 ] 2>/dev/null && add failed-logins tip
    case "$_active" in entware-*) ;; *) [ "$_others" != 0 ] && add other-ssh tip ;; esac
    [ "$_tel" = no ] && add telnet-off tip
    # What the startup check did last time
    case " $(boot_result) " in *" started "*) add boot-started tip ;; esac
    case " $(boot_result) " in *" perms "*) add boot-perms tip ;; esac
    # The router forwards SSH or telnet to the internet (from the last check)
    if [ -f "$EXPOSURE" ]; then
        _xp=$(exposed_ports)
        case "$_xp" in *' 23 '*) add telnet-exposed problem ;; esac
        if [ -n "$(printf '%s' "$_xp" | sed 's/ 23 / /' | tr -d ' ')" ]; then add ssh-exposed problem; fi
    fi
}

# Empty host key files stop dropbear from starting
hostkeys_broken() {
    for _h in "$HOSTKEYS"/dropbear_*_host_key; do
        [ -e "$_h" ] && [ ! -s "$_h" ] && return 0
    done
    return 1
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
    printf '"port":%s,"portOwner":%s,"keysOnly":%s,"sftp":%s,"failedLogins":%s,' "$_port" "$(js "$_owner")" \
        "$([ "$_ko" = yes ] && echo true || echo false)" "$([ -x "$SFTP_SERVER" ] && echo true || echo false)" "${_badpw:-0}"
    printf '"settings":%s,"servers":%s,' "$(settings_json)" "$(servers_json)"
    printf '"exposure":%s,' "$(if [ -f "$EXPOSURE" ]; then tr -d '\n' < "$EXPOSURE"; else echo null; fi)"
    printf '"active":%s,"entware":%s,"entwarePassword":%s,"entwareLogin":%s,' "$(js "$_active")" "$(ent_json)" \
        "$(js "$_entpw")" "$([ $_entlogin = yes ] && echo true || echo false)"
    printf '"sessions":{"%s":%s%s},' "$_port" "$(sessions_on "$_port")" "$([ -n "$_trial" ] && printf ',"%s":%s' "$_trial" "$(sessions_on "$_trial")")"
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
    say "SSH server running: $_run, listening on port $_port: $_listen${_trial:+ (and $_trial until you keep the new port)}"
    say "Settings: $(dropbear_flags)$([ -f "$PWHASH" ] && printf ', your own password')"
    servers_list | while read -r _p _k _c _ps; do say "SSH server: $_c ($_k), pid $_p, port ${_ps:-none}"; done
    ent_text | sed 's/^/Entware /'
    case "$_active" in entware-*) say "Logging in goes through $_active.  Root's password there is Entware's own: $_entpw" ;; esac
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
    _sp=$(ssh_port)
    if [ "$(port_owner "$_sp")" = hbc ]; then say "The SSH server is already running."; return 0; fi
    [ -x "$DROPBEAR" ] || die "The Homebrew Channel's SSH server ($DROPBEAR) is missing.  Reinstall the Homebrew Channel."
    _ow=$(port_owner "$_sp")
    [ -z "$_ow" ] || die "Port $_sp is already used by another program ($_ow), so SSH can't start there."
    if hostkeys_broken; then
        for _h in "$HOSTKEYS"/dropbear_*_host_key; do [ -s "$_h" ] || rm -f "$_h"; done
        say "Removed empty host key files, so new ones are made."
    fi
    # Started the same way the Homebrew Channel's startup script does, plus
    # any settings made here
    mkdir -p "$HOSTKEYS"
    # shellcheck disable=SC2046
    "$DROPBEAR" $(dropbear_flags); servers_fresh
    _i=0
    while [ $_i -lt 10 ]; do
        listening "$_sp" && { say "Started the SSH server on port $_sp."; return 0; }
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
# through a bind mount, so /etc stays untouched.  For anyone locked out, so it
# also drops a password of their own and keys-only login.
password_on() {
    if [ -f "$AK" ]; then
        _off="$AK.ssh-doctor-off-$(stamp)"
        mv "$AK" "$_off" && say "Set the keys file aside as $_off"
    fi
    _was=no
    [ -f "$PWHASH" ] && { rm -f "$PWHASH"; _was=yes; }
    keys_only && { conf_set KEYSONLY ''; _was=yes; }
    if [ "$(password_state)" != alpine ]; then shadow_with "$ALPINE_HASH"; fi
    if [ $_was = yes ]; then
        if customized; then install_hook; else remove_hook; fi
        restart_dropbear > /dev/null 2>&1
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

# key-remove FP, key-rename FP NAME: by fingerprint, with a backup first
key_edit() {
    [ -f "$AK" ] || die "There's no keys file."
    _n=$(find_node)
    [ -n "$_n" ] || die "This needs Node.js."
    mkdir -p "$RUN"
    "$_n" "$HERE/keyinfo.js" edit "$AK" "$@" > "$RUN/ak.new" || { rm -f "$RUN/ak.new"; die "No key with that fingerprint."; }
    if [ "$1" = remove ] && [ "$(grep -c -v '^#' "$RUN/ak.new" | tr -d ' ')" = 0 ] && keys_only; then
        rm -f "$RUN/ak.new"; die "That's the last key and keys only is on, so nobody could log in.  Turn keys only off first."
    fi
    backup "$AK"
    cat "$RUN/ak.new" > "$AK"
    rm -f "$RUN/ak.new"
    fix_perms
    if [ "$1" = remove ]; then say "Removed the key."; else say "Renamed the key."; fi
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

# ------------------------------------------------------------------ SSH settings

# A SHA-512 crypt hash, made by the app or the pairing page (the password
# itself never reaches this script)
set_password() {
    # shellcheck disable=SC2016
    printf '%s' "$1" | grep -Eq '^\$6\$(rounds=[0-9]{4,9}\$)?[./0-9A-Za-z]{1,16}\$[./0-9A-Za-z]{86}$' ||
        die "That isn't a password hash this script takes."
    mkdir -p "$SDDIR" && chmod 700 "$SDDIR"
    printf '%s\n' "$1" > "$PWHASH.tmp" && chmod 600 "$PWHASH.tmp" && mv "$PWHASH.tmp" "$PWHASH"
    shadow_with "$1"
    install_hook
    say "Set root's password.  Log in as root with it from now on, also after a restart."
    keys_only && say "Keys only is on, so the password works again once you turn that off."
    return 0
}

clear_password() {
    [ -f "$PWHASH" ] || { say "There's no password of your own to remove."; return 0; }
    rm -f "$PWHASH"
    shadow_default
    if customized; then install_hook; else remove_hook; fi
    if [ -f "$AK" ]; then say "Removed your password.  Only keys log in now, as the Homebrew Channel does when there's a keys file."
    else say "Removed your password.  With no keys file, the Homebrew Channel's alpine password is back."; fi
}

set_keys_only() {
    case "$1" in
        on)
            [ "$(key_count)" != 0 ] || die "Add a key first: with keys only and no key, nobody could log in."
            conf_set KEYSONLY 1; apply
            say "Keys only is on: passwords don't log in any more." ;;
        off) conf_set KEYSONLY ''; apply; say "Keys only is off: passwords work again." ;;
        *) die "Use on or off." ;;
    esac
}

set_keepalive() {
    case "$1" in
        on) conf_set KEEPALIVE 1; apply; say "Idle sessions stay connected now." ;;
        off) conf_set KEEPALIVE ''; apply; say "Keepalive is off." ;;
        *) die "Use on or off." ;;
    esac
}

set_bootfix() {
    case "$1" in
        on) conf_set BOOTFIX 1; apply > /dev/null; say "SSH is checked at every start now, and started if it's down." ;;
        off) conf_set BOOTFIX ''; apply > /dev/null; say "SSH isn't checked at startup any more." ;;
        *) die "Use on or off." ;;
    esac
}

set_port() {
    _np=$1
    case "$_np" in ''|*[!0-9]*) die "A port is a number." ;; esac
    _np=$((_np + 0))
    [ "$_np" = 22 ] || { [ "$_np" -ge 1024 ] && [ "$_np" -le 65535 ]; } || die "Pick 22, or a port from 1024 to 65535."
    [ "$_np" = 23 ] && die "Port 23 is telnet's."
    [ "$_np" -ge 28622 ] && [ "$_np" -le 28631 ] && die "Ports 28622 to 28631 are the pairing page's."
    _op=$(ssh_port)
    [ "$_np" = "$_op" ] && { say "SSH already uses port $_np."; return 0; }
    _ow=$(port_owner "$_np")
    [ -z "$_ow" ] || die "Port $_np is already used by another program ($_ow)."
    _keep=$(trial_port)
    [ -n "$_keep" ] || _keep=$_op
    [ "$_keep" = "$_np" ] && _keep=''
    conf_set PORT "$([ "$_np" = 22 ] || echo "$_np")"
    conf_set TRIAL "$_keep"
    if (apply); then
        [ -n "$_keep" ] && say "SSH now answers on port $_np too.  Port $_keep stays open until you log in on $_np and keep it."
        return 0
    fi
    # Didn't start there: back to how it was
    conf_set PORT "$([ "$_op" = 22 ] && echo '' || echo "$_op")"
    conf_set TRIAL "$([ "$_keep" = "$_op" ] && echo '' || echo "$_keep")"
    (apply force) > /dev/null 2>&1
    die "SSH stays on port $_op."
}

port_keep() {
    _t=$(trial_port)
    [ -n "$_t" ] || { say "There's no port change to keep."; return 0; }
    conf_set TRIAL ''
    apply
    say "Kept port $(ssh_port).  Port $_t is closed."
}

port_revert() {
    _t=$(trial_port)
    [ -n "$_t" ] || { say "There's no port change to undo."; return 0; }
    conf_set PORT "$([ "$_t" = 22 ] && echo '' || echo "$_t")"
    conf_set TRIAL ''
    apply
    say "SSH is back on port $(ssh_port)."
}

reset_settings() {
    rm -f "$CONF" "$PWHASH"
    shadow_default
    remove_hook
    rm -f "$SDDIR/boot.log" "$BOOTLAST"
    rmdir "$SDDIR" 2>/dev/null
    if [ -f "$SSHD_FLAG" ] && [ "$(running_flags)" != "-R" ]; then restart_dropbear > /dev/null 2>&1; fi
    say "Removed every SSH setting.  SSH runs the Homebrew Channel's way again: port 22, its usual password and key rules."
}

# ------------------------------------------------------------------ survival kit
#
# A copy of what makes logging in work, on a USB drive: the keys file, the
# TV's own SSH keys (so computers don't warn REMOTE HOST IDENTIFICATION HAS
# CHANGED after a reset), the settings and the password hash.  Put back with
# backups first; a port in the kit is tried like a port change, with the
# current port kept open.  Kits are DRIVE/ssh-doctor-kit/YYYYMMDD-HHMMSS.

usb_dirs() {
    for _u in "$USBROOT"/*/*; do
        if [ -d "$_u" ] && [ -w "$_u" ]; then say "$_u"; fi
    done
    return 0
}

kit_save() {
    _base=${1:-}
    [ -n "$_base" ] || _base=$(usb_dirs | awk 'NR == 1')
    [ -n "$_base" ] || die "No USB drive found.  Plug one into the TV and try again."
    [ -d "$_base" ] || die "There's no folder $_base"
    _hk=0
    for _h in "$HOSTKEYS"/dropbear_*_host_key; do [ -s "$_h" ] && _hk=$((_hk + 1)); done
    if [ ! -f "$AK" ] && [ $_hk = 0 ] && [ ! -f "$CONF" ] && [ ! -f "$PWHASH" ]; then
        die "There's nothing to save yet: no keys, no settings."
    fi
    _k="$_base/$KITNAME/$(stamp)"
    mkdir -p "$_k" || die "Couldn't write to the USB drive."
    if [ -f "$AK" ]; then cp "$AK" "$_k/authorized_keys" || die "Couldn't write to the USB drive."; fi
    if [ $_hk != 0 ]; then
        mkdir -p "$_k/hostkeys"
        for _h in "$HOSTKEYS"/dropbear_*_host_key; do [ -s "$_h" ] && cp "$_h" "$_k/hostkeys/"; done
    fi
    [ -f "$CONF" ] && cp "$CONF" "$_k/settings"
    [ -f "$PWHASH" ] && cp "$PWHASH" "$_k/root.hash"
    printf 'saved=%s\nversion=%s\nkeys=%s\nhostkeys=%s\nsettings=%s\npassword=%s\n' "$(date +%Y-%m-%dT%H:%M:%S)" "$VERSION" \
        "$(key_count)" "$_hk" "$([ -f "$CONF" ] && echo yes || echo no)" "$([ -f "$PWHASH" ] && echo yes || echo no)" > "$_k/manifest"
    chmod -R go-rwx "$_k" 2>/dev/null
    sync 2>/dev/null
    say "Saved to $_k"
    say "It has the TV's private SSH keys in it, so keep the drive somewhere safe."
}

# Every kit on every USB drive: "NAME DIR"
kits() {
    for _m in "$USBROOT"/*/*/"$KITNAME"/*/manifest; do
        [ -f "$_m" ] || continue
        _d=${_m%/manifest}
        say "${_d##*/} $_d"
    done | sort -r
    return 0
}

# One line of a kit's manifest: kit_value DIR NAME
kit_value() { sed -n "s/^$2=//p" "$1/manifest" | awk 'NR == 1'; }

kit_list() {
    if [ "${1:-}" != --json ]; then kits; return 0; fi
    printf '['; _f=1
    kits | while read -r _n _d; do
        [ $_f = 1 ] || printf ','; _f=0
        _kn=$(kit_value "$_d" keys); case "$_kn" in ''|*[!0-9]*) _kn=0 ;; esac
        _kh=$(kit_value "$_d" hostkeys); case "$_kh" in ''|*[!0-9]*) _kh=0 ;; esac
        printf '{"name":%s,"saved":%s,"version":%s,"keys":%s,"hostKeys":%s,"settings":%s,"password":%s}' \
            "$(js "$_n")" "$(js "$(kit_value "$_d" saved)")" "$(js "$(kit_value "$_d" version)")" "$_kn" "$_kh" \
            "$([ "$(kit_value "$_d" settings)" = yes ] && echo true || echo false)" \
            "$([ "$(kit_value "$_d" password)" = yes ] && echo true || echo false)"
    done
    printf ']\n'
}

kit_restore() {
    case "$1" in ''|*[!0-9-]*) die "Not a kit name: $1" ;; esac
    _k=$(kits | awk -v n="$1" '$1 == n { print $2 }' | awk 'NR == 1')
    [ -n "$_k" ] || die "No kit called $1 on a USB drive."
    mkdir -p "$RUN"
    _first=no
    if [ -f "$_k/authorized_keys" ]; then
        clean_keys "$_k/authorized_keys" "$RUN/rej" "$RUN/found" > "$RUN/good"
        _n=$(grep -c -v '^#' "$RUN/good" | tr -d ' ')
        if [ "$_n" != 0 ]; then
            [ "$(key_count)" = 0 ] && _first=yes
            mkdir -p "$SSH_DIR"
            backup "$AK"
            cat "$RUN/good" > "$AK"
            fix_perms
            say "Put back the keys file: $_n keys."
        fi
        rm -f "$RUN/rej" "$RUN/found" "$RUN/good"
    fi
    _hk=0
    for _h in "$_k"/hostkeys/dropbear_*_host_key; do [ -s "$_h" ] && _hk=$((_hk + 1)); done
    if [ $_hk != 0 ]; then
        mkdir -p "$HOSTKEYS"
        _bk="$HOSTKEYS.ssh-doctor-$(stamp)"
        cp -a "$HOSTKEYS" "$_bk" && say "Backed up the TV's SSH keys to $_bk"
        for _h in "$_k"/hostkeys/dropbear_*_host_key; do
            if [ -s "$_h" ]; then cp "$_h" "$HOSTKEYS/" && chmod 600 "$HOSTKEYS/${_h##*/}"; fi
        done
        say "Put back the TV's SSH keys, so computers that logged in before don't warn."
    fi
    if [ -f "$_k/settings" ]; then
        _cur=$(ssh_port)
        # Only settings this script knows, with sane values
        _kp=$(sed -n 's/^PORT=\([0-9][0-9]*\)$/\1/p' "$_k/settings" | awk 'NR == 1')
        _kk=$(sed -n 's/^KEYSONLY=\(1\)$/\1/p' "$_k/settings" | awk 'NR == 1')
        _ka=$(sed -n 's/^KEEPALIVE=\(1\)$/\1/p' "$_k/settings" | awk 'NR == 1')
        _kb=$(sed -n 's/^BOOTFIX=\(1\)$/\1/p' "$_k/settings" | awk 'NR == 1')
        if [ -n "$_kp" ] && { [ "$_kp" -lt 1024 ] || [ "$_kp" -gt 65535 ]; }; then _kp=''; fi
        # Keys only needs a key to log in with
        [ "$(key_count)" = 0 ] && _kk=''
        [ -f "$CONF" ] && cp "$CONF" "$CONF.ssh-doctor-$(stamp)"
        conf_set KEYSONLY "$_kk"
        conf_set KEEPALIVE "$_ka"
        conf_set BOOTFIX "$_kb"
        _np=${_kp:-22}
        if [ "$_np" != "$_cur" ]; then
            # Like a port change: the current port stays open until it's kept
            conf_set PORT "$([ "$_np" = 22 ] || echo "$_np")"
            conf_set TRIAL "$_cur"
        fi
        say "Put back the SSH settings."
    fi
    if [ -f "$_k/root.hash" ]; then
        _ph=$(awk 'NR == 1' "$_k/root.hash")
        # shellcheck disable=SC2016
        if printf '%s' "$_ph" | grep -Eq '^\$6\$(rounds=[0-9]{4,9}\$)?[./0-9A-Za-z]{1,16}\$[./0-9A-Za-z]{86}$'; then
            mkdir -p "$SDDIR" && chmod 700 "$SDDIR"
            printf '%s\n' "$_ph" > "$PWHASH.tmp" && chmod 600 "$PWHASH.tmp" && mv "$PWHASH.tmp" "$PWHASH"
            say "Put back your own password."
        fi
    fi
    # Restart SSH, so it uses the keys and settings that were put back
    (apply force) > /dev/null 2>&1
    _t=$(trial_port)
    _sp=$(ssh_port)
    [ -n "$_t" ] && say "SSH answers on port $_sp from the saved settings, and on $_t until you keep port $_sp in SSH settings."
    if [ "$_first" = yes ] && [ "$(password_state)" = alpine ] && [ ! -f "$PWHASH" ]; then
        say "With keys back, the alpine password stops working after the next restart."
    fi
    return 0
}

# ------------------------------------------------------------------ exposure
#
# Does the home router forward SSH or telnet to the internet?  upnp.js asks
# it the way games and apps open ports (UPnP).  Only routers with UPnP on
# answer, and forwards set by hand in the router usually aren't listed.

# The ports that would let someone in: SSH's, Entware's, and telnet
watch_ports() {
    _wp="$(ssh_ports) 23"
    _ep=$(servers_list | awk '$2 ~ /^entware-/ { for (i = 4; i <= NF; i++) printf "%s ", $i }')
    say "$_wp $_ep" | tr ' ' '\n' | grep . | sort -n -u | tr '\n' ' ' | sed 's/ *$//'
}

# The TV ports the router forwards, " 22 23 " style, from the last check
exposed_ports() {
    [ -f "$EXPOSURE" ] || return 0
    _xp=$(tr -d '\n' < "$EXPOSURE" | sed -n 's/.*"exposed":\[\([^]]*\)\].*/\1/p' | tr '}' '\n' | sed -n 's/.*"internal":\([0-9]*\).*/\1/p' | sort -n -u | tr '\n' ' ')
    [ -n "$_xp" ] && say " $_xp"
    return 0
}

exposure_run() {
    _n=$(find_node)
    [ -n "$_n" ] || die "This needs Node.js."
    mkdir -p "$RUN"
    "$_n" "$HERE/upnp.js" "$1" "$(ips)" "$(watch_ports)" > "$EXPOSURE.tmp" 2>/dev/null
    grep -q '"router"' "$EXPOSURE.tmp" 2>/dev/null || echo '{"router":"error","mappings":[],"exposed":[]}' > "$EXPOSURE.tmp"
    mv "$EXPOSURE.tmp" "$EXPOSURE"
}

exposure() {
    exposure_run list
    if [ "${1:-}" = --json ]; then cat "$EXPOSURE"; return 0; fi
    case "$(sed -n 's/.*"router":"\([a-z]*\)".*/\1/p' "$EXPOSURE")" in
        none) say "No router answered.  Its UPnP may be off, so this can't tell: check its port forwarding by hand." ;;
        error) say "The router couldn't be asked." ;;
        *)
            _x=$(exposed_ports)
            if [ -z "$_x" ]; then say "The router doesn't forward SSH or telnet to this TV."
            else say "The router forwards these TV ports to the internet:$_x"; fi ;;
    esac
}

exposure_close() {
    exposure_run close
    _x=$(exposed_ports)
    if grep -q '"closed":\[{' "$EXPOSURE"; then say "Took the forwards off the router."; fi
    [ -z "$_x" ] || die "The router kept forwarding:$_x Remove it in the router's own settings."
    say "The router doesn't forward SSH or telnet to this TV any more."
}

# ------------------------------------------------------------------ logins
#
# dropbear writes to webOS's system log (/tmp/var/log/legacy-log, a few hours
# of it with the rotated .gz files):
#   Pubkey auth succeeded for 'root' with ssh-ed25519 key SHA256:... from IP:PORT
#   Password auth succeeded for 'root' from IP:PORT
#   Bad password attempt for 'root' from IP:PORT
#   Login attempt for nonexistent user from IP:PORT

log_lines() {
    for _n in 9 8 7 6 5 4 3 2 1 0; do
        [ -f "$LOGDIR/legacy-log.$_n.gz" ] && gunzip -c "$LOGDIR/legacy-log.$_n.gz" 2>/dev/null | grep ' dropbear\['
    done
    [ -f "$LOGDIR/legacy-log" ] && grep ' dropbear\[' "$LOGDIR/legacy-log"
    return 0
}

# Failed tries in the current log
bad_logins_recent() {
    [ -f "$LOGDIR/legacy-log" ] || { say 0; return; }
    grep -c -E 'dropbear\[[0-9]+\].* (Bad password attempt|Login attempt for nonexistent user)' "$LOGDIR/legacy-log"
}

logins() {
    log_lines | awk -v J="${1:-}" '
    function jq(s) { gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); return "\"" s "\"" }
    function ipof(s) { gsub(/[<>]/, "", s); sub(/:[0-9]+$/, "", s); return s }
    {
        t = $1; kind = ""; user = ""; fp = ""; ip = ""
        if (match($0, /Pubkey auth succeeded for .* key SHA256:[^ ]+ from [^ ]+/)) {
            kind = "key"; m = substr($0, RSTART, RLENGTH)
            fp = m; sub(/^.* key /, "", fp); sub(/ from .*/, "", fp)
            ip = m; sub(/^.* from /, "", ip)
        } else if (match($0, /Password auth succeeded for .* from [^ ]+/)) {
            kind = "password"; m = substr($0, RSTART, RLENGTH); ip = m; sub(/^.* from /, "", ip)
        } else if (match($0, /Bad password attempt for .* from [^ ]+/)) {
            kind = "bad-password"; m = substr($0, RSTART, RLENGTH); ip = m; sub(/^.* from /, "", ip)
        } else if (match($0, /Login attempt for nonexistent user from [^ ]+/)) {
            kind = "bad-user"; m = substr($0, RSTART, RLENGTH); ip = m; sub(/^.* from /, "", ip)
        } else next
        if (kind != "bad-user" && match(m, /for \047[^\047]*\047/)) { user = substr(m, RSTART + 5, RLENGTH - 6) }
        ip = ipof(ip)
        n++; T[n] = t; K[n] = kind; U[n] = user; F[n] = fp; I[n] = ip
        if (kind ~ /^bad/) { bad++; badip[ip]++ } else ok++
        if (n == 1) first = t
    }
    END {
        if (J != "--json") {
            for (i = (n > 30 ? n - 29 : 1); i <= n; i++) print T[i], K[i], U[i], I[i], F[i]
            printf "%d logins, %d failed tries since %s\n", ok, bad, (first == "" ? "the log started" : first)
            exit
        }
        printf "{\"ok\":%d,\"failed\":%d,\"since\":%s,\"events\":[", ok, bad, jq(first)
        c = 0
        for (i = n; i >= 1 && c < 30; i--) {
            printf "%s{\"t\":%s,\"kind\":%s,\"user\":%s,\"ip\":%s,\"fp\":%s}", (c ? "," : ""), jq(T[i]), jq(K[i]), jq(U[i]), jq(I[i]), jq(F[i]); c++
        }
        printf "],\"failedFrom\":["
        c = 0
        for (a in badip) { printf "%s{\"ip\":%s,\"n\":%d}", (c ? "," : ""), jq(a), badip[a]; c++ }
        printf "],\"lastUsed\":{"
        c = 0
        for (i = n; i >= 1; i--) if (K[i] == "key" && !(F[i] in seen)) { seen[F[i]] = 1; printf "%s%s:%s", (c ? "," : ""), jq(F[i]), jq(T[i]); c++ }
        printf "}}\n"
    }'
}

# ------------------------------------------------------------------ host keys

hostkeys_cmd() {
    _n=$(find_node)
    [ -n "$_n" ] || die "This needs Node.js."
    "$_n" "$HERE/keyinfo.js" hostpub "$HOSTKEYS" ${1:+"$1"}
}

hostkeys_reset() {
    [ -d "$HOSTKEYS" ] || mkdir -p "$HOSTKEYS"
    _bk="$HOSTKEYS.ssh-doctor-$(stamp)"
    cp -a "$HOSTKEYS" "$_bk" && say "Backed up the TV's SSH keys to $_bk"
    rm -f "$HOSTKEYS"/dropbear_*_host_key
    restart_dropbear > /dev/null 2>&1 || ssh_on > /dev/null 2>&1
    say "Removed the TV's SSH keys.  New ones are made at the next login, so computers that logged in before will warn REMOTE HOST IDENTIFICATION HAS CHANGED once."
}

# ------------------------------------------------------------------ telnet

telnet_off() {
    if [ "$(key_count)" = 0 ] && { keys_only || { [ "$(password_state)" != alpine ] && [ "$(password_state)" != set ]; }; }; then
        die "Set up SSH first: telnet is the way back in while nobody can log in over SSH."
    fi
    mkdir -p "$PREFS"
    : > "$TELNET_OFF"
    server_pids | awk '$2 == "telnetd" { print $1 }' | while read -r _t; do kill_pid "$_t"; done
    say "Turned telnet off, now and after restarts.  This app can still fix SSH if it breaks."
}

telnet_on() {
    rm -f "$TELNET_OFF"
    if telnet_running; then say "Telnet is on."; return 0; fi
    [ -x "$TELNETD" ] || die "The Homebrew Channel's telnet server is missing."
    "$TELNETD" -l /bin/sh; servers_fresh
    say "Turned telnet on, on port 23 (no password, like the Homebrew Channel's)."
}

# ------------------------------------------------------------------ report

# For a GitHub issue or a forum post: no IP addresses, no keys, no names
report() {
    collect
    say "LG webOS SSH Doctor $VERSION report"
    say "webOS: $(sed -n 's/.*"core_os_release" *: *"\([^"]*\)".*/\1/p' "$R/var/run/nyx/os_info.json" 2>/dev/null | awk 'NR == 1')"
    say "Kernel: $(uname -r 2>/dev/null)"
    say "Homebrew Channel: $([ -d "$HBC_SVC" ] && echo installed || echo missing), SSH switch $_flag, telnet $_tel, failsafe $([ -f "$FAILSAFE" ] && echo yes || echo no)"
    say "dropbear: $(dropbear_version), running $_run, port $_port$([ -n "$_trial" ] && printf ' (+%s)' "$_trial"), owner ${_owner:-nobody}"
    say "Options: wanted $(dropbear_flags), running $(running_flags)"
    say "Login: password $_pw, keys $_kc, keys only $_ko, key file problems: ${_kp:-none}, permission problems: ${_pp:-none}"
    say "Host keys: $(for _h in "$HOSTKEYS"/dropbear_*_host_key; do [ -e "$_h" ] && printf '%s(%s) ' "$(basename "$_h" | sed 's/dropbear_//; s/_host_key//')" "$(wc -c < "$_h" | tr -d ' ')"; done)"
    say "sftp-server: $([ -x "$SFTP_SERVER" ] && echo yes || echo no), node: $([ -n "$(find_node)" ] && echo yes || echo no)"
    servers_list | while read -r _p _k _c _ps; do say "Server: $_c $_k ports ${_ps:-none}"; done
    # sshd's own error can name an address: leave those out
    ent_text | sed -E 's/([0-9]{1,3}\.){3}[0-9]{1,3}/(address)/g; s/^/Entware /'
    say "In use: ${_active:-none}, Entware password $_entpw"
    say "Findings: $(printf '%s' "$FIND" | awk '{ printf "%s ", $1 }')"
    say "Logins in the log: $(logins | tail -n 1 | sed 's/ since .*//')"
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
    _purpose=${1:-key}
    case "$_purpose" in key|password) ;; *) die '{"error":"bad-purpose"}' ;; esac
    _n=$(find_node)
    [ -n "$_n" ] || die '{"error":"no-node"}'
    pair_stop > /dev/null
    mkdir -p "$PAIR"
    chmod 700 "$PAIR"
    : > "$PAIR/alive"
    # What the page shows once paired: how to log in, and the TV's host keys
    # for known_hosts
    # With Entware's SSH answering instead, its port, and no host keys or old
    # dropbear options: those are the Homebrew Channel's
    if [ "$(port_owner "$(ssh_port)")" != hbc ] && [ -n "$(entware_port)" ]; then
        printf '{"purpose":%s,"port":%s,"legacyRsa":false,"hostKeys":[]}\n' "$(js "$_purpose")" "$(entware_port)" > "$PAIR/info.json"
    else
        printf '{"purpose":%s,"port":%s,"legacyRsa":%s,"hostKeys":%s}\n' "$(js "$_purpose")" "$(ssh_port)" \
            "$(legacy_rsa "$(dropbear_version)" && echo true || echo false)" \
            "$("$_n" "$HERE/keyinfo.js" hostpub "$HOSTKEYS" --json 2>/dev/null || echo '[]')" > "$PAIR/info.json"
    fi
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
    if [ -f "$PAIR/pending.hash" ]; then
        if set_password "$(cat "$PAIR/pending.hash")" > "$PAIR/added" 2>&1; then
            say accepted > "$PAIR/decision"; cat "$PAIR/added"; return 0
        fi
        say failed > "$PAIR/decision"; cat "$PAIR/added" >&2; return 1
    fi
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
# This run's scratch files, even if it stops early
trap 'rm -f "$RUN"/*."$$" "$RUN"/*."$$".tmp 2>/dev/null' EXIT
case "$CMD" in
    status) if [ "${1:-}" = --json ]; then status_json; else status_text; fi ;;
    ssh-on) ssh_on ;;
    fix-keys) fix_keys ;;
    password-on) password_on ;;
    add-key) add_key "${1:-}" ;;
    keys) keys_list "${1:-}" ;;
    backups) backups ;;
    restore) restore "${1:-}" ;;
    pair-start) pair_start "${1:-key}" ;;
    pair-status) pair_status ;;
    pair-accept) pair_accept ;;
    pair-reject) pair_reject ;;
    pair-stop) pair_stop ;;
    key-remove) key_edit remove "${1:-}" ;;
    key-rename) key_edit rename "${1:-}" "${2:-}" ;;
    servers) if [ "${1:-}" = --json ]; then servers_json; echo; else servers_list; fi ;;
    entware) if [ "${1:-}" = --json ]; then ent_json; echo; else ent_text; fi ;;
    settings) if [ "${1:-}" = --json ]; then settings_json; echo; else say "$(dropbear_flags)"; fi ;;
    set-password) set_password "${1:-}" ;;
    clear-password) clear_password ;;
    set-keys-only) set_keys_only "${1:-}" ;;
    set-keepalive) set_keepalive "${1:-}" ;;
    set-port) set_port "${1:-}" ;;
    port-keep) port_keep ;;
    port-revert) port_revert ;;
    reset-settings) reset_settings ;;
    apply) apply force ;;
    boot) boot ;;
    logins) logins "${1:-}" ;;
    hostkeys) hostkeys_cmd "${1:-}" ;;
    hostkeys-reset) hostkeys_reset ;;
    telnet-off) telnet_off ;;
    telnet-on) telnet_on ;;
    report) report ;;
    set-bootfix) set_bootfix "${1:-}" ;;
    kit-save) kit_save "${1:-}" ;;
    kit-list) kit_list "${1:-}" ;;
    kit-restore) kit_restore "${1:-}" ;;
    exposure) exposure "${1:-}" ;;
    exposure-close) exposure_close ;;
    version) say "$VERSION" ;;
    -h|--help|help) sed -n '2,48s/^# \{0,1\}//p' "$0" ;;
    *) die "Unknown command: $CMD (try: sh $0 help)" ;;
esac
