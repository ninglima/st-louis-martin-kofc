# Member Roster Import & Members List — Design

**Date:** 2026-09-22
**Status:** Approved for planning

## Problem

The Financial Secretary has no way to get the Supreme Council roster into this
app. The council's WordPress site solved this once already — see
`github.com/ninglima/KofC-15256`, `docs/superpowers/specs/2026-09-01-roster-import-design.md`
— and that implementation is the single most valuable input to this one,
because it shipped, ran against the real roster, and had two defects found
*after* release. Both are reproduced as hard rules below rather than
rediscovered.

The source file is an Officers Online **Contact Extract**: a native `.xlsx`,
one sheet, 27 columns, ~372 rows. Its shape, measured against the real
sample (367 members at the time):

- **Always present:** Membership Number (unique, no duplicates), First Name,
  Last Name, Address Line 1, City, State/Province, Postal Code, Country
  (all `US`), Primary Type.
- **Nearly always:** Primary Email — 365 of 367. **Two members have none.**
- **Common:** Middle Name (286), Cell Phone (260), Residence Phone (232),
  Business Phone (88), Prefix (72).
- **Sparse:** Suffix (23), Address Line 2 (14), Secondary Email (12),
  `Fraternal - Bad Address` (7, value `X`), secondary address (6).
- **Always empty:** Tertiary Email, Address Line 2 (Secondary).

**The extract carries no dues, level, status, or join date.** It is contact
data only. Every dues-related decision below follows from that.

## Goals

- The Financial Secretary uploads the extract **as exported**, with no
  reshaping in Excel.
- Show exactly what an upload will change **before** anything is written, and
  exactly what it did afterwards.
- Safe to re-run monthly: no duplicates, and no member's own corrections
  destroyed.
- An officer-facing members list, so the roster is verifiable and usable.
- Member PII protected at rest beyond Supabase's default disk encryption.

## Non-goals

Each gets its own spec.

| Deferred | Why |
| --- | --- |
| Dues tracking and payment recording | The extract contains no dues data; needs its own source of truth |
| Unpaid / funds-raised dashboards | Depend on dues tracking existing first |
| A member-visible directory | Exposing 372 home addresses to every member is a separate consent decision |
| Bulk invitation emails | Accounts are created silently; deciding to email 372 people is its own action with its own approved copy. Transactional mail is moving to Resend via Supabase — that spec owns delivery, this one only guarantees import sends nothing |
| Syncing Stripe/Square payments into Supabase | Planned via Make.com in its own spec. It is the likeliest source of the dues state this importer is forbidden to invent |
| Editing member records in the UI | Import + read only for now |

**Never in scope:** auto-deactivating members absent from an uploaded file.
Departures, transfers, suspensions and deaths are reported for a human to act
on. The importer never deletes or deactivates.

## Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Member identity | Import creates a Supabase auth user **and** a `members` row | User's decision. Members exist as real accounts from day one. |
| PII at rest | pgcrypto, key in Supabase Vault, selective columns | pgsodium TCE is deprecated by Supabase; pgcrypto and `supabase_vault` are already installed on this project |
| Parsing | `exceljs`, server-side | Maintained and on npm. SheetJS's npm build is stale and has carried prototype-pollution CVEs since distribution moved off npm |
| Upload transport | Server action with `FormData` | Matches the repo's convention; needs `serverActions.bodySizeLimit` raised to `5mb` |
| Plan storage | `roster_imports` table | Survives restarts and doubles as a permanent import history. WordPress used a 12-hour transient and lost it |
| Match key | Membership Number, email as fallback | Stable and unique; a changed email becomes an update, not a duplicate |

## What this encryption does and does not protect

Stated plainly so nobody later assumes more than is true.

**Protects against:** a leaked database dump, a backup, or a stolen table
export. Those yield ciphertext for the encrypted columns.

**Does not protect against:** a compromised `SUPABASE_SERVICE_ROLE_KEY`. The
app must decrypt to render the members list, so anything that can act as the
app can read the plaintext. It also does not protect against a Postgres
superuser, who can read the Vault key.

**Primary email is deliberately left plaintext.** The same address sits in
`auth.users` because import creates accounts. Encrypting it in `members`
would be theatre.

### Column split

