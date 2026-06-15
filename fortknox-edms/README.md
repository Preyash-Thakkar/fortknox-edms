# Fort Knox EDMS — v2

Secure enterprise document/IP vault (MERN: React + Express + MongoDB).

## IMPORTANT: start from a fresh database
The v2 schema changed significantly (new fields: keywords, fileType, per-user
grants, department permissions, notifications, mustChangePassword). Point
MONGO_URI at a fresh/empty database (or drop the old one) before first run, or
old records will misbehave.

## Run

Backend:
    cd backend
    npm install
    npm start            # http://localhost:5000  (seeds demo data on first run)

Frontend (separate terminal):
    cd frontend
    npm install
    npm start            # http://localhost:3000

## Demo accounts (MFA removed — just email + password)
- admin@edms.local / Admin@123      (Admin)
- eng@edms.local   / Eng@123        (Engineering — can download Technical)
- legal@edms.local / Legal@123      (Legal — view-only on patents)
- mgmt@edms.local  / Mgmt@123       (Management)

Seed accounts skip the forced password change so demo logins work immediately.
Newly created users get a one-time temp password and must change it at first login.

## Environment variables (backend/.env)
    PORT=5000
    JWT_SECRET=change_me_to_a_long_random_string
    JWT_EXPIRES=8h
    MONGO_URI=mongodb://127.0.0.1:27017/fortknox
    CLIENT_ORIGIN=http://localhost:3000     # must match the frontend origin (cookies)
    COOKIE_SECURE=false                      # set true when served over HTTPS
    # Encryption at rest (REQUIRED in production):
    FILE_ENCRYPTION_KEY=<64 hex chars>       # 32-byte AES-256 key; see "generate" below
    # Where encrypted files live. Put this OUTSIDE the app/web root in production:
    VAULT_DIR=/var/lib/fortknox/vault        # default: backend/uploads
    VAULT_TEMP_DIR=/var/lib/fortknox/tmp     # default: OS temp dir; plaintext only momentarily
    # Word preview (optional): path to LibreOffice if not on PATH
    SOFFICE_PATH=soffice
    # Optional email (in-app notifications always work; email is best-effort):
    SMTP_HOST=...
    SMTP_PORT=587
    SMTP_SECURE=false
    SMTP_USER=...
    SMTP_PASS=...
    SMTP_FROM=edms@yourdomain

Generate a key:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

If SMTP is not configured, notification emails are logged to the backend console
instead of being sent — in-app notifications (bell icon) work either way.

Frontend env (frontend/.env), only if the API is not on localhost:5000:
    REACT_APP_API_URL=http://localhost:5000

## What changed in v2
- Login is email + password (MFA removed). Auth token is stored in an httpOnly
  cookie (not localStorage) to mitigate XSS token theft. Login is rate-limited.
- Forced password change on first login; self-service password change from the
  profile dialog (click your name in the sidebar).
- Uploads restricted to PDF, Word, JPEG/PNG, Gerber, CAD; each upload is scanned
  for executables / known malware signatures.
- Admin can delete and edit assets, bulk-upload, and move/copy assets between
  categories.
- Access control: per-role (category) + per-department restrictions + per-user
  grants (with revocation). Approving an access request grants that specific user.
- In-app notifications (bell) + best-effort email.
- Search box (by file name or keyword).
- Encryption at rest: every stored file is encrypted with AES-256-GCM before it
  touches disk, and decrypted only in memory when served. Someone with disk,
  backup, or credential-only access cannot read the documents. The key comes from
  FILE_ENCRYPTION_KEY (see Upgrade path below). The vault directory and every
  encrypted file are also locked to the server user (0700 / 0600), plaintext
  uploads land only in a separate temp dir and are deleted right after encryption,
  and the vault location is configurable via VAULT_DIR so it can live OUTSIDE any
  web-served path.
- Secure viewer: PDFs and images are watermarked server-side; Word files are
  converted to a watermarked PDF preview (needs LibreOffice). The clean original
  is never sent for viewing — only for a permitted download. CAD/Gerber have no
  reliable server renderer, so they show a clear "no inline preview" panel with a
  one-click download when the user is permitted.
- View-only enforcement (for users without download permission): no download
  button, right-click / drag / copy disabled, Ctrl/Cmd+S/P/C/A intercepted, the
  browser PDF toolbar hidden and its button area shielded, and the document blurs
  when the window/tab loses focus (a common screenshot moment). IMPORTANT, AND
  STATED PLAINLY: this is strong friction, not an absolute lock. Any document a
  browser can display can still be captured via DevTools, an OS screenshot tool,
  or a phone camera. The per-viewer watermark (email + timestamp, baked into the
  served bytes) is the real control: it makes leaks TRACEABLE even when they
  cannot be PREVENTED. Every view is also logged in the audit ledger.

## Encryption key — upgrade path (KMS / Vault)
The env-var key protects against disk/backup/credential-only theft, which was the
target threat. It does NOT protect against an attacker who already has full server
access including environment variables and process memory. For that, source the
key from a managed KMS/HSM and use envelope encryption per file:
- AWS KMS / GCP KMS / Azure Key Vault: store a master key in the KMS; generate a
  per-file data key, encrypt the file with it, store the KMS-wrapped data key
  alongside the file, and unwrap it via the KMS at read time.
- HashiCorp Vault Transit: encrypt/decrypt through Vault so the key never leaves it.
The code isolates all crypto in encryptBufferToFile / readEncrypted / ingestUpload,
so swapping in a KMS is a contained change.

## Word preview dependency
Word-to-PDF preview uses headless LibreOffice (soffice). Install it on the server
(e.g. `apt-get install libreoffice`), or set SOFFICE_PATH. If it is unavailable,
Word files fall back to the "no inline preview" panel with gated download.

## Honest security notes
- "View-only" discourages but cannot fully prevent copying of previewable files:
  the watermarked bytes still reach the browser.
- Encryption at rest with an env-var key protects against disk/backup/credential
  theft (the stated concern) but not against full server+memory compromise — use a
  KMS/HSM for that (see upgrade path above).
- The malware scan is a lightweight signature/extension check, not a full AV
  engine. For production, integrate ClamAV or similar.
- Before real use: set a strong JWT_SECRET and FILE_ENCRYPTION_KEY, serve over
  HTTPS (COOKIE_SECURE=true), change all demo passwords, and consider reinstating
  a real second factor (TOTP/WebAuthn), since removing MFA means a stolen password
  alone grants access.
