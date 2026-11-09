// Informational checks for the Deploy spike assumptions (design: Deploy spike).

export interface IntlCheck {
  locales: string;
  /** format('1234567890123.456') in en-US: the input requested by the spike task. */
  sample: string;
  /** A value beyond double precision: only an exact string-decimal formatter keeps every digit. */
  precisionSample: string;
  /** true when the engine formats string input as an exact decimal (Intl.NumberFormat v3). */
  exactStrings: boolean;
  /** The task sample formatted in the Device_Locale, for a visual check. */
  deviceSample: string;
}

const SAMPLE = '1234567890123.456';
const PRECISION_SAMPLE = '12345678901234567.891';
const PRECISION_EXPECTED = '12,345,678,901,234,567.891';

// TypeScript's lib types `format` as number | bigint; ES2023 engines also accept decimal strings.
type StringFormat = (value: string) => string;

export function checkIntlStringFormatting(locales: readonly string[] | undefined): IntlCheck {
  const enUs = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
  const formatEnUs = enUs.format as unknown as StringFormat;
  const device = new Intl.NumberFormat(locales as string[] | undefined, { maximumFractionDigits: 3 });
  const formatDevice = device.format as unknown as StringFormat;
  const precisionSample = formatEnUs(PRECISION_SAMPLE);
  return {
    locales: device.resolvedOptions().locale,
    sample: formatEnUs(SAMPLE),
    precisionSample,
    exactStrings: precisionSample === PRECISION_EXPECTED,
    deviceSample: formatDevice(SAMPLE),
  };
}

export type PersistOutcome = 'granted (already persisted)' | 'granted' | 'denied' | 'unsupported';

export async function checkPersistence(nav: Navigator = navigator): Promise<PersistOutcome | string> {
  const storage = nav.storage as StorageManager | undefined;
  if (!storage?.persist || !storage.persisted) return 'unsupported';
  try {
    if (await storage.persisted()) return 'granted (already persisted)';
    return (await storage.persist()) ? 'granted' : 'denied';
  } catch (error) {
    return `error: ${describeError(error)}`;
  }
}

export function checkDisplayMode(win: Window = window): string {
  const standalone = win.matchMedia?.('(display-mode: standalone)').matches ?? false;
  // iOS Safari exposes navigator.standalone for home-screen launches.
  const iosStandalone = (win.navigator as Navigator & { standalone?: boolean }).standalone;
  const parts = [standalone ? 'standalone' : 'browser'];
  if (iosStandalone !== undefined) parts.push(`navigator.standalone=${String(iosStandalone)}`);
  return parts.join(', ');
}

export interface ServiceWorkerInfo {
  supported: boolean;
  scope: string | null;
  scriptUrl: string | null;
  active: string;
  waiting: string;
  installing: string;
  controlled: boolean;
}

export async function checkServiceWorker(nav: Navigator = navigator): Promise<ServiceWorkerInfo> {
  if (!('serviceWorker' in nav)) {
    return { supported: false, scope: null, scriptUrl: null, active: '-', waiting: '-', installing: '-', controlled: false };
  }
  const registration = await nav.serviceWorker.getRegistration().catch(() => undefined);
  const state = (worker: ServiceWorker | null | undefined) => worker?.state ?? 'none';
  return {
    supported: true,
    scope: registration?.scope ?? null,
    scriptUrl: registration?.active?.scriptURL ?? registration?.installing?.scriptURL ?? null,
    active: state(registration?.active),
    waiting: state(registration?.waiting),
    installing: state(registration?.installing),
    controlled: nav.serviceWorker.controller !== null,
  };
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
