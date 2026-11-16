// The Ask line in a view (KELPIE-305): one row with the input, one offer (a click asks it), a menu of
// the other asks, and who it goes to. For the tests: ask one of them by its id, as a click would.
import { handlers } from "gpui-kit";
export const wake = (view, cx) => { view.askAwake = true; return view.render(cx); };
export const emit = (input, event, cx) => input.__state.calls.filter(([m, a]) => m === "on" && a[0] === event).forEach(([, a]) => a[1]({}, cx));
export function pickAndSend(view, cx, id) {
  const el = view.render(cx);
  const row = (view.askMoreRows ?? []).find((r) => r.id === id);
  if (row) return row.action(cx);
  return handlers(el).find((h) => h.id === "ask-offer").fn({}, cx);
}
