import { describe, expect, it } from "vitest";
import { joinOrigin } from "../src/online_address";

describe("public and LAN join addresses", () => {
  const lan = ["http://192.168.1.20:3000"];
  it("preserves the HTTPS proxy origin instead of advertising a private interface", () => {
    expect(joinOrigin("https://scorched.gosuwachu.fyi/?join=abc", lan)).toBe("https://scorched.gosuwachu.fyi");
    expect(joinOrigin("https://game.example:8443/", [])).toBe("https://game.example:8443");
  });
  it("preserves a directly reachable IP and port", () => {
    expect(joinOrigin("http://209.97.177.131:4001/", lan)).toBe("http://209.97.177.131:4001");
    expect(joinOrigin("http://[2001:db8::1]:4001/", lan)).toBe("http://[2001:db8::1]:4001");
  });
  it.each(["localhost", "127.0.0.1", "127.0.0.2", "[::1]", "0.0.0.0"])("uses a LAN address when opened on %s", (host) => {
    expect(joinOrigin(`http://${host}:3000/`, lan)).toBe(lan[0]);
    expect(joinOrigin(`http://${host}:3000/`, [])).toBe("");
  });
});
