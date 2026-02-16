window.global = window;
window.Buffer = window.Buffer || buffer.Buffer;
window.process = { env: {} };

let walletList = [];
const bip39 = window.bip39;
const ENCRYPTION_KEY_PREFIX = "one_wallet_auth_";
let isBalanceHidden = false;
let videoStream = null;
let currentLoginMode = 'pk';
let currentImportMode = 'pk';
const RPC_URL = 'https://regardlessly-foundationary-tawanda.ngrok-free.dev'; // local http://localhost:7001
const ec = new elliptic.ec('secp256k1');
let myWallet = { privateKey: null, publicKey: null, address: null, keyPair: null };
let pendingNonce = null;
let currentPendingDApp = null;
const ONE_TO_USD = 0.1; 

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
        const short = current.address.substring(0, 6) + "..." + current.address.substring(current.address.length - 4);
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

    if (!privKey) return isAuto ? null : showToast("Input kosong!");

    try {
        const keyPair = ec.keyFromPrivate(privKey);
        const pubKey = keyPair.getPublic(false, 'hex'); 
        const address = generateAddress(pubKey);
    setActiveWallet(privKey, address, keyPair, pubKey);
    saveToMultiWallet(privKey, address, mnemonicUsed); 
    updateWalletSelectorUI();
    showDashboard();
    refreshData();
    } catch (e) { 
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
    myWallet = { privateKey: pk, publicKey: pubKey, address: addr, keyPair: keyPair };
    localStorage.setItem('oneWalletSession', pk);
    document.getElementById('display-address').innerText = addr.substring(0, 8) + "..." + addr.substring(addr.length - 4);
    document.getElementById('receive-address').innerText = addr;
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
            headers: {
                "ngrok-skip-browser-warning": "69420"
            }
        });
        const data = await res.json();
        const balance = parseFloat(data.liquid || 0);
        document.getElementById('display-balance').innerText = balance.toFixed(4);
        document.getElementById('send-display-balance').innerText = balance.toFixed(4);
        document.getElementById('display-fiat').innerText = `≈ $${(balance * ONE_TO_USD).toFixed(2)} USD`;
    } catch (e) { 
        document.getElementById('display-balance').innerText = "0.0000";
        document.getElementById('send-display-balance').innerText = "0.0000";
    }
    refreshHistory();
}

function updateGasFeeDisplay() {
    const price = parseFloat(document.getElementById('send-gasPrice').value) || 0;
    const limit = parseFloat(document.getElementById('send-gasLimit').value) || 0;
    const totalFee = (price * limit) / 1e9;
    document.getElementById('display-gas-fee').innerText = totalFee.toFixed(9).replace(/\.?0+$/, "");
}

function setGasPreset(gwei, btnElement) {
    document.getElementById('send-gasPrice').value = gwei;
    document.querySelectorAll('.gas-btn').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
    let timeEst = gwei < 5 ? "~5-10 menit" : (gwei < 10 ? "~1-2 menit" : "< 30 detik");
    showToast(`Estimasi waktu konfirmasi: ${timeEst}`);
    
    updateGasFeeDisplay();
}

