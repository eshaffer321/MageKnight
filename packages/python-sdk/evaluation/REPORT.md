# Initial `mk-solo-skill-v1` benchmark report

Suite hash: `7dc9b153870c3d5cf65044a41216653bf966b95f3ab8621e95b40908fee9e629`

All four policies were evaluated on the same 352 cases with greedy checkpoint
inference, CPU execution, and both Oracles disabled. All 1,408 cases ended
naturally; there were no hard limits or engine failures.

| Policy | Core completion | Core score | Core fame | Core wounds | Hero-transfer completion | Combat success | Exploration success |
|---|---:|---:|---:|---:|---:|---:|---:|
| random | 0.0% | -10.30 | 0.16 | 5.47 | 0.0% | 8.3% | 6.2% |
| v13 | 89.1% | 15.15 | 10.10 | 0.28 | 82.3% | 2.1% | 59.4% |
| terminal-fame treatment | 94.5% | 12.77 | 10.04 | 0.99 | 77.1% | 0.0% | 9.4% |
| terminal-fame control | **95.3%** | **15.36** | **10.39** | **0.20** | 79.2% | 0.0% | 59.4% |

The control is the first champion. The treatment is only 0.78 percentage points
behind in core completion, but its core engine score is 2.59 points lower and it
finishes with 0.79 more wounds. Across exact paired cases it loses 220, wins 131,
and ties 1 against control, so it fails both the score and paired-loss gates. The
benchmark therefore strengthens, rather than overturns, the earlier conclusion
that the 0.5x terminal-fame treatment did not improve this checkpoint.

v13 is more nuanced: it is 6.25 percentage points behind control on core
completion and fails that gate, but its core score is only 0.21 lower. Across the
whole suite v13 wins 158, loses 133, and ties 61 against control because it retains
better transfer/mechanics behavior. This is exactly the distinction that training
mean fame alone did not expose.

The largest diagnostic weakness is isolated combat: none of the two pilots solves
any combat drill under greedy inference, and v13 solves only 2 of 96. The treatment
also regresses the tiny exploration drill from 100% (control and v13) to 0%. The
control-derived 50k adaptive plan consequently assigns 20,054 episodes to standard
exploration (18.75% measured success), 4,278 to each of six currently-too-hard
combat buckets, and 4,278 to the mastered tiny exploration regression sentinel.

Observed full-suite runtime was 2.54 seconds for random and 25.4-29.5 seconds for
each checkpoint on CPU, or roughly 1,000-1,108 active neural-policy transitions per
second. The suite is therefore cheap enough for offline milestone evaluation and
promotion gating without affecting PPO collection throughput.

## Combat-only adaptive pilot (2026-08-05)

A 50,000-episode CPU pilot warm-started from the control champion's weights and
trained on the six combat-mechanics buckets only. It used 64 environments,
`gamma=0.999`, `lambda=0.995`, learning rate `0.0001921392`, fresh optimizer and
normalizers, and no Oracle. All 50,000 accepted episodes ended naturally, phase
budgets were exact, and no metric was non-finite. Training success increased from
22.3% over the first 5,000 episodes to 81.0% over the final 5,000.

The held-out suite confirmed that combat itself is learnable without Oracle
shaping: aggregate combat success reached 81.25%, including 100% on easy, medium,
and multi-enemy cases, 87.5% on powered and unit-assisted cases, and 12.5% on the
fortified bucket. However, this came with catastrophic forgetting. Arythea core
completion fell from the champion's 95.3% to 0%, core score fell from 15.36 to
0.90, and exploration and hero-transfer success also fell to 0%. The checkpoint
failed all three regression gates and must not be promoted.

Conclusion: adaptive combat drills are an effective combat-learning signal, but
combat-only fine-tuning is not a viable whole-game training strategy. A follow-up
must interleave full-game rehearsal (or isolate combat parameters) and enforce the
locked regression suite at milestones. The local final checkpoint SHA-256 is
`5755ec2cdfea20d15dbf066396c8a3912edcc4966a1e32c101db9534a69f4342`.
