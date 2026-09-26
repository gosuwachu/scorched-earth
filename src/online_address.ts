/** Prefer the address the host actually opened, including a public HTTPS proxy. */
export function joinOrigin(href: string, lanUrls: string[]): string {
  const current = new URL(href);
  const local = current.hostname === "localhost" || current.hostname.endsWith(".localhost") ||
    current.hostname.startsWith("127.") || ["[::1]", "0.0.0.0", "[::]"].includes(current.hostname);
  return !local && ["http:", "https:"].includes(current.protocol) ? current.origin : lanUrls[0] ?? "";
}
