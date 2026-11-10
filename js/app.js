// Agent Market presale page: buy widget (BNB/USDT), live sold progress,
// post-end claim shortcut, Buy on Agent modal. Mirrors the reference presale
// feature set against the Agent Market presale contract.
const { ethCall, ethBalance, asUint, asBool, padAddr, u256, fmt, fmtNum, parseUnits, toast, friendlyError } = window.AMW;

const PRESALE = "0xA6Ef01e926eFbD35661e7B1d3E1CBeE360750b16";
const STALL = "0xE3dE7fD0d12cFF4a46d8Bf702Ab593B6f921b308";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const RATE = 20000000n; // AMKT per 1 BNB
const HARDCAP = 1000000000n; // AMKT

const SEL = {
  startTime: "0x78e97925", endTime: "0x3197cbb6", isOpen: "0x47535d7b",
  sold: "0x02c7e7af", bought: "0x667022fd", claimable: "0x402914f5",
  presaleClaimed: "0xf9765bc1", holderClaimed: "0xdd6f5c53",
  bnbPrice: "0x576dde12", balanceOf: "0x70a08231",
  allowance: "0xdd62ed3e",
};
const $ = (id) => document.getElementById(id);
const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };

const a = {
  pay: "BNB",
  bnbUsd: null,
  bal: { BNB: null, USDT: null },
  sold: 0n,
  mine: 0n,          // bought (AMKT whole)
  claimable: 0n,     // claimable() (AMKT whole)
  boughtW: 0n, pc: false, hc: false, stalls: 0n,
  started: false, ended: false, endTime: 0,
  busy: false,
};

// ---- Reads ------------------------------------------------------------------
async function readPrice() {
  try {
    const p = await ethCall(PRESALE, SEL.bnbPrice).then(asUint);
    a.bnbUsd = Number(p) / 1e8;
    render();
    return;
  } catch {}
  try {
    const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT");
    const j = await r.json();
    if (j && j.price) { a.bnbUsd = Number(j.price); render(); }
  } catch {}
}

async function refresh() {
  try {
    const st = window.AMW.state;
    const addr = st.address;
    const [start, end, sold] = await Promise.all([
      ethCall(PRESALE, SEL.startTime).then(asUint),
      ethCall(PRESALE, SEL.endTime).then(asUint),
      ethCall(PRESALE, SEL.sold).then(asUint),
    ]);
    a.started = start !== 0n;
    a.endTime = Number(end);
    a.ended = a.started && Math.floor(Date.now() / 1000) >= a.endTime;
    a.sold = sold / 10n ** 18n;
    if (addr) {
      const pa = padAddr(addr);
      const [bought, claimable, pc, hc, stalls] = await Promise.all([
        ethCall(PRESALE, SEL.bought + pa).then(asUint),
        ethCall(PRESALE, SEL.claimable + pa).then(asUint),
        ethCall(PRESALE, SEL.presaleClaimed + pa).then(asBool),
        ethCall(PRESALE, SEL.holderClaimed + pa).then(asBool),
        ethCall(STALL, SEL.balanceOf + pa).then(asUint),
      ]);
      a.boughtW = bought; a.mine = bought / 10n ** 18n;
      a.claimable = claimable / 10n ** 18n;
      a.pc = pc; a.hc = hc; a.stalls = stalls;
    } else {
      a.boughtW = 0n; a.mine = 0n; a.claimable = 0n; a.pc = false; a.hc = false; a.stalls = 0n;
    }
  } catch {}
  renderStatus();
  render();
}

async function refreshBalances() {
  const st = window.AMW.state;
  if (!st.address) { a.bal = { BNB: null, USDT: null }; render(); return; }
  try {
    const [bnb, usdt] = await Promise.allSettled([
      ethBalance(st.address),
      ethCall(USDT, SEL.balanceOf + padAddr(st.address)),
    ]);
    a.bal = {
      BNB: bnb.status === "fulfilled" ? Number(BigInt(bnb.value)) / 1e18 : null,
      USDT: usdt.status === "fulfilled" ? Number(asUint(usdt.value)) / 1e18 : null,
    };
  } catch {}
  render();
}

