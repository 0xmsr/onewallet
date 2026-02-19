window.global = window;
window.Buffer = window.Buffer || (window.buffer && window.buffer.Buffer);
window.process = { env: {} };

let walletList = [];
const bip39 = window.bip39;
const ENCRYPTION_KEY_PREFIX = "one_wallet_auth_";
let isBalanceHidden = false;
let videoStream = null;
let currentLoginMode = 'pk';
let currentImportMode = 'pk';
let lastKnownBalance = null;
let RPC_URL = localStorage.getItem('custom_rpc_url') || 'http://localhost:7001';
const ec = new elliptic.ec('secp256k1');
let myWallet = { privateKey: null, publicKey: null, address: null, keyPair: null };
let pendingNonce = null;
let currentRequest = null;
const ONE_TO_USD = 0.1;

const formatONE = (val) => {
    if (val === null || val === undefined) return "0";
    if (typeof val === 'number') {
        return val.toFixed(18).replace(/0+$/, '').replace(/\.$/, '');
    }
    if (typeof val === 'string' && val.includes('e')) {
        return Number(val).toFixed(18).replace(/0+$/, '').replace(/\.$/, '');
    }

    let wei = BigInt(val.toString());
    let whole = wei / 1000000000000000000n;
    let fraction = wei % 1000000000000000000n;

    let fracStr = fraction.toString().padStart(18, '0').replace(/0+$/, '');
    return fracStr ? `${whole}.${fracStr}` : whole.toString();
};

window.onload = () => {
    walletList = JSON.parse(localStorage.getItem('multiWallets') || "[]");
    
    const savedPk = localStorage.getItem('oneWalletSession');
    if (savedPk) {
        document.getElementById('privateKeyInput').value = savedPk;
        login(true);
    }
    updateWalletSelectorUI();
};

function updateWalletSelectorUI() {
    const saved = JSON.parse(localStorage.getItem('multiWallets') || "[]");
    const current = saved.find(w => w.address === myWallet.address);
    
    const nameEl = document.getElementById('active-wallet-name');
    const addrEl = document.getElementById('active-wallet-addr');

    if (current && nameEl && addrEl) {
        nameEl.innerText = current.name;
        const short = current.address.substring(0, 6) + "..." + current.address.slice(-4);
        addrEl.innerText = short;
    }
}

function saveToMultiWallet(pk, addr, mnemonic = null) {
    let saved = JSON.parse(localStorage.getItem('multiWallets') || "[]");
    const exists = saved.find(w => w.address === addr);
    
    if (!exists) {
        const accountNum = saved.length + 1;
        saved.push({ 
            address: addr, 
            privateKey: pk, 
            mnemonic: mnemonic,
            name: `Wallet ${accountNum}` 
        });
        localStorage.setItem('multiWallets', JSON.stringify(saved));
    }
    walletList = saved;
    updateWalletSelectorUI();
}

function encryptData(data, pin) {
    return CryptoJS.AES.encrypt(data, pin).toString();
}

function decryptData(ciphertext, pin) {
    try {
        const bytes = CryptoJS.AES.decrypt(ciphertext, pin);
        return bytes.toString(CryptoJS.enc.Utf8);
    } catch (e) {
        return null;
    }
}

function openWalletSelector() {
    renderWalletList();
    document.getElementById('modal-selector').style.display = 'flex';
}

function closeWalletSelector() {
    document.getElementById('modal-selector').style.display = 'none';
}

function renderWalletList() {
    const container = document.getElementById('wallet-list-container');
    const saved = JSON.parse(localStorage.getItem('multiWallets') || "[]");
    container.innerHTML = "";

    saved.forEach((w) => {
        const isActive = w.address === myWallet.address;
        const item = document.createElement('div');
        item.className = `wallet-item ${isActive ? 'active' : ''}`;
        const shortAddr = w.address.substring(0, 6) + "..." + w.address.substring(w.address.length - 4);
        
        item.innerHTML = `
            <div class="wallet-info" style="flex:1" onclick="selectWallet('${w.privateKey}')">
                <div>${w.name} ${isActive ? '✓' : ''}</div>
                <small>${shortAddr}</small>
            </div>
            <div class="wallet-actions">
                <button class="action-icon-btn" onclick="renameSpecificAccount('${w.address}')">✎</button>
                <button class="action-icon-btn" style="color: #ff4444" onclick="deleteAccount('${w.address}')">🗑</button>
            </div>
        `;
        container.appendChild(item);
    });
}

function selectWallet(pk) {
    document.getElementById('privateKeyInput').value = pk;
    login();
    closeWalletSelector();
}

function deleteAccount(addr) {
    if (!confirm("Hapus wallet ini dari daftar? Pastikan cadangan tersimpan!")) return;
    let saved = JSON.parse(localStorage.getItem('multiWallets') || "[]");
    saved = saved.filter(w => w.address !== addr);
    localStorage.setItem('multiWallets', JSON.stringify(saved));
    if (addr === myWallet.address) {
        logout();
    } else {
        renderWalletList();
        updateWalletSelectorUI();
    }
}

function renameSpecificAccount(addr) {
    let saved = JSON.parse(localStorage.getItem('multiWallets') || "[]");
    const account = saved.find(w => w.address === addr);
    if (account) {
        myWallet.addressToRename = addr; 
        document.getElementById('new-account-name').value = account.name;
        document.getElementById('modal-rename').style.display = 'flex';
        closeWalletSelector();
    }
}

function closeRenameModal() {
    document.getElementById('modal-rename').style.display = 'none';
    delete myWallet.addressToRename;
}

function saveNewName() {
    const newName = document.getElementById('new-account-name').value.trim();
    if (!newName) return showToast("Nama tidak boleh kosong!");

    let saved = JSON.parse(localStorage.getItem('multiWallets') || "[]");
    const targetAddr = myWallet.addressToRename || myWallet.address;
    const index = saved.findIndex(w => w.address === targetAddr);

    if (index !== -1) {
        saved[index].name = newName;
        localStorage.setItem('multiWallets', JSON.stringify(saved));
        walletList = saved;
        updateWalletSelectorUI();
        closeRenameModal();
        showToast("✅ Nama diperbarui!");
    }
}

