export function TripPage({ trip }) {
  const stops = trip.stops;
  return stops.map((s) => s.name).join(', ');
}
