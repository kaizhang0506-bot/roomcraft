import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Pascal 1.1.4 publishes source TS. Its ancestor traversal can reach undefined,
// but the local inferred type omitted it. This exact, versioned patch widens the
// local type only; it does not alter third-party runtime behavior.
const packageRoot = path.resolve("node_modules/@pascal-app/editor");
const metadata = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
if (metadata.version !== "1.1.4") {
  throw new Error(`Recheck Pascal's ancestor-traversal patch for version ${metadata.version}.`);
}
const target = path.join(packageRoot, "src/lib/follow-pascal-targets.ts");
const original = "  let node = nodes[id]";
const replacement = "  let node: AnyNode | undefined = nodes[id]";
const source = await readFile(target, "utf8");
if (source.includes(replacement)) {
  console.log("Pascal 1.1.4 ancestor-traversal type patch already applied.");
} else {
  if (source.split(original).length !== 2) throw new Error("Pascal source changed; refusing to apply an ambiguous patch.");
  await writeFile(target, source.replace(original, replacement));
  console.log("Patched Pascal 1.1.4 ancestor-traversal local type (no runtime change).");
}