function renderStatus() {
  if (!a.started) { set("st-status", "NOT STARTED"); set("st-countdown", "Starts on announcement"); }
  else if (!a.ended) { set("st-status", "OPEN"); tick(); }
  else { set("st-status", "ENDED"); set("st-countdown", "Claims open"); }
  const pct = Number(a.sold) / Number(HARDCAP) * 100;
  set("soldPct", (pct < 1 && pct > 0 ? pct.toFixed(2) : String(Math.round(pct))) + "%");
  $("soldFill").style.width = Math.min(100, pct).toFixed(2) + "%";
}
function tick() {
  if (!a.started || a.ended) return;
  const left = a.endTime - Math.floor(Date.now() / 1000);
  if (left <= 0) { refresh(); return; }
  const dd = Math.floor(left / 86400), hh = Math.floor((left % 86400) / 3600), mm = Math.floor((left % 3600) / 60), ss = left % 60;
  set("st-countdown", `${dd}d ${String(hh).padStart(2, "0")}h ${String(mm).padStart(2, "0")}m ${String(ss).padStart(2, "0")}s`);
}

// ---- Widget rendering ----------------------------------------------------------
const payIn = $("payIn");
function payAmount() {
  const v = Number((payIn.value || "").replace(",", "."));
  return isFinite(v) && v > 0 ? v : 0;
}
function getAmount(pay, amt) {
  if (!amt) return 0;
  if (pay === "BNB") return amt * Number(RATE);
  return a.bnbUsd ? (amt * Number(RATE)) / a.bnbUsd : 0;
}

function render() {
  const amt = payAmount();
  const got = getAmount(a.pay, amt);
  set("getOut", fmtNum(got, 0));
  $("rate").innerHTML = a.pay === "USDT"
    ? `1 USDT = <b class="num">${a.bnbUsd ? fmtNum(Number(RATE) / a.bnbUsd, 0) : "–"}</b> $AMKT · live Chainlink BNB/USD $${a.bnbUsd ? fmtNum(a.bnbUsd, 2) : "–"}`
    : `1 BNB = <b class="num">20,000,000</b> $AMKT`;
  const bal = a.bal[a.pay];
  set("bal", bal == null ? "Balance –" : `Balance ${fmtNum(bal, a.pay === "BNB" ? 4 : 2)}`);
  $("quick").innerHTML =
    (a.pay === "BNB" ? [0.05, 0.1, 0.5] : [10, 50, 100])
      .map((q) => `<button type="button" data-q="${q}">${q}</button>`).join("") +
    (bal ? '<button type="button" data-q="max">Max</button>' : "");
  renderBtn(amt, bal);
}

function renderBtn(amt, bal) {
  const e = $("buyBtn");
  const st = window.AMW.state;
  if (!st.connected) { e.disabled = false; e.textContent = "Connect wallet"; e.dataset.act = "connect"; return; }
  if (st.chainId !== 56) { e.disabled = false; e.textContent = "Switch to BNB Chain"; e.dataset.act = "switch"; return; }
  if (a.busy) { e.disabled = true; e.textContent = "Confirm in your wallet…"; e.dataset.act = ""; return; }
  if (!a.started) { e.disabled = true; e.textContent = "Presale opens soon"; e.dataset.act = ""; return; }
  if (a.ended) {
    if (a.claimable > 0n) { e.disabled = false; e.textContent = `Claim ${fmt(a.claimable)} $AMKT`; e.dataset.act = "claim"; return; }
    e.disabled = true;
    e.textContent = (a.boughtW > 0n || a.stalls > 0n) ? "Claimed" : "Presale ended";
    e.dataset.act = "";
    return;
  }
  if (a.sold >= HARDCAP) { e.disabled = true; e.textContent = "Sold out"; e.dataset.act = ""; return; }
  if (!amt) {
    e.disabled = true;
    e.textContent = a.mine > 0n ? `You hold ${fmt(a.mine)} $AMKT` : "Enter an amount";
    e.dataset.act = "";
    return;
  }
  if (bal != null && amt > bal) { e.disabled = true; e.textContent = `Not enough ${a.pay}`; e.dataset.act = ""; return; }
  e.disabled = false;
  e.textContent = `Buy $AMKT with ${a.pay}`;
  e.dataset.act = "buy";
}

