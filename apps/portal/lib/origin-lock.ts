/**
 * Cloud Run's *.run.app URL is public, so the portal only answers requests
 * that came through the Cloudflare router, which adds X-Origin-Auth. A
 * production process without the secret refuses everything rather than
 * silently serving unlocked.
 *
 * The comparison is constant-time over the secret's length, so response
 * timing does not reveal how much of a guess was right.
 */
export function checkOriginAuth(
  presented: string | null,
  secret: string | undefined,
  nodeEnv: string | undefined,
): 'allow' | 'deny' | 'misconfigured' {
  if (!secret) {
    return nodeEnv === 'production' ? 'misconfigured' : 'allow';
  }

  if (presented === null || presented.length !== secret.length) {
    return 'deny';
  }

  let difference = 0;

  for (let index = 0; index < secret.length; index++) {
    difference |= presented.charCodeAt(index) ^ secret.charCodeAt(index);
  }

  return difference === 0 ? 'allow' : 'deny';
}
