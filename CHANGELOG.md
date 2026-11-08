# Changelog

All notable changes to LG webOS SSH Doctor.  Versions follow [semantic versioning](https://semver.org/).

## [0.1.0] - unreleased

### Added

- **The check.**  The TV app shows whether SSH is on in the Homebrew Channel, whether its server is running on port 22, how you log in (the alpine password, keys, or nobody), whether the keys file is usable, whether telnet is there as a way back in, failsafe mode, the TV's address, and its SSH key fingerprints.
- **Repairs, one button each, with backups:** Turn SSH on now (no restart), Fix my keys file (Windows line endings, hidden characters, keys split over lines, PuTTY's key format, private keys pasted by mistake, permissions), Go back to password login (for anyone locked out), and Undo a change.
- **Set up a key with a pairing code.**  The TV shows a QR code, its address on port 28622 and a short code.  The page on a phone or computer takes a public key you have, or makes a new ed25519 key pair in the browser, so the private key never leaves that device.  The key is added only after OK on the remote.  The page closes after one key, 5 wrong codes three times over, 5 minutes, or when the screen closes.
- **How to log in:** the exact `ssh` command, the options older SSH servers need, and what to do about "REMOTE HOST IDENTIFICATION HAS CHANGED".
- English, Russian and Spanish, following the TV's menu language, with a Language row.
- `ssh-doctor.sh` works on its own too, over telnet: `status`, `ssh-on`, `fix-keys`, `password-on`, `add-key`, `keys`, `backups`, `restore`.
