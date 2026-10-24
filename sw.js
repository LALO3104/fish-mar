// sw.js — permite instalar FishMar como app y abrirla aunque falle el internet.
// Siempre intenta primero la versión más nueva (red) y solo si no hay
// conexión usa la copia guardada. Las llamadas a Supabase no se guardan.

const CACHE = "fishmar-v1";
const ARCHIVOS = [
  "/admin.html",
  "/mesero.html",
  "/repartidor.html",
  "/dashboard.html",
  "/css/styles.css",
  "/js/supabase.js",
  "/js/utils.js",
  "/js/pwa.js",
  "/js/admin.js",
  "/js/mesero.js",
  "/js/repartidor.js",
  "/js/dashboard.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  // Si no se pueden guardar copias, la app igual se instala y funciona con internet
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARCHIVOS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .catch(() => {})
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Solo archivos propios (no Supabase, ni fuentes, ni mapas)
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copia)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((guardado) => guardado || (req.mode === "navigate" ? caches.match("/admin.html") : undefined))
        .then((r) => r || Response.error()))
  );
});