// ---- Widget events ---------------------------------------------------------------
$("payTabs").addEventListener("click", (ev) => {
  const btn = ev.target.closest("button");
  if (!btn) return;
  a.pay = btn.dataset.t;
  $("payTabs").querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
  $("payCoin").innerHTML = `<img class="coin-ic" src="img/${a.pay === "USDT" ? "usdt" : "bnb"}.png" alt=""><b>${a.pay}</b>`;
  payIn.value = "";
  render();
});
payIn.addEventListener("input", () => {
  let v = payIn.value.replace(",", ".").replace(/[^0-9.]/g, "");
  const i = v.indexOf(".");
  if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, "");
  payIn.value = v;
  render();
});
$("quick").addEventListener("click", (ev) => {
  const btn = ev.target.closest("button");
  if (!btn) return;
  let v = btn.dataset.q;
  if (v === "max") {
    const bal = a.bal[a.pay] || 0;
    v = a.pay === "BNB" ? Math.max(0, bal - 0.002) : bal;
    v = Math.floor(v * 1e6) / 1e6;
  }
  payIn.value = String(v);
  render();
});

$("buyBtn").addEventListener("click", async () => {
  const act = $("buyBtn").dataset.act;
  if (act === "connect") return window.AMW.connect();
  if (act === "switch") {
    try { await window.AMW.ensureBsc(); } catch { toast("Switch to BNB Chain in your wallet."); }
    return;
  }
  if (act === "buy") return doBuy();
  if (act === "claim") return doClaim();
});

function showTx(hash) {
  const line = $("txline");
  line.hidden = false;
  line.innerHTML = `Transaction: <a href="https://bscscan.com/tx/${hash}" target="_blank" rel="noopener">${hash}</a>`;
}

async function doBuy() {
  let amount;
  try { amount = parseUnits(payIn.value || "0", 18); } catch { toast("Check the amount."); return; }
  if (amount <= 0n) return;
  const st = window.AMW.state;
  a.busy = true; render();
  try {
    if (a.pay === "BNB") {
      const hash = await window.AMW.sendTx({ to: PRESALE, data: "0x20f1fc61", value: amount });
      showTx(hash);
    } else {
      const allow = await ethCall(USDT, SEL.allowance + padAddr(st.address) + padAddr(PRESALE)).then(asUint);
      if (allow < amount) {
        toast("Approve USDT first, then confirm the buy.");
        await window.AMW.sendTx({ to: USDT, data: "0x095ea7b3" + padAddr(PRESALE) + u256(amount), value: 0n });
      }
      const hash = await window.AMW.sendTx({ to: PRESALE, data: "0xa7c60160" + u256(amount), value: 0n });
      showTx(hash);
    }
    toast("Done. Your $AMKT is held for you until claim opens.");
    payIn.value = "";
  } catch (e) {
    toast(friendlyError(e));
  }
  a.busy = false;
  await Promise.all([refresh(), refreshBalances()]);
}

async function doClaim() {
  a.busy = true; render();
  try {
    if (a.boughtW > 0n && !a.pc) {
      const h1 = await window.AMW.sendTx({ to: PRESALE, data: "0x046ef9a5", value: 0n });
      showTx(h1);
    }
    if (a.stalls > 0n && !a.hc) {
      const h2 = await window.AMW.sendTx({ to: PRESALE, data: "0x6f19bc8b", value: 0n });
      showTx(h2);
    }
    toast("Claimed. $AMKT is in your wallet.");
  } catch (e) {
    toast(friendlyError(e));
  }
  a.busy = false;
  await refresh();
}

