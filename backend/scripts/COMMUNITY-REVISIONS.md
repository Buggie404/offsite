Community report migration

All post, comment and account reports use one collection, `Reports`, distinguished by `target_type`: `post`, `comment`, or `account`. The PostReport, CommentReport and AccountReport model files are typed views of that same collection; they do not create separate collections. Legacy `profile` types are normalized to `account` by the migration.
Unique indexes enforce one report per reporter and target, including dismissed reports.

Before running the updated application against an existing database, stop report writes and run from `backend`:

```
node scripts/migrate-community-reports.js
node scripts/migrate-community-reports.js --apply
```

The first command previews counts without changing data. The second merges supported legacy collections, normalizes Mongo user IDs to public user IDs, and builds unique indexes. Source collections are retained for rollback; preexisting `Reports` rows are copied to `ReportsMigrationBackup`. Unsupported rows stop validation before writes. Do not run this migration while the old application is accepting reports.

Community point changes use MongoDB transactions, requiring a replica set (including Atlas). Post deletion/hide/unhide and point changes commit together. Pending points return to pending on unhide; previously posted points return to the spendable balance. The posting job does not credit deleted/hidden posts.

Admin actions:

```
POST /api/admin/community/users/:id/warn
POST /api/admin/community/users/:id/suspend
{ "reason": "Reason for moderation" }
```

Both require admin_cc/cskh and a nonempty reason, apply only to customers and write ActivityLogs. Warnings are saved on the user; suspension blocks authenticated API requests even for an already issued token.

Suggestions remain text/keyword based: posts use content, recipes use ingredient/tool names. Catalog cache TTL is five minutes; minimum score is 0.6. Image recognition is not implemented.
