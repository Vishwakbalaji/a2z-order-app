// Tool (skipped unless OUT is set): OUT=/path/names.txt npx vitest run tests/tool-names.test.ts — every catalog line → standardized name
import fs from 'node:fs';
import { it } from 'vitest';
import { A2Z_CATALOG_ROWS } from '../src/data/a2zCatalog';
import { standardName } from '../src/lib/naming';

it.skipIf(!process.env.OUT)('names', () => {
  const lines = A2Z_CATALOG_ROWS.map(([, group, desc]) => `${desc.padEnd(38)} → ${standardName(desc, group).full}`);
  fs.writeFileSync(process.env.OUT!, lines.join('\n'));
});