// ---- Buy on Agent modal -----------------------------------------------------------
const ag = { pay: "BNB" };
function renderAgent() {
  $("agmPay").querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.t === ag.pay)));
  $("agmCoin").innerHTML = `<img class="coin-ic" src="img/${ag.pay === "USDT" ? "usdt" : "bnb"}.png" alt="">${ag.pay}`;
  const amt = Number(($("agmIn").value || "").replace(",", ".")) || 0;
  const got = getAmount(ag.pay, amt);
  set("agmGet", amt ? `${fmtNum(got, 0)} $AMKT` : "– $AMKT");
  const amtTxt = amt ? String(amt) : "<amount>";
  const est = amt && got ? ` (about ${fmtNum(got, 0)} $AMKT)` : "";
  $("agmPrompt").textContent = ag.pay === "BNB"
    ? `Buy $AMKT in the Agent Market presale for me on BNB Chain (chain ID 56).

Presale contract: ${PRESALE}
Function: buyWithBNB()
Pay: ${amtTxt} BNB as the transaction value${est}

Before signing, show me the transaction, the amount and the gas.`
    : `Buy $AMKT in the Agent Market presale for me on BNB Chain (chain ID 56), paying with USDT.

Presale contract: ${PRESALE}
USDT (BEP-20): ${USDT}
Step 1: approve ${amtTxt} USDT for the presale contract.
Step 2: call buyWithUSDT(${amtTxt} USDT in 18 decimals)${est}

Before signing each step, show me the transaction, the amount and the gas.`;
}
function openAgent() {
  ag.pay = a.pay;
  $("agmIn").value = payIn.value || "";
  renderAgent();
  const m = $("agm");
  m.hidden = false;
  requestAnimationFrame(() => m.classList.add("in"));
}
function closeAgent() {
  const m = $("agm");
  m.classList.remove("in");
  setTimeout(() => { m.hidden = true; }, 220);
}
$("agentBtn").addEventListener("click", openAgent);
$("agmX").addEventListener("click", closeAgent);
$("agm").addEventListener("click", (e) => { if (e.target === $("agm")) closeAgent(); });
addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("agm").hidden) closeAgent(); });
$("agmPay").addEventListener("click", (ev) => {
  const btn = ev.target.closest("button");
  if (!btn) return;
  ag.pay = btn.dataset.t;
  $("agmIn").value = "";
  renderAgent();
});
$("agmIn").addEventListener("input", (ev) => {
  ev.target.value = ev.target.value.replace(/[^0-9.,]/g, "").replace(/([.,].*)[.,]/g, "$1");
  renderAgent();
});
$("agmCopy").addEventListener("click", async () => {
  const btn = $("agmCopy");
  try { await navigator.clipboard.writeText($("agmPrompt").textContent); }
  catch {
    const range = document.createRange();
    range.selectNodeContents($("agmPrompt"));
    const sel = getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    document.execCommand("copy");
    sel.removeAllRanges();
  }
  btn.textContent = "Copied";
  setTimeout(() => (btn.textContent = "Copy prompt"), 1600);
});

// ---- Static prompt copy -------------------------------------------------------------
document.querySelectorAll(".copy-btn[data-copy]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const src = $(btn.dataset.copy);
    if (!src) return;
    try { await navigator.clipboard.writeText(src.textContent.trim()); btn.textContent = "Copied"; }
    catch { btn.textContent = "Select and copy"; }
    setTimeout(() => (btn.textContent = "Copy prompt"), 1800);
  });
});

// ---- Wallet wiring + boot -------------------------------------------------------------
let lastAddr = undefined;
window.AMW.onWallet(async (st) => {
  if (st.address !== lastAddr) {
    lastAddr = st.address;
    await Promise.all([refresh(), refreshBalances()]);
  } else {
    render();
  }
});
window.AMW.mountButton($("wallet-slot"));
render();
refresh();
readPrice();
setInterval(() => { if (!document.hidden) { refresh(); if (window.AMW.state.address) refreshBalances(); } }, 20000);
setInterval(readPrice, 60000);
setInterval(tick, 1000);
