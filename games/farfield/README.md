# Farfield

A competitive shared-battlefield station builder for Rare Friends. See the root README for setup, controls, mechanics and limitations. RainbowKit manages wallet connections in the trusted host; FriendSDK v0.1.2 provides the Friend picker, verified identity, preview wallet and sandbox. The game uses a custom authoritative room server.

The game.json chance-game definition is required runtime scaffolding only: no buy, play, settle or redeem actions are exposed. The game costs 0 RF and awards 0 RF. Alloy, energy and food are non-transferable session-only simulation resources, not currencies, items or claims on RF. No RF redemption or backing is promised. Future RF escrow integration is included for local testing but is not deployed or enabled on mainnet.
