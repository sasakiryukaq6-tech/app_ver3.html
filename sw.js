// ★ バージョン名を変更してキャッシュを更新させる
const CACHE_NAME = 'comm-tool-cache-v27';

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
    'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js',
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

// ★ 修正: Stale-While-Revalidate 戦略による完全なオフライン対応と自動アップデートの両立
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            // 裏側でネットワークから最新版を取得し、キャッシュを上書きする処理
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                caches.open(CACHE_NAME).then((cache) => {
                    // 次回アクセスのために最新版を保存しておく
                    cache.put(event.request, networkResponse.clone());
                });
                return networkResponse;
            }).catch(() => {
                // オフライン時は何もしない（エラーを出さない）
            });

            // キャッシュがあれば一瞬で画面に表示し、なければネットワーク取得を待つ
            return cachedResponse || fetchPromise;
        })
    );
});