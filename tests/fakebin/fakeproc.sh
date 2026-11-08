# Sourced by the fake servers and the tests: adds a process to the fake /proc
# under $SD_ROOT, listening on the given ports.
#   fake_proc COMM "ARGV0 ARG..." PPID PORT...
fake_proc() {
    _comm=$1; _cmd=$2; _ppid=$3; shift 3
    _pid=4242
    while [ -d "$SD_ROOT/proc/$_pid" ]; do _pid=$((_pid + 1)); done
    _d="$SD_ROOT/proc/$_pid"
    mkdir -p "$_d/fd"
    echo "$_comm" > "$_d/comm"
    printf '%s' "$_cmd" | tr ' ' '\000' > "$_d/cmdline"
    echo "$_pid ($_comm) S $_ppid 1 1 0 -1" > "$_d/stat"
    _n=3
    for _port in "$@"; do
        _inode=$((_pid * 100 + _n))
        ln -s "socket:[$_inode]" "$_d/fd/$_n"
        printf '   0: 00000000:%04X 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 %s 1\n' "$_port" "$_inode" >> "$SD_ROOT/proc/net/tcp"
        _n=$((_n + 1))
    done
    echo "$_pid"
}
# Take a process out of the fake /proc, and its listeners
fake_kill() {
    for _fd in "$SD_ROOT/proc/$1"/fd/*; do
        _l=$(readlink "$_fd" 2>/dev/null) || continue
        _in=${_l#socket:[}; _in=${_in%]}
        grep -v " $_in 1\$" "$SD_ROOT/proc/net/tcp" > "$SD_ROOT/proc/net/tcp.n"; mv "$SD_ROOT/proc/net/tcp.n" "$SD_ROOT/proc/net/tcp"
    done
    rm -rf "${SD_ROOT:?}/proc/$1"
}
