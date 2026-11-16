// The Ask line in a view (KELPIE-305): it wakes on touch, a click fills it, Enter sends. For the tests:
// wake it, pick a suggestion or task, press Enter.
import { handlers } from "gpui-kit";
export const wake = (view, cx) => { view.askAwake = true; return view.render(cx); };
export const emit = (input, event, cx) => input.__state.calls.filter(([m, a]) => m === "on" && a[0] === event).forEach(([, a]) => a[1]({}, cx));
export function pickAndSend(view, cx, id) {
  const el = wake(view, cx);
  handlers(el).find((h) => h.id === `ask-pick-${id}`).fn({}, cx);
  emit(view.askInput, "submit", cx);
}
