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
