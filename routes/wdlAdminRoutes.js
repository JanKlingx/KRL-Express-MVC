const express = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../services/asyncHandler');
const authController = require('../controllers/authController');
const adminController = require('../controllers/adminController');
const { requireWdl, redirectIfAuthenticated } = require('../middleware/auth');

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

router.get('/login', redirectIfAuthenticated, authController.wdlLoginForm);
router.post('/login', loginLimiter, redirectIfAuthenticated, asyncHandler(authController.wdlLogin));
router.post('/logout', authController.wdlLogout);

router.use(requireWdl);
router.get('/', asyncHandler(adminController.dashboard));
router.get('/:resource', asyncHandler(adminController.list));
router.get('/:resource/new', asyncHandler(adminController.createForm));
router.post('/:resource', asyncHandler(adminController.create));
router.get('/:resource/:id/edit', asyncHandler(adminController.editForm));
router.put('/:resource/:id', asyncHandler(adminController.update));
router.delete('/:resource/:id', asyncHandler(adminController.remove));

module.exports = router;
