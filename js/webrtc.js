let peer = null;
let connections = [];
let isRoomHost = true; // デフォルトはホスト

function initWebRTC() {
    peer = new Peer();
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
        document.getElementById('syncStatus').textContent = '⚠️ エラー';
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

    qrBtn.onclick = () => {
        const container = document.getElementById('qrContainer');
        if (container.style.display === 'block') {
            container.style.display = 'none';
            qrBtn.textContent = '📱 QR表示';
        } else {
            container.style.display = 'block';
            qrBtn.textContent = '📱 閉じる';
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
    const statusText = count > 0 ? `✅ 接続完了 (${count}台)` : `現在オフラインです`;
    document.getElementById('syncStatus').textContent = statusText;
    document.getElementById('syncStatusSummary').textContent = count > 0 ? `(✅ ${count}台)` : `(オフライン)`;
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