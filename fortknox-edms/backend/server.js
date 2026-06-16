/**
 * Fort Knox EDMS - Secure Enterprise Data System (v2)
 * Single-file Express backend.
 *
 * Adds: email+password login (MFA removed), JWT in httpOnly cookie,
 * forced first-login + profile password change, login rate limiting,
 * upload type allow-list + malware scan, admin delete/edit/bulk/move-copy,
 * per-user grants + department permissions, in-app + email notifications,
 * search, and server-side watermarking for PDF + image.
 */



const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const nodemailer = require('nodemailer');
const { PDFDocument, rgb, degrees, StandardFonts } = require('pdf-lib');
const sharp = require('sharp');
const dotenv = require('dotenv');
require('dotenv').config();
const app = express();

// ---------------------------------------------------------------- Config
const PORT = process.env.PORT || 8007;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_only_secret_change_me';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';
const MONGO_URI = 'mongodb+srv://rudren202:DocumentAccessControl@cluster0.lbnevmr.mongodb.net/?appName=Cluster0';
// const MONGO_URI = 'mongodb://127.0.0.1:27017/fortknox';
const CLIENT_ORIGIN = 'https://lms1.wehear.in';
// const CLIENT_ORIGIN = 'http://localhost:3000';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const PASSWORD_MIN = 8;

// --- Encryption-at-rest config ---
// Files are encrypted with AES-256-GCM before being written to disk, so anyone
// with only disk/backup/credential access cannot read the stored documents.
// The key comes from FILE_ENCRYPTION_KEY (64 hex chars = 32 bytes). In dev, a
// fixed fallback is used so the demo runs; PRODUCTION MUST set a real key.
// Upgrade path: source this key from a KMS/Vault (AWS KMS, HashiCorp Vault) and
// use envelope encryption per file — see TESTING.md / SECURITY.
const FILE_ENC_KEY = (() => {
  const hex = "2031047ae20df3a6fc170b8f4a42bf43421f3af8e24e8080f955feeffea48a68";
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  if (process.env.NODE_ENV === 'production') {
    console.error('[SECURITY] FILE_ENCRYPTION_KEY is missing or invalid (need 64 hex chars). Refusing to start in production.');
    process.exit(1);
  }
  console.warn('[SECURITY] Using a DEV-ONLY file encryption key. Set FILE_ENCRYPTION_KEY (64 hex chars) in production.');
  // Deterministic dev key (NOT for production).
  return crypto.createHash('sha256').update('fortknox-dev-file-key').digest();
})();

const ROLES = ['Admin', 'Engineering', 'Legal', 'Management'];
const SENSITIVITY = ['Public', 'Internal', 'Confidential', 'Strictly Confidential'];

const FILE_TYPES = {
  PDF: { exts: ['pdf'], mimes: ['application/pdf'] },
  Word: { exts: ['doc', 'docx'], mimes: ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  Image: { exts: ['jpg', 'jpeg', 'png'], mimes: ['image/jpeg', 'image/png'] },
  Gerber: { exts: ['gbr', 'ger', 'gerber', 'gbl', 'gtl', 'gbs', 'gts', 'gbo', 'gto', 'drl', 'xln'], mimes: ['application/octet-stream', 'text/plain'] },
  CAD: { exts: ['dwg', 'dxf', 'step', 'stp', 'iges', 'igs', 'brd', 'sch'], mimes: ['application/octet-stream', 'application/acad', 'image/vnd.dwg'] },
};
const ALL_EXTS = Object.values(FILE_TYPES).flatMap((t) => t.exts);
function extOf(name) { return (name.split('.').pop() || '').toLowerCase(); }
function fileTypeLabel(name) {
  const e = extOf(name);
  for (const [label, t] of Object.entries(FILE_TYPES)) if (t.exts.includes(e)) return label;
  return null;
}

// ---------------------------------------------------------------- Middleware
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Storage location for encrypted files. Override with VAULT_DIR to place it
// OUTSIDE the app/web root (recommended) so it is never reachable as a static
// path. Files here are AES-256-GCM encrypted; OS permissions are additionally
// locked to the server's user (0700 dir / 0600 files) as defence in depth.
const UPLOAD_DIR = process.env.VAULT_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });
try { fs.chmodSync(UPLOAD_DIR, 0o700); } catch { /* non-POSIX fs: ignore */ }

// Multer writes the incoming (plaintext) file here briefly; ingestUpload then
// scans it, encrypts it into UPLOAD_DIR, and deletes this temp copy. Keeping it
// separate means plaintext never lands in the encrypted vault directory.
const TEMP_DIR = process.env.VAULT_TEMP_DIR || path.join(os.tmpdir(), 'fk-uploads');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true, mode: 0o700 });
try { fs.chmodSync(TEMP_DIR, 0o700); } catch { /* ignore */ }

// ---------------------------------------------------------------- Email
let mailer = null;
if (process.env.SMTP_HOST) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}
async function sendEmail(to, subject, text) {
  if (!to) return;
  if (!mailer) { console.log(`[EMAIL:console] To: ${to} | ${subject}\n${text}\n`); return; }
  try { await mailer.sendMail({ from: process.env.SMTP_FROM || 'edms@local', to, subject, text }); }
  catch (err) { console.error('[EMAIL] send failed:', err.message); }
}

// ---------------------------------------------------------------- Schemas
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ROLES, required: true },
  title: { type: String, default: '' },
  active: { type: Boolean, default: true },
  mustChangePassword: { type: Boolean, default: false },
}, { timestamps: true });

const versionSchema = new mongoose.Schema({
  version: { type: Number, required: true },
  path: { type: String, required: true },
  size: { type: Number, default: 0 },
  hash: { type: String, default: '' },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedAt: { type: Date, default: Date.now },
  note: { type: String, default: '' },
}, { _id: false });

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  allowedRoles: [{ type: String, enum: ROLES }],
  downloadRoles: [{ type: String, enum: ROLES }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const departmentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
  allowedRoles: [{ type: String, enum: ROLES }],   // empty => inherit category
  downloadRoles: [{ type: String, enum: ROLES }],  // empty => inherit category
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
departmentSchema.index({ name: 1, category: 1 }, { unique: true });

const assetSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  keywords: { type: String, default: '' },
  type: { type: String, default: '' },
  fileType: { type: String, default: '' },
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  sensitivity: { type: String, enum: SENSITIVITY, default: 'Internal' },
  allowedRoles: [{ type: String, enum: ROLES }],
  downloadRoles: [{ type: String, enum: ROLES }],
  userViewGrants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  userDownloadGrants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  currentVersion: { type: Number, default: 1 },
  versions: [versionSchema],
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
// Indexes for the hot query paths.
// Listing/filtering by category (+ department), newest first:
assetSchema.index({ category: 1, department: 1, updatedAt: -1 });
assetSchema.index({ updatedAt: -1 });
// Permission-scoped queries (used to count/accessible-filter without scanning):
assetSchema.index({ allowedRoles: 1 });
assetSchema.index({ userViewGrants: 1 });
// Full-text search over name + keywords (replaces unindexed regex scan):
assetSchema.index({ filename: 'text', keywords: 'text' }, { weights: { filename: 5, keywords: 1 }, name: 'asset_text' });

const accessRequestSchema = new mongoose.Schema({
  asset: { type: mongoose.Schema.Types.ObjectId, ref: 'Asset', required: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: ['view', 'download'], default: 'view' },
  reason: { type: String, default: '' },
  status: { type: String, enum: ['Pending', 'Approved', 'Denied'], default: 'Pending' },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  decidedAt: { type: Date },
}, { timestamps: true });
accessRequestSchema.index({ requestedBy: 1, status: 1 });
accessRequestSchema.index({ status: 1, createdAt: -1 });
accessRequestSchema.index({ asset: 1 });

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
  link: { type: String, default: '' },
  read: { type: Boolean, default: false },
}, { timestamps: true });
notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

