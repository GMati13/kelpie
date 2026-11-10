# ACME-175: Keep trips available offline

Travellers lose signal at airports and abroad. A trip they opened once should open again without a connection.

## What we know

- Trips are loaded by `loadTrip(id)` in `src/trips.js`, from `/api/trips/<id>`.
- Two ways to do it, and they promise users different things:
  1. **Read-only offline copy**: cache each trip as it's opened (a service worker or IndexedDB snapshot). Small, a day or two. Edits made offline are refused with a banner.
  2. **Offline editing with sync**: keep trips in IndexedDB, queue edits made offline and replay them when back online, with a rule for conflicts (another device edited the same trip). A week or more, and support has to explain conflicts.

## Open question

Which of the two we build is a product call, not ours: it changes what we tell users. The assignee asks the person who handed this over before building either.