function saveWalletSecurely(privateKey, pin) {
    const encrypted = encryptData(privateKey, pin);
    localStorage.setItem('oneWalletSession_encrypted', encrypted);
}

function login(isAuto = false) {
    let privKey = "";
    let mnemonicUsed = null;

    if (!isAuto && currentLoginMode === 'phrase') {
        mnemonicUsed = document.getElementById('phraseInput').value.trim();
        privKey = getPrivateKeyFromMnemonic(mnemonicUsed);
    } else {
        privKey = document.getElementById('privateKeyInput').value.trim();
        if (isAuto) {
            const saved = JSON.parse(localStorage.getItem('multiWallets') || "[]");
            const match = saved.find(w => w.privateKey === privKey);
            if (match) mnemonicUsed = match.mnemonic;
        }
    }
    
    lastKnownBalance = null;

    if (!privKey) return isAuto ? null : showToast("Input kosong!");

    try {
        const keyPair = ec.keyFromPrivate(privKey);
        const pubKey = keyPair.getPublic(false, 'hex'); 
        const address = generateAddress(pubKey);

        const savedWallets = JSON.parse(localStorage.getItem('multiWallets') || "[]");
        const walletData = savedWallets.find(w => w.address === address);
        const walletName = walletData ? walletData.name : "Account 1";

        myWallet = { 
            privateKey: privKey, 
            address: address, 
            keyPair: keyPair, 
            publicKey: pubKey,
            name: walletName
        };

        setActiveWallet(privKey, address, keyPair, pubKey);
        saveToMultiWallet(privKey, address, mnemonicUsed); 
        updateWalletSelectorUI();
        showDashboard();
        
        refreshData();
        startAutoRefresh();

    } catch (e) { 
        console.error(e);
        showToast("Key/Phrase Salah!"); 
    }
}

function generateAddress(publicKey) {
    if (typeof publicKey !== 'string') {
        publicKey = publicKey.encode('hex', false);
    }
    let formattedPubKey = publicKey;
    if (publicKey.length === 66) {
        const keyObj = ec.keyFromPublic(publicKey, 'hex');
        formattedPubKey = keyObj.getPublic(false, 'hex');
    }
    const pubKeyBytes = CryptoJS.enc.Hex.parse(formattedPubKey);
    const hash = CryptoJS.SHA256(pubKeyBytes).toString(CryptoJS.enc.Hex);
    return "one" + hash.substring(0, 30);
}

function setActiveWallet(pk, addr, keyPair, pubKey) {
    const saved = JSON.parse(localStorage.getItem('multiWallets') || "[]");
    const walletData = saved.find(w => w.address === addr);
    const walletName = walletData ? walletData.name : "Account 1";

    myWallet = { 
        privateKey: pk, 
        publicKey: pubKey, 
        address: addr, 
        keyPair: keyPair,
        name: walletName 
    };

    localStorage.setItem('oneWalletSession', pk);

    document.getElementById('display-address').innerText = addr.substring(0, 8) + "..." + addr.substring(addr.length - 4);
    document.getElementById('active-wallet-addr').innerText = addr.substring(0, 6) + "..." + addr.substring(addr.length - 4);
    document.getElementById('receive-address').innerText = addr;

    const nameEl = document.getElementById('active-wallet-name');
    if (nameEl) {
        nameEl.innerText = walletName;
    }

    lastKnownBalance = null;
}

function logout() {
    localStorage.removeItem('oneWalletSession');
    location.reload();
}

function goToLogin() {
    closeWalletSelector();
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    document.getElementById('login-view').classList.add('active');
}

async function refreshData() {
    if (!myWallet.address) return;
    
    try {
        const res = await fetch(`${RPC_URL}/balance/${myWallet.address}`, {
            method: 'GET',
            headers: { "ngrok-skip-browser-warning": "69420" }
        });
        
        const data = await res.json();
        const currentBalance = parseFloat(data.liquid || data.balance || 0);

        if (lastKnownBalance !== null && currentBalance > lastKnownBalance) {
            const amountReceived = currentBalance - lastKnownBalance;
            const walletName = myWallet.name || document.getElementById('active-wallet-name').innerText || 'Wallet';
            
            playSuccessSound(); 
            showToast(`Wallet ${walletName} menerima: +${formatONE(amountReceived)} ONE`);
            
            const el = document.getElementById('display-balance');
            el.classList.add('money-in');
            setTimeout(() => el.classList.remove('money-in'), 1500);
        }

        lastKnownBalance = currentBalance;

        document.getElementById('display-balance').innerText = currentBalance.toFixed(10);
        if (document.getElementById('send-display-balance')) {
            document.getElementById('send-display-balance').innerText = formatONE(currentBalance);
        }
        document.getElementById('display-fiat').innerText = `≈ $${(currentBalance * ONE_TO_USD).toFixed(2)} USD`;
        
    } catch (e) { 
        console.error("Refresh failed", e);
    }
    if (typeof refreshHistory === "function") refreshHistory();
}

function playSuccessSound() {
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2013/2013-preview.mp3'); 
    audio.volume = 0.5;
    audio.play().catch(e => console.log("Autoplay blocked by browser"));
}

async function fetchGasPrice() {
    const res = await fetch(`${RPC_URL}/gasPrice`, {
        headers: { "ngrok-skip-browser-warning": "69420" }
    });

    const data = await res.json();

    autoSelectGasPreset(data.mempool, data.gwei);
}