const auditLogSchema = new mongoose.Schema({
  action: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  ip: { type: String },
  timestamp: { type: Date, default: Date.now },
  severity: { type: String, enum: ['info', 'warn', 'critical'], default: 'info' },
  details: { type: String },
}, { timestamps: false });
auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ severity: 1, timestamp: -1 });
auditLogSchema.index({ userId: 1, timestamp: -1 });
const blockMutation = (next) => next(new Error('AuditLog records are immutable.'));
['findOneAndUpdate', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'remove'].forEach((op) => auditLogSchema.pre(op, blockMutation));
auditLogSchema.pre('save', function (next) { if (!this.isNew) return next(new Error('AuditLog records are immutable.')); next(); });

const User = mongoose.model('User', userSchema);
const Asset = mongoose.model('Asset', assetSchema);
const Category = mongoose.model('Category', categorySchema);
const Department = mongoose.model('Department', departmentSchema);
const AccessRequest = mongoose.model('AccessRequest', accessRequestSchema);
const Notification = mongoose.model('Notification', notificationSchema);
const AuditLog = mongoose.model('AuditLog', auditLogSchema);

// ---------------------------------------------------------------- Helpers
async function logAudit({ action, userId = null, ip = '', details = '', severity = 'info' }) {
  try { await AuditLog.create({ action, userId, ip, details, severity, timestamp: new Date() }); }
  catch (err) { console.error('[AUDIT] write failed:', err.message); }
}
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}
function sha256File(filepath) { return crypto.createHash('sha256').update(fs.readFileSync(filepath)).digest('hex'); }
function sha256Buffer(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

// --- Encryption at rest (AES-256-GCM) ---
// On-disk format: [12-byte IV][16-byte auth tag][ciphertext]. The plaintext
// never persists; readEncrypted() returns the decrypted bytes in memory only.
const ENC_ALGO = 'aes-256-gcm';
function encryptBufferToFile(plainBuf, destPath) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENC_ALGO, FILE_ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  fs.writeFileSync(destPath, Buffer.concat([iv, tag, enc]), { mode: 0o600 });
  try { fs.chmodSync(destPath, 0o600); } catch { /* non-POSIX fs: ignore */ }
}
function readEncrypted(filePath) {
  const raw = fs.readFileSync(filePath);
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv(ENC_ALGO, FILE_ENC_KEY, iv);
  decipher.setAuthTag(tag); // GCM verifies integrity: tampered files throw here
  return Buffer.concat([decipher.update(data), decipher.final()]);
}
// Encrypt a multer temp upload into the vault and remove the plaintext temp.
// Returns { path, size, hash } describing the ENCRYPTED file (hash is of plaintext).
function ingestUpload(tempPath) {
  const plain = fs.readFileSync(tempPath);
  const hash = sha256Buffer(plain);
  // Write the encrypted file into the vault dir (NOT next to the plaintext temp).
  const encPath = path.join(UPLOAD_DIR, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.enc`);
  encryptBufferToFile(plain, encPath);
  fs.unlinkSync(tempPath); // delete the plaintext temp immediately
  return { path: encPath, size: plain.length, hash };
}
async function notify(userId, text, link = '') {
  try {
    await Notification.create({ user: userId, text, link });
    const u = await User.findById(userId).select('email').lean();
    if (u?.email) await sendEmail(u.email, 'Fort Knox EDMS notification', text);
  } catch (err) { console.error('[NOTIFY]', err.message); }
}
function userGranted(list, userId) { return (list || []).some((id) => String(id) === String(userId)); }
function roleViewOk(user, asset) {
  if (user.role === 'Admin') return true;
  const catOk = (asset.allowedRoles || []).includes(user.role);
  const deptRoles = asset._deptAllowedRoles;
  const deptOk = !deptRoles || deptRoles.length === 0 || deptRoles.includes(user.role);
  return catOk && deptOk;
}
function canView(user, asset) {
  return user.role === 'Admin' || roleViewOk(user, asset) || userGranted(asset.userViewGrants, user.id);
}
function canDownload(user, asset) {
  if (user.role === 'Admin') return true;
  const roleDl = (asset.downloadRoles || []).includes(user.role);
  const deptDl = asset._deptDownloadRoles;
  const deptDlOk = !deptDl || deptDl.length === 0 || deptDl.includes(user.role);
  const roleOk = roleViewOk(user, asset) && roleDl && deptDlOk;
  return roleOk || userGranted(asset.userDownloadGrants, user.id);
}
function scanFile(filepath, originalName) {
  const ext = extOf(originalName);
  const bannedExt = ['exe', 'dll', 'bat', 'cmd', 'sh', 'js', 'vbs', 'scr', 'msi', 'jar', 'com', 'ps1'];
  if (bannedExt.includes(ext)) return { ok: false, reason: 'Executable/script files are not allowed.' };
  const fd = fs.openSync(filepath, 'r');
  const buf = Buffer.alloc(8);
  fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);
  if (buf[0] === 0x4d && buf[1] === 0x5a) return { ok: false, reason: 'Executable content detected (PE).' };
  if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return { ok: false, reason: 'Executable content detected (ELF).' };
  try {
    const head = fs.readFileSync(filepath).slice(0, 512).toString('latin1');
    if (head.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) return { ok: false, reason: 'Malware test signature detected.' };
  } catch { /* ignore */ }
  return { ok: true };
}

// ---------------------------------------------------------------- Auth
function authenticate(req, res, next) {
  const token = req.cookies?.fk_token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.id, role: payload.role, email: payload.email, name: payload.name };
    next();
  } catch { return res.status(401).json({ error: 'Invalid or expired session.' }); }
}
function authorize(...allowed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
    if (req.user.role === 'Admin' || allowed.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Forbidden: insufficient role privileges.' });
  };
}
function setAuthCookie(res, user) {
  const token = jwt.sign({ id: user._id, role: user.role, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.cookie('fk_token', token, { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 });
}

// ---------------------------------------------------------------- Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_DIR),
  filename: (req, file, cb) => { const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'); cb(null, `${Date.now()}_${Math.round(Math.random() * 1e6)}_${safe}`); },
});
const upload = multer({
  storage, limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const e = extOf(file.originalname);
    if (!ALL_EXTS.includes(e)) return cb(new Error(`File type ".${e}" is not allowed. Allowed: PDF, Word, JPEG/PNG, Gerber, CAD.`));
    cb(null, true);
  },
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts. Please wait a few minutes and try again.' } });

// ================================================================ ROUTES
app.get('/', (req, res) => res.json({ service: 'Fort Knox EDMS API', status: 'ok', version: 2 }));

app.post('/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const ip = clientIp(req);
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      await logAudit({ action: 'LOGIN_FAILED', ip, details: `email=${email}`, severity: 'warn' });
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    if (user.active === false) {
      await logAudit({ action: 'LOGIN_BLOCKED_INACTIVE', userId: user._id, ip, severity: 'warn' });
      return res.status(403).json({ error: 'This account has been deactivated. Contact your administrator.' });
    }
    setAuthCookie(res, user);
    await logAudit({ action: 'LOGIN', userId: user._id, ip, details: `role=${user.role}` });
    res.json({ user: { id: user._id, name: user.name, email: user.email, role: user.role, title: user.title, mustChangePassword: user.mustChangePassword } });
  } catch (err) { console.error('[LOGIN]', err.message); res.status(500).json({ error: 'Login failed.' }); }
});

app.post('/auth/logout', (req, res) => { res.clearCookie('fk_token'); res.json({ message: 'Logged out.' }); });

app.get('/me', authenticate, async (req, res) => {
  const user = await User.findById(req.user.id).select('-password').lean();
  if (!user) return res.status(404).json({ error: 'Not found.' });
  res.json({ user });
});

app.post('/auth/change-password', authenticate, async (req, res) => {
  const ip = clientIp(req);
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < PASSWORD_MIN) return res.status(400).json({ error: `New password must be at least ${PASSWORD_MIN} characters.` });
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (!user.mustChangePassword) {
      if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password))) return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    user.password = await bcrypt.hash(newPassword, 12);
    user.mustChangePassword = false;
    await user.save();
    setAuthCookie(res, user);
    await logAudit({ action: 'PASSWORD_CHANGED', userId: user._id, ip });
    res.json({ message: 'Password updated.' });
  } catch (err) { console.error('[CHANGE_PW]', err.message); res.status(500).json({ error: 'Could not change password.' }); }
});

app.get('/stats', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'Admin';
    const [totalAssets, pendingReqs, criticalEvents] = await Promise.all([
      Asset.countDocuments({}), AccessRequest.countDocuments({ status: 'Pending' }), AuditLog.countDocuments({ severity: 'critical' }),
    ]);

    let accessible = totalAssets;
    if (!isAdmin) {
      // Compute the accessible count inside MongoDB (no full scan into Node).
      // Accessible = (role allowed by category AND not excluded by a department
      // restriction) OR the user holds a per-user view grant.
      const role = req.user.role;
      const uid = new mongoose.Types.ObjectId(req.user.id);
      const result = await Asset.aggregate([
        {
          $lookup: {
            from: 'departments',
            localField: 'department',
            foreignField: '_id',
            as: '_dept',
          },
        },
        {
          $addFields: {
            _deptAllowed: { $ifNull: [{ $arrayElemAt: ['$_dept.allowedRoles', 0] }, []] },
          },
        },
        {
          $match: {
            $or: [
              {
                // role permitted by the category AND department doesn't exclude it
                allowedRoles: role,
                $or: [
                  { _deptAllowed: { $size: 0 } }, // department inherits category
                  { _deptAllowed: role },          // department explicitly allows role
                ],
              },
              { userViewGrants: uid }, // explicit per-user grant
            ],
          },
        },
        { $count: 'n' },
      ]);
      accessible = result[0]?.n || 0;
    }

    res.json({ totalAssets, accessibleAssets: accessible, pendingRequests: pendingReqs, criticalEvents });
  } catch (err) { console.error('[STATS]', err.message); res.status(500).json({ error: 'Could not load stats.' }); }
});

app.get('/assets', authenticate, async (req, res) => {
  try {
    const { category, department, q } = req.query;
    // Pagination: page (1-based) + limit (capped to protect the server).
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const skip = (page - 1) * limit;

    const filter = {};
    if (category) filter.category = category;
    if (department) filter.department = department;

    let useTextScore = false;
    if (q && q.trim()) {
      const term = q.trim();
      // Prefer the text index for multi-character/word queries. For very short
      // fragments (1-2 chars) text search returns nothing useful, so fall back
      // to an anchored regex on filename (still selective on the index prefix).
      if (term.length >= 3) {
        filter.$text = { $search: term };
        useTextScore = true;
      } else {
        const rx = new RegExp('^' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.filename = rx;
      }
    }

    const projection = useTextScore ? { score: { $meta: 'textScore' } } : {};
    const sort = useTextScore ? { score: { $meta: 'textScore' } } : { updatedAt: -1 };

    // Count + page fetched in parallel; both use indexes now.
    const [total, assets] = await Promise.all([
      Asset.countDocuments(filter),
      Asset.find(filter, projection)
        .populate('category', 'name allowedRoles downloadRoles')
        .populate('department', 'name allowedRoles downloadRoles')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    // Only need pending-request flags for the assets on this page.
    const pageIds = assets.map((a) => a._id);
    const myReqs = await AccessRequest.find({ requestedBy: req.user.id, status: 'Pending', asset: { $in: pageIds } }).select('asset').lean();
    const pendingSet = new Set(myReqs.map((r) => String(r.asset)));

    const shaped = assets.map((a) => {
      a._deptAllowedRoles = a.department?.allowedRoles;
      a._deptDownloadRoles = a.department?.downloadRoles;
      return {
        _id: a._id, filename: a.filename, keywords: a.keywords, type: a.type, fileType: a.fileType,
        category: a.category ? { _id: a.category._id, name: a.category.name } : null,
        department: a.department ? { _id: a.department._id, name: a.department.name } : null,
        sensitivity: a.sensitivity, currentVersion: a.currentVersion,
        size: a.versions?.[a.versions.length - 1]?.size || 0, updatedAt: a.updatedAt,
        accessible: canView(req.user, a), canDownload: canDownload(req.user, a), requestPending: pendingSet.has(String(a._id)),
      };
    });
    res.json({ assets: shaped, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) { console.error('[ASSETS]', err.message); res.status(500).json({ error: 'Could not fetch assets.' }); }
});

app.post('/assets/upload', authenticate, authorize('Engineering', 'Legal', 'Management'), upload.single('file'), async (req, res) => {
  const ip = clientIp(req);
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const scan = scanFile(req.file.path, req.file.originalname);
  if (!scan.ok) { fs.unlink(req.file.path, () => { }); await logAudit({ action: 'UPLOAD_BLOCKED', userId: req.user.id, ip, details: `${req.file.originalname}: ${scan.reason}`, severity: 'critical' }); return res.status(400).json({ error: `Upload rejected: ${scan.reason}` }); }
  try {
    const { filename, keywords, sensitivity, categoryId, departmentId, note, assetId } = req.body;
    // Scan happened on the plaintext temp; now encrypt it into the vault.
    const enc = ingestUpload(req.file.path); // { path(.enc), size, hash } and removes the temp
    const fType = fileTypeLabel(req.file.originalname);
    if (assetId) {
      const asset = await Asset.findById(assetId);
      if (!asset) { fs.unlink(enc.path, () => { }); return res.status(404).json({ error: 'Asset not found.' }); }
      const nextV = asset.currentVersion + 1;
      asset.versions.push({ version: nextV, path: enc.path, size: enc.size, hash: enc.hash, uploadedBy: req.user.id, note: note || `Version ${nextV}` });
      asset.currentVersion = nextV;
      await asset.save();
      await logAudit({ action: 'VERSION_UPLOAD', userId: req.user.id, ip, details: `asset=${asset._id} v=${nextV}` });
      return res.status(201).json({ message: 'New version uploaded.', asset });
    }
    if (!categoryId) { fs.unlink(enc.path, () => { }); return res.status(400).json({ error: 'A category is required.' }); }
    const category = await Category.findById(categoryId);
    if (!category) { fs.unlink(enc.path, () => { }); return res.status(400).json({ error: 'Selected category does not exist.' }); }
    if (req.user.role !== 'Admin' && !category.allowedRoles.includes(req.user.role)) { fs.unlink(enc.path, () => { }); return res.status(403).json({ error: 'You cannot upload into this category.' }); }
    let departmentRef = null;
    if (departmentId) {
      const dept = await Department.findById(departmentId);
      if (!dept || String(dept.category) !== String(category._id)) { fs.unlink(enc.path, () => { }); return res.status(400).json({ error: 'Selected department does not belong to this category.' }); }
      departmentRef = dept._id;
    }
    const asset = await Asset.create({
      filename: filename || req.file.originalname, keywords: keywords || '', type: req.file.mimetype, fileType: fType || '',
      category: category._id, department: departmentRef, sensitivity: SENSITIVITY.includes(sensitivity) ? sensitivity : 'Internal',
      allowedRoles: category.allowedRoles, downloadRoles: category.downloadRoles || [],
      currentVersion: 1, versions: [{ version: 1, path: enc.path, size: enc.size, hash: enc.hash, uploadedBy: req.user.id, note: note || 'Initial version' }],
      uploadedBy: req.user.id,
    });
    await logAudit({ action: 'UPLOAD', userId: req.user.id, ip, details: `asset=${asset._id} file=${asset.filename} type=${fType}` });
    res.status(201).json({ message: 'Upload successful.', asset });
  } catch (err) { console.error('[UPLOAD]', err.message); res.status(500).json({ error: 'Upload failed.' }); }
});

app.post('/assets/bulk-upload', authenticate, authorize('Engineering', 'Legal', 'Management'), upload.array('files', 20), async (req, res) => {
  const ip = clientIp(req);
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded.' });
  const { categoryId, departmentId, sensitivity } = req.body;
  try {
    const category = await Category.findById(categoryId);
    if (!category) return res.status(400).json({ error: 'Selected category does not exist.' });
    if (req.user.role !== 'Admin' && !category.allowedRoles.includes(req.user.role)) return res.status(403).json({ error: 'You cannot upload into this category.' });
    let departmentRef = null;
    if (departmentId) { const dept = await Department.findById(departmentId); if (dept && String(dept.category) === String(category._id)) departmentRef = dept._id; }
    const created = []; const skipped = [];
    for (const f of req.files) {
      const scan = scanFile(f.path, f.originalname);
      if (!scan.ok) { fs.unlink(f.path, () => { }); skipped.push({ name: f.originalname, reason: scan.reason }); continue; }
      const enc = ingestUpload(f.path); // encrypt + remove plaintext temp
      const asset = await Asset.create({
        filename: f.originalname, type: f.mimetype, fileType: fileTypeLabel(f.originalname) || '',
        category: category._id, department: departmentRef, sensitivity: SENSITIVITY.includes(sensitivity) ? sensitivity : 'Internal',
        allowedRoles: category.allowedRoles, downloadRoles: category.downloadRoles || [],
        currentVersion: 1, versions: [{ version: 1, path: enc.path, size: enc.size, hash: enc.hash, uploadedBy: req.user.id, note: 'Initial version' }],
        uploadedBy: req.user.id,
      });
      created.push(asset._id);
    }
    await logAudit({ action: 'BULK_UPLOAD', userId: req.user.id, ip, details: `created=${created.length} skipped=${skipped.length} category=${category.name}` });
    res.status(201).json({ message: `Uploaded ${created.length} file(s).`, created: created.length, skipped });
  } catch (err) { console.error('[BULK_UPLOAD]', err.message); res.status(500).json({ error: 'Bulk upload failed.' }); }
});

app.patch('/assets/:id', authenticate, authorize('Admin'), async (req, res) => {
  const ip = clientIp(req);
  const { filename, keywords, sensitivity, departmentId } = req.body || {};
  try {
    const asset = await Asset.findById(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    if (filename) asset.filename = filename;
    if (keywords !== undefined) asset.keywords = keywords;
    if (sensitivity && SENSITIVITY.includes(sensitivity)) asset.sensitivity = sensitivity;
    if (departmentId !== undefined) {
      if (departmentId === '' || departmentId === null) asset.department = null;
      else { const dept = await Department.findById(departmentId); if (dept && String(dept.category) === String(asset.category)) asset.department = dept._id; }
    }
    await asset.save();
    await logAudit({ action: 'ASSET_EDITED', userId: req.user.id, ip, details: `asset=${asset._id}`, severity: 'warn' });
    res.json({ message: 'Asset updated.', asset });
  } catch (err) { console.error('[ASSET_EDIT]', err.message); res.status(500).json({ error: 'Could not update asset.' }); }
});

app.post('/assets/:id/move', authenticate, authorize('Admin'), async (req, res) => {
  const ip = clientIp(req);
  const { categoryId, departmentId, mode } = req.body || {};
  try {
    const asset = await Asset.findById(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    const category = await Category.findById(categoryId);
    if (!category) return res.status(400).json({ error: 'Target category does not exist.' });
    let deptRef = null;
    if (departmentId) { const dept = await Department.findById(departmentId); if (dept && String(dept.category) === String(category._id)) deptRef = dept._id; }
    if (mode === 'copy') {
      const latest = asset.versions[asset.versions.length - 1];
      const newPath = path.join(UPLOAD_DIR, `${Date.now()}_copy_${path.basename(latest.path)}`);
      fs.copyFileSync(latest.path, newPath);
      const copy = await Asset.create({
        filename: asset.filename, keywords: asset.keywords, type: asset.type, fileType: asset.fileType,
        category: category._id, department: deptRef, sensitivity: asset.sensitivity,
        allowedRoles: category.allowedRoles, downloadRoles: category.downloadRoles || [],
        currentVersion: 1, versions: [{ version: 1, path: newPath, size: latest.size, hash: latest.hash, uploadedBy: req.user.id, note: 'Copied' }],
        uploadedBy: req.user.id,
      });
      await logAudit({ action: 'ASSET_COPIED', userId: req.user.id, ip, details: `from=${asset._id} to=${copy._id}`, severity: 'warn' });
      return res.json({ message: 'Asset copied.', asset: copy });
    }
    asset.category = category._id; asset.department = deptRef;
    asset.allowedRoles = category.allowedRoles; asset.downloadRoles = category.downloadRoles || [];
    await asset.save();
    await logAudit({ action: 'ASSET_MOVED', userId: req.user.id, ip, details: `asset=${asset._id} category=${category.name}`, severity: 'warn' });
    res.json({ message: 'Asset moved.', asset });
  } catch (err) { console.error('[ASSET_MOVE]', err.message); res.status(500).json({ error: 'Could not move/copy asset.' }); }
});

app.delete('/assets/:id', authenticate, authorize('Admin'), async (req, res) => {
  const ip = clientIp(req);
  try {
    const asset = await Asset.findById(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    for (const v of asset.versions) { try { fs.unlinkSync(v.path); } catch { /* ignore */ } }
    await Asset.deleteOne({ _id: asset._id });
    await AccessRequest.deleteMany({ asset: asset._id });
    await logAudit({ action: 'ASSET_DELETED', userId: req.user.id, ip, details: `asset=${asset._id} file=${asset.filename}`, severity: 'warn' });
    res.json({ message: 'Asset deleted.' });
  } catch (err) { console.error('[ASSET_DELETE]', err.message); res.status(500).json({ error: 'Could not delete asset.' }); }
});

app.post('/assets/:id/grant', authenticate, authorize('Admin'), async (req, res) => {
  const ip = clientIp(req);
  const { userId, kind, revoke } = req.body || {};
  try {
    const asset = await Asset.findById(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    const target = await User.findById(userId);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    const listName = kind === 'download' ? 'userDownloadGrants' : 'userViewGrants';
    const has = userGranted(asset[listName], userId);
    if (revoke) asset[listName] = asset[listName].filter((id) => String(id) !== String(userId));
    else if (!has) { asset[listName].push(userId); if (kind === 'download' && !userGranted(asset.userViewGrants, userId)) asset.userViewGrants.push(userId); }
    await asset.save();
    await logAudit({ action: revoke ? 'GRANT_REVOKED' : 'GRANT_ADDED', userId: req.user.id, ip, details: `asset=${asset._id} user=${target.email} kind=${kind || 'view'}`, severity: 'warn' });
    if (!revoke) await notify(userId, `You were granted ${kind || 'view'} access to "${asset.filename}".`, '/');
    res.json({ message: revoke ? 'Grant revoked.' : 'Grant added.' });
  } catch (err) { console.error('[GRANT]', err.message); res.status(500).json({ error: 'Could not update grant.' }); }
});

app.get('/assets/:id/grants', authenticate, authorize('Admin'), async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id).populate('userViewGrants', 'name email role').populate('userDownloadGrants', 'name email role').lean();
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    res.json({ viewGrants: asset.userViewGrants || [], downloadGrants: asset.userDownloadGrants || [] });
  } catch { res.status(500).json({ error: 'Could not load grants.' }); }
});

app.get('/assets/:id/versions', authenticate, async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id).populate('versions.uploadedBy', 'name email').populate('department', 'allowedRoles downloadRoles').lean();
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    asset._deptAllowedRoles = asset.department?.allowedRoles;
    if (!canView(req.user, asset)) return res.status(403).json({ error: 'Forbidden.' });
    res.json({ filename: asset.filename, versions: [...asset.versions].reverse() });
  } catch { res.status(500).json({ error: 'Could not load versions.' }); }
});

app.get('/assets/:id/view', authenticate, async (req, res) => {
  const ip = clientIp(req);
  try {
    const asset = await Asset.findById(req.params.id).populate('department', 'allowedRoles downloadRoles').lean();
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    asset._deptAllowedRoles = asset.department?.allowedRoles;
    asset._deptDownloadRoles = asset.department?.downloadRoles;
    if (!canView(req.user, asset)) { await logAudit({ action: 'VIEW_DENIED', userId: req.user.id, ip, details: `asset=${asset._id}`, severity: 'critical' }); return res.status(403).json({ error: 'Forbidden: not authorized to view this asset.' }); }
    const latest = asset.versions[asset.versions.length - 1];
    const ext = extOf(asset.filename);
    const isPdf = ext === 'pdf';
    const isImage = ['jpg', 'jpeg', 'png'].includes(ext);
    const isConvertible = ['doc', 'docx'].includes(ext); // rendered to a PDF preview server-side
    const previewable = isPdf || isImage || isConvertible;
    const previewKind = isPdf ? 'pdf' : isImage ? 'image' : isConvertible ? 'pdf' : 'none';
    await logAudit({ action: 'VIEW', userId: req.user.id, ip, details: `asset=${asset._id}` });
    res.json({
      message: 'Secure view session opened.',
      watermark: `CONFIDENTIAL • ${req.user.email} • ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
      previewable, previewKind,
      canDownload: canDownload(req.user, asset),
      asset: { id: asset._id, filename: asset.filename, type: asset.type, fileType: asset.fileType, sensitivity: asset.sensitivity, version: asset.currentVersion, hash: latest?.hash || '' },
    });
  } catch (err) { console.error('[VIEW]', err.message); res.status(500).json({ error: 'Could not open secure view.' }); }
});

