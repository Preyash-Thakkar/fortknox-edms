function userGranted(list, userId) {
    return (list || []).some((id) => String(id) === String(userId));
}

function canView(user, asset) {
    // 1. System Admins get universal access
    if (user.role === 'Admin') return true;

    // 2. The specific Department Head for this asset gets automatic access
    if (user.role === 'Management' && user.headOfDepartments?.includes(asset.departmentName)) {
        return true;
    }

    // 3. Explicit individual grant check (if they requested and were approved)
    const uid = String(user.id || user._id);
    const viewGrants = (asset.userViewGrants || []).map(id => String(id));
    if (viewGrants.includes(uid)) return true;

    // DEFAULT DENY: Everyone else (including Team Members) is locked out and must request access
    return false;
}

function canDownload(user, asset) {
    // 1. System Admins get universal access
    if (user.role === 'Admin') return true;

    // 2. The specific Department Head for this asset gets automatic access
    if (user.role === 'Management' && user.headOfDepartments?.includes(asset.departmentName)) {
        return true;
    }

    // 3. Explicit individual grant check
    const uid = String(user.id || user._id);
    const downloadGrants = (asset.userDownloadGrants || []).map(id => String(id));
    if (downloadGrants.includes(uid)) return true;

    // DEFAULT DENY
    return false;
}

module.exports = { canView, canDownload, userGranted };