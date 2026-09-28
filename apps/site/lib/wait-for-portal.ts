export async function waitForPortal({
  fetchVersion,
  sleep,
  now,
  intervalMs = 1000,
  timeoutMs = 30000,
}: {
  fetchVersion: () => Promise<number>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<'ready' | 'timeout'> {
  const deadline = now() + timeoutMs;

  while (now() < deadline) {
    try {
      if ((await fetchVersion()) === 200) return 'ready';
    } catch {
      // The container is still starting; keep polling.
    }

    await sleep(intervalMs);
  }

  return 'timeout';
}
