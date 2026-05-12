// --- グローバル変数 (windowに紐付けて共有可能にする) ---
window.chatMessages = [];
let isUserListening = false;
let speakingQueueCount = 0;
let isMyTyping = false;
let customDictionary = {};
let currentFontSize = 14;
let savedTtsRate = 1.0;
let savedTtsPitch = 1.0;

// YAMNet関連
let isEnvSoundActive = false;
let yamnetModel = null;
let envAudioContext = null;
let workletNode = null;
let envStream = null;
let lastCaptionTime = 0;

const isAndroid = /Android/i.test(navigator.userAgent);

// --- メッセージのスタイル定義（CUD対応・ボタン色と連動） ---
const MSG_STYLES = {
    // 🗣️ 送信（TTS）: CUDブルーのボタンと同系色
    tts:    { bg: '#E5F3FF', border: '#005AFF', nameColor: '#005AFF' }, 
    // 🎤 聞き取り（STT）: CUDオレンジのボタンと同系色
    stt:    { bg: '#FFF2D6', border: '#F6AA00', nameColor: '#C38700' }, 
    // 相手（リモート）: 自分が送信した青・オレンジと見分けやすいCUDグリーン
    remote: { bg: '#E5F9F1', border: '#03AF7A', nameColor: '#02875E' }  
};

// --- 参加者ごとのカラーパレット（CUD推奨の識別しやすい色） ---
const REMOTE_PALETTES = [
    { bg: '#E5F9F1', border: '#03AF7A', nameColor: '#02875E' }, // CUDグリーン
    { bg: '#FCE4EC', border: '#FF8082', nameColor: '#C2185B' }, // CUDピンク
    { bg: '#F3E5F5', border: '#990099', nameColor: '#7B1FA2' }, // CUDパープル
    { bg: '#FFFDE7', border: '#84C118', nameColor: '#5B8510' }, // CUD黄緑
    { bg: '#EFEFEF', border: '#84919E', nameColor: '#4B5156' }  // CUDグレー
];

// 名前と色の紐づけを記憶する辞書
const assignedColors = {};
let nextColorIndex = 0;

function getColorForName(name) {
    // まだ色が割り当てられていない新しい名前が来たら、次の色を順番に割り当てる
    if (!assignedColors[name]) {
        assignedColors[name] = REMOTE_PALETTES[nextColorIndex % REMOTE_PALETTES.length];
        nextColorIndex++;
    }
    // 一度決まった色は、その人が退出するまで同じ色が使われる
    return assignedColors[name];
}

// --- 修正: 確実にHTMLを読み込んでから要素を取得するように変更 ---
let chatLog, sttInterim, ttsInput;

