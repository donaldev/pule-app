# PonDon import attempt — not committed

4 November 2026 (America/Vancouver). One authorized attempt; stopped on failure. No retry, splitting, SQL modification or recovery action.

Confirmed linked project `pgljdmevusgvvlplaedt`, active PonDon `383bd6df-9050-4d1c-b48f-d2a0f3349517` and exact SQL SHA-256 `8fdc5472840a4c0a13bf2cceadf2f52a2a9ed7ef79160dba00b81f031640ee33`. Owner explicitly permitted the included single legacy_unknown rule record.

No configured `pule_pondon_import` libpq service was found at the usual local locations. Used installed CLI's supported SQL-file transport with the unchanged approved transaction:

```sh
npx --no-install supabase db query --remote --file data/legacy/pondon-preflight/approved-pending-import.sql --yes
```

CLI exited 1: `DbQueryUnexpectedStatusError`, HTTP **413**, `request entity too large`. This was an API payload-size rejection, not a reported SQL guard/constraint failure. No committed import exists.

Subsequent enforced read-only verification matched the before-attempt snapshot exactly:

- 0 nights / reported results / reported frames / canonical frames / detail-eligible frames / venues.
- No import batch, historical rule or private observation created.
- Group status/identity unchanged.
- Recorded account, group, membership, account-link and other-group session/frame fingerprints unchanged.
- SQL fingerprint unchanged.

Private execution/error and before/after verification evidence remains under ignored `data/legacy/pondon-preflight/`. No credentials or source payload are printed in this report. No Docker, backups, migrations, Auth creation, frontend changes or original workbook edits occurred.

Next possible resolution is the already documented direct operator `psql` connection, which streams the exact SQL without the CLI Management API request-size limit. No direct connection was configured or attempted, and no automatic retry is authorized by this report. Stop for owner review before another execution attempt. Do not split the transaction or bypass its guards.
