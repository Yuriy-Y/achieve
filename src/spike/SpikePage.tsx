import { useCallback, useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { SPIKE_BUILD } from './spikeBuild';
import { readSpikeValue, writeThenRead } from './spikeDb';
import {
  checkDisplayMode,
  checkIntlStringFormatting,
  checkPersistence,
  checkServiceWorker,
  describeError,
  type ServiceWorkerInfo,
} from './spikeChecks';

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Calls registration.update(); a failure (offline, VPN off, expired GitLab session) is ignored. */
function safeUpdate(registration: ServiceWorkerRegistration | undefined): void {
  if (!registration) return;
  registration.update().catch(() => {
    // Ignored on purpose: the installed version keeps running (design: Access control and login).
  });
}

function UpdateBanner() {
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const lastCheckRef = useRef(0);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      registrationRef.current = registration;
      lastCheckRef.current = Date.now();
    },
    onRegisterError(error: unknown) {
      console.error('Service worker registration failed', error);
      setRegisterError(describeError(error));
    },
  });

  // Standalone apps rarely navigate: check for updates when the app becomes visible, at most once per hour.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastCheckRef.current < UPDATE_CHECK_INTERVAL_MS) return;
      lastCheckRef.current = Date.now();
      safeUpdate(registrationRef.current);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const checkNow = () => {
    lastCheckRef.current = Date.now();
    safeUpdate(registrationRef.current);
  };

  return (
    <>
      {needRefresh && (
        <div className="spike-banner" role="status">
          <span>A new version is available.</span>
          <div className="spike-actions">
            <button type="button" onClick={() => void updateServiceWorker(true)}>
              Update now
            </button>
            <button type="button" onClick={() => setNeedRefresh(false)}>
              Later
            </button>
          </div>
        </div>
      )}
      <section aria-labelledby="spike-update-heading">
        <h2 id="spike-update-heading">Updates</h2>
        <p>{needRefresh ? 'Update waiting.' : 'No update detected.'}</p>
        {registerError && <p className="spike-error">Registration error: {registerError}</p>}
        <button type="button" onClick={checkNow}>
          Check for update now
        </button>
      </section>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

export function SpikePage() {
  const [stored, setStored] = useState<string>('loading…');
  const [dbError, setDbError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [persist, setPersist] = useState<string>('checking…');
  const [sw, setSw] = useState<ServiceWorkerInfo | null>(null);
  const [displayMode, setDisplayMode] = useState<string>(() => checkDisplayMode());
  const [intl] = useState(() => checkIntlStringFormatting(navigator.languages));

  const refreshServiceWorker = useCallback(() => {
    void checkServiceWorker().then(setSw);
  }, []);

  useEffect(() => {
    readSpikeValue()
      .then((value) => setStored(value ?? '(nothing stored yet)'))
      .catch((error: unknown) => {
        setStored('(read failed)');
        setDbError(describeError(error));
      });
    void checkPersistence().then(setPersist);
    refreshServiceWorker();

    const media = window.matchMedia?.('(display-mode: standalone)');
    const onModeChange = () => setDisplayMode(checkDisplayMode());
    media?.addEventListener('change', onModeChange);

    // Registration happens asynchronously; refresh the SW info when control changes.
    navigator.serviceWorker?.addEventListener('controllerchange', refreshServiceWorker);
    return () => {
      media?.removeEventListener('change', onModeChange);
      navigator.serviceWorker?.removeEventListener('controllerchange', refreshServiceWorker);
    };
  }, [refreshServiceWorker]);

  const writeAndRead = async () => {
    setBusy(true);
    setDbError(null);
    try {
      const value = await writeThenRead(new Date().toISOString());
      setStored(value ?? '(read back nothing)');
    } catch (error) {
      setDbError(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="spike">
      <h1>Achievement Tracker – deploy spike</h1>

      <section aria-labelledby="spike-build-heading">
        <h2 id="spike-build-heading">Build</h2>
        <dl>
          <Row label="Build id" value={__BUILD_ID__} />
          <Row label="Spike build" value={String(SPIKE_BUILD)} />
          <Row label="Base URL" value={import.meta.env.BASE_URL} />
          <Row label="Page URL" value={location.href} />
        </dl>
      </section>

      <section aria-labelledby="spike-db-heading">
        <h2 id="spike-db-heading">IndexedDB</h2>
        <p>
          Stored value: <output>{stored}</output>
        </p>
        {dbError && <p className="spike-error">IndexedDB error: {dbError}</p>}
        <button type="button" onClick={() => void writeAndRead()} disabled={busy}>
          Write timestamp and read back
        </button>
      </section>

      <UpdateBanner />

      <section aria-labelledby="spike-env-heading">
        <h2 id="spike-env-heading">Environment checks</h2>
        <dl>
          <Row label="Display mode" value={displayMode} />
          <Row label="Persistent storage" value={persist} />
          <Row label="Intl format('1234567890123.456') en-US" value={intl.sample} />
          <Row label="Intl format('12345678901234567.891') en-US" value={intl.precisionSample} />
          <Row label="Exact string formatting" value={intl.exactStrings ? 'yes' : 'no (Number() fallback needed)'} />
          <Row label={`Device locale (${intl.locales})`} value={intl.deviceSample} />
          <Row label="Service worker supported" value={sw ? String(sw.supported) : 'checking…'} />
          <Row label="SW scope" value={sw?.scope ?? 'not registered'} />
          <Row label="SW script" value={sw?.scriptUrl ?? '-'} />
          <Row
            label="SW state"
            value={sw ? `active: ${sw.active}, waiting: ${sw.waiting}, installing: ${sw.installing}` : '-'}
          />
          <Row label="Page controlled by SW" value={sw ? String(sw.controlled) : '-'} />
        </dl>
        <button type="button" onClick={refreshServiceWorker}>
          Refresh service worker info
        </button>
      </section>
    </main>
  );
}
