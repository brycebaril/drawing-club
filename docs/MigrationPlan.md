# **Migration Plan: Legacy System → Life Drawing Society Scheduling System**

## **1. Overview & Scope**

The organization currently runs a legacy system that serves two purposes:

1. It holds existing **member, membership history, booking, and transaction data** that needs to be migrated into the new system's Postgres database (Design Doc §13) as a **one-time cutover**.
2. It is also the **model-request system** that, per Design Doc §11, will **stay in active, ongoing use** — models continue submitting availability/requests there, and the Model Booker volunteer manually mirrors assignments into the new system. This is an intentional, permanent (Phase 1) workflow, not a migration gap.

**This plan covers only (1).** No ongoing sync/bridge to the legacy system is being built — access is a database backup/dump rather than a live connection, which rules out a bridge anyway, and Design Doc §11 already specifies manual dual-entry as the intended model workflow. Model roster synchronization is explicitly listed as an open question in Design Doc §14 and is out of scope for this migration plan.

## **2. What Migrates**

Based on the new system's draft schema (Design Doc §13):

* **Users & Accounts** — usernames, contact info, base role, active/suspended/banned status. Password migration needs its own decision (§5 below) since the legacy system's hashing scheme is unknown until the dump is available. Volunteer sub-role assignments migrate into `Volunteer_Roles` (Design Doc §13) — since a person can hold multiple sub-roles, this is a good opportunity to correct any "primary role only" flattening the legacy system may have forced.
* **Membership History** — `valid_from`/`valid_until` spans, to preserve the audit trail of who held Paid Member status when (Design Doc §5.3).
* **Sessions** (historical) — past session records, if the org wants historical attendance data available in the new system's reporting (Design Doc §10), rather than just a fresh start on scheduling.
* **Passes** — any currently *unused* passes members are owed need to carry forward as real, spendable records in the new system (not just a balance number), so the pass lifecycle (Design Doc §6.1) continues working correctly post-cutover.
* **Transactions** — historical purchase records, for continuity of financial reporting and reconciliation (Design Doc §7, §10). These are audit-sensitive; see §6 (Validation) below.
* **Model Roster** — the `Models` table (Design Doc §13) already has a `legacy_id` field specifically for this: migrate model names and contact info from the legacy system so the Model Booker and Admins aren't manually re-entering the existing roster from scratch. This is a one-time roster copy only — it does not imply any ongoing sync, since model *requests* stay on the legacy system per §1 above.

## **3. Status: Blocked on Legacy Schema**

**This plan cannot be finalized yet.** Access to the legacy data is a database backup/dump rather than live access, and the actual schema/field names/data quality of that dump haven't been reviewed. The field-by-field mapping table (legacy → Design Doc §13 draft schema) is the single largest piece of migration work and can't be written without the dump in hand.

**Action item for the organization:** provide the legacy database dump (or, as a first pass, a redacted schema-only export plus a small sample of representative rows) so the mapping phase below can start.

## **4. Phases**

1. **Schema mapping** *(blocked — see §3)*. Map every legacy field the org wants carried forward to its destination in the new schema; identify fields with no clean destination (may need a new column, or may be dropped with sign-off) and fields the new schema needs that the legacy system doesn't have (may need to be backfilled or defaulted).
2. **Data cleaning & normalization.** Legacy exports from ad hoc/older systems commonly need: de-duplication, email/username normalization, date/timezone reconciliation, and reconciling any orphaned records (e.g. a transaction referencing a deleted user).
3. **Trial import into staging.** Run the migration scripts against the `staging` environment (`ArchitectureDocument.md` §4) using the actual dump — not synthetic test data — so the rehearsal surfaces real data-quality issues before they hit production.
4. **Reconciliation & validation** (see §6).
5. **Cutover.** A defined freeze window on the legacy system's *member/booking/transaction* data (the model-request portion keeps running throughout, since it's staying in use per §1): take a final delta export, import it, validate again, then flip the new system to authoritative for members/bookings/transactions.
6. **Rollback plan.** If post-cutover validation fails, the legacy system's member/booking/transaction data remains untouched (migration is read-only against the source), so rollback means reverting to the legacy system as authoritative and re-running cutover after fixing the identified issue — not a destructive recovery.

## **5. Open Question: Password Migration**

Passwords can't be migrated in plaintext, and the legacy system's hashing algorithm is unknown pending the schema review (§3). Two realistic options once that's known:
* If the legacy hash format is one the new stack can verify against (e.g. bcrypt), migrate the hash as-is and let users log in normally — the new system re-hashes with argon2id (`SecurityDocument.md` §2) transparently on next successful login.
* If the format is incompatible or unknown, force a password reset for all migrated accounts on first login instead of guessing.

## **6. Validation**

Because transactions and audit history are financially sensitive, validation goes beyond row counts:
* Row-count reconciliation per table between source dump and imported data.
* Spot-checks against legacy-side reports (if the legacy system can produce a membership roster or revenue report, compare its totals against the imported data's totals).
* Financial totals reconciliation: sum of migrated `Transactions.amount_paid` (and `net_amount` where available) should match whatever financial summary the organization's treasurer already has for the relevant period — this is the most important check before cutover, given how the design doc treats transaction records as an audit-sensitive source of truth (Design Doc §7.1, §10).
* Spent vs. unused pass balances reconciled against whatever the legacy system reports as each member's current balance, since an incorrect migrated balance directly affects a member's ability to book sessions post-cutover.
