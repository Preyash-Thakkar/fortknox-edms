function userGranted(list, userId) {
    return (list || []).some((id) => String(id) === String(userId));
}

function canView(user, asset) {
    if (user.role === 'Admin') return true;
    if (user.role === 'Management' && user.headOfDepartments?.includes(asset.departmentName)) return true;

    const uid = String(user.id || user._id);

    const uploaderId = String(asset.uploadedBy?._id || asset.uploadedBy);
    if (uploaderId === uid) return true;

    const viewGrants = (asset.userViewGrants || []).map(id => String(id));
    if (viewGrants.includes(uid)) return true;

    return false;
}

function canDownload(user, asset) {
    if (user.role === 'Admin') return true;
    if (user.role === 'Management' && user.headOfDepartments?.includes(asset.departmentName)) return true;

    const uid = String(user.id || user._id);

    const uploaderId = String(asset.uploadedBy?._id || asset.uploadedBy);
    if (uploaderId === uid) return true;

    const downloadGrants = (asset.userDownloadGrants || []).map(id => String(id));
    if (downloadGrants.includes(uid)) return true;

    return false;
}

module.exports = { canView, canDownload, userGranted };