// Minimal service worker — exists mainly to satisfy PWA installability criteria (a fetch
// handler registered), not to provide real offline support: this panel needs a live connection
// to the server to be useful, so it deliberately just passes every request straight through.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
