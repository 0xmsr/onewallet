/**
 * OneChain Wallet Connector v1
 */

class OneChainConnector {
    constructor() {
        this.isOneChain = true;
        this._connected = false;
    }

    async requestAccounts() {
        const origin = window.location.origin;
        const approvedDApps = JSON.parse(localStorage.getItem('approved_dapps') || "{}");
        if (approvedDApps[origin]) {
            return this._getActiveAddress();
        }

        localStorage.setItem('one_pending_request', JSON.stringify({
            type: 'APPROVE_CONNECTION',
            origin: origin,
            timestamp: Date.now()
        }));

        return new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                const updatedApps = JSON.parse(localStorage.getItem('approved_dapps') || "{}");
                if (updatedApps[origin]) {
                    clearInterval(checkInterval);
                    resolve(this._getActiveAddress());
                }
            }, 1000);
        });
    }

    async sendTransaction(txParams) {
        const txId = 'tx_' + Date.now();
        localStorage.setItem('one_pending_request', JSON.stringify({
            type: 'SEND_TX',
            data: txParams,
            txId: txId,
            origin: window.location.origin,
            timestamp: Date.now()
        }));

        return new Promise((resolve, reject) => {
            const checkTx = setInterval(() => {
                const response = localStorage.getItem(`one_res_${txId}`);
                if (response) {
                    clearInterval(checkTx);
                    const resData = JSON.parse(response);
                    localStorage.removeItem(`one_res_${txId}`);
                    resData.success ? resolve(resData.hash) : reject(resData.error);
                }
            }, 1000);
        });
    }

    _getActiveAddress() {
        const activePk = localStorage.getItem('oneWalletSession');
        const wallets = JSON.parse(localStorage.getItem('multiWallets') || "[]");
        const activeWallet = wallets.find(w => w.privateKey === activePk);
        return activeWallet ? [activeWallet.address] : [];
    }

    async getBalance(address) {
        const RPC_URL = 'https://regardlessly-foundationary-tawanda.ngrok-free.dev'; 
        try {
            const res = await fetch(`${RPC_URL}/balance/${address}`, {
                headers: { "ngrok-skip-browser-warning": "69420" }
            });
            const data = await res.json();
            return data.liquid || "0";
        } catch (e) {
            console.error("Connector Error:", e);
            return "0";
        }
    }

    async sendTransaction(txParams) {
        localStorage.setItem('one_pending_request', JSON.stringify({
            type: 'SEND_TX',
            data: txParams,
            timestamp: Date.now()
        }));
        
        alert("Permintaan transaksi dikirim ke OneChain Wallet. Silahkan buka tab wallet untuk konfirmasi.");
    }
}

window.onechain = new OneChainConnector();