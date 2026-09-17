const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Asset = require('../models/Asset');
const Category = require('../models/Category');
const Department = require('../models/Department');
const AccessRequest = require('../models/AccessRequest');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { logAudit, clientIp } = require('../utils/logger');
const { canView, canDownload, userGranted } = require('../utils/accessUtils');
const { notify } = require('../utils/notify');
const { fileTypeLabel, ingestUpload, scanFile, extOf, readEncrypted, watermarkPdfBuffer, watermarkImageBuffer, convertToPdf, UPLOAD_DIR } = require('../utils/fileUtils');
const { SENSITIVITY, DEPARTMENTS } = require('../constants');

exports.getStats = async (req, res) => {
    try {
        // 1. Get raw counts
        const totalAssets = await Asset.countDocuments();

        // 2. Fetch all assets to evaluate true cryptographic access
        const allAssets = await Asset.find().populate('department');

        // 3. Filter using our strict Zero-Trust logic
        const accessibleAssets = allAssets.filter(asset => canView(req.user, asset)).length;

        // 4. Scoped Pending Requests (Heads see their dept requests, Admins see all)
        let pendingQuery = { status: 'Pending' };
        if (req.user.role === 'Management' && req.user.headOfDepartments?.length > 0) {
            // Find assets belonging to their departments
            const deptAssets = await Asset.find({ departmentName: { $in: req.user.headOfDepartments } }).select('_id');
            pendingQuery.asset = { $in: deptAssets.map(a => a._id) };
        }
        const pendingRequests = await AccessRequest.countDocuments(pendingQuery);

        // 5. Critical Events (Fallback to 0 if AuditLog isn't wired yet)
        const criticalEvents = await AuditLog.countDocuments({ severity: 'CRITICAL' }) || 0;

        res.json({
            totalAssets,
            accessibleAssets,
            pendingRequests,
            criticalEvents
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch dashboard stats.' });
    }
};
exports.getAssets = async (req, res) => {
    try {
        const { category, department, q, trashed } = req.query;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
        const skip = (page - 1) * limit;

        const filter = {};
        // Exclude soft-deleted assets unless explicitly requested via trashed=1 by Admin
        if (trashed === '1' && req.user.role === 'Admin') {
            filter.deletedAt = { $ne: null };
        } else {
            filter.deletedAt = null;
        }

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
        const myReqs = await AccessRequest.find({ requestedBy: req.user.id, status: 'Pending', asset: { $in: pageIds } }).select('asset kind').lean();
        const pendingSet = new Set(myReqs.map((r) => `${r.asset}-${r.kind}`));

        const shaped = assets.map((a) => {
            a._deptAllowedRoles = a.department?.allowedRoles;
            a._deptDownloadRoles = a.department?.downloadRoles;
            return {
                _id: a._id, filename: a.filename, keywords: a.keywords, type: a.type, fileType: a.fileType,
                category: a.category ? { _id: a.category._id, name: a.category.name } : null,
                department: a.department ? { _id: a.department._id, name: a.department.name } : null,
                departmentName: a.departmentName,
                sensitivity: a.sensitivity, controlStatus: a.controlStatus, currentVersion: a.currentVersion,
                size: a.versions?.[a.versions.length - 1]?.size || 0, updatedAt: a.updatedAt,
                accessible: canView(req.user, a), canDownload: canDownload(req.user, a),
                requestPendingView: pendingSet.has(`${a._id}-view`),
                requestPendingDownload: pendingSet.has(`${a._id}-download`),
                requestPendingEdit: pendingSet.has(`${a._id}-edit`),
            };
        });
        res.json({ assets: shaped, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
    } catch (err) { console.error('[ASSETS]', err.message); res.status(500).json({ error: 'Could not fetch assets.' }); }
};

exports.uploadAsset = async (req, res) => {
    const ip = clientIp(req);
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const scan = scanFile(req.file.path, req.file.originalname);
    if (!scan.ok) {
        fs.unlink(req.file.path, () => { });
        await logAudit({ action: 'UPLOAD_BLOCKED', userId: req.user.id, ip, details: `${req.file.originalname}: ${scan.reason}`, severity: 'critical' });
        return res.status(400).json({ error: `Upload rejected: ${scan.reason}` });
    }
    try {
        const { filename, keywords, sensitivity, categoryId, departmentId, departmentName, note, assetId } = req.body;
        const enc = ingestUpload(req.file.path);
        const fType = fileTypeLabel(req.file.originalname);

        // Smart Versioning
        if (assetId) {
            const asset = await Asset.findById(assetId);
            if (!asset) { fs.unlink(enc.path, () => { }); return res.status(404).json({ error: 'Asset not found.' }); }

            const nextV = asset.currentVersion + 1;
            const versionNote = note && note.trim() ? note.trim() : `Auto-version update on ${new Date().toISOString().slice(0, 10)}`;

            asset.versions.push({ version: nextV, path: enc.path, size: enc.size, hash: enc.hash, uploadedBy: req.user.id, note: versionNote });
            asset.currentVersion = nextV;
            await asset.save();

            await logAudit({ action: 'VERSION_UPLOAD', userId: req.user.id, ip, details: `asset=${asset._id} v=${nextV} note=${versionNote}` });
            return res.status(201).json({ message: 'New version uploaded successfully.', asset });
        }

        if (!categoryId) { fs.unlink(enc.path, () => { }); return res.status(400).json({ error: 'A category is required.' }); }
        const category = await Category.findById(categoryId);
        if (!category) { fs.unlink(enc.path, () => { }); return res.status(400).json({ error: 'Selected category does not exist.' }); }
        if (req.user.role !== 'Admin' && !category.allowedRoles.includes(req.user.role)) { fs.unlink(enc.path, () => { }); return res.status(403).json({ error: 'You cannot upload into this category.' }); }

        let departmentRef = null;
        let deptName = departmentName || 'Electronics';
        if (departmentId) {
            const dept = await Department.findById(departmentId);
            if (dept) {
                departmentRef = dept._id;
                deptName = dept.name;
            }
        }

        const asset = await Asset.create({
            filename: filename || req.file.originalname,
            keywords: keywords || '',
            type: req.file.mimetype,
            fileType: fType || '',
            category: category._id,
            department: departmentRef,
            departmentName: deptName, // Fixed static bypass
            sensitivity: SENSITIVITY.includes(sensitivity) ? sensitivity : 'Internal',
            allowedRoles: category.allowedRoles,
            downloadRoles: category.downloadRoles || [],
            currentVersion: 1,
            versions: [{ version: 1, path: enc.path, size: enc.size, hash: enc.hash, uploadedBy: req.user.id, note: note || 'Initial version' }],
            uploadedBy: req.user.id,
            userViewGrants: [req.user.id],     // Explicit access grant
            userDownloadGrants: [req.user.id], // Explicit access grant
            userEditGrants: [req.user.id]      // Explicit access grant
        });

        await logAudit({ action: 'UPLOAD', userId: req.user.id, ip, details: `asset=${asset._id} file=${asset.filename} dept=${deptName}` });
        res.status(201).json({ message: 'Upload successful.', asset });
    } catch (err) { console.error('[UPLOAD]', err.message); res.status(500).json({ error: 'Upload failed.' }); }
};

exports.bulkUpload = async (req, res) => {
    const ip = clientIp(req);
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded.' });
    const { categoryId, departmentId, departmentName, sensitivity } = req.body;
    try {
        const category = await Category.findById(categoryId);
        if (!category) return res.status(400).json({ error: 'Selected category does not exist.' });
        if (req.user.role !== 'Admin' && !category.allowedRoles.includes(req.user.role)) return res.status(403).json({ error: 'You cannot upload into this category.' });

        let departmentRef = null;
        let deptName = departmentName || 'Electronics';
        if (departmentId) {
            const dept = await Department.findById(departmentId);
            if (dept && String(dept.category) === String(category._id)) {
                departmentRef = dept._id;
                deptName = dept.name;
            }
        }

        const created = []; const skipped = [];
        for (const f of req.files) {
            const scan = scanFile(f.path, f.originalname);
            if (!scan.ok) { fs.unlink(f.path, () => { }); skipped.push({ name: f.originalname, reason: scan.reason }); continue; }
            const enc = ingestUpload(f.path);
            const asset = await Asset.create({
                filename: f.originalname, type: f.mimetype, fileType: fileTypeLabel(f.originalname) || '',
                category: category._id, department: departmentRef, departmentName: deptName, sensitivity: SENSITIVITY.includes(sensitivity) ? sensitivity : 'Internal',
                allowedRoles: category.allowedRoles, downloadRoles: category.downloadRoles || [],
                currentVersion: 1, versions: [{ version: 1, path: enc.path, size: enc.size, hash: enc.hash, uploadedBy: req.user.id, note: 'Initial version' }],
                uploadedBy: req.user.id,
                userViewGrants: [req.user.id],     // Explicit access grant
                userDownloadGrants: [req.user.id], // Explicit access grant
                userEditGrants: [req.user.id]      // Explicit access grant
            });
            created.push(asset._id);
        }
        await logAudit({ action: 'BULK_UPLOAD', userId: req.user.id, ip, details: `created=${created.length} skipped=${skipped.length} category=${category.name}` });
        res.status(201).json({ message: `Uploaded ${created.length} file(s).`, created: created.length, skipped });
    } catch (err) { console.error('[BULK_UPLOAD]', err.message); res.status(500).json({ error: 'Bulk upload failed.' }); }
};
exports.updateAsset = async (req, res) => {
    const ip = clientIp(req);
    const { filename, keywords, sensitivity, departmentId, departmentName, controlStatus } = req.body || {};
    try {
        const asset = await Asset.findById(req.params.id);
        if (!asset) return res.status(404).json({ error: 'Asset not found.' });
        if (filename) asset.filename = filename;
        if (keywords !== undefined) asset.keywords = keywords;
        if (sensitivity && SENSITIVITY.includes(sensitivity)) asset.sensitivity = sensitivity;
        if (controlStatus) asset.controlStatus = controlStatus;
        if (departmentName && DEPARTMENTS.includes(departmentName)) asset.departmentName = departmentName;
        if (departmentId !== undefined) {
            if (departmentId === '' || departmentId === null) asset.department = null;
            else {
                const dept = await Department.findById(departmentId);
                if (dept && String(dept.category) === String(asset.category)) {
                    asset.department = dept._id;
                    asset.departmentName = dept.name;
                }
            }
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
        let deptRef = null; let deptName = asset.departmentName;
        if (departmentId) {
            const dept = await Department.findById(departmentId);
            if (dept && String(dept.category) === String(category._id)) {
                deptRef = dept._id;
                deptName = dept.name;
            }
        }
        if (mode === 'copy') {
            const latest = asset.versions[asset.versions.length - 1];
            const newPath = path.join(UPLOAD_DIR, `${Date.now()}_copy_${path.basename(latest.path)}`);
            fs.copyFileSync(latest.path, newPath);
            const copy = await Asset.create({
                filename: asset.filename, keywords: asset.keywords, type: asset.type, fileType: asset.fileType,
                category: category._id, department: deptRef, departmentName: deptName, sensitivity: asset.sensitivity,
                allowedRoles: category.allowedRoles, downloadRoles: category.downloadRoles || [],
                currentVersion: 1, versions: [{ version: 1, path: newPath, size: latest.size, hash: latest.hash, uploadedBy: req.user.id, note: 'Copied' }],
                uploadedBy: req.user.id,
            });
            await logAudit({ action: 'ASSET_COPIED', userId: req.user.id, ip, details: `from=${asset._id} to=${copy._id}`, severity: 'warn' });
            return res.json({ message: 'Asset copied.', asset: copy });
        }
        asset.category = category._id; asset.department = deptRef; asset.departmentName = deptName;
        asset.allowedRoles = category.allowedRoles; asset.downloadRoles = category.downloadRoles || [];
        await asset.save();
        await logAudit({ action: 'ASSET_MOVED', userId: req.user.id, ip, details: `asset=${asset._id} category=${category.name}`, severity: 'warn' });
        res.json({ message: 'Asset moved.', asset });
    } catch (err) { console.error('[ASSET_MOVE]', err.message); res.status(500).json({ error: 'Could not move/copy asset.' }); }
};

exports.deleteAsset = async (req, res) => {
    // Hard delete is restricted entirely; soft deletion is handled via approval queue
    return res.status(403).json({ error: 'Direct hard deletion is disabled. Please raise a deletion request for department head approval.' });
};

exports.grantAccess = async (req, res) => {
    const ip = clientIp(req);
    const { targetId, userId, kind, revoke } = req.body || {};
    const finalUserId = targetId || userId;
    try {
        const asset = await Asset.findById(req.params.id);
        if (!asset) return res.status(404).json({ error: 'Asset not found.' });
        const target = await User.findById(userId);
        if (!target) return res.status(404).json({ error: 'User not found.' });

        const listName = kind === 'download' ? 'userDownloadGrants' : 'userViewGrants';
        const has = userGranted(asset[listName], userId);

        if (revoke) {
            asset[listName] = asset[listName].filter((id) => String(id) !== String(userId));
            // Update access logs history entry with duration and revocation timestamp
            const logEntry = asset.accessLogs.find(l => String(l.user) === String(userId) && l.kind === kind && !l.revokedAt);
            if (logEntry) {
                logEntry.revokedAt = new Date();
                const diffMs = logEntry.revokedAt - new Date(logEntry.grantedAt);
                const diffHrs = (diffMs / (1000 * 60 * 60)).toFixed(1);
                logEntry.durationString = `${diffHrs} hours`;
            }
        } else if (!has) {
            asset[listName].push(userId);
            if (kind === 'download' && !userGranted(asset.userViewGrants, userId)) asset.userViewGrants.push(userId);

            // Push new tracked grant window into accessLogs
            asset.accessLogs.push({
                user: userId,
                kind: kind || 'view',
                grantedBy: req.user.id,
                grantedAt: new Date(),
                durationString: 'Active',
            });
        }

        await asset.save();
        await logAudit({ action: revoke ? 'GRANT_REVOKED' : 'GRANT_ADDED', userId: req.user.id, ip, details: `asset=${asset._id} user=${target.email} kind=${kind || 'view'}`, severity: 'warn' });
        if (!revoke) await notify(userId, `You were granted ${kind || 'view'} access to "${asset.filename}".`, '/');
        res.json({ message: revoke ? 'Grant revoked and duration logged.' : 'Grant added with tracking.' });
    } catch (err) { console.error('[GRANT]', err.message); res.status(500).json({ error: 'Could not update grant.' }); }
};

exports.getGrants = async (req, res) => {
    try {
        const asset = await Asset.findById(req.params.id)
            .populate('userViewGrants', 'name email role')
            .populate('userDownloadGrants', 'name email role')
            .populate('accessLogs.user', 'name email role')
            .lean();

        if (!asset) return res.status(404).json({ error: 'Asset not found.' });

        const formattedLogs = (asset.accessLogs || []).map(l => ({
            targetName: l.user?.name || 'Unknown User',
            email: l.user?.email || '',
            kind: l.kind,
            grantedAt: l.grantedAt,
            revokedAt: l.revokedAt,
            durationString: l.durationString,
            viewsCount: l.viewsCount,
            editsCount: l.editsCount,
            downloadsCount: l.downloadsCount,
        }));

        res.json({
            viewGrants: asset.userViewGrants || [],
            downloadGrants: asset.userDownloadGrants || [],
            accessLogs: formattedLogs
        });
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
        const asset = await Asset.findById(req.params.id).populate('department', 'allowedRoles downloadRoles');
        if (!asset || asset.deletedAt) return res.status(404).json({ error: 'Asset not found.' });

        const assetObj = asset.toObject();
        assetObj._deptAllowedRoles = asset.department?.allowedRoles;
        assetObj._deptDownloadRoles = asset.department?.downloadRoles;

        if (!canView(req.user, assetObj)) {
            await logAudit({ action: 'VIEW_DENIED', userId: req.user.id, ip, details: `asset=${asset._id}`, severity: 'critical' });
            return res.status(403).json({ error: 'Forbidden: not authorized to view this asset.' });
        }

        // Track view metrics in active grant log
        const activeLog = asset.accessLogs.find(l => String(l.user) === String(req.user.id) && !l.revokedAt);
        if (activeLog) {
            activeLog.viewsCount += 1;
            await asset.save();
        }

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
            canDownload: canDownload(req.user, assetObj),
            asset: { id: asset._id, filename: asset.filename, type: asset.type, fileType: asset.fileType, sensitivity: asset.sensitivity, version: asset.currentVersion, hash: latest?.hash || '' },
        });
    } catch (err) { console.error('[VIEW]', err.message); res.status(500).json({ error: 'Could not open secure view.' }); }
};

exports.rawAsset = async (req, res) => {
    const ip = clientIp(req);
    try {
        const asset = await Asset.findById(req.params.id).populate('department', 'allowedRoles downloadRoles');
        if (!asset || asset.deletedAt) return res.status(404).json({ error: 'Asset not found.' });

        const assetObj = asset.toObject();
        assetObj._deptAllowedRoles = asset.department?.allowedRoles;
        assetObj._deptDownloadRoles = asset.department?.downloadRoles;

        if (!canView(req.user, assetObj)) {
            await logAudit({ action: 'VIEW_DENIED', userId: req.user.id, ip, details: `asset=${asset._id} (raw)`, severity: 'critical' });
            return res.status(403).json({ error: 'Forbidden.' });
        }

        const latest = asset.versions[asset.versions.length - 1];
        if (!latest || !fs.existsSync(latest.path)) return res.status(404).json({ error: 'File data not found.' });

        const wantsDownload = req.query.download === '1' || req.query.download === 'true';
        const ext = extOf(asset.filename);
        const wmText = `${req.user.email}  ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;

        let plain;
        try { plain = readEncrypted(latest.path); }
        catch { await logAudit({ action: 'DECRYPT_FAILED', userId: req.user.id, ip, details: `asset=${asset._id}`, severity: 'critical' }); return res.status(500).json({ error: 'File could not be decrypted.' }); }

        if (wantsDownload) {
            if (!canDownload(req.user, assetObj)) {
                await logAudit({ action: 'DOWNLOAD_DENIED', userId: req.user.id, ip, details: `asset=${asset._id}`, severity: 'critical' });
                return res.status(403).json({ error: 'Your role is not permitted to download this file.' });
            }

            // Track download metrics
            const activeLog = asset.accessLogs.find(l => String(l.user) === String(req.user.id) && !l.revokedAt);
            if (activeLog) {
                activeLog.downloadsCount += 1;
                await asset.save();
            }

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
                return res.status(422).json({ error: 'Document conversion failed.' });
            }
        }
        return res.status(415).json({ error: 'Unsupported preview type.' });
    } catch (err) { console.error('[RAW]', err.message); if (!res.headersSent) res.status(500).json({ error: 'Could not stream file.' }); }
};

exports.uploadNewVersion = async (req, res) => {
    const ip = clientIp(req);
    try {
        const asset = await Asset.findById(req.params.id);
        if (!asset) return res.status(404).json({ error: 'Asset not found.' });

        // Authorization: Must be Admin, Owner, or explicitly granted Edit access
        const isGranted = asset.userEditGrants?.includes(req.user.id);
        const isOwner = String(asset.uploadedBy) === String(req.user.id);
        const isAdmin = req.user.role === 'Admin';

        if (!isGranted && !isOwner && !isAdmin) {
            return res.status(403).json({ error: 'You do not have edit authorization for this document.' });
        }

        if (!req.file) return res.status(400).json({ error: 'No new file provided.' });

        // 1. Archive the current file into the history array
        const archivedVersion = {
            filename: asset.filename,
            filepath: asset.filepath,
            size: asset.size,
            mimetype: asset.mimetype,
            versionNote: asset.versionNote || 'Previous version',
            uploadedBy: asset.uploadedBy,
            uploadedAt: asset.updatedAt || asset.createdAt
        };

        // Initialize history array if it doesn't exist
        if (!asset.history) asset.history = [];
        asset.history.push(archivedVersion);

        // 2. Update the main asset with the new file
        asset.filename = req.body.filename || req.file.originalname;
        asset.filepath = req.file.path;
        asset.size = req.file.size;
        asset.mimetype = req.file.mimetype;
        asset.versionNote = req.body.versionNote || 'Updated version';
        asset.uploadedBy = req.user.id; // The person who uploaded v2

        // Ensure the uploader retains view/download/edit rights on their new version
        if (!asset.userViewGrants.includes(req.user.id)) asset.userViewGrants.push(req.user.id);
        if (!asset.userDownloadGrants.includes(req.user.id)) asset.userDownloadGrants.push(req.user.id);
        if (!asset.userEditGrants?.includes(req.user.id)) {
            if (!asset.userEditGrants) asset.userEditGrants = [];
            asset.userEditGrants.push(req.user.id);
        }

        await asset.save();

        // 3. WORM Audit Log
        await logAudit({
            action: 'VERSION_UPDATED',
            userId: req.user.id,
            ip,
            details: `asset=${asset._id} new_file="${asset.filename}"`,
            severity: 'info'
        });

        res.json({ message: 'New version securely checked in.', asset });
    } catch (err) {
        console.error('[UPLOAD_VERSION]', err.message);
        res.status(500).json({ error: 'Could not upload new version.' });
    }
};


exports.getAssetTraceability = async (req, res) => {
    try {
        const Asset = require('../models/Asset');
        const AuditLog = require('../models/AuditLog');

        const asset = await Asset.findById(req.params.id)
            .populate('uploadedBy', 'name email role')
            .populate('history.uploadedBy', 'name email role');

        if (!asset) return res.status(404).json({ error: 'Asset not found.' });

        if (req.user.role !== 'Admin' && req.user.role !== 'Management' && String(asset.uploadedBy?._id || asset.uploadedBy) !== String(req.user.id || req.user._id)) {
            return res.status(403).json({ error: 'Not authorized to view traceability logs.' });
        }

        // FIXED: Using 'userId' to match your AuditLog schema instead of 'actor'
        const logs = await AuditLog.find({
            $or: [
                { asset: asset._id },
                { details: { $regex: String(asset._id) } }
            ]
        })
            .populate('userId', 'name email role')
            .sort({ createdAt: -1 });

        res.json({
            asset: {
                _id: asset._id,
                filename: asset.filename,
                versionNote: asset.versionNote,
                uploadedBy: asset.uploadedBy,
                updatedAt: asset.updatedAt,
                history: asset.history || []
            },
            logs
        });
    } catch (err) {
        console.error('[TRACEABILITY]', err.message);
        res.status(500).json({ error: 'Failed to fetch traceability data.' });
    }
};