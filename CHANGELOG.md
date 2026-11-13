# Changelog

All notable changes to LG webOS SSH Doctor.  Versions follow [semantic versioning](https://semver.org/).

## [0.5.1] - 2026-11-12

A security review of the whole app, and fixes for what it found.  None of these were reported as used against anyone.

### Security

- **Its working folder in `/tmp` is kept root-only.**  `/tmp` is shared with every program on the TV, and the script runs, mounts and copies files from `/tmp/ssh-doctor` as root: the copy of `/etc/shadow` that sets your password, keys waiting to be added, and the copy of itself that runs an update.  Another program on the TV that got there first (with a link or a folder of its own) could have swapped those files and become root, or added its own key.  Each run now makes sure it's a real folder owned by root that nobody else can open, and moves anything else out of the way first.
- **The pairing page only answers your home network, by the TV's address.**  It listens on IPv4 only, refuses devices outside private and VPN address ranges, answers only when opened by an IP address, `localhost` or a `.local` name (a website can't reach it through a DNS name it controls, called DNS rebinding), refuses requests sent by another site's page, and drops slow or idle connections.  The code was still needed for anything, but a web page could have used up its tries.
- **Updates only install this app's own download for exactly the offered version,** over HTTPS only.  Before, a manifest could point at any of this repository's releases, so a tampered one could have offered an older release as a newer one.  The answer is checked again before it goes to the Homebrew Channel.
- **The router check only follows the router that answered.**  Any device on the network can answer the router search, and could have sent the TV's requests to another machine or to the TV itself.  Answers are size-capped too.
- **Password hashes are limited to 999,999 rounds,** so one sent from the pairing page can't make every login take minutes.
- The release workflow uses exact commits of its GitHub Actions and an exact version of the webOS packaging tool, and no workflow keeps the GitHub token in the checked-out repository.
- [SECURITY.md](SECURITY.md) says all of this, and has a new section on what it can't protect against.

## [0.5.0] - 2026-11-12

### Added

- **Copy it on your phone or computer.**  How to log in, Report for getting help and the TV's key fingerprints show a QR code.  Scanning it opens a read-only page with everything ready to copy, one tap each: the login command for each kind of computer, an Open in an SSH app link for phones, the TV's fingerprints, the line for a changed host key, an SSH config, the keys that can log in, and the report with links to open a bug report or ask a question.  It works on several devices at once and stops when that screen closes.
- The pairing screen's QR code carries the code, so scanning it connects without typing.
- **Update from the app.**  Each time it opens, SSH Doctor checks GitHub for a newer release and offers **Update to v…** with what's new.  It installs through the Homebrew Channel, which checks the download's SHA-256 first, then the app opens again by itself and shows what changed.  More tools, **Updates** checks by hand.
- **File transfer (SFTP)** says how to log in (your key, alpine or your own password) and where WinSCP, FileZilla and Cyberduck take a key, with the QR code to copy it all.

### Changed

- **The TV's address is the main connection's:** the interface with the default route through a gateway comes first, so a wired eth0 shows instead of Wi-Fi kept as a backup.  A 169.254 address (no DHCP answer) is left out.
- **Bigger text in the pop-ups and menus,** easier to read from the couch on any size of TV: tables like SSH servers on this TV and Login history, menu hints, the findings on the main screen, and the code boxes.
- **A new accent color,** teal instead of green, so SSH Doctor doesn't look the same as LG-USB-2-ETH0 next to it.  The icon's plus sign too.

Tested on a real TV (LG C2, webOS 25): a full update from the app (against a stand-in release server: about 2 seconds to install, then the app opened again on what changed), a password set from the phone page and from the TV's keyboard that still worked after a restart, the copy page on a phone, the file transfer hints, the main connection's address with eth0 and Wi-Fi both up, and every pop-up's text size.

## [0.4.0] - 2026-11-12

### Added

- **Fix SSH at startup,** in SSH settings.  After every restart, SSH Doctor checks that SSH came up, starts it if it didn't, and fixes keys file permissions dropbear would refuse.  The main screen says when it had to.  It never touches a port another program has.
- **Reachable from the internet?** in More tools.  Asks the router (UPnP) whether it forwards the TV's SSH or telnet to the internet, every time the app opens, and **Close it on the router** takes those forwards off.  A forwarded telnet port (root with no password) is flagged first.
- **Save or restore my setup** in More tools.  Saves your keys, the TV's own SSH keys, your settings and your password's hash to a USB drive, and puts them back after a factory reset and rooting again, so computers don't warn REMOTE HOST IDENTIFICATION HAS CHANGED.  Everything it replaces is backed up first.
- `set-bootfix`, `exposure`, `exposure-close`, `kit-save`, `kit-list` and `kit-restore` for the script on its own.
- **Get more from SSH,** in More tools, when Entware isn't installed: what Entware adds to an SSH session (bash, tmux, nano, htop and hundreds more) and where to get it.  A one-line pointer shows on the main screen only when there's nothing else to say.

### Fixed

