const express = require('express');
const rateLimit = require('express-rate-limit');
const asyncHandler = require('../services/asyncHandler');
const authController = require('../controllers/authController');
const { redirectIfAuthenticated } = require('../middleware/auth');

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

router.get('/login', redirectIfAuthenticated, authController.loginForm);
router.post('/login', loginLimiter, redirectIfAuthenticated, asyncHandler(authController.login));
router.post('/logout', authController.logout);

module.exports = router;
