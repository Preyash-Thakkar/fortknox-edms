const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { PDFDocument, rgb, degrees, StandardFonts } = require('pdf-lib');
const sharp = require('sharp');

// --- Encryption-at-rest config ---
const FILE_ENC_KEY = (() => {
    const hex = process.env.FILE_ENCRYPTION_KEY;
    if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
    if (process.env.NODE_ENV === 'production') {
        console.error('[SECURITY] FILE_ENCRYPTION_KEY is missing or invalid.');
        process.exit(1);
    }
    return crypto.createHash('sha256').update('fortknox-dev-file-key').digest();
})();

const FILE_TYPES = {
    PDF: { exts: ['pdf'], mimes: ['application/pdf'] },
    Word: { exts: ['doc', 'docx'], mimes: ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
    Image: { exts: ['jpg', 'jpeg', 'png'], mimes: ['image/jpeg', 'image/png'] },
    Gerber: { exts: ['gbr', 'ger', 'gerber', 'gbl', 'gtl', 'gbs', 'gts', 'gbo', 'gto', 'drl', 'xln'], mimes: ['application/octet-stream', 'text/plain'] },
    CAD: { exts: ['dwg', 'dxf', 'step', 'stp', 'iges', 'igs', 'brd', 'sch'], mimes: ['application/octet-stream', 'application/acad', 'image/vnd.dwg'] },
};
const ALL_EXTS = Object.values(FILE_TYPES).flatMap((t) => t.exts);

const UPLOAD_DIR = process.env.VAULT_DIR || path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });
try { fs.chmodSync(UPLOAD_DIR, 0o700); } catch { /* ignore */ }

const TEMP_DIR = process.env.VAULT_TEMP_DIR || path.join(os.tmpdir(), 'fk-uploads');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true, mode: 0o700 });
try { fs.chmodSync(TEMP_DIR, 0o700); } catch { /* ignore */ }

const ENC_ALGO = 'aes-256-gcm';

function extOf(name) { return (name.split('.').pop() || '').toLowerCase(); }

function fileTypeLabel(name) {
    const e = extOf(name);
    for (const [label, t] of Object.entries(FILE_TYPES)) if (t.exts.includes(e)) return label;
    return null;
}

function sha256Buffer(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function encryptBufferToFile(plainBuf, destPath) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ENC_ALGO, FILE_ENC_KEY, iv);
    const enc = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
    const tag = cipher.getAuthTag();
    fs.writeFileSync(destPath, Buffer.concat([iv, tag, enc]), { mode: 0o600 });
    try { fs.chmodSync(destPath, 0o600); } catch { }
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
    } catch { }
    return { ok: true };
}

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
        function cleanup() { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { } }
    });
}

module.exports = {
    ALL_EXTS, UPLOAD_DIR, TEMP_DIR,
    extOf, fileTypeLabel, readEncrypted, ingestUpload, scanFile,
    watermarkPdfBuffer, watermarkImageBuffer, convertToPdf
};