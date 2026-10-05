# Member Editing — Design

**Date:** 2026-09-29
**Status:** Draft for review

## Goal

Let an administrator correct a member's name, contact details and address
from the Members screen, in a dialog, without waiting for the next Supreme
roster export. Today the roster import is the only way a member row changes.

## Decisions

| Decision | Choice |
| --- | --- |
| Edit style | A dialog, opened from an **Edit** button on each Members table row and on the member's page. No inline cell editing |
| Editable fields | Name, contact and address (listed below). The membership number is shown, never editable |
| Primary email | Changes the member record only. The sign-in email in `auth.users` is left alone, so the two may differ |
| Access | `members.manage`. Without it, no Edit controls render and the database refuses the write |
| Audit | A `member_edits` log of who changed which fields and when, with field names only, never values |

## Fields

| Section | Field | Column | Stored |
| --- | --- | --- | --- |
| Name | Prefix | `prefix` | plain |
| | First name (required) | `first_name` | plain |
| | Middle name | `middle_name` | plain |
| | Last name (required) | `last_name` | plain |
| | Suffix | `suffix` | plain |
| Contact | Primary email | `primary_email` | plain |
| | Secondary email | `email_secondary_enc` | encrypted |
| | Cell phone | `phone_cell_enc` | encrypted |
| | Home phone | `phone_residence_enc` | encrypted |
| | Business phone | `phone_business_enc` | encrypted |
| Address | Address line 1 | `address_line1_enc` | encrypted |
| | Address line 2 | `address_line2_enc` | encrypted |
| | City | `city` | plain |
| | State | `state` | plain |
| | Postal code | `postal_code_enc` | encrypted |
| | Country | `country` | plain |
| | Second address | `secondary_address_enc` | encrypted |
| | Bad address | `bad_address` | plain boolean |

Encrypted columns use `extensions.pgp_sym_encrypt(value, kit.members_pii_key())`,
as the roster import does.

## Rules

- Every text value is trimmed. An empty string is stored as `null`.
- First and last name are required; a blank one is refused.
- Emails must match `^[^@\s]+@[^@\s]+\.[^@\s]+$`.
- Length limits: names 100, emails 254, phones 40, address lines, city,
  state and country 200, postal code 20, second address 500.
- Only the fields sent are changed; a field not sent keeps its value.
- `updated_at` is set on every successful edit.
- **Roster imports.** `member_upsert_from_roster` fills blank fields only and
  never changes a name, so an edit survives the next import. A field an
  administrator clears may be filled again by the next import. The dialog's
  Contact and Address sections say so in one line.

## Data

One additive migration.

### `public.member_edits`

| Column | Contents |
| --- | --- |
| `id` | primary key |
| `member_id` | the member (`on delete cascade`) |
| `edited_by` | `auth.users` (`on delete set null`) |
| `fields` | `text[]`, the column names changed |
| `edited_at` | `timestamptz not null default now()` |

RLS enabled, no policies, every privilege revoked from `anon` and
`authenticated`. It is written only by `member_update` and has no reader yet.

### Functions

Both are `security definer`, `set search_path = ''`, revoked from `public`
and `anon`, and granted to `authenticated`.

| Function | Gate | Purpose |
| --- | --- | --- |
| `public.member_for_edit(p_member_id uuid)` | `members.manage` | Returns one row with the membership number and every field above, decrypted. Unknown id raises `P0001` `unknown member` |
| `public.member_update(p_member_id uuid, p_changes jsonb)` | `members.manage` | Locks the row `for update`, validates and applies the keys present in `p_changes`, encrypting as needed, and writes one `member_edits` row listing the keys whose values actually changed. An unknown key, a blank required name, a bad email or an over-long value raises `P0001` with a readable message. A call that changes nothing writes no log row |

`p_changes` keys are the column names in the table above, with the
encrypted ones named without `_enc` (`address_line1`, `phone_cell`, …).
`bad_address` takes a JSON boolean.

## Application

- **`@kit/members` schema:** `MemberEditSchema` (zod) mirrors the rules above,
  so the dialog shows errors before a round trip. The database stays the
  authority.
- **Service:** `MembersService.getForEdit(id)` and
  `MembersService.update(id, changes)` call the two functions.
- **Server actions:** `loadMemberForEditAction({ memberId })` and
  `updateMemberAction({ memberId, changes })`, via `enhanceAction`. They
  return `{ success: true, … } | { success: false, error }` and never throw
  for an expected failure, like the existing members and RBAC actions.
- **Dialog:** `MemberEditDialog` (react-hook-form + zod, following
  `create-user-dialog.tsx`).
  - It opens with a loading state, fetches the values, and fills the form.
  - It has three fieldsets: Name, Contact and Address.
  - The membership number is shown read-only in the title.
  - Save sends only the dirty fields. It is disabled while nothing has
    changed or a save is in flight.
  - On success: a toast "Member updated.", the dialog closes, and
    `router.refresh()` redraws the list or page.
  - On failure: the error is shown in the dialog, and the form keeps its
    values.
- **Members table:** when the viewer has `members.manage`, a last column
  holds an **Edit** button per row (`data-test="member-edit-<id>"`).
- **Member page:** an **Edit** button in the header, under the same
  condition.

## Testing

- **pgTAP:**
  - both functions refuse a caller without `members.manage`;
  - `member_for_edit` round-trips every encrypted field;
  - a partial update changes only the given fields;
  - blank first or last name, a bad email, an over-long value and an unknown
    key are each refused;
  - an empty string clears a field;
  - `member_edits` records the changed field names and the editor, and no row
    is written for a no-op;
  - a roster re-import after an edit keeps the edited name and the edited
    phone;
  - `member_edits` is unreadable by `authenticated`.
- **Vitest:**
  - `MemberEditSchema`: trimming, required names, email shape, lengths;
  - the dirty-fields diff helper;
  - both actions, using the existing fake Supabase client: success, a
    database error returned as a value, and refusal without the permission.
- **Playwright:**
  - an administrator imports a one-row roster, edits the cell phone and
    city, and sees them in the Members table;
  - a user with `members.view` only sees no Edit button.

## Out of scope

- Inline cell editing
- Editing the membership number, dues fields (already on the member page) or
  account linkage
- Changing the sign-in email
- A screen for reading `member_edits`
- Protecting an edited field from a future import that *overwrites*, since no
  import overwrites today
