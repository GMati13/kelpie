// Stub of Herdr's "gpui-base" host module, for the tests: every factory and component makes a
// recording element (gpui-kit.js), and the state handles (InputState, TextareaState, scroll handles)
// keep a value and record the rest.
import { element } from "./gpui-kit.js";

// A component: Button.new(id), TextView.html(id, html), Popup.new(...), `new AvatarImage(path)`,
// or called as a function: each makes an element named "<Component>.<member>".
const component = (name) => new Proxy(function () {}, {
  get: (_t, prop) => (typeof prop === "symbol" ? undefined : (...a) => element(`${name}.${String(prop)}`, a)),
  apply: (_t, _this, a) => element(name, a),
  construct: (_t, a) => element(`new ${name}`, a),
});

// A state handle (InputState.new(cx), ...): value()/text() give what set_value()/set_text() put, any
// other method is recorded in `calls` and returns the handle.
export function stateHandle(kind, args = []) {
  const s = { kind, args, calls: [], value: "" };
  const h = new Proxy(s, {
    get(target, prop) {
      if (prop === "__state") return s;
      if (typeof prop === "symbol" || prop === "then" || prop === "toJSON") return undefined;
      if (prop === "value" || prop === "text") return () => s.value;
      if (prop === "set_value" || prop === "set_text") return (v) => { s.value = String(v ?? ""); s.calls.push([prop, [v]]); return h; };
      return (...a) => { s.calls.push([prop, a]); return h; };
    },
  });
  return h;
}
const state = (name) => ({ new: (...a) => stateHandle(name, a) });

export const h_flex = () => element("h_flex");
export const v_flex = () => element("v_flex");
export const h_resizable = (id) => element("h_resizable", [id]);
export const v_resizable = (id) => element("v_resizable", [id]);
export const resizable_panel = () => element("resizable_panel");
export const v_virtual_list = (...a) => element("v_virtual_list", a);
export const h_virtual_list = (...a) => element("h_virtual_list", a);
export const dock_area = (...a) => element("dock_area", a);
export const dock_content = () => element("dock_content");
export const pagination_items = () => [];

export const Accordion = component("Accordion");
export const AccordionHeader = component("AccordionHeader");
export const AccordionItem = component("AccordionItem");
export const AccordionPanel = component("AccordionPanel");
export const AccordionTrigger = component("AccordionTrigger");
export const Avatar = component("Avatar");
export const AvatarFallback = component("AvatarFallback");
export const AvatarImage = component("AvatarImage");
export const Button = component("Button");
export const Checkbox = component("Checkbox");
export const Collapsible = component("Collapsible");
export const Combobox = component("Combobox");
export const DatePicker = component("DatePicker");
export const DockArea = component("DockArea");
export const Editor = component("Editor");
export const HoverCard = component("HoverCard");
export const Input = component("Input");
export const Link = component("Link");
export const NumberInput = component("NumberInput");
export const OtpInput = component("OtpInput");
export const Pagination = component("Pagination");
export const Popover = component("Popover");
export const Popup = component("Popup");
export const Progress = component("Progress");
export const ProgressIndicator = component("ProgressIndicator");
export const ProgressTrack = component("ProgressTrack");
export const Radio = component("Radio");
export const RadioGroup = component("RadioGroup");
export const Scrollbar = component("Scrollbar");
export const Select = component("Select");
export const Slider = component("Slider");
export const SliderIndicator = component("SliderIndicator");
export const SliderThumb = component("SliderThumb");
export const SliderTrack = component("SliderTrack");
export const Switch = component("Switch");
export const Tab = component("Tab");
export const Table = component("Table");
export const TableBody = component("TableBody");
export const TableCaption = component("TableCaption");
export const TableCell = component("TableCell");
export const TableHead = component("TableHead");
export const TableHeader = component("TableHeader");
export const TableRow = component("TableRow");
export const Tabs = component("Tabs");
export const Textarea = component("Textarea");
export const TextView = component("TextView");
export const Toggle = component("Toggle");
export const ToggleGroup = component("ToggleGroup");

export const InputState = state("InputState");
export const TextareaState = state("TextareaState");
export const EditorState = state("EditorState");
export const SliderState = state("SliderState");
export const OtpState = state("OtpState");
export const CalendarState = state("CalendarState");
export const VirtualListScrollHandle = state("VirtualListScrollHandle");
