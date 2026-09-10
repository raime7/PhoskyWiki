// Isolated subprocess seam. Production entrypoint never accepts local receipts.
import { readFile } from 'node:fs/promises';
import { deployRelease } from '../../scripts/release.mjs';
const { config, receipt, request, credentials } = JSON.parse(await readFile(process.argv[2], 'utf8'));
try {
  const record = await deployRelease(config, receipt, request, credentials);
  console.log(JSON.stringify(record));
  if (record.result !== 'succeeded') process.exitCode = 1;
} catch (error) { console.log(JSON.stringify({ error: error.message })); process.exitCode = 1; }
