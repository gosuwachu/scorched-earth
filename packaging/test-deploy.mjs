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
    for (const [target, domain] of [["root@game.example.com", "scorched.example.com"], ["admin@another-vps", "my-game.Example.org"]]) {
      const result = spawnSync("bash", [script, target, domain], { cwd: dir, env, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      const { args, input } = JSON.parse(readFileSync(capture, "utf8"));
      assert.deepEqual(args.slice(0, 2), ["--", target]);
      assert.equal(args.length, 3);
      assert.equal(input, site.replaceAll("__SITE_DOMAIN__", domain));
      assert.doesNotMatch(input, /__SITE_DOMAIN__/);
      assert.ok(!args[2].includes(domain), "domain must travel as configuration, not shell code");
      assert.match(args[2], /caddy-config deploy scorchedearth-html5 "\$upload"/);
      assert.match(args[2], /sudo -n/);
      assert.equal(spawnSync("sh", ["-n"], { input: args[2] }).status, 0);
    }
    const failed = spawnSync("bash", [script, "admin@another-vps", "scorched.example.com"], { cwd: dir, env: { ...env, SSH_RESULT: "23" } });
    assert.equal(failed.status, 23);
    const invalidDomains = ["", "localhost", "https://game.example.com", "game.example.com:443", "*.example.com", "bad host.example.com", "game.example.com\nimport evil", "game.example.com;id", "{$DOMAIN}", "game.example.com/", "game&.example.com", "-game.example.com", "game-.example.com", "game..example.com", "192.0.2.10", `${"a".repeat(64)}.example.com`, Array(4).fill("a".repeat(63)).join(".")];
    for (const args of [[], ["admin@another-vps"], ["-oProxyCommand=unexpected", "game.example.com"], ["", "game.example.com"], ["bad host", "game.example.com"], ["one", "two", "three"], ...invalidDomains.map((domain) => ["admin@another-vps", domain])]) {
      rmSync(capture, { force: true });
      const result = spawnSync("bash", [script, ...args], { cwd: dir, env });
      assert.equal(result.status, 1);
      assert.throws(() => readFileSync(capture), { code: "ENOENT" });
    }
    const help = spawnSync("bash", [script, "--help"], { cwd: dir, env, encoding: "utf8" });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /<ssh-target> <domain>/);
    assert.throws(() => readFileSync(capture), { code: "ENOENT" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
