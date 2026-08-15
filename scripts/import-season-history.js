const fs = require('fs/promises');
const path = require('path');
const { promisify } = require('util');
const { gzip } = require('zlib');
const { parseHistoryText } = require('../services/seasonHistory');

const gzipAsync = promisify(gzip);

async function run() {
  const [slug, sourcePath] = process.argv.slice(2);
  if (!slug || !sourcePath || !/^[a-z0-9-]+$/.test(slug)) {
    throw new Error('Aufruf: npm run import:history -- <liga-slug> <export.csv|export.md>');
  }

  const absoluteSource = path.resolve(sourcePath);
  const source = await fs.readFile(absoluteSource, 'utf8');
  const format = path.extname(absoluteSource).toLowerCase() === '.md' || source.trimStart().startsWith('|')
    ? 'markdown'
    : 'csv';
  const seasons = parseHistoryText(source, format);
  if (!seasons.length) throw new Error('Im Export wurden keine Saisonblöcke erkannt.');

  const outputDirectory = path.join(__dirname, '..', 'data', 'season-history');
  const outputPath = path.join(outputDirectory, `${slug}.json.gz`);
  await fs.mkdir(outputDirectory, { recursive: true });
  const compressed = await gzipAsync(Buffer.from(JSON.stringify({ seasons })), { level: 9 });
  await fs.writeFile(outputPath, compressed);
  console.log(`${seasons.length} Saisons wurden nach ${outputPath} importiert.`);
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