// --- 初期化 ---
window.addEventListener('DOMContentLoaded', async () => { // ★ async を追加
    chatLog = document.getElementById('chatLog');
    sttInterim = document.getElementById('sttInterim');
    ttsInput = document.getElementById('ttsInput');

    // ★ 変更：名前入力に関連する要素を先に取得
    const nameOverlay = document.getElementById('nameEntryOverlay');
    const initialInput = document.getElementById('initialNameInput');
    const entryBtn = document.getElementById('entryBtn');
    const myNameInput = document.getElementById('myNameInput');

    // ★ 推奨：Peer通信や設定読み込みよりも前に、まず名前を確定させる
    const savedName = await localforage.getItem('myDisplayName');
    if (savedName && savedName !== '名無し') {
        nameOverlay.style.display = 'none'; 
        myNameInput.value = savedName; // ★ 修正：保存されていた名前を画面の入力欄に反映
    }

    // ★ 修正: 設定の読み込みが終わるのを待つ
    await loadSettings();
    
    // ★ 修正: localforage から履歴を取得 (JSON.parseは不要になります)
    const saved = await localforage.getItem('chatMessages');    
    if (saved) {
        window.chatMessages = saved; 
        renderAllMessages(); 
    }

    initWebRTC();

    if (isAndroid) {
        const meter = document.querySelector('.meter-container');
        if(meter) meter.style.display = 'none';
    }

    // --- ソフトウェアキーボード対策 (Visual Viewport) ---
    if (window.visualViewport) {
        const adjustViewport = () => {
            // キーボードを除いた「実際に表示されている画面の高さ」を取得し、HTMLとBodyに強制適用
            const vpHeight = window.visualViewport.height;
            document.documentElement.style.height = `${vpHeight}px`;
            document.body.style.height = `${vpHeight}px`;
            window.scrollTo(0, 0); // OS側の勝手なスクロールを防止

            // 入力欄(ttsInput)にフォーカスが当たってキーボードが開いた場合、
            // 会話ログが隠れないように一番下まで自動スクロールする
            if (document.activeElement === ttsInput) {
                setTimeout(() => {
                    chatLog.scrollTop = chatLog.scrollHeight;
                }, 100); // キーボードのアニメーションに合わせるためのわずかな遅延
            }
        };

        window.visualViewport.addEventListener('resize', adjustViewport);
        // iOS特有の「キーボード出現時の謎のスクロール」を検知
        window.visualViewport.addEventListener('scroll', adjustViewport);
        
        // 初回実行
        adjustViewport();
    }

    initUIEvents();
    initSelectionPopup();

    // 2. 「会話を始める」ボタンが押された時の処理
    // ★ 修正：entryBtn.onclick 内の演出を style.opacity に修正（fadeOutは存在しないプロパティのため）
    entryBtn.onclick = async () => {
        const inputName = initialInput.value.trim();
        if (!inputName) {
            alert('名前を入力してください．．');
            return;
        }

        await localforage.setItem('myDisplayName', inputName);
        myNameInput.value = inputName;
        
        nameOverlay.style.transition = "opacity 0.3s ease";
        nameOverlay.style.opacity = "0";
        setTimeout(() => nameOverlay.style.display = 'none', 300);
    };

    // Enterキーでも決定できるように
    initialInput.onkeydown = (e) => { if(e.key === 'Enter') entryBtn.click(); };

    // ★追加: 通信パネル（左ドロワー）で名前を変更した時にも、新しい名前を保存する
    myNameInput.addEventListener('input', async () => {
        const newName = myNameInput.value.trim();
        if (newName) {
            await localforage.setItem('myDisplayName', newName);
        }
    });
});

// ★ 修正: localforage は非同期なので async 関数にします
async function loadSettings() {
    customDictionary = (await localforage.getItem('userDictionary')) || {};
    currentFontSize = parseInt(await localforage.getItem('appFontSize')) || 14;
    savedTtsRate = parseFloat(await localforage.getItem('ttsRate')) || 1.0;
    savedTtsPitch = parseFloat(await localforage.getItem('ttsPitch')) || 1.0;
    
    document.documentElement.style.setProperty('--font-size', currentFontSize + 'px');
    
    const isDark = await localforage.getItem('darkMode');
    document.body.classList.toggle('dark-mode', isDark === true);
}

// 他のファイルから呼べるようにwindowに公開
window.getMyName = function() { 
    return document.getElementById('myNameInput').value.trim() || '名無し'; 
};

// --- メッセージ操作 ---
window.addMessage = function(name, text, type) {
    const index = window.chatMessages.length;
    const msgObj = { name, text, type };
    window.chatMessages.push(msgObj);
    appendMessageToDOM(msgObj, index);
    saveMessages();
};

window.syncHistory = function(messages) {
    const myName = window.getMyName();
    window.chatMessages = (messages || []).map(m => {
        return m.name !== myName ? { name: m.name, text: m.text, type: 'remote' } : m;
    });
    renderAllMessages();
    saveMessages();
};

function renderAllMessages() {
    chatLog.innerHTML = '';
    window.chatMessages.forEach((m, i) => appendMessageToDOM(m, i));
    chatLog.scrollTop = chatLog.scrollHeight;
}

