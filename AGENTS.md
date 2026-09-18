# Repository instructions for coding agents

Read `PROJECT_STATUS.md` before making changes. It is the single authoritative
record of implementation status, feature maturity, current priorities, known
limitations, verification, and milestone completion.

For every implementation change:

1. Preserve unrelated working-tree changes.
2. Update the affected feature IDs and remaining gaps in `PROJECT_STATUS.md` in
   the same changeset.
3. Record current verification evidence; never repeat an old test result as if
   it describes the current tree.
4. Update README, PRODUCT, or DESIGN only when their distinct user, product, or
   visual-system truth changes.
5. Do not create another roadmap, TODO ledger, implementation plan, status
   report, or handoff. Consolidate durable status information into
  `PROJECT_STATUS.md` and use git history for superseded narrative.
