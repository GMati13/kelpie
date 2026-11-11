export async function loadTrip(id) {
  const r = await fetch(`/api/trips/${id}`);
  if (!r.ok) throw new Error(`Trip ${id} didn't load`);
  return r.json();
}
