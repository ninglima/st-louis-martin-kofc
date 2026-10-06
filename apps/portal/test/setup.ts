import { vi } from 'vitest';

// Auth helpers import `server-only` so Next rejects a client bundle.
// Vitest runs in Node; stub the package so those modules can load.
vi.mock('server-only', () => ({}));
