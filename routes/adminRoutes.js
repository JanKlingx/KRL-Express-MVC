const express = require('express');
const asyncHandler = require('../services/asyncHandler');
const adminController = require('../controllers/adminController');
const { requireAdmin } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();
router.use(requireAdmin);
router.get('/', asyncHandler(adminController.dashboard));
router.get('/:resource', asyncHandler(adminController.list));
router.get('/:resource/new', adminController.createForm);
router.post('/:resource', upload.single('image'), asyncHandler(adminController.create));
router.get('/:resource/:id/edit', asyncHandler(adminController.editForm));
router.put('/:resource/:id', upload.single('image'), asyncHandler(adminController.update));
router.delete('/:resource/:id', asyncHandler(adminController.remove));

module.exports = router;
