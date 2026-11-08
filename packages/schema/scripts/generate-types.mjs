// Generates TypeScript types from pipeline.schema.json.
// Usage: pnpm --filter @noesis/schema generate
import fs from 'node:fs';
import path from 'node:path';
import { compile } from 'json-schema-to-typescript';

const root = path.resolve(import.meta.dirname, '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'pipeline.schema.json'), 'utf8'));

const ts = await compile(schema, 'Pipeline', {
  bannerComment:
    '/* Generated from pipeline.schema.json. Do not edit by hand: run `pnpm --filter @noesis/schema generate`. */',
  additionalProperties: false,
  style: { singleQuote: true },
});

const out = path.join(root, 'src', 'generated', 'pipeline.ts');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, ts);
console.log('wrote', path.relative(process.cwd(), out));
