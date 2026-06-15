/**
 * Fort Knox EDMS - Secure Enterprise Data System
 * Single-file Express backend.
 *
 * Features:
 *  - JWT auth with a mock MFA (TOTP-style) second step
 *  - RBAC (Admin / Engineering / Legal / Management)
 *  - Asset repository with sensitivity levels + version history
 *  - File access-request workflow (request -> approve/deny)
 *  - Immutable audit trail (login, MFA, upload, view, request, decision)
 *  - Local multer storage mocking cloud object storage
 *
 * Run: npm start  (listens on PORT, default 5000)
 */

require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------
const PORT = process.env.PORT || 8007;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_only_secret_change_me';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';
const MFA_TOKEN_TTL = '5m'; // short-lived token between password step and MFA step
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://rudren202:DocumentAccessControl@cluster0.lbnevmr.mongodb.net/?appName=Cluster0';

const ROLES = ['Admin', 'Engineering', 'Legal', 'Management'];
const SENSITIVITY = ['Public', 'Internal', 'Confidential', 'Strictly Confidential'];

// ----------------------------------------------------------------------------
// Middleware
// ----------------------------------------------------------------------------
app.use(cors());
app.use(express.json());

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ----------------------------------------------------------------------------
// Schemas
// ----------------------------------------------------------------------------
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    title: { type: String, default: '' },             // e.g. "Security Officer"
    mfaCode: { type: String, default: '000000' },      // mock static MFA code for demo
  },
  { timestamps: true }
);

const versionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    path: { type: String, required: true },
    size: { type: Number, default: 0 },
    hash: { type: String, default: '' },               // sha256 of file bytes
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedAt: { type: Date, default: Date.now },
    note: { type: String, default: '' },
  },
  { _id: false }
);

const assetSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true },
    type: { type: String, default: '' },               // mime
    category: { type: String, default: 'Technical' },  // Technical | Legal | Operational
    sensitivity: { type: String, enum: SENSITIVITY, default: 'Internal' },
    allowedRoles: [{ type: String, enum: ROLES }],
    currentVersion: { type: Number, default: 1 },
    versions: [versionSchema],
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Access requests: a user asks for access to an asset their role can't see.
const accessRequestSchema = new mongoose.Schema(
  {
    asset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', required: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, default: '' },
    status: { type: String, enum: ['Pending', 'Approved', 'Denied'], default: 'Pending' },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
  },
  { timestamps: true }
);

// Immutable audit log.
const auditLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    ip: { type: String },
    timestamp: { type: Date, default: Date.now },
    severity: { type: String, enum: ['info', 'warn', 'critical'], default: 'info' },
    details: { type: String },
  },
  { timestamps: false }
);
const blockMutation = (next) =>
  next(new Error('AuditLog records are immutable and cannot be modified or deleted.'));
['findOneAndUpdate', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'remove'].forEach(
  (op) => auditLogSchema.pre(op, blockMutation)
);
auditLogSchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('AuditLog records are immutable.'));
  next();
});

const User = mongoose.model('User', userSchema);
const Asset = mongoose.model('Asset', assetSchema);
const AccessRequest = mongoose.model('AccessRequest', accessRequestSchema);
const AuditLog = mongoose.model('AuditLog', auditLogSchema);

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
async function logAudit({ action, userId = null, ip = '', details = '', severity = 'info' }) {
  try {
    await AuditLog.create({ action, userId, ip, details, severity, timestamp: new Date() });
  } catch (err) {
    console.error('[AUDIT] write failed:', err.message);
  }
}

function clientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function sha256File(filepath) {
  const buf = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Can a given user (role) currently see/preview an asset?
function roleCanAccess(user, asset) {
  return user.role === 'Admin' || asset.allowedRoles.includes(user.role);
}

// ----------------------------------------------------------------------------
// Auth middleware
// ----------------------------------------------------------------------------
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing authorization token.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Reject the short-lived "mfa pending" token on normal routes.
    if (payload.scope !== 'access') return res.status(401).json({ error: 'MFA not completed.' });
    req.user = { id: payload.id, role: payload.role, email: payload.email, name: payload.name };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function authorize(...allowed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
    if (req.user.role === 'Admin' || allowed.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Forbidden: insufficient role privileges.' });
  };
}

// ----------------------------------------------------------------------------
// Multer
// ----------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ============================================================================
// ROUTES
// ============================================================================
app.get('/', (req, res) => res.json({ service: 'Fort Knox EDMS API', status: 'ok' }));

// --- Step 1: password -> returns short-lived MFA token (scope: mfa) ---
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const ip = clientIp(req);
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      await logAudit({ action: 'LOGIN_FAILED', ip, details: `email=${email}`, severity: 'warn' });
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    await logAudit({ action: 'LOGIN_PASSWORD_OK', userId: user._id, ip, details: `role=${user.role}` });

    const mfaToken = jwt.sign({ id: user._id, scope: 'mfa' }, JWT_SECRET, { expiresIn: MFA_TOKEN_TTL });
    return res.json({ mfaToken, message: 'Password accepted. MFA required.' });
  } catch (err) {
    console.error('[LOGIN]', err.message);
    return res.status(500).json({ error: 'Login failed.' });
  }
});

// --- Step 2: MFA code -> returns full access JWT ---
app.post('/auth/mfa', async (req, res) => {
  const { mfaToken, code } = req.body || {};
  const ip = clientIp(req);
  if (!mfaToken || !code) return res.status(400).json({ error: 'MFA token and code are required.' });

  try {
    const payload = jwt.verify(mfaToken, JWT_SECRET);
    if (payload.scope !== 'mfa') return res.status(401).json({ error: 'Invalid MFA token.' });

    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ error: 'User not found.' });

    if (String(code).trim() !== user.mfaCode) {
      await logAudit({ action: 'MFA_FAILED', userId: user._id, ip, severity: 'warn' });
      return res.status(401).json({ error: 'Invalid MFA code.' });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role, email: user.email, name: user.name, scope: 'access' },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );
    await logAudit({ action: 'LOGIN', userId: user._id, ip, details: `role=${user.role}` });

    return res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, title: user.title },
    });
  } catch {
    return res.status(401).json({ error: 'MFA token invalid or expired.' });
  }
});

// --- Current user ---
app.get('/me', authenticate, async (req, res) => {
  const user = await User.findById(req.user.id).select('-password -mfaCode').lean();
  if (!user) return res.status(404).json({ error: 'Not found.' });
  res.json({ user });
});

// --- Dashboard stats ---
app.get('/stats', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'Admin';
    const visibleFilter = isAdmin ? {} : { allowedRoles: req.user.role };
    const [totalAssets, myVisible, pendingReqs, criticalEvents] = await Promise.all([
      Asset.countDocuments({}),
      Asset.countDocuments(visibleFilter),
      AccessRequest.countDocuments({ status: 'Pending' }),
      AuditLog.countDocuments({ severity: 'critical' }),
    ]);
    res.json({
      totalAssets,
      accessibleAssets: myVisible,
      pendingRequests: pendingReqs,
      criticalEvents,
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not load stats.' });
  }
});

// --- List assets (every asset is listed; role determines accessible flag) ---
// This lets the UI show "Request Access" on restricted rows, like the mockups.
app.get('/assets', authenticate, async (req, res) => {
  try {
    const { category } = req.query;
    const q = category ? { category } : {};
    const assets = await Asset.find(q).sort({ updatedAt: -1 }).lean();

    // Pending requests by this user, to reflect "Requested" state in UI.
    const myReqs = await AccessRequest.find({ requestedBy: req.user.id, status: 'Pending' })
      .select('asset')
      .lean();
    const pendingSet = new Set(myReqs.map((r) => String(r.asset)));

    const shaped = assets.map((a) => {
      const accessible = req.user.role === 'Admin' || a.allowedRoles.includes(req.user.role);
      const latest = a.versions?.[a.versions.length - 1];
      return {
        _id: a._id,
        filename: a.filename,
        type: a.type,
        category: a.category,
        sensitivity: a.sensitivity,
        allowedRoles: a.allowedRoles,
        currentVersion: a.currentVersion,
        size: latest?.size || 0,
        updatedAt: a.updatedAt,
        accessible,
        requestPending: pendingSet.has(String(a._id)),
      };
    });
    res.json({ assets: shaped });
  } catch (err) {
    console.error('[ASSETS]', err.message);
    res.status(500).json({ error: 'Could not fetch assets.' });
  }
});

