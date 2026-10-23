# MetaMask Wallet Integration

A small web app that connects to MetaMask using [ethers.js](https://docs.ethers.org/v6/) (v6) and [Vite](https://vitejs.dev/). It shows how a frontend talks to a blockchain wallet: connecting, reading the account and network, reacting when the user changes either one in MetaMask, and failing gracefully.

**Learning-question answers:** see [ANSWERS.md](./ANSWERS.md).

## Features

| Requirement | Where it lives |
| --- | --- |
| Connect MetaMask | `connect()` in `src/wallet.js` |
| Not installed / request rejected / request already pending | `init()`, `describeError()` in `src/wallet.js`; banners in `src/main.js` |
| Show address, network name, chain ID, status | `render()` in `src/main.js` |
| Disconnect | `disconnect()` in `src/wallet.js` (clears app state; see [Disconnecting](#disconnecting)) |
| Account changes | `accountsChanged` handler in `src/wallet.js` |
| Network changes | `chainChanged` handler in `src/wallet.js` |
| Unsupported networks | `src/networks.js` allow-list, warning banner with "Switch to…" buttons |
| No keys or seed phrases | Only non-secret RPC methods are used; enforced by a test (see [Security](#security)) |

## Prerequisites

- Node.js 20.19+ or 22.12+ (required by Vite 7) and npm
- The [MetaMask](https://metamask.io/download/) browser extension (Chrome, Brave, Edge, or Firefox)

## Setup

```bash
git clone <your-repo-url>
cd metamask-wallet-integration
npm install
npm run dev        # opens http://localhost:5173
```

Other scripts:

```bash
npm run build      # production build into dist/
npm run preview    # serve the production build locally
npm test           # unit tests for the wallet layer (mock MetaMask, no browser needed)
```

> Serve the app over `http://localhost` (as `npm run dev` does). MetaMask does not inject itself into pages opened directly from disk (`file://`).

## Project structure

```
index.html              page markup
src/
  main.js               UI: renders state, wires buttons, activity log
  wallet.js             all MetaMask communication + state machine (no DOM code)
  networks.js           supported-chain allow-list and helpers
  style.css             styles (light and dark)
tests/
  wallet.test.mjs       tests using a mock EIP-1193 provider
ANSWERS.md              answers to the learning questions
```

`wallet.js` has no DOM code on purpose. The UI subscribes to its state, which keeps the wallet logic testable and the UI a pure function of state.

## How the frontend communicates with MetaMask

MetaMask is a browser extension. When a page loads, the extension **injects a JavaScript provider object** into it. That provider follows the [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) standard, which defines just two things:

1. **Requests**: `provider.request({ method, params })` returns a promise. The methods are standard JSON-RPC names.
2. **Events**: `provider.on("accountsChanged" | "chainChanged" | "connect" | "disconnect", handler)`.

```
 Web page (this app)                    MetaMask extension
 ───────────────────                    ──────────────────
 request("eth_requestAccounts")  ───▶   shows "Connect" popup to the user
                                 ◀───   ["0xAbc…"]  (or error 4001 if rejected)

 request("eth_chainId")          ───▶   (no popup, read-only)
                                 ◀───   "0xaa36a7"  (11155111, Sepolia)

 user switches account/network   ◀───   event: accountsChanged / chainChanged
```

The page never sees keys. It sends requests; the extension decides what to approve, shows its own UI, and returns only results.

**Finding the provider.** `wallet.js` first uses [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) discovery (the page dispatches `eip6963:requestProvider`; wallets reply with `eip6963:announceProvider`) and picks the one whose `rdns` is `io.metamask`. This works even when several wallet extensions are installed and fighting over `window.ethereum`. If nothing announces itself, it falls back to `window.ethereum`.

**Where ethers.js fits.** `new BrowserProvider(injectedProvider, "any")` wraps the raw provider. This app uses it to read the network (`getNetwork()`) and to checksum addresses (`getAddress()`). The `"any"` option lets ethers follow network switches instead of throwing "network changed" errors. For approval-popup calls, such as `eth_requestAccounts`, the app calls `provider.request()` directly so MetaMask's native error codes reach our error handling unchanged.

JSON-RPC methods used (all non-secret):

| Method | Popup? | Purpose |
| --- | --- | --- |
| `eth_requestAccounts` | Yes | Ask the user to connect; returns approved account addresses |
| `eth_accounts` | No | Silent check for already-approved accounts (auto-reconnect) |
| `eth_chainId` | No | Current network (via ethers `getNetwork()`) |
| `wallet_switchEthereumChain` | Yes | Ask MetaMask to switch to a supported network |
| `wallet_addEthereumChain` | Yes | Ask MetaMask to add a network it doesn't know (error `4902`) |

## Behaviour details

### Connecting and errors

| Situation | What the user sees |
| --- | --- |
| MetaMask not installed | "MetaMask not detected" status, an install link, and a disabled Connect button |
| User clicks Reject (error `4001`) | Red banner explaining the rejection; the button stays available to retry |
| Popup already open (error `-32002`) | Red banner telling the user to open the MetaMask extension |
| Wallet locked, or site access removed | App returns to "Not connected" with an explanatory message |
| MetaMask loses its RPC connection (`disconnect` event) | Red banner; the app reconnects automatically when the `connect` event fires |
| Unsupported network | Yellow banner naming the network and chain ID, plus one-click "Switch to…" buttons |

### Account and network changes

The app listens to `accountsChanged` and `chainChanged` and updates immediately. No page reload is needed because the app holds no chain-dependent objects (such as contract instances) that a network change would invalidate. If you extend it with contracts or signers, rebuild them in these handlers, or reload the page as MetaMask's docs suggest.

An empty `accountsChanged` array means the wallet was locked or the user revoked the site. The app treats it as a disconnect.

### Disconnecting

The Disconnect button calls MetaMask's `wallet_revokePermissions` with `[{ eth_accounts: {} }]` to revoke this site's account access. While the request runs, the button is disabled. On success, the app:

1. clears the app's connected-wallet state,
2. remembers that choice (one non-sensitive boolean in `localStorage`) so the app doesn't silently reconnect on reload, and
3. ignores wallet events until the user clicks Connect again.

If MetaMask rejects the request or does not support it, the app displays an error and keeps the connection visible so the user can retry or remove the site under *Permissions* in MetaMask.

### Changing the supported networks

Edit `SUPPORTED_CHAINS` in `src/networks.js`. Anything not listed triggers the unsupported-network warning. Included: Ethereum Mainnet (1), Sepolia (11155111), Polygon (137), Base (8453).

## Security

- The app never requests, receives, displays, or stores a private key or seed phrase. No code path asks for one.
- The only RPC methods used are the five listed above. No signing or transaction-sending methods appear in the code, and `tests/wallet.test.mjs` fails if any method outside that allow-list is called.
- Wallet data is rendered with `textContent` and never `innerHTML`, so nothing from the wallet can inject markup.
- The only value persisted is the `wallet-demo:user-disconnected` flag.

## Manual test checklist (with real MetaMask)

1. **Not installed:** open the app in a browser profile without MetaMask. You should see "MetaMask not detected" and the install link.
2. **Reject:** click *Connect Wallet*, then *Cancel* in MetaMask. You should see the rejection message and be able to retry.
3. **Connect:** click *Connect Wallet* and approve. The address, network name, chain ID, and a green "Connected" pill appear.
4. **Account switch:** in MetaMask, connect a second account to the site and select it. The address updates with no reload.
5. **Network switch:** switch to another supported network (e.g. Sepolia to Ethereum Mainnet). The network and chain ID update.
6. **Unsupported network:** switch to one not in the allow-list (e.g. BNB Smart Chain). A yellow banner appears; click a "Switch to…" button to recover.
7. **Lock:** lock MetaMask. The app shows "Not connected" with a message.
8. **Disconnect:** click *Disconnect*. State clears; reload the page and confirm it does **not** reconnect automatically. Click *Connect Wallet* to reconnect.

## Troubleshooting

- **"MetaMask not detected" but it's installed:** make sure you opened `http://localhost:5173` rather than a `file://` page, and that the extension is enabled for the site. Reload after installing.
- **Several wallets installed:** the app picks MetaMask via EIP-6963, so other wallets shouldn't interfere. If one does, disable the others while testing.
- **Connect button greyed out and "Waiting for approval":** a popup is probably open behind the browser window. Check the MetaMask extension icon.

## Tech stack

- [ethers.js v6](https://docs.ethers.org/v6/) for network detection and address checksumming
- [Vite](https://vitejs.dev/) for dev server and bundling
- Plain JavaScript, HTML, and CSS (no framework)
- Node's built-in test runner (`node --test`)
