import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * `@testing-library/react` only registers its automatic cleanup when
 * `afterEach` is a vitest global (`test.globals: true`), which this package
 * does not set. Without it, every test's rendered tree stays in
 * `document.body`, so a later `screen` query can match nodes left over from
 * an earlier test. Run once for every component test in this package via
 * `test.setupFiles` in `vitest.config.ts`.
 */
afterEach(cleanup);