app.get('/assets/:id/raw', authenticate, async (req, res) => {
  const ip = clientIp(req);
  try {
    const asset = await Asset.findById(req.params.id).populate('department', 'allowedRoles downloadRoles').lean();
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    asset._deptAllowedRoles = asset.department?.allowedRoles;
    asset._deptDownloadRoles = asset.department?.downloadRoles;
    if (!canView(req.user, asset)) { await logAudit({ action: 'VIEW_DENIED', userId: req.user.id, ip, details: `asset=${asset._id} (raw)`, severity: 'critical' }); return res.status(403).json({ error: 'Forbidden.' }); }
    const latest = asset.versions[asset.versions.length - 1];
    if (!latest || !fs.existsSync(latest.path)) return res.status(404).json({ error: 'File data not found.' });
    const wantsDownload = req.query.download === '1' || req.query.download === 'true';
    const ext = extOf(asset.filename);
    const wmText = `${req.user.email}  ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;

    // Decrypt the stored file into memory only (never back to plaintext on disk).
    let plain;
    try { plain = readEncrypted(latest.path); }
    catch { await logAudit({ action: 'DECRYPT_FAILED', userId: req.user.id, ip, details: `asset=${asset._id}`, severity: 'critical' }); return res.status(500).json({ error: 'File could not be decrypted (it may be corrupted or tampered with).' }); }

    if (wantsDownload) {
      if (!canDownload(req.user, asset)) { await logAudit({ action: 'DOWNLOAD_DENIED', userId: req.user.id, ip, details: `asset=${asset._id}`, severity: 'critical' }); return res.status(403).json({ error: 'Your role is not permitted to download this file.' }); }
      await logAudit({ action: 'DOWNLOAD', userId: req.user.id, ip, details: `asset=${asset._id}`, severity: 'warn' });
      res.setHeader('Content-Type', asset.type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(asset.filename)}"`);
      return res.end(plain);
    }

    await logAudit({ action: 'VIEW_STREAM', userId: req.user.id, ip, details: `asset=${asset._id}` });
    res.setHeader('Cache-Control', 'private, no-store');

    if (ext === 'pdf') {
      const bytes = await watermarkPdfBuffer(plain, wmText);
      res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'inline');
      return res.end(Buffer.from(bytes));
    }
    if (['jpg', 'jpeg', 'png'].includes(ext)) {
      const buf = await watermarkImageBuffer(plain, wmText);
      res.setHeader('Content-Type', 'image/png'); res.setHeader('Content-Disposition', 'inline');
      return res.end(buf);
    }
    // Word (and any other convertible type): render to a PDF preview, then watermark.
    if (['doc', 'docx'].includes(ext)) {
      try {
        const pdfBuf = await convertToPdf(plain, ext);
        const bytes = await watermarkPdfBuffer(pdfBuf, wmText);
        res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'inline');
        return res.end(Buffer.from(bytes));
      } catch (e) {
        console.error('[CONVERT]', e.message);
        return res.status(422).json({ error: 'This document could not be converted for preview. You may still download it if permitted.' });
      }
    }
    // CAD / Gerber: no reliable server-side renderer exists.
    return res.status(415).json({ error: 'This file type cannot be previewed inline.' });
  } catch (err) { console.error('[RAW]', err.message); if (!res.headersSent) res.status(500).json({ error: 'Could not stream file.' }); }
});

