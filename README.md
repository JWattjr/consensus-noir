# Reality Bridge

Reality Bridge is a GenLayer-native hidden-choice elimination game. Players
take seats in crossing order, commit a salted YES/NO choice before evidence is
available, reveal it later, and let independent validators settle a live,
registered real-world question on GenLayer StudioNet.

The submission lives in [`apps/reality-bridge`](apps/reality-bridge). Its
contract, frontend, tests, deployment manifest, QA guide, and demo script are
kept together there.

## Live submission

- Frontend: [reality-bridge-beta.vercel.app](https://reality-bridge-beta.vercel.app)
- Network: GenLayer StudioNet, chain `61999`
- Contract and round history: [`apps/reality-bridge/deployment/studionet.json`](apps/reality-bridge/deployment/studionet.json)
- Submission checklist: [`apps/reality-bridge/SUBMISSION.md`](apps/reality-bridge/SUBMISSION.md)

The published question uses a live Bitcoin tip source and a threshold captured
at publication time. It is intentionally future-resolving rather than a static
fixture. The contract pins its GenVM runner in the first source line; do not
change that hash.

## Run the checks

From `apps/reality-bridge`:

```powershell
python -m pytest genlayer/tests/direct -q
npm --prefix frontend run test
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend audit --audit-level=high
```

The real-network integration suite is opt-in and targets StudioNet only. The
hands-on wallet journey and its expected evidence are documented in
[`apps/reality-bridge/QA.md`](apps/reality-bridge/QA.md) and
[`apps/reality-bridge/DEMO.md`](apps/reality-bridge/DEMO.md).

## Repository layout

- `apps/reality-bridge/` — the production submission described above.
- `apps/consensus-noir/` — an independent GenLayer application with its own
  contract, frontend, tests, and deployment record.

Keep application state, lockfiles, deployment records, and generated artifacts
inside the application that owns them.
