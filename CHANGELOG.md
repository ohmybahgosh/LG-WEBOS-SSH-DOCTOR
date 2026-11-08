# Changelog

All notable changes to LG webOS SSH Doctor.  Versions follow [semantic versioning](https://semver.org/).

## [Unreleased]

### Added

- **Entware's SSH counts as SSH.**  When the Homebrew Channel's SSH is off and Entware's OpenSSH or dropbear answers, the app says so and no longer calls the Homebrew Channel's SSH being off, or Entware's server on port 22, a problem.  The main screen, **How to log in** and the pairing page use Entware's port.
- **Checks for Entware's OpenSSH and dropbear,** read only: settings OpenSSH refuses (with its own error), `PermitRootLogin`, root's password being off in OpenSSH or missing from Entware's own `/opt/etc/shadow`, keys read from another file, missing or empty host keys, a server that's installed but stopped or set to a port that's taken, and Entware not starting at boot.  They're problems when Entware's server is the way in, tips when the Homebrew Channel's works.
- **SSH servers on this TV** also lists Entware servers that are installed but not running, what OpenSSH says is wrong, and how Developer Mode's SSH works (user `prisoner`, port 9922).
- `sh ssh-doctor.sh entware [--json]`, and the report covers Entware's servers (addresses left out).

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
