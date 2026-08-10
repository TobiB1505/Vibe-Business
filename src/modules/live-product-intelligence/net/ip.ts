/**
 * IP address classification — the core of the SSRF defence (Sprint 3 §5).
 *
 * Everything here is pure and string-based so it can be exhaustively unit
 * tested without a network. The rule is deliberately inverted from the
 * usual "block a list of bad things": an address is unsafe unless it
 * parses cleanly *and* falls outside every reserved range we know of.
 * An address we cannot parse is never treated as public.
 *
 * Two classes of bypass get explicit attention:
 *
 *  1. **Alternate encodings.** `0177.0.0.1`, `0x7f.1`, `2130706433` and
 *     friends all reach 127.0.0.1 through a permissive parser. We reject
 *     leading zeros and anything that is not plain dotted-quad decimal,
 *     so those forms fail to parse and are therefore blocked.
 *  2. **IPv6 wrappers around IPv4.** `::ffff:127.0.0.1` (IPv4-mapped) and
 *     `64:ff9b::7f00:1` (NAT64) are unwrapped and re-classified as IPv4
 *     rather than waved through as "some IPv6 address".
 */

export type BlockedAddressReason =
  | "unparseable"
  | "unspecified"
  | "loopback"
  | "private"
  | "link_local"
  | "cloud_metadata"
  | "carrier_grade_nat"
  | "multicast"
  | "unique_local"
  | "documentation"
  | "reserved";

export type AddressClassification =
  | { safe: true }
  | { safe: false; reason: BlockedAddressReason };

const SAFE: AddressClassification = { safe: true };

function blocked(reason: BlockedAddressReason): AddressClassification {
  return { safe: false, reason };
}

/**
 * Strict dotted-quad parser. Rejects leading zeros (`010` is octal `8` to
 * some resolvers and decimal `10` to others — ambiguity we refuse rather
 * than guess at), hex, and the shorthand forms (`127.1`, `2130706433`).
 */
export function parseIpv4(value: string): Uint8Array | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;

  const bytes = new Uint8Array(4);
  for (let index = 0; index < 4; index += 1) {
    const part = parts[index];
    if (!/^[0-9]{1,3}$/.test(part)) return null;
    if (part.length > 1 && part.startsWith("0")) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes[index] = value;
  }
  return bytes;
}

/** Parses a textual IPv6 address (including `::` compression and a trailing embedded IPv4). */
export function parseIpv6(value: string): Uint8Array | null {
  // A zone/scope id (`fe80::1%eth0`) carries no addressing information.
  const zoneIndex = value.indexOf("%");
  const text = zoneIndex === -1 ? value : value.slice(0, zoneIndex);
  if (text.length === 0) return null;

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (segment: string): number[] | null => {
    if (segment === "") return [];
    const items = segment.split(":");
    const groups: number[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item.includes(".")) {
        // An embedded IPv4 tail is only valid as the final component.
        if (index !== items.length - 1) return null;
        const v4 = parseIpv4(item);
        if (!v4) return null;
        groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(item)) return null;
      groups.push(Number.parseInt(item, 16));
    }
    return groups;
  };

  const head = parseGroups(halves[0]);
  if (!head) return null;

  let groups: number[];
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const tail = parseGroups(halves[1]);
    if (!tail) return null;
    const missing = 8 - head.length - tail.length;
    // `::` must stand in for at least one group.
    if (missing < 1) return null;
    groups = [...head, ...new Array<number>(missing).fill(0), ...tail];
  }

  const bytes = new Uint8Array(16);
  for (let index = 0; index < 8; index += 1) {
    bytes[index * 2] = (groups[index] >> 8) & 0xff;
    bytes[index * 2 + 1] = groups[index] & 0xff;
  }
  return bytes;
}

