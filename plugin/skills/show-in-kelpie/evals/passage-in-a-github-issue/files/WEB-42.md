# WEB-42: Export a trip as a PDF

GitHub issue acme/web#42, on the team's GitHub Project (status: In progress). Kelpie's key for it is WEB-42: the repo's prefix and the issue's number.
Sub-issues: WEB-43 (Render the itinerary page), WEB-44 (Add the Export button)

## Description

Travellers want a copy of their trip they can print or forward without the app. Support keeps sending screenshots by hand.

### What we want

- An **Export as PDF** button on the trip screen
- The PDF lists every stop with its times, address and booking reference
- Large trips (over 40 stops) still export, split across pages

### Errors

If the export fails, keep the traveller on the trip screen and show "We couldn't make the PDF. Try again in a moment." with a Retry button. Never download a half-written file.

### Done when

- [ ] A 3-stop trip exports in under 2 seconds
- [ ] A 60-stop trip exports, paged
- [ ] A failed export leaves no file behind
