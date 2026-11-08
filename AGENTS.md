# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot and others) working in this repository.  Read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) too: SECURITY.md lists everything the app is allowed to do as root.

- `ssh-doctor.sh` is plain POSIX `sh` that runs as root under busybox on the TV.  No bashisms (`[[ ]]`, arrays, `local`, `echo -e`), no `A && B || C` (use `if`), and don't let a pipe close early (`head`, or `awk` with `exit`): GitHub's runners ignore SIGPIPE, and the writer's error lands in the output.  Use `awk 'NR == 1'`.
- Everything it reads goes through the paths at the top of the script, so the tests can move them under `SD_ROOT`.  Read `/proc` with one `grep` over the files, never a command per process: it runs on slow, busy TVs.
- Never leave someone without a way in.  Back up anything you change, keep **Go back to password login** working (it also drops keys only and the user's password), and keep the old port open during a port change.  Only the Homebrew Channel's `dropbear` is ever restarted.
- Passwords: only `$6$` SHA-512 crypt hashes, made in the app or the pairing page by `sha512crypt.js`.  The script never sees a password.
- The startup hook runs while the Homebrew Channel's failsafe flag is still set (it clears it 10 seconds after init.d): wait for it, don't treat it as failsafe mode.
- The TV app (`webos-app/src/`) and the pairing page are plain ES5: no `let`, `const`, arrow functions, template literals, `async`, `?.` or `??`.  New app text goes through `T()` with a Russian and Spanish translation in `i18n.js`.
- Text people read: plain words, two spaces between sentences, no em dashes.
- Before you finish: `sh tests/run.sh busybox` (and `dash`, `bash`), ShellCheck, `node tests/check-i18n.js` and `node tests/check-sha512crypt.js .cache/tweetnacl-1.0.3-nacl-fast.min.js` pass, a test covers the change, and `CHANGELOG.md` and `README.md` cover anything a user would notice.
- Don't bump `VERSION`, tag, or publish releases.  The maintainer does that.
- Say in the pull request that AI was used, and test on a real TV (model and webOS version).
