# Learning Questions: Answers

## 1. What is MetaMask, and what role does it play in a Web3 application?

MetaMask is a crypto wallet that ships as a browser extension (and a mobile app). It does three jobs:

- **Key custody.** It generates and stores the user's private keys (derived from a seed phrase) encrypted on the user's own device.
- **Gateway to the blockchain.** It connects to blockchain nodes over RPC, so the user's browser can read balances and broadcast transactions without the dapp running a node.
- **Approval layer.** It injects a standard provider object (`window.ethereum`, EIP-1193) into web pages. A page can *ask* MetaMask for accounts, signatures, or transactions, but only the user can approve them, in MetaMask's own UI.

In a Web3 application, MetaMask therefore plays the role of **identity, signer, and network connection** all at once. The user's address acts as their login, and the dapp never holds anything secret. That is a different trust model from a normal website, where the server stores a password hash and the account lives in the company's database.

## 2. What is the difference between a wallet address and a private key?

| | Wallet address | Private key |
| --- | --- | --- |
| What it is | Public identifier, 20 bytes shown as `0x` + 40 hex characters | Secret 256-bit number |
| Who can know it | Anyone; it is visible on-chain and safe to share | Only the owner; never share it |
| What it allows | Receiving funds, being looked up on explorers, being identified by dapps | Signing transactions and messages, i.e. full control of the account |
| Derivation | Computed from the public key (the last 20 bytes of its Keccak-256 hash) | Randomly generated; the root of the chain |

The chain of derivation is **private key → public key → address**, and each step is one-way: you can't recover the private key from an address. A **seed phrase** (12 or 24 words, BIP-39) is a human-readable way to regenerate a whole sequence of private keys, so it is just as sensitive as the keys themselves. Mixed-case addresses use the EIP-55 checksum, which lets software detect typos.

An address is like an account number you can hand out freely; the private key is the signing authority over the account. Anyone who has the key controls the funds, permanently and irreversibly.

## 3. What is the difference between connecting a wallet and signing a transaction?

**Connecting** (`eth_requestAccounts`) gives the site permission to *see* which account address(es) the user chose to share. It is free, needs no gas, and cannot move funds or change anything on-chain. It is closer to "Sign in as…" than to a payment. Note that connecting by itself does not *prove* the user owns the address; it is just the wallet reporting it.

**Signing** is the cryptographic act of producing a signature with the private key, and it happens inside MetaMask each time the user approves a prompt:

- **Signing a message** (`personal_sign`, `eth_signTypedData`) proves ownership of the address. This is how "Sign-In with Ethereum" works. It is free but can still be dangerous if the message authorises something (e.g. a token approval).
- **Signing a transaction** (`eth_sendTransaction`) authorises a state change, such as a transfer or a contract call. Once broadcast it costs gas and cannot be undone.

In short: connecting = *"you may know my address"*; signing = *"I authorise this specific action."* A connected site cannot sign anything without a fresh, explicit approval. This demo only does the first and never requests a signature.

## 4. What is a blockchain chain ID, and why does it matter?

A chain ID is a number that uniquely identifies an EVM network, defined by EIP-155. Examples: `1` Ethereum Mainnet, `11155111` Sepolia testnet, `137` Polygon, `8453` Base. MetaMask reports it in hex (`0x1`, `0xaa36a7`, …) via `eth_chainId` and the `chainChanged` event.

It matters because:

- **The same address exists on every EVM chain, but the state differs.** Balances, contracts, and tokens on Sepolia are not those on Mainnet. A dapp has to know which chain the user is actually on, or it will show wrong data or send the user to the wrong place.
- **Replay protection.** The chain ID is part of what the user signs in a transaction, so a transaction signed for one chain can't be replayed on another.
- **Deployment targets.** A dapp's contracts live at specific addresses on specific chains, so the app should check the chain ID and prompt the user to switch when needed. That is what the "unsupported network" banner here does.
- **Names aren't reliable.** Chain names are display labels and can clash or be spoofed; the ID is the identifier to compare against.

## 5. Why should a frontend application never request or store a user's seed phrase or private key?

Because whoever holds either one has **complete, permanent, irreversible control** of every asset in the account, and a frontend is one of the least safe places to hold such a thing:

- **Large attack surface.** Frontend code and its environment are exposed to XSS, compromised npm dependencies, malicious browser extensions, analytics and error-logging tools, and browser storage that other scripts can read. One leak is enough to drain an account.
- **The design already solves the problem.** MetaMask exists so that keys stay inside the wallet. The app asks for a *signature*; it never needs the key that produces it. Any app that asks for a key has no legitimate reason to.
- **Phishing signal.** Legitimate sites and MetaMask itself never ask for a seed phrase. A page that does is, by definition, behaving like a scam, and users are trained to leave immediately.
- **Liability.** Holding keys makes the developer a custodian of users' funds, with the legal and security obligations that implies.

This app's only interaction is `eth_requestAccounts` and read-only/chain-switching calls. The sole thing it saves in `localStorage` is a boolean noting that the user clicked Disconnect, and a test fails if any unexpected RPC method is called.

## 6. What happens when a user changes accounts or networks while the application is open?

MetaMask fires an event on the injected provider, and the page is **not** told in any other way:

- `accountsChanged` fires with the new array of accounts (the first is the active one). An **empty array** means the wallet was locked or the site's access was removed.
- `chainChanged` fires with the new chain ID as a hex string.

If the app ignores these events, the UI goes stale. It may show account A while MetaMask will sign with account B, or show Sepolia data while the user is actually on Mainnet. Libraries can also throw "network changed" errors because their cached network no longer matches the wallet, and a server-side session tied to the old address would now be wrong.

This app handles both events:

- **Account change:** re-reads the connection and shows the new checksummed address. An empty list is treated as a disconnect, with an explanatory message.
- **Network change:** recomputes the network name and chain ID; if the new chain isn't in the allow-list, it shows a warning with buttons to switch back (`wallet_switchEthereumChain`, falling back to `wallet_addEthereumChain` when MetaMask doesn't know the chain).
- **After the user clicked Disconnect:** events are ignored until the user reconnects, so the app never "reconnects" behind their back.

A larger dapp should also discard any state derived from the previous account or chain (contract instances, cached balances, auth sessions) in these same handlers.
