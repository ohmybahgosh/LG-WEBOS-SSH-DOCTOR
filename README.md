# LG webOS SSH Doctor: fix SSH on rooted LG TVs

**SSH on your rooted LG TV stopped working?  This app finds out why and fixes it from the TV itself, with just the remote.**  It also sets up an SSH key for your computer or phone with a short pairing code, so nobody has to copy keys around by hand.

> **Status: in development.**  Nothing to install yet.  Watch or star the repo to hear when the first version is out.

It's a TV app for the [webOS Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) on rooted LG webOS TVs ([RootMyTV](https://rootmy.tv), [faultmanager-autoroot](https://github.com/throwaway96/faultmanager-autoroot), crashd, DejaVuln and the rest).  It runs as root through the Homebrew Channel, not over SSH, so it still works when SSH is completely broken.

## Sound familiar?

- `ssh: connect to host 192.168.1.50 port 22: Connection refused`
- `Permission denied (publickey)` after adding a key, and now the `alpine` password doesn't work either
- PuTTY: `Network error: Connection refused` or `No supported authentication methods available`
- `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!` after a reset
- `no matching host key type found` on a newer computer
- Dev Manager asks for a key and passphrase you never set up
- SSH was on in the Homebrew Channel, but nothing answers on port 22

These are the common ways SSH breaks on a rooted LG TV, and none of them needs a factory reset.

## What it will do

**Check.**  Opening the app shows, in plain words, everything that decides whether you can log in:

- whether SSH is turned on in the Homebrew Channel, and whether the SSH server (dropbear) is actually running and listening on port 22
- whether password login (`alpine`) is on, or keys only
- whether `/home/root/.ssh/authorized_keys` is usable: not empty, no Windows line endings or hidden characters, no private key pasted by mistake, no key wrapped across lines, with the right owner and permissions on the file and its folder
- whether telnet is on as a way back in, and whether the TV is in Homebrew Channel failsafe mode
- the TV's IP address, the exact command to log in with, and the TV's SSH key fingerprint, so a "host identification has changed" warning can be checked instead of guessed at

**Repair, one button each.**  Each says what it will change, keeps a dated backup, and can be undone:

- **Turn SSH on now,** without the reboot the Homebrew Channel toggle needs
- **Fix my keys file:** line endings, hidden characters, wrapped keys and permissions.  Bad lines are moved to a side file, never deleted
- **Go back to password login:** sets `authorized_keys` aside and turns the `alpine` password back on right away, for anyone locked out

**Set up a key with a pairing code:**

1. Choose **Set up a key** on the TV.  It shows a QR code, a web address, and a short code like `K7F-3QX`.
2. Scan the QR code or type the address on the computer or phone you'll log in from, and enter the code.
3. Upload the public key you already have, or let your browser make a new key pair.  The private key is saved on your device and never sent anywhere.  Only the public half goes to the TV.
4. Confirm on the TV with OK.  The page then shows the exact `ssh` command, or the PuTTY settings for Windows, and the TV checks that the key works before it's done.

The pairing page only runs while that screen is open, and closes after one key, a few wrong codes, or 5 minutes.

## What it will never do

Touch system partitions, change the Homebrew Channel's own files, turn telnet off, or send your keys anywhere.  It warns before anything that would turn password login off, because adding the first key disables `alpine` at the next boot, and that catches a lot of people out.

## Languages

English, Russian and Spanish, following the TV's menu language, like [LG-USB-2-ETH0](https://github.com/ohmybahgosh/LG-USB-2-ETH0).

## More from OhMyBahGosh

- [LG-USB-2-ETH0](https://github.com/ohmybahgosh/LG-USB-2-ETH0): use a USB Ethernet adapter as the TV's wired port
- [ohmybahgosh.dev](https://ohmybahgosh.dev): all the webOS projects, and a Homebrew Channel repository to install them from

## License

MIT.  Not affiliated with LG Electronics.  LG and webOS are trademarks of their owners.
