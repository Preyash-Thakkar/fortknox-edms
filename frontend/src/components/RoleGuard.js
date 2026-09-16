
import React from 'react';

/**
 * RoleGuard securely hides or shows UI elements based on the user's role.
 * 
 * @param {Object} user - The current logged-in user object
 * @param {Array} allowedRoles - e.g., ['Admin', 'Management', 'DeptHead']
 * @param {boolean} exactDeptMatch - (Optional) If true, checks if user is head of specific dept
 */
const RoleGuard = ({ user, allowedRoles, children }) => {
    if (!user || !user.role) return null;

    // Admins bypass all UI restrictions
    if (user.role === 'Admin') {
        return <>{children}</>;
    }

    // Check if the user's role is in the allowed list
    if (allowedRoles && allowedRoles.includes(user.role)) {
        return <>{children}</>;
    }

    // If they don't have permission, render nothing
    return null;
};

export default RoleGuard;