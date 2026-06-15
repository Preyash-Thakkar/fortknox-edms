# Fort Knox EDMS — Testing & Scalability Assessment

This is an honest engineering assessment of (1) how the code has and hasn't been
tested, (2) whether it is ready for a large-scale organization, and (3) whether
the gaps identified earlier were actually closed.

---

## 1. Testing status — read this first

### What has been verified
- **Route logic & permissions**, via an in-memory *stub* that imitates Mongoose.
  This checks that the right endpoints return the right status codes and that the
  view/download/grant permission math is correct.
- **Watermarking functions** (PDF via pdf-lib, image via sharp) — executed for real
  and confirmed to produce output.
- **Syntax / load** of the whole server and all dependencies.

### What has NOT been verified (important)
- **Anything against a real MongoDB.** The build environment blocks MongoDB binary
  downloads, so `mongodb-memory-server` cannot start here (confirmed: HTTP 403 on
  the binary URL). Therefore:
  - No real index usage has been observed.
  - No real query plans or performance have been measured.
  - No concurrency / race-condition behaviour has been tested.
  - The stub does NOT enforce schema validation, unique constraints, transactions,
    or realistic query semantics — so passing stub tests is weaker evidence than
    passing real tests.

### A real test suite is now included
`server.test.js` is a Jest + supertest + mongodb-memory-server suite that runs the
real app against a real (in-memory) MongoDB. It covers auth, cookie security,
rate limiting, role/department/per-user access, upload validation (including a
magic-byte executable-disguised-as-PDF case), audit immutability, and search.

**To run it (on a machine with internet access):**
```
cd backend
npm install
npm test
```
The first run downloads a MongoDB binary once. This is the test that should gate
any real deployment — please run it in your CI.

---

## 2. Is this ready for a large-scale organization? — No, not yet.

The application is a **correct, feature-complete prototype**. It is **not yet a
large-scale production system**, for concrete, fixable reasons below. I'd grade it
"solid internal tool for tens of users," not "enterprise vault for thousands."

### 2a. Critical scalability problems — STATUS

**P1 — `GET /assets` pagination — FIXED.** The endpoint now accepts `page` and
`limit` (default 25, capped at 100), returns `{ assets, page, limit, total,
totalPages }`, and fetches only one page. The frontend Repository view has Prev/
Next controls and a page indicator.

**P2 — `GET /stats` full scan — FIXED.** The non-admin "accessible" count is now
computed with a MongoDB aggregation (`$lookup` to department + `$match` mirroring
the view rules + `$count`), so it no longer pulls all assets into Node.

**P3 — Search regex full scan — FIXED.** A MongoDB text index on
`{ filename, keywords }` now backs search; queries of 3+ chars use `$text`
(weighted toward filename) and sort by text score. Very short fragments fall back
to an anchored regex on filename. For very large corpora, Atlas Search /
Elasticsearch remains the next step, but the unindexed full-collection scan is gone.

**P4 — Missing indexes — FIXED.** Added: `Asset { category, department, updatedAt }`,
`Asset { updatedAt }`, `Asset { allowedRoles }`, `Asset { userViewGrants }`,
`Asset` text index; `AccessRequest { requestedBy, status }`, `{ status, createdAt }`,
`{ asset }`; `Notification { user, read, createdAt }`; `AuditLog { timestamp }`,
`{ severity, timestamp }`, `{ userId, timestamp }`. (User email was already unique-
indexed; department name+category already compound-unique.)

**P5 — Audit log archival/pagination — PARTIAL.** Still capped at `.limit(300)` with
indexes now backing the sort/filter; date-range pagination, archival to cold
storage, and CSV export remain future work.

### 2b. Architectural limits — STILL OPEN (require infra, not just code)
- Local-disk file storage (move to S3/object storage).
- Synchronous watermarking in-request (move to a worker queue + cache).
- In-memory rate-limit/state (move to Redis for multi-instance).
These are deliberately left for an infrastructure decision; they change deployment
topology, not application correctness.

### 2c. Production-readiness gaps (not scale, but required for "real" use)

- No HTTPS enforcement / HSTS (cookie `secure` flag exists but must be turned on).
- No structured logging, metrics, health/readiness endpoints, or tracing.
- No automated DB backups or restore runbook.
- No CI pipeline running the test suite on every change.
- MFA was removed at your request — for an IP vault this is a real reduction; a
  large org will almost certainly need TOTP/WebAuthn reinstated.
- No password-complexity policy beyond an 8-char minimum; no account lockout
  (only IP rate-limit); no session revocation list.

### Rough capacity read (honest estimate, not measured)
- **As-is:** comfortable up to perhaps a few hundred documents and a few dozen
  concurrent users on one modest server.
- **With P1–P5 fixed + object storage + a queue for watermarking:** can credibly
  serve a large organization (hundreds of thousands of documents, hundreds of
  concurrent users) when run as multiple instances behind a load balancer with a
  managed MongoDB (replica set) and Redis.

---

## 3. Gap analysis — was the earlier list actually fulfilled?

From the feature gaps I called out earlier, here is the honest status **in code**:

| Gap I identified earlier | Status now |
|---|---|
| MFA was fake (fixed 000000) | **Removed** at your request (note: this lowers security) |
| No login rate limiting | **Done** (express-rate-limit; in-memory — move to Redis for multi-instance) |
| No forced first-login password change | **Done** |
| No self-service password change | **Done** (profile dialog) |
| JWT in localStorage (XSS risk) | **Done** — now httpOnly cookie |
| No upload malware/type checks | **Partial** — type allow-list + signature scan done; not a real AV engine |
| Restrict to PDF/Word/Image/Gerber/CAD | **Done** |
| No search | **Done** functionally; **not scalable** (regex, see P3) |
| No delete/edit of files | **Done** (admin) |
| No notifications | **Done** (in-app + best-effort email) |
| Access requests permanent & role-wide only | **Done** — now per-user grants with revoke |
| No bulk operations | **Done** (bulk upload, move/copy) |
| Department permissions coarse | **Done** — per-department view/download restrictions |
| No pagination on lists | **NOT done** — still a gap (P1, P5) |
| Server-side rasterization for true view-only | **Partial & honest** — real watermarking for PDF/image; CAD/Gerber/Word cannot be previewed inline (no reliable server renderer), so they are view-only-with-gated-download, not rendered |

**Net:** the *feature* gaps from the earlier analysis are essentially all addressed
(with the honest caveats noted). The gaps that remain are the **non-functional /
scalability** ones in section 2, which the earlier feature-focused analysis did not
fully cover — and which matter most for "a large-scale organization can use it."

---

## 4. Recommended path to production (in priority order)
1. Run `npm test` in CI; do not deploy on red.
2. Add the missing indexes (P4) and pagination (P1, P5).
3. Fix the `/stats` and search full-scans (P2, P3 — text index).
4. Move file storage to S3-compatible object storage with signed URLs.
5. Move watermarking to a background queue; cache renders.
6. Externalize rate-limiting/state to Redis; run multiple instances behind a LB.
7. Reinstate a real second factor (TOTP/WebAuthn) and add real AV scanning.
8. Add HTTPS/HSTS, structured logging, metrics, health checks, and DB backups.

None of these are blocking for a pilot with a small team. All of them matter before
an organization-wide rollout protecting real IP.
