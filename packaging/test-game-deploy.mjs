import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "scorch-deploy-client-"));
  const project = join(dir, "project with spaces");
  const bin = join(dir, "bin");
  for (const path of [bin, project, join(project, "deploy"), join(project, "packaging/DEBIAN"), join(project, "artifacts")]) mkdirSync(path, { recursive: true });
  cpSync(new URL("../deploy.sh", import.meta.url), join(project, "deploy.sh"));
  cpSync(new URL("../deploy/install-game.sh", import.meta.url), join(project, "deploy/install-game.sh"));
  writeFileSync(join(project, "packaging/DEBIAN/control"), "Package: scorchedearth-html5\nVersion: 0.0.0-1\nArchitecture: amd64\n");
  const payload = "the tested package bytes\n";
  writeFileSync(join(project, "artifacts/scorchedearth-html5_0.0.0-1_amd64.deb"), payload);
  writeFileSync(join(project, "artifacts/SHA256SUMS"), `${createHash("sha256").update(payload).digest("hex")}  scorchedearth-html5_0.0.0-1_amd64.deb\n`);
  writeFileSync(join(project, "packaging/build-and-test.sh"), 'echo "build $*" >> "$EVENTS"\nexit "${BUILD_RESULT:-0}"\n');
  function stub(name, source) {
    writeFileSync(join(bin, name), `#!${process.execPath}\n${source}\n`, { mode: 0o755 });
  }
  stub("ssh", `
const fs = require("node:fs"), cp = require("node:child_process");
const args = process.argv.slice(2), command = args.at(-1);
fs.appendFileSync(process.env.EVENTS, JSON.stringify({ ssh: args }) + "\\n");
const upload = command.includes("mktemp -d");
if (upload && process.env.TRANSFER_RESULT) process.exit(Number(process.env.TRANSFER_RESULT));
const result = cp.spawnSync("/bin/sh", ["-c", command], { input: upload ? fs.readFileSync(0) : "", env: process.env, encoding: "utf8" });
process.stdout.write(result.stdout || ""); process.stderr.write(result.stderr || "");
process.exit(result.status ?? 1);
`);
  stub("id", 'process.stdout.write((process.env.REMOTE_UID || "0") + "\\n");');
  stub("mktemp", `
const cp = require("node:child_process");
const result = cp.spawnSync("/usr/bin/mktemp", ["-d", process.env.FIXTURE + "/remote.XXXXXXXX"], { encoding: "utf8" });
process.stdout.write(result.stdout); process.exit(result.status);
`);
  stub("bash", `
const fs = require("node:fs"), cp = require("node:child_process"), path = require("node:path");
const args = process.argv.slice(2);
if (args[0]?.endsWith("/install-game.sh")) {
  const dir = path.dirname(args[0]);
  if (fs.readFileSync(path.join(dir, "package.deb"), "utf8") !== "the tested package bytes\\n") process.exit(99);
  if (!fs.readFileSync(path.join(dir, "SHA256SUMS"), "utf8").includes("package.deb")) process.exit(98);
  fs.appendFileSync(process.env.EVENTS, "install\\n");
  process.exit(Number(process.env.INSTALL_RESULT || 0));
}
const result = cp.spawnSync("/bin/bash", args, { stdio: "inherit" });
process.exit(result.status ?? 1);
`);
  stub("sudo", `
const fs = require("node:fs"), cp = require("node:child_process");
fs.appendFileSync(process.env.EVENTS, "sudo\\n");
if (process.env.SUDO_RESULT) process.exit(Number(process.env.SUDO_RESULT));
const args = process.argv.slice(3);
const result = cp.spawnSync(args[0], args.slice(1), { stdio: "inherit" });
process.exit(result.status ?? 1);
`);
  for (const name of ["apt-get", "dpkg-deb", "systemctl", "ss"]) stub(name, "process.exit(0);");
  const events = join(dir, "events");
  return {
    project,
    run(args = [], extra = {}) {
      writeFileSync(events, "");
      const result = spawnSync("/bin/bash", [join(project, "deploy.sh"), ...args], {
        cwd: tmpdir(), encoding: "utf8", timeout: 10000,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, EVENTS: events, FIXTURE: dir, ...extra },
      });
      assert.equal(result.error, undefined);
      assert.deepEqual(readdirSync(dir).filter((name) => name.startsWith("remote.")), [], "remote upload must be cleaned up");
      return { ...result, events: readFileSync(events, "utf8") };
    },
    close() { rmSync(dir, { recursive: true, force: true }); },
  };
}

