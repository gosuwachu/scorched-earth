// Render only deployment templates in a disposable source snapshot. Game code is untouched.
import { readdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

export function renderModern(root, version) {
  if (!/^0\.0\.0-1\.modern\.[0-9]{14}\.g[0-9a-f]{7,40}$/.test(version)) {
    throw new Error("Invalid modern release version");
  }
  const sourceVersion = readFileSync(join(root, "packaging/DEBIAN/control"), "utf8").match(/^Version: (.+)$/m)[1];
  const files = ["deploy.sh", "deploy-caddy.sh"];
  for (const directory of ["deployment", "deploy/caddy", "packaging", "packaging/DEBIAN"]) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      if (entry.isFile() && !["render-variant.mjs", "test-variant.mjs", "coexistence-smoke.sh"].includes(entry.name)) {
        files.push(`${directory}/${entry.name}`);
      }
    }
  }
  files.push("deploy/install-game.sh");
  for (const file of files) {
    const path = join(root, file);
    const input = readFileSync(path, "utf8");
    writeFileSync(path, input.replaceAll("scorchedearth-html5", "scorchedearth-modern")
      .replaceAll("4001", "4002").replaceAll(sourceVersion, version));
    const renamed = basename(file).replaceAll("scorchedearth-html5", "scorchedearth-modern");
    if (renamed !== basename(file)) renameSync(path, join(root, file, "..", renamed));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) renderModern(process.argv[2], process.argv[3]);
