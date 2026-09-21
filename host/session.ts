import type { LaunchConfig } from "../games/farfield/launch";
const KEY = "farfield-active-seat";
export type SavedSeat = {
  code: string;
  token: string;
  friendId: string;
  account: string;
  chainId: number;
  launch: LaunchConfig;
};
export function readSeat(): SavedSeat | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    return s &&
      /^[A-F0-9]{10}$/.test(s.code) &&
      /^[a-f0-9]{48}$/.test(s.token) &&
      /^\d+$/.test(s.friendId) &&
      typeof s.account === "string" &&
      s.launch
      ? s
      : null;
  } catch {
    return null;
  }
}
export function saveSeat(s: SavedSeat) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}
export function clearSeat() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}