function autoSelectGasPreset(mempool, baseGwei) {
    const slow = Math.max(1, baseGwei);
    const normal = Math.ceil(baseGwei * 1.5);
    const fast = Math.ceil(baseGwei * 2.5);

    const buttons = document.querySelectorAll('.gas-btn');

    buttons[0].innerText = `Lambat (${slow} gwei)`;
    buttons[1].innerText = `Normal (${normal} gwei)`;
    buttons[2].innerText = `Cepat (${fast} gwei)`;

    buttons[0].onclick = () => setGasPreset(slow, buttons[0]);
    buttons[1].onclick = () => setGasPreset(normal, buttons[1]);
    buttons[2].onclick = () => setGasPreset(fast, buttons[2]);

    buttons.forEach(b => b.classList.remove('active'));

    let active;

    if (mempool < 5) active = buttons[0];
    else if (mempool < 15) active = buttons[1];
    else active = buttons[2];

    active.classList.add('active');

    document.getElementById('send-gasPrice').value =
        active === buttons[0] ? slow :
        active === buttons[1] ? normal : fast;

    updateGasFeeDisplay();
}


function showGasStatus(gwei) {
    const el = document.getElementById('display-gas-fee');

    let status = "Sepi";
    let color = "#22c55e";

    if (gwei > 3) {
        status = "Normal";
        color = "#eab308";
    }
    if (gwei > 10) {
        status = "Padat";
        color = "#f97316";
    }
    if (gwei > 20) {
        status = "Ramai";
        color = "#ef4444";
    }

    el.style.color = color;

    showToast(`⛽ Jaringan: ${status} (${gwei} gwei)`);
}

function autoSelectGasPreset(mempool, gwei) {
    const buttons = document.querySelectorAll('.gas-btn');

    buttons.forEach(b => b.classList.remove('active'));

    let target;

    if (mempool < 5) {
        target = buttons[0];
    } else if (mempool < 15) {
        target = buttons[1];
    } else {
        target = buttons[2];
    }

    target.classList.add('active');

    document.getElementById('send-gasPrice').value = gwei;

    updateGasFeeDisplay();
}


setInterval(fetchGasPrice, 3000);


function showSend() { 
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active')); 
    document.getElementById('send-view').classList.add('active'); 

    fetchGasPrice();
}


function updateGasFeeDisplay() {
    const gasPrice = Number(document.getElementById('send-gasPrice').value) || 0;
    const gasLimit = Number(document.getElementById('send-gasLimit').value) || 21000;

    const fee = (gasPrice * gasLimit) / 1e9;

    document.getElementById('display-gas-fee').innerText = formatONE(fee);

    checkGasBalance(fee);
}

function setGasPreset(gwei, btnElement) {
    document.getElementById('send-gasPrice').value = gwei;
    document.querySelectorAll('.gas-btn').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
    let timeEst = gwei < 5 ? "~5-10 menit" : (gwei < 10 ? "~1-2 menit" : "< 30 detik");
    showToast(`Estimasi waktu konfirmasi: ${timeEst}`);
    
    updateGasFeeDisplay();
}

function setGasPreset(gwei, btn) {
    document.getElementById('send-gasPrice').value = gwei;

    document.querySelectorAll('.gas-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    updateGasFeeDisplay();

    const est = gwei < 3 ? "Lambat" : gwei < 10 ? "Normal" : "Cepat";
    showToast(`⛽ Mode gas: ${est}`);
}

function setMaxAmount() {
    const balance = Number(document.getElementById('display-balance').innerText) || 0;

    const gasPrice = Number(document.getElementById('send-gasPrice').value) || 0;
    const gasLimit = Number(document.getElementById('send-gasLimit').value) || 21000;

    const gasFee = (gasPrice * gasLimit) / 1e9;

    let maxSend = balance - gasFee;

    if (maxSend <= 0) {
        showToast("❌ Saldo habis buat gas fee!");
        document.getElementById('send-amount').value = 0;
        return;
    }
    maxSend = Math.floor(maxSend * 1e8) / 1e8;

    document.getElementById('send-amount').value = maxSend;

    validateSend();
}

function validateSend() {
    const balance = Number(document.getElementById('display-balance').innerText) || 0;
    const amount = Number(document.getElementById('send-amount').value) || 0;

    const gasPrice = Number(document.getElementById('send-gasPrice').value) || 0;
    const gasLimit = Number(document.getElementById('send-gasLimit').value) || 21000;

    const gasFee = (gasPrice * gasLimit) / 1e9;

    const sendBtn = document.querySelector('#send-view .btn:not(.btn-outline)');

    if (amount + gasFee > balance || amount <= 0) {
        sendBtn.disabled = true;
        sendBtn.style.opacity = 0.5;
    } else {
        sendBtn.disabled = false;
        sendBtn.style.opacity = 1;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    ['send-amount','send-gasPrice','send-gasLimit'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', validateSend);
    });
});


function showDashboard() { 
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active')); 
    document.getElementById('dashboard-view').classList.add('active'); 
}

function showSend() { 
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active')); 
    document.getElementById('send-view').classList.add('active'); 
}

