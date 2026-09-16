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
const { sendEmail } = require('./utils/mailer');
require('dotenv').config();

// Execute Database Connection
const connectDB = require('./config/db');
connectDB();

const app = express();

// ---------------------------------------------------------------- Config
const PORT = process.env.PORT || 8007;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_only_secret_change_me';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';
const CLIENT_ORIGIN = 'https://lms1.wehear.in';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const PASSWORD_MIN = 8;

// --- Encryption-at-rest config ---
const FILE_ENC_KEY = (() => {
  const hex = process.env.FILE_ENCRYPTION_KEY;
  if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  if (process.env.NODE_ENV === 'production') {
    console.error('[SECURITY] FILE_ENCRYPTION_KEY is missing or invalid (need 64 hex chars). Refusing to start in production.');
    process.exit(1);
  }
  console.warn('[SECURITY] Using a DEV-ONLY file encryption key. Set FILE_ENCRYPTION_KEY (64 hex chars) in production.');
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

const UPLOAD_DIR = process.env.VAULT_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });
try { fs.chmodSync(UPLOAD_DIR, 0o700); } catch { /* non-POSIX fs: ignore */ }

const TEMP_DIR = process.env.VAULT_TEMP_DIR || path.join(os.tmpdir(), 'fk-uploads');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true, mode: 0o700 });
try { fs.chmodSync(TEMP_DIR, 0o700); } catch { /* ignore */ }



// ---------------------------------------------------------------- Models
const User = require('./models/User');
const Asset = require('./models/Asset');
const Category = require('./models/Category');
const Department = require('./models/Department');
const AccessRequest = require('./models/AccessRequest');
const Notification = require('./models/Notification');
const AuditLog = require('./models/AuditLog');

// ---------------------------------------------------------------- Helpers
// ---------------------------------------------------------------- Helpers
const { logAudit, clientIp } = require('./utils/logger');
const { authenticate, authorize, setAuthCookie } = require('./middlewares/authMiddleware');

function sha256Buffer(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

// --- Encryption at rest (AES-256-GCM) ---
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
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}
function ingestUpload(tempPath) {
  const plain = fs.readFileSync(tempPath);
  const hash = sha256Buffer(plain);
  const encPath = path.join(UPLOAD_DIR, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.enc`);
  encryptBufferToFile(plain, encPath);
  fs.unlinkSync(tempPath);
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

// ---------------------------------------------------------------- Multer Config
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

// ================================================================ ROUTES
app.use('/', require('./routes/authRoutes'));
app.use('/', require('./routes/userRoutes'));
app.use('/', require('./routes/categoryRoutes'));
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

// ---------------------------------------------------------------- Seed Data
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

// ---------------------------------------------------------------- Execute Seed & Listen
mongoose.connection.once('open', async () => {
  await seed();
  if (require.main === module) {
    app.listen(PORT, () => console.log(`[API] Fort Knox EDMS v2 running on http://localhost:${PORT}`));
  }
});

module.exports = { app };