- **Open SSH sessions stay connected through every restart,** not just the first.  After dropbear restarted, its open sessions looked like servers, so the next change (keeping a new port, a setting) closed them, and the status could say SSH was running when only old sessions were left.  Found while testing on a real TV.

### Changed

- The startup script runs the app's own copy of `ssh-doctor.sh` when the app is installed, so an update takes effect at the next restart.
- Long menus get tighter rows so they fit on screen.
- Spanish: the Entware texts from 0.3.0 now use "usted" like the rest of the app.

Tested on a real TV (LG C2, webOS 25): the router check against a real router, Fix SSH at startup with the SSH server stopped by hand and through a real restart, a save and restore of keys, host keys and settings with an SSH session open throughout, and every new screen.

## [0.3.0] - 2026-11-08

### Added

- **Entware's SSH counts as SSH.**  When the Homebrew Channel's SSH is off and Entware's OpenSSH or dropbear answers, the app says so and no longer calls the Homebrew Channel's SSH being off, or Entware's server on port 22, a problem.  The main screen, **How to log in** and the pairing page use Entware's port.
- **Checks for Entware's OpenSSH and dropbear,** read only: settings OpenSSH refuses (with its own error), `PermitRootLogin`, root's password being off in OpenSSH or missing from Entware's own `/opt/etc/shadow`, keys read from another file, missing or empty host keys, a server that's installed but stopped or set to a port that's taken, and Entware not starting at boot.  They're problems when Entware's server is the way in, tips when the Homebrew Channel's works.
- **SSH servers on this TV** also lists Entware servers that are installed but not running, what OpenSSH says is wrong, and how Developer Mode's SSH works (user `prisoner`, port 9922).
- `sh ssh-doctor.sh entware [--json]`, and the report covers Entware's servers (addresses left out).

Nothing changes for Homebrew Channel setups.  The Entware checks are covered by the test suite against a fake TV with Entware's OpenSSH and dropbear; reports from real TVs running Entware's SSH are welcome.

## [0.2.0] - 2026-11-08

### Added

- **SSH settings,** kept after a restart by a small startup script in `/var/lib/webosbrew/init.d`:
  - **Your own password,** typed on the TV or on a phone or computer through the pairing page.  Only a SHA-512 crypt hash is ever sent or kept.
  - **Keys only,** which won't turn on without a key.
  - **SSH port,** with the old port kept open until you've logged in on the new one and keep it.  If dropbear won't start on the new port, SSH goes back to the old one.
  - **Keep idle sessions connected** (a keepalive every 30 seconds), and **Reset to Homebrew Channel defaults.**
- **Keys on this TV** can rename or remove a key, and shows when each one last logged in.
- **More tools:** login history with failed tries and where they came from, the TV's SSH key fingerprints and making new ones, turning telnet off or on, SFTP details, every SSH server on the TV, and a report for getting help with no private details in it.
- **Finds more setups:** Entware's OpenSSH or dropbear, Developer Mode's SSH, another program on the SSH port, empty host key files, settings that weren't applied after a restart, and failed logins.
- The pairing page gives a `~/.ssh/config` entry, the TV's `known_hosts` lines, a Windows Terminal profile and SFTP instructions, and uses the TV's SSH port.

### Changed

- **New icon.**  A bigger, easier to read "ssh" on the dark tile, so it stands out in the TV launcher.
- The main screen is shorter: rarer actions moved to **More tools**, and **Go back to password login** shows up front when you're locked out.
- Checking is faster: the TV's process list is read with one `grep` instead of a command per process.

Tested on a real TV (webOS 25): a port change with both ports open, your own password, keys only and keepalive, all back after a restart, then a reset to the Homebrew Channel's defaults that left the keys file byte for byte the same.

## [0.1.0] - 2026-11-08

### Added

- **The check.**  The TV app shows whether SSH is on in the Homebrew Channel, whether its server is running on port 22, how you log in (the alpine password, keys, or nobody), whether the keys file is usable, whether telnet is there as a way back in, failsafe mode, the TV's address, and its SSH key fingerprints.
- **Repairs, one button each, with backups:** Turn SSH on now (no restart), Fix my keys file (Windows line endings, hidden characters, keys split over lines, PuTTY's key format, private keys pasted by mistake, permissions), Go back to password login (for anyone locked out), and Undo a change.
- **Set up a key with a pairing code.**  The TV shows a QR code, its address on port 28622 and a short code.  The page on a phone or computer takes a public key you have, or makes a new ed25519 key pair in the browser, so the private key never leaves that device.  The key is added only after OK on the remote.  The page closes after one key, 5 wrong codes three times over, 5 minutes, or when the screen closes.
- **How to log in:** the exact `ssh` command, the options older SSH servers need, and what to do about "REMOTE HOST IDENTIFICATION HAS CHANGED".
- English, Russian and Spanish, following the TV's menu language, with a Language row.
- `ssh-doctor.sh` works on its own too, over telnet: `status`, `ssh-on`, `fix-keys`, `password-on`, `add-key`, `keys`, `backups`, `restore`.
