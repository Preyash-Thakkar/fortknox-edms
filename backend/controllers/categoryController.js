const Category = require('../models/Category');
const Department = require('../models/Department');
const Asset = require('../models/Asset');
const { logAudit, clientIp } = require('../utils/logger');

const ROLES = ['Admin', 'Engineering', 'Legal', 'Management'];

// 1. GET CATEGORIES (Updated to filter out soft-deleted/archived repositories)
exports.getCategories = async (req, res) => {
    try {
        const categories = await Category.find({ active: { $ne: false } }).sort({ name: 1 }).lean();
        const departments = await Department.find({ active: { $ne: false } }).sort({ name: 1 }).lean();
        const shaped = categories.map((c) => ({
            _id: c._id, name: c.name, allowedRoles: c.allowedRoles, downloadRoles: c.downloadRoles || [],
            accessible: req.user.role === 'Admin' || (c.allowedRoles || []).includes(req.user.role),
            departments: departments.filter((d) => String(d.category) === String(c._id)).map((d) => ({ _id: d._id, name: d.name, allowedRoles: d.allowedRoles || [], downloadRoles: d.downloadRoles || [] })),
        }));
        res.json({ categories: shaped });
    } catch (err) { console.error('[CATEGORIES]', err.message); res.status(500).json({ error: 'Could not load categories.' }); }
};

// 2. LEGACY CREATE (Preserved safely)
exports.createCategory = async (req, res) => {
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
};

// 3. LEGACY UPDATE (Preserved safely)
exports.updateCategory = async (req, res) => {
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
};

// 4. LEGACY DELETE (Preserved safely)
exports.deleteCategory = async (req, res) => {
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
};

// 5. NEW DYNAMIC REPOSITORY CREATION
exports.createRepository = async (req, res) => {
    const ip = clientIp(req);
    try {
        const { name } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: 'Repository name is required.' });

        if (await Category.findOne({ name: name.trim() })) {
            return res.status(409).json({ error: 'A repository with this name already exists.' });
        }

        const category = await Category.create({
            name: name.trim(),
            allowedRoles: ['Admin', 'Management', 'Engineering'],
            downloadRoles: ['Admin'],
            createdBy: req.user.id || req.user._id,
            active: true
        });

        await Department.create({
            name: name.trim(),
            category: category._id,
            allowedRoles: ['Admin', 'Management', 'Engineering'],
            downloadRoles: ['Admin'],
            createdBy: req.user.id || req.user._id,
            active: true
        });

        // WORM AUDIT LOGGING: Who, When, What using your utility
        await logAudit({
            action: 'REPO_CREATED',
            userId: req.user.id || req.user._id,
            ip,
            details: `name=${category.name} (Dynamic Repository mapping)`,
            severity: 'warn'
        });

        res.status(201).json({ message: 'Repository created securely.', category });
    } catch (error) {
        console.error('[REPO_CREATE]', error.message);
        res.status(500).json({ error: 'Failed to create repository.' });
    }
};

// 6. NEW DYNAMIC REPOSITORY ARCHIVE
exports.deleteRepository = async (req, res) => {
    const ip = clientIp(req);
    try {
        // Soft Delete: Hide from sidebar and menus
        const category = await Category.findByIdAndUpdate(req.params.id, { active: false });
        if (!category) return res.status(404).json({ error: 'Repository not found.' });

        await Department.updateMany({ category: req.params.id }, { active: false });

        // WORM AUDIT LOGGING: Who, When, What using your utility
        await logAudit({
            action: 'REPO_ARCHIVED',
            userId: req.user.id || req.user._id,
            ip,
            details: `name=${category.name} (Archived dynamically)`,
            severity: 'critical'
        });

        res.json({ message: 'Repository archived successfully.' });
    } catch (error) {
        console.error('[REPO_ARCHIVE]', error.message);
        res.status(500).json({ error: 'Failed to archive repository.' });
    }
};