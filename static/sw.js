/* Service worker — SOCOM Astreinte
   Stratégie :
   - shell statique (CSS/JS/icônes/pages) : cache-first, mis à jour en arrière-plan
   - API (/api/...) : réseau uniquement (données temps réel, jamais servies périmées)
   - navigation hors-ligne : repli sur la page /offline en cache
*/
const CACHE = "astreinte-v1";
const SHELL = [
  "/static/style.css",
  "/static/app.js",
  "/static/icone-192.png",
  "/static/icone-512.png",
  "/static/apple-touch-icon.png",
  "/offline",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((cles) =>
      Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // API : toujours le réseau, jamais de cache (données live)
  if (url.pathname.startsWith("/api/")) {
    return; // laisse le navigateur gérer ; l'app affiche l'état précédent en mémoire
  }

  // Ressources statiques : cache d'abord, mise à jour en tâche de fond
  if (url.pathname.startsWith("/static/")) {
    e.respondWith(
      caches.match(req).then((rep) => {
        const reseau = fetch(req).then((r) => {
          caches.open(CACHE).then((c) => c.put(req, r.clone()));
          return r;
        }).catch(() => rep);
        return rep || reseau;
      })
    );
    return;
  }

  // Navigation (pages) : réseau d'abord, repli sur /offline si hors-ligne
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(() => caches.match("/offline"))
    );
    return;
  }
});