function showReceive() { 
    document.getElementById('qr-code-img').src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${myWallet.address}`;
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active')); 
    document.getElementById('receive-view').classList.add('active'); 
}

function showToast(msg) { 
    const t = document.getElementById('toast'); 
    t.innerHTML = msg;
    t.classList.add('show-toast'); 
    setTimeout(() => t.classList.remove('show-toast'), 3000); 
}

function copyAddress(elementId) { 
    const text = elementId === 'display-address' ? myWallet.address : document.getElementById(elementId).innerText;
    navigator.clipboard.writeText(text).then(() => {
        showToast("📋 Alamat tersalin!"); 
    });
}

function calculateHash(tx) {
    const amountStr = tx.amount.toString();
    const gasPriceStr = tx.gasPrice.toString();
    const data = (tx.fromAddress || "") + 
                 tx.toAddress + 
                 amountStr + 
                 gasPriceStr +
                 tx.gasLimit + 
                 tx.type + 
                 tx.nonce + 
                 tx.timestamp + 
                 JSON.stringify(tx.tokenData || {});
    
    return CryptoJS.SHA256(data).toString();
}

function createOneWallet() {
    const mnemonic = generateNewMnemonic(); 
    const priv = getPrivateKeyFromMnemonic(mnemonic);
    const keyPair = ec.keyFromPrivate(priv);
    const pubKey = keyPair.getPublic(false, 'hex');
    const addr = generateAddress(pubKey);
    document.getElementById('new-phrase').innerText = mnemonic;
    document.getElementById('new-priv').innerText = priv;
    document.getElementById('new-wallet-info').style.display = 'block';
    saveToMultiWallet(priv, addr, mnemonic);
}

function switchLoginTab(mode) {
    currentLoginMode = mode;
    document.querySelectorAll('.btn-tab').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById('input-pk-container').style.display = mode === 'pk' ? 'block' : 'none';
    document.getElementById('input-phrase-container').style.display = mode === 'phrase' ? 'block' : 'none';
}

async function sendTransaction() {
    const sendBtn = document.querySelector('#modal-send .btn') || document.querySelector('button[onclick="sendTransaction()"]');
    
    const to = document.getElementById('send-to').value.trim();
    const amountInput = document.getElementById('send-amount').value;
    const amountNum = parseFloat(amountInput);
    const gasPriceGwei = parseInt(document.getElementById('send-gasPrice').value) || 1;
    const gasLimit = parseInt(document.getElementById('send-gasLimit').value) || 21000;

    if (!to || isNaN(amountNum) || amountNum <= 0) {
        return showToast("❌ Masukkan alamat dan jumlah yang valid!");
    }

    const currentBalance = parseFloat(document.getElementById('display-balance').innerText) || 0;
    const estimatedFee = (gasPriceGwei * gasLimit) / 1e9;
    const totalCost = amountNum + estimatedFee;

    if (totalCost > currentBalance) {
        return showToast(`❌ Saldo kurang! Butuh: ${formatONE(totalCost)} ONE`);
    }

    if (!to.startsWith('one')) {
        return showToast("❌ Alamat tujuan harus berawalan 'one'!");
    }

    try {
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.innerHTML = '<span class="toast-spinner">⏳</span> Memproses<span class="loading-dots"></span>';
        }

        showToast("<span class='toast-spinner'>⏳</span> Menyiapkan transaksi<span class='loading-dots'></span>");

        await new Promise(resolve => setTimeout(resolve, 3000));
        const nonceRes = await fetch(`${RPC_URL}/nonce/${myWallet.address}`, {
            headers: { "ngrok-skip-browser-warning": "69420" }
        });

        const nonceData = await nonceRes.json();
        const serverNonce = parseInt(nonceData.nextNonce) || 0;
        if (pendingNonce === null || pendingNonce < serverNonce) {
            pendingNonce = serverNonce;
        } else {
            pendingNonce++;
        }

        const tx = {
            fromAddress: myWallet.address,
            toAddress: to,
            amount: BigInt(Math.round(amountNum * 1e18)).toString(), 
            gasPrice: gasPriceGwei.toString(),
            type: "TRANSFER",
            nonce: pendingNonce,
            timestamp: Date.now(),
            tokenData: {},
            gasLimit: gasLimit
        };

        const txHash = calculateHash(tx);
        const signature = myWallet.keyPair.sign(txHash).toDER('hex');
        const payload = { 
            ...tx, 
            senderPublicKey: myWallet.publicKey, 
            signature: signature, 
            hash: txHash 
        };

        const broadcastRes = await fetch(`${RPC_URL}/broadcast`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                "ngrok-skip-browser-warning": "69420"
            },
            body: JSON.stringify(payload)
        });

        if (!broadcastRes.ok) {
            throw new Error(`Server Merespon ${broadcastRes.status}`);
        }

        const result = await broadcastRes.json();
        
        if (result.success || result.hash) {
            const txLog = {
                hash: result.hash || txHash,
                toAddress: to,
                fromAddress: myWallet.address,
                amount: amountNum, 
                nonce: tx.nonce,
                timestamp: tx.timestamp,
                status: 'Sent (Pending)'
            };
            
            saveToLocalHistory(txLog);
            
            showToast(`✅ Transaksi Terkirim!`);
            showDashboard();
            setTimeout(refreshData, 5000);
            
            document.getElementById('send-to').value = '';
            document.getElementById('send-amount').value = '';
            
        } else {
            pendingNonce = null; 
            showToast("❌ Gagal: " + (result.error || "Ditolak oleh Node")); 
        }

    } catch (e) {
        console.error("Send Error Details:", e);
        
        if (e.message.includes('Unexpected token')) {
            showToast("⚠️ Transaksi mungkin terkirim (Respon RPC tidak valid)");
            closeModal('modal-send');
            setTimeout(refreshData, 5000);
        } else {
            showToast("❌ RPC Error: " + e.message);
        }
        
        pendingNonce = null;
    } finally {
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerText = 'Kirim';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('send-gasPrice')?.addEventListener('input', updateGasFeeDisplay);
    document.getElementById('send-gasLimit')?.addEventListener('input', updateGasFeeDisplay);
});

window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closeWalletSelector();
        closeRenameModal();
    }
});

async function startScan() {
    const video = document.getElementById("video");
    try {
        videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.srcObject = videoStream;
        video.setAttribute("playsinline", true);
        video.play();
        document.getElementById("scanner-container").style.display = "block";
        requestAnimationFrame(tick);
    } catch (err) { showToast("❌ Kamera Gagal!"); }
}

function stopScan() {
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        document.getElementById("scanner-container").style.display = "none";
    }
}

function tick() {
    const video = document.getElementById("video");
    const canvasElement = document.getElementById("canvas");
    const canvas = canvasElement.getContext("2d");
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvasElement.height = video.videoHeight;
        canvasElement.width = video.videoWidth;
        canvas.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);
        const imageData = canvas.getImageData(0, 0, canvasElement.width, canvasElement.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data.startsWith("one")) {
            document.getElementById("send-to").value = code.data;
            stopScan();
            return;
        }
    }
    if (document.getElementById("scanner-container").style.display !== "none") requestAnimationFrame(tick);
}

function openImportModal() {
    closeWalletSelector();
    document.getElementById('modal-import').style.display = 'flex';
    document.getElementById('import-pk-input').value = '';
    document.getElementById('import-phrase-input').value = '';
    switchImportTab('pk');
}

function encryptAndSave(privateKey, password) {
    const encrypted = CryptoJS.AES.encrypt(privateKey, password).toString();
    localStorage.setItem('oneWalletSession', encrypted);
}

function decryptKey(password) {
    const encrypted = localStorage.getItem('oneWalletSession');
    const bytes = CryptoJS.AES.decrypt(encrypted, password);
    return bytes.toString(CryptoJS.enc.Utf8);
}

function checkSessionTimeout() {
    const loginTime = localStorage.getItem('lastActivity');
    const TIMEOUT = 15 * 60 * 1000;
    if (Date.now() - loginTime > TIMEOUT) {
        logout();
        alert("Sesi berakhir demi keamanan.");
    }
}

function isValidAddress(address) {
    if (!address.startsWith('one')) return false;
    const addressRegex = /^one[a-f0-9]{30}$/;
    return addressRegex.test(address);
}

function openBackupModal() {
    if (!myWallet.address) return showToast("❌ Login dulu!");

    document.getElementById('backup-quest-1').style.display = 'block';
    document.getElementById('backup-quest-2').style.display = 'none';
    document.getElementById('backup-main-data').style.display = 'none';

    const savedWallets = JSON.parse(localStorage.getItem('multiWallets') || "[]");
    const currentAccount = savedWallets.find(w => w.address.toLowerCase() === myWallet.address.toLowerCase());
    
    document.getElementById('backup-priv').innerText = myWallet.privateKey;
    const phraseDisplay = document.getElementById('backup-phrase');
    phraseDisplay.innerText = (currentAccount && currentAccount.mnemonic) ? currentAccount.mnemonic : "Mnemonic tidak tersedia.";
    
    document.getElementById('modal-backup').style.display = 'flex';
}

function handleQuestBackup(step, isCorrect) {
    if (!isCorrect) {
        showToast("❌ JAWABAN SALAH! Akses ditolak.");
        if (window.navigator.vibrate) window.navigator.vibrate([200, 100, 200]); 
        setTimeout(closeBackupModal, 1000);
        return;
    }

    if (window.navigator.vibrate) window.navigator.vibrate(50); 

    if (step === 1) {
        showToast("✅ Benar! Lanjut ke pertanyaan terakhir.");
        document.getElementById('backup-quest-1').style.display = 'none';
        document.getElementById('backup-quest-2').style.display = 'block';
    } else if (step === 2) {
        showToast("🔥 Sempurna! Anda lulus uji keamanan.");
        document.getElementById('backup-quest-2').style.display = 'none';
        document.getElementById('backup-main-data').style.display = 'block';
    }
}

function closeBackupModal() {
    document.getElementById('modal-backup').style.display = 'none';
}

function copyToClipboard(elementId) {
    const text = document.getElementById(elementId).innerText;
    if (text.includes("tidak tersedia")) return;

    navigator.clipboard.writeText(text).then(() => {
        hapticFeedback('success');
        showToast("✅ Berhasil disalin!");
        
        setTimeout(() => {
        }, 30000);
    });
}

async function refreshHistory() {
    const historyContainer = document.getElementById('tx-history');
    if (!myWallet.address) return;
    const EXPLORER_API = `${RPC_URL}/api/blocks`; 

    try {
        const response = await fetch(EXPLORER_API, {
            headers: { 
                "ngrok-skip-browser-warning": "69420",
                "Content-Type": "application/json"
            }
        });
        
        if (!response.ok) throw new Error("Gagal mengambil data dari Explorer");
        
        const blocks = await response.json();
        let myTransactions = [];
        blocks.forEach(block => {
            if (block.transactions && Array.isArray(block.transactions)) {
                block.transactions.forEach(tx => {
                    const from = tx.fromAddress || tx.from;
                    const to = tx.toAddress || tx.to;

                    if (from === myWallet.address || to === myWallet.address) {
                        myTransactions.push({
                            ...tx,
                            fromAddress: from,
                            toAddress: to,
                            timestamp: tx.timestamp || block.timestamp
                        });
                    }
                });
            }
        });

        if (myTransactions.length === 0) {
            historyContainer.innerHTML = '<div class="text-center" style="margin-top: 20px; color: #94a3b8; font-size: 13px;">Belum ada riwayat transaksi</div>';
            return;
        }

        historyContainer.innerHTML = myTransactions.map(tx => {
            const isSent = tx.fromAddress === myWallet.address;
            const typeLabel = isSent ? 'Kirim' : 'Terima';
            const typeColor = isSent ? '#ef4444' : '#10b981';
            const typeIcon = isSent ? '↗' : '↙';
            const displayAddr = isSent ? tx.toAddress : tx.fromAddress;
            const rawAmount = parseFloat(tx.amount);
            const amountFormatted = formatONE(tx.amount);

            return `
                <div onclick='showTxDetail(${JSON.stringify(tx)})' 
                     style="display: flex; justify-content: space-between; align-items: center; padding: 12px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; transition: 0.2s;"
                     onmouseover="this.style.background='rgba(255,255,255,0.02)'" 
                     onmouseout="this.style.background='transparent'">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="background: ${isSent ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)'}; 
                                    color: ${typeColor}; width: 35px; height: 35px; border-radius: 10px; 
                                    display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: bold;">
                            ${typeIcon}
                        </div>
                        <div>
                            <div style="color: #f8fafc; font-weight: 600; font-size: 13px;">${typeLabel}</div>
                            <small style="color: #94a3b8; font-family: monospace;">
                                ${displayAddr ? (displayAddr.substring(0, 8) + '...') : 'System'}
                            </small>
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <div style="color: ${typeColor}; font-weight: 700; font-size: 14px;">
                            ${isSent ? '-' : '+'}${amountFormatted} ONE
                        </div>
                        <small style="color: #94a3b8; font-size: 10px;">
                            ${new Date(tx.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </small>
                    </div>
                </div>
            `;
        }).join('');

    } catch (e) {
        console.error("Scanning Error:", e);
        historyContainer.innerHTML = `
            <div class="text-center" style="padding: 20px;">
                <p style="color: #ef4444; font-size: 12px;">Gagal terhubung ke Explorer API</p>
            </div>`;
    }
}

function renderScannedHistory(transactions) {
    const container = document.getElementById('tx-history');
    if (!container) return;
    transactions.sort((a, b) => b.timestamp - a.timestamp);

    container.innerHTML = transactions.map(tx => {
        const isSent = tx.fromAddress === myWallet.address;
        const typeLabel = isSent ? 'Kirim' : 'Terima';
        const typeColor = isSent ? '#ef4444' : '#10b981';
        const typeIcon = isSent ? '↗' : '↙';
        const displayAddr = isSent ? (tx.toAddress || "Unknown") : (tx.fromAddress || "Unknown");
        const amount = formatONE(tx.amount);

        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #1e293b; cursor: pointer;" 
                 onclick="showTransactionDetail('${tx.hash}')">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="background: ${isSent ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)'}; 
                                color: ${typeColor}; width: 32px; height: 32px; border-radius: 8px; 
                                display: flex; align-items: center; justify-content: center; font-weight: bold;">
                        ${typeIcon}
                    </div>
                    <div>
                        <div style="color: var(--text); font-weight: 600; font-size: 13px;">${typeLabel}</div>
                        <small class="text-muted" style="font-family: monospace;">${displayAddr.substring(0, 8)}...</small>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="color: ${typeColor}; font-weight: 700; font-size: 13px;">
                        ${isSent ? '-' : '+'}${amount} ONE
                    </div>
                    <small class="text-muted" style="font-size: 10px;">${new Date(tx.timestamp).getHours().toString().padStart(2, '0')}.${new Date(tx.timestamp).getMinutes().toString().padStart(2, '0')}</small>
                </div>
            </div>
        `;
    }).join('');
}

