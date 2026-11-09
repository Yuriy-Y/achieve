/**
 * Computes the Vite `base` path for the GitLab Pages deployment.
 *
 * Order of precedence:
 * 1. `BASE_PATH` (manual override), normalised to end with "/".
 * 2. The URL path of `CI_PAGES_URL` (path-style or unique-domain Pages), with a trailing "/".
 * 3. "/" (local development, unique-domain Pages without `CI_PAGES_URL`).
 */
export function pagesBasePath(env: Record<string, string | undefined>): string {
  if (env.BASE_PATH) {
    return env.BASE_PATH.endsWith('/') ? env.BASE_PATH : `${env.BASE_PATH}/`;
  }
  if (!env.CI_PAGES_URL) {
    return '/';
  }
  const path = new URL(env.CI_PAGES_URL).pathname;
  return path.endsWith('/') ? path : `${path}/`;
}
