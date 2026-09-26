import { networkInterfaces } from "node:os";

// LAN discovery is optional: public-origin join links work without it.
export function discoverLanUrls(
  port: number,
  interfaces: typeof networkInterfaces = networkInterfaces,
  warn: (message: string, error: unknown) => void = console.warn,
): string[] {
  try {
    return [...new Set(Object.values(interfaces()).flat()
      .filter((i) => i && !i.internal && i.family === "IPv4")
      .map((i) => `http://${i!.address}:${port}`))];
  } catch (error) {
    warn("LAN interface discovery failed; continuing without LAN addresses.", error);
    return [];
  }
}
