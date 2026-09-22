import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSignMessage } from "wagmi";
import { apiUrl } from "./api";
import type { RankProfile } from "../games/farfield/network";

async function rankedRequest<T>(path: string, body: unknown = {}, token?: string): Promise<T> {
  const response = await fetch(apiUrl(`/api/ranked/${path}`), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("Ranked service unavailable. Please try again.");
  return response.json();
}

type RankedSession = { token: string; expiresAt: number; profile: RankProfile; key: string };
export function useRanked(identity: string, address: `0x${string}` | undefined, friendId: string | null) {
  const { signMessageAsync } = useSignMessage();
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const sessionRef = useRef<RankedSession | null>(null);
  const [profile, setProfile] = useState<RankProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const config = useQuery({
    queryKey: ["ranked-config"],
    queryFn: () => rankedRequest<{ enabled: boolean; season: string }>("config"),
    staleTime: 60000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const key = `${identity}:${friendId ?? ""}`;
  const currentKey = useRef(key);
  currentKey.current = key;
  if (sessionRef.current?.key !== key) sessionRef.current = null;
  useEffect(() => { setProfile(null); setError(""); }, [key]);
  function token() {
    const session = sessionRef.current;
    return session?.key === currentKey.current && session.expiresAt > Date.now() + 5000 ? session.token : null;
  }
  async function authenticate(id: string) {
    if (!address || busy) return false;
    const requestedIdentity = identity;
    const requestedKey = `${identity}:${id}`;
    if (sessionRef.current?.key === requestedKey && token()) return true;
    setBusy(true);
    setError("");
    try {
      const challenge = await rankedRequest<{ id: string; message: string }>("challenge", { address, friendId: id });
      if (identityRef.current !== requestedIdentity || currentKey.current !== requestedKey) return false;
      const signature = await signMessageAsync({ account: address, message: challenge.message });
      if (identityRef.current !== requestedIdentity || currentKey.current !== requestedKey) return false;
      const verified = await rankedRequest<{ token: string; expiresAt: number; profile: RankProfile }>("verify", { id: challenge.id, signature });
      if (identityRef.current !== requestedIdentity || currentKey.current !== requestedKey) return false;
      sessionRef.current = { ...verified, key: requestedKey };
      setProfile(verified.profile);
      return true;
    } catch {
      if (identityRef.current === requestedIdentity) setError("Sign-in was not completed. Try again when your wallet is ready.");
      return false;
    } finally { setBusy(false); }
  }
  function invalidate() {
    sessionRef.current = null;
    setProfile(null);
  }
  async function refresh() {
    const bearer = token();
    const startedKey = currentKey.current;
    if (!bearer) return;
    try {
      const result = await rankedRequest<{ profile: RankProfile }>("profile", {}, bearer);
      if (currentKey.current === startedKey) setProfile(result.profile);
    } catch {
      if (currentKey.current === startedKey) invalidate();
    }
  }
  return { config, profile: sessionRef.current?.key === key ? profile : null, busy, error, token, authenticate, refresh, invalidate };
}

export function RankSummary({ profile }: { profile: RankProfile | null }) {
  return <span className="rank-summary">{!profile ? "Five placement matches" : !profile.provisional ? `${profile.division} · ${Math.round(profile.rating)} RP` : `Placements · ${profile.placements.completed}/${profile.placements.required}`}</span>;
}

export function RankedLeaderboard({ season, onBack }: { season: string; onBack: () => void }) {
  const board = useQuery({ queryKey: ["ranked-leaderboard", season], queryFn: () => rankedRequest<{ season: string; entries: (RankProfile & { position: number })[] }>("leaderboard"), staleTime: 15000, retry: 1 });
  return <section className="ranked-leaderboard" aria-label="Ranked leaderboard">
    <header><button onClick={onBack} aria-label="Back to online play">← Back</button><h2>{season}</h2><span>Leaderboard</span></header>
    {board.isPending ? <p role="status">Loading standings…</p> : board.isError ? <p role="alert">Standings unavailable. <button onClick={() => void board.refetch()}>Retry</button></p> : <>
      <div className="ranked-standings"><table><thead><tr><th>Place</th><th>Commander</th><th>Rank</th><th>Rating</th><th>Wins</th></tr></thead><tbody>{board.data.entries.map((entry, index) => <tr key={`${entry.friendId}-${index}`}><td>{entry.position}</td><td>{entry.name}</td><td>{entry.label}</td><td>{Math.round(entry.rating)}</td><td>{entry.wins}</td></tr>)}</tbody></table></div>
      {!board.data.entries.length && <p>Complete five placement matches to enter the leaderboard.</p>}
    </>}
  </section>;
}
