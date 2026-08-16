const express = require('express');
const asyncHandler = require('../services/asyncHandler');
const homeController = require('../controllers/homeController');
const f1Controller = require('../controllers/f1Controller');
const lmuController = require('../controllers/lmuController');
const competitionController = require('../controllers/competitionController');
const iconsController = require('../controllers/iconsController');

const router = express.Router();
router.get('/', asyncHandler(homeController.index));
router.get('/f1/:slug(freitag|samstag|sonntag)/download/fahrer-wm.csv', asyncHandler(f1Controller.downloadDriverStandings));
router.get('/f1/:slug(freitag|samstag|sonntag)/download/team-wm.csv', asyncHandler(f1Controller.downloadTeamStandings));
router.get('/f1/:slug(freitag|samstag|sonntag)/download/gp-results.csv', asyncHandler(f1Controller.downloadGpResults));
router.get('/f1/:slug(freitag|samstag|sonntag)', asyncHandler(f1Controller.show));
router.get('/lmu/download/wm.csv', asyncHandler(lmuController.downloadStandings));
router.get('/lmu/download/results.csv', asyncHandler(lmuController.downloadResults));
router.get('/lmu', asyncHandler(lmuController.show));
router.get('/wettkampf-der-ligen/download/standings.csv', asyncHandler(competitionController.downloadStandings));
router.get('/wettkampf-der-ligen/download/results.csv', asyncHandler(competitionController.downloadResults));
router.get('/wettkampf-der-ligen', asyncHandler(competitionController.show));
router.get('/krl-icons', asyncHandler(iconsController.show));
router.get('/endurance', homeController.endurance);
router.get(['/impressum', '/datenschutz', '/kontakt'], homeController.legal);

module.exports = router;