function appendMessageToDOM(m, i) {
    // 基本スタイルの決定
    let s = MSG_STYLES[m.type] || MSG_STYLES.stt;
    
    // リモート（相手）の場合は名前から色を計算し、左側に寄せる
    if (m.type === 'remote') {
        s = getColorForName(m.name);
    }
    const alignClass = m.type === 'remote' ? 'left' : 'right';

    // 1つ前と同じ送信者なら名前を省略するロジック（ver18準拠）
    const isSameSender = i > 0 && chatMessages[i - 1].name === m.name && chatMessages[i - 1].type === m.type;
    const nameHtml = isSameSender ? '' : `<span class="msg-name" style="color:${s.nameColor}; font-weight:bold; font-size:0.75em; margin-bottom:4px; display:block;">${escapeHTML(m.name)}</span>`;

    const html = `
        <div class="msg-row ${alignClass}" style="display:flex; width:100%; justify-content:${alignClass === 'left' ? 'flex-start' : 'flex-end'};">
            <div class="msg-wrapper" style="display:flex; flex-direction:column; max-width:80%; align-items:${alignClass === 'left' ? 'flex-start' : 'flex-end'};">
                ${nameHtml}
                <div class="msg-bubble" data-index="${i}" style="background:${s.bg}; border: 1px solid ${s.border}; padding:6px 10px; border-radius:12px; border-top-${alignClass}-radius:2px;">
                    <span class="msg-text" style="white-space:pre-wrap; word-wrap:break-word;">${escapeHTML(m.text)}</span>
                </div>
            </div>
        </div>`;
    
    chatLog.insertAdjacentHTML('beforeend', html);

    chatLog.scrollTop = chatLog.scrollHeight;
}

