const { Op } = require('sequelize');

const {
  sequelize,
  League,
  Season,
  PointsScheme,
  RaceEvent,
  GrandPrixResult,
  F1Game
} = require('../models');

const {
  activateSeason
} = require('../services/championship');


const disciplineFor = (league) =>
  league.type === 'competition'
    ? 'wdl'
    : league.type;


/*
 * =========================================================
 * DATEN FÜR SAISONVERWALTUNG
 * =========================================================
 */

async function data(query) {

  const leagues = await League.findAll({
    where: {
      type: 'f1',
      slug: {
        [Op.in]: [
          'freitag',
          'samstag',
          'sonntag'
        ]
      }
    },

    order: [
      ['sortOrder', 'ASC'],
      ['id', 'ASC']
    ]
  });


  const league =
    leagues.find(
      (row) =>
        row.id === Number(query.league)
    ) ||
    leagues[0] ||
    null;


  const discipline = 'f1';


  /*
   * WICHTIG:
   * f1Game direkt mitladen.
   *
   * Damit kennt jede Saison ihre echte
   * F1Game-Verknüpfung.
   */
  const seasons = league
    ? await Season.findAll({
        where: {
          leagueType: discipline,
          scopeSlug: league.slug
        },

        include: [
          {
            association: 'pointsScheme',
            required: false
          },

          {
            association: 'f1Game',
            required: false
          }
        ],

        order: [
          ['status', 'ASC'],
          ['sortOrder', 'DESC'],
          ['id', 'DESC']
        ]
      })
    : [];


  const schemes =
    await PointsScheme.findAll({
      where: {
        discipline
      },

      order: [
        ['sortOrder', 'ASC'],
        ['id', 'ASC']
      ]
    });


  /*
   * Alle aktiven Spiele anzeigen.
   *
   * Zusätzlich müssen bereits verwendete,
   * inzwischen deaktivierte Spiele weiterhin
   * auswählbar/sichtbar bleiben.
   */
  const activeGames =
    await F1Game.findAll({
      where: {
        isActive: true
      },

      order: [
        ['sortOrder', 'ASC'],
        ['name', 'ASC'],
        ['id', 'ASC']
      ]
    });


  const usedGameIds =
    [
      ...new Set(
        seasons
          .map(
            (season) =>
              Number(season.F1GameId)
          )
          .filter(
            (id) =>
              Number.isInteger(id) &&
              id > 0
          )
      )
    ];


  let inactiveUsedGames = [];


  if (usedGameIds.length) {

    inactiveUsedGames =
      await F1Game.findAll({
        where: {
          id: {
            [Op.in]: usedGameIds
          },

          isActive: false
        },

        order: [
          ['sortOrder', 'ASC'],
          ['name', 'ASC'],
          ['id', 'ASC']
        ]
      });

  }


  const f1Games = [
    ...activeGames,
    ...inactiveUsedGames
  ];


  return {
    leagues,
    league,
    discipline,
    seasons,
    schemes,
    f1Games
  };
}


/*
 * =========================================================
 * ANZEIGE
 * =========================================================
 */

exports.show = async (req, res) => {

  return res.render(
    'admin/season-manager',
    {
      title: 'Saisons verwalten',
      ...(await data(req.query))
    }
  );

};


/*
 * =========================================================
 * SAISON AKTUALISIEREN
 * =========================================================
 */

