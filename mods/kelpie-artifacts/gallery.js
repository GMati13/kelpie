// How the gallery is arranged: pure logic, no drawing.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEFAULT_ASPECT = 1.6; // until an image's real shape is known

export function dayLabel(mtime, now = new Date()) {
  const d = new Date(mtime * 1000);
  const dayStart = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((dayStart(now) - dayStart(d)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${d.getFullYear() === now.getFullYear() ? "" : `, ${d.getFullYear()}`}`;
}

// Consecutive items of the same day, in the order given.
export function byDay(items, now = new Date()) {
  const days = [];
  for (const item of items) {
    const label = dayLabel(item.mtime, now);
    if (days.at(-1)?.label === label) days.at(-1).items.push(item);
    else days.push({ label, items: [item] });
  }
  return days;
}

// Justified rows: each image keeps its shape, and every row but the last exactly fills the width.
export function justify(items, room, target, gap, aspectOf) {
  const rows = [];
  let row = [];
  let sum = 0;
  const close = (height) => {
    rows.push({ height, tiles: row.map((item) => ({ item, width: aspect(item) * height })) });
    row = [];
    sum = 0;
  };
  const aspect = (item) => aspectOf(item) ?? DEFAULT_ASPECT;
  for (const item of items) {
    row.push(item);
    sum += aspect(item);
    const space = room - gap * (row.length - 1);
    if (sum * target >= space) close(space / sum);
  }
  if (row.length) close(target);
  return rows;
}

// A PNG states its size in its header. Other formats answer null.
export function pngAspect(bytes) {
  if (!bytes || bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const at = (i) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
  const width = at(16);
  const height = at(20);
  return width && height ? width / height : null;
}

// The filmstrip's window: up to `count` items around the current one, staying full at the ends.
export function stripWindow(length, at, count) {
  const size = Math.min(length, Math.max(1, count));
  const start = Math.max(0, Math.min(length - size, at - Math.floor(size / 2)));
  return { start, end: start + size };
}

// Which item an arrow key lands on, given the rows as drawn. `rows` holds rows of item keys.
export function moveSelection(rows, key, direction) {
  const flat = rows.flat();
  if (!flat.length) return null;
  const at = flat.indexOf(key);
  if (at < 0) return flat[0];
  if (direction === "left") return flat[Math.max(0, at - 1)];
  if (direction === "right") return flat[Math.min(flat.length - 1, at + 1)];
  const r = rows.findIndex((row) => row.includes(key));
  const target = rows[r + (direction === "up" ? -1 : 1)];
  if (!target) return key;
  const share = rows[r].indexOf(key) / Math.max(1, rows[r].length - 1);
  return target[Math.round(share * (target.length - 1))];
}

// What was made in the last few minutes on its own, then everything older by day.
const LATEST_MINUTES = 10;

export function sections(items, now = new Date()) {
  const cutoff = now.getTime() / 1000 - LATEST_MINUTES * 60;
  const recent = items.filter((item) => item.mtime >= cutoff);
  const older = byDay(items.filter((item) => item.mtime < cutoff), now);
  return recent.length ? [{ label: "Latest", items: recent }, ...older] : older;
}
