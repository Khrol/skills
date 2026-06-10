# Ground truth for calc-project

This file is for the eval **grader** only. The agent under evaluation must not
read it (the eval prompt says to ignore it).

| Test | Expected verdict | Why |
|---|---|---|
| `test_add` | OK | `add` is exercised only here; e.g. `return a - b` breaks just this test. |
| `test_clamp_upper` | OK | Only test touching `clamp`; mutating the `value > high` branch breaks just this test. |
| `test_discount_vacuous` | SUSPECT | Swallows all exceptions and asserts a tautology; no source mutation can fail it. |
| `test_format_price` | COUPLED (sibling: `test_format_price_dup`) | Identical assertion on `format_price(3)`; any mutation breaking one breaks both. |
| `test_format_price_dup` | COUPLED (sibling: `test_format_price`) | Same as above, mirrored. |
| `test_normalize_identity` | BASELINE, marked **root** (siblings: `test_normalize_strips`, `test_normalize_lowercases`) | `"abc"` is a fixed point of both `strip` and `lower`; any general mutation that changes `normalize("abc")` also changes the siblings' outputs (all expect `"abc"`), so the root can never fail alone. |
| `test_normalize_strips` | OK, marked **sibling of `test_normalize_identity`** | Dropping `.strip()` (e.g. `return text.lower()`) fails only this test. |
| `test_normalize_lowercases` | OK, marked **sibling of `test_normalize_identity`** | Dropping `.lower()` (e.g. `return text.strip()`) fails only this test. |

## BASELINE root/sibling marking (required)

The report must make the baseline group structure explicit:

- The root test (`test_normalize_identity`) is marked as the **root** of its
  baseline group — not merely labelled BASELINE.
- Each sibling (`test_normalize_strips`, `test_normalize_lowercases`) is
  marked as a **sibling of the concrete root** — the root test must be
  identifiable from the sibling's row (by test name or test number), not
  just a generic "baseline sibling" label.

## Coverage gaps the skill should report

- `safe_div` — no test calls it at all (primary expected gap).
- `clamp`'s lower-bound branch (`value < low`) is also reasonable to flag:
  `test_clamp_upper` exercises only the upper bound (`clamp(15, 0, 10)`) and
  the pass-through case (`clamp(5, 0, 10)`); the `value < low` branch is
  never executed.

## Invariants (architecture-agnostic)

- After the run, every file under `calc/` and `tests/` is byte-identical to
  this fixture (all mutations reverted).
- The full suite (8 tests) passes at the end of the run.
