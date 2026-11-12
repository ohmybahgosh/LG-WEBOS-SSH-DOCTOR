<div align="center">

<img src="webos-app/src/icon160.png" width="96" alt="">

# LG webOS SSH Doctor: fix SSH on rooted LG TVs

[![CI](https://github.com/ohmybahgosh/LG-WEBOS-SSH-DOCTOR/actions/workflows/ci.yml/badge.svg)](https://github.com/ohmybahgosh/LG-WEBOS-SSH-DOCTOR/actions/workflows/ci.yml)
[![Release](https://ohmybahgosh.dev/badges/ssh-doctor-release.svg)](https://github.com/ohmybahgosh/LG-WEBOS-SSH-DOCTOR/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Homebrew Channel](https://img.shields.io/badge/Homebrew%20Channel-ohmybahgosh.dev%2Frepo-3ddc97)](https://ohmybahgosh.dev/ssh-doctor/#homebrew)
[![Project page](https://img.shields.io/badge/ohmybahgosh.dev-project%20page-3ddc97)](https://ohmybahgosh.dev/ssh-doctor/)

</div>

**SSH on your rooted LG TV stopped working?  This app finds out why and fixes it from the TV itself, with just the remote.**  It also sets up an SSH key for your computer or phone with a short pairing code, so nobody has to copy keys around by hand, and lets you set your own root password, move SSH to another port or switch to keys only, all kept after a restart.

## Install

In the Homebrew Channel, add the repository `https://ohmybahgosh.dev/repo` (Settings, then Add repository), then install **SSH Doctor** from the app list.  Or download the IPK from the [latest release](https://github.com/ohmybahgosh/LG-WEBOS-SSH-DOCTOR/releases/latest) and install it with Dev Manager or `ares-install`.  It needs root, which the Homebrew Channel already has.

It's a TV app for the [webOS Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) on rooted LG webOS TVs ([RootMyTV](https://rootmy.tv), [faultmanager-autoroot](https://github.com/throwaway96/faultmanager-autoroot), crashd, DejaVuln and the rest).  It runs as root through the Homebrew Channel, not over SSH, so it still works when SSH is completely broken.

## Sound familiar?

- `ssh: connect to host 192.168.1.50 port 22: Connection refused`
- `Permission denied (publickey)` after adding a key, and now the `alpine` password doesn't work either
- PuTTY: `Network error: Connection refused` or `No supported authentication methods available`
- `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!` after a reset
- `no matching host key type found` on a newer computer
- Dev Manager asks for a key and passphrase you never set up
- SSH was on in the Homebrew Channel, but nothing answers on port 22
- You want a real password instead of `alpine`, or SSH on a port other than 22, and don't know where dropbear's settings are (it has no settings file)

These are the common ways SSH breaks on a rooted LG TV, and none of them needs a factory reset.

## What it will do

**Check.**  Opening the app shows, in plain words, everything that decides whether you can log in:

- whether SSH is turned on in the Homebrew Channel, and whether the SSH server (dropbear) is actually running and listening on its port
- every SSH server on the TV: the Homebrew Channel's dropbear, Entware's OpenSSH or dropbear, Developer Mode's (port 9922), or something else, and whether another program has taken the SSH port
- whether password login (`alpine`) is on, or keys only
- whether `/home/root/.ssh/authorized_keys` is usable: not empty, no Windows line endings or hidden characters, no private key pasted by mistake, no key wrapped across lines, with the right owner and permissions on the file and its folder
- whether telnet is on as a way back in, and whether the TV is in Homebrew Channel failsafe mode
- the TV's IP address, the exact command to log in with, and the TV's SSH key fingerprint, so a "host identification has changed" warning can be checked instead of guessed at
- whether the TV's own SSH keys are broken (an empty key file stops dropbear from starting), and recent failed logins

**Use Entware's SSH instead?**  When the Homebrew Channel's SSH is off and Entware's OpenSSH or dropbear answers, SSH Doctor treats that as your SSH, not as a problem, and checks it too, without changing it:

- whether OpenSSH accepts its settings (`sshd -T`), and what it says is wrong when it doesn't
- whether root can log in at all (`PermitRootLogin`), and whether it takes a password: OpenSSH turns root's password off by default, and Entware's programs use their own password file, `/opt/etc/shadow`, not the `alpine` one
- whether it reads the same keys file, so **Set up a key** works for it (the pairing page then gives Entware's port)
- missing or empty host keys, a server that's installed but not running, one set to a port another server already has, and Entware not being started at boot

![The check, on a TV whose keys file needs fixing](assets/screenshots/tv-messy.png)

**Repair, one button each.**  Each says what it will change, keeps a dated backup, and can be undone with **Undo a change**:

- **Turn SSH on now,** without the reboot the Homebrew Channel toggle needs
- **Fix my keys file:** line endings, hidden characters, wrapped keys and permissions.  Bad lines are moved to a side file, never deleted
- **Go back to password login:** sets `authorized_keys` aside and turns the `alpine` password back on right away, for anyone locked out (it also undoes keys only and your own password)
- **Repair the TV's SSH keys** when one is broken, and **Put my settings back** if SSH was restarted without them

**Set up a key with a pairing code:**

1. Choose **Set up a key** on the TV.  It shows a QR code, a web address on port 28622 (like `http://192.168.1.50:28622`), and a short code like `K7F-3QX`.
2. Scan the QR code or type the address on the computer or phone you'll log in from, and enter the code.
3. Upload the public key you already have, or let your browser make a new key pair.  The private key is saved on your device and never sent anywhere.  Only the public half goes to the TV.
4. Check that the fingerprint on the TV matches the one on the page, and press OK.  The page then shows the exact command for Mac, Linux, Windows or PuTTY, or how to add it to a phone app like Termius.

The pairing page only runs while that screen is open.  It closes after one key, after 5 minutes, or when the screen closes.  Five wrong codes get a new code, and three rounds of that close the page.  It only accepts public keys: a private key sent by mistake is refused.  Keys made in the browser use [TweetNaCl](https://tweetnacl.js.org) and the browser's own random numbers, and come out in OpenSSH's format, the same as `ssh-keygen -t ed25519`.

<p><img src="assets/screenshots/tv-pair.png" width="70%" alt="The TV's pairing screen: a QR code, the address and the code K7F-3QX"> <img src="assets/screenshots/pair-phone.png" width="24%" alt="The pairing page on a phone: make a key, or send one you have"></p>

**SSH settings.**  dropbear has no settings file: its options are set when it starts, and the Homebrew Channel starts it with none.  SSH Doctor keeps your settings in `/var/lib/webosbrew/ssh-doctor` and adds a small startup script to `/var/lib/webosbrew/init.d` (the Homebrew Channel runs those after it starts SSH), which restarts dropbear with them after every reboot.  Open sessions stay connected while it does.

- **Your own password,** typed on the TV with the on-screen keyboard, or on your phone or computer through the pairing page.  Either way it's turned into a SHA-512 crypt hash first (the `$6$` kind `/etc/shadow` uses), so the password itself is never sent over your network or saved on the TV.  It's applied the way the Homebrew Channel applies `alpine`: a bind-mounted copy of `/etc/shadow`, so the system partition isn't touched.
- **Keys only:** passwords stop logging in.  It won't turn on until a key is on the TV, and **Go back to password login** turns it off again if you lose the key.
- **SSH port:** pick 2222, 22022 or any free port from 1024 up.  The old port stays open alongside the new one until you've logged in on the new one and keep it, so a typo can't lock you out.  If dropbear won't start on the new port, it goes straight back to the old one.
- **Keep idle sessions connected:** a keepalive every 30 seconds, so routers don't drop quiet sessions.
- **Fix SSH at startup:** after every restart, checks that SSH came up and starts it if it didn't, and fixes keys file permissions dropbear would refuse.  The main screen says when it had to.  It never touches a port another program has.
- **Reset to Homebrew Channel defaults** removes all of it, the startup script too.

<p><img src="assets/screenshots/tv-settings-main.png" width="49%" alt="The main screen with a port change underway, a password of your own and keepalive on"> <img src="assets/screenshots/tv-settings.png" width="49%" alt="The SSH settings menu: your own password, keys only, SSH port, keepalive"></p>

**Keys on this TV** lists each key with its name, fingerprint and when it last logged in, and lets you rename or remove one (with a backup, so **Undo a change** can put it back).

**More tools:**

- **Login history:** recent logins and failed tries from the TV's own log, with where they came from, and a warning when failed tries come from outside your home network
- **This TV's SSH keys:** fingerprints to check a first login against, or make new ones
- **Telnet:** turn the Homebrew Channel's passwordless telnet off once SSH works (or back on)
- **File transfer (SFTP):** WinSCP, FileZilla and Cyberduck work with the Homebrew Channel's `sftp-server`; this shows the details to log in with
- **Reachable from the internet?** asks your router (UPnP, the way games and apps open ports) whether it forwards the TV's SSH or telnet to the internet, and **Close it on the router** takes those forwards off.  It checks by itself each time the app opens.  Routers with UPnP off don't answer, and forwards set up by hand in the router usually aren't listed
- **Save or restore my setup:** saves your keys, the TV's own SSH keys, your settings and your password's hash to a USB drive, and puts them back after a factory reset and rooting again, so logins work as before and computers don't warn REMOTE HOST IDENTIFICATION HAS CHANGED.  The TV's SSH keys are private, so keep the drive safe
- **Get more from SSH:** when [Entware](https://ohmybahgosh.dev/webos-entware-installer/) isn't installed, what it adds to an SSH session (bash, tmux, nano, htop, git and hundreds more packages) and where to get it
- **SSH servers on this TV,** and a **report for getting help** with no addresses, keys or names in it, as a QR code you can scan and paste into a GitHub issue

<p><img src="assets/screenshots/tv-logins.png" width="70%" alt="Login history: logins by key and password, and failed tries with where they came from"> <img src="assets/screenshots/pair-phone-password.png" width="24%" alt="The pairing page on a phone, setting the TV's password"></p>

After a key is added, the pairing page also offers a ready-made `~/.ssh/config` entry (so `ssh lgtv` just works), the `known_hosts` lines for the TV, a Windows Terminal profile, and SFTP and `scp` instructions.

**Updates.**  Each time it opens, SSH Doctor checks GitHub for a newer release.  **Update to v…** shows what's new, installs it through the Homebrew Channel (which checks the download's SHA-256 first), and the app opens again by itself to show what changed.  Or check by hand in More tools, **Updates**.

**Copy it on your phone or computer.**  **How to log in**, **Report for getting help** and the TV's key fingerprints each show a QR code beside them.  Scan it and a page opens on your phone with everything ready to copy, one tap each: the login command for Mac, Linux, Windows, PuTTY or SFTP, an **Open in an SSH app** link for Termius and the like, the TV's fingerprints, the `ssh-keygen -R` line for a changed host key, an SSH config, the keys that can log in, and the report with links to open a bug report.  On a computer, type the address and the code instead.  It's read only, works on several devices at once, and stops when you close that screen on the TV.  The QR code on the pairing screen carries its code too, so scanning connects straight away.

<p><img src="assets/screenshots/tv-howto.png" width="70%" alt="How to log in on the TV, with a QR code to copy it on a phone"> <img src="assets/screenshots/info-phone.png" width="24%" alt="The copy page on a phone: the login command, an SSH config and the TV's known_hosts lines, each with a Copy button"></p>

<p><img src="assets/screenshots/tv-sftp.png" width="49%" alt="File transfer (SFTP): the host, port and user, whether to use your key or password, and where WinSCP, FileZilla and Cyberduck take a key"> <img src="assets/screenshots/tv-update.png" width="49%" alt="The main screen offering Update to v0.5.0"></p>

## What it will never do

Touch system partitions, change the Homebrew Channel's own files, change another SSH server than the Homebrew Channel's, turn telnet off unless you ask, or send your keys or password anywhere.  It warns before anything that would turn password login off, because adding the first key disables `alpine` at the next boot, and that catches a lot of people out.

## Over telnet

`ssh-doctor.sh` also works on its own, which helps when telnet is the only way in.  It's inside the app at `/media/developer/apps/usr/palm/applications/org.ohmybahgosh.sshdoctor/assets/ssh-doctor.sh`:

```sh
sh ssh-doctor.sh status        # what's wrong, in plain words
sh ssh-doctor.sh ssh-on        # turn SSH on and start it now
sh ssh-doctor.sh fix-keys      # repair authorized_keys and its permissions
sh ssh-doctor.sh password-on   # back to user root, password alpine
sh ssh-doctor.sh add-key FILE  # add one public key
sh ssh-doctor.sh keys          # the keys that can log in, with fingerprints
sh ssh-doctor.sh restore NAME  # put a backup back (see: sh ssh-doctor.sh backups)
sh ssh-doctor.sh servers       # every SSH server on the TV, and its ports
sh ssh-doctor.sh entware       # Entware's OpenSSH and dropbear, checked
sh ssh-doctor.sh set-bootfix on          # check SSH at every start
sh ssh-doctor.sh exposure      # does the router forward SSH or telnet?  exposure-close
sh ssh-doctor.sh kit-save      # save to a USB drive; kit-list, kit-restore NAME
sh ssh-doctor.sh set-port 2222 # move SSH; then: port-keep, or port-revert
sh ssh-doctor.sh set-keys-only on        # or off; also: set-keepalive on|off
sh ssh-doctor.sh set-password '$6$...'   # a hash, e.g. from: openssl passwd -6
sh ssh-doctor.sh reset-settings          # back to the Homebrew Channel's defaults
sh ssh-doctor.sh logins        # recent logins and failed tries
sh ssh-doctor.sh update-check  # a newer release?  update-install gets it
sh ssh-doctor.sh changes       # what changed in this version
sh ssh-doctor.sh report        # a report for asking for help
```

`sh ssh-doctor.sh help` lists everything.

## Languages

English, Russian and Spanish, following the TV's menu language, like [LG-USB-2-ETH0](https://github.com/ohmybahgosh/LG-USB-2-ETH0).

## Development

The script is POSIX `sh` for busybox; the TV app and pairing page are plain ES5 JavaScript for old webOS browsers.  Everything is tested without a TV:

```sh
sh tests/run.sh busybox          # the script against a fake TV (also dash and bash)
node tests/check-i18n.js         # every text translated
sh webos-app/build.sh            # the IPK (needs ares-package from @webos-tools/cli)
node tests/check-sshkey.js .cache/tweetnacl-1.0.3-nacl-fast.min.js   # browser-made keys work with ssh-keygen
node tests/check-sha512crypt.js .cache/tweetnacl-1.0.3-nacl-fast.min.js   # password hashes match glibc crypt()
node tests/ui-check.js           # TV screens and the pairing page in a browser (Playwright)
```

## Help and contributing

- **How-tos and error messages:** the [wiki](https://github.com/ohmybahgosh/LG-WEBOS-SSH-DOCTOR/wiki) walks through every screen and the common SSH errors ([Troubleshooting](https://github.com/ohmybahgosh/LG-WEBOS-SSH-DOCTOR/wiki/Troubleshooting)).
- **Stuck?**  Ask in [Discussions > Q&A](https://github.com/ohmybahgosh/LG-WEBOS-SSH-DOCTOR/discussions/new?category=q-a).  [SUPPORT.md](.github/SUPPORT.md) lists where everything goes.
- **Something broken?**  Open a [bug report](https://github.com/ohmybahgosh/LG-WEBOS-SSH-DOCTOR/issues/new?template=bug-report.yml) with the app's **Report for getting help**.
- **Tried it on your TV?**  A [TV report](https://github.com/ohmybahgosh/LG-WEBOS-SSH-DOCTOR/issues/new?template=tv-report.yml) helps, whether it worked or not.
- **An idea?**  [Discussions > Ideas](https://github.com/ohmybahgosh/LG-WEBOS-SSH-DOCTOR/discussions/new?category=ideas).
- **Security problem?**  Report it [privately](https://github.com/ohmybahgosh/LG-WEBOS-SSH-DOCTOR/security/advisories/new).  [SECURITY.md](SECURITY.md) lists everything the app does as root.
- **Code, docs or a translation?**  See [CONTRIBUTING.md](CONTRIBUTING.md).  AI-assisted pull requests are welcome; coding agents read [AGENTS.md](AGENTS.md).

## More from OhMyBahGosh

- [LG-USB-2-ETH0](https://github.com/ohmybahgosh/LG-USB-2-ETH0): use a USB Ethernet adapter as the TV's wired port
- [ohmybahgosh.dev](https://ohmybahgosh.dev): all the webOS projects, and a Homebrew Channel repository to install them from

## License

MIT.  Not affiliated with LG Electronics.  LG and webOS are trademarks of their owners.
