# ACME-143: Cache trips in IndexedDB

Type: Sub-task of ACME-142

## Description

Add a `TripCache` on top of the trips store: write a trip through on every successful load, read it first when the network fails. Keep at most 30 days of trips and drop the oldest first.
