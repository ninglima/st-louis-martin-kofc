/**
 * Error codes that mean "the dues migrations have not reached this database
 * yet", as opposed to a real failure:
 *
 * - `42883` undefined_function and `42P01` undefined_table: raised by
 *   Postgres itself, e.g. by a function that exists but references a dues
 *   object that does not.
 * - `PGRST202`: PostgREST cannot find the RPC (`my_dues_summary`, ...) in its
 *   schema cache.
 * - `PGRST205`: PostgREST cannot find the TABLE (`dues_levels`) in its schema
 *   cache. This is what a missing table actually returns through
 *   `.from('dues_levels')` on the PostgREST in this stack, not `42P01`, so
 *   without it `DuesService.levels()` would still throw during the race.
 */
export const MISSING_DUES_SCHEMA_CODES: readonly string[] = [
  '42883',
  '42P01',
  'PGRST202',
  'PGRST205',
];

export function isMissingDuesSchemaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  const { code } = error as { code: unknown };

  return typeof code === 'string' && MISSING_DUES_SCHEMA_CODES.includes(code);
}

export type DuesRead<T> = { deployed: true; value: T } | { deployed: false };

/**
 * Runs a dues read, and reports "not deployed" instead of throwing when the
 * dues functions or tables do not exist yet.
 *
 * Why: the Supabase integration applies migrations in parallel with the
 * portal deploy, and nothing orders the two (hosting spec: "the running
 * portal must work against both the old and the new schema"). If the new
 * portal goes live first, every page that reads dues must still render
 * without them -- no dues card, no dues checkout option -- rather than send
 * every member to the error boundary. Any other error is re-thrown.
 */
export async function readDuesIfDeployed<T>(
  read: () => Promise<T>,
): Promise<DuesRead<T>> {
  try {
    return { deployed: true, value: await read() };
  } catch (error) {
    if (!isMissingDuesSchemaError(error)) {
      throw error;
    }

    console.warn(
      'Dues schema not found; rendering without dues. Apply the dues migrations.',
      { code: (error as { code: string }).code },
    );

    return { deployed: false };
  }
}
