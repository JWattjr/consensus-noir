"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, LogIn, LogOut, Wallet } from "lucide-react";
import { baseExplorerAddress } from "@/lib/base-sepolia";
import { useAuthStore } from "@/store/useAuthStore";

type WalletLoginButtonProps = {
  compact?: boolean;
  className?: string;
};

export default function WalletLoginButton({ compact = false, className = "" }: WalletLoginButtonProps) {
  const auth = useAuthStore();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const walletAddress = auth.authenticated ? auth.walletAddress ?? "" : "";

  async function copyAddress() {
    if (!walletAddress) return;
    await navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  if (!auth.ready) {
    return <span className={`inline-flex items-center gap-1.5 rounded-full border-2 border-primary-900 bg-white px-3 py-1.5 text-[10px] font-bold ${className}`}><Wallet size={compact ? 12 : 14} />Loading</span>;
  }

  if (!auth.configured) {
    return <span title="Install MetaMask, Rabby, Coinbase Wallet, or another injected EVM wallet." className={`inline-flex items-center gap-1.5 rounded-full border-2 border-primary-900 bg-white px-3 py-1.5 text-[10px] font-bold ${className}`}><Wallet size={compact ? 12 : 14} />Install EVM wallet</span>;
  }

  if (!auth.authenticated) {
    return <button type="button" title={auth.error ?? undefined} onClick={() => void auth.login()} className={`inline-flex items-center gap-1.5 rounded-full border-2 border-primary-900 bg-pastel-green px-3 py-1.5 text-[10px] font-bold shadow-[2px_2px_0px_0px_#312e81] transition-all hover:translate-y-0.5 hover:shadow-none ${className}`}><LogIn size={compact ? 12 : 14} />{auth.error ? "Try wallet again" : compact ? "Connect" : "Connect EVM wallet"}</button>;
  }

  return (
    <div className="relative inline-flex">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className={`inline-flex items-center gap-1.5 rounded-full border-2 border-primary-900 bg-white px-3 py-1.5 text-[10px] font-bold shadow-[2px_2px_0px_0px_#312e81] transition-all hover:translate-y-0.5 hover:shadow-none ${className}`}>
        <Wallet size={compact ? 12 : 14} />{compact ? auth.displayName : `Wallet ${auth.displayName}`}
      </button>
      {open ? (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-72 rounded-3xl border-3 border-primary-900 bg-white p-3 text-left shadow-[4px_4px_0px_0px_#312e81]">
          <p className="text-[10px] font-bold uppercase opacity-60">Connected EVM wallet</p>
          <p className="mt-1 break-all text-xs font-bold">{walletAddress}</p>
          <p className="mt-3 rounded-2xl bg-pastel-blue p-3 text-[10px] font-bold leading-relaxed">This archived prototype uses test assets only. The active submission runs on GenLayer StudioNet.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={copyAddress} className="inline-flex items-center justify-center gap-1.5 rounded-full border-2 border-primary-900 bg-pastel-yellow px-3 py-2 text-[10px] font-bold">{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "Copied" : "Copy"}</button>
            {walletAddress ? <a href={baseExplorerAddress(walletAddress)} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-full border-2 border-primary-900 bg-white px-3 py-2 text-[10px] font-bold">Explorer <ExternalLink size={12} /></a> : null}
          </div>
          <button type="button" onClick={() => { setOpen(false); auth.logout(); }} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full border-2 border-primary-900 bg-white px-3 py-2 text-[10px] font-bold"><LogOut size={12} />Disconnect</button>
        </div>
      ) : null}
    </div>
  );
}