// --- Upload (creates asset or new version) ---
app.post(
  '/assets/upload',
  authenticate,
  authorize('Engineering', 'Legal', 'Management'),
  upload.single('file'),
  async (req, res) => {
    const ip = clientIp(req);
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    try {
      const { filename, sensitivity, category, note, assetId } = req.body;
      let allowedRoles = (req.body.allowedRoles || req.user.role)
        .split(',')
        .map((r) => r.trim())
        .filter((r) => ROLES.includes(r));
      if (allowedRoles.length === 0) allowedRoles = [req.user.role];

      const hash = sha256File(req.file.path);

      // New version of an existing asset
      if (assetId) {
        const asset = await Asset.findById(assetId);
        if (!asset) return res.status(404).json({ error: 'Asset not found.' });
        const nextV = asset.currentVersion + 1;
        asset.versions.push({
          version: nextV,
          path: req.file.path,
          size: req.file.size,
          hash,
          uploadedBy: req.user.id,
          note: note || `Version ${nextV}`,
        });
        asset.currentVersion = nextV;
        await asset.save();
        await logAudit({
          action: 'VERSION_UPLOAD',
          userId: req.user.id,
          ip,
          details: `asset=${asset._id} v=${nextV} hash=${hash.slice(0, 12)}`,
        });
        return res.status(201).json({ message: 'New version uploaded.', asset });
      }

      // Brand-new asset
      const asset = await Asset.create({
        filename: filename || req.file.originalname,
        type: req.file.mimetype,
        category: category || 'Technical',
        sensitivity: SENSITIVITY.includes(sensitivity) ? sensitivity : 'Internal',
        allowedRoles,
        currentVersion: 1,
        versions: [
          {
            version: 1,
            path: req.file.path,
            size: req.file.size,
            hash,
            uploadedBy: req.user.id,
            note: note || 'Initial version',
          },
        ],
        uploadedBy: req.user.id,
      });
      await logAudit({
        action: 'UPLOAD',
        userId: req.user.id,
        ip,
        details: `file=${asset.filename} sens=${asset.sensitivity}`,
      });
      res.status(201).json({ message: 'Upload successful.', asset });
    } catch (err) {
      console.error('[UPLOAD]', err.message);
      res.status(500).json({ error: 'Upload failed.' });
    }
  }
);

// --- Version history ---
app.get('/assets/:id/versions', authenticate, async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id)
      .populate('versions.uploadedBy', 'name email')
      .lean();
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    if (!roleCanAccess(req.user, asset)) return res.status(403).json({ error: 'Forbidden.' });
    res.json({ filename: asset.filename, versions: [...asset.versions].reverse() });
  } catch {
    res.status(500).json({ error: 'Could not load versions.' });
  }
});

