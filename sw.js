// ★ 1. バージョン名を変更する（v1 から v2 などに変えることでアップデートを検知させます）
const CACHE_NAME = 'comm-tool-cache-v16';

// ★ 2. キャッシュリストから settings.html と settings.js を削除
const urlsToCache = [
    './',
    './index.html',
    './css/style.css',
    './js/app.js',
    './js/webrtc.js',
    './js/audio-processor.js',
    './manifest.json'
];

self.addEventListener('install', (event) => {
    // ★ 3. 新しいバージョンをインストールしたら、すぐに待機状態をスキップして起動させる
    self.skipWaiting();
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(urlsToCache))
    );
});

// ★ 4. 【超重要】アクティベート時に「古いバージョンの金庫」をすべて爆破（削除）する
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    // 現在の名前（v2）以外のキャッシュを見つけたら削除
                    if (cacheName !== CACHE_NAME) {
                        console.log('古いキャッシュを自動削除しました:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim()) // すぐに新しいService Workerにページを管理させる
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                return response || fetch(event.request);
            })
    );
});