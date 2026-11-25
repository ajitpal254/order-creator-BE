/**
 * Regenerate openapi.json at the repo root from the Zod schemas.
 * Usage: node scripts/generate-openapi.js
 */
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildOpenApiSpec } from '../src/utils/openapi.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'openapi.json');
writeFileSync(out, `${JSON.stringify(buildOpenApiSpec(), null, 2)}\n`);
console.log(`Wrote ${out}`);
