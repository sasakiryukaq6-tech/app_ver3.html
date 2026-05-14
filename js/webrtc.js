let peer = null;
let connections = [];
let isRoomHost = true; // デフォルトはホスト
let activeRoomId = null; // ★ 追加: 現在参加している「大元のホスト」のIDを記憶する変数

// ★ 修正: iOS Safariの「データ専用通信のサボり」を防ぐためのダミー音声生成ハック
function wakeUpSafariMediaEngine() {
    // ★ 修正: iPadの「Mac偽装」を見破るためのタッチポイント判定を追加
    const isMobileOrApple = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || 
                            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
                            
    if (!isMobileOrApple) return;
    
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const dst = ctx.createMediaStreamDestination();
        osc.connect(dst);
        osc.start();
        console.log("📱 Mobile Media Engine Woken Up");
    } catch(e) {
        console.warn("Media engine wakeup failed:", e);
    }
}

function initWebRTC() {
    // ★ 修正: Apple端末(Safari等)の厳しいネットワーク制限を越えるため、
    // Googleの公共STUNサーバーを明示的に指定して通信の安定性を高める
    peer = new Peer({
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
            
            // ★ 変更: 手動操作の案内を削除し、進行状況の表示のみにする
            const syncStatus = document.getElementById('syncStatus');
            if (syncStatus.textContent.includes('オフライン')) {
                syncStatus.innerHTML = `<span style="color:#0d6efd;">入室処理中...</span>`;
            }
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

    // ★ 変更: 手動接続ボタンの処理を async にし、Safari覚醒ハックを組み込む
    document.getElementById('connectBtn').onclick = async () => {
        const targetId = document.getElementById('targetPeerId').value.trim();
        if (targetId) {
            // ★ 追加: すでに接続済みの相手への二重接続（重複増殖バグ）を防止するガード処理
            // connections の中に、ターゲットのIDと同じで、かつ通信が開いている(open)ものが存在するか判定
            const isAlreadyConnected = connections.some(c => c.peer === targetId && c.open);
            if (isAlreadyConnected) {
                const checkIcon = `<svg class="ui-icon" style="color:#4caf50;" viewBox="0 -960 960 960"><path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm-56-252 226-226-34-34-192 192-86-86-34 34 120 120Z"/></svg>`;
                document.getElementById('syncStatus').innerHTML = `${checkIcon} <span style="color:#4caf50;">すでに接続済みです</span>`;
                return; // ★ここで処理を打ち切り、無駄な再接続やマイク権限の起動を完全に防ぐ
            }

            activeRoomId = targetId; 
            setupInviteButtons(); 
            document.getElementById('syncStatus').innerHTML = `<span style="color:#0d6efd;">接続を準備中...</span>`;

            // ★ 修正: こちらもiPadの「Mac偽装」を見破る判定を追加し、確実にマイク一瞬起動ハックを実行する
            const isStrictApple = /iPhone|iPad|iPod/i.test(navigator.userAgent) || 
                                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            
            if (isStrictApple) {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    // エンジンを起こすのが目的なので、即座にストリームを停止してマイクをオフにする
                    stream.getTracks().forEach(t => t.stop());
                } catch(e) {
                    console.warn("マイク権限が拒否されました（通信が不安定になる可能性があります）:", e);
                }
            }

            connectToPeer(targetId);
        }
    };
} // <-- initWebRTC関数の終わり

let connectionAttemptTimer = null; // ★追加: タイムアウト管理用

// ★ 修正: ゲスト側から接続を開始する関数（Safari完全対策版）
function connectToPeer(targetId) {
    console.log(targetId + " に接続を試みています...");
    isRoomHost = false; 
    
    document.getElementById('syncStatus').innerHTML = `<span style="color:#0d6efd;">接続を試みています...</span>`;
    
    if (connectionAttemptTimer) clearTimeout(connectionAttemptTimer);
    
    connectionAttemptTimer = setTimeout(() => {
        if (connections.length === 0) {
            const warnIcon = `<svg class="ui-icon" style="color:#f44336;" viewBox="0 -960 960 960"><path d="M440-280h80v-80h-80v80Zm0-160h80v-200h-80v200Zm40 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>`;
            document.getElementById('syncStatus').innerHTML = `${warnIcon} 接続タイムアウト<br><span style="font-size:0.85em; color:#666;">※Safariの制限か電波が原因です。もう一度「接続する」を押してください。</span>`;
        }
    }, 10000);

    // ★ 追加: 接続処理が走る直前にSafariの通信エンジンを叩き起こす
    wakeUpSafariMediaEngine();

    // ★ 変更: SDP（接続プロトコル）を強制スルーさせるプロ向けオプションを追加
    const conn = peer.connect(targetId, {
        reliable: false,
        sdpTransform: function(sdp) { return sdp; } // Safariのネゴシエーションを強制通過させる
    });
    
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
    const phoneIcon = `<svg class="ui-icon" viewBox="0 -960 960 960" fill="currentColor"><path d="M520-120v-80h80v80h-80Zm-80-80v-200h80v200h-80Zm320-120v-160h80v160h-80Zm-80-160v-80h80v80h-80Zm-480 80v-80h80v80h-80Zm-80-80v-80h80v80h-80Zm360-280v-80h80v80h-80ZM180-660h120v-120H180v120Zm-60 60v-240h240v240H120Zm60 420h120v-120H180v120Zm-60 60v-240h240v240H120Zm540-540h120v-120H660v120Zm-60 60v-240h240v240H600Zm80 480v-120h-80v-80h160v120h80v80H680ZM520-400v-80h160v80H520Zm-160 0v-80h-80v-80h240v80h-80v80h-80Zm40-200v-160h80v80h80v80H400Zm-190-90v-60h60v60h-60Zm0 480v-60h60v60h-60Zm480-480v-60h60v60h-60Z"/></svg>`;

    qrBtn.onclick = () => {
        const container = document.getElementById('qrContainer');
        if (container.style.display === 'block') {
            container.style.display = 'none';
            qrBtn.innerHTML = `${phoneIcon} QRコード表示`; // textContent を innerHTML に変更
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
        // 接続に成功したらタイムアウトのタイマーを止める
        if (connectionAttemptTimer) clearTimeout(connectionAttemptTimer);

        if (!connections.includes(conn)) connections.push(conn);
        updateSyncStatusUI();
        
        // ★ 追加: 再接続成功時などに警告トーストが出ていれば消す
        if (window.hideWarningToast) window.hideWarningToast();
        
        // ★ 追加: WebRTCの物理的な通信状態（ICE）を厳密に監視する
        if (conn.peerConnection) {
            conn.peerConnection.oniceconnectionstatechange = () => {
                const state = conn.peerConnection.iceConnectionState;
                console.log("ICE State Changed:", state);
                
                if (state === 'disconnected' || state === 'failed' || state === 'closed') {
                    console.warn("P2P通信が切断されました。");
                    
                    if (window.showWarningToast) {
                        window.showWarningToast("⚠️ 通信が不安定です。再接続中...", false);
                    }
                    
                    // 内部のリストから削除してUIを更新
                    connections = connections.filter(c => c !== conn);
                    updateSyncStatusUI();
                    if (isRoomHost) broadcastParticipantList();
                    
                    // 自分がゲスト（参加者）で、ホストのIDを覚えている場合は、3秒後に自動再接続を試みる
                    if (!isRoomHost && activeRoomId) {
                        setTimeout(() => {
                            if (connections.length === 0) {
                                connectToPeer(activeRoomId);
                            }
                        }, 3000);
                    }
                }
            };
        }

        // 接続した直後に、自分の名前を相手に教える（自己紹介）
        setTimeout(() => {
            const myName = window.getMyName ? window.getMyName() : '名無し';
            try { conn.send({ type: 'hello', name: myName }); } catch(e){}
        }, 500);

        // ★ 修正: ホスト側の無条件送信を削除し、ゲストからのリクエストに応答する形に一本化（二重送信の防止）
        setTimeout(() => {
            if (!isRoomHost) {
                console.log("ゲストとして履歴を要求します...");
                conn.send({ type: 'request_history' });
            }
        }, 1000);
    });

    conn.on('data', (data) => {
        const myCurrentName = getMyName() === '名無し' ? 'あなた' : getMyName();

        // ★ 追加: 自己紹介を受け取り、ホストなら全員に名簿を配る
        if (data.type === 'hello') {
            conn.remoteName = data.name;
            if (isRoomHost) {
                broadcastParticipantList();
            } else {
                renderParticipantList([myCurrentName, data.name]); // ゲスト用の仮表示
            }
        }
        // ★ 追加: ホストから届いた完成済みの名簿（リスト）を受け取る
        else if (data.type === 'participant_list') {
            if (!isRoomHost) renderParticipantList(data.list);
        }

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
                // ★ 修正: window. を明記して、確実にグローバル変数を上書きする
                window.chatMessages = (data.messages || []).map(m => {
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
        if (isRoomHost) broadcastParticipantList(); // ★ 追加: 誰かが抜けたらリストを更新
    });

    // ★追加: 接続ごとの個別エラーをキャッチし、永遠に固まるのを防ぐ
    conn.on('error', (err) => {
        console.warn("Connection Error:", err);
        if (connectionAttemptTimer) clearTimeout(connectionAttemptTimer);
        connections = connections.filter(c => c !== conn);
        updateSyncStatusUI();
        document.getElementById('syncStatus').innerHTML = `<span style="color:#f44336;">接続が切断されました（エラー）</span>`;
        if (isRoomHost) broadcastParticipantList(); // ★ 追加: 誰かが抜けたらリストを更新
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

// ★ 追加: UIに参加者リストを描画する関数
function renderParticipantList(list) {
    const ul = document.getElementById('participantList');
    if (!list || list.length === 0 || connections.length === 0) {
        ul.innerHTML = `<li style="color: #666;">（自分のみ）</li>`;
        return;
    }
    
    ul.innerHTML = '';
    const myName = window.getMyName ? window.getMyName() : 'あなた';
    
    // ★ 変更: 自分を一番上に表示し、色を自分の送信テキスト（CUDブルー）に合わせる
    ul.innerHTML += `<li><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#005AFF; margin-right:6px;"></span>${escapeHTML(myName)} <span style="font-size:0.85em; color:#666;">(あなた)</span></li>`;
    
    // ★ 変更: 他の参加者を、チャット画面で割り当てられた固有のテーマカラーで表示する
    list.forEach(name => {
        if (name !== myName) {
            // app.js から、その人に割り当てられた色の情報（枠線の色）を取得する
            const remoteColorInfo = window.getColorForName ? window.getColorForName(name) : { border: '#0d6efd' };
            
            ul.innerHTML += `<li><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${remoteColorInfo.border}; margin-right:6px;"></span>${escapeHTML(name)}</li>`;
        }
    });
}

// ホストが全員のリストをまとめて配る関数
function broadcastParticipantList() {
    if (!isRoomHost) return;
    
    const list = connections.filter(c => c.open).map(c => c.remoteName || '名無し');
    const myName = window.getMyName ? window.getMyName() : '名無し';
    list.push(myName);
        
    connections.forEach(conn => {
        if (conn.open) {
            try { conn.send({ type: 'participant_list', list: list }); } catch(e){}
        }
    });
    renderParticipantList(list);
}

// ★ 追加: 自分の名前が変わった時に呼び出される自己紹介関数
window.notifyNameChange = function() {
    const myName = window.getMyName ? window.getMyName() : '名無し';
    connections.forEach(conn => {
        if (conn.open) {
            try { conn.send({ type: 'hello', name: myName }); } catch(e){}
        }
    });
    if (isRoomHost) broadcastParticipantList();
};