import { describe, expect, it, vi } from "vitest";
import type { NetworkInterfaceInfo } from "node:os";
import { discoverLanUrls } from "../server/lan";

function address(ip: string, internal = false, family = "IPv4"): NetworkInterfaceInfo {
  return { address: ip, internal, family, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: null } as NetworkInterfaceInfo;
}

describe("LAN discovery", () => {
  it("keeps unique external IPv4 addresses and the configured port", () => {
    expect(discoverLanUrls(4001, () => ({
      lo: [address("127.0.0.1", true)],
      eth0: [address("192.168.1.2"), address("::1", false, "IPv6")],
      eth1: [address("192.168.1.2"), address("10.0.0.2")],
      absent: undefined,
    }))).toEqual(["http://192.168.1.2:4001", "http://10.0.0.2:4001"]);
  });

  it("accepts empty discovery without a warning", () => {
    const warn = vi.fn();
    expect(discoverLanUrls(4001, () => ({}), warn)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once and returns no URLs when enumeration throws", () => {
    const error = new Error("uv_interface_addresses returned Unknown system error 97");
    const warn = vi.fn();
    expect(discoverLanUrls(4001, () => { throw error; }, warn)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("continuing without LAN addresses"), error);
  });
});