function showTxDetail(tx) {
    const container = document.getElementById('tx-detail-content');
    const isSent = tx.fromAddress === myWallet.address;
    
    const date = new Date(tx.timestamp).toLocaleString('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short'
    });

    const gasPrice = tx.gasPrice || 0;
    const gasLimit = tx.gasLimit || 0;
    const gasUsed = tx.gasUsed || gasLimit; 
    const totalGasFee = (parseFloat(gasPrice) * parseFloat(gasUsed)) / 1e18;

    container.innerHTML = `
        <div style="text-align: center; margin-bottom: 20px;">
            <div style="font-size: 24px; font-weight: bold; color: ${isSent ? '#ef4444' : '#10b981'};">
                ${isSent ? '-' : '+'}${formatONE(tx.amount)} ONE
            </div>
            <div style="color: var(--text-muted); font-size: 12px;">${tx.status || 'Success'}</div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 12px; background: rgba(0,0,0,0.2); padding: 15px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
            <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-muted); font-size: 11px;">Waktu</span>
                <span style="font-size: 12px;">${date}</span>
            </div>
            
            <div style="border-top: 1px solid rgba(255,255,255,0.05); pt-10">
                <div style="color: var(--text-muted); font-size: 11px; margin-bottom: 4px;">Dari</div>
                <div style="word-break: break-all; font-family: monospace; font-size: 11px;">${tx.fromAddress}</div>
            </div>

            <div style="border-top: 1px solid rgba(255,255,255,0.05); pt-10">
                <div style="color: var(--text-muted); font-size: 11px; margin-bottom: 4px;">Ke</div>
                <div style="word-break: break-all; font-family: monospace; font-size: 11px;">${tx.toAddress}</div>
            </div>

            <div style="border-top: 1px solid rgba(255,255,255,0.05); pt-10; display: flex; justify-content: space-between;">
                <span style="color: var(--text-muted); font-size: 11px;">Biaya Gas</span>
                <span style="font-size: 12px; color: #94a3b8;">${formatONE(totalGasFee)} ONE</span>
            </div>

            <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-muted); font-size: 11px;">Nonce</span>
                <span style="font-size: 12px;">#${tx.nonce}</span>
            </div>
            
            <div style="border-top: 1px solid rgba(255,255,255,0.05); pt-10">
                <div style="color: var(--text-muted); font-size: 11px; margin-bottom: 4px;">Hash Transaksi</div>
                <div style="word-break: break-all; font-family: monospace; font-size: 10px; color: var(--primary);">${tx.hash}</div>
            </div>
        </div>
    `;

    document.getElementById('modal-tx-detail').style.display = 'flex';
}

