const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const User = require('../models/User');
const Category = require('../models/Category');
const Department = require('../models/Department');
const Asset = require('../models/Asset');
const { encryptBufferToFile, sha256Buffer, UPLOAD_DIR } = require('./fileUtils');

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
            user = await User.create({ ...u, password: hash, mustChangePassword: false });
            console.log(`[SEED] user ${u.role} -> ${u.email} / ${u.password}`);
        }
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
        for (const dName of c.departments) {
            let dept = await Department.findOne({ name: dName, category: cat._id });
            if (!dept) dept = await Department.create({ name: dName, category: cat._id, allowedRoles: [], downloadRoles: [], createdBy: created.Admin._id });
            deptMap[`${c.name}/${dName}`] = dept;
        }
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

            const encPath = path.join(UPLOAD_DIR, `seed_${Date.now()}_${crypto.randomBytes(3).toString('hex')}_${d.filename}.enc`);
            encryptBufferToFile(plain, encPath);
            const hash = sha256Buffer(plain);
            const cat = catMap[d.category]; const dept = deptMap[`${d.category}/${d.dept}`];

            await Asset.create({
                filename: d.filename, type: d.type, fileType: d.fileType, category: cat._id, department: dept ? dept._id : null, sensitivity: d.sensitivity, allowedRoles: cat.allowedRoles, downloadRoles: cat.downloadRoles || [], currentVersion: 1,
                versions: [{ version: 1, path: encPath, size: plain.length, hash, uploadedBy: created.Admin._id, note: 'Initial version' }],
                uploadedBy: created.Admin._id
            });
        }
        console.log('[SEED] demo assets created (encrypted at rest)');
    }
}

module.exports = seed;