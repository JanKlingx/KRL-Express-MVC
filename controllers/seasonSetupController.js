const { Op } = require("sequelize");
const {
  sequelize,
  League,
  Season,
  PointsScheme,
  RaceEvent,
  Team,
  F1CarProfile,
  SeasonF1CarAssignment,
  GrandPrixResult,
  F1Track,
  SeasonDriver,
  SeasonTeam,
  SeasonLineupEntry,
  Driver,
} = require("../models");
const {
  activateSeason,
  syncSeriesCalendarEvent,
} = require("../services/championship");
const {
  loadEligibleSeasonDrivers,
  loadSeasonStructure,
  resolveTeamToken,
} = require("../services/f1Season");

function disciplineForLeague(league) {
  return league?.type === "competition" ? "wdl" : league?.type;
}

function setupRedirect(values = {}) {
  const query = new URLSearchParams(
    Object.entries(values).filter(([, value]) => value),
  );
  return `/admin/season-setup${query.size ? `?${query}` : ""}`;
}

function extractTime(value, fallback = "20:00") {
  return (
    String(value || "").match(/\b([01]\d|2[0-3]):[0-5]\d\b/)?.[0] || fallback
  );
}

function progressHref(league, season) {
  if (!league || !season) return null;
  if (league.type === "f1" && season.status === "active")
    return `/admin/current-season-progress?league=${league.id}`;
  if (league.type === "f1")
    return `/admin/race-editor?league=${league.id}&season=${season.id}`;
  return `/admin/season-progress/${disciplineForLeague(league)}?season=${season.id}`;
}

async function loadData(query = {}) {
  const leagues = await League.findAll({
    where: {
      type: "f1",
      slug: {
        [Op.in]: ["freitag", "samstag", "sonntag"],
      },
    },
    order: [
      ["type", "ASC"],
      ["sortOrder", "ASC"],
      ["id", "ASC"],
    ],
  });

  const selectedLeague =
    leagues.find((league) => league.id === Number(query.league)) ||
    leagues[0] ||
    null;

  const discipline = disciplineForLeague(selectedLeague);

  const seasons = selectedLeague
    ? await Season.findAll({
        where: {
          leagueType: discipline,
          scopeSlug: selectedLeague.slug,
        },
        include: [
          {
            association: "pointsScheme",
            required: false,
          },
        ],
        order: [
          ["status", "ASC"],
          ["sortOrder", "DESC"],
          ["id", "DESC"],
        ],
      })
    : [];

  const selectedSeason =
    seasons.find((season) => season.id === Number(query.season)) ||
    seasons.find((season) => season.status === "active") ||
    seasons[0] ||
    null;

  const allowedDriverRanks = ["all", "friday", "saturday", "sunday", "former"];

  const driverRankFilter = allowedDriverRanks.includes(query.driverRank)
    ? query.driverRank
    : "all";

  const [
    pointsSchemes,
    rawCalendar,
    sprintRows,
    f1Teams,
    carProfiles,
    carAssignments,
    tracks,
    eligibleDrivers,
    structure,
  ] = await Promise.all([
    PointsScheme.findAll({
      where: {
        discipline: "f1",
      },
      order: [
        ["sortOrder", "DESC"],
        ["id", "DESC"],
      ],
    }),

    selectedSeason && selectedLeague
      ? RaceEvent.findAll({
          where: {
            SeasonId: selectedSeason.id,
            LeagueId: selectedLeague.id,
          },
          include: [
            {
              association: "track",
              include: [
                {
                  association: "countryRecord",
                },
              ],
            },
          ],
          order: [
            ["sortOrder", "ASC"],
            ["startsAt", "ASC"],
            ["id", "ASC"],
          ],
        })
      : [],

    selectedSeason && selectedLeague
      ? GrandPrixResult.findAll({
          where: {
            SeasonId: selectedSeason.id,
            LeagueId: selectedLeague.id,
            raceType: "sprint",
          },
          attributes: ["circuit", "sortOrder"],
        })
      : [],

    Team.findAll({
      where: {
        LeagueId: null,
        discipline: "f1",
      },
      order: [
        ["sortOrder", "ASC"],
        ["id", "ASC"],
      ],
    }),

    F1CarProfile.findAll({
      where: {
        BaseTeamId: {
          [Op.ne]: null,
        },
      },
      include: [
        {
          association: "baseTeam",
          required: true,
        },
      ],
      order: [
        ["name", "ASC"],
        ["id", "ASC"],
      ],
    }),

    selectedSeason
      ? SeasonF1CarAssignment.findAll({
          where: {
            SeasonId: selectedSeason.id,
          },
        })
      : [],

    F1Track.findAll({
      include: [
        {
          association: "countryRecord",
        },
      ],
      order: [
        ["country", "ASC"],
        ["name", "ASC"],
      ],
    }),

    loadEligibleSeasonDrivers(),

    loadSeasonStructure(selectedSeason?.id),
  ]);

  /*
   * Sprint-Status an den Kalender hängen.
   *
   * hasSprint ist kein RaceEvent-Feld,
   * sondern wird über GrandPrixResult/raceType=sprint
   * ermittelt.
   */
  const sprintKeys = new Set(
    sprintRows.map((race) => `${race.circuit}::${race.sortOrder}`),
  );

  const calendar = rawCalendar.map((event) => ({
    ...event.toJSON(),

    hasSprint: sprintKeys.has(`${event.circuit}::${event.sortOrder}`),
  }));

  return {
    leagues,
    selectedLeague,
    discipline,
    seasons,
    selectedSeason,
    pointsSchemes,
    calendar,
    f1Teams,
    carProfiles,
    tracks,
    eligibleDrivers,
    structure,
    driverRankFilter,

    carAssignmentMap: Object.fromEntries(
      carAssignments.map((assignment) => [
        assignment.TeamId,
        assignment.F1CarProfileId,
      ]),
    ),

    defaultTime: extractTime(selectedLeague?.raceTime),

    progressHref: progressHref(selectedLeague, selectedSeason),

    finishReady: Boolean(
      selectedSeason &&
      calendar.length &&
      selectedSeason.PointsSchemeId &&
      structure.allDrivers.length &&
      structure.teams.length &&
      structure.teams.some((team) => team.drivers.length),
    ),
  };
}

