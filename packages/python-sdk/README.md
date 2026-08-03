# mage-knight-sdk

Python SDK for Mage Knight RL training and game simulation, powered by a native Rust engine via PyO3.

## Features

- Native Rust game engine (no server required) exposed to Python via PyO3.
- REINFORCE and PPO policy gradient training with TensorBoard logging.
- Rust-side feature encoding for high-throughput training.
- Random-policy game runner for smoke testing and seed sweeps.
- Organized training artifact layout with auto-naming and smart resume.

## Install

```bash
cd packages/python-sdk
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -e ".[rl]"
```

The native Rust engine must be built separately:

```bash
cd packages/engine-rs
maturin develop --release
```

## Quick Start

### Run a single game (random policy)

```bash
mage-knight-run-native --seed 42 --hero arythea
```

### Run a seed sweep

```bash
mage-knight-run-native --start-seed 1 --count 100
```

### Programmatic usage

```python
from mage_knight_sdk import run_native_game, RunResult

result: RunResult = run_native_game(seed=42, hero="arythea", max_steps=5000)
print(f"Outcome: {result.outcome}, Steps: {result.steps}, Fame: {result.fame}")
```

## RL Training

Train a policy gradient agent against the native Rust engine. Supports both REINFORCE (per-episode updates) and PPO (batched updates with GAE).

**Install RL extras:**

```bash
pip install -e ".[rl]"
```

**Train:**

```bash
# Direct CLI (auto-generates run directory under training/runs/)
mage-knight-train-rl --episodes 100 --hero arythea

# PPO training
mage-knight-train-rl --ppo --episodes 1000 --batch-episodes 16

# Resume from checkpoint
mage-knight-train-rl --ppo --episodes 500 --resume training/runs/baseline/checkpoints/policy_final.pt

# Named run via session manager (detaches, survives shell exit)
./scripts/train start baseline -- --episodes 10000
./scripts/train stop
./scripts/train status
./scripts/train list
```

### Training Directory Layout

```
training/
  runs/
    baseline/                    ← one directory per experiment
      run_config.json            ← frozen config at training start
      training_log.ndjson        ← per-episode metrics (appended)
      tensorboard/               ← TensorBoard events
      checkpoints/               ← model snapshots
        policy_ep_000100.pt
        policy_final.pt
      train.log                  ← stdout/stderr (scripts/train only)
    run-20260223T093000/         ← auto-generated name (direct CLI)
```

- Checkpoints and logs are separated — checkpoints in `checkpoints/`, everything else at run root.
- `run_config.json` records policy/reward config and CLI args for reproducibility.
- **Resume** derives the run directory from the checkpoint path automatically.
- Rewards are configurable: fame deltas (dense), step penalty, and terminal bonuses/penalties. See `sim/rl/rewards.py`.

#### PPO reward-normalization units

The curriculum PPO path normalizes the combined per-step reward before GAE,
then normalizes the resulting value targets separately for critic training.
`reward_breakdown/terminal_fame_raw` records the additive terminal-fame reward
in environment units, while `reward_breakdown/terminal_fame_normalized` records
its marginal contribution after the reward normalizer's standard-deviation
scaling (`raw / std`; no mean subtraction for an individual component). These
two metrics are diagnostic only: the normalization algorithm is unchanged.
Time-limit bootstrap values are evaluated from the actual post-step state before
the Rust vector environment resets; natural game endings bootstrap with zero.

### TensorBoard

Training automatically logs to TensorBoard when installed (included in `.[rl]` extras).

```bash
# Compare all runs side-by-side:
./scripts/run-tensorboard
# Or manually:
tensorboard --logdir training/runs

# Import existing NDJSON logs into TensorBoard:
mage-knight-import-tb training/runs/baseline/training_log.ndjson
```

## Artifact Viewer

Flask web app for inspecting simulation artifacts (action traces, game state snapshots).

```bash
pip install -e ".[viewer]"
mage-knight-viewer
# Open http://127.0.0.1:8765
```

## Tests

```bash
source .venv/bin/activate
python3 -m unittest discover -s tests -p 'test_*.py'
```
