const { Op } = require('sequelize');

const {
  SeasonDriver,
  SeasonTeam,
  SeasonLineupEntry,
  Driver,
  Team,
  F1CarProfile
} = require('../models');


const eligibleSeasonDriverWhere = {
  [Op.or]: [
    { roleF1Friday: true },
    { roleF1Saturday: true },
    { roleF1Sunday: true },
    { roleFormerF1: true }
  ]
};


async function loadEligibleSeasonDrivers() {
  return Driver.findAll({
    where: eligibleSeasonDriverWhere,

    include: [
      {
        association: 'aliases'
      }
    ],

    order: [
      ['name', 'ASC'],
      ['id', 'ASC']
    ]
  });
}


async function loadSeasonStructure(seasonId) {

  if (!seasonId) {
    return {
      teams: [],
      unassignedDrivers: [],
      allDrivers: [],
      lineup: []
    };
  }


  const [
    memberships,
    seasonTeams,
    lineup
  ] = await Promise.all([

    SeasonDriver.findAll({
      where: {
        SeasonId: seasonId
      },

      include: [
        {
          association: 'driver',

          include: [
            {
              association: 'aliases'
            }
          ]
        }
      ],

      order: [
        ['sortOrder', 'ASC'],
        ['id', 'ASC']
      ]
    }),


    SeasonTeam.findAll({
      where: {
        SeasonId: seasonId
      },

      order: [
        ['sortOrder', 'ASC'],
        ['id', 'ASC']
      ]
    }),


    SeasonLineupEntry.findAll({
      where: {
        SeasonId: seasonId
      },

      include: [
        {
          association: 'driver',

          include: [
            {
              association: 'aliases'
            }
          ]
        }
      ],

      order: [
        ['sortOrder', 'ASC'],
        ['id', 'ASC']
      ]
    })

  ]);


  const byTeam = new Map(
    seasonTeams.map((team) => [
      Number(team.id),
      {
        ...team.toJSON(),
        id: Number(team.id),
        drivers: []
      }
    ])
  );


  lineup.forEach((entry) => {

    if (
      !entry.SeasonTeamId ||
      !entry.driver
    ) {
      return;
    }


    const teamId =
      Number(
        entry.SeasonTeamId
      );


    const driverId =
      Number(
        entry.DriverId ||
        entry.driver.id
      );


    const team =
      byTeam.get(
        teamId
      );


    if (!team) {
      return;
    }


    team.drivers.push({
      ...entry.driver.toJSON(),

      id:
        driverId,

      DriverId:
        driverId,

      SeasonTeamId:
        teamId,

      roleType:
        entry.roleType,

      lineupEntryId:
        entry.id
    });

  });


  const allDrivers =
    memberships
      .map(
        (membership) =>
          membership.driver
      )
      .filter(Boolean);


  const assigned =
    new Set(
      lineup
        .filter(
          (entry) =>
            entry.SeasonTeamId &&
            entry.roleType === 'regular'
        )
        .map(
          (entry) =>
            Number(
              entry.DriverId
            )
        )
    );


  return {
    teams:
      [...byTeam.values()],

    unassignedDrivers:
      allDrivers.filter(
        (driver) =>
          !assigned.has(
            Number(driver.id)
          )
      ),

    allDrivers,

    lineup
  };
}


async function resolveTeamToken(token) {

  const [
    sourceType,
    rawId
  ] =
    String(
      token || ''
    ).split(':');


  const sourceId =
    Number(rawId);


  if (
    !sourceId ||
    ![
      'current',
      'historical'
    ].includes(sourceType)
  ) {
    return null;
  }


  if (sourceType === 'current') {

    const team =
      await Team.findOne({
        where: {
          id:
            sourceId,

          LeagueId:
            null,

          discipline:
            'f1'
        }
      });


    return team
      ? {
          sourceType,
          sourceId,

          name:
            team.name,

          accentColor:
            team.accentColor,

          logoPath:
            team.logoPath
        }
      : null;
  }


  const profile =
    await F1CarProfile.findByPk(
      sourceId,
      {
        include: [
          {
            association:
              'baseTeam'
          }
        ]
      }
    );


  if (!profile?.BaseTeamId) {
    return null;
  }


  return {
    sourceType,
    sourceId,

    name:
      profile.name,

    accentColor:
      profile.accentColor,

    logoPath:
      profile.logoPath,

    BaseTeamId:
      profile.BaseTeamId
  };
}


module.exports = {
  eligibleSeasonDriverWhere,
  loadEligibleSeasonDrivers,
  loadSeasonStructure,
  resolveTeamToken
};