exports.show = async (req, res) => {
  const data = await loadData(req.query);
  res.render("admin/season-setup", { title: "Saison-Assistent", ...data });
};

exports.createSeason = async (req, res) => {
  let league;
  try {
    league = await League.findByPk(req.body.LeagueId);
    if (!league || league.type !== "f1")
      throw new Error("Bitte eine gültige Formel-1-Liga auswählen.");
    const name = String(req.body.name || "").trim();
    if (!name) throw new Error("Bitte einen Saisonnamen eingeben.");
    const discipline = disciplineForLeague(league);
    const duplicate = await Season.findOne({
      where: { leagueType: discipline, scopeSlug: league.slug, name },
    });
    if (duplicate) {
      const error = new Error(
        `Die Saison „${name}“ existiert für ${league.name} bereits.`,
      );
      error.seasonManagerHref = `/admin/season-manager?league=${league.id}`;
      throw error;
    }
    if (!["active", "historical"].includes(req.body.status))
      throw new Error(
        "Bitte den Saisonstatus aktuell oder historisch auswählen.",
      );
    if (!/^#[0-9a-f]{6}$/i.test(req.body.accentColor || ""))
      throw new Error("Bitte eine gültige Saisonfarbe auswählen.");
    const accentColor = req.body.accentColor;
    const season = await Season.create({
      name,
      leagueType: discipline,
      scopeSlug: league.slug,
      status: req.body.status,
      calendarMode: "manual",
      accentColor,
      PointsSchemeId: null,
      isPublished: false,
      reservePointsForConstructors:
        req.body.reservePointsForConstructors === "on",
    });
    req.session.flash = {
      type: "success",
      message: `${season.name} wurde für ${league.name} angelegt. Als Nächstes kann der Rennkalender gepflegt werden.`,
    };
    res.redirect(setupRedirect({ league: league.id, season: season.id }));
  } catch (error) {
    req.session.flash = {
      type: "error",
      message: error.message,
      ...(error.seasonManagerHref
        ? {
            href: error.seasonManagerHref,
            linkLabel: "Vorhandene Saison bearbeiten →",
          }
        : {}),
    };
    res.redirect(setupRedirect({ league: league?.id || req.body.LeagueId }));
  }
};

exports.updateSeasonProfile = async (req, res) => {
  const season = await Season.findByPk(req.params.seasonId);
  const league = season
    ? await League.findOne({
        where: {
          slug: season.scopeSlug,
          type: season.leagueType === "wdl" ? "competition" : season.leagueType,
        },
      })
    : null;
  try {
    if (!season || !league)
      throw new Error("Saison oder Liga wurde nicht gefunden.");
    const pointsScheme = req.body.PointsSchemeId
      ? await PointsScheme.findByPk(req.body.PointsSchemeId)
      : null;
    if (!pointsScheme || pointsScheme.discipline !== "f1")
      throw new Error("Bitte ein Formel-1-Punktesystem auswählen.");
    const accentColor = /^#[0-9a-f]{6}$/i.test(req.body.accentColor || "")
      ? req.body.accentColor
      : season.accentColor || league.accentColor;
    await season.update({
      PointsSchemeId: pointsScheme.id,
      accentColor,
      reservePointsForConstructors:
        req.body.reservePointsForConstructors === "on",
    });
    req.session.flash = {
      type: "success",
      message: `Farbprofil und Punktesystem von ${season.name} wurden gespeichert.`,
    };
  } catch (error) {
    req.session.flash = { type: "error", message: error.message };
  }
  res.redirect(setupRedirect({ league: league?.id, season: season?.id }));
};

exports.addCalendarEvent = async (req, res) => {
  const season = await Season.findByPk(req.params.seasonId);

  const league = season
    ? await League.findOne({
        where: {
          slug: season.scopeSlug,
          type: season.leagueType === "wdl" ? "competition" : season.leagueType,
        },
      })
    : null;

  try {
    if (!season || !league) {
      throw new Error("Saison oder Liga wurde nicht gefunden.");
    }

    const track = await F1Track.findByPk(req.body.F1TrackId, {
      include: [
        {
          association: "countryRecord",
        },
      ],
    });

    if (!track) {
      throw new Error("Bitte eine Strecke aus dem F1-Streckenstamm auswählen.");
    }

    const title = `Großer Preis von ${
      track.countryRecord?.name || track.country
    }`;

    const circuit = track.name;

    const date = String(req.body.date || "").trim();

    if (!date) {
      throw new Error("Datum ist ein Pflichtfeld.");
    }

    const isTestDay = req.body.isTestDay === "on";

    let sortOrder;

    if (isTestDay) {
      sortOrder = 0;
    } else {
      const normalRaceCount = await RaceEvent.count({
        where: {
          LeagueId: league.id,
          SeasonId: season.id,
          isTestDay: false,
        },
      });

      sortOrder = normalRaceCount + 1;
    }
    if (!Number.isInteger(sortOrder) || (!isTestDay && sortOrder < 1)) {
      throw new Error("Die Rennen-Nr. muss größer als 0 sein.");
    }

    if (!isTestDay) {
      const duplicateRound = await RaceEvent.findOne({
        where: {
          LeagueId: league.id,
          SeasonId: season.id,
          sortOrder,
          isTestDay: false,
        },
      });

      if (duplicateRound) {
        throw new Error(
          `Rennen Nr. ${sortOrder} ist in dieser Saison bereits vergeben.`,
        );
      }
    }

    const time = extractTime(league.raceTime);

    const startsAt = new Date(`${date}T${time}:00`);

    if (Number.isNaN(startsAt.getTime())) {
      throw new Error("Datum oder Startzeit ist ungültig.");
    }

    const event = await RaceEvent.create({
      SeasonId: season.id,
      LeagueId: league.id,
      F1TrackId: track.id,
      title,
      circuit,
      startsAt,
      durationMinutes: null,

      isPublished: season.status === "active" && season.isPublished,

      isTestDay,
      sortOrder,
    });

    if (!isTestDay) {
      await syncSeriesCalendarEvent(event);
    }
    /*
     * Sprint anlegen
     */
    if (
      !isTestDay &&
      season.leagueType === "f1" &&
      req.body.hasSprint === "on"
    ) {
      await GrandPrixResult.findOrCreate({
        where: {
          SeasonId: season.id,
          LeagueId: league.id,
          circuit,
          raceType: "sprint",
        },

        defaults: {
          SeasonId: season.id,
          LeagueId: league.id,
          season: season.name,

          title: `Sprint · ${circuit}`,

          circuit,
          raceDate: date,
          discipline: "f1",
          raceType: "sprint",
          pointsMode: "database",

          isHistorical: season.status === "historical",

          sortOrder,
        },
      });
    }

    req.session.flash = {
      type: "success",
      message: "Kalendereintrag wurde gespeichert.",
    };
  } catch (error) {
    req.session.flash = {
      type: "error",
      message: error.message,
    };
  }

  return res.redirect(
    `${setupRedirect({
      league: league?.id,
      season: season?.id,
    })}#setup-calendar`,
  );
};

exports.assignF1Cars = async (req, res) => {
  const season = await Season.findByPk(req.params.seasonId);
  const league = season
    ? await League.findOne({ where: { slug: season.scopeSlug, type: "f1" } })
    : null;
  try {
    if (!season || season.leagueType !== "f1" || !league)
      throw new Error(
        "Die Autozuweisung ist nur für eine Formel-1-Saison möglich.",
      );
    const assignments = Object.entries(req.body.cars || {})
      .map(([teamId, profileId], index) => ({
        SeasonId: season.id,
        TeamId: Number(teamId),
        F1CarProfileId: Number(profileId),
        sortOrder: index,
      }))
      .filter((entry) => entry.TeamId && entry.F1CarProfileId);
    const teamIds = [...new Set(assignments.map((entry) => entry.TeamId))];
    const profileIds = [
      ...new Set(assignments.map((entry) => entry.F1CarProfileId)),
    ];
    const validTeamCount = teamIds.length
      ? await Team.count({
          where: { id: teamIds, LeagueId: null, discipline: "f1" },
        })
      : 0;
    const profiles = profileIds.length
      ? await F1CarProfile.findAll({ where: { id: profileIds } })
      : [];
    if (
      validTeamCount !== teamIds.length ||
      profiles.length !== profileIds.length
    )
      throw new Error("Mindestens eine Autozuweisung ist ungültig.");
    const profileById = new Map(
      profiles.map((profile) => [profile.id, profile]),
    );
    if (
      assignments.some(
        (assignment) =>
          Number(profileById.get(assignment.F1CarProfileId)?.BaseTeamId) !==
          assignment.TeamId,
      )
    ) {
      throw new Error(
        "Ein historisches Autoprofil darf nur seinem verknüpften aktuellen Formel-1-Team zugewiesen werden.",
      );
    }
    await sequelize.transaction(async (transaction) => {
      await SeasonF1CarAssignment.destroy({
        where: { SeasonId: season.id },
        transaction,
      });
      if (assignments.length)
        await SeasonF1CarAssignment.bulkCreate(assignments, { transaction });
    });
    req.session.flash = {
      type: "success",
      message: `Die Formel-1-Autoprofile für ${season.name} wurden gespeichert.`,
    };
  } catch (error) {
    req.session.flash = { type: "error", message: error.message };
  }
  res.redirect(setupRedirect({ league: league?.id, season: season?.id }));
};

exports.assignDrivers = async (req, res) => {
  const season = await Season.findByPk(req.params.seasonId);
  const league = season
    ? await League.findOne({ where: { slug: season.scopeSlug, type: "f1" } })
    : null;
  try {
    if (!season || !league)
      throw new Error("Saison oder Liga wurde nicht gefunden.");
    const ids = [
      ...new Set(
        []
          .concat(req.body.driverIds || [])
          .map(Number)
          .filter(Number.isInteger),
      ),
    ].slice(0, 40);
    if (!ids.length)
      throw new Error("Bitte mindestens einen Fahrer auswählen.");
    const validDrivers = await Driver.findAll({
      where: { id: { [Op.in]: ids } },
    });
    const eligible = validDrivers.filter(
      (driver) =>
        driver.roleF1Friday ||
        driver.roleF1Saturday ||
        driver.roleF1Sunday ||
        driver.roleFormerF1,
    );
    if (eligible.length !== ids.length)
      throw new Error(
        "Mindestens ein Fahrer besitzt keinen zulässigen Formel-1-Rang.",
      );
    await sequelize.transaction(async (transaction) => {
      await SeasonLineupEntry.destroy({
        where: { SeasonId: season.id, DriverId: { [Op.notIn]: ids } },
        transaction,
      });
      await SeasonDriver.destroy({
        where: { SeasonId: season.id },
        transaction,
      });
      await SeasonDriver.bulkCreate(
        ids.map((DriverId, index) => ({
          SeasonId: season.id,
          DriverId,
          sortOrder: index,
        })),
        { transaction },
      );
    });
    req.session.flash = {
      type: "success",
      message: `${ids.length} Fahrer wurden für ${season.name} übernommen.`,
    };
  } catch (error) {
    req.session.flash = { type: "error", message: error.message };
  }
  res.redirect(setupRedirect({ league: league?.id, season: season?.id }));
};

exports.assignTeams = async (req, res) => {
  const season = await Season.findByPk(req.params.seasonId);
  const league = season
    ? await League.findOne({ where: { slug: season.scopeSlug, type: "f1" } })
    : null;
  try {
    if (!season || !league)
      throw new Error("Saison oder Liga wurde nicht gefunden.");
    const tokens = [
      ...new Set([].concat(req.body.teamTokens || []).filter(Boolean)),
    ];
    if (!tokens.length || tokens.length > 11)
      throw new Error("Bitte zwischen 1 und maximal 11 Teams auswählen.");
    const sources = (await Promise.all(tokens.map(resolveTeamToken))).filter(
      Boolean,
    );
    if (sources.length !== tokens.length)
      throw new Error("Mindestens ein ausgewähltes Team ist ungültig.");
    await sequelize.transaction(async (transaction) => {
      await SeasonLineupEntry.update(
        { SeasonTeamId: null, roleType: "reserve" },
        { where: { SeasonId: season.id }, transaction },
      );
      await SeasonTeam.destroy({ where: { SeasonId: season.id }, transaction });
      await SeasonTeam.bulkCreate(
        sources.map((source, index) => ({
          SeasonId: season.id,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          name: source.name,
          accentColor: source.accentColor || "#6ef2f2",
          logoPath: source.logoPath || null,
          sortOrder: index,
        })),
        { transaction },
      );
    });
    req.session.flash = {
      type: "success",
      message: `${sources.length} Saisonteams wurden gespeichert.`,
    };
  } catch (error) {
    req.session.flash = { type: "error", message: error.message };
  }
  res.redirect(setupRedirect({ league: league?.id, season: season?.id }));
};

exports.assignLineup = async (req, res) => {
  const season = await Season.findByPk(req.params.seasonId);

  const league = season
    ? await League.findOne({
        where: {
          slug: season.scopeSlug,
          type: "f1",
        },
      })
    : null;

  try {
    if (!season || !league) {
      throw new Error("Saison oder Liga wurde nicht gefunden.");
    }

    /*
     * Wichtig:
     * Alle IDs explizit zu Number machen.
     */
    const [memberships, teams] = await Promise.all([
      SeasonDriver.findAll({
        where: {
          SeasonId: season.id,
        },
      }),

      SeasonTeam.findAll({
        where: {
          SeasonId: season.id,
        },
      }),
    ]);

    /*
     * Zulässige Fahrer und Teams
     */
    const allowedDrivers = new Set(
      memberships.map((row) => Number(row.DriverId)),
    );

    const allowedTeams = new Set(teams.map((row) => Number(row.id)));

    /*
     * Hier steckt das abgesendete Formular.
     */
    const postedLineup = req.body.lineup || {};

    console.log("LINEUP BODY:", JSON.stringify(postedLineup, null, 2));

    const assignments = [];

    const usedDrivers = new Set();

    /*
     * =====================================================
     * TEAM FÜR TEAM DURCHGEHEN
     * =====================================================
     */

    for (const [teamIdRaw, rawIds] of Object.entries(postedLineup)) {
      const SeasonTeamId = Number(teamIdRaw);

      if (!Number.isInteger(SeasonTeamId) || !allowedTeams.has(SeasonTeamId)) {
        continue;
      }

      /*
       * rawIds kann ein einzelner Wert
       * oder ein Array sein.
       */
      const driverIds = Array.isArray(rawIds) ? rawIds : [rawIds];

      for (const rawDriverId of driverIds) {
        /*
         * Leeres Dropdown überspringen.
         */
        if (
          rawDriverId === "" ||
          rawDriverId === null ||
          rawDriverId === undefined
        ) {
          continue;
        }

        const DriverId = Number(rawDriverId);

        if (!Number.isInteger(DriverId)) {
          continue;
        }

        if (!allowedDrivers.has(DriverId)) {
          throw new Error(
            `Fahrer-ID ${DriverId} gehört nicht zur ausgewählten Saison.`,
          );
        }

        if (usedDrivers.has(DriverId)) {
          throw new Error(
            `Fahrer-ID ${DriverId} wurde mehrfach im Line-up ausgewählt.`,
          );
        }

        usedDrivers.add(DriverId);

        assignments.push({
          SeasonId: Number(season.id),

          SeasonTeamId,

          DriverId,

          roleType: "regular",

          sortOrder: assignments.length,
        });
      }
    }

    console.log("LINEUP ASSIGNMENTS:", assignments);

    if (!assignments.length) {
      throw new Error("Es wurde keine gültige Line-up-Zuordnung empfangen.");
    }

    /*
     * =====================================================
     * NICHT ZUGEORDNETE FAHRER = ERSATZFAHRER
     * =====================================================
     */

    const reserves = [...allowedDrivers]

      .filter((DriverId) => !usedDrivers.has(DriverId))

      .map((DriverId, index) => ({
        SeasonId: Number(season.id),

        SeasonTeamId: null,

        DriverId,

        roleType: "reserve",

        sortOrder: assignments.length + index,
      }));

    /*
     * =====================================================
     * SPEICHERN
     * =====================================================
     */

    await sequelize.transaction(async (transaction) => {
      /*
       * Vorhandenes Line-up
       * dieser Saison komplett ersetzen.
       */
      await SeasonLineupEntry.destroy({
        where: {
          SeasonId: season.id,
        },

        transaction,
      });

      await SeasonLineupEntry.bulkCreate([...assignments, ...reserves], {
        transaction,
      });
    });

    /*
     * Direkt prüfen, was gespeichert wurde.
     */
    const savedRegulars = await SeasonLineupEntry.findAll({
      where: {
        SeasonId: season.id,

        roleType: "regular",
      },
    });

    console.log(
      "GESPEICHERTE STAMMFAHRER:",
      savedRegulars.map((row) => ({
        id: row.id,

        SeasonTeamId: row.SeasonTeamId,

        DriverId: row.DriverId,
      })),
    );

    req.session.flash = {
      type: "success",

      message: `Line-up gespeichert: ${assignments.length} Stammfahrer und ${reserves.length} Ersatzfahrer.`,
    };
  } catch (error) {
    console.error("LINE-UP SPEICHERN FEHLER:", error);

    req.session.flash = {
      type: "error",

      message: error.message,
    };
  }

  return res.redirect(
    `${setupRedirect({
      league: league?.id,

      season: season?.id,
    })}#setup-lineup`,
  );
};

exports.finish = async (req, res) => {
  const season = await Season.findByPk(req.params.seasonId);

  const league = season
    ? await League.findOne({
        where: {
          slug: season.scopeSlug,
          type: "f1",
        },
      })
    : null;

  try {
    if (!season || !league) {
      throw new Error("Saison oder Liga wurde nicht gefunden.");
    }

    const [calendar, drivers, teams, lineup] = await Promise.all([
      RaceEvent.count({
        where: {
          SeasonId: season.id,
        },
      }),

      SeasonDriver.count({
        where: {
          SeasonId: season.id,
        },
      }),

      SeasonTeam.count({
        where: {
          SeasonId: season.id,
        },
      }),

      SeasonLineupEntry.count({
        where: {
          SeasonId: season.id,
          roleType: "regular",
        },
      }),
    ]);

    if (!calendar || !season.PointsSchemeId || !drivers || !teams || !lineup) {
      throw new Error(
        "Der Assistent ist noch nicht vollständig. Bitte alle acht Schritte abschließen.",
      );
    }

    /*
     * Saison veröffentlichen
     */
    await season.update({
      isPublished: true,
    });

    /*
     * Aktuelle Saison aktivieren
     */
    if (season.status === "active") {
      await activateSeason(season);
    }

    /*
     * Erfolgsmeldung fürs Dashboard
     */
    req.session.flash = {
      type: "success",
      message: `Saison „${season.name}“ wurde erfolgreich veröffentlicht.`,
    };

    /*
     * Zurück aufs Admin-Dashboard
     */
    return res.redirect("/admin");
  } catch (error) {
    req.session.flash = {
      type: "error",
      message: error.message,
    };

    return res.redirect(
      `${setupRedirect({
        league: league?.id,
        season: season?.id,
      })}#setup-finish`,
    );
  }
};

module.exports.loadData = loadData;
