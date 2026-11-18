// Howler 2.2.4 is UMD. Some RSC development imports bypass Vite's CJS
// optimizer; namespace side effects support that path, while the production
// CommonJS plugin supplies the default namespace. Both use the real library.
import * as howlerModule from "howler/dist/howler.js";
const implementation = howlerModule.default || howlerModule;
export const Howl = implementation.Howl || globalThis.Howl;
export const Howler = implementation.Howler || globalThis.Howler;
export default { Howl, Howler };
