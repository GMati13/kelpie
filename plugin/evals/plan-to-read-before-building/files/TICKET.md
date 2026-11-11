# ACME-177: Export a trip as a PDF

Travellers want to print their trip or send it to someone without the app: a PDF with the stops, times and bookings.

## What we know

- Trips are loaded by `loadTrip(id)` in `src/trips.js`.
- Nothing in the app makes PDFs yet.

## Before building

Write a short plan first: how the PDF gets made (in the browser or on the server, and with what), where the Export button goes, and what the PDF shows. The person who handed this over reads the plan and says go before any code is written.