function copyToClipboardText(text) {
    if (!text || text === 'N/A') return;
    navigator.clipboard.writeText(text).then(() => {
        showToast("✅ Hash tersalin!");
    });
}

function saveToLocalHistory(tx) {
    let history = JSON.parse(localStorage.getItem(`history_${myWallet.address}`) || "[]");
    history.unshift(tx);
    localStorage.setItem(`history_${myWallet.address}`, JSON.stringify(history.slice(0, 10)));
    renderHistory();
}

function renderHistory() {
    const container = document.getElementById('tx-history');
    const history = JSON.parse(localStorage.getItem(`history_${myWallet.address}`) || "[]");
    
    if (history.length === 0) {
        container.innerHTML = '<div class="text-center" style="margin-top: 15px;">Belum ada transaksi</div>';
        return;
    }

    container.innerHTML = history.map(tx => `
        <div style="display:flex; justify-content:space-between; margin-bottom:10px; padding-bottom:5px; border-bottom:1px solid #334155">
            <div>
                <div style="color:var(--text)">${tx.toAddress.substring(0,10)}...</div>
                <small class="text-muted">${new Date(tx.timestamp).toLocaleTimeString()}</small>
            </div>
            <div style="text-align:right">
                <div style="color:var(--primary)">-${tx.amount} ONE</div>
                <small style="color:var(--success)">${tx.status}</small>
            </div>
        </div>
    `).join('');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal && modal.style) {
        modal.style.display = 'none';
    } else {
        console.warn(`Element dengan ID ${modalId} tidak ditemukan untuk ditutup.`);
    }
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'flex';
    }
}

