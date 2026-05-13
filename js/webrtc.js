let peer = null;
let connections = [];
let isRoomHost = true; // デフォルトはホスト

function initWebRTC() {
    // ★ 修正: Apple端末(Safari等)の厳しいネットワーク制限を越えるため、
    // Googleの公共STUNサーバーを明示的に指定して通信の安定性を高める
    peer = new Peer({
        config: {
            'iceServers': [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        }
    });
    const urlParams = new URLSearchParams(window.location.search);
    const inviteId = urlParams.get('room');

    peer.on('open', (id) => {
        document.getElementById('myPeerId').textContent = id;
        setupInviteButtons(id);
        
        // ★ 変更: ボタンをクリックするのではなく、直接接続関数を呼ぶ
        if (inviteId && inviteId !== id) {
            isRoomHost = false; 
            document.getElementById('targetPeerId').value = inviteId;
            console.log("招待IDを検知: 接続を開始します...", inviteId);
            // PeerJSが準備完了してから少し待って接続
            setTimeout(() => connectToPeer(inviteId), 1000);
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

    // ★ 追加: 接続ボタン自体の処理をここに登録しておく
    document.getElementById('connectBtn').onclick = () => {
        const targetId = document.getElementById('targetPeerId').value.trim();
        if (targetId) connectToPeer(targetId);
    };
}

// ★ 追加: ゲスト側から接続を開始する関数
function connectToPeer(targetId) {
    console.log(targetId + " に接続を試みています...");
    isRoomHost = false; // 自分から繋ぎに行く場合はゲスト
    const conn = peer.connect(targetId, {
        reliable: true
    });
    setupConnection(conn);
}

function setupInviteButtons(id) {
    const inviteUrl = window.location.origin + window.location.pathname + '?room=' + id;
    const copyBtn = document.getElementById('copyUrlBtn');
    const qrBtn = document.getElementById('showQrBtn');
    
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
            
            // ★ 追加: 自分がホスト（部屋の作成者）なら、送信元以外の全員（他のゲスト）にメッセージを中継する
            if (isRoomHost) {
                connections.forEach(c => {
                    // 送信してきた人以外で、接続が開いている人にだけ転送
                    if (c !== conn && c.open) c.send(data);
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

// app.jsから呼ばれる関数
function broadcastData(text) {
    const name = window.getMyName ? window.getMyName() : '名無し';
    connections.forEach(conn => { if (conn.open) conn.send({ type: 'text', text, name }); });
}

function broadcastTypingState(isTyping) {
    const name = window.getMyName ? window.getMyName() : '名無し';
    const currentName = name === '名無し' ? '相手' : name;
    connections.forEach(conn => { if (conn.open) conn.send({ type: 'typing', name: currentName, isTyping }); });
}