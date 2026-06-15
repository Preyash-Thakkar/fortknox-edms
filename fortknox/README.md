# Fort Knox EDMS — Secure Enterprise Data System

A full-stack MERN application implementing the **"Secure Enterprise Data System"**
design (the Stitch "Fort Knox EDMS" mockups). It is a security-focused enterprise
document/IP vault with multi-factor login, role-based access control, an immutable
audit ledger, sensitivity-classified assets, version history, a watermarked secure
previewer, and a file-access request/approval workflow.

> This is a **runnable boilerplate / reference implementation**, not a hardened
> production system. See "Security Notes" before any real deployment.

---

## What's implemented

**Authentication**
- Two-step login: password → 6-digit MFA code (mock TOTP; demo code `000000`)
- JWT access tokens; a separate short-lived "MFA-pending" token between steps
- Auto-logout on token expiry

**RBAC** — four roles: `Admin`, `Engineering`, `Legal`, `Management`
- Middleware (`authenticate` + `authorize`) gates every protected endpoint
- Admin is implicitly allowed everywhere
- Per-asset access re-checked on view; restricted assets show "Request Access"

**Assets**
- Sensitivity levels: Public / Internal / Confidential / Strictly Confidential
- Categories: Technical / Legal / Operational (drive the three repository views)
- Version history with SHA-256 integrity hash per version
- Local multer storage mocking cloud object storage

**Workflows**
- File access requests → admin approve/deny → approval grants the role access
- Immutable audit ledger (login, MFA, view, upload, request, decision) with
  WORM-style enforcement (no update/delete routes + Mongoose pre-hooks that throw)
- Admin-only audit viewer with severity filtering

---

## Tech Stack
- **Frontend:** React 18 + React Router, Tailwind (CDN with the Stitch design tokens), axios
- **Backend:** Node.js, Express, Mongoose, JWT, bcrypt, multer
- **Database:** MongoDB

## Folder Structure
```
fortknox/
├── README.md
├── backend/
│   ├── uploads/              # mock cloud bucket (multer + seeded demo files)
│   ├── .env.example
│   ├── package.json
│   └── server.js             # entire backend (single file)
└── frontend/
    ├── public/index.html     # Tailwind config + design tokens live here
    ├── src/
    │   ├── index.js
    │   ├── App.js            # routes + guards
    │   ├── auth.js           # axios client + auth context
    │   ├── components/
    │   │   ├── ui.js         # design-system primitives (badges, buttons, cards)
    │   │   ├── Shell.js      # sidebar + top bar app shell
    │   │   ├── SecureViewer.js
    │   │   ├── UploadModal.js
    │   │   └── VersionDrawer.js
    │   └── pages/
    │       ├── Login.js      # two-step MFA login
    │       ├── Repository.js # dashboard + asset table (Technical/Legal/Operational)
    │       ├── Requests.js   # access request queue
    │       ├── Audit.js      # immutable log viewer
    │       └── Settings.js   # role matrix + operators
    ├── .env.example
    └── package.json
```

## Prerequisites
- Node.js 18+ and npm
- MongoDB running locally (`mongod`) OR a MongoDB Atlas URI

## Setup

### 1. Backend
```bash
cd backend
cp .env.example .env        # edit .env, set a strong JWT_SECRET
npm install
npm start                   # http://localhost:5000
```
On first boot it seeds four users and six demo assets.

Generate a strong secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 2. Frontend
```bash
cd frontend
npm install
npm start                   # http://localhost:3000
```

## Demo Accounts
MFA code for all accounts: **`000000`**

| Role        | Email             | Password   |
|-------------|-------------------|------------|
| Admin       | admin@edms.local  | Admin@123  |
| Engineering | eng@edms.local    | Eng@123    |
| Legal       | legal@edms.local  | Legal@123  |
| Management  | mgmt@edms.local   | Mgmt@123   |

Try logging in as Engineering: you'll see the Patent doc as **Restricted** with a
**Request** button. Submit a request, log in as Admin, approve it under **Access
Requests**, then log back in as Engineering — the asset is now accessible and
viewable in the watermarked previewer.

## Environment Variables (backend/.env)
| Variable     | Required | Example                            | Purpose                  |
|--------------|----------|------------------------------------|--------------------------|
| `PORT`       | No       | `5000`                             | Express port             |
| `MONGO_URI`  | Yes      | `mongodb://127.0.0.1:27017/fortknox` | MongoDB connection     |
| `JWT_SECRET` | Yes      | (64+ random chars)                 | Signs/verifies JWTs      |
| `JWT_EXPIRES`| No       | `8h`                               | Access token lifetime    |

Frontend (`frontend/.env`, optional):
| Variable            | Example                 | Purpose          |
|---------------------|-------------------------|------------------|
| `REACT_APP_API_URL` | `http://localhost:5000` | Backend base URL |

## API Endpoints
| Method | Path                          | Access      | Description                          |
|--------|-------------------------------|-------------|--------------------------------------|
| POST   | `/auth/login`                 | Public      | Password step → returns MFA token    |
| POST   | `/auth/mfa`                   | Public      | MFA code → returns access JWT        |
| GET    | `/me`                         | Auth        | Current user                         |
| GET    | `/stats`                      | Auth        | Dashboard counters                   |
| GET    | `/assets`                     | Auth        | Assets w/ per-role accessible flag   |
| POST   | `/assets/upload`              | RBAC        | New asset or new version             |
| GET    | `/assets/:id/versions`        | Auth + RBAC | Version history                      |
| GET    | `/assets/:id/view`            | Auth + RBAC | Secure (watermarked) view; audited   |
| POST   | `/access-requests`            | Auth        | Request access to a restricted asset |
| GET    | `/access-requests`            | Auth        | Own requests (Admin: all)            |
| POST   | `/access-requests/:id/decide` | Admin       | Approve/deny; approval grants access |
| GET    | `/audit`                      | Admin       | Immutable audit ledger               |
| GET    | `/users`                      | Admin       | Operators list                       |

## Security Notes (read before any real deployment)
- Store JWT in an httpOnly cookie instead of localStorage (XSS exposure).
- Replace the mock static MFA with real TOTP (e.g. `otplib`) or WebAuthn/FIDO2.
- Add rate limiting + lockout on `/auth/login` and `/auth/mfa`.
- Validate/scan uploaded file contents; store the bucket outside any web root.
- Move the audit collection to a true append-only/WORM store with restricted creds.
- The watermarked viewer is cosmetic — a real secure viewer needs server-side
  rendering with DRM; anything sent to the browser can be captured.
- Enforce HTTPS, set CORS to a specific origin, and add CSRF protection as needed.
