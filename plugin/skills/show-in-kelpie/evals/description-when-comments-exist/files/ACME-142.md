# ACME-142: Offline mode for saved trips

Type: Story
Subtasks: ACME-143 (Cache trips in IndexedDB), ACME-144 (Queue offline edits and sync them back), ACME-145 (Design the offline banner)

## Description

Travellers open saved trips on planes, trains and in roaming dead zones. Today the trip screen shows a spinner and then an error when there's no network, even for trips that were opened a minute ago.

## What we want

Saved trips open instantly from the device, and changes made offline (notes, reordered stops, a new booking) are kept and synced once the connection is back.

- Cache every trip the traveller opened in the last 30 days in `IndexedDB`
- Queue edits made offline and replay them in order
- Show a calm banner while offline, never a blocking error

## Out of scope

Downloading map tiles: that's ACME-190.

## Done when

1. A trip opened once opens again in airplane mode, within 300 ms
2. An edit made offline shows on another device a minute after going back online
3. Conflicts keep the newest change and say so in the trip's history

## Comments

**Tomás Ruiz**, 3 days ago:
Should the banner say how long ago the trip was saved? Travellers asked for that in the last study.

**Priya Nair**, 2 days ago:
Yes, but keep it short: "Saved 2h ago". No dates.

**Lena Fischer**, 1 day ago:
Product call: map tiles stay out of this story, they're **ACME-190**. Offline maps would double the cache size.

**Priya Nair**, 5 hours ago:
Scope change after today's review: conflicts keep the newest change, and the trip's history says which edit won.

- No merge dialog for now
- Keep the losing edit in `tripHistory` so it can be put back
