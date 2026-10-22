/**
 * Networks (chains) this app accepts.
 *
 * Add or remove entries to change what counts as "supported". Any other chain
 * the user switches to in MetaMask triggers the "unsupported network" warning.
 *
 * `addParams` is only used when MetaMask doesn't know the chain yet and we ask
 * it to add the chain via `wallet_addEthereumChain`. Ethereum Mainnet and
 * Sepolia are built into MetaMask, so they need none.
 */
export const SUPPORTED_CHAINS = {
  1: { name: "Ethereum", testnet: false },
  10: {
    name: "OP Mainnet",
    testnet: false,
    addParams: {
      rpcUrls: ["https://mainnet.optimism.io"],
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      blockExplorerUrls: ["https://optimistic.etherscan.io"],
    },
  },
  56: {
    name: "BNB Chain",
    testnet: false,
    addParams: {
      rpcUrls: ["https://bsc-dataseed.bnbchain.org"],
      nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
      blockExplorerUrls: ["https://bscscan.com"],
    },
  },
  11155111: { name: "Sepolia Testnet", testnet: true },
  137: {
    name: "Polygon",
    testnet: false,
    addParams: {
      rpcUrls: ["https://polygon-rpc.com"],
      nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
      blockExplorerUrls: ["https://polygonscan.com"],
    },
  },
  143: {
    name: "Monad",
    testnet: false,
    addParams: {
      rpcUrls: ["https://rpc.monad.xyz"],
      nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
      blockExplorerUrls: ["https://monadscan.com"],
    },
  },
  5042: {
    name: "Arc",
    testnet: false,
    addParams: {
      rpcUrls: ["https://rpc.mainnet.arc.io"],
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      blockExplorerUrls: ["https://explorer.arc.io"],
    },
  },
  8453: {
    name: "Base",
    testnet: false,
    addParams: {
      rpcUrls: ["https://mainnet.base.org"],
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      blockExplorerUrls: ["https://basescan.org"],
    },
  },
  42161: {
    name: "Arbitrum One",
    testnet: false,
    addParams: {
      rpcUrls: ["https://arb1.arbitrum.io/rpc"],
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      blockExplorerUrls: ["https://arbiscan.io"],
    },
  },
  59144: {
    name: "Linea",
    testnet: false,
    addParams: {
      rpcUrls: ["https://rpc.linea.build"],
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      blockExplorerUrls: ["https://lineascan.build"],
    },
  },
};

/** Friendly names for well-known chains we do NOT support (used in messages only). */
const KNOWN_CHAIN_NAMES = {
  43114: "Avalanche C-Chain",
  80002: "Polygon Amoy Testnet",
  84532: "Base Sepolia Testnet",
  1337: "Local development chain",
  31337: "Hardhat local chain",
};

export function getChain(chainId) {
  return SUPPORTED_CHAINS[chainId] ?? null;
}

export function chainLabel(chainId) {
  return (
    SUPPORTED_CHAINS[chainId]?.name ?? KNOWN_CHAIN_NAMES[chainId] ?? "Unknown network"
  );
}

export function toHexChainId(chainId) {
  return "0x" + Number(chainId).toString(16);
}

/** Parameters for wallet_addEthereumChain, or null if we have none for this chain. */
export function addChainParams(chainId) {
  const chain = SUPPORTED_CHAINS[chainId];
  if (!chain?.addParams) return null;
  return { chainId: toHexChainId(chainId), chainName: chain.name, ...chain.addParams };
}

export function supportedChainNames() {
  return Object.values(SUPPORTED_CHAINS).map((c) => c.name);
}
