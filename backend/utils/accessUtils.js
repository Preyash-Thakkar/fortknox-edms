function userGranted(list, userId) {
    return (list || []).some((id) => String(id) === String(userId));
}

function roleViewOk(user, asset) {
    if (user.role === 'Admin') return true;
    const catOk = (asset.allowedRoles || []).includes(user.role);
    const deptRoles = asset._deptAllowedRoles;
    const deptOk = !deptRoles || deptRoles.length === 0 || deptRoles.includes(user.role);
    return catOk && deptOk;
}

function canView(user, asset) {
    return user.role === 'Admin' || roleViewOk(user, asset) || userGranted(asset.userViewGrants, user.id);
}

function canDownload(user, asset) {
    if (user.role === 'Admin') return true;
    const roleDl = (asset.downloadRoles || []).includes(user.role);
    const deptDl = asset._deptDownloadRoles;
    const deptDlOk = !deptDl || deptDl.length === 0 || deptDl.includes(user.role);
    const roleOk = roleViewOk(user, asset) && roleDl && deptDlOk;
    return roleOk || userGranted(asset.userDownloadGrants, user.id);
}

module.exports = { canView, canDownload, userGranted };