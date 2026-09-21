import { connectorsForWallets, darkTheme } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  zerionWallet,
  metaMaskWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, createStorage, http } from "wagmi";
import { defineChain } from "viem";
import { apiUrl } from "./api";

// Public application identifier, not a secret or wallet credential. Override at build time.
export const walletConnectProjectId = __WALLETCONNECT_PROJECT_ID__;
export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: {
      name: "Robinhood Explorer",
      url: "https://robinhoodchain.blockscout.com",
    },
  },
});
const connectors = connectorsForWallets(
  [
    {
      groupName: "Connect to Farfield",
      wallets: walletConnectProjectId
        ? [injectedWallet, zerionWallet, metaMaskWallet, walletConnectWallet]
        : [injectedWallet],
    },
  ],
  { appName: "Farfield", projectId: walletConnectProjectId },
);
export const walletConfig = createConfig({
  // Access can be denied by browser privacy settings, including the getter itself.
  storage: createStorage({
    storage: {
      getItem(key) {
        try {
          return window.localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      setItem(key, value) {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          /* Session only. */
        }
      },
      removeItem(key) {
        try {
          window.localStorage.removeItem(key);
        } catch {
          /* Session only. */
        }
      },
    },
  }),
  chains: [robinhood],
  connectors,
  multiInjectedProviderDiscovery: true,
  transports: {
    [robinhood.id]: http(apiUrl("/api/friend-rpc"), {
      batch: false,
      retryCount: 1,
      timeout: 12000,
    }),
  },
});
const baseTheme = darkTheme({
  accentColor: "#c2d7b5",
  accentColorForeground: "#17251d",
  borderRadius: "small",
  overlayBlur: "small",
});
export const walletTheme = {
  ...baseTheme,
  fonts: { body: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
  radii: {
    ...baseTheme.radii,
    actionButton: "5px",
    connectButton: "5px",
    menuButton: "5px",
    modal: "9px",
    modalMobile: "9px",
  },
  colors: {
    ...baseTheme.colors,
    modalBackground: "#14232d",
    modalBorder: "#344a53",
    modalText: "#e6e9df",
    modalTextDim: "#81949e",
    modalTextSecondary: "#a3b2b6",
    modalBackdrop: "#070e19bb",
    generalBorder: "#344a53",
    generalBorderDim: "#2b3943",
    actionButtonBorder: "#344a53",
    actionButtonBorderMobile: "#344a53",
    actionButtonSecondaryBackground: "#1b2932",
    connectButtonBackground: "#1b2932",
    connectButtonText: "#dce6dd",
    connectButtonInnerBackground: "#101b26",
    closeButton: "#afc0c3",
    closeButtonBackground: "#1b2932",
    connectionIndicator: "#b9d5b6",
    error: "#ee9a9e",
    standby: "#e7c66b",
    menuItemBackground: "#293c43",
    profileForeground: "#101b26",
    profileAction: "#1b2932",
    profileActionHover: "#293c43",
    downloadTopCardBackground: "#14232d",
    downloadBottomCardBackground: "#101b26",
    selectedOptionBorder: "#b9d5b6",
  },
  shadows: {
    ...baseTheme.shadows,
    connectButton: "none",
    dialog: "0 18px 80px #0009",
    selectedOption: "0 0 0 1px #b9d5b6",
  },
};
