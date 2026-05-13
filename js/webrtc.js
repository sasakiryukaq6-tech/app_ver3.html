let peer = null;
let connections = [];
let isRoomHost = true; // デフォルトはホスト
let activeRoomId = null; // ★ 追加: 現在参加している「大元のホスト」のIDを記憶する変数

function initWebRTC() {
    // ★ 修正: Apple端末(Safari等)の厳しいネットワーク制限を越えるため、
    // Googleの公共STUNサーバーを明示的に指定して通信の安定性を高める
    peer = new Peer({
        debug: 3, 
        config: {
            'iceServers': [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                // ★ 追加: 直接通信がブロックされた場合の「最終兵器」として、
                // データを強制的に中継するTURNサーバーを指定する
                {
                    urls: 'turn:openrelay.metered.ca:80',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            ]
        }
    });
    const urlParams = new URLSearchParams(window.location.search);
    const inviteId = urlParams.get('room');

    peer.on('open', (id) => {
        document.getElementById('myPeerId').textContent = id;
        activeRoomId = inviteId ? inviteId : id; 
        setupInviteButtons(); 
        
        if (inviteId && inviteId !== id) {
            isRoomHost = false; 
            document.getElementById('targetPeerId').value = inviteId;
            
            // ★ 追加: Safari等で接続が遅い場合に備え、画面にステータスを表示してユーザーを安心させる
            const syncStatus = document.getElementById('syncStatus');
            syncStatus.innerHTML = `<span style="color:#0d6efd; font-weight:bold;">招待を検知しました。<br>ホストに自動接続しています...</span>`;
            
            console.log("招待IDを検知: 接続を開始します...", inviteId);
            // ★ 変更: Safariの準備遅れに対応するため、待機時間を1秒から2秒(2000)に延長
            setTimeout(() => connectToPeer(inviteId), 2000);
        }
    });

    // ホスト側：接続を待機
    peer.on('connection', (conn) => {
        console.log("接続要求を受信しました");
        setupConnection(conn);
    });

    peer.on('error', (err) => {
        console.error("PeerJS Error:", err.type, err);
        let errorMsg = "通信エラーが発生しました．";
        if (err.type === 'peer-unavailable') errorMsg = "相手がオフラインか、IDが間違っています．";
        if (err.type === 'network') errorMsg = "ネットワークが不安定です．";
        alert(errorMsg);
        
        // エラーのアイコン（警告マーク）
        const warnIcon = `<svg class="ui-icon" style="color:#f44336;" viewBox="0 -960 960 960"><path d="M440-280h80v-80h-80v80Zm0-160h80v-200h-80v200Zm40 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>`;
        document.getElementById('syncStatus').innerHTML = `${warnIcon} エラー`;
    });

    // ★ 追加1: サーバーから一時的に切断された場合の自動復旧ロジック
    peer.on('disconnected', () => {
        console.warn("シグナリングサーバーから切断されました．再接続します．．．");
        if (!peer.destroyed) {
            // サーバーの負荷（連続アクセス制限）を避けるため、1秒待ってから再接続
            setTimeout(() => peer.reconnect(), 1000);
        }
    });

    // ★ 追加2: タブを閉じる・リロードする瞬間に、通信を完全に破棄して「ゾンビ接続」を防ぐ
    window.addEventListener('beforeunload', () => {
        // 繋がっている相手との通信をすべて明示的に切断
        connections.forEach(conn => { if (conn.open) conn.close(); });
        // シグナリングサーバーに完全切断を通知
        if (peer && !peer.destroyed) peer.destroy(); 
    });

    // 手動接続ボタンの処理
    document.getElementById('connectBtn').onclick = () => {
        const targetId = document.getElementById('targetPeerId').value.trim();
        if (targetId) {
            // ★ 追加: 手動で繋ぎに行った場合も、その相手をホストとしてURLを更新する
            activeRoomId = targetId; 
            setupInviteButtons(); 
            // ★追加: ボタンを押した瞬間に文字を切り替える
            document.getElementById('syncStatus').innerHTML = `<span style="color:#0d6efd;">接続を試みています...</span>`;
            connectToPeer(targetId);
        }
    };
} // <-- initWebRTC関数の終わり

let connectionAttemptTimer = null; // ★追加: タイムアウト管理用

// ★ 修正: ゲスト側から接続を開始する関数（Safariのネゴシエーション失敗対策版）
function connectToPeer(targetId) {
    console.log(targetId + " に接続を試みています...");
    isRoomHost = false; 
    
    // UIを更新
    document.getElementById('syncStatus').innerHTML = `<span style="color:#0d6efd;">接続を試みています...</span>`;
    
    // 既存のタイマーがあればリセット
    if (connectionAttemptTimer) clearTimeout(connectionAttemptTimer);
    
    // 10秒待ってもダメならタイムアウトさせる
    connectionAttemptTimer = setTimeout(() => {
        if (connections.length === 0) {
            const warnIcon = `<svg class="ui-icon" style="color:#f44336;" viewBox="0 -960 960 960"><path d="M440-280h80v-80h-80v80Zm0-160h80v-200h-80v200Zm40 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>`;
            document.getElementById('syncStatus').innerHTML = `${warnIcon} 接続タイムアウト<br><span style="font-size:0.85em; color:#666;">※Safariの制限か電波が原因です。もう一度「接続する」を押してください。</span>`;
        }
    }, 10000);

    // ★ 変更: Safariでエラーを引き起こす { reliable: true } を削除し、シンプルに接続する
    const conn = peer.connect(targetId);
    
    setupConnection(conn);
}

// ★ 修正: 引数 id を削除する
function setupInviteButtons() {
    // ★ 修正: 自分のIDではなく、記憶しておいた「ホストのID」をURLにする
    const inviteUrl = window.location.origin + window.location.pathname + '?room=' + activeRoomId;
    
    const copyBtn = document.getElementById('copyUrlBtn');
    const qrBtn = document.getElementById('showQrBtn');
    
    // ... 以下は既存のコードそのまま ...    
    copyBtn.style.display = 'inline-block';
    qrBtn.style.display = 'inline-block';

    copyBtn.onclick = () => {
        navigator.clipboard.writeText(inviteUrl).then(() => alert("招待URLをコピーしました．"));
    };

    // スマホアイコンの定義
    const phoneIcon = `<svg class="ui-icon" viewBox="0 -960 960 960"><path d="M280-40q-33 0-56.5-23.5T200-120v-720q0-33 23.5-56.5T280-920h400q33 0 56.5 23.5T760-840v720q0 33-23.5 56.5T680-40H280Zm0-200h400v-480H280v480Zm0 120h400v-40H280v40Zm0-680h400v-40H280v40Zm200 620q17 0 28.5-11.5T520-120q0-17-11.5-28.5T480-160q-17 0-28.5 11.5T440-120q0 17 11.5 28.5T480-80ZM280-840v40-40Zm0 760v-40 40Z"/></svg>`;

    qrBtn.onclick = () => {
        const container = document.getElementById('qrContainer');
        if (container.style.display === 'block') {
            container.style.display = 'none';
            qrBtn.innerHTML = `${phoneIcon} QR表示`; // textContent を innerHTML に変更
        } else {
            container.style.display = 'block';
            qrBtn.innerHTML = `${phoneIcon} 閉じる`; // textContent を innerHTML に変更
            document.getElementById('qrcode').innerHTML = '';
            new QRCode(document.getElementById("qrcode"), { text: inviteUrl, width: 150, height: 150 });
        }
    };
}

function setupConnection(conn) {
    conn.on('open', () => {
        // ★追加: 接続に成功したらタイムアウトのタイマーを止める
        if (connectionAttemptTimer) clearTimeout(connectionAttemptTimer);

        if (!connections.includes(conn)) connections.push(conn);
        updateSyncStatusUI();
        
        // ★ 修正: 接続が完全に安定するまで1秒待ってから履歴をやり取りする
        setTimeout(() => {
            if (isRoomHost) {
                console.log("ホストとして履歴を送信します:", window.chatMessages.length, "件");
                conn.send({ 
                    type: 'history', 
                    messages: window.chatMessages, 
                    isHost: true 
                });
            } else {
                console.log("ゲストとして履歴を要求します...");
                conn.send({ type: 'request_history' });
            }
        }, 1000);
    });

    conn.on('data', (data) => {
        const myCurrentName = getMyName() === '名無し' ? 'あなた' : getMyName();

        if (data.type === 'text') {
            // 受信したメッセージは「remote」として扱う
            addMessage(data.name || '相手', data.text.trim(), 'remote');
            
            // ★ ここを以下の「ゾンビ接続対策版」に書き換えます
            if (isRoomHost) {
                connections = connections.filter(c => {
                    if (c === conn) return true; // 送信元は維持
                    if (!c.open) return false;   // 既に閉じているものはリストから除外
                    try { 
                        c.send(data); 
                        return true; 
                    } catch (e) { 
                        console.warn("送信失敗、ゾンビ接続を切断:", e);
                        c.close(); 
                        return false; // エラーが起きた接続はリストから削除
                    }
                });
            }
        }
        else if (data.type === 'history') {
            if (data.isHost) {
                // ホストからの履歴同期時：自分の名前以外のメッセージはすべて remote に書き換える
                chatMessages = (data.messages || []).map(m => {
                    if (m.name !== myCurrentName) {
                        return { name: m.name, text: m.text, type: 'remote' };
                    }
                    return m; 
                });
                renderAllMessages();
                saveMessages();
            }
        }
        else if (data.type === 'request_history') {
            if (isRoomHost) {
                conn.send({ type: 'history', messages: window.chatMessages, isHost: true });
            }
        } 
        else if (data.type === 'typing') {
            if (window.handleRemoteTyping) {
                window.handleRemoteTyping(data);
            }
            // ★ 修正: タイピング状態の中継も、ホストの時だけ行うように安全策を追記
            if (isRoomHost) {
                connections.forEach(c => { if (c !== conn && c.open) c.send(data); });
            }
        }
    });

    conn.on('close', () => {
        connections = connections.filter(c => c !== conn);
        updateSyncStatusUI();
    });

    // ★追加: 接続ごとの個別エラーをキャッチし、永遠に固まるのを防ぐ
    conn.on('error', (err) => {
        console.warn("Connection Error:", err);
        if (connectionAttemptTimer) clearTimeout(connectionAttemptTimer);
        connections = connections.filter(c => c !== conn);
        updateSyncStatusUI();
        document.getElementById('syncStatus').innerHTML = `<span style="color:#f44336;">接続が切断されました（エラー）</span>`;
    });
}

function updateSyncStatusUI() {
    const count = connections.length;
    // チェックマークのアイコン
    const checkIcon = `<svg class="ui-icon" style="color:#4caf50;" viewBox="0 -960 960 960"><path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm-56-252 226-226-34-34-192 192-86-86-34 34 120 120Z"/></svg>`;
    
    // textContent を innerHTML に変更して描画
    const statusText = count > 0 ? `${checkIcon} 接続完了 (${count}台)` : `現在オフラインです`;
    document.getElementById('syncStatus').innerHTML = statusText;
    document.getElementById('syncStatusSummary').innerHTML = count > 0 ? `(${checkIcon} ${count}台)` : `(オフライン)`;
}

// app.jsから呼ばれる関数（ゾンビ接続対策版）
function broadcastData(text) {
    const name = window.getMyName ? window.getMyName() : '名無し';
    connections = connections.filter(c => {
        if (!c.open) return false;
        try { 
            c.send({ type: 'text', text, name }); 
            return true; 
        } catch (e) { 
            c.close(); return false; 
        }
    });
}

function broadcastTypingState(isTyping) {
    const name = window.getMyName ? window.getMyName() : '名無し';
    const currentName = name === '名無し' ? '相手' : name;
    connections.forEach(conn => { 
        if (conn.open) {
            try { conn.send({ type: 'typing', name: currentName, isTyping }); } catch (e) {} 
        }
    });
}