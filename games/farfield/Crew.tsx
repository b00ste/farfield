import {
  ROLES,
  capacity,
  rates,
  recruitmentError,
  RECRUIT_SECONDS,
  WORKER_FOOD_UPKEEP,
  type State,
  type Role,
  type Command,
} from "./engine.ts";
import { ROLE_NAMES } from "./actors.ts";
const jobs: Record<Role, string> = {
  builders: "Build queued modules",
  miners: "Alloy · Foundry",
  engineers: "Energy · Reactor",
  farmers: "Food · Garden",
  guards: "Combat · Defense",
  scientists: "Decode anomalies · Research",
  medics: "Healing · Infirmary",
};
export function Crew({
  state,
  busy,
  onCommand,
}: {
  state: State;
  busy: boolean;
  onCommand: (c: Command) => void;
}) {
  const queue = state.recruitQueue ?? [];
  const recruitHint =
    recruitmentError(state, "builders") ??
    "6 seconds each · starts as a builder";
  const foodNet = rates(state).food;
  const upkeep = state.crew * WORKER_FOOD_UPKEEP;
  const foodIncome = foodNet + upkeep;
  return (
    <div className="crew-manager">
      <div className="crew-recruit">
        <div>
          <strong>{state.roles.builders} unassigned</strong>
          <small>{recruitHint}</small>
        </div>
        <button
          className="primary"
          disabled={busy || !!recruitmentError(state, "builders")}
          onClick={() => onCommand({ type: "recruit", role: "builders" })}
        >
          + Recruit worker<small>6 alloy · 8 food</small>
        </button>
      </div>
      {queue.length > 0 && (
        <div
          className="recruit-queue"
          aria-label="Recruitment queue"
          data-testid="recruit-queue"
        >
          {queue.map((entry, index) => (
            <div className="recruit-slot" key={entry.id}>
              <span>{ROLE_NAMES[entry.role]}</span>
              <small>
                {index === 0
                  ? entry.progress >= 1
                    ? "Needs a bed"
                    : `${Math.ceil((1 - entry.progress) * RECRUIT_SECONDS)}s`
                  : "Queued"}
              </small>
              <progress
                aria-label={`${ROLE_NAMES[entry.role]} recruitment progress`}
                value={entry.progress}
                max={1}
              />
              <button
                aria-label={`Cancel recruit ${entry.id}`}
                title="Cancel · refund 6 alloy + 8 food"
                disabled={busy}
                onClick={() =>
                  onCommand({ type: "cancel-recruit", id: entry.id })
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="crew-economy" data-testid="crew-food-balance">
        <span>
          ♧ +{foodIncome.toFixed(2)}/s grown · −{upkeep.toFixed(2)}/s upkeep
        </span>
        <strong className={foodNet < 0 ? "danger" : ""}>
          {foodNet >= 0 ? "+" : ""}
          {foodNet.toFixed(2)}/s net
        </strong>
        <small>
          One farmer feeds about six workers. Quarters add beds, not food.
        </small>
        {(state.foodShortage ?? 0) > 0 && (
          <small className="danger">
            Food shortage · workers and defenses at{" "}
            {Math.round((1 - (state.foodShortage ?? 0) * 0.5) * 100)}%. Farms
            keep producing.
          </small>
        )}
      </div>
      {!!state.roles.guards && (
        <div className="guard-orders">
          <button
            onClick={() => onCommand({ type: "guards", stance: "follow" })}
          >
            Guards: follow Friend
          </button>
          <button
            onClick={() =>
              onCommand({
                type: "guards",
                stance: "defend",
                x: Math.round(state.friend.x),
                y: Math.round(state.friend.y),
              })
            }
          >
            Guards: hold here
          </button>
          <button
            onClick={() => onCommand({ type: "guards", stance: "station" })}
          >
            Staff turrets
          </button>
        </div>
      )}
      <p className="crew-hint">
        Move builders into jobs with +. Use − to return them.
      </p>
      <div className="crew-jobs">
        {ROLES.filter((role) => role !== "builders").map((role) => {
          const slots = capacity(state, role);
          const pending = queue.filter((entry) => entry.role === role).length;
          return (
            <div className="crew-job" key={role}>
              <div>
                <strong>{ROLE_NAMES[role]}</strong>
                <small>
                  {jobs[role]}
                  {pending ? ` · ${pending} queued` : ""}
                </small>
              </div>
              <div className="crew-stepper">
                <button
                  aria-label={`Remove ${ROLE_NAMES[role].toLowerCase()}`}
                  disabled={busy || state.roles[role] === 0}
                  onClick={() => onCommand({ type: "assign", role, delta: -1 })}
                >
                  −
                </button>
                <span data-testid={`role-${role}`} aria-live="polite">
                  {state.roles[role]}
                  <small> / {slots}</small>
                </span>
                <button
                  aria-label={`Assign ${ROLE_NAMES[role].toLowerCase()}`}
                  disabled={
                    busy ||
                    !state.roles.builders ||
                    state.roles[role] + pending >= slots
                  }
                  onClick={() => onCommand({ type: "assign", role, delta: 1 })}
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
