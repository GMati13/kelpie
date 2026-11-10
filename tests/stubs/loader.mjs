// Module hooks for the JavaScript tests (registered by register.mjs, loaded with `node --import`):
// the host modules Herdr gives a mod ("herdr", "gpui-kit", "gpui-base", "gpui") resolve to the stubs
// beside this file, and the repo's .js files load as ES modules (the mods have no package.json).
const STUBS = {
  herdr: new URL("./herdr.js", import.meta.url).href,
  "gpui-kit": new URL("./gpui-kit.js", import.meta.url).href,
  gpui: new URL("./gpui-kit.js", import.meta.url).href,
  "gpui-base": new URL("./gpui-base.js", import.meta.url).href,
};
const REPO = new URL("../../", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (Object.hasOwn(STUBS, specifier)) return { url: STUBS[specifier], format: "module", shortCircuit: true };
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith(REPO) && url.endsWith(".js")) return nextLoad(url, { ...context, format: "module" });
  return nextLoad(url, context);
}
