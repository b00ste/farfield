import type { RoomView } from "./network.ts";
/** Result copy uses authoritative causes, never guesses from the last log line. */
export function matchResult(room: RoomView) {
  if (room.draw)
    return {
      title: "Draw",
      winner: "No surviving commanders",
      reason: "All remaining cores were destroyed.",
    };
  const winner = room.players.find((p) => p.id === room.winnerId);
  const won = room.selfId === room.winnerId;
  const elimination = room.state.elimination;
  let reason = "";
  if (elimination?.reason === "forfeit") reason = "You forfeited the match.";
  else if (elimination?.reason === "disconnect")
    reason = "You were disconnected for more than 60 seconds.";
  else if (elimination?.reason === "core-destroyed")
    reason = elimination.by
      ? `${elimination.by} destroyed your core.`
      : "Your core was destroyed.";
  else if (room.victoryReason === "signals")
    reason = won
      ? "You held all four monoliths for 60 seconds."
      : `${winner?.name} held all four monoliths for 60 seconds.`;
  else if (winner)
    reason = won
      ? "Your station is the last one standing."
      : `${winner.name} is the last commander standing.`;
  return {
    title: won ? "Victory" : winner ? "Defeat" : "Eliminated",
    winner: winner
      ? won
        ? "You won"
        : `Winner: ${winner.name}`
      : "Match continues · no winner yet",
    reason,
  };
}