// ★ 修正: stringify不要。そのまま保存します
function saveMessages() { 
    localforage.setItem('chatMessages', window.chatMessages); 
}
function messagesToText() { return window.chatMessages.map(m => `${m.name}： ${m.text}`).join('\n'); }
function escapeHTML(str) { return str.replace(/[&<>'"]/g, t => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[t])); }
function getColorForName(n) {
    const pals = [{bg:'#fff3e0',c:'#e65100'},{bg:'#fce4ec',c:'#c2185b'},{bg:'#e3f2fd',c:'#1565c0'}];
    let h = 0; for(let i=0;i<n.length;i++) h = n.charCodeAt(i) + ((h<<5)-h);
    const p = pals[Math.abs(h)%pals.length];
    return { bg: p.bg, border: p.c, nameColor: p.c };
}

// --- 通信ダミー（webrtc.jsがない場合のエラー回避） ---
if (typeof broadcastData !== 'function') window.broadcastData = () => {};
if (typeof broadcastTypingState !== 'function') window.broadcastTypingState = () => {};

// --- マイク音量メーター ---
let audioContextMeter; 
let analyser;

// --- Android ピコン音防止ハック ---
let silentAudioCtx = null;
function startSilentAudio() {
    if (!isAndroid || silentAudioCtx) return;
    try {
        silentAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = silentAudioCtx.createOscillator();
        const gain = silentAudioCtx.createGain();
        gain.gain.value = 0.0001;
        oscillator.connect(gain);
        gain.connect(silentAudioCtx.destination);
        oscillator.start();
    } catch(e) { console.log(e); }
}
function stopSilentAudio() {
    if (silentAudioCtx) { silentAudioCtx.close(); silentAudioCtx = null; }
}

async function initVolumeMeter() {
    if (audioContextMeter || isAndroid) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContextMeter = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContextMeter.createAnalyser();
        analyser.fftSize = 256;
        const source = audioContextMeter.createMediaStreamSource(stream);
        source.connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const volumeMeter = document.getElementById('volumeMeter');
        
        function updateMeter() {
            if (!isUserListening) { 
                volumeMeter.style.width = '0%'; 
                requestAnimationFrame(updateMeter); 
                return; 
            }
            analyser.getByteFrequencyData(dataArray);
            let sum = 0; 
            for(let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            
            // ★微調整: 小さな音でもメーターが動き始めるように感度を調整
            let average = sum / dataArray.length;
            let percent = Math.min(100, (average / 40) * 100); 
            
            volumeMeter.style.width = percent + '%';
            
            // 色の変化をより直感的に
            if (percent > 70) volumeMeter.style.background = '#f44336'; // 大きすぎ（赤）
            else if (percent > 5) volumeMeter.style.background = '#4caf50'; // ちょうどいい（緑）
            else volumeMeter.style.background = '#8bc34a'; // 小さい（黄緑）
            
            requestAnimationFrame(updateMeter);
        }
        updateMeter();
    } catch (err) { 
        console.log("マイク音量取得失敗", err); 
    }
}

// --- UIイベント ---
function initUIEvents() {
    // 送信
    document.getElementById('speakBtn').onclick = speakAndLog;
    
    // ★Enter送信
    ttsInput.addEventListener('keydown', (e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') {
            if (!e.shiftKey) { 
                e.preventDefault(); 
                speakAndLog();
            }
        }
    });

    // ★追加: 入力文字数に合わせてテキストエリアの高さを自動調整
    ttsInput.addEventListener('input', function() {
        // 一旦高さをautoにして本来の高さを再計算させる
        this.style.height = 'auto';
        // 中身の高さ（scrollHeight）に合わせて高さをピクセル指定
        this.style.height = this.scrollHeight + 'px';
    });

    // 聞き取り
    const startBtn = document.getElementById('startBtn');
    
    // 聞き取りボタンのアイコン定義を更新
    const micSvg = `<span class="icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg></span>`;
    const stopSvg = `<span class="icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-4-4h8V8H8v8z"/></svg></span>`;

    startBtn.onclick = () => {
        isUserListening = !isUserListening;
        if (isUserListening) {
            startSilentAudio();
            initVolumeMeter(); 
            startSTT();
            // 停止アイコンとテキストに書き換え
            startBtn.innerHTML = stopSvg + '<span class="text">停止</span>';
            startBtn.setAttribute('aria-label', '聞き取り停止');
            startBtn.classList.add('listening-active');
        } else {
            stopSilentAudio(); 
            stopSTT();
            // マイクアイコンとテキストに戻す
            startBtn.innerHTML = micSvg + '<span class="text">聞き取り</span>';
            startBtn.setAttribute('aria-label', '聞き取り開始');
            startBtn.classList.remove('listening-active');
        }
    };

    // 待って
    const waitBtn = document.getElementById('waitBtn');
    waitBtn.onclick = () => {
        isMyTyping = !isMyTyping;
        waitBtn.classList.toggle('active', isMyTyping);
        broadcastTypingState(isMyTyping);
    };

    // リセット
    document.getElementById('clearChatBtn').onclick = () => {
        if(confirm("消去しますか？")) { 
            window.chatMessages = []; 
            renderAllMessages(); 
            localforage.removeItem('chatMessages'); // ★修正
        }
    };
    
    // コピー・保存
    document.getElementById('copyChatBtn').onclick = () => {
        navigator.clipboard.writeText(messagesToText()).then(() => alert("コピー完了"));
    };

    // ★ 追加: ここから下の「保存」処理を追加してください
    document.getElementById('downloadChatBtn').onclick = () => {
        if (!window.chatMessages.length) { alert("保存する履歴がありません。"); return; }
        const blob = new Blob([messagesToText()], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const date = new Date();
        const filename = `会話記録_${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}_${String(date.getHours()).padStart(2,'0')}${String(date.getMinutes()).padStart(2,'0')}.txt`;
        const a = document.createElement('a'); 
        a.href = url; 
        a.download = filename; 
        document.body.appendChild(a); 
        a.click(); 
        document.body.removeChild(a); 
        URL.revokeObjectURL(url);
    };

    // ドロワー制御
    const menuBtn = document.getElementById('mobileMenuBtn');
    const panel = document.querySelector('.sync-panel');
    const overlay = document.getElementById('drawerOverlay');
    if (menuBtn) {
        // ★変更: ボタンを押した時の処理を「すでに開いていれば閉じ、閉じていれば開く」という条件分岐に変更
        menuBtn.onclick = () => { 
            const isActive = panel.classList.contains('active');
            if (isActive) {
                // 開いている状態なら閉じる
                panel.classList.remove('active'); 
                overlay.classList.remove('active');
                // 変更: アイコン付きに戻す
                menuBtn.innerHTML = connectSvg + '<span class="text">通信設定</span>';
            } else {
                // 閉じている状態なら開く
                panel.classList.add('active'); 
                overlay.classList.add('active'); 
                panel.open = true; 
                // 変更: 閉じるアイコンに切り替え
                menuBtn.innerHTML = closeSvg + '<span class="text">閉じる</span>';
            }
        };
        overlay.onclick = () => { 
            panel.classList.remove('active'); 
            overlay.classList.remove('active');
            menuBtn.innerHTML = connectSvg + '<span class="text">通信設定</span>';
        };
    }

    // 設定モーダルの開閉
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');

    settingsBtn.onclick = async () => { // ★ async を追加
        settingsModal.classList.add('active');
        await initSettingsLogic(); // ★ await を追加して読み込みを待つ
    };
    closeSettingsBtn.onclick = () => settingsModal.classList.remove('active');
    // 外側クリックで閉じる
    settingsModal.onclick = (e) => { if(e.target === settingsModal) settingsModal.classList.remove('active'); };

    // --- スマートヘッダー（スクロール連動） ---
    let lastScrollTop = 0;
    const topHeader = document.querySelector('.header');

    chatLog.addEventListener('scroll', () => {
        const currentScroll = chatLog.scrollTop;
        
        // 新規メッセージ受信時などの「自動スクロール」で誤ってヘッダーが隠れないように、
        // 一番下にいる時（isAtBottom）は判定から除外する
        const isAtBottom = chatLog.scrollHeight - currentScroll - chatLog.clientHeight < 20;

        // 下へスクロール（最新の会話に向かって指を動かしている時）
        if (currentScroll > lastScrollTop && currentScroll > 50 && !isAtBottom) {
            topHeader.classList.add('header-hidden');
        } 
        // 上へスクロール（少しでも戻ろうと指を動かした時）
        else if (currentScroll < lastScrollTop) {
            topHeader.classList.remove('header-hidden');
        }
        
        lastScrollTop = currentScroll;
    });
}

// --- 修正: 辞書登録ポップアップの完全復元 ---
let tempSelectedText = ""; // ポップアップで使う変数を関数の外で定義

function initSelectionPopup() {
    const selectionPopup = document.getElementById('selectionPopup');
    if (!selectionPopup) return; // 要素がなければ何もしない

    // チャットログ内での選択を検知
    chatLog.addEventListener('mouseup', (e) => {
        const selectedText = window.getSelection().toString().trim();
        if (selectedText) {
            tempSelectedText = selectedText;
            // クリックした位置の近くにポップアップを出す
            selectionPopup.style.left = (e.pageX - 50) + 'px';
            selectionPopup.style.top = (e.pageY - 45) + 'px';
            selectionPopup.style.display = 'block';
        } else {
            selectionPopup.style.display = 'none';
        }
    });

    // 画面の他の場所をクリックしたらポップアップを消す
    document.addEventListener('mousedown', (e) => {
        if (e.target !== selectionPopup) {
            // 選択解除を待ってから消す
            setTimeout(() => { 
                if (!window.getSelection().toString().trim()) selectionPopup.style.display = 'none'; 
            }, 10);
        }
    });

    // ポップアップ（辞書に登録）を押した時の動作
    selectionPopup.addEventListener('mousedown', (e) => {
        e.preventDefault(); 
        if (tempSelectedText) {
            settingsModal.classList.add('active');
            initSettingsLogic();
            document.getElementById('dictWrong').value = tempSelectedText;
            document.getElementById('dictCorrect').focus();
            selectionPopup.style.display = 'none';
            window.getSelection().removeAllRanges(); 
        }
    });
}

// 他のファイルから呼ばれる指標表示
window.handleRemoteTyping = function(d) {
    const indicator = document.getElementById('typingIndicator');
    if (d.isTyping) { indicator.textContent = `🖐️ ${d.name}さんが入力中...`; indicator.style.display = 'block'; }
    else indicator.style.display = 'none';
};

// --- 音声認識 (STT) ---
let recognition = null;
let restartTimer = null;
let isApiActive = false;

function startSTT() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.lang = 'ja-JP';
    recognition.interimResults = true;
    recognition.continuous = !isAndroid;

    recognition.onstart = () => { isApiActive = true; clearTimeout(restartTimer); restartTimer = null; };

    recognition.onresult = (e) => {
        let interim = ''; let final = '';
        for (let i = e.resultIndex; i < e.results.length; ++i) {
            if (e.results[i].isFinal) final += e.results[i][0].transcript + '．\n\n';
            else interim += e.results[i][0].transcript;
        }
        
        final = applyDictionary(final);
        interim = applyDictionary(interim);

        if (final.trim()) {
            addMessage(getMyName(), final.trim(), 'stt');
            broadcastData(final.trim());
        }
        sttInterim.textContent = interim ? "👂: " + interim : "";
        
        const isAtBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 50;
        if (isAtBottom && (final || interim)) chatLog.scrollTop = chatLog.scrollHeight;
    };

    recognition.onerror = (e) => {
        isApiActive = false;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
            isUserListening = false;
            document.getElementById('startBtn').textContent = '🎤 聞き取り開始';
            document.getElementById('startBtn').classList.remove('listening-active');
            alert("マイクの使用が許可されていません。"); return;
        }
        if (e.error === 'aborted') return;
        scheduleRestart((e.error === 'audio-capture') ? 1000 : 250);
    };

    recognition.onend = () => { 
        isApiActive = false;
        if (isUserListening) scheduleRestart(isAndroid ? 250 : 600); 
    };
    
    try { recognition.start(); } catch(e) { scheduleRestart(1500); }
}

function scheduleRestart(delay = 600) {
    if (!isUserListening || restartTimer !== null) return;
    restartTimer = setTimeout(() => {
        restartTimer = null;
        if (!isUserListening || isApiActive) return;
        startSTT();
    }, delay);
}

function stopSTT() { 
    if(recognition) recognition.stop(); 
    clearTimeout(restartTimer);
    restartTimer = null;
    sttInterim.textContent = ""; 
}

function applyDictionary(t) {
    let r = t; for(const [w, c] of Object.entries(customDictionary)) r = r.split(w).join(c);
    return r;
}

// --- 音声合成 (TTS) ---
function speakAndLog() {
    const text = ttsInput.value.trim();
    if (!text) return;
    
    if (isMyTyping) document.getElementById('waitBtn').click();
    
    addMessage(getMyName(), text, 'tts');
    broadcastData(text);

    // ★ 変更: テキストを空にした直後に、高さをリセットする処理を追加
    ttsInput.value = ''; 
    ttsInput.style.height = 'auto'; 
    ttsInput.blur();

    const chunks = text.match(/.*?[、。，．！？\n\s]+|.{1,25}/g) || [text];
    let idx = 0; let offset = 0;
    
    function play() {
        if (idx >= chunks.length) { speakingQueueCount--; if(speakingQueueCount<=0) renderAllMessages(); return; }
        const uttr = new SpeechSynthesisUtterance(chunks[idx]);
        uttr.lang = 'ja-JP'; uttr.rate = savedTtsRate; uttr.pitch = savedTtsPitch;
        
        const savedVoice = localStorage.getItem('ttsVoice');
        if (savedVoice) {
            const v = window.speechSynthesis.getVoices().find(v => v.name === savedVoice);
            if (v) uttr.voice = v;
        }

        uttr.onstart = () => {
            if (idx === 0) speakingQueueCount++;
            const el = chatLog.querySelector(`.msg-bubble[data-index="${chatMessages.length-1}"] .msg-text`);
            if (el) {
                const chunk = chunks[idx];
                el.innerHTML = escapeHTML(text.slice(0, offset)) + `<span class="tts-highlight-word">${escapeHTML(chunk)}</span>` + escapeHTML(text.slice(offset + chunk.length));
            }
        };
        uttr.onend = () => { offset += chunks[idx].length; idx++; play(); };
        uttr.onerror = () => { offset += chunks[idx].length; idx++; play(); };
        
        setTimeout(() => window.speechSynthesis.speak(uttr), 10);
    }
    play();
}

// --- 環境音認識 (AudioWorklet版) ---
document.getElementById('envSoundToggle').onchange = async (e) => {
    isEnvSoundActive = e.target.checked;
    if (isEnvSoundActive) {
        showAudioCaption("⏳ AIモデル読込中...");
        await startEnvironmentalSoundDetection();
    } else stopEnvironmentalSoundDetection();
};

async function startEnvironmentalSoundDetection() {
    const yamDict = { 16: "😄 笑い声", 18: "😢 泣き声", 20: "👶 赤ちゃんの泣き声", 55: "👏 拍手", 71: "🐶 犬", 72: "🐶 犬", 78: "🐱 猫", 80: "🐱 猫", 300: "🌧️ 雨", 318: "⏰ アラーム", 322: "🚨 サイレン", 323: "🚑 救急車", 324: "🚒 消防車", 325: "🚓 パトカー", 382: "🪟 ガラス割れ", 386: "🛎️ チャイム", 388: "☎️ 電話", 393: "⏰ 目覚まし", 400: "🚪 ノック", 430: "⌨️ タイピング" };
    try {
        if (!yamnetModel) yamnetModel = await tf.loadGraphModel('https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1', {fromTFHub: true});
        envStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        envAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        await envAudioContext.audioWorklet.addModule('js/audio-processor.js');
        const source = envAudioContext.createMediaStreamSource(envStream);
        workletNode = new AudioWorkletNode(envAudioContext, 'audio-processor');
        
        showAudioCaption("✅ 環境音の監視を開始しました");
        let isPredicting = false;

        workletNode.port.onmessage = (e) => {
            if (!isEnvSoundActive || isPredicting) return;
            isPredicting = true;
            setTimeout(() => {
                tf.tidy(() => {
                    const results = yamnetModel.execute(tf.tensor1d(e.data));
                    const topClass = results[0].max(0).argMax().dataSync()[0];
                    const topScore = results[0].max().dataSync()[0];
                    const now = Date.now();
                    if (now - lastCaptionTime > 3000) {
                        if (topScore > 0.05 && yamDict[topClass]) {
                            showAudioCaption(`🔔 ${yamDict[topClass]}`); lastCaptionTime = now;
                        } else if (topScore > 0.05 && [49, 50, 51, 56, 57, 58, 424, 425].includes(topClass)) {
                            showAudioCaption(`👏 突発音`); lastCaptionTime = now;
                        }
                    }
                });
                isPredicting = false;
            }, 0);
        };
        source.connect(workletNode); workletNode.connect(envAudioContext.destination);
    } catch(err) { console.error(err); alert("エラーが発生しました。"); document.getElementById('envSoundToggle').checked = false; }
}

function stopEnvironmentalSoundDetection() {
    if(workletNode) { workletNode.disconnect(); workletNode = null; }
    if(envAudioContext) { envAudioContext.close(); envAudioContext = null; }
    if(envStream) { envStream.getTracks().forEach(t => t.stop()); envStream = null; }
    document.getElementById('envSoundCaption').style.display = 'none';
}

function showAudioCaption(t) {
    const c = document.getElementById('envSoundCaption');
    c.textContent = t; c.style.display = 'block';
    c.style.animation = 'none'; c.offsetHeight;
    c.style.animation = 'fadeInOut 3s forwards';
}

function handleRemoteTyping(d) {
    const indicator = document.getElementById('typingIndicator');
    if (d.isTyping) { indicator.textContent = `🖐️ ${d.name}さんが入力中...`; indicator.style.display = 'block'; }
    else indicator.style.display = 'none';
}

async function initSettingsLogic() { // ★ async 化
    const disp = document.getElementById('currentFontSizeDisplay');
    const toggle = document.getElementById('darkModeToggle');
    const sel = document.getElementById('voiceSelect');
    const rate = document.getElementById('rateSlider');
    const pitch = document.getElementById('pitchSlider');

    // 現在の値をUIに反映
    disp.textContent = currentFontSize;

    // ★ 修正: localStorage ではなく localforage から取得
    const isDark = await localforage.getItem('darkMode');
    toggle.checked = isDark === true;

    rate.value = savedTtsRate;
    pitch.value = savedTtsPitch;
    document.getElementById('rateValue').textContent = savedTtsRate;
    document.getElementById('pitchValue').textContent = savedTtsPitch;

    // 音声リスト
    async function updateVoices() {
        const vs = window.speechSynthesis.getVoices().filter(v => v.lang.includes('ja'));
        sel.innerHTML = vs.map(v => `<option value="${v.name}">${v.name}</option>`).join('');
        
        // ★ 修正: 音声の選択状態も localforage から取得
        const savedVoice = await localforage.getItem('ttsVoice');
        sel.value = savedVoice || "";
    }
    await updateVoices();
    window.speechSynthesis.onvoiceschanged = updateVoices;

    // イベント登録（変更即反映）
    document.getElementById('fontIncreaseBtn').onclick = () => { currentFontSize += 2; saveSet(); };
    document.getElementById('fontDecreaseBtn').onclick = () => { currentFontSize -= 2; saveSet(); };
    
    toggle.onchange = () => { 
        localforage.setItem('darkMode', toggle.checked); 
        loadSettings(); 
        showSetToast(); 
    };

    sel.onchange = () => { 
        localforage.setItem('ttsVoice', sel.value); 
        showSetToast(); 
    };

    function saveSet() { 
        localforage.setItem('appFontSize', currentFontSize); 
        loadSettings(); 
        showSetToast(); 
        disp.textContent = currentFontSize; 
    }
    renderDictInModal();
}

function renderDictInModal() {
    const list = document.getElementById('dictList');
    list.innerHTML = Object.entries(customDictionary).map(([w, c]) => `
        <li class="dict-item">${w} ➔ ${c} <button class="dict-delete-btn" onclick="deleteDictInModal('${w}')">削除</button></li>
    `).join('');
}

window.deleteDictInModal = (w) => {
    delete customDictionary[w];
    // ★ 修正
    localforage.setItem('userDictionary', customDictionary);
    renderDictInModal();
    showSetToast();
};

document.getElementById('addDictBtn').onclick = () => {
    const w = document.getElementById('dictWrong').value.trim();
    const c = document.getElementById('dictCorrect').value.trim();
    if(w && c) {
        customDictionary[w] = c;
        // ★ 修正
        localforage.setItem('userDictionary', customDictionary);
        document.getElementById('dictWrong').value = '';
        document.getElementById('dictCorrect').value = '';
        renderDictInModal();
        showSetToast();
    }
};

function showSetToast() {
    const t = document.getElementById('saveToast');
    t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 2000);
}