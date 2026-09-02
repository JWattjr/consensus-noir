# Reality Bridge

Reality Bridge is a GenLayer-native hidden-choice elimination game. Players
take seats in crossing order, commit a salted YES/NO choice before evidence is
available, reveal it later, and let independent validators settle a live,
registered real-world question on GenLayer StudioNet.

The submission lives in [`apps/reality-bridge`](apps/reality-bridge). Its
contract, frontend, tests, deployment manifest, review manifest, and
independent verifier are kept together there.

## Live submission

- Frontend: [reality-bridge-beta.vercel.app](https://reality-bridge-beta.vercel.app)
- Network: GenLayer StudioNet, chain `61999`
- Review entrypoint: [`apps/reality-bridge/REVIEWER.md`](apps/reality-bridge/REVIEWER.md)
- Machine-readable claims: [`apps/reality-bridge/submission/review-manifest.json`](apps/reality-bridge/submission/review-manifest.json)
- Contract and round history: [`apps/reality-bridge/deployment/studionet.json`](apps/reality-bridge/deployment/studionet.json)
- Submission checklist: [`apps/reality-bridge/SUBMISSION.md`](apps/reality-bridge/SUBMISSION.md)

The publisher reads the Bitcoin tip once to select a block that does not exist
yet. Resolution later uses that block's height-addressed, immutable header
timestamp rather than the moving live tip, so the question is genuinely
future-resolving without making its answer depend on caller timing. The
contract pins its GenVM runner in the first source line; do not change that
hash.

## Run the checks

From `apps/reality-bridge`:

```powershell
python genlayer/scripts/verify_submission.py --manifest-only --json
python -m pytest genlayer/tests/direct -q
npm --prefix frontend run test
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend audit --audit-level=high
```

The live independent verifier is
`python genlayer/scripts/verify_submission.py --json`; it targets StudioNet
only and re-derives the deployed claims from final chain state, public evidence,
and the hosted bundle. The hands-on wallet procedure remains in
[`apps/reality-bridge/QA.md`](apps/reality-bridge/QA.md), but it is not required
to understand or validate the submission.

## Project boundary

`apps/reality-bridge/` is self-contained and is the only tree exported to the
public Reality Bridge submission repository. Workspace-only experiments and
unrelated applications are outside its review, build, deployment, and evidence
surface. Application state, lockfiles, deployment records, and generated
artifacts stay inside the application that owns them.