test("game deployment builds before upload, handles custom targets/sudo, and works outside the repository", () => {
  const f = fixture();
  try {
    for (const [args, env, target] of [[[], {}, "root@shopping"], [["admin@other-vps"], { REMOTE_UID: "1000" }, "admin@other-vps"]]) {
      const result = f.run(args, env);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Deployment verified/);
      assert.match(result.events, /^build $/m);
      assert.ok(result.events.indexOf("build") < result.events.indexOf("mktemp -d"));
      assert.match(result.events, /install/);
      const calls = result.events.split("\n").filter((line) => line.startsWith("{")).map(JSON.parse);
      assert.equal(calls.length, 2);
      for (const { ssh } of calls) assert.equal(ssh[ssh.indexOf("--") + 1], target);
      if (env.REMOTE_UID) assert.match(result.events, /sudo/);
    }
  } finally { f.close(); }
});

test("skip-tests is forwarded in either position without skipping verification or installation", () => {
  const f = fixture();
  try {
    for (const args of [["--skip-tests"], ["--skip-tests", "admin@other-vps"], ["admin@other-vps", "--skip-tests"]]) {
      const result = f.run(args);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.events, /^build --skip-tests$/m);
      assert.match(result.events, /install/);
      assert.match(result.stdout, /Deployment verified/);
      const calls = result.events.split("\n").filter((line) => line.startsWith("{")).map(JSON.parse);
      for (const { ssh } of calls) assert.equal(ssh[ssh.indexOf("--") + 1], args.length === 1 ? "root@shopping" : "admin@other-vps");
    }
    const failed = f.run(["--skip-tests"], { BUILD_RESULT: "21" });
    assert.equal(failed.status, 21);
    assert.doesNotMatch(failed.events, /install|mktemp -d/);
    writeFileSync(join(f.project, "artifacts/scorchedearth-html5_0.0.0-1_amd64.deb"), "changed");
    const corrupt = f.run(["--skip-tests"]);
    assert.equal(corrupt.status, 1);
    assert.match(corrupt.stderr, /checksum mismatch/);
    assert.doesNotMatch(corrupt.events, /install|mktemp -d/);
    const help = f.run(["--help"]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--skip-tests/);
    assert.equal(help.events, "");
  } finally { f.close(); }
});

test("game deployment stops on build, transfer, install, checksum, privilege and argument failures", () => {
  const f = fixture();
  try {
    for (const [env, code, forbidden] of [
      [{ BUILD_RESULT: "21" }, 21, /install|mktemp -d/],
      [{ TRANSFER_RESULT: "22" }, 22, /install\n/],
      [{ INSTALL_RESULT: "23" }, 23, /never-present/],
      [{ REMOTE_UID: "1000", SUDO_RESULT: "24" }, 24, /build|install/],
    ]) {
      const result = f.run([], env);
      assert.equal(result.status, code, result.stderr);
      assert.doesNotMatch(result.stdout, /Deployment verified/);
      assert.doesNotMatch(result.events, forbidden);
    }
    writeFileSync(join(f.project, "artifacts/scorchedearth-html5_0.0.0-1_amd64.deb"), "changed");
    const corrupt = f.run();
    assert.equal(corrupt.status, 1);
    assert.match(corrupt.stderr, /checksum mismatch/);
    assert.doesNotMatch(corrupt.events, /mktemp -d/);
    for (const args of [[""], ["-oProxyCommand=bad"], ["bad host"], ["one", "two"], ["--skip-test"], ["--skip-tests", "one", "two"]]) {
      const result = f.run(args);
      assert.equal(result.status, 1);
      assert.equal(result.events, "");
    }
  } finally { f.close(); }
});
