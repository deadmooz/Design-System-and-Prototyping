// Copies the shared component stylesheet into the skill so the skill folder is self-contained.
// Run after editing src/styles/components.css:  npm run skill:sync   (a test fails if they drift)
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dest = resolve(root, 'skill/design-system-prototyper/assets');
mkdirSync(dest, { recursive: true });
copyFileSync(resolve(root, 'src/styles/components.css'), resolve(dest, 'components.css'));
console.log('skill/design-system-prototyper/assets/components.css updated');
