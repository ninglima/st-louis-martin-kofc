import { cacheLife } from 'next/cache';

// Set by the deploy workflow (`--set-env-vars GIT_HASH=…`) and by compose.yaml.
const KNOWN_GIT_ENV_VARS = ['GIT_HASH'];

/**
 * Cached for as long as the build is live. `export const dynamic =
 * 'force-static'` is rejected under Cache Components; `use cache` with the `max`
 * profile is the equivalent, and the git hash cannot change without a new build.
 *
 * The cache wraps the hash rather than the handler: a `Response` is a class
 * instance, and values crossing a `use cache` boundary have to be serializable.
 *
 * Because this route is prerendered (confirmed by the build output listing
 * `/version` as ○ static), `getGitHash()` runs once at `next build` time, not
 * per request. `GIT_HASH` must therefore be set as a build-time `ENV`/`ARG`
 * in the Dockerfile; setting it only at `docker run` time has no effect.
 */
async function getCachedGitHash() {
  'use cache';

  cacheLife('max');

  return getGitHash();
}

export const GET = async () => {
  const currentGitHash = await getCachedGitHash();

  return new Response(currentGitHash, {
    headers: {
      'content-type': 'text/plain',
    },
  });
};

async function getGitHash() {
  for (const envVar of KNOWN_GIT_ENV_VARS) {
    if (process.env[envVar]) {
      return process.env[envVar];
    }
  }

  try {
    return await getHashFromProcess();
  } catch (error) {
    console.warn(
      `[WARN] Could not find git hash: ${JSON.stringify(error)}. You may want to provide a fallback.`,
    );

    return '';
  }
}

async function getHashFromProcess() {
  // avoid calling a Node.js command in the edge runtime
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NODE_ENV !== 'development') {
      console.warn(
        `[WARN] Could not find git hash in environment variables. Falling back to git command. Supply a known git hash environment variable to avoid this warning.`,
      );
    }

    const { execSync } = await import('child_process');

    return execSync('git log --pretty=format:"%h" -n1').toString().trim();
  }

  console.log(
    `[INFO] Could not find git hash in environment variables. Falling back to git command. Supply a known git hash environment variable to avoid this warning.`,
  );
}
