// Minimal Service Worker for PWA install prompt
self.addEventListener('fetch', function(event) {
    event.respondWith(fetch(event.request));
});
