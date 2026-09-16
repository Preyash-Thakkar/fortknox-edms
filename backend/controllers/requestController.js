const AccessRequest = require('../models/AccessRequest');
const Asset = require('../models/Asset');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { logAudit, clientIp } = require('../utils/logger');
const { canView, canDownload } = require('../utils/accessUtils');
const { notify } = require('../utils/notify');

exports.createRequest = async (req, res) => {
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
};

exports.getRequests = async (req, res) => {
    try {
        const filter = req.user.role === 'Admin' ? {} : { requestedBy: req.user.id };
        const reqs = await AccessRequest.find(filter).sort({ createdAt: -1 }).populate('asset', 'filename sensitivity').populate('requestedBy', 'name email role').lean();
        res.json({ requests: reqs });
    } catch { res.status(500).json({ error: 'Could not load requests.' }); }
};

exports.decideRequest = async (req, res) => {
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
                const { userGranted } = require('../utils/accessUtils');
                if (!userGranted(asset.userViewGrants, reqDoc.requestedBy._id)) asset.userViewGrants.push(reqDoc.requestedBy._id);
                if (reqDoc.kind === 'download' && !userGranted(asset.userDownloadGrants, reqDoc.requestedBy._id)) asset.userDownloadGrants.push(reqDoc.requestedBy._id);
                await asset.save();
            }
        }
        await logAudit({ action: `ACCESS_${decision.toUpperCase()}`, userId: req.user.id, ip, details: `request=${reqDoc._id}`, severity: decision === 'Approved' ? 'info' : 'warn' });
        await notify(reqDoc.requestedBy._id, `Your access request for "${reqDoc.asset.filename}" was ${decision.toLowerCase()}.`, '/');
        res.json({ message: `Request ${decision.toLowerCase()}.`, request: reqDoc });
    } catch (err) { console.error('[DECIDE]', err.message); res.status(500).json({ error: 'Could not decide request.' }); }
};

exports.getNotifications = async (req, res) => {
    try {
        const items = await Notification.find({ user: req.user.id }).sort({ createdAt: -1 }).limit(50).lean();
        const unread = await Notification.countDocuments({ user: req.user.id, read: false });
        res.json({ notifications: items, unread });
    } catch { res.status(500).json({ error: 'Could not load notifications.' }); }
};

exports.markNotificationsRead = async (req, res) => {
    try { await Notification.updateMany({ user: req.user.id, read: false }, { read: true }); res.json({ message: 'Marked read.' }); }
    catch { res.status(500).json({ error: 'Could not update notifications.' }); }
};