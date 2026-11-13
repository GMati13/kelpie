# Product and people

## Who it's for

Kelpie is for anyone who runs Claude agents in Herdr, set up from its profile dialog. It knows nothing about one person's setup:

- Anything that differs per person is a profile setting with a sensible generic default, or a convention that degrades gracefully (a folder named after the ticket key).
- A person's own setup lives in their dotfiles, on top of this repo: their keys, settings, shell, accounts. Notes about one machine go there, not here.
- Flag what's macOS-only or assumed (Keychain sign-in, `~/.claude*` folders) where it matters.
- Every prompt Kelpie sends to an agent is a profile setting, changeable in the profile dialog.

## Designing

- Function first: start from what the person needs to do and make that comfortable; look and motion come second, and only where they help.
- Calm and warm, never noisy: marks instead of words for states, one main action per header, motion only where something is happening.
- Follow the visual kit in `CLAUDE.md` (buttons, marks, icons, dialogs, spacing) rather than inventing new pieces.
- What a person reads is human-readable: plain words, what happened and what to do next. Text cut off mid-line, raw names and silent failures are bugs.
- A skin changes the look only, never the layout's sizes or behaviour.
- Design for every width, a wide screen too: think of how anything new looks stretched across a very wide window as well as on a laptop. Rows, lines and inputs that would run far apart keep to a reading width, centred (`ROWS`, 760, as the subtask rows and the Ask line do), so what belongs together stays together. Check it in the demo at a wide window before calling it done.

## Agents and the person's access

Kelpie tells agents what to do, never how to reach Jira, GitHub or anything else: they use the access their own setup gives them. If an agent can't reach something, that's how it should be; it says so. Kelpie's own plumbing is never offered as a way around it. (Details: `security.md`, Prompts.)

## The demo

`herdr-app do kelpie.demo` builds a profile from `mods/kelpie/demo/demo.json`: every state Kelpie can show, with links that can't reach anyone. Use it to try a change, take screenshots (the README's are of it) and build tests. A new state Kelpie learns to show is added to the fixture.
