import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `Button` wraps Base UI's button, which renders a native button with
 * `type="button"` unless told otherwise. So a `<Button>` meant to submit a
 * form must say `type="submit"`, or clicking it silently does nothing: no
 * request, no error. This scans every component that handles a form submit
 * and fails if it has a `<Button>` but no explicit `type="submit"` anywhere.
 */
const REPO_ROOT = join(__dirname, '../../../..');
const ROOTS = ['packages', 'apps'].map((dir) => join(REPO_ROOT, dir));
const SKIP = new Set(['node_modules', '.next', '.turbo', 'dist', 'out']);

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];

    const path = join(dir, name);

    if (statSync(path).isDirectory()) return tsxFiles(path);

    return path.endsWith('.tsx') && !path.endsWith('.test.tsx') ? [path] : [];
  });
}

describe('form submit buttons', () => {
  it('every form component with a <Button> gives one type="submit"', () => {
    const offenders = ROOTS.flatMap(tsxFiles)
      .filter((path) => {
        const source = readFileSync(path, 'utf8');

        return (
          /<form\b[^>]*\bonSubmit=/s.test(source) &&
          /<Button\b/.test(source) &&
          !/type=["{']+submit/.test(source)
        );
      })
      .map((path) => relative(REPO_ROOT, path));

    expect(offenders).toEqual([]);
  });
});
