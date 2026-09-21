export const ABILITIES = {
  shield: {
    name: "Shield",
    key: "Q",
    cost: 20,
    duration: 6,
    cooldown: 18,
    description: "Take 65% less damage for 6 seconds.",
  },
  emp: {
    name: "EMP",
    key: "E",
    cost: 15,
    duration: 6,
    cooldown: 15,
    description: "Disable visible enemy turrets within 6 tiles for 6 seconds.",
  },
} as const;
export type Ability = keyof typeof ABILITIES;
export const COMBAT = {
  reach: 2.2,
  friendDamage: 12,
  siegeDamage: 18,
  guardDamage: 7,
  turretRange: 5,
  turretDamage: 8,
  empRange: 6,
};
