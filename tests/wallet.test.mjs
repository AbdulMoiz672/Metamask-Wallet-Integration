/**
 * Tests for the wallet layer using a mock EIP-1193 provider (no browser or real
 * MetaMask needed). Run with: npm test
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "ethers";
import * as wallet from "../src/wallet.js";
import { MESSAGES } from "../src/wallet.js";

const ADDR_A = getAddress("0x52908400098527886e0f7030069857d2e4169ee7");
const ADDR_B = getAddress("0x8617e340b3d01fa5f11f306f4090fd50e238070d");

const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

function createMockProvider({ accounts = [ADDR_A.toLowerCase()], chainId = "0xaa36a7" } = {}) {
  const listeners = {};
  const provider = {
    isMetaMask: true,
    accounts,
    chainId,
    authorized: false, // has the user approved this site yet?
    rejectConnect: null,
    switchError: null,
    methodsCalled: [],
    async request({ method, params }) {
      provider.methodsCalled.push(method);
      switch (method) {
        case "eth_requestAccounts":
          if (provider.rejectConnect) throw provider.rejectConnect;
          provider.authorized = true;
          return provider.accounts;
        case "eth_accounts":
          return provider.authorized ? provider.accounts : [];
        case "eth_chainId":
          return provider.chainId;
        case "net_version":
          return String(Number.parseInt(provider.chainId, 16));
        case "wallet_switchEthereumChain":
          if (provider.switchError) throw provider.switchError;
          provider.chainId = params[0].chainId;
          provider.emit("chainChanged", provider.chainId);
          return null;
        case "wallet_addEthereumChain":
          provider.chainId = params[0].chainId;
          provider.emit("chainChanged", provider.chainId);
          return null;
        default:
          throw Object.assign(new Error(`Unsupported method ${method}`), { code: -32601 });
      }
    },
    on(event, fn) {
      (listeners[event] ??= new Set()).add(fn);
      return provider;
    },
    removeListener(event, fn) {
      listeners[event]?.delete(fn);
      return provider;
    },
    emit(event, ...args) {
      listeners[event]?.forEach((fn) => fn(...args));
    },
  };
  return provider;
}

/** Install a fake `window`. mode "eip6963" announces the provider; "legacy" sets window.ethereum. */
function installWindow(provider, mode = "eip6963") {
  const win = new EventTarget();
  if (provider && mode === "eip6963") {
    win.addEventListener("eip6963:requestProvider", () => {
      win.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: { info: { rdns: "io.metamask", name: "MetaMask" }, provider },
        }),
      );
    });
  }
  if (provider && mode === "legacy") win.ethereum = provider;
  globalThis.window = win;
}

async function start(provider, { mode, storage = memoryStorage() } = {}) {
  installWindow(provider, mode);
  await wallet.init({ discoveryMs: 5, storage });
  return storage;
}

afterEach(() => {
  wallet.destroy();
  delete globalThis.window;
});

test("reports no-wallet when MetaMask is not installed", async () => {
  await start(null);
  assert.equal(wallet.getState().status, "no-wallet");
  assert.equal(wallet.getState().error, MESSAGES.noWallet);

  await wallet.connect();
  assert.equal(wallet.getState().status, "no-wallet");
});

test("connects and exposes checksummed address, network name and chain ID", async () => {
  const mm = createMockProvider();
  await start(mm);
  assert.equal(wallet.getState().status, "disconnected");

  await wallet.connect();
  const s = wallet.getState();
  assert.equal(s.status, "connected");
  assert.equal(s.account, ADDR_A);
  assert.equal(s.chainId, 11155111);
  assert.equal(s.chainName, "Sepolia Testnet");
  assert.equal(s.supported, true);
  assert.equal(s.error, null);
});

test("falls back to window.ethereum when EIP-6963 is unavailable", async () => {
  const mm = createMockProvider();
  await start(mm, { mode: "legacy" });
  await wallet.connect();
  assert.equal(wallet.getState().status, "connected");
});

test("handles a rejected connection request", async () => {
  const mm = createMockProvider();
  mm.rejectConnect = Object.assign(new Error("User rejected the request."), { code: 4001 });
  await start(mm);

  await wallet.connect();
  const s = wallet.getState();
  assert.equal(s.status, "disconnected");
  assert.equal(s.account, null);
  assert.equal(s.error, MESSAGES.rejected);
});

test("handles a connection request that is already pending (-32002)", async () => {
  const mm = createMockProvider();
  mm.rejectConnect = Object.assign(new Error("Request already pending"), { code: -32002 });
  await start(mm);

  await wallet.connect();
  assert.equal(wallet.getState().error, MESSAGES.pending);
});

