/**
 * Wallet layer: everything that talks to MetaMask lives here, with no DOM code,
 * so it can be tested with a mock provider (see tests/wallet.test.mjs).
 *
 * Communication model
 * -------------------
 * MetaMask injects an EIP-1193 provider into the page. We find it (EIP-6963
 * discovery, falling back to window.ethereum), then:
 *   - send JSON-RPC requests with `provider.request({ method, params })`
 *   - listen to events: accountsChanged, chainChanged, connect, disconnect
 * ethers.js (BrowserProvider) wraps that provider for network detection and
 * address checksumming.
 *
 * This module never asks for, receives or stores a private key or seed phrase.
 * The only thing persisted is one non-sensitive boolean ("user clicked
 * Disconnect") so the app doesn't silently reconnect on the next page load.
 */
import { BrowserProvider, getAddress } from "ethers";
import { getChain, chainLabel, addChainParams, toHexChainId } from "./networks.js";

const DISCONNECT_KEY = "wallet-demo:user-disconnected";

export const MESSAGES = {
  noWallet:
    "MetaMask was not detected in this browser. Install the MetaMask extension, then reload this page.",
  rejected:
    "You rejected the connection request in MetaMask. Click “Connect Wallet” to try again.",
  pending:
    "A connection request is already open in MetaMask. Open the MetaMask extension to approve or reject it.",
  locked:
    "MetaMask is locked or no accounts are connected to this site. Unlock MetaMask and click “Connect Wallet”.",
  networkDown:
    "MetaMask lost its connection to the blockchain network. Check your internet connection; the app reconnects automatically when it recovers.",
  switchRejected: "You rejected the network switch request in MetaMask.",
};

const DISCONNECTED_FIELDS = {
  account: null,
  chainId: null,
  chainName: null,
  supported: null,
};

const INITIAL_STATE = Object.freeze({
  status: "initializing", // initializing | no-wallet | disconnected | connecting | connected
  ...DISCONNECTED_FIELDS,
  error: null,
});

let state = INITIAL_STATE;
let injected = null; // raw EIP-1193 provider (window.ethereum or the EIP-6963 MetaMask provider)
let ethersProvider = null; // ethers wrapper around `injected`
let storage = null;
let handlers = null;
let disconnectRequested = false;
const stateListeners = new Set();
const logListeners = new Set();

/* ------------------------------ small helpers ----------------------------- */

export function getState() {
  return state;
}

export function subscribe(fn) {
  stateListeners.add(fn);
  fn(state);
  return () => stateListeners.delete(fn);
}

export function onLog(fn) {
  logListeners.add(fn);
  return () => logListeners.delete(fn);
}

function setState(patch) {
  state = { ...state, ...patch };
  stateListeners.forEach((fn) => fn(state));
}

function log(message) {
  logListeners.forEach((fn) => fn(message));
}

function shortAddress(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "none";
}

function chainPatch(chainId) {
  return {
    chainId,
    chainName: chainLabel(chainId),
    supported: Boolean(getChain(chainId)),
  };
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // storage blocked (private mode, sandboxed iframe, ...)
  }
}

function userDisconnected() {
  try {
    return storage?.getItem(DISCONNECT_KEY) === "1";
  } catch {
    return false;
  }
}

function setUserDisconnected(value) {
  try {
    if (value) storage?.setItem(DISCONNECT_KEY, "1");
    else storage?.removeItem(DISCONNECT_KEY);
  } catch {
    /* non-fatal */
  }
}

/** Error codes can sit in different places depending on who wrapped the error. */
function extractCode(err) {
  return err?.code ?? err?.error?.code ?? err?.info?.error?.code ?? err?.data?.originalError?.code;
}

export function describeError(err) {
  const code = extractCode(err);
  const text = err?.shortMessage ?? err?.message ?? "";
  if (code === 4001 || code === "ACTION_REJECTED" || /user (rejected|denied)/i.test(text)) {
    return MESSAGES.rejected;
  }
  if (code === -32002) return MESSAGES.pending;
  return `Something went wrong talking to MetaMask${text ? `: ${text}` : "."}`;
}

/* ------------------------------- discovery -------------------------------- */

/**
 * Find MetaMask. EIP-6963 lets every installed wallet announce itself, so we
 * can pick MetaMask even when several wallet extensions fight over
 * window.ethereum. Older setups fall back to window.ethereum.
 */
function discoverMetaMask(timeoutMs) {
  return new Promise((resolve) => {
    const announced = [];
    const onAnnounce = (event) => announced.push(event.detail);
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      const viaEip6963 = announced.find((p) => p?.info?.rdns === "io.metamask")?.provider;
      if (viaEip6963) return resolve(viaEip6963);

      const eth = window.ethereum;
      if (Array.isArray(eth?.providers)) {
        return resolve(eth.providers.find((p) => p.isMetaMask) ?? null);
      }
      resolve(eth?.isMetaMask ? eth : null);
    }, timeoutMs);
  });
}

/* --------------------------------- actions -------------------------------- */

/** Read the chain from the wallet (through ethers) and publish a "connected" state. */
async function applyConnection(accounts) {
  const network = await ethersProvider.getNetwork();
  if (disconnectRequested) return;
  const chainId = Number(network.chainId);
  setState({
    status: "connected",
    account: getAddress(accounts[0]), // checksummed (EIP-55)
    ...chainPatch(chainId),
    error: null,
  });
  log(`Connected as ${shortAddress(state.account)} on ${state.chainName} (chain ID ${chainId})`);
}

