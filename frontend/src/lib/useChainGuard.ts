"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EXPLORER_URL,
  NETWORK_CHAIN_ID,
  NETWORK_NAME,
  NETWORK_RPC_URL,
  type EthereumProvider,
} from "@/lib/contract";

const HEX_CHAIN_ID = `0x${NETWORK_CHAIN_ID.toString(16)}`;

function provider(): EthereumProvider | undefined {
  return typeof window !== "undefined" ? window.ethereum : undefined;
}

/** Reports the wallet's live chain so the UI never claims a network it isn't on. */
export function useChainGuard() {
  const [chainId, setChainId] = useState<number | null>(null);

  useEffect(() => {
    const wallet = provider();
    if (!wallet) return;
    let cancelled = false;

    const read = async () => {
      try {
        const value = await wallet.request({ method: "eth_chainId" });
        if (!cancelled) setChainId(Number(value));
      } catch {
        if (!cancelled) setChainId(null);
      }
    };
    void read();

    const onChanged = (...args: unknown[]) => setChainId(Number(args[0]));
    wallet.on?.("chainChanged", onChanged);
    return () => {
      cancelled = true;
      wallet.removeListener?.("chainChanged", onChanged);
    };
  }, []);

  const switchNetwork = useCallback(async () => {
    const wallet = provider();
    if (!wallet) return;
    try {
      await wallet.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: HEX_CHAIN_ID }],
      });
    } catch (error) {
      // 4902 (and some wallets' -32603) mean the chain is not registered yet.
      const code = (error as { code?: number })?.code;
      const unknownChain =
        code === 4902 ||
        code === -32603 ||
        /unrecognized|unknown chain|add.*chain/i.test(
          error instanceof Error ? error.message : "",
        );
      if (!unknownChain) throw error;
      await wallet.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: HEX_CHAIN_ID,
            chainName: NETWORK_NAME,
            nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
            rpcUrls: [NETWORK_RPC_URL],
            blockExplorerUrls: [EXPLORER_URL],
          },
        ],
      });
    }
  }, []);

  return {
    chainId,
    wrongNetwork: chainId !== null && chainId !== NETWORK_CHAIN_ID,
    networkName: NETWORK_NAME,
    switchNetwork,
  };
}
