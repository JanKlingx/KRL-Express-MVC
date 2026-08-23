function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function plain(value) {
  return value && typeof value.toJSON === "function" ? value.toJSON() : value;
}

function raceCode(race, index) {
  const words =
    String(race.title || race.circuit || "")
      .replace(/gro(?:ss|ß)er preis (?:von|der)/i, "")
      .match(/[A-Za-zÄÖÜäöü]+/g) || [];
  const source = words.at(-1) || `R${index + 1}`;
  return source.slice(0, 3).toUpperCase();
}

function buildSeasonData(
  leagueValue,
  resultValues,
  driverValues = [],
  lineupValues = [],
) {
  const league = plain(leagueValue);

  /*
   * =====================================================
   * RENNEN
   * =====================================================
   */

  const races = resultValues
    .map(plain)
    .sort(
      (left, right) =>
        number(left.sortOrder) - number(right.sortOrder) ||
        (left.raceType === "sprint" ? -1 : 1) -
          (right.raceType === "sprint" ? -1 : 1) ||
        String(left.raceDate || "").localeCompare(String(right.raceDate || "")),
    );

  /*
   * =====================================================
   * RENN-LINE-UP
   * =====================================================
   */

  const lineups = lineupValues.map(plain);

  /*
   * Welche Stammfahrer wurden bei welchem
   * Hauptrennen ersetzt?
   *
   * Map:
   * GrandPrixResultId
   *   -> Set von Stammfahrer-IDs
   */
  const replacedRegularsByRace = new Map();

  /*
   * Welcher Ersatzfahrer wurde bei welchem
   * Rennen eingesetzt?
   */
  const usedReserveEntries = lineups.filter(
    (entry) => entry.roleType === "reserve" && entry.ReplacementForDriverId,
  );

  usedReserveEntries.forEach((entry) => {
    const raceId = Number(entry.GrandPrixResultId);

    if (!replacedRegularsByRace.has(raceId)) {
      replacedRegularsByRace.set(raceId, new Set());
    }

    replacedRegularsByRace
      .get(raceId)
      .add(Number(entry.ReplacementForDriverId));
  });

  /*
   * =====================================================
   * STAMMFAHRER
   * =====================================================
   */

  const drivers = new Map();

  const namesToKeys = new Map();

  driverValues.map(plain).forEach((driver) => {
    const key = driver.id ? `id:${driver.id}` : `name:${driver.name}`;

    drivers.set(key, {
      id: driver.id || null,

      name: driver.name,

      team: plain(driver.team)?.name || "Privatteam",

      results: [],

      total: 0,

      wins: 0,
    });

    namesToKeys.set(driver.name, key);

    (driver.aliases || [])
      .map(plain)
      .forEach((alias) => namesToKeys.set(alias.alias, key));
  });

  const keyForEntry = (entry) =>
    entry.DriverId
      ? `id:${entry.DriverId}`
      : namesToKeys.get(entry.driverName) || `name:${entry.driverName}`;

  /*
   * WICHTIG:
   *
   * Keine unbekannten Fahrer mehr automatisch
   * in die Stammfahrerwertung aufnehmen.
   *
   * Dadurch tauchen Ersatzfahrer nicht in der
   * normalen Fahrer-WM auf.
   */

  /*
   * =====================================================
   * STAMMFAHRER-ERGEBNISSE
   * =====================================================
   */

  for (const [driverKey, driver] of drivers.entries()) {
    let cumulative = 0;

    driver.results = races.map((race) => {
      /*
       * Bei Sprint zunächst keine
       * Ersatz-DNS-Logik anwenden,
       * da das Race-Line-up aktuell
       * auf das Hauptrennen referenziert.
       */
      const wasReplaced =
        race.raceType === "main" &&
        replacedRegularsByRace.get(Number(race.id))?.has(Number(driver.id));

      /*
       * Stammfahrer wurde ersetzt.
       *
       * => DNS
       * => 0 Punkte
       */
      if (wasReplaced) {
        return {
          value: "DNS",

          points: 0,

          cumulative,

          status: "DNS",

          position: null,

          fastestLap: false,

          replaced: true,
        };
      }

      const entry = (race.entries || [])
        .map(plain)
        .find((candidate) => keyForEntry(candidate) === driverKey);

      if (!entry) {
        return {
          value: "–",

          points: 0,

          cumulative,

          status: null,

          position: null,

          fastestLap: false,
        };
      }

      const points = number(entry.points);

      const position = number(entry.position) || null;

      const status =
        String(entry.status || "")
          .trim()
          .toUpperCase() || null;

      cumulative += points;

      driver.total += points;

      if (position === 1 && race.raceType !== "sprint") {
        driver.wins += 1;
      }

      if (entry.teamName) {
        driver.team = entry.teamName;
      }

      return {
        value: status || (position ? `P${position}` : "–"),

        points,

        cumulative,

        status,

        position,

        fastestLap: Boolean(entry.fastestLap),
      };
    });
  }

  /*
   * =====================================================
   * STAMMFAHRER SORTIEREN
   * =====================================================
   */

  const rankedDrivers = [...drivers.values()].sort(
    (left, right) =>
      right.total - left.total ||
      right.wins - left.wins ||
      left.name.localeCompare(right.name, "de"),
  );

  const leaderPoints = rankedDrivers[0]?.total || 0;

  rankedDrivers.forEach((driver, index) => {
    driver.position = index + 1;

    driver.gap = driver.total - leaderPoints;

    driver.average = races.length ? driver.total / races.length : 0;
  });

  /*
   * =====================================================
   * ERSATZFAHRERWERTUNG
   * =====================================================
   *
   * Nur Fahrer, die tatsächlich mindestens
   * einen Stammfahrer ersetzt haben.
   */

  const reserveDrivers = new Map();

  usedReserveEntries.forEach((lineupEntry) => {
    const DriverId = Number(lineupEntry.DriverId);

    if (reserveDrivers.has(DriverId)) {
      return;
    }

    const lineupDriver = plain(lineupEntry.driver);

    reserveDrivers.set(DriverId, {
      id: DriverId,

      name: lineupDriver?.name || `Fahrer ${DriverId}`,

      team: null,

      results: [],

      total: 0,

      wins: 0,
    });
  });

  /*
   * Ergebnis jedes eingesetzten Ersatzfahrers
   * pro Rennen bestimmen.
   */

  for (const [reserveDriverId, reserveDriver] of reserveDrivers.entries()) {
    let cumulative = 0;

    reserveDriver.results = races.map((race) => {
      /*
       * Ersatzzuweisung existiert nur
       * für Hauptrennen.
       */
      if (race.raceType !== "main") {
        return {
          value: "–",

          points: 0,

          cumulative,

          status: null,

          position: null,

          fastestLap: false,
        };
      }

      const lineupEntry = usedReserveEntries.find(
        (entry) =>
          Number(entry.GrandPrixResultId) === Number(race.id) &&
          Number(entry.DriverId) === Number(reserveDriverId),
      );

      /*
       * Bei diesem Rennen nicht eingesetzt.
       */
      if (!lineupEntry) {
        return {
          value: "DNS",
          points: 0,
          cumulative,
          status: "DNS",
          position: null,
          fastestLap: false,
        };
      }

      /*
       * Tatsächliches Rennergebnis
       * des Ersatzfahrers suchen.
       */
      const resultEntry = (race.entries || [])
        .map(plain)
        .find((entry) => Number(entry.DriverId) === Number(reserveDriverId));

      /*
       * Als Ersatz eingeteilt,
       * aber kein Result vorhanden.
       */
      if (!resultEntry) {
        return {
          value: "DNS",

          points: 0,

          cumulative,

          status: "DNS",

          position: null,

          fastestLap: false,
        };
      }

      const points = number(resultEntry.points);

      const position = number(resultEntry.position) || null;

      const status =
        String(resultEntry.status || "")
          .trim()
          .toUpperCase() || null;

      cumulative += points;

      reserveDriver.total += points;

      if (position === 1) {
        reserveDriver.wins += 1;
      }

      if (resultEntry.teamName) {
        reserveDriver.team = resultEntry.teamName;
      }

      return {
        value: status || (position ? `P${position}` : "–"),

        points,

        cumulative,

        status,

        position,

        fastestLap: Boolean(resultEntry.fastestLap),
      };
    });
  }

  /*
   * Ersatzfahrer sortieren.
   */

  const rankedReserveDrivers = [...reserveDrivers.values()].sort(
    (left, right) =>
      right.total - left.total ||
      right.wins - left.wins ||
      left.name.localeCompare(right.name, "de"),
  );

  const reserveLeaderPoints = rankedReserveDrivers[0]?.total || 0;

  rankedReserveDrivers.forEach((driver, index) => {
    driver.position = index + 1;

    driver.gap = driver.total - reserveLeaderPoints;

    /*
     * Durchschnitt nur über tatsächliche
     * Einsätze berechnen.
     */
    const starts = driver.results.filter(
      (result) => result.value !== "–",
    ).length;

    driver.starts = starts;

    driver.average = starts ? driver.total / starts : 0;
  });

  /*
   * =====================================================
   * TEAM-WM
   * =====================================================
   *
   * Die Teams kommen aus dem aktuellen Saison-Line-up.
   * Alte/fremde Ergebnisfahrer werden ignoriert.
   *
   * Ersatzfahrer-Punkte gehen an das Team des
   * Stammfahrers, den sie ersetzt haben.
   */

  /*
   * Aktueller Stammfahrer -> aktuelles Saisonteam
   */
  const regularDriverTeamMap = new Map();

  driverValues.map(plain).forEach((driver) => {
    const teamName = plain(driver.team)?.name || null;

    if (driver.id && teamName) {
      regularDriverTeamMap.set(Number(driver.id), teamName);
    }
  });

  /*
   * Alle aktuellen Saisonteams zunächst mit 0 Punkten
   * anlegen.
   *
   * Dadurch erscheinen auch Racing Bulls, Ferrari,
   * RedBull usw., selbst wenn noch kein Rennen gefahren
   * wurde.
   */
  const teamMap = new Map();

  driverValues.map(plain).forEach((driver) => {
    const teamName = plain(driver.team)?.name || null;

    if (!teamName) {
      return;
    }

    if (!teamMap.has(teamName)) {
      teamMap.set(teamName, {
        name: teamName,
        points: 0,
        wins: 0,
      });
    }
  });

  /*
   * Tatsächliche Rennergebnisse auswerten.
   */
  races.forEach((race) => {
    (race.entries || []).map(plain).forEach((entry) => {
      const driverId = Number(entry.DriverId || 0);

      /*
       * =================================================
       * 1. STAMMFAHRER
       * =================================================
       */

      let teamName = regularDriverTeamMap.get(driverId) || null;

      /*
       * =================================================
       * 2. ERSATZFAHRER
       * =================================================
       *
       * Falls der Ergebnisfahrer kein Stammfahrer ist,
       * prüfen wir, ob er bei diesem Rennen als Ersatz
       * eingesetzt wurde.
       */

      if (!teamName) {
        const reserveLineup = usedReserveEntries.find(
          (lineupEntry) =>
            Number(lineupEntry.GrandPrixResultId) === Number(race.id) &&
            Number(lineupEntry.DriverId) === driverId,
        );

        if (reserveLineup?.ReplacementForDriverId) {
          /*
           * Team des ersetzten Stammfahrers verwenden.
           */
          teamName =
            regularDriverTeamMap.get(
              Number(reserveLineup.ReplacementForDriverId),
            ) || null;
        }
      }

      /*
       * Fahrer gehört weder als Stamm- noch als
       * eingesetzter Ersatzfahrer zu dieser Saison.
       *
       * Alte Testdaten werden dadurch ignoriert.
       */
      if (!teamName) {
        return;
      }

      /*
       * Sicherheit:
       * Team ggf. nachträglich anlegen.
       */
      if (!teamMap.has(teamName)) {
        teamMap.set(teamName, {
          name: teamName,
          points: 0,
          wins: 0,
        });
      }

      const team = teamMap.get(teamName);

      team.points += number(entry.points);

      if (number(entry.position) === 1 && race.raceType !== "sprint") {
        team.wins += 1;
      }
    });
  });

  /*
   * Team-WM sortieren
   */
  const rankedTeams = [...teamMap.values()].sort(
    (left, right) =>
      right.points - left.points ||
      right.wins - left.wins ||
      left.name.localeCompare(right.name, "de"),
  );

  const leaderTeamPoints = rankedTeams[0]?.points || 0;

  rankedTeams.forEach((team, index) => {
    team.position = index + 1;

    team.gap = index === 0 ? "Leader" : `+${leaderTeamPoints - team.points}`;
  });

  /*
   * =====================================================
   * SAISONVERLAUF
   * =====================================================
   */

  const season = {
    name: league.currentSeason,

    races: races.map((race, index) => ({
      round: race.sortOrder || index + 1,

      code: raceCode(race, index),

      title: race.title,
    })),

    /*
     * Nur Stammfahrer.
     */
    drivers: rankedDrivers,

    /*
     * Separate Ersatzfahrerwertung.
     */
    reserveDrivers: rankedReserveDrivers,
  };

  return {
    history: {
      seasons: races.length ? [season] : [],

      sourceLabel: races.length ? "Admin-Saisonverlauf" : null,

      warning: null,
    },

    selectedHistory: races.length ? season : null,

    /*
     * Normale Fahrer-WM bleibt
     * Stammfahrer-WM.
     */
    driverStandings: rankedDrivers.map((driver) => ({
      position: driver.position,

      points: driver.total,

      wins: driver.wins,

      gap: driver.position === 1 ? "Leader" : `+${leaderPoints - driver.total}`,

      driver: {
        name: driver.name,

        team: {
          name: driver.team,
        },
      },
    })),

    /*
     * Neue Ersatzfahrerwertung.
     */
    reserveStandings: rankedReserveDrivers.map((driver) => ({
      position: driver.position,

      points: driver.total,

      wins: driver.wins,

      starts: driver.starts,

      average: driver.average,

      gap:
        driver.position === 1
          ? "Leader"
          : `+${reserveLeaderPoints - driver.total}`,

      driver: {
        id: driver.id,

        name: driver.name,

        team: driver.team
          ? {
              name: driver.team,
            }
          : null,
      },
    })),

    teamStandings: rankedTeams.map((team) => ({
      ...team,

      team: {
        name: team.name,
      },
    })),

    races,
  };
}

module.exports = { buildSeasonData, raceCode };
