const Category = require('../models/Category');
const Department = require('../models/Department');
const Asset = require('../models/Asset');
const { logAudit, clientIp } = require('../utils/logger');

const ROLES = ['Admin', 'Engineering', 'Legal', 'Management'];

exports.getCategories = async (req, res) => {
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
};

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