test("updates when the user switches accounts", async () => {
  const mm = createMockProvider({ accounts: [ADDR_A, ADDR_B] });
  await start(mm);
  await wallet.connect();

  mm.emit("accountsChanged", [ADDR_B.toLowerCase()]);
  await settle();
  assert.equal(wallet.getState().account, ADDR_B);
  assert.equal(wallet.getState().status, "connected");
});

test("treats an empty accounts list (locked wallet) as disconnected", async () => {
  const mm = createMockProvider();
  await start(mm);
  await wallet.connect();

  mm.emit("accountsChanged", []);
  await settle();
  const s = wallet.getState();
  assert.equal(s.status, "disconnected");
  assert.equal(s.account, null);
  assert.equal(s.error, MESSAGES.locked);
});

test("updates on network change and flags unsupported networks", async () => {
  const mm = createMockProvider({ chainId: "0x1" });
  await start(mm);
  await wallet.connect();
  assert.equal(wallet.getState().chainName, "Ethereum");

  mm.emit("chainChanged", "0x89"); // Polygon: supported
  await settle();
  assert.equal(wallet.getState().chainId, 137);
  assert.equal(wallet.getState().supported, true);

  mm.emit("chainChanged", "0x38"); // BNB Chain: supported
  await settle();
  assert.equal(wallet.getState().chainId, 56);
  assert.equal(wallet.getState().chainName, "BNB Chain");
  assert.equal(wallet.getState().supported, true);

  mm.emit("chainChanged", "0xa86a"); // Avalanche: known but unsupported
  await settle();
  assert.equal(wallet.getState().chainName, "Avalanche C-Chain");
  assert.equal(wallet.getState().supported, false);

  mm.emit("chainChanged", "0x270f"); // 9999: completely unknown
  await settle();
  assert.equal(wallet.getState().chainName, "Unknown network");
  assert.equal(wallet.getState().supported, false);

  mm.emit("chainChanged", "0x1"); // back to a supported chain
  await settle();
  assert.equal(wallet.getState().supported, true);
});

test("disconnect clears app state, ignores wallet events and blocks auto-reconnect", async () => {
  const mm = createMockProvider();
  const storage = await start(mm);
  await wallet.connect();
  assert.equal(wallet.getState().status, "connected");

  wallet.disconnect();
  let s = wallet.getState();
  assert.equal(s.status, "disconnected");
  assert.equal(s.account, null);
  assert.equal(s.chainId, null);

  mm.emit("accountsChanged", [ADDR_B]);
  mm.emit("chainChanged", "0x1");
  await settle();
  assert.equal(wallet.getState().status, "disconnected"); // still disconnected

  // Reload the "page": MetaMask still lists the site as authorized, but we must not reconnect.
  wallet.destroy();
  await start(mm, { storage });
  assert.equal(wallet.getState().status, "disconnected");

  // The user explicitly reconnects.
  await wallet.connect();
  assert.equal(wallet.getState().status, "connected");
});

test("silently reconnects on load if the site was already approved", async () => {
  const mm = createMockProvider();
  mm.authorized = true;
  await start(mm);
  assert.equal(wallet.getState().status, "connected");
  assert.equal(wallet.getState().account, ADDR_A);
});

test("switchNetwork adds the chain when MetaMask doesn't know it (4902)", async () => {
  const mm = createMockProvider({ chainId: "0x1" });
  await start(mm);
  await wallet.connect();

  mm.switchError = Object.assign(new Error("Unrecognized chain"), { code: 4902 });
  await wallet.switchNetwork(8453); // Base
  await settle();
  assert.ok(mm.methodsCalled.includes("wallet_addEthereumChain"));
  assert.equal(wallet.getState().chainId, 8453);
});

test("switchNetwork reports a rejected switch", async () => {
  const mm = createMockProvider({ chainId: "0x38" });
  await start(mm);
  await wallet.connect();

  mm.switchError = Object.assign(new Error("User rejected"), { code: 4001 });
  await wallet.switchNetwork(1);
  assert.equal(wallet.getState().error, MESSAGES.switchRejected);
});

test("only uses non-secret JSON-RPC methods (never keys, seed or signing)", async () => {
  const mm = createMockProvider({ chainId: "0x1" });
  await start(mm);
  await wallet.connect();
  mm.emit("chainChanged", "0x89");
  await wallet.switchNetwork(1);
  wallet.disconnect();

  const allowed = new Set([
    "eth_requestAccounts",
    "eth_accounts",
    "eth_chainId",
    "net_version",
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
  ]);
  for (const method of mm.methodsCalled) {
    assert.ok(allowed.has(method), `unexpected RPC method: ${method}`);
  }
});
