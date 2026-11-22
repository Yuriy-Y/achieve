// Global Jest setup: DOM matchers, in-memory IndexedDB, and fast-check defaults.
import '@testing-library/jest-dom';
import { deserialize, serialize } from 'v8';

// jsdom lacks structuredClone, which fake-indexeddb needs to copy stored values.
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = <T>(value: T): T => deserialize(serialize(value)) as T;
}

import 'fake-indexeddb/auto';
import fc from 'fast-check';

// Every property test runs at least 100 iterations (design: Testing Strategy).
fc.configureGlobal({ numRuns: 100 });
