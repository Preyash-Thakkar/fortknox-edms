const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Asset = require('../models/Asset');
const Category = require('../models/Category');
const Department = require('../models/Department');
const AccessRequest = require('../models/AccessRequest');
const User = require('../models/User');
const { logAudit, clientIp } = require('../utils/logger');
const { canView, canDownload, userGranted } = require('../utils/accessUtils');
const { notify } = require('../utils/notify');
const { fileTypeLabel, ingestUpload, scanFile, extOf, readEncrypted, watermarkPdfBuffer, watermarkImageBuffer, convertToPdf, UPLOAD_DIR } = require('../utils/fileUtils');

const SENSITIVITY = ['Public', 'Internal', 'Confidential', 'Strictly Confidential'];

exports.getStats = async (req, res) => {
    try {
        const isAdmin = req.user.role === 'Admin';
        const [totalAssets, pendingReqs, criticalEvents] = await Promise.all([
            Asset.countDocuments({}), AccessRequest.countDocuments({ status: 'Pending' }), AuditLog.countDocuments({ severity: 'critical' }),
        ]);

        let accessible = totalAssets;
        if (!isAdmin) {
            const role = req.user.role;
            const uid = new mongoose.Types.ObjectId(req.user.id);
            const result = await Asset.aggregate([
                { $lookup: { from: 'departments', localField: 'department', foreignField: '_id', as: '_dept' } },
                { $addFields: { _deptAllowed: { $ifNull: [{ $arrayElemAt: ['$_dept.allowedRoles', 0] }, []] } } },
                {
                    $match: {
                        $or: [
                            { allowedRoles: role, $or: [{ _deptAllowed: { $size: 0 } }, { _deptAllowed: role }] },
                            { userViewGrants: uid },
                        ],
                    },
                },
                { $count: 'n' },
            ]);
            accessible = result[0]?.n || 0;
        }
        res.json({ totalAssets, accessibleAssets: accessible, pendingRequests: pendingReqs, criticalEvents });
    } catch (err) { console.error('[STATS]', err.message); res.status(500).json({ error: 'Could not load stats.' }); }
};

exports.getAssets = async (req, res) => {
    try {
        const { category, department, q } = req.query;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
        const skip = (page - 1) * limit;

        const filter = {};
        if (category) filter.category = category;
        if (department) filter.department = department;

        let useTextScore = false;
        if (q && q.trim()) {
            const term = q.trim();
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

        const [total, assets] = await Promise.all([
            Asset.countDocuments(filter),
            Asset.find(filter, projection).populate('category', 'name allowedRoles downloadRoles').populate('department', 'name allowedRoles downloadRoles').sort(sort).skip(skip).limit(limit).lean(),
        ]);

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
};

exports.uploadAsset = async (req, res) => {
    const ip = clientIp(req);
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const scan = scanFile(req.file.path, req.file.originalname);
    if (!scan.ok) { fs.unlink(req.file.path, () => { }); await logAudit({ action: 'UPLOAD_BLOCKED', userId: req.user.id, ip, details: `${req.file.originalname}: ${scan.reason}`, severity: 'critical' }); return res.status(400).json({ error: `Upload rejected: ${scan.reason}` }); }
    try {
        const { filename, keywords, sensitivity, categoryId, departmentId, note, assetId } = req.body;
        const enc = ingestUpload(req.file.path);
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
};

exports.bulkUpload = async (req, res) => {
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
            const enc = ingestUpload(f.path);
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
};

exports.updateAsset = async (req, res) => {
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
};

exports.moveAsset = async (req, res) => {
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
};

exports.deleteAsset = async (req, res) => {
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
};

exports.grantAccess = async (req, res) => {
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
};

exports.getGrants = async (req, res) => {
    try {
        const asset = await Asset.findById(req.params.id).populate('userViewGrants', 'name email role').populate('userDownloadGrants', 'name email role').lean();
        if (!asset) return res.status(404).json({ error: 'Asset not found.' });
        res.json({ viewGrants: asset.userViewGrants || [], downloadGrants: asset.userDownloadGrants || [] });
    } catch { res.status(500).json({ error: 'Could not load grants.' }); }
};

exports.getVersions = async (req, res) => {
    try {
        const asset = await Asset.findById(req.params.id).populate('versions.uploadedBy', 'name email').populate('department', 'allowedRoles downloadRoles').lean();
        if (!asset) return res.status(404).json({ error: 'Asset not found.' });
        asset._deptAllowedRoles = asset.department?.allowedRoles;
        if (!canView(req.user, asset)) return res.status(403).json({ error: 'Forbidden.' });
        res.json({ filename: asset.filename, versions: [...asset.versions].reverse() });
    } catch { res.status(500).json({ error: 'Could not load versions.' }); }
};

exports.viewAsset = async (req, res) => {
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
        const isConvertible = ['doc', 'docx'].includes(ext);
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
};

exports.rawAsset = async (req, res) => {
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
        return res.status(415).json({ error: 'This file type cannot be previewed inline.' });
    } catch (err) { console.error('[RAW]', err.message); if (!res.headersSent) res.status(500).json({ error: 'Could not stream file.' }); }
};