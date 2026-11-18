// The Kelpie plugin noted as on a Claude account (config.js PLUGIN_ON), as a profile with it has, so a
// job's skill line goes out (config.js withPlugin()) without an exec to check. `account`: its key,
// "~/.claude" for a profile with no Claude account of its own. Call it after mock.reset().
import { mock } from "herdr";

export const PLUGIN_ON = "kelpie.plugin";
export function pluginOn(account = "~/.claude") {
  mock.state.shared.set(PLUGIN_ON, { ...(mock.state.shared.get(PLUGIN_ON) ?? {}), [account]: { has: true, at: 0 } });
}
