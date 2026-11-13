// How much work the sidebar's To do and In progress hold, by their tickets' time estimates, and
// whether it fits the time left in the sprint (issue #90). Time estimates only: story points can't be
// weighed against hours, so a board that estimates only in points shows nothing extra.
//   A ticket's estimate: Jira's remaining (`timeestimate`) first, else its original
//   (`timeoriginalestimate`), both in seconds. A GitHub Project has none of its own (not read yet).
//   What a story counts: only work not done and not at or past the handover column. Its own estimate
//   when it has one, else the sum of its unfinished subtasks of yours (the sidebar is about your part),
//   so nothing is counted twice.
//   The time left: the working days (Monday to Friday) from today, today included, to the sprint's
//   last day, times the board's hours a day (`hoursPerDay`, default DEFAULT_HOURS). No end date (a
//   Kanban board, a Project with no iteration field): the sum alone.

// Nobody spends a whole day on ticket work, so the default day is shorter than an office's.
export const DEFAULT_HOURS = 6;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

// A ticket's time estimate in seconds, from its fields as the board gave them; null without one.
export function estimateOf(f) {
  for (const v of [f?.timeestimate, f?.timeoriginalestimate]) if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  return null;
}

// A time in hours and minutes, never days or weeks: "45m", "6h", "6h 30m", "38h". Rounded to the
// minute; minutes left out when zero.
export function hoursText(seconds) {
  const all = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(all / 60), m = all % 60;
  if (!h && m) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// The board's hours a day of ticket work: its `hoursPerDay` (a number, more than 0 and at most 24),
// else DEFAULT_HOURS.
export function hoursPerDay(board) {
  const v = board?.cfg?.hoursPerDay;
  return typeof v === "number" && v > 0 && v <= 24 ? v : DEFAULT_HOURS;
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// A Jira sprint's last day ("YYYY-MM-DD", where the person is) from its `endDate`; one that ends at
// midnight ends with the day before. Null without a date.
export function lastDay(endDate) {
  const at = Date.parse(endDate ?? "");
  if (!Number.isFinite(at)) return null;
  const d = new Date(at);
  if (!d.getHours() && !d.getMinutes() && !d.getSeconds() && !d.getMilliseconds()) d.setDate(d.getDate() - 1);
  return ymd(d);
}

// A GitHub Project iteration's last day: its start ("YYYY-MM-DD") plus its duration in days, less one.
export function iterationEnd(startDate, duration) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(startDate ?? ""));
  const n = Number(duration);
  if (!m || !Number.isInteger(n) || n < 1) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n - 1)).toISOString().slice(0, 10);
}

// The working time left in the shown sprints: { last (a Date), days, hours, seconds }, or null when
// no sprint has an end. With several running, the latest end counts: the work listed is all of theirs.
export function timeLeft(sprints, hours, now = new Date()) {
  const ends = (sprints ?? []).map((s) => s?.end).filter((e) => YMD.test(e ?? "")).sort();
  if (!ends.length) return null;
  const [, y, mo, d] = YMD.exec(ends.at(-1)).map(Number);
  const last = new Date(y, mo - 1, d);
  let days = 0;
  // A year at most: an end further off is a typing slip, not a sprint.
  for (let day = new Date(now.getFullYear(), now.getMonth(), now.getDate()), n = 0; day <= last && n < 366; day.setDate(day.getDate() + 1), n++) {
    if (day.getDay() % 6) days++;
  }
  return { last, days, hours, seconds: days * hours * 3600 };
}

// The tickets a story's work is counted by (each with `estimate`, seconds or null): its own when it's
// unfinished and estimated, else its unfinished subtasks of yours, else itself while unfinished.
// A pull request's row has no ticket.
function counted(it) {
  if (it.pr) return [];
  const open = it.unfinished !== false;
  if (open && it.estimate != null) return [it];
  const subs = it.story ? it.subs.filter((s) => s.mine && s.unfinished !== false) : [];
  if (subs.length) return subs;
  return open ? [it] : [];
}

// The work a list of stories holds: { seconds, stories, missing (tickets counted with no estimate) },
// or null when none of it is estimated.
export function workLeft(stories) {
  let seconds = 0, estimated = 0, missing = 0;
  for (const it of stories) {
    for (const x of counted(it)) {
      if (x.estimate == null) missing++;
      else { seconds += x.estimate; estimated++; }
    }
  }
  return estimated ? { seconds, stories: stories.length, missing } : null;
}

const dayText = (d) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const unestimated = (w) => (w.missing ? `; ${plural(w.missing, "ticket")} not estimated` : "");

// What the To do and In progress headings say beside their counts: { going, toDo }, each null or
// { text, tip, over } (`over`: more work than the time there is, drawn in the theme's working colour).
// To do is weighed against the sprint's time left less what's in progress, as that has to be
// finished in the same sprint.
export function sprintSums(toDo, going, sprints, hours, now = new Date()) {
  const g = workLeft(going), d = workLeft(toDo);
  const left = timeLeft(sprints, hours, now);
  const goingSum = g && {
    text: hoursText(g.seconds), over: false,
    tip: `${hoursText(g.seconds)} still to do on ${plural(g.stories, "story", "stories")} in progress${unestimated(g)}`,
  };
  if (!d) return { going: goingSum, toDo: null };
  const work = hoursText(d.seconds);
  if (!left) return { going: goingSum, toDo: { text: work, over: false, tip: `${work} over ${plural(d.stories, "story", "stories")} in To do${unestimated(d)}` } };
  const until = `until ${dayText(left.last)}`;
  const how = `${plural(left.days, "working day")} × ${hoursText(left.hours * 3600)}, Monday to Friday, today included`;
  const time = left.days
    ? `about ${hoursText(left.seconds)} of working time left ${until} (${how})`
    : `no working time left: the sprint's last working day, ${dayText(left.last)}, has passed`;
  const busy = g?.seconds ?? 0;
  const free = Math.max(0, left.seconds - busy);
  const over = d.seconds > free;
  const more = over ? `: about ${hoursText(d.seconds - free)} more than fits` : "";
  if (!busy) {
    return { going: goingSum, toDo: { text: `${work} of ${hoursText(left.seconds)} left`, over,
      tip: `${work} of work in To do, ${time}${more}${unestimated(d)}` } };
  }
  return { going: goingSum, toDo: { text: `${work} of ${hoursText(free)} free`, over,
    tip: `${work} of work in To do. ${time[0].toUpperCase()}${time.slice(1)}; ${hoursText(busy)} of it goes to what's in progress, about ${hoursText(free)} is free for To do${more}${unestimated(d)}` } };
}
