// Web Storage for component tests, on every supported Node version.
//
// Vitest's jsdom environment copies jsdom's window properties onto the global
// object but leaves alone any name Node already defines. Node 25 and later
// define `localStorage` and `sessionStorage` themselves, and without
// `--localstorage-file` Node's `localStorage` is undefined. So on those
// versions a component that reads `localStorage` throws under test although
// it works in every browser. Point both names at jsdom's storage, which is
// what the tests get on Node 20 and 22 already.
const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
if (dom) {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, name, { configurable: true, get: () => dom.window[name] });
  }
}
