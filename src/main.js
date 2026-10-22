import "./style.css";
import * as wallet from "./wallet.js";
import { SUPPORTED_CHAINS, supportedChainNames } from "./networks.js";

const $ = (id) => document.getElementById(id);
const el = {
  pill: $("status-pill"),
  statusText: $("status-text"),
  address: $("address"),
  copyBtn: $("copy-btn"),
  network: $("network"),
  chainId: $("chain-id"),
  errorBanner: $("error-banner"),
  networkBanner: $("network-banner"),
  networkBannerText: $("network-banner-text"),
  switchButtons: $("switch-buttons"),
  connectBtn: $("connect-btn"),
  disconnectBtn: $("disconnect-btn"),
  installHint: $("install-hint"),
  log: $("log"),
};

const STATUS_TEXT = {
  initializing: "Checking for MetaMask…",
  "no-wallet": "MetaMask not detected",
  disconnected: "Not connected",
  connecting: "Waiting for approval in MetaMask…",
  connected: "Connected",
};

function pillState(s) {
  if (s.status === "connected") return s.supported ? "ok" : "warn";
  if (s.status === "no-wallet") return "error";
  if (s.status === "disconnected") return "idle";
  return "busy";
}

function pillLabel(s) {
  if (s.status === "connected") return s.supported ? "Connected" : "Unsupported network";
  if (s.status === "no-wallet") return "No wallet";
  if (s.status === "disconnected") return "Disconnected";
  if (s.status === "connecting") return "Connecting…";
  return "Checking…";
}

function renderNetworkBanner(s) {
  const show = s.status === "connected" && s.supported === false;
  el.networkBanner.hidden = !show;
  el.switchButtons.replaceChildren();
  if (!show) return;

  el.networkBannerText.textContent =
    `You’re on “${s.chainName}” (chain ID ${s.chainId}), which this app doesn’t support. ` +
    `Switch to one of: ${supportedChainNames().join(", ")}.`;

  for (const [id, chain] of Object.entries(SUPPORTED_CHAINS)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `Switch to ${chain.name}`;
    btn.addEventListener("click", () => wallet.switchNetwork(Number(id)));
    el.switchButtons.append(btn);
  }
}

function render(s) {
  const connected = s.status === "connected";

  el.pill.dataset.state = pillState(s);
  el.pill.textContent = pillLabel(s);

  el.statusText.textContent =
    connected && !s.supported ? "Connected (unsupported network)" : STATUS_TEXT[s.status];
  el.address.textContent = s.account ?? "—";
  el.copyBtn.hidden = !s.account;
  el.network.textContent = connected ? s.chainName : "—";
  el.chainId.textContent = connected ? `${s.chainId} (0x${s.chainId.toString(16)})` : "—";

  el.errorBanner.hidden = !s.error;
  el.errorBanner.textContent = s.error ?? "";
  renderNetworkBanner(s);

  el.connectBtn.hidden = connected;
  el.connectBtn.disabled = s.status === "connecting" || s.status === "initializing" || s.status === "no-wallet";
  el.connectBtn.textContent = s.status === "connecting" ? "Connecting…" : "Connect Wallet";
  el.disconnectBtn.hidden = !connected;
  el.installHint.hidden = s.status !== "no-wallet";
}

function addLog(message) {
  const li = document.createElement("li");
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString();
  li.append(time, document.createTextNode(message)); // textContent-style: never innerHTML
  el.log.prepend(li);
  while (el.log.children.length > 30) el.log.lastChild.remove();
}

el.connectBtn.addEventListener("click", () => wallet.connect());
el.disconnectBtn.addEventListener("click", () => wallet.disconnect());
el.copyBtn.addEventListener("click", async () => {
  const address = wallet.getState().account;
  if (!address) return;
  try {
    await navigator.clipboard.writeText(address);
    addLog("Address copied to clipboard.");
  } catch {
    addLog("Could not copy automatically; select the address and copy it manually.");
  }
});

wallet.onLog(addLog);
wallet.subscribe(render);
wallet.init();
