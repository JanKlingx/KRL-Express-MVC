// Friend codes are identifiers: never convert them to numbers (leading zeros/precision).
function steamCode(value) {
  if (value != null && !['string', 'number'].includes(typeof value)) throw new Error('Bitte einen einzelnen Steam-Freundescode eingeben.');
  const code = String(value ?? '').normalize('NFKC').replace(/\s/g, '');
  if (code && !/^[0-9]{1,20}$/.test(code)) throw new Error('Der Steam-Freundescode darf nur 1 bis 20 Ziffern enthalten.');
  return code;
}
function platformLogos(platforms) {
  const normalized = name => String(name || '').trim().toLowerCase().replace(/[ _-]+/g, ' ');
  const aliases = { Steam: ['steam', 'steam pc', 'pc steam'], EA: ['ea', 'ea app', 'ea play', 'origin', 'electronic arts'] };
  return Object.fromEntries(Object.entries(aliases).map(([label, names]) => [label,
    names.map(name => platforms.find(platform => normalized(platform.name) === name && platform.logoPath)?.logoPath).find(Boolean) || null
  ]));
}
module.exports = { steamCode, platformLogos };
