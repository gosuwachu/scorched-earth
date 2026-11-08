import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { renderModern } from "./render-variant.mjs";

test("modern templates have isolated package ownership, service, port and proxy identity", () => {
  const root = mkdtempSync(join(tmpdir(), "scorch-variant-"));
  const source = new URL("../", import.meta.url);
  const version = "0.0.0-1.modern.20261108120000.gabcdef012345";
  try {
    for (const file of ["deployment", "deploy", "packaging", "deploy.sh", "deploy-caddy.sh"]) {
      cpSync(new URL(file, source), join(root, file), { recursive: true });
    }
    mkdirSync(join(root, "src"));
    cpSync(new URL("src/main.ts", source), join(root, "src/main.ts"));
    const game = readFileSync(join(root, "src/main.ts"));
    assert.throws(() => renderModern(root, "bad;version"));
    renderModern(root, version);
    assert.deepEqual(readFileSync(join(root, "src/main.ts")), game);
    const read = (path) => readFileSync(join(root, path), "utf8");
    assert.match(read("packaging/DEBIAN/control"), /Package: scorchedearth-modern/);
    assert.ok(read("packaging/DEBIAN/control").includes(`Version: ${version}`));
    assert.equal(read("packaging/DEBIAN/conffiles"), "/etc/default/scorchedearth-modern\n");
    assert.match(read("deployment/scorchedearth-modern.default"), /PORT=4002/);
    assert.match(read("deploy/caddy/scorchedearth-modern.caddy"), /127\.0\.0\.1:4002/);
    assert.match(read("deploy-caddy.sh"), /caddy-config deploy scorchedearth-modern/);
    for (const path of ["deploy.sh", "deploy/install-game.sh", "packaging/assemble.sh", "deployment/scorchedearth-modern.service", ...readdirSync(join(root, "packaging/DEBIAN")).map((f) => `packaging/DEBIAN/${f}`)]) {
      assert.doesNotMatch(read(path), /scorchedearth-html5|4001/, path);
    }
    assert.match(read("deployment/scorchedearth-modern.service"), /User=scorchedearth-modern/);
    assert.match(read("deployment/scorchedearth-modern.service"), /WorkingDirectory=\/opt\/scorchedearth-modern/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test("modern proxy dispatch renders a separate site and propagates SSH failure", () => {
  const root = mkdtempSync(join(tmpdir(), "scorch-dispatch-"));
  try {
    for (const file of ["deployment", "deploy", "packaging", "deploy.sh", "deploy-caddy.sh", ".dockerignore"]) {
      cpSync(new URL(`../${file}`, import.meta.url), join(root, file), { recursive: true });
    }
    mkdirSync(join(root, "bin"));
    writeFileSync(join(root, "bin/git"), "#!/bin/sh\necho abcdef012345\n", { mode: 0o755 });
    writeFileSync(join(root, "bin/ssh"), `#!/bin/sh
printf '%s\\n' "$@" > "$CAPTURE.args"
cat > "$CAPTURE.site"
exit "\${SSH_RESULT:-0}"
`, { mode: 0o755 });
    const template = join(root, "deploy/caddy", readdirSync(join(root, "deploy/caddy"))[0]);
    const original = readFileSync(template, "utf8");
    const env = { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, CAPTURE: `${root}/capture` };
    const args = [join(root, "deploy-caddy.sh"), "--variant", "modern", "example-vps", "modern.example.com"];
    const result = spawnSync("bash", args, { env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(`${root}/capture.site`, "utf8"), /modern.example.com[\s\S]*127\.0\.0\.1:4002/);
    assert.match(readFileSync(`${root}/capture.args`, "utf8"), /caddy-config deploy scorchedearth-modern/);
    assert.equal(spawnSync("bash", args, { env: { ...env, SSH_RESULT: "23" } }).status, 23);
    assert.equal(readFileSync(template, "utf8"), original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