function classifyIpv4Bytes(bytes: Uint8Array): AddressClassification {
  const [a, b, c, d] = bytes;

  if (a === 0) return blocked("unspecified");
  if (a === 127) return blocked("loopback");
  if (a === 10) return blocked("private");
  if (a === 172 && b >= 16 && b <= 31) return blocked("private");
  if (a === 192 && b === 168) return blocked("private");

  if (a === 169 && b === 254) {
    // 169.254.169.254 is the cloud instance-metadata endpoint on AWS, GCP,
    // Azure and DigitalOcean alike — called out separately so the reason
    // reported is the specific threat, not just "link local".
    if (c === 169 && d === 254) return blocked("cloud_metadata");
    return blocked("link_local");
  }

  // 100.64.0.0/10 — carrier-grade NAT, and where Alibaba Cloud's
  // 100.100.100.200 metadata endpoint lives.
  if (a === 100 && b >= 64 && b <= 127) return blocked("carrier_grade_nat");

  if (a === 192 && b === 0 && c === 0) return blocked("reserved");
  if (a === 192 && b === 0 && c === 2) return blocked("documentation");
  if (a === 198 && (b === 18 || b === 19)) return blocked("reserved");
  if (a === 198 && b === 51 && c === 100) return blocked("documentation");
  if (a === 203 && b === 0 && c === 113) return blocked("documentation");

  if (a >= 224 && a <= 239) return blocked("multicast");
  if (a >= 240) return blocked("reserved"); // includes 255.255.255.255

  return SAFE;
}

function isPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function classifyIpv6Bytes(bytes: Uint8Array): AddressClassification {
  // ::ffff:0:0/96 — IPv4-mapped. Unwrap so `::ffff:127.0.0.1` is judged
  // as loopback rather than as an unremarkable IPv6 address.
  if (isPrefix(bytes, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff])) {
    return classifyIpv4Bytes(bytes.slice(12));
  }
  // 64:ff9b::/96 — NAT64 translation prefix, same unwrap reasoning.
  if (isPrefix(bytes, [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0])) {
    return classifyIpv4Bytes(bytes.slice(12));
  }

  const allZero = bytes.every((byte) => byte === 0);
  if (allZero) return blocked("unspecified");

  const isLoopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  if (isLoopback) return blocked("loopback");

  if (bytes[0] === 0xff) return blocked("multicast");
  // fc00::/7 — unique local. Covers AWS's fd00:ec2::254 IPv6 metadata
  // endpoint.
  if ((bytes[0] & 0xfe) === 0xfc) return blocked("unique_local");
  // fe80::/10 — link local.
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return blocked("link_local");
  // 2001:db8::/32 — documentation.
  if (isPrefix(bytes, [0x20, 0x01, 0x0d, 0xb8])) return blocked("documentation");
  // 100::/64 — discard-only prefix.
  if (isPrefix(bytes, [0x01, 0x00, 0, 0, 0, 0, 0, 0])) return blocked("reserved");

  return SAFE;
}

/**
 * Classifies a literal IP address. Anything that does not parse as a
 * strict IPv4 or IPv6 literal is `unparseable` — and therefore unsafe.
 */
export function classifyAddress(address: string): AddressClassification {
  const trimmed = address.trim();
  if (trimmed.length === 0) return blocked("unparseable");

  // A bracketed literal as it would appear in a URL authority.
  const unbracketed =
    trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;

  const v4 = parseIpv4(unbracketed);
  if (v4) return classifyIpv4Bytes(v4);

  const v6 = parseIpv6(unbracketed);
  if (v6) return classifyIpv6Bytes(v6);

  return blocked("unparseable");
}

/** True when `value` is a syntactically valid IP literal (of either family). */
export function isIpLiteral(value: string): boolean {
  const unbracketed = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return parseIpv4(unbracketed) !== null || parseIpv6(unbracketed) !== null;
}

export function addressFamily(address: string): 4 | 6 | null {
  if (parseIpv4(address)) return 4;
  if (parseIpv6(address)) return 6;
  return null;
}
