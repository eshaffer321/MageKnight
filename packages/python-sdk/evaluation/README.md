# Mage Knight skill evaluation

`mk-solo-skill-v1` is a frozen, CPU-friendly benchmark for comparing policies
outside the training reward stream. Its JSON definition is package data, and its
content SHA-256 is recorded in every result. Changing any seed, scenario, metric,
or regression threshold creates a different suite hash and therefore a different
benchmark version.

## Suite contract

- 352 held-out cases use the high-bit seed namespace (`seed >= 2^31`), separate
  from sequential training seeds.
- 128 Arythea full games are the locked core skill set.
- 96 full games test transfer across Tovak, Goldyx, Norowas, Wolfhawk, Krang,
  and Braevalar.
- 96 combat drills isolate basic, powered, fortified, unit-assisted, and
  multi-enemy combat.
- 32 exploration drills isolate small and standard-map traversal.
- Checkpoints act greedily (`argmax`) under `torch.inference_mode()` and use no
  combat or commerce Oracle. The random baseline uniformly samples legal actions
  using a per-case policy seed.

Every case records completion, official engine score, fame, steps, wounds gained
and healed, rests, exploration and combat counts, achievement categories, and
terminal hand/deck/discard, crystals, reputation, level, units, skills, and round.
The runner saves a manifest, one NDJSON row per case, and aggregate summaries with
variance and percentiles.

## Commands

```bash
# Verify the immutable suite and print its fingerprint.
mage-knight-evaluate verify-suite

# Run a checkpoint or the fixed random baseline.
mage-knight-evaluate run --random --name random
mage-knight-evaluate run --checkpoint training/runs/example/checkpoints/policy_final.pt --name example

# Rebuild the offline leaderboard. All inputs must be complete runs with one hash.
mage-knight-evaluate leaderboard evaluation/results/mk-solo-skill-v1/* \
  --output evaluation/leaderboard/mk-solo-skill-v1

# Turn the champion's mechanics weaknesses into a 50k-episode training plan.
mage-knight-evaluate adaptive-plan evaluation/results/mk-solo-skill-v1/CHAMPION \
  --episodes 50000 --block-episodes 4096 \
  --output evaluation/adaptive/next-50k.json

# Restrict a remediation run to combat mechanics only.
mage-knight-evaluate adaptive-plan evaluation/results/mk-solo-skill-v1/CHAMPION \
  --episodes 50000 --category combat_mechanics \
  --output evaluation/adaptive/combat-only-50k.json

# The normal PPO curriculum loop consumes that plan without a separate trainer.
mage-knight-train-rl --ppo --curriculum-plan evaluation/adaptive/next-50k.json \
  --batch-episodes 64
```

Adaptive plans require both Oracles off, and the trainer applies those plan
requirements automatically. This is essential for combat buckets: leaving the
default combat Oracle enabled would skip the policy decisions being remediated.

Evaluation is an offline job, not part of rollout collection. Run it for candidate
checkpoints before promotion and at milestone saves rather than blocking every
checkpoint save. On the initial Apple CPU run, the full suite took 25-30 seconds
per neural checkpoint.

## Leaderboard and regression policy

Ranking is lexicographic: locked Arythea completion, Arythea engine score,
mechanics success, then wound efficiency. This keeps the main scenario outcome
primary while exposing specialized regressions. A candidate fails the locked gate
relative to the current champion if any of these are true:

- core completion drops by more than 5 percentage points;
- core mean engine score drops by more than 2 points; or
- it loses more than 55% of all paired frozen cases.

Promotion is explicit: update `baselines.json` only after a complete same-hash run
passes review. Random and v13 remain fixed anchors even when the champion changes.

## Adaptive curriculum

Only mechanics buckets are eligible; the held-out full-game seeds are never
inserted into training. Buckets in the 40-70% success band receive maximum weight.
Very hard and mastered buckets retain a 10% priority floor, preventing impossible
tasks from consuming the whole run and preventing forgotten skills from vanishing.
The resulting allocation is interleaved in bounded, reproducible blocks and each
phase disables the early zero-fame cutoff.
