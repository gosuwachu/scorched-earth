import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "scorch-build-"));
  const project = join(dir, "project with spaces");
  mkdirSync(join(project, "packaging"), { recursive: true });
  cpSync(new URL("build-and-test.sh", import.meta.url), join(project, "packaging/build-and-test.sh"));
  const docker = join(dir, "mock-docker");
  const events = join(dir, "events");
  writeFileSync(docker, `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.EVENTS, JSON.stringify(args) + "\\n");
if (args[0] === "build" && process.env.FAIL_BUILD) process.exit(21);
if (args[0] === "build" && args[args.indexOf("--target") + 1] === "artifact") {
  const output = args[args.indexOf("--output") + 1].replace("type=local,dest=", "");
  const payload = "fresh package bytes";
  fs.writeFileSync(path.join(output, "package.deb"), process.env.CORRUPT ? "corrupt" : payload);
  fs.writeFileSync(path.join(output, "SHA256SUMS"), crypto.createHash("sha256").update(payload).digest("hex") + "  package.deb\\n");
}
`, { mode: 0o755 });
  return {
    run(args = [], extra = {}) {
      writeFileSync(events, "");
      const result = spawnSync("bash", [join(project, "packaging/build-and-test.sh"), ...args], {
        cwd: tmpdir(), encoding: "utf8", timeout: 10000,
        env: { ...process.env, DOCKER: docker, EVENTS: events, ...extra },
      });
      assert.equal(result.error, undefined);
      return { ...result, calls: readFileSync(events, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) };
    },
    close() { rmSync(dir, { recursive: true, force: true }); },
  };
}

test("build defaults to verification and all runtime suites; skip mode only builds the artifact", () => {
  const f = fixture();
  try {
    const normal = f.run();
    assert.equal(normal.status, 0, normal.stderr);
    assert.deepEqual(normal.calls.filter((args) => args[0] === "build").map((args) => args[args.indexOf("--target") + 1]),
      ["verify", "artifact", "smoke", "deployment-test", "smoke", "deployment-test", "browser"]);
    assert.equal(normal.calls.filter((args) => args[0] === "run").length, 5);
    const skipped = f.run(["--skip-tests"]);
    assert.equal(skipped.status, 0, skipped.stderr);
    assert.deepEqual(skipped.calls.map((args) => args[0]), ["info", "build"]);
    assert.equal(skipped.calls[1][skipped.calls[1].indexOf("--target") + 1], "artifact");
    assert.match(skipped.stderr, /WARNING: tests skipped/);
    assert.doesNotMatch(skipped.stdout, /PASS/);
  } finally { f.close(); }
});

test("build-only still fails on build/checksum errors; help and invalid options never call Docker", () => {
  const f = fixture();
  try {
    const failed = f.run(["--skip-tests"], { FAIL_BUILD: "1" });
    assert.equal(failed.status, 21);
    assert.deepEqual(failed.calls.map((args) => args[0]), ["info", "build"]);
    const corrupt = f.run(["--skip-tests"], { CORRUPT: "1" });
    assert.notEqual(corrupt.status, 0);
    assert.doesNotMatch(corrupt.stdout, /Built package/);
    for (const [args, status] of [[["--help"], 0], [["--skip-test"], 1], [["anything"], 1]]) {
      const result = f.run(args);
      assert.equal(result.status, status);
      assert.deepEqual(result.calls, []);
      assert.match(result.stdout + result.stderr, /usage:/);
    }
  } finally { f.close(); }
});
