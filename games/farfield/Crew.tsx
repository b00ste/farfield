import {
  ROLES,
  capacity,
  type State,
  type Role,
  type Command,
} from "./engine.ts";
import { housing, ROLE_NAMES } from "./actors.ts";
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
  const beds = housing(state);
  const recruitHint =
    state.crew >= beds
      ? "Build Quarters for more beds"
      : state.alloy < 6 || state.food < 8
        ? "Needs 6 alloy + 8 food"
        : "Starts as a builder";
  return (
    <div className="crew-manager">
      <div className="crew-recruit">
        <div>
          <strong>{state.roles.builders} unassigned</strong>
          <small>{recruitHint}</small>
        </div>
        <button
          className="primary"
          disabled={
            busy || state.crew >= beds || state.alloy < 6 || state.food < 8
          }
          onClick={() => onCommand({ type: "recruit", role: "builders" })}
        >
          + Recruit worker<small>6 alloy · 8 food</small>
        </button>
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
          return (
            <div className="crew-job" key={role}>
              <div>
                <strong>{ROLE_NAMES[role]}</strong>
                <small>{jobs[role]}</small>
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
                    busy || !state.roles.builders || state.roles[role] >= slots
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
