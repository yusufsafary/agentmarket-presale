// Agent Market shared wallet module: EIP-1193 connect + raced public-RPC reads.
// Used by the mint, presale and claim sites. No external dependencies.
(function () {
  const RPCS = [
    "https://bsc-rpc.publicnode.com",
    "https://bsc-dataseed.bnbchain.org",
    "https://bsc-dataseed.binance.org",
    "https://bsc-dataseed1.binance.org",
  ];

  async function rpc(method, params) {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    const tries = RPCS.map((url) =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(7000),
      })
        .then((r) => r.json())
        .then((j) => {
          if (j.error) throw new Error(j.error.message || "rpc error");
          if (j.result === undefined || j.result === null) throw new Error("empty");
          return j.result;
        })
    );
    return Promise.any(tries);
  }
  const ethCall = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
  const ethBalance = (addr) => rpc("eth_getBalance", [addr, "latest"]);

  // ---- ABI helpers -------------------------------------------------------
  const padAddr = (a) => "000000000000000000000000" + a.replace(/^0x/, "").toLowerCase();
  const u256 = (n) => BigInt(n).toString(16).padStart(64, "0");
  const asUint = (hex) => BigInt(hex);
  const asBool = (hex) => BigInt(hex) !== 0n;
  function asString(hex) {
    if (!hex || hex === "0x") return "";
    const h = hex.replace(/^0x/, "");
    if (h.length < 128) return "";
    const len = Number(BigInt("0x" + h.slice(64, 128)));
    const bytes = h.slice(128, 128 + len * 2);
    let out = "";
    for (let i = 0; i < bytes.length; i += 2) out += String.fromCharCode(parseInt(bytes.substr(i, 2), 16));
    return out;
  }
  function parseUnits(str, decimals) {
    const s = String(str).replace(",", ".").trim();
    if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") throw new Error("bad amount");
    const [ip, fp = ""] = s.split(".");
    const frac = (fp + "0".repeat(decimals)).slice(0, decimals);
    return BigInt(ip || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
  }
  const fmt = (n) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fmtNum = (x, maxFrac) => {
    const v = Number(x);
    if (!isFinite(v)) return "–";
    return v.toLocaleString("en-US", { maximumFractionDigits: maxFrac ?? 0, minimumFractionDigits: 0 });
  };
  const fmtBNB = (wei) => {
    // Trim a wei BigInt to a short BNB decimal string (up to 6dp).
    const w = BigInt(wei);
    if (w === 0n) return "0";
    const whole = w / 10n ** 18n;
    let frac = (w % 10n ** 18n).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : `${whole}`;
  };
  const shortAddr = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");

  // ---- Toast -------------------------------------------------------------
  function toast(msg) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 4200);
  }

  // ---- Friendly errors ---------------------------------------------------
  function friendlyError(e) {
    const n = String((e && (e.shortMessage || e.reason || e.message)) || e || "");
    if (/user (rejected|denied)|ACTION_REJECTED|rejected the request|4001/i.test(n)) return "You cancelled it in your wallet.";
    if (/insufficient funds/i.test(n)) return "Not enough BNB for this plus gas.";
    if (/MintNotOpen/.test(n)) return "Minting is not open yet.";
    if (/ExceedsWalletCap|WalletLimit/.test(n)) return "That would pass 25 Stalls for this wallet.";
    if (/ExceedsMaxSupply|SoldOut/.test(n)) return "Not that many Stalls left.";
    if (/WrongPayment/.test(n)) return "The price moved. Refresh and try again.";
    if (/NotStarted/.test(n)) return "The presale has not started yet.";
    if (/PresaleEnded/.test(n)) return "The presale has ended.";
    if (/PresaleNotEnded/.test(n)) return "Claims open when the presale ends.";
    if (/HardcapExceeded/.test(n)) return "That would pass the presale hardcap.";
    if (/BadPrice/.test(n)) return "BNB price feed is stale. Try again in a minute.";
    if (/AlreadyClaimed/.test(n)) return "Already claimed for this wallet.";
    if (/NothingBought/.test(n)) return "No presale purchase in this wallet.";
    if (/NoStalls/.test(n)) return "No Stalls in this wallet.";
    if (/ContractCallsNotAllowed/.test(n)) return "Mint from a wallet app, not a contract.";
    return "Transaction failed. Nothing was spent except possibly gas.";
  }

  // ---- Wallet state --------------------------------------------------------
  const state = { connected: false, address: null, chainId: null };
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => { try { fn({ ...state }); } catch {} });
  const provider = () => window.ethereum || null;

  async function refreshMeta() {
    const p = provider();
    if (!p) return;
    try {
      const accs = await p.request({ method: "eth_accounts" });
      state.address = accs && accs[0] ? accs[0] : null;
      state.connected = !!state.address;
    } catch {}
    try {
      const cid = await p.request({ method: "eth_chainId" });
      state.chainId = parseInt(cid, 16);
    } catch {}
    emit();
  }

  let bound = false;
  function bindProviderEvents() {
    const p = provider();
    if (!p || bound || !p.on) return;
    bound = true;
    p.on("accountsChanged", () => refreshMeta());
    p.on("chainChanged", () => refreshMeta());
  }

  async function connect() {
    const p = provider();
    if (!p) {
      toast("No wallet found. Open this page in MetaMask, Binance Wallet or another BNB Chain wallet browser.");
      return false;
    }
    bindProviderEvents();
    try {
      const accs = await p.request({ method: "eth_requestAccounts" });
      state.address = accs && accs[0] ? accs[0] : null;
      state.connected = !!state.address;
      const cid = await p.request({ method: "eth_chainId" });
      state.chainId = parseInt(cid, 16);
      emit();
      return state.connected;
    } catch (e) {
      toast(friendlyError(e));
      return false;
    }
  }

  async function ensureBsc() {
    const p = provider();
    if (!p) throw new Error("no wallet");
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x38" }] });
    } catch (e) {
      if (e && (e.code === 4902 || /unrecognized|not added/i.test(String(e.message || "")))) {
        await p.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: "0x38",
            chainName: "BNB Smart Chain",
            nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
            rpcUrls: ["https://bsc-dataseed.binance.org"],
            blockExplorerUrls: ["https://bscscan.com"],
          }],
        });
      } else throw e;
    }
    await refreshMeta();
  }

  async function sendTx({ to, data, value }) {
    const p = provider();
    if (!p || !state.address) throw new Error("wallet not connected");
    const tx = { from: state.address, to, data: data || "0x", value: "0x" + BigInt(value || 0n).toString(16) };
    const hash = await p.request({ method: "eth_sendTransaction", params: [tx] });
    // Wait for the receipt (wallet provider first, public RPC as fallback).
    for (let i = 0; i < 60; i++) {
      let rec = null;
      try { rec = await p.request({ method: "eth_getTransactionReceipt", params: [hash] }); } catch {}
      if (!rec) { try { rec = await rpc("eth_getTransactionReceipt", [hash]); } catch {} }
      if (rec) {
        if (rec.status === "0x0") throw new Error("Transaction reverted on chain.");
        return hash;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return hash;
  }

  // Header wallet button, styled like the reference: "Connect" or short address.
  function mountButton(slotEl) {
    if (!slotEl) return null;
    const btn = document.createElement("button");
    btn.className = "wallet-btn";
    btn.type = "button";
    btn.textContent = "Connect";
    slotEl.appendChild(btn);
    const render = () => {
      btn.classList.toggle("on", state.connected);
      btn.innerHTML = state.connected ? `<span>${shortAddr(state.address)}</span>` : "Connect";
    };
    listeners.add(render);
    render();
    btn.addEventListener("click", async () => {
      if (!state.connected) { await connect(); return; }
      // Connected: clicking re-announces the account (reference opens account view).
      toast(`Connected: ${state.address}${state.chainId === 56 ? " · BNB Chain" : " · switch to BNB Chain"}`);
    });
    // Silent reconnect when the wallet already authorised this site.
    if (provider()) { bindProviderEvents(); refreshMeta(); }
    return btn;
  }

  window.AMW = {
    RPCS, ethCall, ethBalance, padAddr, u256, asUint, asBool, asString,
    parseUnits, fmt, fmtNum, fmtBNB, shortAddr, toast, friendlyError,
    state, onWallet(fn) { listeners.add(fn); fn({ ...state }); },
    connect, ensureBsc, sendTx, mountButton,
  };
})();
