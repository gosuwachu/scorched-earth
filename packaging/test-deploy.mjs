import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const script = fileURLToPath(new URL("../deploy-caddy.sh", import.meta.url));
const site = readFileSync(new URL("../deploy/caddy/scorchedearth-html5.caddy", import.meta.url), "utf8");

test("Caddy deployment streams the app site to the selected SSH target and propagates failure", () => {
  const dir = mkdtempSync(join(tmpdir(), "scorch-deploy-test-"));
  const capture = join(dir, "capture.json");
  writeFileSync(join(dir, "ssh"), `#!${process.execPath}
const fs = require("node:fs");
fs.writeFileSync(process.env.CAPTURE, JSON.stringify({ args: process.argv.slice(2), input: fs.readFileSync(0, "utf8") }));
process.exit(Number(process.env.SSH_RESULT || 0));
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, CAPTURE: capture };
  try {
    for (const target of [undefined, "admin@another-vps"]) {
      const result = spawnSync("bash", [script, ...(target ? [target] : [])], { cwd: dir, env, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      const { args, input } = JSON.parse(readFileSync(capture, "utf8"));
      assert.deepEqual(args.slice(0, 2), ["--", target || "root@shopping"]);
      assert.equal(args.length, 3);
      assert.equal(input, site);
      assert.match(args[2], /caddy-config deploy scorchedearth-html5 "\$upload"/);
      assert.match(args[2], /sudo -n/);
      assert.equal(spawnSync("sh", ["-n"], { input: args[2] }).status, 0);
    }
    const failed = spawnSync("bash", [script], { cwd: dir, env: { ...env, SSH_RESULT: "23" } });
    assert.equal(failed.status, 23);
    for (const args of [["-oProxyCommand=unexpected"], [""], ["one", "two"]]) {
      rmSync(capture);
      const result = spawnSync("bash", [script, ...args], { cwd: dir, env });
      assert.equal(result.status, 1);
      assert.throws(() => readFileSync(capture), { code: "ENOENT" });
      writeFileSync(capture, "");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
