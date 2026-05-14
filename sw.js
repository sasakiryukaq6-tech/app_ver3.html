// ★ バージョン名を変更してキャッシュを更新させる
const CACHE_NAME = 'comm-tool-cache-v53';

// ★ 外部のライブラリやフォントもすべてキャッシュのリストに加える
const urlsToCache = [
    './',
    './index.html',
    './css/style.css',
    './js/app.js',
    './js/webrtc.js',
    './js/audio-processor.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    // 外部CDNライブラリ群
    'https://unpkg.com/peerjs@1.4.7/dist/peerjs.min.js',
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs',
    'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js',
    'https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&display=swap'
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

// ★ 修正: Stale-While-Revalidate 戦略から「Network First（最新優先）戦略」に変更
// オンラインなら必ず最新のファイルをネットワークから取得し、圏外の時だけキャッシュを使います
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).then((networkResponse) => {
            // ネットワーク通信成功時：最新のファイルをキャッシュに保存してから画面に返す
            return caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse.clone());
                return networkResponse;
            });
        }).catch(() => {
            // オフライン（圏外）またはエラー時：保存しておいたキャッシュを返す
            return caches.match(event.request);
        })
    );
});