/** Authenticated seats get independent budgets even behind a shared reverse proxy.
 * Unknown bearer strings never create fresh buckets: they share the IP budget.
 */
export class RequestLimits {
  private entries = new Map<string, { time: number; count: number }>();
  private knownSeat: (token: string) => boolean;
  constructor(knownSeat: (token: string) => boolean) {
    this.knownSeat = knownSeat;
  }
  allow(ip: string, token: string, now = Date.now()) {
    const authenticated = /^[a-f0-9]{48}$/.test(token) && this.knownSeat(token);
    const key = authenticated ? `seat:${token}` : `ip:${ip}`;
    let entry = this.entries.get(key);
    if (!entry || now - entry.time >= 10_000) {
      entry = { time: now, count: 0 };
      this.entries.set(key, entry);
    }
    return ++entry.count <= (authenticated ? 120 : 250);
  }
  prune(now = Date.now()) {
    for (const [key, entry] of this.entries)
      if (now - entry.time >= 60_000) this.entries.delete(key);
  }
}
