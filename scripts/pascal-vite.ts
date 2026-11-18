import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const require = createRequire(import.meta.url);
const pascalRequire = createRequire(require.resolve("@pascal-app/core"));
const pascalZod = path.join(path.dirname(pascalRequire.resolve("zod/package.json")), "index.js");
const browserModules: Record<string, string> = {
  stream: require.resolve("stream-browserify"),
  util: require.resolve("util/"),
  buffer: require.resolve("buffer/"),
  process: require.resolve("process/browser.js"),
  events: require.resolve("events/"),
  string_decoder: require.resolve("string_decoder/"),
  howler: fileURLToPath(new URL("../lib/pascal-howler.mjs", import.meta.url)),
  "polygon-clipping": require.resolve("polygon-clipping/dist/polygon-clipping.esm.js"),
};
const optimizerAliases = Object.fromEntries(Object.entries(browserModules).flatMap(([name, target]) => [[name, target], [`node:${name}`, target]]));

/** Pascal's PDF writer uses browserify streams; keep all shims out of server code. */
export function pascalBrowserCompat(): Plugin {
  return {
    name: "roomcraft-pascal-browser-compat",
    enforce: "pre",
    applyToEnvironment(environment) { return environment.name === "client"; },
    configEnvironment(name) {
      if (name !== "client") return;
      return {
        resolve: { dedupe: ["three", "react", "react-dom", "@react-three/fiber", "@pascal-app/core", "@pascal-app/viewer"] },
        optimizeDeps: {
          include: [
            "three", "three/webgpu", "three/tsl",
            "@pascal-app/core", "@pascal-app/editor", "@pascal-app/editor/locales",
            "@pascal-app/viewer", "@pascal-app/viewer/ui", "@pascal-app/viewer/sfx", "@pascal-app/nodes", "howler", "blob-stream",
            "buffer", "process", "util", "stream-browserify",
            "next/dist/shared/lib/image-config-context.shared-runtime",
            "next/dist/shared/lib/image-config", "next/dist/shared/lib/match-remote-pattern",
          ],
          rolldownOptions: { resolve: { alias: optimizerAliases } },
        },
      };
    },
    resolveId(source, importer) {
      // Pascal 1.1.4 requires Zod 4; the application still uses Zod 3. Keep
      // Pascal's schema implementation intact instead of deduping both majors.
      if (source === "zod" && importer?.replaceAll("\\", "/").includes("/@pascal-app/")) return pascalZod;
      const name = source.startsWith("node:") ? source.slice(5) : source;
      return browserModules[name];
    },
  };
}
