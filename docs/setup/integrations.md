# Zapier, Make and content-calendar import (E12-03)

Code and checklists: [`apps/integrations`](../../apps/integrations/README.md). Everything uses the public REST API with
the user's own API key (Settings → Developer), so there's **nothing to set up on staging or production**: no new
env vars, accounts or secrets on Railway.

## Content-calendar import (works today)

Users (or we, for the house channels) run it on their own machine against any ShortLoop app:

```sh
export SHORTLOOP_API_URL=https://web-staging-0f0b5.up.railway.app/api/v1
export SHORTLOOP_API_KEY=sl_...            # Settings → Developer → Create key
pnpm -F integrations import:calendar --csv calendar.csv        # dry run: checks rows, creates nothing
pnpm -F integrations import:calendar --csv calendar.csv --yes  # one Short per valid row (1 credit each)
```

| Variable                | Needed for      | What it is                                                                     |
| ----------------------- | --------------- | ------------------------------------------------------------------------------ |
| `GOOGLE_SHEETS_API_KEY` | `--sheet <id>`  | A Google API key with the Sheets API on; the sheet shared "anyone with link"   |
| `GOOGLE_ACCESS_TOKEN`   | `--sheet <id>`  | Instead of the key, for private sheets (e.g. `gcloud auth print-access-token`) |
| `NOTION_TOKEN`          | `--notion <id>` | An internal integration token; share the database with that integration        |

These live on the user's machine, never on our servers. A CSV from _File → Download → CSV_ (Sheets) or _Export →
Markdown & CSV_ (Notion) needs none of them.

**Columns** (case doesn't matter): `Topic` (required; also `Idea`, `Title`), `Angle`, `Length` (30/45/60, `45s`,
`0:45`), `Tone`, `Caption style`, `Image style`, `Voice`, `Channel voice`, `Topic ID`, `Date` (YYYY-MM-DD; Sheets dates
are read as dates) and `Status`. Rows whose Status is Done, Made, Published, Posted, Skip or Cancelled are skipped, as
are blank rows. Problems are reported per row with the column name (empty topic, bad length or caption style, bad
date, a topic repeated in the sheet). At most 50 Shorts per run (`--limit`), and the run stops early if the key is
rejected or credits run out. `--from today` skips past rows.

The Date column is checked and shown but not used for scheduling yet: creating a Short doesn't publish it, and
publishing still needs the user's approval in ShortLoop.

## Zapier (needs the owner to publish)

```sh
pnpm -F integrations build:zapier
cd apps/integrations/dist/zapier && npm install
npx zapier-platform-cli login      # the ShortLoop Zapier developer account
npx zapier-platform-cli register "ShortLoop"   # first time only; writes .zapierapprc (keep it out of git)
npx zapier-platform-cli push
```

Until it's published, the app is private: invite testers from the Zapier developer platform. Each Zap using
_Short Rendered_ registers one webhook on the user's account (max 5 per account) and removes it when the Zap is
turned off.

## Make (needs the owner to publish)

Create a custom app in Make and paste the generated blocks, as described in
[`apps/integrations/make/README.md`](../../apps/integrations/make/README.md). Make apps are private until approved;
share the invite link with testers meanwhile.

## Before submitting either app (owner)

The automated checklists pass. These need the owner:

1. A **Zapier developer account** and a **Make account** that own the apps.
2. The **production app URL** for the help texts and for reviewers.
3. **Logo** (Zapier 256×256 PNG, Make 512×512 PNG with a transparent background), **homepage**, **privacy policy** and
   **support email**.
4. A **test account** for the marketplace reviewers (an access code from `SHORTLOOP_ACCESS_CODES` works).
