# Contributing to LG webOS SSH Doctor

Thanks for helping.  Reports from real TVs, fixes, translations, docs and code are all welcome.

## Reporting how it went on your TV

Reports from real TVs help most, whether SSH Doctor fixed things or not.  In the TV app, choose **More tools**, then **Report for getting help**, and scan the QR code with your phone: the report has no IP addresses, keys or names in it.  Paste it into a [TV report](https://github.com/ohmybahgosh/LG-WEBOS-SSH-DOCTOR/issues/new?template=tv-report.yml), or a [bug report](https://github.com/ohmybahgosh/LG-WEBOS-SSH-DOCTOR/issues/new?template=bug-report.yml) if something's broken.  Over telnet, `sh ssh-doctor.sh report` prints the same thing.

Security problems go privately, see [SECURITY.md](SECURITY.md).  Questions and ideas go to [Discussions](https://github.com/ohmybahgosh/LG-WEBOS-SSH-DOCTOR/discussions) (Q&A and Ideas), not issues.  Please follow the [code of conduct](CODE_OF_CONDUCT.md).

## Working on the code

- `ssh-doctor.sh`: the checks and repairs, one POSIX `sh` file that runs as root under busybox on the TV.
- `webos-app/src/`: the TV app, plain HTML, CSS and ES5 JavaScript for old webOS browsers.
- `pair-server.js`, `pair.html`, `pair.js`, `sshkey.js`, `sha512crypt.js`: the pairing page a phone or computer opens (Node.js on the TV, ES5 in the browser).

```sh
sh tests/run.sh busybox          # the script against a fake TV (also dash and bash)
shellcheck -s sh ssh-doctor.sh tests/fakebin/* webos-app/build.sh
node tests/check-i18n.js         # every text in the TV app translated
sh webos-app/build.sh            # the IPK (needs ares-package from @webos-tools/cli)
node tests/ui-check.js           # TV screens and the pairing page in a browser (Playwright)
```

The tests run the script against a fake TV in a temporary folder (its own `/proc`, `/etc/shadow`, Homebrew Channel and `authorized_keys`), so they need no TV and no root, and change nothing on your machine.

Ground rules:

- **It runs as root on someone's TV, often when they're already locked out.**  Never leave someone with no way in: keep a backup of anything you change, keep **Go back to password login** working, and keep telnet as a way back unless the person turns it off.
- **Only the Homebrew Channel's SSH.**  Detect and check other SSH servers (read-only, like `sshd -T`), never change, start or stop them.  Never write to system partitions: root's password goes through a bind-mounted copy of `/etc/shadow`, the way the Homebrew Channel does it.
- **Passwords never travel or rest in the clear.**  The app and the pairing page turn a password into a SHA-512 crypt hash before it leaves them, and only the hash is stored.
- **POSIX `sh` for busybox, ES5 for the app.**  No bashisms; ShellCheck must pass.
- **A test for every change in behavior,** in `tests/run.sh` (or `tests/ui-check.js` for screens).
- **Translations.**  The TV app speaks English, Russian and Spanish.  New app text needs a translation in each, or `node tests/check-i18n.js` fails.  If you can't translate it, say so in the pull request and the maintainer will.
- **Write for TV owners.**  Plain words, two spaces between sentences, no em dashes, and a line in `CHANGELOG.md` for anything they'd notice.

AI-assisted pull requests are welcome, held to the same standard as the rest of this project (it was built with AI coding agents too): say in the pull request that AI was used, make sure you understand and have reviewed every change, and test it on a real TV.  Coding agents read [AGENTS.md](AGENTS.md) by themselves.

Open a pull request against `main`; the template lists what to check.

## Releases

The maintainer cuts releases by pushing a `v*` tag.  GitHub Actions runs the tests, builds the TV app, publishes the IPK, its Homebrew Channel manifest, `ssh-doctor.sh` and `SHA256SUMS`, and tells ohmybahgosh.dev to refresh its Homebrew Channel repository.