// --- Secure view (mock watermarked previewer), audited + RBAC ---
app.get('/assets/:id/view', authenticate, async (req, res) => {
  const ip = clientIp(req);
  try {
    const asset = await Asset.findById(req.params.id).lean();
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    if (!roleCanAccess(req.user, asset)) {
      await logAudit({
        action: 'VIEW_DENIED',
        userId: req.user.id,
        ip,
        details: `asset=${asset._id}`,
        severity: 'critical',
      });
      return res.status(403).json({ error: 'Forbidden: not authorized to view this asset.' });
    }
    const latest = asset.versions[asset.versions.length - 1];
    await logAudit({ action: 'VIEW', userId: req.user.id, ip, details: `asset=${asset._id}` });
    res.json({
      message: 'Secure view session opened (watermarked previewer).',
      watermark: `CONFIDENTIAL • ${req.user.email} • ${new Date().toISOString()}`,
      asset: {
        id: asset._id,
        filename: asset.filename,
        type: asset.type,
        sensitivity: asset.sensitivity,
        version: asset.currentVersion,
        hash: latest?.hash || '',
      },
    });
  } catch (err) {
    console.error('[VIEW]', err.message);
    res.status(500).json({ error: 'Could not open secure view.' });
  }
});
// --- Secure File Fetch/Download (Audited + RBAC) ---
app.get('/uploads/:filename', authenticate, (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.join(UPLOAD_DIR, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on server.' });
  }

  res.sendFile(filePath);
});
// --- Access requests: create ---
app.post('/access-requests', authenticate, async (req, res) => {
  const ip = clientIp(req);
  const { assetId, reason } = req.body || {};
  try {
    const asset = await Asset.findById(assetId);
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    if (roleCanAccess(req.user, asset))
      return res.status(400).json({ error: 'You already have access to this asset.' });

    const existing = await AccessRequest.findOne({
      asset: assetId,
      requestedBy: req.user.id,
      status: 'Pending',
    });
    if (existing) return res.status(409).json({ error: 'A pending request already exists.' });

    const reqDoc = await AccessRequest.create({
      asset: assetId,
      requestedBy: req.user.id,
      reason: reason || '',
    });
    await logAudit({
      action: 'ACCESS_REQUESTED',
      userId: req.user.id,
      ip,
      details: `asset=${assetId}`,
      severity: 'warn',
    });
    res.status(201).json({ message: 'Access request submitted.', request: reqDoc });
  } catch (err) {
    console.error('[ACCESS_REQ]', err.message);
    res.status(500).json({ error: 'Could not submit request.' });
  }
});

// --- Access requests: list (Admin sees all; others see their own) ---
app.get('/access-requests', authenticate, async (req, res) => {
  try {
    const filter = req.user.role === 'Admin' ? {} : { requestedBy: req.user.id };
    const reqs = await AccessRequest.find(filter)
      .sort({ createdAt: -1 })
      .populate('asset', 'filename sensitivity')
      .populate('requestedBy', 'name email role')
      .lean();
    res.json({ requests: reqs });
  } catch {
    res.status(500).json({ error: 'Could not load requests.' });
  }
});

// --- Access requests: decide (Admin only) ---
app.post('/access-requests/:id/decide', authenticate, authorize('Admin'), async (req, res) => {
  const ip = clientIp(req);
  const { decision } = req.body || {}; // 'Approved' | 'Denied'
  if (!['Approved', 'Denied'].includes(decision))
    return res.status(400).json({ error: 'decision must be Approved or Denied.' });
  try {
    const reqDoc = await AccessRequest.findById(req.params.id).populate('requestedBy', 'role');
    if (!reqDoc) return res.status(404).json({ error: 'Request not found.' });
    if (reqDoc.status !== 'Pending')
      return res.status(409).json({ error: 'Request already decided.' });

    reqDoc.status = decision;
    reqDoc.decidedBy = req.user.id;
    reqDoc.decidedAt = new Date();
    await reqDoc.save();

    // On approval, grant the requester's role access to the asset.
    if (decision === 'Approved') {
      const asset = await Asset.findById(reqDoc.asset);
      const role = reqDoc.requestedBy.role;
      if (asset && !asset.allowedRoles.includes(role)) {
        asset.allowedRoles.push(role);
        await asset.save();
      }
    }
    await logAudit({
      action: `ACCESS_${decision.toUpperCase()}`,
      userId: req.user.id,
      ip,
      details: `request=${reqDoc._id}`,
      severity: decision === 'Approved' ? 'info' : 'warn',
    });
    res.json({ message: `Request ${decision.toLowerCase()}.`, request: reqDoc });
  } catch (err) {
    console.error('[DECIDE]', err.message);
    res.status(500).json({ error: 'Could not decide request.' });
  }
});

