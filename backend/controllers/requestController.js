const AccessRequest = require('../models/AccessRequest');
const Asset = require('../models/Asset');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { logAudit, clientIp } = require('../utils/logger');
const { canView, canDownload } = require('../utils/accessUtils');
const { notify } = require('../utils/notify');
const { REQUEST_KINDS } = require('../constants');

exports.createRequest = async (req, res) => {
    const ip = clientIp(req);
    const { assetId, reason, kind } = req.body || {};

    if (!REQUEST_KINDS.includes(kind)) {
        return res.status(400).json({ error: 'Invalid request action type.' });
    }

    try {
        const asset = await Asset.findById(assetId).populate('department');
        if (!asset) return res.status(404).json({ error: 'Asset not found.' });

        // Specific Rule: Only the owner (uploader) can request a delete
        if (kind === 'delete') {
            if (String(asset.uploadedBy) !== String(req.user.id) && req.user.role !== 'Admin') {
                return res.status(403).json({ error: 'Only the document owner or an Admin can request a deletion.' });
            }
        }

        const assetObj = asset.toObject();
        assetObj._deptAllowedRoles = asset.department?.allowedRoles;

        // Check if user already has the requested permission
        if (kind === 'view' && canView(req.user, assetObj)) return res.status(400).json({ error: 'You already have view access.' });
        if (kind === 'download' && canDownload(req.user, assetObj)) return res.status(400).json({ error: 'You already have download access.' });

        // Prevent duplicate pending requests for the same action on the same asset
        if (await AccessRequest.findOne({ asset: assetId, requestedBy: req.user.id, kind, status: 'Pending' })) {
            return res.status(409).json({ error: 'A pending request for this action already exists.' });
        }

        // Determine target department from the asset's department or category context
        const targetDept = asset.department?.name || 'Electronics';

        const reqDoc = await AccessRequest.create({
            asset: assetId,
            requestedBy: req.user.id,
            targetDepartment: targetDept,
            reason: reason || '',
            kind
        });

        await logAudit({ action: 'ACCESS_REQUESTED', userId: req.user.id, ip, details: `asset=${assetId} kind=${kind}`, severity: 'warn' });

        // Targeted Routing: Notify Admins AND the specific Department Heads managing targetDept
        const approvers = await User.find({
            $or: [
                { role: 'Admin', active: true },
                { role: 'Management', headOfDepartments: targetDept, active: true }
            ]
        }).select('_id').lean();

        const approverIds = [...new Set(approvers.map(a => String(a._id)))];
        for (const approverId of approverIds) {
            await notify(
                approverId,
                `Pending Request: ${req.user.name} requested [${kind.toUpperCase()}] access for the file "${asset.filename}".`,
                '/access-requests'
            );

        }
        res.status(201).json({ message: 'Request submitted to department head.', request: reqDoc });
    } catch (err) {
        console.error('[ACCESS_REQ]', err.message);
        res.status(500).json({ error: 'Could not submit request.' });
    }
};

exports.getRequests = async (req, res) => {
    try {
        let filter = {};
        if (req.user.role === 'Admin') {
            filter = {};
        } else if (req.user.role === 'Management') {
            // Department heads see requests targeted to their managed departments OR requested by themselves
            const userDoc = await User.findById(req.user.id).select('headOfDepartments').lean();
            const managed = userDoc?.headOfDepartments || [];
            filter = { $or: [{ targetDepartment: { $in: managed } }, { requestedBy: req.user.id }] };
        } else {
            // Regular team members only see their own requests
            filter = { requestedBy: req.user.id };
        }

        const reqs = await AccessRequest.find(filter)
            .sort({ createdAt: -1 })
            .populate('asset', 'filename sensitivity deletedAt')
            .populate('requestedBy', 'name email role department')
            .lean();

        res.json({ requests: reqs });
    } catch (err) {
        console.error('[GET_REQUESTS]', err.message);
        res.status(500).json({ error: 'Could not load requests.' });
    }
};

exports.decideRequest = async (req, res) => {
    const ip = clientIp(req);
    const { decision } = req.body || {};

    if (!['Approved', 'Denied'].includes(decision)) {
        return res.status(400).json({ error: 'Decision must be Approved or Denied.' });
    }

    try {
        const reqDoc = await AccessRequest.findById(req.params.id).populate('requestedBy', 'role email').populate('asset');
        if (!reqDoc) return res.status(404).json({ error: 'Request not found.' });
        if (reqDoc.status !== 'Pending') return res.status(409).json({ error: 'Request already decided.' });

        // Authorization check for decider: Must be Admin OR Head of the request's targetDepartment
        if (req.user.role !== 'Admin') {
            const decider = await User.findById(req.user.id).select('role headOfDepartments').lean();
            const managed = decider?.headOfDepartments || [];
            if (decider?.role !== 'Management' || !managed.includes(reqDoc.targetDepartment)) {
                return res.status(403).json({ error: 'Only Admins or the Head of this department can approve this request.' });
            }
        }

        reqDoc.status = decision;
        reqDoc.decidedBy = req.user.id;
        reqDoc.decidedAt = new Date();
        await reqDoc.save();

        if (decision === 'Approved') {
            const asset = await Asset.findById(reqDoc.asset._id);
            if (asset) {
                const targetUserId = reqDoc.requestedBy._id;
                const kind = reqDoc.kind; // 'view', 'download', 'edit'

                const listName = (kind === 'download') ? 'userDownloadGrants' : 'userViewGrants';

                if (!asset[listName].includes(targetUserId)) {
                    asset[listName].push(targetUserId);
                }

                // If download is granted, ensure view is also granted
                if (kind === 'download' && !asset.userViewGrants.includes(targetUserId)) {
                    asset.userViewGrants.push(targetUserId);
                }

                // Push tracking entry into accessLogs
                asset.accessLogs.push({
                    user: targetUserId,
                    kind: kind,
                    grantedBy: req.user.id,
                    grantedAt: new Date(),
                    durationString: 'Active'
                });

                if (kind === 'delete') {
                    asset.deletedAt = new Date();
                    asset.deletedBy = req.user.id;
                }

                await asset.save();
            }
        }

        await logAudit({
            action: `REQUEST_${decision.toUpperCase()}_${reqDoc.kind.toUpperCase()}`,
            userId: req.user.id,
            ip,
            details: `request=${reqDoc._id} asset=${reqDoc.asset._id}`,
            severity: decision === 'Approved' ? 'info' : 'warn'
        });
        const targetRoute = decision === 'Approved' ? `/repository/${reqDoc.asset.category}` : '#';

        await notify(
            reqDoc.requestedBy._id,
            `${decision}: Your [${reqDoc.kind.toUpperCase()}] request for "${reqDoc.asset.filename}" has been ${decision.toLowerCase()}.`,
            targetRoute // Routes directly to the specific repository
        );

        res.json({ message: `Request ${decision.toLowerCase()}.`, request: reqDoc });
    } catch (err) {
        console.error('[DECIDE]', err.message);
        res.status(500).json({ error: 'Could not decide request.' });
    }
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