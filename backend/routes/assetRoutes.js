const express = require('express');
const multer = require('multer');
const { authenticate, authorize } = require('../middlewares/authMiddleware');
const assetController = require('../controllers/assetController');
const { TEMP_DIR, ALL_EXTS, extOf } = require('../utils/fileUtils');

const router = express.Router();

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, TEMP_DIR),
    filename: (req, file, cb) => {
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}_${Math.round(Math.random() * 1e6)}_${safe}`);
    },
});

const upload = multer({
    storage, limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const e = extOf(file.originalname);
        if (!ALL_EXTS.includes(e)) return cb(new Error(`File type ".${e}" is not allowed.`));
        cb(null, true);
    },
});

router.get('/stats', authenticate, assetController.getStats);
router.get('/assets', authenticate, assetController.getAssets);
router.post('/assets/upload', authenticate, authorize('Engineering', 'Legal', 'Management'), upload.single('file'), assetController.uploadAsset);
router.post('/assets/bulk-upload', authenticate, authorize('Engineering', 'Legal', 'Management'), upload.array('files', 20), assetController.bulkUpload);
router.patch('/assets/:id', authenticate, authorize('Admin'), assetController.updateAsset);
router.post('/assets/:id/move', authenticate, authorize('Admin'), assetController.moveAsset);
router.delete('/assets/:id', authenticate, authorize('Admin'), assetController.deleteAsset);
router.post('/assets/:id/grant', authenticate, authorize('Admin'), assetController.grantAccess);
router.get('/assets/:id/grants', authenticate, authorize('Admin'), assetController.getGrants);
router.get('/assets/:id/versions', authenticate, assetController.getVersions);
router.get('/assets/:id/view', authenticate, assetController.viewAsset);
router.get('/assets/:id/raw', authenticate, assetController.rawAsset);
router.get('/stats', authenticate, assetController.getStats);
router.post('/assets/:id/versions', authenticate, upload.single('file'), assetController.uploadNewVersion);
router.get('/assets/:id/traceability', authenticate, assetController.getAssetTraceability);

module.exports = router;