# Actions regression — state matrix

**Date:** 2026-07-12  
**Scope:** `src/lib/candidates/actionPolicy.ts`, `actionPolicy.test.ts`, `CandidateDetailView` wiring  
**Command:** `npx tsx --test src/lib/candidates/actionPolicy.test.ts`  
**Result:** **PASS** — 7/7 tests, 0 failures  
**Code changes:** none (report only)

---

## Pass/fail matrix

| State | Required visible | Policy result | Test | Detail wiring | Verdict |
|-------|------------------|---------------|------|---------------|---------|
| **NEW** | Approve, Save, Reject | `approve`, `save`, `reject` | PASS | Renders labels; `apiAction` → `decideCandidate` | **PASS** |
| **NEEDS_REVIEW** | Approve, Save, Reject | same as NEW | PASS | same | **PASS** |
| **APPROVED** | Reject, Save, Restore; **no** Approve | `reject`, `save`, `restore` | PASS | no Approve button | **PASS** |
| **REJECTED** | Approve, Save, Restore; **no** Reject | `approve`, `save`, `restore` | PASS | no Reject button | **PASS** |
| **SAVED_FOR_LATER** | Unsave, Approve, Reject, Restore; **no** Save | `approve`, `reject`, `unsave`, `restore` | PASS | Unsave label; `apiAction: "restore"` | **PASS** (see gap) |

### Extra statuses (covered by tests, outside requested matrix)

| State | Policy | Verdict |
|-------|--------|---------|
| EXPIRED / DUPLICATE / ERROR | Restore only | PASS (defined fallback) |

---

## CandidateDetailView wiring

- Source of truth: `const actions = getCandidateActions(candidate)`.
- Buttons: `onClick={() => void apply(action.apiAction)}` — uses policy `apiAction`, not `id`.
- Unsave correctly maps to decision verb `restore` (same as Restore).
- Secondary restore uses smaller ghost styling via `priority === "secondary"`.
- Mobile sticky bar and desktop action row both call `renderActionButtons` from the same policy list.

No hard-coded per-status action lists in the detail view.

---

## Gaps / notes (not test failures)

### 1. Unsave + Restore duplicate (SAVED_FOR_LATER) — **documented gap**

For `SAVED_FOR_LATER`, the matrix intentionally lists both:

- **Unsave** (`id: "unsave"`, primary) → `apiAction: "restore"`
- **Restore to queue** (`id: "restore"`, secondary) → `apiAction: "restore"`

Both buttons hit the same API and the same detail side effects (`unseeCandidate`, `insertIntoQueue`). Labels differ; behavior does not. Spec/tests require both IDs present, so this is a **UX redundancy**, not a matrix miss.

**Options (future, out of scope):** drop secondary Restore when Unsave is shown; or make Unsave a dedicated API if semantics diverge.

### 2. Queue swipe filters restore/unsave

`SwipeDeck` keeps only `approve` / `reject` / `save` from the policy. Fine for NEW/NEEDS_REVIEW queue cards; Unsave/Restore are detail/history surfaces.

### 3. APPROVED “Save/Unsave”

Requested wording: “Reject, Save/Unsave, Restore”. Policy shows **Save** (not Unsave) on APPROVED — correct, since Save is status `SAVED_FOR_LATER`, not a toggle flag. Unsave only appears when already saved.

---

## Test coverage summary

| Assertion | Status |
|-----------|--------|
| NEW / NEEDS_REVIEW = approve, save, reject only | PASS |
| APPROVED excludes approve; has reject, save, restore | PASS |
| REJECTED excludes reject; has approve, save, restore | PASS |
| SAVED_FOR_LATER excludes save; has unsave, approve, reject, restore; unsave→restore API | PASS |
| restore priority secondary when present | PASS |
| no no-op current-state primary (approve/reject/save) | PASS |
| every status returns ≥1 action | PASS |

---

## Verdict

**Overall: PASS** against the requested state matrix.  
Only notable gap: **Unsave and Restore are functionally duplicate** on `SAVED_FOR_LATER` (both `apiAction: "restore"`).
