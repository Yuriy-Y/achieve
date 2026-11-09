// Global Jest setup: DOM matchers, in-memory IndexedDB, and fast-check defaults.
import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';
import fc from 'fast-check';

// Every property test runs at least 100 iterations (design: Testing Strategy).
fc.configureGlobal({ numRuns: 100 });