function toggleBalancePrivacy() {
    const balanceEl = document.getElementById('display-balance');
    isBalanceHidden = !isBalanceHidden;
    
    if (isBalanceHidden) {
        balanceEl.classList.add('balance-hidden');
        localStorage.setItem('privacy_mode', 'true');
    } else {
        balanceEl.classList.remove('balance-hidden');
        localStorage.setItem('privacy_mode', 'false');
    }
}

function addToAddressBook(address) {
    let contacts = JSON.parse(localStorage.getItem('contacts') || "[]");
    if (!contacts.includes(address)) {
        contacts.push(address);
        localStorage.setItem('contacts', JSON.stringify(contacts.slice(-5)));
    }
}

function validateTargetAddress(addr) {
    const warning = document.getElementById('address-warning');
    if (addr.length > 0 && !addr.startsWith('one')) {
        warning.style.display = 'block';
    } else {
        warning.style.display = 'none';
    }
}

function renderDAppList() {
    const container = document.getElementById('dapp-list');
    if (!container) return;

    const approvedDApps = JSON.parse(localStorage.getItem('approved_dapps') || "{}");
    const origins = Object.keys(approvedDApps);

    if (origins.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:20px; color:var(--text-muted);">
                <p>Tidak ada aplikasi terhubung</p>
            </div>`;
        return;
    }

    container.innerHTML = origins.map(origin => `
        <div class="dapp-item" style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid var(--border); background:rgba(255,255,255,0.02); margin-bottom:8px; border-radius:12px;">
            <div style="display:flex; flex-direction:column;">
                <span style="font-weight:600; font-size:14px;">${origin.replace(/^https?:\/\//, '')}</span>
                <small style="color:var(--text-muted); font-size:11px;">Terhubung: ${new Date(approvedDApps[origin].connectedAt).toLocaleDateString()}</small>
            </div>
            <button onclick="disconnectDApp('${origin}')" class="btn-danger" style="padding:6px 12px; font-size:12px; border-radius:8px;">
                Disconnect
            </button>
        </div>
    `).join('');
}

function disconnectDApp(origin) {
    if (confirm(`Putuskan koneksi dari ${origin}?`)) {
        let approvedDApps = JSON.parse(localStorage.getItem('approved_dapps') || "{}");
        delete approvedDApps[origin];
        localStorage.setItem('approved_dapps', JSON.stringify(approvedDApps));
        renderDAppList();
        showToast("Koneksi diputus.");
        window.dispatchEvent(new Event('storage'));
    }
}

function openDAppModal() {
    renderDAppList();
    document.getElementById('modal-dapps').style.display = 'flex';
}

function openRPCModal() {
    document.getElementById('rpc-url-input').value = RPC_URL;
    document.getElementById('modal-rpc').style.display = 'flex';
}

function saveRPC() {
    const newRpc = document.getElementById('rpc-url-input').value.trim();
    if (!newRpc) return showToast("❌ URL RPC tidak boleh kosong!");
    
    try {
        new URL(newRpc); 
        localStorage.setItem('custom_rpc_url', newRpc);
        RPC_URL = newRpc;
        showToast("✅ RPC Berhasil diperbarui!");
        closeModal('modal-rpc');
        refreshData(); 
    } catch (e) {
        showToast("❌ Format URL tidak valid!");
    }
}

function resetRPC() {
    const defaultRpc = 'http://localhost:7001';
    localStorage.removeItem('custom_rpc_url');
    RPC_URL = defaultRpc;
    document.getElementById('rpc-url-input').value = RPC_URL;
    showToast("🔄 RPC dikembalikan ke default");
    refreshData();
}

function toggleOwnWallets() {
    const listDiv = document.getElementById('own-wallets-list');
    
    if (listDiv.style.display === 'none') {
        listDiv.style.display = 'block';
        listDiv.innerHTML = ''; 

        const otherWallets = walletList.filter(w => w.address !== myWallet.address);

        if (otherWallets.length === 0) {
            listDiv.innerHTML = '<div style="padding: 10px; font-size: 11px; color: var(--text-muted);">Tidak ada akun lain tersimpan.</div>';
            return;
        }

        otherWallets.forEach(w => {
            const item = document.createElement('div');
            item.style = "padding: 8px 12px; border-bottom: 1px solid var(--card); cursor: pointer; font-size: 12px; transition: 0.2s;";
            item.innerHTML = `
                <div style="font-weight: 600; color: var(--text);">${w.name || 'Account'}</div>
                <div style="font-size: 10px; color: var(--text-muted); opacity: 0.8;">${w.address}</div>
            `;
            
            item.onclick = () => {
                document.getElementById('send-to').value = w.address;
                listDiv.style.display = 'none';
                showToast(`✅ Alamat ${w.name} dipilih`);
            };

            item.onmouseover = () => item.style.backgroundColor = 'var(--card)';
            item.onmouseout = () => item.style.backgroundColor = 'transparent';
            
            listDiv.appendChild(item);
        });
    } else {
        listDiv.style.display = 'none';
    }
}

let autoRefreshInterval = null;

function startAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    
    autoRefreshInterval = setInterval(() => {
        if (document.visibilityState === 'visible' && myWallet.address) {
            refreshData();
        }
    }, 10000);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

startAutoRefresh();

const el = document.getElementById('display-balance');
if (el) {
    el.classList.add('money-in');
    setTimeout(() => el.classList.remove('money-in'), 1500);
}

function hapticFeedback(type = 'light') {
    if (!window.navigator.vibrate) return;
    
    if (type === 'light') {
        window.navigator.vibrate(20); 
    } else if (type === 'success') {
        window.navigator.vibrate([30, 50, 30]); 
    } else if (type === 'error') {
        window.navigator.vibrate([100, 50, 100]); 
    }
}

function changeScreen(screenId) {
    hapticFeedback('light'); 
    
    document.querySelectorAll('.screen').forEach(el => {
        el.classList.remove('active');
        el.style.display = 'none';
    });

    const target = document.getElementById(screenId);
    target.style.display = 'block';
    
    setTimeout(() => {
        target.classList.add('active');
    }, 10);
}

function checkPendingRequests() {
    const reqRaw = localStorage.getItem('one_pending_request');
    if (reqRaw) {
        try {
            const requestData = JSON.parse(reqRaw);
            if (!currentRequest || currentRequest.id !== requestData.id) {
                showApproveModal(requestData);
            }
        } catch (e) {
            console.error("Format request salah", e);
        }
    }
}

setInterval(checkPendingRequests, 1000);

function showApproveModal(request) {
    currentRequest = request;
    const modal = document.getElementById('modal-approve');
    const title = document.getElementById('approve-title');
    const content = document.getElementById('approve-content');
    
    modal.style.display = 'flex';
    
    if (request.type === 'CONNECT' || request.type === 'APPROVE_CONNECTION') {
        title.innerText = "Permintaan Koneksi DApp";
        content.innerHTML = `<p>Website <b>${request.origin}</b> ingin terhubung dengan alamat Anda.</p>`;
    } else if (request.type === 'TRANSFER' || request.type === 'SEND_TX' || request.type === 'CONTRACT_DEPLOY') {
        title.innerText = "Konfirmasi Transaksi DApp";
        const tx = request.data || {};
        content.innerHTML = `
            <p><b>Ke:</b> <span style="font-family: monospace; font-size: 11px;">${tx.toAddress || tx.to || "Contract Deployment"}</span></p>
            <p><b>Jumlah:</b> ${tx.amount || 0} ONE</p>
            <p><b>Tipe:</b> ${request.type}</p>
            <hr style="border: 0.5px solid var(--border); margin: 10px 0;">
            <small>DApp Origin: ${request.origin || 'Unknown'}</small>
        `;
    }
}

async function handleApprove() {
    if (!currentRequest) return;
    const reqId = currentRequest.id || currentRequest.txId;
    
    try {
        if (currentRequest.type === 'CONNECT' || currentRequest.type === 'APPROVE_CONNECTION') {
            const approvedDApps = JSON.parse(localStorage.getItem('approved_dapps') || "{}");
            approvedDApps[currentRequest.origin] = {
                connectedAt: Date.now(),
                address: myWallet.address
            };
            localStorage.setItem('approved_dapps', JSON.stringify(approvedDApps));
            
            localStorage.setItem(`one_res_${reqId}`, JSON.stringify({ 
                success: true,
                address: myWallet.address 
            }));
            showToast("Koneksi Berhasil!");
        }
        else if (currentRequest.type === 'TRANSFER' || currentRequest.type === 'SEND_TX' || currentRequest.type === 'CONTRACT_DEPLOY') {
            const txData = currentRequest.data;
            const amountNum = parseFloat(txData.amount || 0);
            const to = txData.toAddress || txData.to || "";
            const gasPriceGwei = parseInt(txData.gasPrice) || 1;
            const gasLimit = parseInt(txData.gasLimit) || 21000;

            const nonceRes = await fetch(`${RPC_URL}/nonce/${myWallet.address}`, {
                headers: { "ngrok-skip-browser-warning": "69420" }
            });
            const nonceData = await nonceRes.json();
            const serverNonce = parseInt(nonceData.nonce) || 0;

            if (pendingNonce === null || pendingNonce < serverNonce) pendingNonce = serverNonce;
            else pendingNonce++;
            
            const finalType = txData.type || currentRequest.type || "TRANSFER";

const tx = {
    fromAddress: myWallet.address,
    toAddress: to,
    amount: BigInt(Math.round(amountNum * 1e18)).toString(), 
    gasPrice: gasPriceGwei.toString(),
    type: finalType,
    nonce: pendingNonce,
    timestamp: Date.now(),
    tokenData: txData.tokenData || {}, 
    gasLimit: gasLimit
};
            const txHash = calculateHash(tx);
            const signature = myWallet.keyPair.sign(txHash).toDER('hex');
            const payload = { 
                ...tx, 
                senderPublicKey: myWallet.publicKey, 
                signature: signature, 
                hash: txHash 
            };

            const broadcastRes = await fetch(`${RPC_URL}/broadcast`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    "ngrok-skip-browser-warning": "69420"
                },
                body: JSON.stringify(payload)
            });

            if (!broadcastRes.ok) throw new Error("Gagal broadcast ke RPC");

            const result = await broadcastRes.json();
            
            if (result.success || result.hash) {
                localStorage.setItem(`one_res_${reqId}`, JSON.stringify({
                    success: true,
                    hash: result.hash || txHash
                }));
                showToast("✅ Transaksi DApp Berhasil!");
                setTimeout(refreshData, 3000);
            } else {
                pendingNonce = null;
                throw new Error(result.error || "Ditolak oleh Node");
            }
        }
    } catch (e) {
        localStorage.setItem(`one_res_${reqId}`, JSON.stringify({
            success: false,
            error: e.message
        }));
        showToast("❌ Gagal: " + e.message);
    }

    closeApproveModal();
}

function handleReject() {
    if (currentRequest) {
        const reqId = currentRequest.id || currentRequest.txId;
        localStorage.setItem(`one_res_${reqId}`, JSON.stringify({
            success: false,
            error: "User menolak permintaan"
        }));
    }
    showToast("Permintaan ditolak.");
    closeApproveModal();
}

function closeApproveModal() {
    localStorage.removeItem('one_pending_request');
    document.getElementById('modal-approve').style.display = 'none';
    currentRequest = null;
}
