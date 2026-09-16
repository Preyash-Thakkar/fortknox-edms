const ROLES = Object.freeze(['Admin', 'Engineering', 'Legal', 'Management']);

const DEPARTMENTS = Object.freeze([
    'Electronics',
    'Product design',
    'Hr',
    'Accounts',
    'UI/UX',
    'Web Applications',
    'Mobile Applications'
]);

const SENSITIVITY = Object.freeze(['Public', 'Internal', 'Confidential', 'Strictly Confidential']);

const REQUEST_KINDS = Object.freeze(['view', 'download', 'edit', 'delete']);

const CONTROL_STATUS = Object.freeze(['Draft', 'InReview', 'Approved', 'Obsolete']);

module.exports = {
    ROLES,
    DEPARTMENTS,
    SENSITIVITY,
    REQUEST_KINDS,
    CONTROL_STATUS,
};