async function watermarkPdfBuffer(src, text) {
  const pdf = await PDFDocument.load(src, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    for (let y = 0; y < height + 200; y += 160) for (let x = -100; x < width; x += 260)
      page.drawText(text, { x, y, size: 12, font, color: rgb(0.5, 0.5, 0.5), opacity: 0.18, rotate: degrees(30) });
  }
  return pdf.save();
}
async function watermarkImageBuffer(srcBuf, text) {
  const base = sharp(srcBuf);
  const meta = await base.metadata();
  const w = Math.min(meta.width || 1000, 2000), h = Math.min(meta.height || 1000, 2000);
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let texts = '';
  for (let y = 0; y < h + 200; y += 120) for (let x = -100; x < w; x += 280)
    texts += `<text x="${x}" y="${y}" font-family="monospace" font-size="14" fill="#000" fill-opacity="0.15" transform="rotate(-30 ${x} ${y})">${escaped}</text>`;
  const svg = Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${texts}</svg>`);
  return base.resize(w, h, { fit: 'inside' }).composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer();
}

// Convert an Office document buffer to a PDF buffer using headless LibreOffice.
// Used so Word files can be previewed inline (they can't render natively in a
// browser). Works in a private temp dir; inputs/outputs are cleaned up.
// NOTE: CAD/Gerber have no reliable free converter and are intentionally not
// handled here; if you add one later, route its extensions through this helper.
function convertToPdf(inputBuf, ext) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-conv-'));
    const inPath = path.join(dir, `src.${ext}`);
    fs.writeFileSync(inPath, inputBuf);
    const soffice = process.env.SOFFICE_PATH || 'soffice';
    execFile(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', dir, inPath], { timeout: 60000 }, (err) => {
      try {
        if (err) { cleanup(); return reject(err); }
        const outPath = path.join(dir, 'src.pdf');
        if (!fs.existsSync(outPath)) { cleanup(); return reject(new Error('conversion produced no output')); }
        const pdf = fs.readFileSync(outPath);
        cleanup();
        resolve(pdf);
      } catch (e) { cleanup(); reject(e); }
    });
    function cleanup() { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
  });
}

app.post('/access-requests', authenticate, async (req, res) => {
  const ip = clientIp(req);
  const { assetId, reason, kind } = req.body || {};
  try {
    const asset = await Asset.findById(assetId).populate('department', 'allowedRoles downloadRoles');
    if (!asset) return res.status(404).json({ error: 'Asset not found.' });
    const assetObj = asset.toObject();
    assetObj._deptAllowedRoles = asset.department?.allowedRoles;
    assetObj._deptDownloadRoles = asset.department?.downloadRoles;
    const want = kind === 'download' ? 'download' : 'view';
    if (want === 'view' && canView(req.user, assetObj)) return res.status(400).json({ error: 'You already have view access.' });
    if (want === 'download' && canDownload(req.user, assetObj)) return res.status(400).json({ error: 'You already have download access.' });
    if (await AccessRequest.findOne({ asset: assetId, requestedBy: req.user.id, status: 'Pending' })) return res.status(409).json({ error: 'A pending request already exists.' });
    const reqDoc = await AccessRequest.create({ asset: assetId, requestedBy: req.user.id, reason: reason || '', kind: want });
    await logAudit({ action: 'ACCESS_REQUESTED', userId: req.user.id, ip, details: `asset=${assetId} kind=${want}`, severity: 'warn' });
    const admins = await User.find({ role: 'Admin', active: true }).select('_id').lean();
    for (const a of admins) await notify(a._id, `${req.user.email} requested ${want} access to "${asset.filename}".`, '/requests');
    res.status(201).json({ message: 'Access request submitted.', request: reqDoc });
  } catch (err) { console.error('[ACCESS_REQ]', err.message); res.status(500).json({ error: 'Could not submit request.' }); }
});

app.get('/access-requests', authenticate, async (req, res) => {
  try {
    const filter = req.user.role === 'Admin' ? {} : { requestedBy: req.user.id };
    const reqs = await AccessRequest.find(filter).sort({ createdAt: -1 }).populate('asset', 'filename sensitivity').populate('requestedBy', 'name email role').lean();
    res.json({ requests: reqs });
  } catch { res.status(500).json({ error: 'Could not load requests.' }); }
});

app.post('/access-requests/:id/decide', authenticate, authorize('Admin'), async (req, res) => {
  const ip = clientIp(req);
  const { decision } = req.body || {};
  if (!['Approved', 'Denied'].includes(decision)) return res.status(400).json({ error: 'decision must be Approved or Denied.' });
  try {
    const reqDoc = await AccessRequest.findById(req.params.id).populate('requestedBy', 'role email').populate('asset', 'filename');
    if (!reqDoc) return res.status(404).json({ error: 'Request not found.' });
    if (reqDoc.status !== 'Pending') return res.status(409).json({ error: 'Request already decided.' });
    reqDoc.status = decision; reqDoc.decidedBy = req.user.id; reqDoc.decidedAt = new Date();
    await reqDoc.save();
    if (decision === 'Approved') {
      const asset = await Asset.findById(reqDoc.asset._id);
      if (asset) {
        if (!userGranted(asset.userViewGrants, reqDoc.requestedBy._id)) asset.userViewGrants.push(reqDoc.requestedBy._id);
        if (reqDoc.kind === 'download' && !userGranted(asset.userDownloadGrants, reqDoc.requestedBy._id)) asset.userDownloadGrants.push(reqDoc.requestedBy._id);
        await asset.save();
      }
    }
    await logAudit({ action: `ACCESS_${decision.toUpperCase()}`, userId: req.user.id, ip, details: `request=${reqDoc._id}`, severity: decision === 'Approved' ? 'info' : 'warn' });
    await notify(reqDoc.requestedBy._id, `Your access request for "${reqDoc.asset.filename}" was ${decision.toLowerCase()}.`, '/');
    res.json({ message: `Request ${decision.toLowerCase()}.`, request: reqDoc });
  } catch (err) { console.error('[DECIDE]', err.message); res.status(500).json({ error: 'Could not decide request.' }); }
});

app.get('/notifications', authenticate, async (req, res) => {
  try {
    const items = await Notification.find({ user: req.user.id }).sort({ createdAt: -1 }).limit(50).lean();
    const unread = await Notification.countDocuments({ user: req.user.id, read: false });
    res.json({ notifications: items, unread });
  } catch { res.status(500).json({ error: 'Could not load notifications.' }); }
});
app.post('/notifications/read', authenticate, async (req, res) => {
  try { await Notification.updateMany({ user: req.user.id, read: false }, { read: true }); res.json({ message: 'Marked read.' }); }
  catch { res.status(500).json({ error: 'Could not update notifications.' }); }
});

// ================================================================ CATEGORIES
app.get('/categories', authenticate, async (req, res) => {
  try {
    const categories = await Category.find({}).sort({ name: 1 }).lean();
    const departments = await Department.find({}).sort({ name: 1 }).lean();
    const shaped = categories.map((c) => ({
      _id: c._id, name: c.name, allowedRoles: c.allowedRoles, downloadRoles: c.downloadRoles || [],
      accessible: req.user.role === 'Admin' || (c.allowedRoles || []).includes(req.user.role),
      departments: departments.filter((d) => String(d.category) === String(c._id)).map((d) => ({ _id: d._id, name: d.name, allowedRoles: d.allowedRoles || [], downloadRoles: d.downloadRoles || [] })),
    }));
    res.json({ categories: shaped });
  } catch (err) { console.error('[CATEGORIES]', err.message); res.status(500).json({ error: 'Could not load categories.' }); }
});

app.post('/categories', authenticate, authorize('Admin'), async (req, res) => {
  const ip = clientIp(req);
  const { name, allowedRoles, downloadRoles } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Category name is required.' });
  const roles = Array.isArray(allowedRoles) ? allowedRoles.filter((r) => ROLES.includes(r)) : [];
  if (roles.length === 0) return res.status(400).json({ error: 'Select at least one role for view access.' });
  const dlRoles = Array.isArray(downloadRoles) ? downloadRoles.filter((r) => roles.includes(r)) : [];
  try {
    if (await Category.findOne({ name: name.trim() })) return res.status(409).json({ error: 'A category with that name already exists.' });
    const cat = await Category.create({ name: name.trim(), allowedRoles: roles, downloadRoles: dlRoles, createdBy: req.user.id });
    await logAudit({ action: 'CATEGORY_CREATED', userId: req.user.id, ip, details: `name=${cat.name}`, severity: 'warn' });
    res.status(201).json({ message: 'Category created.', category: cat });
  } catch (err) { console.error('[CATEGORY_CREATE]', err.message); res.status(500).json({ error: 'Could not create category.' }); }
});

app.patch('/categories/:id', authenticate, authorize('Admin'), async (req, res) => {
  const ip = clientIp(req);
  const { allowedRoles, downloadRoles } = req.body || {};
  try {
    const cat = await Category.findById(req.params.id);
    if (!cat) return res.status(404).json({ error: 'Category not found.' });
    const roles = Array.isArray(allowedRoles) ? allowedRoles.filter((r) => ROLES.includes(r)) : cat.allowedRoles;
    if (roles.length === 0) return res.status(400).json({ error: 'Select at least one role for view access.' });
    const dlSource = Array.isArray(downloadRoles) ? downloadRoles : (cat.downloadRoles || []);
    const dlRoles = dlSource.filter((r) => roles.includes(r));
    cat.allowedRoles = roles; cat.downloadRoles = dlRoles;
    await cat.save();
    await Asset.updateMany({ category: cat._id }, { allowedRoles: roles, downloadRoles: dlRoles });
    await logAudit({ action: 'CATEGORY_UPDATED', userId: req.user.id, ip, details: `name=${cat.name}`, severity: 'warn' });
    res.json({ message: 'Category updated.', category: cat });
  } catch (err) { console.error('[CATEGORY_UPDATE]', err.message); res.status(500).json({ error: 'Could not update category.' }); }
});

app.delete('/categories/:id', authenticate, authorize('Admin'), async (req, res) => {
  const ip = clientIp(req);
  try {
    const cat = await Category.findById(req.params.id);
    if (!cat) return res.status(404).json({ error: 'Category not found.' });
    if (await Asset.countDocuments({ category: cat._id }) > 0) return res.status(409).json({ error: 'Cannot delete: assets still use this category.' });
    await Department.deleteMany({ category: cat._id });
    await Category.deleteOne({ _id: cat._id });
    await logAudit({ action: 'CATEGORY_DELETED', userId: req.user.id, ip, details: `name=${cat.name}`, severity: 'warn' });
    res.json({ message: 'Category deleted.' });
  } catch (err) { console.error('[CATEGORY_DELETE]', err.message); res.status(500).json({ error: 'Could not delete category.' }); }
});

app.post('/departments', authenticate, authorize('Admin'), async (req, res) => {
  const ip = clientIp(req);
  const { name, categoryId, allowedRoles, downloadRoles } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Department name is required.' });
  if (!categoryId) return res.status(400).json({ error: 'A parent category is required.' });
  try {
    const cat = await Category.findById(categoryId);
    if (!cat) return res.status(400).json({ error: 'Parent category does not exist.' });
    if (await Department.findOne({ name: name.trim(), category: cat._id })) return res.status(409).json({ error: 'That department already exists in this category.' });
    const aRoles = Array.isArray(allowedRoles) ? allowedRoles.filter((r) => cat.allowedRoles.includes(r)) : [];
    const dRoles = Array.isArray(downloadRoles) ? downloadRoles.filter((r) => aRoles.includes(r)) : [];
    const dept = await Department.create({ name: name.trim(), category: cat._id, allowedRoles: aRoles, downloadRoles: dRoles, createdBy: req.user.id });
    await logAudit({ action: 'DEPARTMENT_CREATED', userId: req.user.id, ip, details: `name=${dept.name} category=${cat.name}`, severity: 'warn' });
    res.status(201).json({ message: 'Department created.', department: dept });
  } catch (err) { console.error('[DEPARTMENT_CREATE]', err.message); res.status(500).json({ error: 'Could not create department.' }); }
});

app.patch('/departments/:id', authenticate, authorize('Admin'), async (req, res) => {
  const ip = clientIp(req);
  const { allowedRoles, downloadRoles } = req.body || {};
  try {
    const dept = await Department.findById(req.params.id);
    if (!dept) return res.status(404).json({ error: 'Department not found.' });
    const cat = await Category.findById(dept.category);
    const aRoles = Array.isArray(allowedRoles) ? allowedRoles.filter((r) => cat.allowedRoles.includes(r)) : dept.allowedRoles;
    const dRoles = Array.isArray(downloadRoles) ? downloadRoles.filter((r) => aRoles.includes(r)) : (dept.downloadRoles || []).filter((r) => aRoles.includes(r));
    dept.allowedRoles = aRoles; dept.downloadRoles = dRoles;
    await dept.save();
    await logAudit({ action: 'DEPARTMENT_UPDATED', userId: req.user.id, ip, details: `name=${dept.name}`, severity: 'warn' });
    res.json({ message: 'Department updated.', department: dept });
  } catch (err) { console.error('[DEPARTMENT_UPDATE]', err.message); res.status(500).json({ error: 'Could not update department.' }); }
});

app.delete('/departments/:id', authenticate, authorize('Admin'), async (req, res) => {
  const ip = clientIp(req);
  try {
    const dept = await Department.findById(req.params.id);
    if (!dept) return res.status(404).json({ error: 'Department not found.' });
    if (await Asset.countDocuments({ department: dept._id }) > 0) return res.status(409).json({ error: 'Cannot delete: assets still use this department.' });
    await Department.deleteOne({ _id: dept._id });
    await logAudit({ action: 'DEPARTMENT_DELETED', userId: req.user.id, ip, details: `name=${dept.name}`, severity: 'warn' });
    res.json({ message: 'Department deleted.' });
  } catch (err) { console.error('[DEPARTMENT_DELETE]', err.message); res.status(500).json({ error: 'Could not delete department.' }); }
});

// ================================================================ AUDIT + USERS
app.get('/audit', authenticate, authorize('Admin'), async (req, res) => {
  try {
    const { severity, action } = req.query;
    const q = {};
    if (severity) q.severity = severity;
    if (action) q.action = new RegExp(action, 'i');
    const logs = await AuditLog.find(q).sort({ timestamp: -1 }).limit(300).populate('userId', 'name email role').lean();
    res.json({ logs });
  } catch { res.status(500).json({ error: 'Could not fetch audit logs.' }); }
});

app.get('/users', authenticate, authorize('Admin'), async (req, res) => {
  const users = await User.find({}).select('-password').sort({ createdAt: 1 }).lean();
  res.json({ users });
});

function generateTempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ', lower = 'abcdefghijkmnopqrstuvwxyz', digits = '23456789', symbols = '@#$%&*';
  const all = upper + lower + digits + symbols;
  const pick = (s) => s[crypto.randomInt(s.length)];
  let chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 12) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1);[chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

app.post('/users', authenticate, authorize('Admin'), async (req, res) => {
  const ip = clientIp(req);
  const { name, email, role, title } = req.body || {};
  if (!name || !email || !role) return res.status(400).json({ error: 'Name, email and role are required.' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: `Role must be one of: ${ROLES.join(', ')}.` });
  try {
    const normalizedEmail = email.toLowerCase().trim();
    if (await User.findOne({ email: normalizedEmail })) return res.status(409).json({ error: 'A user with that email already exists.' });
    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, 12);
    const user = await User.create({ name: name.trim(), email: normalizedEmail, password: hash, role, title: title || '', active: true, mustChangePassword: true });
    await logAudit({ action: 'USER_CREATED', userId: req.user.id, ip, details: `created=${user.email} role=${role}`, severity: 'warn' });
    await sendEmail(normalizedEmail, 'Your Fort Knox EDMS account', `An account was created for you.\nEmail: ${normalizedEmail}\nTemporary password: ${tempPassword}\nYou will be asked to change it on first login.`);
    res.status(201).json({ message: 'User created.', tempPassword, user: { id: user._id, name: user.name, email: user.email, role: user.role, title: user.title, active: user.active } });
  } catch (err) { console.error('[USER_CREATE]', err.message); res.status(500).json({ error: 'Could not create user.' }); }
});

app.patch('/users/:id/role', authenticate, authorize('Admin'), async (req, res) => {
  const ip = clientIp(req);
  const { role } = req.body || {};
  if (!ROLES.includes(role)) return res.status(400).json({ error: `Role must be one of: ${ROLES.join(', ')}.` });
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (String(user._id) === String(req.user.id) && role !== 'Admin') return res.status(400).json({ error: 'You cannot remove your own Admin role.' });
    const prev = user.role; user.role = role; await user.save();
    await logAudit({ action: 'USER_ROLE_CHANGED', userId: req.user.id, ip, details: `target=${user.email} ${prev} -> ${role}`, severity: 'warn' });
    res.json({ message: 'Role updated.', user: { id: user._id, role: user.role } });
  } catch (err) { console.error('[USER_ROLE]', err.message); res.status(500).json({ error: 'Could not update role.' }); }
});

app.patch('/users/:id/active', authenticate, authorize('Admin'), async (req, res) => {
  const ip = clientIp(req);
  const { active } = req.body || {};
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'active must be true or false.' });
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (String(user._id) === String(req.user.id) && active === false) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    user.active = active; await user.save();
    await logAudit({ action: active ? 'USER_REACTIVATED' : 'USER_DEACTIVATED', userId: req.user.id, ip, details: `target=${user.email}`, severity: 'warn' });
    res.json({ message: active ? 'User reactivated.' : 'User deactivated.', user: { id: user._id, active: user.active } });
  } catch (err) { console.error('[USER_ACTIVE]', err.message); res.status(500).json({ error: 'Could not update user status.' }); }
});

app.post('/users/:id/reset-password', authenticate, authorize('Admin'), async (req, res) => {
  const ip = clientIp(req);
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const tempPassword = generateTempPassword();
    user.password = await bcrypt.hash(tempPassword, 12);
    user.mustChangePassword = true;
    await user.save();
    await logAudit({ action: 'USER_PASSWORD_RESET', userId: req.user.id, ip, details: `target=${user.email}`, severity: 'warn' });
    await sendEmail(user.email, 'Your Fort Knox EDMS password was reset', `A new temporary password was set: ${tempPassword}\nYou will be asked to change it on next login.`);
    res.json({ message: 'Password reset.', tempPassword, user: { id: user._id, email: user.email } });
  } catch (err) { console.error('[USER_RESET]', err.message); res.status(500).json({ error: 'Could not reset password.' }); }
});

app.use((err, req, res, next) => { if (err) return res.status(400).json({ error: err.message || 'Request failed.' }); next(); });

// ---------------------------------------------------------------- Seed
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
    if (!user) { const hash = await bcrypt.hash(u.password, 12); user = await User.create({ ...u, password: hash, mustChangePassword: false }); console.log(`[SEED] user ${u.role} -> ${u.email} / ${u.password}`); }
    created[u.role] = user;
  }
  const catDefs = [
    { name: 'Technical', allowedRoles: ['Engineering'], downloadRoles: ['Engineering'], departments: ['CAD', 'PCB'] },
    { name: 'Legal', allowedRoles: ['Legal'], downloadRoles: [], departments: ['Internal', 'Patents'] },
    { name: 'Operational', allowedRoles: ['Management'], downloadRoles: ['Management'], departments: ['Reports'] },
  ];
  const catMap = {}; const deptMap = {};
  for (const c of catDefs) {
    let cat = await Category.findOne({ name: c.name });
    if (!cat) cat = await Category.create({ name: c.name, allowedRoles: c.allowedRoles, downloadRoles: c.downloadRoles, createdBy: created.Admin._id });
    catMap[c.name] = cat;
    for (const dName of c.departments) { let dept = await Department.findOne({ name: dName, category: cat._id }); if (!dept) dept = await Department.create({ name: dName, category: cat._id, allowedRoles: [], downloadRoles: [], createdBy: created.Admin._id }); deptMap[`${c.name}/${dName}`] = dept; }
  }
  if ((await Asset.countDocuments({})) === 0) {
    const demo = [
      { filename: 'Structural_Blueprints_v4.dwg', category: 'Technical', dept: 'CAD', sensitivity: 'Internal', type: 'application/acad', fileType: 'CAD' },
      { filename: 'PCB_Layout_MainBoard.gbr', category: 'Technical', dept: 'PCB', sensitivity: 'Confidential', type: 'text/plain', fileType: 'Gerber' },
      { filename: 'Patent_Filing_US2026.pdf', category: 'Legal', dept: 'Patents', sensitivity: 'Strictly Confidential', type: 'application/pdf', fileType: 'PDF' },
      { filename: 'Q3_Operations_Report.pdf', category: 'Operational', dept: 'Reports', sensitivity: 'Internal', type: 'application/pdf', fileType: 'PDF' },
      { filename: 'Compliance_Audit_2026.pdf', category: 'Legal', dept: 'Internal', sensitivity: 'Confidential', type: 'application/pdf', fileType: 'PDF' },
    ];
    for (const d of demo) {
      // Build the plaintext bytes, then store them ENCRYPTED (like real uploads).
      let plain;
      if (d.fileType === 'PDF') {
        const pdf = await PDFDocument.create();
        const page = pdf.addPage([595, 842]);
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        page.drawText(d.filename, { x: 60, y: 760, size: 18, font });
        page.drawText('Demo document content for Fort Knox EDMS.', { x: 60, y: 720, size: 12, font });
        plain = Buffer.from(await pdf.save());
      } else plain = Buffer.from(`Mock content for ${d.filename}\n`);
      const encPath = path.join(UPLOAD_DIR, `seed_${Date.now()}_${Math.round(Math.random() * 1e6)}_${d.filename}.enc`);
      encryptBufferToFile(plain, encPath);
      const hash = sha256Buffer(plain);
      const cat = catMap[d.category]; const dept = deptMap[`${d.category}/${d.dept}`];
      await Asset.create({ filename: d.filename, type: d.type, fileType: d.fileType, category: cat._id, department: dept ? dept._id : null, sensitivity: d.sensitivity, allowedRoles: cat.allowedRoles, downloadRoles: cat.downloadRoles || [], currentVersion: 1, versions: [{ version: 1, path: encPath, size: plain.length, hash, uploadedBy: created.Admin._id, note: 'Initial version' }], uploadedBy: created.Admin._id });
    }
    console.log('[SEED] demo assets created (encrypted at rest)');
  }
}

// Connect, seed, and (when run directly) start listening. We export `app` and a
// `ready` promise so the test suite can import the app without opening a port.
const ready = mongoose.connect(MONGO_URI).then(async () => {
  console.log('[DB] Connected to MongoDB');
  await seed();
  // Only bind a port when this file is the entry point (not when imported by tests).
  if (require.main === module) {
    app.listen(PORT, () => console.log(`[API] Fort Knox EDMS v2 running on http://localhost:${PORT}`));
  }
}).catch((err) => {
  console.error('[DB] Connection error:', err.message);
  if (require.main === module) process.exit(1);
  throw err;
});

module.exports = { app, ready };

