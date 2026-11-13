# Security policy

SSH Doctor runs as root on your TV and changes how SSH logs in, so security problems matter even for a small app.

## Supported versions

Only the [latest release](https://github.com/ohmybahgosh/LG-WEBOS-SSH-DOCTOR/releases/latest) gets fixes.

## Reporting a problem

Please don't open a public issue for a security problem.  Report it privately through GitHub's [private vulnerability reporting](https://github.com/ohmybahgosh/LG-WEBOS-SSH-DOCTOR/security/advisories/new) instead.

Include what you found, how to reproduce it, and which version you used.  You'll get a reply as soon as possible, and credit in the changelog if you'd like it.

## What it does as root

So you can judge it yourself:

- **Reads** the Homebrew Channel's SSH and telnet switches in `/var/luna/preferences`, `/home/root/.ssh/authorized_keys`, `/etc/shadow` (only whether root has a password), `/proc` (which SSH servers run and on which ports), the TV's own SSH host keys, and webOS's system log for SSH logins.  When Entware is installed, it also reads `/opt/etc/ssh` and `/opt/etc/dropbear` (only whether the host key files are empty), Entware's start scripts in `/opt/etc/init.d`, whether root has a password in `/opt/etc/shadow`, and asks Entware's OpenSSH for its settings with `sshd -T`, which only reads them.
- **Repairs only when you press a button,** and keeps a dated backup first: the keys file and its permissions, the Homebrew Channel's SSH switch, and its telnet switch.  **Undo a change** puts a backup back.
- **Your own password and Go back to password login** set root's password the way the Homebrew Channel sets `alpine`: a copy of `/etc/shadow` in `/tmp`, bind-mounted over the real one.  The system partition is never written.  Only a SHA-512 crypt hash of your password is ever sent to the TV or kept, in `/var/lib/webosbrew/ssh-doctor/root.hash` (readable by root only).  Hashes that would take minutes to check at each login (over 999,999 rounds) are refused.
- **SSH settings** (password, keys only, port, keepalive) are kept in `/var/lib/webosbrew/ssh-doctor`, with one startup script, `/var/lib/webosbrew/init.d/60-ssh-doctor`, that restarts the Homebrew Channel's `dropbear` with them after a restart.  **Reset to Homebrew Channel defaults** removes both.
- **Restarts only the Homebrew Channel's `dropbear`.**  Other SSH servers (Entware's, Developer Mode's) are listed and checked, never changed, started or stopped.  When moving to a new port, the old one stays open until you keep the new one, and if `dropbear` won't start with your settings it's started the Homebrew Channel's usual way instead.
- **The pairing page** runs only while its screen is open on the TV, on port 28622 (or the next free one up to 28631).  It needs the code shown on the TV, gets a new code after 5 wrong tries and closes after three, closes after 5 minutes or one key, and adds nothing until you press OK on the remote.  It takes public keys only (a private key sent by mistake is refused) and password hashes only, and drops any `authorized_keys` options sent with a key.  Keys it makes are made in the browser; the private half never leaves that device.  The QR code carries the code after `#` in the address, so it isn't sent to the TV in the request line, and the page removes it from the address bar.  It listens on IPv4 only and answers only devices on your home network (10.x, 172.16-31.x, 192.168.x, and 100.64-127.x for VPNs like Tailscale), only when opened by the TV's IP address, `localhost` or a `.local` name (so a website can't reach it through a DNS name it controls), and refuses requests sent by another site's page.  Slow or idle connections are dropped after 20 seconds.
- **The read-only page** (from How to log in, the report or the TV's keys) uses the same server and code, while that screen is open, for up to 15 minutes.  It shows what that screen does, plus the keys that can log in (fingerprints and names) and the report, and it can't change anything: it refuses keys and passwords.

- **Fix SSH at startup,** when you turn it on, starts the Homebrew Channel's `dropbear` after a restart if it didn't come up, and fixes the keys file's permissions.  It writes what it did to `/var/lib/webosbrew/ssh-doctor/boot.last`.
- **Reachable from the internet?** talks to your router on your home network only: an SSDP search, then UPnP requests for its list of port forwards.  It only follows a description and control address on the home network device that answered the search, over plain HTTP, and reads at most 256 KB of each answer, so another device on the network can't send the TV elsewhere.  **Close it on the router** asks the router to remove the forwards that lead to the TV's SSH or telnet ports, and nothing else.
- **Updates** only install a release whose manifest is signed with the project's release key (below).  The private half is kept off the repository: only the maintainer has it, and GitHub Actions uses it, from an encrypted secret, to sign each release.  So a release or manifest put up by anyone else, or changed after it was signed, isn't installed.  The app checks it with Ed25519 (tweetnacl).
- **Updates** ask GitHub (github.com and api.github.com) for this repository's latest release: its Homebrew Channel manifest and release notes.  Only the IPK at this repository's own release address for exactly that version is installed (so a manifest can't point at another file or offer an older release as a newer one), over HTTPS only, through the Homebrew Channel, which checks it against the SHA-256 in that manifest before installing.  Nothing installs unless you press OK.
- **Save or restore my setup** writes to a USB drive you plugged in (`/tmp/usb`): your keys file, the TV's own SSH host keys (private keys), your settings and your password's hash.  Anyone with that drive could pretend to be your TV to computers that trust it, so keep it safe.  Putting it back keeps a backup of everything it replaces, and a different port is tried like a port change.

- **Its working files** are in `/tmp/ssh-doctor`.  `/tmp` is shared with every program on the TV, so each run makes sure that's a real folder owned by root that nobody else can open, and moves anything else found there out of the way first.  Nothing it runs, mounts or copies as root can be swapped by another program.

It downloads nothing except an update you choose, opens no ports except the pairing page while it's on screen, and sends nothing outside your home network apart from the update check to GitHub.

## Known limits

- Releases are signed by GitHub Actions, so someone who took over the GitHub account behind this repository could change the release workflow and have it sign their own release.  Uploading a file to a release or editing its manifest by hand isn't enough, and the actions the workflow uses are pinned to exact commits.
- Versions before 0.5.2 check an update's SHA-256 but not its signature.
- The Homebrew Channel's telnet lets anyone on your network in as root with no password while it's on.  SSH Doctor shows it, and **Turn telnet off** in More tools closes it once SSH works.
- Anything that can already run commands as root on the TV can change SSH Doctor too.

## Verifying a download

Every release from 0.5.2 on is signed with this key, in [minisign](https://jedisct1.github.io/minisign/)'s format:

```
RWQO4W70hCxwfBnkZTxsuXAwvARiUkxv0tgpXimn2LcrBFHoM5DsT9i3
```

Each file has a `.minisig` next to it.  Download both and run:

```sh
minisign -Vm org.ohmybahgosh.sshdoctor_0.5.2_all.ipk -P RWQO4W70hCxwfBnkZTxsuXAwvARiUkxv0tgpXimn2LcrBFHoM5DsT9i3
```

Every release also has a `SHA256SUMS` file (signed too).  Download it next to the IPK and run:

```sh
sha256sum -c --ignore-missing SHA256SUMS
```
