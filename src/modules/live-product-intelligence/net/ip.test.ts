import { describe, expect, it } from "vitest";
import { classifyAddress, isIpLiteral, parseIpv4, parseIpv6 } from "./ip";

/**
 * Address classification is the foundation of the SSRF defence, so this
 * suite is deliberately exhaustive about the ranges that must never be
 * reachable — and equally explicit that ordinary public addresses still
 * work (Sprint 3 §34).
 */

describe("classifyAddress — blocked destinations", () => {
  const blocked: [string, string][] = [
    ["127.0.0.1", "loopback"],
    ["127.1.2.3", "loopback"],
    ["0.0.0.0", "unspecified"],
    ["10.0.0.1", "private"],
    ["10.255.255.255", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.0.1", "private"],
    ["192.168.1.100", "private"],
    ["169.254.1.1", "link_local"],
    ["169.254.169.254", "cloud_metadata"],
    ["100.100.100.200", "carrier_grade_nat"],
    ["100.64.0.1", "carrier_grade_nat"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "reserved"],
    ["240.0.0.1", "reserved"],
    ["198.18.0.1", "reserved"],
    ["192.0.2.1", "documentation"],
  ];

  it.each(blocked)("blocks IPv4 %s as %s", (address, reason) => {
    const result = classifyAddress(address);
    expect(result.safe).toBe(false);
    expect(result.safe === false && result.reason).toBe(reason);
  });

  const blockedV6: [string, string][] = [
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["fe80::1", "link_local"],
    ["fe80::a00:27ff:fe4e:66a1", "link_local"],
    ["fc00::1", "unique_local"],
    ["fd00::1", "unique_local"],
    ["fd00:ec2::254", "unique_local"],
    ["ff02::1", "multicast"],
    ["2001:db8::1", "documentation"],
  ];

  it.each(blockedV6)("blocks IPv6 %s as %s", (address, reason) => {
    const result = classifyAddress(address);
    expect(result.safe).toBe(false);
    expect(result.safe === false && result.reason).toBe(reason);
  });

  it("unwraps IPv4-mapped IPv6 rather than treating it as an opaque v6 address", () => {
    expect(classifyAddress("::ffff:127.0.0.1")).toEqual({ safe: false, reason: "loopback" });
    expect(classifyAddress("::ffff:169.254.169.254")).toEqual({ safe: false, reason: "cloud_metadata" });
    expect(classifyAddress("::ffff:10.0.0.1")).toEqual({ safe: false, reason: "private" });
  });

  it("unwraps NAT64-prefixed addresses", () => {
    expect(classifyAddress("64:ff9b::7f00:1")).toEqual({ safe: false, reason: "loopback" });
  });

  it("blocks bracketed literals as they appear in URL authorities", () => {
    expect(classifyAddress("[::1]").safe).toBe(false);
  });

  it("ignores an IPv6 zone id rather than being confused by it", () => {
    expect(classifyAddress("fe80::1%eth0")).toEqual({ safe: false, reason: "link_local" });
  });
});

describe("classifyAddress — alternate encodings are rejected, not decoded", () => {
  // These all reach 127.0.0.1 through a permissive parser. Refusing to
  // parse them is what stops them being treated as public.
  const encodings = ["0177.0.0.1", "0x7f.0.0.1", "2130706433", "127.1", "127.0.1", "0x7f000001", "017700000001"];

  it.each(encodings)("treats %s as unparseable", (address) => {
    expect(classifyAddress(address)).toEqual({ safe: false, reason: "unparseable" });
  });

  it("rejects leading zeros in a dotted quad", () => {
    expect(parseIpv4("010.0.0.1")).toBeNull();
    expect(parseIpv4("192.168.01.1")).toBeNull();
  });

  it("rejects out-of-range octets", () => {
    expect(parseIpv4("256.1.1.1")).toBeNull();
    expect(parseIpv4("1.1.1.999")).toBeNull();
  });

  it("rejects anything that is not an IP literal at all", () => {
    expect(classifyAddress("example.com")).toEqual({ safe: false, reason: "unparseable" });
    expect(classifyAddress("")).toEqual({ safe: false, reason: "unparseable" });
    expect(classifyAddress("not an address")).toEqual({ safe: false, reason: "unparseable" });
  });
});

describe("classifyAddress — public destinations remain reachable", () => {
  const allowed = ["93.184.216.34", "8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.255.255", "192.167.1.1", "99.99.99.99"];

  it.each(allowed)("allows %s", (address) => {
    expect(classifyAddress(address)).toEqual({ safe: true });
  });

  it("allows public IPv6", () => {
    expect(classifyAddress("2606:4700:4700::1111")).toEqual({ safe: true });
    expect(classifyAddress("2a00:1450:4001:80f::200e")).toEqual({ safe: true });
  });
});

describe("parseIpv6", () => {
  it("expands :: compression to the right length", () => {
    expect(parseIpv6("::1")).toEqual(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]));
  });

  it("rejects more than one :: group", () => {
    expect(parseIpv6("1::2::3")).toBeNull();
  });

  it("rejects an uncompressed address with the wrong group count", () => {
    expect(parseIpv6("1:2:3:4:5:6:7")).toBeNull();
    expect(parseIpv6("1:2:3:4:5:6:7:8:9")).toBeNull();
  });

  it("parses an embedded IPv4 tail", () => {
    const parsed = parseIpv6("::ffff:192.168.1.1");
    expect(parsed?.slice(12)).toEqual(new Uint8Array([192, 168, 1, 1]));
  });
});

describe("isIpLiteral", () => {
  it("recognises literals of both families", () => {
    expect(isIpLiteral("1.2.3.4")).toBe(true);
    expect(isIpLiteral("::1")).toBe(true);
    expect(isIpLiteral("[::1]")).toBe(true);
  });

  it("does not treat hostnames as literals", () => {
    expect(isIpLiteral("example.com")).toBe(false);
    expect(isIpLiteral("127.0.0.1.nip.io")).toBe(false);
  });
});
