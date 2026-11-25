#!/usr/bin/env python3
"""Export golden parity fixtures from pinned DeepTutor (commit 1284116).

Usage:
  # When running inside DeepTutor's Python >=3.10 + pydantic environment:
  python3 tools/parity/export_deeptutor_fixtures.py --upstream

  # Stdlib-only verification mode (Python 3.9+ without pydantic):
  python3 tools/parity/export_deeptutor_fixtures.py --stdlib-math
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_PATH = ROOT / "tools" / "parity" / "fixtures" / "deeptutor-1284116.json"
UPSTREAM_COMMIT = "1284116f92368480aef3a47f91b8df9e9b105062"

MASTERY_CASES = [
    [],
    [True],
    [True, True],
    [True, True, True],
    [False, True, True],
    [True, False, True, True],
    [False, False, True, True, True],
    [False, False, False, True, True, True, True, True],
    [0.5, 0.8, 1.0],
    [1.5, -0.2, 0.6, 0.9],
]

T0 = 1_700_000_000.0
DAY = 86400.0


def compute_mastery_ref(correctness):
    weights_all = (0.5, 0.7, 0.85, 0.95, 1.0)
    caps = {1: 0.5, 2: 0.8}
    if not correctness:
        return 0.0
    recent = correctness[-len(weights_all) :]
    weights = weights_all[-len(recent) :]
    score = sum(w * max(0.0, min(1.0, float(c))) for c, w in zip(recent, weights)) / sum(weights)
    return min(score, caps.get(len(recent), 1.0))


def scheduler_trace_ref():
    """Exact mirror of DeepTutor scheduler.py (1284116) for cross-checking TS math."""
    eps = 1e-6
    min_stab = 0.5
    fail_q = 0.5
    default_r = 0.9
    same_session = 0.25

    def stab_from_interval(days, desired):
        ret = min(max(desired, eps), 1.0 - eps)
        if days <= 0:
            return min_stab
        return max(min_stab, days / -math.log(ret))

    def interval_from_stab(stab, desired):
        ret = min(max(desired, eps), 1.0 - eps)
        return max(eps, max(stab, eps) * -math.log(ret))

    def retrievability(stab, last_review_at, next_review_at, now):
        anchor = last_review_at if last_review_at is not None else next_review_at
        elapsed_days = max(0.0, (now - anchor) / DAY)
        return min(1.0, max(0.0, math.exp(-elapsed_days / max(stab, eps))))

    # Trace: memory item -> initial at T0 -> pass at T0 -> pass at due1 -> fail at due2
    stability = stab_from_interval(0.0, default_r)
    difficulty = 0.3
    desired = default_r
    last_review_at = None
    next_review_at = T0
    consec_ok = 0
    consec_wrong = 0
    lapse_count = 0
    review_count = 0
    scheduled_after_failure = False

    steps = []
    for label, ts_mode, quality in [
        ("pass_initial", "t0", 1.0),
        ("pass_same_session", "plus_60s", 1.0),
        ("pass_at_due", "at_due", 1.0),
        ("fail_at_due", "at_due", 0.0),
    ]:
        if ts_mode == "t0":
            moment = T0
        elif ts_mode == "plus_60s":
            moment = last_review_at + 60.0
        else:
            moment = next_review_at

        prev_stab = max(stability, eps)
        prev_ret = retrievability(stability, last_review_at, next_review_at, moment)
        elapsed_days = max(0.0, moment - last_review_at) / DAY if last_review_at is not None else 0.0
        same_sess_days = min(same_session, interval_from_stab(prev_stab, default_r) * 0.5)

        if last_review_at is not None and elapsed_days < same_sess_days and quality >= fail_q:
            review_count += 1
            last_review_at = moment
            consec_wrong = 0
        else:
            spacing_ratio = min(elapsed_days / prev_stab, 4.0)
            outcome_error = (1.0 - quality) - difficulty
            surprise = prev_ret - quality
            difficulty = min(0.95, max(0.05, difficulty + 0.12 * outcome_error + 0.08 * surprise))
            if quality < fail_q:
                consec_wrong += 1
                consec_ok = 0
                lapse_count += 1
                ret_f = 0.55 - 0.25 * prev_ret
                diff_f = 1.0 - 0.25 * difficulty
                stability = max(min_stab * 0.1, prev_stab * ret_f * diff_f)
                if consec_wrong >= 2:
                    consec_wrong = 0
            else:
                consec_wrong = 0
                consec_ok += 1
                effort = 1.0 + (1.0 - prev_ret) * 1.5
                spacing_bonus = 1.0 + spacing_ratio * 0.15
                learnability = 1.35 - 0.6 * difficulty
                q_str = max(0.0, (quality - fail_q) / (1.0 - fail_q))
                growth = 1.0 + q_str * learnability * effort * spacing_bonus
                if quality >= 0.8 and consec_ok >= 2:
                    growth *= 1.15
                stability = max(min_stab, prev_stab * growth)
                if consec_ok >= 2:
                    consec_ok = 0
            review_count += 1
            last_review_at = moment
            scheduled_after_failure = quality < fail_q
            interval_days = interval_from_stab(stability, desired)
            if scheduled_after_failure:
                interval_days = min(interval_days, max(interval_days * 0.5, min_stab * 0.2))
            next_review_at = moment + interval_days * DAY

        steps.append(
            {
                "label": label,
                "moment": moment,
                "quality": quality,
                "stability": stability,
                "difficulty": difficulty,
                "next_review_at": next_review_at,
                "review_count": review_count,
                "lapse_count": lapse_count,
                "scheduled_after_failure": scheduled_after_failure,
            }
        )
    return steps


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--upstream", action="store_true")
    parser.add_argument("--stdlib-math", action="store_true")
    args = parser.parse_args()

    if args.upstream:
        import sys

        sys.path.insert(0, str(ROOT / "upstream" / "deeptutor"))
        from deeptutor.learning.mastery import compute_mastery

        mastery_fn = compute_mastery
    else:
        mastery_fn = compute_mastery_ref

    payload = {
        "upstream_commit": UPSTREAM_COMMIT,
        "mastery_cases": [
            {"input": case, "expected": mastery_fn(case)} for case in MASTERY_CASES
        ],
        "scheduler_memory_trace": {
            "t0": T0,
            "steps": scheduler_trace_ref(),
        },
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