function setMaxAmount() {
    const currentBalance = parseFloat(document.getElementById('display-balance').innerText) || 0;
    const estimatedFee = (parseFloat(document.getElementById('send-gasPrice').value) * parseInt(document.getElementById('send-gasLimit').value)) / 1e9;
    let max = currentBalance - estimatedFee;
    if (max <= 0) return showToast("❌ Saldo tidak cukup bayar gas!");
    document.getElementById('send-amount').value = (Math.floor(max * 10000) / 10000).toFixed(4);
}

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
    t.innerText = msg; 
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
    const data = (tx.fromAddress || "") + tx.toAddress + tx.amount + tx.gasPrice + tx.gasLimit + tx.type + tx.nonce + tx.timestamp + JSON.stringify(tx.tokenData || {});
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
        return showToast(`❌ Saldo kurang! Butuh: ${totalCost.toFixed(6)} ONE`);
    }

    if (!to.startsWith('one')) {
        return showToast("❌ Alamat tujuan harus berawalan 'one'!");
    }

    try {
        showToast("⏳ Menyiapkan transaksi...");

        const nonceRes = await fetch(`${RPC_URL}/nonce/${myWallet.address}`, {headers: { "ngrok-skip-browser-warning": "69420" }});
        const nonceData = await nonceRes.json();
        const serverNonce = parseInt(nonceData.nonce) || 0;
        if (pendingNonce === null || pendingNonce < serverNonce) {
            pendingNonce = serverNonce;
        } else {
            pendingNonce++;
        }

        const tx = {
            fromAddress: myWallet.address,
            toAddress: to,
            amount: BigInt(Math.round(amountNum * 1e9)).toString(), 
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

        const broadcastRes = await fetch(`${RPC_URL}/broadcast`, {method: 'POST',headers: { 'Content-Type': 'application/json',"ngrok-skip-browser-warning": "69420"},
            body: JSON.stringify(payload)});

        const result = await broadcastRes.json();
        
        if (result.success) {
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
            
            showToast(`✅ Transaksi Terkirim! (Nonce: ${tx.nonce})`);
            closeModal('modal-send');
            setTimeout(refreshData, 1000); 
        } else {
            pendingNonce = null;
            showToast("❌ Gagal: " + result.error); 
        }
    } catch (e) {
        pendingNonce = null;
        console.error("Send Error:", e);
        showToast("❌ System Error: Gagal terhubung ke RPC"); 
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
    if (!myWallet.address) return showToast("❌ Silahkan login terlebih dahulu");
    const savedWallets = JSON.parse(localStorage.getItem('multiWallets') || "[]");
    const currentAccount = savedWallets.find(w => w.address.toLowerCase() === myWallet.address.toLowerCase());
    const phraseDisplay = document.getElementById('backup-phrase');
    const privDisplay = document.getElementById('backup-priv');
    privDisplay.innerText = myWallet.privateKey;
    if (currentAccount && currentAccount.mnemonic) {
        phraseDisplay.innerText = currentAccount.mnemonic;
        phraseDisplay.style.color = "var(--text)";
    } else {
        phraseDisplay.innerText = "Mnemonic tidak tersedia (Hanya tersedia jika wallet dibuat/diimpor via Phrase)";
        phraseDisplay.style.color = "var(--text-muted)"; 
    }
    
    document.getElementById('modal-backup').style.display = 'flex';
}

function closeBackupModal() {
    document.getElementById('modal-backup').style.display = 'none';
}

function copyToClipboard(elementId) {
    const element = document.getElementById(elementId);
    const text = element.innerText;
    if (text.includes("tidak tersedia") || !text) {
        return showToast("❌ Tidak ada data untuk disalin");
    }
    
    navigator.clipboard.writeText(text).then(() => {
        showToast("✅ Berhasil disalin!");
    }).catch(err => {
        console.error('Gagal menyalin:', err);
        showToast("❌ Gagal menyalin ke clipboard");
    });
}

async function refreshHistory() {
    const historyContainer = document.getElementById('tx-history');
    if (!myWallet.address) return;
    const EXPLORER_API = `https://regardlessly-foundationary-tawanda.ngrok-free.dev/api/blocks`; 

    try {
        const response = await fetch(EXPLORER_API, {
            headers: { "ngrok-skip-browser-warning": "69420" }
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
const amountFormatted = rawAmount >= 1000000 ? (rawAmount / 1e9).toFixed(4) : rawAmount.toFixed(4);

return `
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
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
    transactions.sort((a, b) => b.timestamp - a.timestamp);

    container.innerHTML = transactions.map(tx => {
        const isSent = tx.fromAddress === myWallet.address;
        const typeLabel = isSent ? 'Kirim' : 'Terima';
        const typeColor = isSent ? '#ef4444' : '#10b981';
        const typeIcon = isSent ? '↗' : '↙';
        const displayAddr = isSent ? tx.toAddress : tx.fromAddress;
        const amount = tx.amount > 1000000 ? (tx.amount / 1e9).toFixed(4) : tx.amount;

        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #1e293b;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="background: ${isSent ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)'}; 
                                color: ${typeColor}; width: 32px; height: 32px; border-radius: 8px; 
                                display: flex; align-items: center; justify-content: center; font-weight: bold;">
                        ${typeIcon}
                    </div>
                    <div>
                        <div style="color: var(--text); font-weight: 600; font-size: 13px;">${typeLabel}</div>
                        <small class="text-muted">${displayAddr.substring(0, 8)}...</small>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="color: ${typeColor}; font-weight: 700; font-size: 13px;">
                        ${isSent ? '-' : '+'}${amount} ONE
                    </div>
                    <small class="text-muted" style="font-size: 10px;">${new Date(tx.timestamp).toLocaleTimeString()}</small>
                </div>
            </div>
        `;
    }).join('');
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
    if (modal) {
        modal.style.display = 'none';
        const inputs = modal.querySelectorAll('input');
        inputs.forEach(input => input.value = '');
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

function checkExternalRequests() {
    const request = localStorage.getItem('one_pending_request');
    if (request) {
        const parsed = JSON.parse(request);
        if (Date.now() - parsed.timestamp < 60000) {
            if (confirm(`Aplikasi eksternal meminta kirim ${parsed.data.amount} ONE ke ${parsed.data.to}. Lanjutkan?`)) {
                showSend();
                document.getElementById('send-to').value = parsed.data.to;
                document.getElementById('send-amount').value = parsed.data.amount;
                showToast("Silahkan tinjau dan klik 'Kirim Sekarang'");
            }
        }
        localStorage.removeItem('one_pending_request');
    }
}

setInterval(checkExternalRequests, 3000);

function listenToExternalRequests() {
    const pendingRequest = localStorage.getItem('one_pending_request');
    if (pendingRequest) {
        try {
            const request = JSON.parse(pendingRequest);
            if (request.type === 'APPROVE_CONNECTION') {
                currentPendingDApp = request.origin;
                document.getElementById('dapp-origin-display').innerText = request.origin;
                document.getElementById('modal-dapp-approve').style.display = 'flex';
                localStorage.removeItem('one_pending_request');
            }
        } catch (e) {
            console.error("Error parsing DApp request", e);
        }
    }
}

function approveDApp() {
    if (currentPendingDApp) {
        let approvedDApps = JSON.parse(localStorage.getItem('approved_dapps') || "{}");
        approvedDApps[currentPendingDApp] = Date.now();
        localStorage.setItem('approved_dapps', JSON.stringify(approvedDApps));
        showToast("DApp berhasil terhubung!");
    }
    document.getElementById('modal-dapp-approve').style.display = 'none';
    currentPendingDApp = null;
    renderDAppList();
}

function rejectDApp() {
    showToast("Koneksi DApp ditolak.");
    document.getElementById('modal-dapp-approve').style.display = 'none';
    currentPendingDApp = null;
}

setInterval(listenToExternalRequests, 2000);

function disconnectDApp(origin) {
    let approvedDApps = JSON.parse(localStorage.getItem('approved_dapps') || "{}");
    delete approvedDApps[origin];
    localStorage.setItem('approved_dapps', JSON.stringify(approvedDApps));
    renderDAppList();
    showToast(`Terputus dari ${origin}`);
}

function renderDAppList() {
    const container = document.getElementById('dapp-list');
    const approvedDApps = JSON.parse(localStorage.getItem('approved_dapps') || "{}");
    
    container.innerHTML = Object.keys(approvedDApps).length === 0 
        ? '<div class="text-muted text-center">Tidak ada DApp terhubung</div>' 
        : '';

    for (const origin in approvedDApps) {
        container.innerHTML += `
            <div class="wallet-item">
                <div class="wallet-info">
                    <div>${origin.replace('https://', '')}</div>
                    <small>Terhubung pada: ${new Date(approvedDApps[origin]).toLocaleDateString()}</small>
                </div>
                <button class="logout-btn" style="display:block" onclick="disconnectDApp('${origin}')">Revoke</button>
            </div>
        `;
    }
}