| Plaintext (RLS only) | Encrypted (pgcrypto + Vault key) |
| --- | --- |
| `membership_number`, `first_name`, `middle_name`, `last_name`, `prefix`, `suffix` | `address_line1`, `address_line2`, `postal_code` |
| `primary_email`, `city`, `state` | `phone_cell`, `phone_residence`, `phone_business` |
| `country`, `bad_address`, `primary_type` | `email_secondary`, `secondary_address` (JSONB) |
| `user_id`, roster stamps | |

Encrypted columns cannot be searched, sorted or indexed. The split exists so
the members list can search name / member number / email and filter by city
and dues status without decrypting all 372 rows per query.

Encrypted values are written and read only through `security definer`
functions that fetch the key from `vault.decrypted_secrets`. The key is never
handed to the application.

## Data model

### `members`

One row per member on the Supreme roster.

- `id uuid pk`, `membership_number text not null unique` — the match key
- `user_id uuid references auth.users on delete set null` — nullable: the two
  emailless members have no account, and an account can be deleted without
  losing the roster record
- Plaintext and encrypted contact columns per the split above
- `roster_last_seen_at timestamptz`, `roster_source_file text` — stamped only
  on rows actually created or updated, so a skipped row keeps the last import
  that really did contain them
- `created_at`, `updated_at`

### `roster_imports`

- `id uuid pk`, `uploaded_by uuid references auth.users`
- `filename text`, `status text` — `pending` | `previewed` | `applying` |
  `complete` | `failed`
- `plan jsonb` — the classified rows, written before anything is applied
- `results jsonb` — created / updated / unchanged / skipped / conflicts
- `created_at`, `completed_at`

### RLS

Both tables live behind RLS keyed to a new `members` section in the RBAC
registry (`packages/features/rbac/src/types/sections.ts`):

```
key: 'members'
label: 'Member Roster'
description: 'View: the council member list. Manage: import the roster'
verbs: ['view', 'manage']
```

- `members.view` → read the members list
- `members.manage` → upload and apply an import
- A member may always read **their own** row (`user_id = auth.uid()`)
- No anon or authenticated grants on the encrypted-column functions

The Financial Secretary role is created in the existing Roles UI and granted
`members.manage`; no code change is needed to define it.

## Column mapping

Headers are matched **by name, case-insensitively and trimmed** — never by
position, because a future export could reorder columns.

**Required headers:** `Membership Number`, `First Name`, `Last Name`,
`Primary Email`. A missing required header fails the upload immediately,
naming the header, before any preview is generated and before any write.
Unrecognized extra columns are ignored silently.

**Normalization:**

- Email trimmed and lowercased. The real sample is full of `PABRAHAM@PJILAW.COM`.
- Phones reduced to digits and formatted `(703) 477-4236`. Non-US-shaped
  numbers are stored unformatted rather than mangled.
- State uppercased and validated against a US state list.
- ZIP preserved as-is including ZIP+4.
- Names trimmed, **case left untouched**. The sample contains `Iii` where
  `III` was meant; silently "fixing" case would be guessing.

## Matching, skips and conflicts

**Match order:** `membership_number`, then `primary_email`. An email match on
a member with no number attaches the number, so manually-created records are
absorbed rather than duplicated.

**Rows are skipped, with the reason shown in preview and results, when:**

| Condition | Reason surfaced |
| --- | --- |
| Blank Membership Number | Cannot identify the member |
| Blank or malformed Primary Email | No email address — create manually |
| Email already belongs to a different member number | Conflict, needs a human |
| Member number appears twice in the file | Duplicate row in file |
| Primary Email appears twice in the file | Duplicate email in file |

The two emailless members fall into row two and are **reported, not silently
dropped**. Supabase auth requires an email or phone, so they cannot get
accounts — the same wall WordPress hit.

### Three rules that are safety properties, not preferences

**1. Fill blanks only.** A contact field is written only where the record
currently holds nothing. Where both sides have a value and they differ, the
stored value wins, nothing is written, and the field is listed as a conflict.
This is what makes a monthly re-import safe: a member who corrects their own
phone number never has it reverted.

**2. An import never changes dues state.** Not level, not expiry, not
paid-through — regardless of whether the member currently has any. *This rule
exists because the WordPress build got it wrong.* It treated "no active
level" as "new member", but a lapsed non-payer is indistinguishable from a
never-leveled member to that query. Every monthly re-import would have
silently marked lapsed members current with a fresh paid-through date and no
payment made, quietly emptying the list an officer uses to chase them. A
member who needs a level goes through checkout, never through the importer.

