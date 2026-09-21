# Workspace handoff

- Target template: `browser-testing`; prepared workspace: **daniel/rarefriends-browser**. Open it in the Hive TUI, or open its Desktop for headed Chrome inspection.
- Reason: Chrome, Playwright, screenshots and touch-layout validation belong to Browser Testing.
- Repository/path: primary implementation `/home/coder/rare-friends-vibeathon` in `daniel/ai-dev-01`; disposable validation copy `/home/coder/projects/farfield` in `daniel/rarefriends-browser`.
- Current state: original implementation remains in the primary workspace. Node simulation checks, typecheck and SDK validation are local; browser checks use the public HTTPS primary server and SDK automation-only fixtures. Screenshots are copied back to `artifacts/`.
- Next action: in Browser Testing, open the HTTPS preview in Chrome or run `TEST_URL=https://4173--main--ai-dev-01--daniel.kethalia.com npm run test:browser`. Test with a real injected wallet and eligible Friend before submitting. Keep questions and corrections in the live TUI conversation.

From the primary workspace, to run the bounded automated step:

```sh
coder ssh rarefriends-browser -- 'cd /home/coder/projects/farfield && TEST_URL=https://4173--main--ai-dev-01--daniel.kethalia.com npm run test:browser'
```

Do not copy mock wallet code into the application, and do not install or run a browser in the software workspace. The browser workspace has a four-hour autostop; no persistent resources have been deleted.
