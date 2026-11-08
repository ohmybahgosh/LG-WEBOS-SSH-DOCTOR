# Security policy

SSH Doctor runs as root on your TV and changes how SSH logs in, so security problems matter even for a small app.

## Supported versions

Only the [latest release](https://github.com/ohmybahgosh/LG-WEBOS-SSH-DOCTOR/releases/latest) gets fixes.

## Reporting a problem

Please don't open a public issue for a security problem.  Report it privately through GitHub's [private vulnerability reporting](https://github.com/ohmybahgosh/LG-WEBOS-SSH-DOCTOR/security/advisories/new) instead.

Include what you found, how to reproduce it, and which version you used.  You'll get a reply as soon as possible, and credit in the changelog if you'd like it.

## What it does as root

So you can judge it yourself:

- **Reads** the Homebrew Channel's SSH and telnet switches in `/var/luna/preferences`, `/home/root/.ssh/authorized_keys`, `/etc/shadow` (only whether root has a password), `/proc` (which SSH servers run and on which ports), the TV's own SSH host keys, and webOS's system log for SSH logins.
- **Repairs only when you press a button,** and keeps a dated backup first: the keys file and its permissions, the Homebrew Channel's SSH switch, and its telnet switch.  **Undo a change** puts a backup back.
- **Your own password and Go back to password login** set root's password the way the Homebrew Channel sets `alpine`: a copy of `/etc/shadow` in `/tmp`, bind-mounted over the real one.  The system partition is never written.  Only a SHA-512 crypt hash of your password is ever sent to the TV or kept, in `/var/lib/webosbrew/ssh-doctor/root.hash` (readable by root only).
- **SSH settings** (password, keys only, port, keepalive) are kept in `/var/lib/webosbrew/ssh-doctor`, with one startup script, `/var/lib/webosbrew/init.d/60-ssh-doctor`, that restarts the Homebrew Channel's `dropbear` with them after a restart.  **Reset to Homebrew Channel defaults** removes both.
- **Restarts only the Homebrew Channel's `dropbear`.**  Other SSH servers (Entware's, Developer Mode's) are listed, never changed.  When moving to a new port, the old one stays open until you keep the new one, and if `dropbear` won't start with your settings it's started the Homebrew Channel's usual way instead.
- **The pairing page** runs only while its screen is open on the TV, on port 28622 (or the next free one up to 28631).  It needs the code shown on the TV, gets a new code after 5 wrong tries and closes after three, closes after 5 minutes or one key, and adds nothing until you press OK on the remote.  It takes public keys only (a private key sent by mistake is refused) and password hashes only, and drops any `authorized_keys` options sent with a key.  Keys it makes are made in the browser; the private half never leaves that device.

It downloads nothing, opens no ports except the pairing page while it's on screen, and sends nothing anywhere.

## Verifying a download

Every release has a `SHA256SUMS` file.  Download it next to the IPK and run:

```sh
sha256sum -c SHA256SUMS
```