export async function init({ discoveryMs = 300, storage: storageOverride } = {}) {
  storage = storageOverride ?? safeStorage();
  disconnectRequested = userDisconnected();
  injected = await discoverMetaMask(discoveryMs);

  if (!injected) {
    setState({ status: "no-wallet", error: MESSAGES.noWallet });
    return;
  }

  // "any" lets ethers follow network changes instead of throwing "network changed".
  ethersProvider = new BrowserProvider(injected, "any");
  attachListeners();
  setState({ status: "disconnected", error: null });

  // Silent reconnect: eth_accounts never shows a popup; it only returns accounts
  // the user already approved for this site.
  if (!userDisconnected()) {
    try {
      const accounts = await injected.request({ method: "eth_accounts" });
      if (accounts.length) await applyConnection(accounts);
    } catch {
      /* stay disconnected; the user can click Connect */
    }
  }
}

export async function connect() {
  if (state.status === "disconnecting") return;
  if (!injected) {
    setState({ status: "no-wallet", error: MESSAGES.noWallet });
    return;
  }
  disconnectRequested = false;
  setState({ status: "connecting", error: null });
  try {
    // This is the call that opens MetaMask's "Connect with MetaMask" popup.
    const accounts = await injected.request({ method: "eth_requestAccounts" });
    if (!accounts?.length) throw new Error("MetaMask returned no accounts.");
    setUserDisconnected(false);
    await applyConnection(accounts);
  } catch (err) {
    setState({ status: "disconnected", ...DISCONNECTED_FIELDS, error: describeError(err) });
    log(`Connection failed (code ${extractCode(err) ?? "n/a"})`);
  }
}

/** Revoke this site's account access in MetaMask, then clear the app state. */
export async function disconnect() {
  if (!injected || state.status !== "connected") return;
  disconnectRequested = true;
  setUserDisconnected(true);
  setState({ status: "disconnecting", error: null });
  try {
    await injected.request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    });
    setState({ status: "disconnected", ...DISCONNECTED_FIELDS, error: null });
    log("Disconnected from MetaMask. This site's account permission was revoked.");
  } catch (err) {
    disconnectRequested = false;
    setUserDisconnected(false);
    setState({
      status: "connected",
      error: `Could not disconnect from MetaMask: ${err?.message ?? "unknown error"}. Try again or disconnect this site in MetaMask's Permissions.`,
    });
    log(`Disconnect failed (code ${extractCode(err) ?? "n/a"})`);
  }
}

export async function switchNetwork(chainId) {
  if (!injected || !getChain(chainId)) return;
  const hexId = toHexChainId(chainId);
  try {
    await injected.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
    // State updates through the chainChanged event.
  } catch (err) {
    const code = extractCode(err);
    const params = addChainParams(chainId);
    if (code === 4902 && params) {
      // 4902 = MetaMask doesn't know this chain yet: offer to add it.
      try {
        await injected.request({ method: "wallet_addEthereumChain", params: [params] });
      } catch (addErr) {
        setState({
          error:
            extractCode(addErr) === 4001
              ? MESSAGES.switchRejected
              : `Could not add the network: ${addErr?.message ?? "unknown error"}`,
        });
      }
    } else if (code === 4001) {
      setState({ error: MESSAGES.switchRejected });
    } else {
      setState({ error: `Could not switch network: ${err?.message ?? "unknown error"}` });
    }
  }
}

/* ---------------------------- wallet event handlers ----------------------- */

async function onAccountsChanged(accounts) {
  log(`accountsChanged: ${accounts.length ? shortAddress(accounts[0]) : "no accounts"}`);
  if (disconnectRequested || userDisconnected()) return;

  if (!accounts.length) {
    // MetaMask locked, or the user removed this site's access.
    if (state.status === "connected") {
      setState({ status: "disconnected", ...DISCONNECTED_FIELDS, error: MESSAGES.locked });
    }
    return;
  }
  try {
    await applyConnection(accounts);
  } catch (err) {
    setState({ error: describeError(err) });
  }
}

function onChainChanged(hexChainId) {
  const chainId = Number.parseInt(hexChainId, 16);
  log(`chainChanged: chain ID ${chainId}`);
  if (state.status !== "connected") return;
  setState({ ...chainPatch(chainId), error: null });
}

function onProviderDisconnect() {
  log("disconnect event: MetaMask lost its RPC connection");
  if (state.status === "connected") {
    setState({ status: "disconnected", ...DISCONNECTED_FIELDS, error: MESSAGES.networkDown });
  }
}

async function onProviderConnect() {
  // Connection to the chain restored: silently re-sync if the user hasn't opted out.
  if (state.status !== "disconnected" || disconnectRequested || userDisconnected()) return;
  try {
    const accounts = await injected.request({ method: "eth_accounts" });
    if (accounts.length) await applyConnection(accounts);
  } catch {
    /* ignore */
  }
}

function attachListeners() {
  handlers = {
    accountsChanged: onAccountsChanged,
    chainChanged: onChainChanged,
    disconnect: onProviderDisconnect,
    connect: onProviderConnect,
  };
  for (const [event, fn] of Object.entries(handlers)) injected.on(event, fn);
}

/** Remove listeners and reset module state (used by tests and hot reload). */
export function destroy() {
  if (injected && handlers) {
    for (const [event, fn] of Object.entries(handlers)) injected.removeListener?.(event, fn);
  }
  ethersProvider?.destroy?.();
  handlers = null;
  injected = null;
  ethersProvider = null;
  state = INITIAL_STATE;
  disconnectRequested = false;
  stateListeners.clear();
  logListeners.clear();
}
