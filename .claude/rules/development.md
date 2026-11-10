# Developing Kelpie

How to work on this repo. `CLAUDE.md` is the reference for how each part works; these rules are how to change it. Keep both true: when you change how something works, update the `CLAUDE.md` passage about it in the same commit.

## Before you change anything

- Read the `CLAUDE.md` passage for the part you're touching, and the code around it. Follow the patterns already there (naming, comment style: why, not what; shared state through `setShared`, never module variables, as every copy of a mod shares one context).
- Keep a change minimal and focused. No drive-by refactors, no renames unless asked.
- Kelpie is a product for anyone (see the top of `CLAUDE.md` and `product.md`): nothing personal, no company, account, path or tool of one person in code, docs, prompts or tests.

## Seeing a change working

Herdr runs the mods from `~/.config/herdr-app/mods/` (links into this repo). After editing:

1. `node --check --input-type=module < file.js` for each JS file touched; `sh -n` for scripts; `python3 -m py_compile` for Python.
2. `./test.sh` (or `./test.sh js` / `./test.sh py` while working): all tests pass (`testing.md`).
3. `herdr-app check mods/kelpie` (and `mods/kelpie-artifacts` if touched).
4. Re-create the mod's link so Herdr's hot reload notices: `ln -sfn "$PWD/mods/kelpie" ~/.config/herdr-app/mods/kelpie`. Without it, Herdr keeps running the old code and you'll test the wrong thing.
5. `herdr-app status`: no errors. Then look at it: `herdr-app shot` (only the last frame Herdr drew; a hidden window doesn't redraw) or, for the macOS window buttons, `screencapture -o -l<window id>`. Never claim something works without having seen it or tested it.

Many hot reloads in a row can run Herdr's mod engine out of memory (`herdr-app status` says so); only a Herdr restart clears it.

## Not disturbing the person

The person works in the same Herdr while you develop. Their windows, spaces and agents are real.

- Test in the demo (`herdr-app do kelpie.demo`, ideally in a second Herdr window with its own `HERDR_APP_HOME`), never on their profiles or stories. Remove it afterwards (`kelpie.demo-remove`). `scripts/e2e-demo.sh` does all of that in a throwaway home, but its demo spaces show in their window too: run it only with their OK.
- `layout.switch` closes their open Herdr windows: say so before you do it.
- Put back what you changed to drive the UI: profile, panel, sidebar width, the shown space.
- Never `hc kill`, `hc rm`, close a space or send to an agent you didn't create. Spaces live in herdr-core and show in every Herdr window.
- A Herdr layout file a shown slot depends on can be rewritten by Herdr when its terminal ends (see `CLAUDE.md`, Web panel): restore from git.

## Git

- Commit format: `[scope] description`, scopes `kelpie`, `skins`, `artifacts`, `docs`, `tests`; lowercase, starting with a verb. The body says why. Small, atomic commits that each build and pass `./test.sh`.
- Commit or push only when the person asks. Never force-push or rewrite history without their explicit yes for that push.
- Before committing: `./test.sh` passes, the mod check passes, you've read the whole diff, and `CLAUDE.md` matches what you changed. The pre-commit hook runs `./test.sh` once enabled (`git config core.hooksPath scripts`); never skip it with `--no-verify`.
- A shared file touched by unrelated changes (`CLAUDE.md`, `config.js`, `stories.js`): commit each change with its own part of the file, not everything in one commit.

## Writing for people

Everything a person reads (UI text, notes, toasts, dialogs, the README, guides, commit messages) is plain, human-readable English: short sentences, the person's words, not the code's. No internal names in what the UI says. A message says what happened and what to do next.