// --- Audit log (Admin only) ---
app.get('/audit', authenticate, authorize('Admin'), async (req, res) => {
  try {
    const { severity, action } = req.query;
    const q = {};
    if (severity) q.severity = severity;
    if (action) q.action = new RegExp(action, 'i');
    const logs = await AuditLog.find(q)
      .sort({ timestamp: -1 })
      .limit(300)
      .populate('userId', 'name email role')
      .lean();
    res.json({ logs });
  } catch {
    res.status(500).json({ error: 'Could not fetch audit logs.' });
  }
});

// --- Admin: users list ---
app.get('/users', authenticate, authorize('Admin'), async (req, res) => {
  const users = await User.find({}).select('-password -mfaCode').sort({ createdAt: 1 }).lean();
  res.json({ users });
});
// ----------------------------------------------------------------------------
// Seed
// ----------------------------------------------------------------------------
async function seed() {
  const seedUsers = [
    { name: 'A. Sterling', email: 'admin@edms.local', password: 'Admin@123', role: 'Admin', title: 'Security Officer' },
    { name: 'E. Vance', email: 'eng@edms.local', password: 'Eng@123', role: 'Engineering', title: 'Lead CAD Engineer' },
    { name: 'L. Cromwell', email: 'legal@edms.local', password: 'Legal@123', role: 'Legal', title: 'Patent Counsel' },
    { name: 'M. Hale', email: 'mgmt@edms.local', password: 'Mgmt@123', role: 'Management', title: 'VP Operations' },
  ];
  const created = {};
  for (const u of seedUsers) {
    let user = await User.findOne({ email: u.email });
    if (!user) {
      const hash = await bcrypt.hash(u.password, 12);
      user = await User.create({ ...u, password: hash, mfaCode: '000000' });
      console.log(`[SEED] user ${u.role} -> ${u.email} / ${u.password} (MFA 000000)`);
    }
    created[u.role] = user;
  }

  if ((await Asset.countDocuments({})) === 0) {
    const demo = [
      { filename: 'Structural_Blueprints_v4.dwg', category: 'Technical', sensitivity: 'Internal', allowedRoles: ['Engineering'], type: 'application/acad' },
      { filename: 'PCB_Layout_MainBoard.brd', category: 'Technical', sensitivity: 'Confidential', allowedRoles: ['Engineering'], type: 'application/octet-stream' },
      { filename: 'Patent_Filing_US2026.pdf', category: 'Legal', sensitivity: 'Strictly Confidential', allowedRoles: ['Legal'], type: 'application/pdf' },
      { filename: 'Q3_Operations_Report.xlsx', category: 'Operational', sensitivity: 'Internal', allowedRoles: ['Management'], type: 'application/vnd.ms-excel' },
      { filename: 'Compliance_Audit_2026.pdf', category: 'Legal', sensitivity: 'Confidential', allowedRoles: ['Legal', 'Management'], type: 'application/pdf' },
      { filename: 'Public_Brand_Guidelines.pdf', category: 'Operational', sensitivity: 'Public', allowedRoles: ['Engineering', 'Legal', 'Management'], type: 'application/pdf' },
    ];
    for (const d of demo) {
      const fakePath = path.join(UPLOAD_DIR, `seed_${Date.now()}_${d.filename}`);
      fs.writeFileSync(fakePath, `Mock content for ${d.filename}\n`);
      const hash = sha256File(fakePath);
      await Asset.create({
        ...d,
        currentVersion: 1,
        versions: [{ version: 1, path: fakePath, size: fs.statSync(fakePath).size, hash, uploadedBy: created.Admin._id, note: 'Initial version' }],
        uploadedBy: created.Admin._id,
      });
    }
    console.log('[SEED] demo assets created');
  }
}

mongoose
  .connect(MONGO_URI)
  .then(async () => {
    console.log('[DB] Connected to MongoDB');
    await seed();
    app.listen(PORT, () => console.log(`[API] Fort Knox EDMS running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('[DB] Connection error:', err.message);
    process.exit(1);
  });
