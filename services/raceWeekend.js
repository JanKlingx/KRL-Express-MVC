function berlinDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(value);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function eventDate(event) {
  if (!event?.startsAt) return null;
  return berlinDate(new Date(event.startsAt));
}

function selectCurrentRaceEvent(events, requested = {}) {
  const explicit = events.find((event) =>
    Number(event.id) === Number(requested.event) ||
    Number(event.GrandPrixResultId) === Number(requested.race)
  );
  if (explicit) return explicit;

  const today = requested.today || berlinDate();
  const races = events
    .filter((event) => !event.isTestDay && event.GrandPrixResultId)
    .sort((left, right) => String(eventDate(left) || '9999-12-31').localeCompare(String(eventDate(right) || '9999-12-31')));
  return races.find((event) => eventDate(event) === today) ||
    races.find((event) => eventDate(event) && eventDate(event) > today) ||
    [...races].reverse().find((event) => eventDate(event) && eventDate(event) < today) ||
    races[0] || null;
}

function buildCockpitRows(entries, seasonTeamByDriver = new Map()) {
  const childByDriver = new Map();
  entries.filter((entry) => entry.roleType === 'reserve' && entry.ReplacementForDriverId)
    .forEach((entry) => childByDriver.set(Number(entry.ReplacementForDriverId), entry));
  return entries.filter((entry) => entry.roleType === 'regular').map((base) => {
    const chain = [];
    const visited = new Set();
    let candidate = base;
    let current = null;
    let pending = null;
    let failed = null;
    while (candidate && !visited.has(Number(candidate.DriverId)) && chain.length <= entries.length) {
      visited.add(Number(candidate.DriverId));
      chain.push(candidate);
      const unavailableStatus = candidate.roleType === 'regular'
        ? ['abgemeldet', 'rennsperre'].includes(candidate.status)
        : ['abgemeldet', 'angefragt'].includes(candidate.status);
      if (unavailableStatus || candidate.uncertainPresent === false ||
          ['unabgemeldet', 'zu_spaet_abgemeldet'].includes(candidate.attendanceStatus)) {
        failed = candidate;
        candidate = childByDriver.get(Number(candidate.DriverId)) || null;
        continue;
      }
      if (candidate.status === 'unsicher' && candidate.uncertainPresent !== true) {
        pending = candidate;
        break;
      }
      current = candidate;
      break;
    }
    return {
      base, chain, current, pending, failed,
      reservedReplacement: pending ? childByDriver.get(Number(pending.DriverId)) || null : null,
      replacementTarget: pending || failed || base,
      replacementBlocked: base.status === 'rennsperre',
      needsReplacement: !current && !pending && base.status !== 'rennsperre',
      displayTeam: seasonTeamByDriver.get(Number(base.DriverId)) || base.team || null
    };
  });
}

function availableReplacementRows(entries) {
  const order = { auf_abruf: 0, anwesend: 1, unsicher: 2 };
  return entries.filter((entry) =>
    entry.roleType === 'reserve' && !entry.ReplacementForDriverId &&
    ['auf_abruf', 'anwesend', 'unsicher'].includes(entry.status) &&
    entry.includeInResults !== true && entry.uncertainPresent !== false
  ).sort((left, right) => order[left.status] - order[right.status] ||
    String(left.driver?.name || '').localeCompare(String(right.driver?.name || ''), 'de'));
}

module.exports = {
  berlinDate, eventDate, selectCurrentRaceEvent, buildCockpitRows, availableReplacementRows
};

