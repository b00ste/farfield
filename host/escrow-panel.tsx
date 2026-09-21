import { useEffect, useRef, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { formatUnits, type Address, type Hex } from "viem";
import { RF, ENTRY, chain, escrowAbi, tokenAbi } from "../shared/wagers";
export async function wagerApi<T>(
  action: string,
  body: unknown = {},
): Promise<T> {
  const response = await fetch(`./api/wager/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Escrow request failed.");
  return data;
}
export type WagerConfig = {
  enabled: boolean;
  contract: Address | null;
  token: Address;
  entry: string;
  pool: string;
  chainId: number;
};
type Status = {
  id: Hex;
  contract: Address;
  players: Address[];
  fundBy: number;
  resolveBy: number;
  stage: number;
  funded: boolean[];
  winner: Address;
  claimable: string;
  allowance: string;
  balance: string;
  transaction: "success" | "reverted" | "pending" | null;
};
export function EscrowPanel({ id, onClose }: { id: Hex; onClose: () => void }) {
  const { address, chainId } = useAccount();
  const { data: wallet } = useWalletClient();
  const [state, setState] = useState<Status | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [hash, setHash] = useState<Hex | null>(null),
    [refresh, setRefresh] = useState(0),
    [enabled, setEnabled] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    lock = useRef(false);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const [result, config] = await Promise.all([
          wagerApi<Status>("status", { id, address, hash }),
          wagerApi<WagerConfig>("config"),
        ]);
        if (active) {
          setState(result);
          setEnabled(config.enabled);
          if (result.transaction === "success") setHash(null);
          if (result.transaction === "reverted") {
            setHash(null);
            setError(
              "The transaction reverted. Your deposit was not completed. Check your wallet and retry.",
            );
          }
        }
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : "Escrow unavailable.");
      } finally {
        if (active) timer = setTimeout(poll, 4000);
      }
    };
    if (address) void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [address, id, refresh, hash]);
  const own =
    state?.players.findIndex(
      (p) => p.toLowerCase() === address?.toLowerCase(),
    ) ?? -1;
  const transaction = async (action: "approve" | "deposit" | "claim") => {
    if (
      !wallet ||
      !state ||
      !address ||
      chainId !== 4663 ||
      lock.current ||
      hash
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const tx =
        action === "approve"
          ? await wallet.writeContract({
              account: address,
              chain,
              address: RF,
              abi: tokenAbi,
              functionName: "approve",
              args: [state.contract, ENTRY],
            })
          : await wallet.writeContract({
              account: address,
              chain,
              address: state.contract,
              abi: escrowAbi,
              functionName: action,
              args: [id],
            });
      setHash(tx);
      setRefresh((n) => n + 1);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.split("\n")[0]
          : "Transaction cancelled.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const canDeposit =
    enabled &&
    state?.stage === 1 &&
    Date.now() / 1000 < state.fundBy &&
    own >= 0 &&
    !state.funded[own];
  return (
    <dialog
      className="escrow-dialog"
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>Match escrow</h2>
        <button aria-label="Close escrow" onClick={onClose}>
          ×
        </button>
      </header>
      <p>
        Entry <strong>1 RF each</strong> · Winner claims <strong>2 RF</strong> ·
        No platform fee.
      </p>
      <p>
        Farfield’s server reports the winner. If only one deposit arrives, it is
        refundable after 10 minutes. If both arrive but no result is reported
        within 45 minutes, each player can reclaim their 1 RF.
      </p>
      <label>
        Match ID
        <input readOnly value={id} onFocus={(e) => e.target.select()} />
      </label>
      {state && (
        <>
          <p>
            {
              [
                "Preparing escrow",
                "Awaiting deposits",
                "Match active",
                "Winner confirmed",
                "Refunds available",
              ][state.stage]
            }
          </p>
          <div className="funding-status">
            {state.players.map((p, i) => (
              <span key={p}>
                {i === own ? "You" : "Opponent"} ·{" "}
                {state.funded[i] ? "1 RF deposited" : "Not deposited"}
              </span>
            ))}
          </div>
          <p>Your RF balance: {formatUnits(BigInt(state.balance), 18)}</p>
          {state.fundBy > 0 && (
            <small>
              Funding deadline: {new Date(state.fundBy * 1000).toLocaleString()}
            </small>
          )}
          {state.resolveBy > 0 && (
            <small>
              Result deadline:{" "}
              {new Date(state.resolveBy * 1000).toLocaleString()}
            </small>
          )}
          {canDeposit && (
            <button
              className="escrow-primary"
              disabled={
                busy ||
                !!hash ||
                chainId !== 4663 ||
                BigInt(state.balance) < ENTRY
              }
              onClick={() =>
                void transaction(
                  BigInt(state.allowance) >= ENTRY ? "deposit" : "approve",
                )
              }
            >
              {busy
                ? "Check your wallet…"
                : BigInt(state.allowance) >= ENTRY
                  ? "Deposit 1 RF"
                  : "Approve exactly 1 RF"}
            </button>
          )}
          {BigInt(state.claimable) > 0n && (
            <button
              className="escrow-primary"
              disabled={busy || !!hash || chainId !== 4663}
              onClick={() => void transaction("claim")}
            >
              Claim {formatUnits(BigInt(state.claimable), 18)} RF
            </button>
          )}
          <small>Contract: {state.contract}</small>
        </>
      )}
      {chainId !== 4663 && <p>Connect to Robinhood mainnet (4663).</p>}
      {hash && (
        <p>
          Transaction submitted. Waiting for on-chain status to update.{" "}
          <a
            href={`https://robinhoodchain.blockscout.com/tx/${hash}`}
            target="_blank"
            rel="noreferrer"
          >
            View transaction
          </a>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <button onClick={() => setRefresh((n) => n + 1)}>Refresh status</button>
    </dialog>
  );
}