exports.update = async (req, res) => {

  const season =
    await Season.findByPk(
      req.params.seasonId
    );


  if (!season) {

    return res.redirect(
      '/admin/season-manager'
    );

  }


  const league =
    await League.findOne({
      where: {
        slug: season.scopeSlug
      }
    });


  /*
   * ---------------------------------------------------------
   * F1GAME AUS FORMULAR
   * ---------------------------------------------------------
   */

  let F1GameId = null;


  if (
    req.body.F1GameId !== undefined &&
    req.body.F1GameId !== null &&
    String(req.body.F1GameId).trim() !== ''
  ) {

    F1GameId =
      Number(req.body.F1GameId);


    if (
      !Number.isInteger(F1GameId) ||
      F1GameId <= 0
    ) {

      req.session.flash = {
        type: 'error',
        message:
          'Bitte ein gültiges F1-Spiel auswählen.'
      };


      return res.redirect(
        `/admin/season-manager?league=${league?.id || ''}`
      );

    }


    const game =
      await F1Game.findByPk(
        F1GameId
      );


    if (!game) {

      req.session.flash = {
        type: 'error',
        message:
          'Das ausgewählte F1-Spiel wurde nicht gefunden.'
      };


      return res.redirect(
        `/admin/season-manager?league=${league?.id || ''}`
      );

    }

  }


  const fields = {

    name:
      String(
        req.body.name || ''
      ).trim(),

    /*
     * Neue Hauptzuordnung.
     */
    F1GameId,

    /*
     * gameName NICHT überschreiben.
     *
     * Das alte Feld bleibt als Legacy-Fallback
     * bestehen.
     */

    status:
      req.body.status === 'historical'
        ? 'historical'
        : 'active',

    isPublished:
      req.body.isPublished === 'on',

    accentColor:
      req.body.accentColor || null,

    PointsSchemeId:
      req.body.PointsSchemeId
        ? Number(
            req.body.PointsSchemeId
          )
        : null,

    reservePointsForConstructors:
      req.body.reservePointsForConstructors ===
      'on'

  };


  /*
   * ---------------------------------------------------------
   * VALIDIERUNG
   * ---------------------------------------------------------
   */

  if (!fields.name) {

    req.session.flash = {
      type: 'error',
      message:
        'Ein Saisonname ist erforderlich.'
    };


    return res.redirect(
      `/admin/season-manager?league=${league?.id || ''}`
    );

  }


  if (
    !/^#[0-9a-f]{6}$/i.test(
      fields.accentColor || ''
    )
  ) {

    req.session.flash = {
      type: 'error',
      message:
        'Bitte eine gültige Saisonfarbe auswählen.'
    };


    return res.redirect(
      `/admin/season-manager?league=${league?.id || ''}`
    );

  }


  const [
    duplicate,
    scheme
  ] =
    await Promise.all([

      Season.findOne({
        where: {
          id: {
            [Op.ne]: season.id
          },

          leagueType: 'f1',

          scopeSlug:
            season.scopeSlug,

          name:
            fields.name
        }
      }),

      PointsScheme.findOne({
        where: {
          id:
            fields.PointsSchemeId ||
            0,

          discipline:
            'f1'
        }
      })

    ]);


  if (duplicate) {

    req.session.flash = {
      type: 'error',
      message:
        `Die Saison „${fields.name}“ existiert in dieser Liga bereits.`
    };


    return res.redirect(
      `/admin/season-manager?league=${league?.id || ''}`
    );

  }


  if (!scheme) {

    req.session.flash = {
      type: 'error',
      message:
        'Bitte ein Formel-1-Punktesystem auswählen.'
    };


    return res.redirect(
      `/admin/season-manager?league=${league?.id || ''}`
    );

  }


  /*
   * ---------------------------------------------------------
   * TRANSAKTION
   * ---------------------------------------------------------
   */

  await sequelize.transaction(
    async (transaction) => {

      /*
       * Nur eine aktive Saison
       * pro Liga.
       */
      if (
        fields.status === 'active'
      ) {

        await Season.update(
          {
            status:
              'historical'
          },

          {
            where: {
              leagueType:
                season.leagueType,

              scopeSlug:
                season.scopeSlug,

              id: {
                [Op.ne]:
                  season.id
              },

              status:
                'active'
            },

            transaction
          }
        );

      }


      await season.update(
        fields,
        {
          transaction
        }
      );

    }
  );


  /*
   * Aktuelle League-Verknüpfung aktualisieren.
   */
  await activateSeason(
    season
  );


  req.session.flash = {
    type: 'success',

    message:
      'Saisonattribute wurden gespeichert.'
  };


  return res.redirect(
    `/admin/season-manager?league=${league?.id || ''}`
  );

};


/*
 * =========================================================
 * SAISON LÖSCHEN
 * =========================================================
 */

exports.remove = async (req, res) => {

  const season =
    await Season.findByPk(
      req.params.seasonId
    );


  if (!season) {

    return res.redirect(
      '/admin/season-manager'
    );

  }


  const league =
    await League.findOne({
      where: {
        slug:
          season.scopeSlug
      }
    });


  await sequelize.transaction(
    async (transaction) => {

      const races =
        await GrandPrixResult.findAll({
          where: {
            SeasonId:
              season.id
          },

          attributes: [
            'id'
          ],

          transaction
        });


      await RaceEvent.destroy({
        where: {
          SeasonId:
            season.id
        },

        transaction
      });


      if (races.length) {

        await GrandPrixResult.destroy({
          where: {
            id: races.map(
              (race) =>
                race.id
            )
          },

          transaction
        });

      }


      await season.destroy({
        transaction
      });

    }
  );


  req.session.flash = {
    type: 'success',

    message:
      'Saison, Kalender und zugehörige Ergebnisse wurden gelöscht.'
  };


  return res.redirect(
    `/admin/season-manager?league=${league?.id || ''}`
  );

};