**3. A changed email is a conflict, never an auto-update.** The account is
matched and updated, but the email change is surfaced for a human to apply.
*The WordPress build omitted email from its field-diff map entirely*, so a
changed email was invisible in both preview and results — neither written nor
reported. Caught in review, not by design.

**Members present in the database but absent from the file** are listed under
"not on this roster" and otherwise untouched. Computed only over records that
hold a `membership_number`, so manually-created accounts and officer logins
are not flagged every month.

## Import flow

1. Financial Secretary opens `/home/members/import` (guarded by
   `members.manage`).
2. Form: file input accepting `.xlsx`/`.csv`, plus a nonce-equivalent (the
   server action's own CSRF protection).
3. Server action validates permission, extension, a 5 MB ceiling and a
   5,000-row ceiling, then parses from memory. **The file is never written to
   storage.**
4. Parser normalizes and validates each row; the planner classifies each as
   `create`, `update`, `nochange` or `skip` with a reason, recording
   field-level conflicts.
5. The plan is written to `roster_imports.plan` with status `previewed`.
   **Nothing else has been written.**
6. Preview renders counts by classification, every skip with its reason, every
   conflict, and the absent-from-file list.
7. On confirm, the client posts chunks of 25 plan rows to an apply action.
   Permission is re-checked on every chunk, not trusted from the upload.
8. Results are written to `roster_imports.results`, rendered, and downloadable
   as CSV.

**Auth account creation is silent.** Supabase's admin `createUser` sends no
email, unlike `inviteUserByEmail`. Inviting members is a separate, explicit
action in a later spec.

## Members list

`/home/members` (guarded by `members.view`).

- **Columns:** Name, Member #, Email, Phone, City, Last seen on roster,
  account status. Dues columns arrive with the dues spec.
- **Controls:** search across name / email / member number; filter by city and
  by account status; sort by name; 50 per page.
- **Flags:** bad-address marker for members Supreme has flagged, and a
  no-email marker for records that cannot receive mail.
- **Export CSV** of the current filtered set, permission-checked server-side.

At 372 members, performance is a non-issue. Phone is an encrypted column, so
it is decrypted per rendered page (50 rows), not across the whole table.

## Error handling and idempotency

**Idempotency is the property that makes this safe.** Because matching is on
the membership number, re-running an identical file creates nothing — every
row resolves to `update` or `nochange`.

- A parse failure changes no state. The officer sees the error; the database
  is exactly as it was.
- A row that errors during apply is collected into results rather than
  aborting its chunk. One bad row cannot cost the other 371.
- A chunk that fails leaves the plan in `roster_imports`. Re-running processes
  what did not land and no-ops on what did.

**Known risk:** creating ~372 auth users will meet Supabase's auth rate
limits. Chunking plus retry-with-backoff is the mitigation, but the first real
run may need the chunk size or delay tuned. This is called out here so it is
expected rather than discovered at account 300.

## Testing

- **Parser, normalizer and planner take no Supabase dependency**, so they are
  unit-testable with vitest against synthetic fixtures. This is the same
  decoupling the WordPress version used, and it is why that build could be
  tested without test infrastructure.
- **Fixtures are synthetic and generated**, roughly 20 rows reproducing the
  edge cases the real extract contains: a missing email, sparse cells, an
  uppercase email, ZIP+4, the bad-address flag, a duplicate email, a duplicate
  member number, and an unrecognized extra column.
- **Database-touching tests** assert: import a fixture and check counts;
  re-import and assert idempotency; assert fill-blanks-only leaves a member's
  own edit intact; **assert that an import does not alter dues state**;
  assert an encrypted column round-trips and is unreadable without the key.
- A Playwright spec covers upload → preview → confirm → results, and asserts
  that a non-permitted role cannot reach either route.

**The real extract is member PII and must never be committed to this
repository.** It is referenced here by shape only.

## Open questions

- **Where dues state will come from** is the next spec's central question. The
  extract has none, and rule 2 above means the importer must never invent it.
- **The two emailless members** need a runbook answer (create manually, or
  leave as roster-only records with no account). A process question, not a
  code one.
