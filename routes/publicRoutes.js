const express = require("express");

const asyncHandler = require("../services/asyncHandler");

const homeController = require("../controllers/homeController");

const f1Controller = require("../controllers/f1Controller");

const lmuController = require("../controllers/lmuController");

const competitionController = require("../controllers/competitionController");

const iconsController = require("../controllers/iconsController");

const f1ContentController = require("../controllers/f1ContentController");


const router = express.Router();
router.get('/anleitungen', asyncHandler(require('../controllers/guideController').index));
router.get('/anleitungen/:slug', asyncHandler(require('../controllers/guideController').show));
router.get('/ligen/:slug', asyncHandler(async (req, res) => {
 const league = await require('../models').League.findOne({where:{slug:req.params.slug}});
 if (!league) return res.status(404).render('errors/404',{title:'Liga nicht gefunden'});
 if(league.type === 'f1') return f1Controller.show(req,res);
 if(league.type === 'lmu') return lmuController.show(req,res);
 if(league.type === 'competition') return competitionController.show(req,res);
 return res.render('league-generic',{title:league.name,league});
}));
router.get("/krl-statistik", asyncHandler(require("../controllers/statisticsController").show));


router.get(
  "/",
  asyncHandler(homeController.index),
);


/*
 * =====================================================
 * F1
 * =====================================================
 */

router.get(
  "/f1/:slug/download/fahrer-wm.csv",
  asyncHandler(f1Controller.downloadDriverStandings),
);

router.get(
  "/f1/:slug/download/team-wm.csv",
  asyncHandler(f1Controller.downloadTeamStandings),
);

router.get(
  "/f1/:slug/download/gp-results.csv",
  asyncHandler(f1Controller.downloadGpResults),
);

router.get(
  "/f1/:slug",
  asyncHandler(f1Controller.show),
);


/*
 * Öffentliche Strafkartei
 */
router.get(
  "/formel-1/strafkartei",
  asyncHandler(f1Controller.publicPenaltyLedger),
);


/*
 * =====================================================
 * LMU
 * =====================================================
 */

router.get(
  "/lmu/download/wm.csv",
  asyncHandler(lmuController.downloadStandings),
);

router.get(
  "/lmu/download/results.csv",
  asyncHandler(lmuController.downloadResults),
);

router.get(
  "/lmu",
  asyncHandler(lmuController.show),
);


/*
 * =====================================================
 * WETTKAMPF
 * =====================================================
 */

router.get(
  "/wettkampf-der-ligen/download/standings.csv",
  asyncHandler(competitionController.downloadStandings),
);

router.get(
  "/wettkampf-der-ligen/download/results.csv",
  asyncHandler(competitionController.downloadResults),
);

router.get(
  "/wettkampf-der-ligen",
  asyncHandler(competitionController.show),
);


/*
 * =====================================================
 * SONSTIGES
 * =====================================================
 */

router.get(
  "/krl-icons",
  asyncHandler(iconsController.show),
);

router.get(
  "/formel-1/regelwerk",
  asyncHandler(f1ContentController.rules),
);

router.get(
  "/formel-1/race-director-notes",
  asyncHandler(f1ContentController.documents),
);

router.get(
  "/endurance",
  homeController.endurance,
);

router.get(
  ["/impressum", "/datenschutz", "/kontakt"],
  homeController.legal,
);


module.exports = router;