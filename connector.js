/**
 * OneChain Wallet Connector v1.1
 */

class OneChainConnector {
    constructor() {
        this.isOneChain = true;
        this._connected = false;
    }

    async requestConnect() {
    const origin = window.location.origin;
    const approvedDApps = JSON.parse(localStorage.getItem('approved_dapps') || "{}");
    if (approvedDApps[origin]) {
        return this._getActiveAddress();
    }

    const requestId = 'req_' + Date.now();
    localStorage.setItem('one_pending_request', JSON.stringify({
        type: 'CONNECT',
        origin: origin,
        id: requestId
    }));

    return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
            const updatedApps = JSON.parse(localStorage.getItem('approved_dapps') || "{}");
            if (updatedApps[origin]) {
                clearInterval(checkInterval);
                resolve(this._getActiveAddress());
            }
            
            const response = localStorage.getItem(`one_res_${requestId}`);
            if (response) {
                const resData = JSON.parse(response);
                if (!resData.success) {
                    clearInterval(checkInterval);
                    localStorage.removeItem(`one_res_${requestId}`);
                    reject(resData.error);
                }
            }
        }, 1000);
    });
}

    async sendTransaction(txParams) {
        const txId = 'tx_' + Date.now();
        localStorage.setItem('one_pending_request', JSON.stringify({
            type: 'TRANSFER',
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
    const DEFAULT_RPC = 'https://regardlessly-foundationary-tawanda.ngrok-free.dev';
    const RPC_URL = localStorage.getItem('custom_rpc_url') || DEFAULT_RPC;

    try {
        const res = await fetch(`${RPC_URL}/balance/${address}`, {
            headers: { 
                "ngrok-skip-browser-warning": "69420",
                "Content-Type": "application/json"
            }
        });
        const data = await res.json();
        return data.liquid || "0";
    } catch (e) {
        console.error("Connector RPC Error:", e);
        return "0";
    }
}

}

window.onechain = new OneChainConnector();
