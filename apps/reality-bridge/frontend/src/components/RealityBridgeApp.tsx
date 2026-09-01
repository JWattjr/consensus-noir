"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  ChevronRight,
  FlaskConical,
  Info,
  LoaderCircle,
  Menu,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import ActionPanel, { type Choice } from "@/components/ActionPanel";
import RoundLobby from "@/components/RoundLobby";
import {
  BridgeBoard,
  EvidenceLedger,
  PlayerRail,
} from "@/components/RoundBoard";
import TransactionMonitor from "@/components/TransactionMonitor";
import {
  EmptyState,
  StatusPill,
  useHasInjectedProvider,
  useNow,
} from "@/components/ui";
import {
  ACTION_LABEL,
  CONTRACT_ADDRESS,
  IS_CONFIGURED,
  PINNED_ROUND_ID,
  readConfig,
  readRoundBundle,
  readRoundIds,
  readRoundSummaries,
  submitWrite,
  watchTransaction,
  type ConfigView,
  type RoundBundle,
  type RoundView,
  type WriteAction,
} from "@/lib/contract";
import { choiceCommitment, generateSalt } from "@/lib/crypto";
import {
  actionById,
  deriveState,
  filterRounds,
  preferredRound,
  type ActionId,
  type LobbyFilter,
} from "@/lib/derive";
import { formatAmount, sameAddress, shortAddress } from "@/lib/format";
import {
  NATIVE_SYMBOL,
  NETWORK_CHAIN_ID,
  NETWORK_LABEL,
  explorerAddressUrl,
  getInjectedProvider,
  readChainId,
  switchToStudioNet,
  parseChainId,
} from "@/lib/network";
import {
  DEFAULT_TOP_UP_WEI,
  needsTopUp,
  readBalance,
  requestTestFunds,
} from "@/lib/faucet";
import { buildBundle, type RecoveryBundle } from "@/lib/recovery";
import {
  clearPending,
  findBundle,
  forgetBundle,
  historyServerSnapshot,
  historySnapshot,
  loadPending,
  recordHistory,
  rememberPending,
  saveBundle,
  subscribeHistory,
} from "@/lib/storage";
import {
  SCENARIOS,
  SIMULATION_ACCOUNT,
  SIMULATION_CONFIG,
  SIMULATION_CONTRACT,
  createSimulation,
  scenarioName,
  simulateClaim,
  simulateCommit,
  simulateForfeit,
  simulateRefund,
  simulateLapse,
  simulateResolve,
  simulateReveal,
  simulationClock,
  type ScenarioId,
  type SimulationState,
} from "@/lib/simulation";
import { isBusy, isSuccess, type TxState } from "@/lib/tx";

type Mode = "live" | "simulation";


type LoadPhase = "idle" | "loading" | "ready" | "error";

interface Notice {
  tone: "info" | "success" | "error";
  message: string;
}

export default function RealityBridgeApp() {
  const now = useNow();

  const [mode, setMode] = useState<Mode>("live");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  // -- wallet ---------------------------------------------------------------
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [faucetBusy, setFaucetBusy] = useState(false);
  const hasProvider = useHasInjectedProvider();

  // -- live chain state -----------------------------------------------------
  const [phase, setPhase] = useState<LoadPhase>(
    IS_CONFIGURED ? "loading" : "idle",
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [summaries, setSummaries] = useState<RoundView[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [bundleState, setBundleState] = useState<RoundBundle | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // -- simulation -----------------------------------------------------------
  const [scenarioId, setScenarioId] = useState<ScenarioId>("clean-crossing");
  const [simulation, setSimulation] = useState<SimulationState | null>(null);

  // -- interaction ----------------------------------------------------------
  const [filter, setFilter] = useState<LobbyFilter>("all");
  const [selectedChoice, setSelectedChoice] = useState<Choice | null>(null);
  const [pendingBundle, setPendingBundle] = useState<RecoveryBundle | null>(null);
  const [bundleAcknowledged, setBundleAcknowledged] = useState(false);
  const [activeBundle, setActiveBundle] = useState<RecoveryBundle | null>(null);
  const [showDisclosure, setShowDisclosure] = useState(false);
  const [tx, setTx] = useState<TxState | null>(null);
  const history = useSyncExternalStore(
    subscribeHistory,
    historySnapshot,
    historyServerSnapshot,
  );

  const abortRef = useRef<AbortController | null>(null);

  const isSimulation = mode === "simulation";
  const networkOk = isSimulation || chainId === NETWORK_CHAIN_ID;
  const effectiveAccount = isSimulation ? SIMULATION_ACCOUNT : account;
  const effectiveContract = isSimulation ? SIMULATION_CONTRACT : CONTRACT_ADDRESS;

  // -------------------------------------------------------------------------
  // Wallet wiring
  // -------------------------------------------------------------------------

  useEffect(() => {
    const provider = getInjectedProvider();
    if (!provider) return;
    let cancelled = false;

    void provider
      .request({ method: "eth_accounts" })
      .then((value) => {
        if (cancelled) return;
        const accounts = Array.isArray(value) ? value : [];
        if (typeof accounts[0] === "string") setAccount(accounts[0]);
      })
      .catch(() => undefined);

    void readChainId(provider).then((id) => {
      if (!cancelled) setChainId(id);
    });

    const onAccountsChanged = (...args: unknown[]) => {
      const next = Array.isArray(args[0]) ? args[0] : [];
      setAccount(typeof next[0] === "string" ? next[0] : "");
      setSelectedChoice(null);
      setPendingBundle(null);
      setActiveBundle(null);
      setBundleAcknowledged(false);
    };
    const onChainChanged = (...args: unknown[]) => {
      setChainId(parseChainId(args[0]));
    };

    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("chainChanged", onChainChanged);
    return () => {
      cancelled = true;
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

  const connectWallet = useCallback(async () => {
    const provider = getInjectedProvider();
    if (!provider) {
      setNotice({
        tone: "error",
        message: `No injected wallet was found. Install a wallet that can reach ${NETWORK_LABEL}.`,
      });
      return;
    }
    setWalletBusy(true);
    try {
      const value = await provider.request({ method: "eth_requestAccounts" });
      const accounts = Array.isArray(value) ? value : [];
      if (typeof accounts[0] !== "string") {
        throw new Error("The wallet returned no account.");
      }
      setAccount(accounts[0]);
      setChainId(await readChainId(provider));
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Wallet connection failed.",
      });
    } finally {
      setWalletBusy(false);
    }
  }, []);

  const refreshBalance = useCallback(async (address: string) => {
    if (!address) {
      setBalance(null);
      return;
    }
    setBalance(await readBalance(address));
  }, []);

  useEffect(() => {
    if (isSimulation || !account || !networkOk) {
      return;
    }
    let cancelled = false;
    readBalance(account).then((value) => {
      if (!cancelled) setBalance(value);
    });
    return () => {
      cancelled = true;
    };
  }, [account, isSimulation, networkOk]);

  const topUp = useCallback(async () => {
    if (!account) return;
    setFaucetBusy(true);
    try {
      const result = await requestTestFunds(account, DEFAULT_TOP_UP_WEI);
      setBalance(result.balance);
      setNotice({
        tone: result.ok ? "success" : "error",
        message: result.message,
      });
    } finally {
      setFaucetBusy(false);
    }
  }, [account]);

  const switchNetwork = useCallback(async () => {
    const provider = getInjectedProvider();
    if (!provider) return;
    setWalletBusy(true);
    try {
      const result = await switchToStudioNet(provider);
      setChainId(await readChainId(provider));
      if (!result.ok) {
        setNotice({
          tone: "error",
          message: result.message ?? `Could not switch to ${NETWORK_LABEL}.`,
        });
      }
    } finally {
      setWalletBusy(false);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Live reads
  // -------------------------------------------------------------------------

  // Fetchers are pure: they read StudioNet and return data. Every state update
  // happens in a promise callback, so an effect can start a load without
  // triggering a synchronous cascading render.
  const fetchLobby = useCallback(async () => {
    const [chainConfig, ids] = await Promise.all([readConfig(), readRoundIds()]);
    return { chainConfig, rounds: await readRoundSummaries(ids) };
  }, []);

  const applyLobbyError = useCallback((error: unknown) => {
    setPhase("error");
    setRefreshing(false);
    setLoadError(
      error instanceof Error
        ? error.message
        : `Could not read the Reality Bridge contract on ${NETWORK_LABEL}.`,
    );
  }, []);

  const applyLobby = useCallback(
    (result: { chainConfig: ConfigView; rounds: RoundView[] }) => {
      setConfig(result.chainConfig);
      setSummaries(result.rounds);
      setLoadError(null);
      setPhase("ready");
      setRefreshing(false);
      return result.rounds;
    },
    [],
  );

  const applyRound = useCallback((next: RoundBundle) => {
    setBundleState(next);
    setLoadError(null);
    setRefreshing(false);
  }, []);

  const applyRoundError = useCallback((error: unknown) => {
    setRefreshing(false);
    setLoadError(
      error instanceof Error ? error.message : "Could not read that round.",
    );
  }, []);

  const reload = useCallback(
    (roundId: string | null) => {
      setRefreshing(true);
      fetchLobby().then(applyLobby).catch(applyLobbyError);
      if (roundId) {
        readRoundBundle(roundId).then(applyRound).catch(applyRoundError);
      }
    },
    [applyLobby, applyLobbyError, applyRound, applyRoundError, fetchLobby],
  );

  useEffect(() => {
    if (mode !== "live" || !IS_CONFIGURED) return;
    let cancelled = false;
    fetchLobby()
      .then((result) => {
        if (cancelled) return;
        const rounds = applyLobby(result);
        if (rounds.length === 0) return;
        const preferred = preferredRound(
          rounds,
          PINNED_ROUND_ID,
          Math.floor(Date.now() / 1000),
        );
        if (preferred) {
          setSelectedRoundId((current) => current ?? preferred.round_id);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) applyLobbyError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [applyLobby, applyLobbyError, fetchLobby, mode]);

  useEffect(() => {
    if (mode !== "live" || !selectedRoundId) return;
    let cancelled = false;
    readRoundBundle(selectedRoundId)
      .then((next) => {
        if (!cancelled) applyRound(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) applyRoundError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [applyRound, applyRoundError, mode, selectedRoundId]);

  // -------------------------------------------------------------------------
  // Pending transaction reconciliation after a reload
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (mode !== "live" || !IS_CONFIGURED) return;
    const pending = loadPending();
    if (pending.length === 0) return;
    let cancelled = false;

    void (async () => {
      for (const entry of pending) {
        const settled = await watchTransaction(entry.hash, entry.action, {
          timeoutMs: 60_000,
        });
        if (cancelled) return;
        clearPending(entry.hash);
        recordHistory({
          ...entry,
          phase: settled.phase,
          statusName: settled.statusName,
          message: settled.message,
          settledAt: Date.now(),
        });
        if (isSuccess(settled)) {
          setNotice({
            tone: "success",
            message: `Reconciled a pending ${ACTION_LABEL[entry.action as WriteAction] ?? entry.action} transaction from a previous session.`,
          });
          if (entry.roundId) reload(entry.roundId);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, reload]);

  // -------------------------------------------------------------------------
  // Derived view model
  // -------------------------------------------------------------------------

  const activeBundleData: RoundBundle | null = useMemo(() => {
    // A reconciled transaction may request an older round in parallel with the
    // selected-round read. Never render that stale payload under a different
    // selected lobby row.
    if (!isSimulation) {
      if (!bundleState || bundleState.round.round_id !== selectedRoundId) {
        return null;
      }
      return bundleState;
    }
    if (!simulation) return null;
    return {
      round: simulation.round,
      tiles: simulation.tiles,
      players: simulation.players,
    };
  }, [bundleState, isSimulation, selectedRoundId, simulation]);

  const activeConfig = isSimulation ? SIMULATION_CONFIG : config;

  const storedBundle = useMemo(() => {
    if (!activeBundleData || !effectiveAccount) return null;
    if (activeBundle) return activeBundle;
    return findBundle({
      contract: effectiveContract,
      roundId: activeBundleData.round.round_id,
      tileIndex: activeBundleData.round.current_tile_index,
      account: effectiveAccount,
    });
  }, [activeBundle, activeBundleData, effectiveAccount, effectiveContract]);

  const derived = useMemo(() => {
    if (!activeBundleData || !activeConfig) return null;
    return deriveState({
      round: activeBundleData.round,
      tiles: activeBundleData.tiles,
      players: activeBundleData.players,
      config: activeConfig,
      account: effectiveAccount,
      networkOk,
      // A simulated round is gated by its own scripted clock, not the wall
      // clock; otherwise the walkthrough stalls until real deadlines pass.
      nowSeconds: isSimulation && simulation ? simulationClock(simulation) : now,
      txPending: isBusy(tx),
      hasRecoveryBundle: Boolean(storedBundle),
      commitmentReady: Boolean(pendingBundle) && bundleAcknowledged,
    });
  }, [
    activeBundleData,
    activeConfig,
    bundleAcknowledged,
    effectiveAccount,
    isSimulation,
    networkOk,
    now,
    pendingBundle,
    simulation,
    storedBundle,
    tx,
  ]);

  const joinedRoundIds = useMemo(() => {
    const ids = new Set<string>();
    if (activeBundleData && effectiveAccount) {
      const joined = activeBundleData.players.some((player) =>
        sameAddress(player.account, effectiveAccount),
      );
      if (joined) ids.add(activeBundleData.round.round_id);
    }
    return ids;
  }, [activeBundleData, effectiveAccount]);

  const actionableRoundIds = useMemo(() => {
    const ids = new Set<string>();
    if (!derived || !activeBundleData) return ids;
    const hasEnabled = derived.actions.some(
      (entry) => entry.enabled && !entry.hidden && !entry.permissionless,
    );
    if (hasEnabled) ids.add(activeBundleData.round.round_id);
    return ids;
  }, [activeBundleData, derived]);

  const visibleRounds = useMemo(
    () => filterRounds(summaries, filter, joinedRoundIds),
    [filter, joinedRoundIds, summaries],
  );

  // -------------------------------------------------------------------------
  // Commit / reveal preparation
  // -------------------------------------------------------------------------

  const prepareCommitment = useCallback(
    async (choice: Choice) => {
      if (!activeBundleData || !effectiveAccount) return;
      try {
        const salt = generateSalt();
        const roundId = activeBundleData.round.round_id;
        const tileIndex = activeBundleData.round.current_tile_index;
        const commitment = await choiceCommitment({
          roundId,
          tileIndex,
          account: effectiveAccount,
          choice,
          salt,
        });
        setPendingBundle(
          buildBundle({
            contract: effectiveContract,
            roundId,
            tileIndex,
            account: effectiveAccount,
            choice,
            salt,
            commitment,
          }),
        );
        setBundleAcknowledged(false);
      } catch (error) {
        setNotice({
          tone: "error",
          message:
            error instanceof Error
              ? error.message
              : "Could not build a commitment in this browser.",
        });
      }
    },
    [activeBundleData, effectiveAccount, effectiveContract],
  );

  const onSelectChoice = useCallback(
    (choice: Choice) => {
      setSelectedChoice(choice);
      setNotice(null);
      void prepareCommitment(choice);
    },
    [prepareCommitment],
  );

  const onRestoreBundle = useCallback((restored: RecoveryBundle) => {
    setActiveBundle(restored);
    saveBundle(restored);
    setNotice({
      tone: "success",
      message: "Recovery bundle verified against your on-chain commitment.",
    });
  }, []);

  // -------------------------------------------------------------------------
  // Simulation actions
  // -------------------------------------------------------------------------

  const runSimulationAction = useCallback(
    async (id: ActionId) => {
      setSimulation((current) => {
        if (!current) return current;
        switch (id) {
          case "commit_choice": {
            if (!pendingBundle || !selectedChoice) return current;
            return simulateCommit(current, selectedChoice, pendingBundle.commitment);
          }
          case "reveal_choice": {
            const choice = storedBundle?.choice ?? selectedChoice;
            if (!choice) return current;
            return simulateReveal(current, choice);
          }
          case "resolve_tile":
            return simulateResolve(current);
          case "forfeit_missed_reveal":
          case "forfeit_missed_commit":
            return simulateForfeit(current);
          case "claim":
            return simulateClaim(current);
          case "refund":
            return simulateRefund(current);
          default:
            return current;
        }
      });
      if (id === "commit_choice" && pendingBundle) {
        saveBundle(pendingBundle);
        setActiveBundle(pendingBundle);
        setPendingBundle(null);
      }
      if (id === "reveal_choice" || id === "resolve_tile") {
        setSelectedChoice(null);
      }
    },
    [pendingBundle, selectedChoice, storedBundle],
  );

  // -------------------------------------------------------------------------
  // Live actions
  // -------------------------------------------------------------------------

  const runLiveAction = useCallback(
    async (id: ActionId) => {
      if (!activeBundleData || !account) return;
      const round = activeBundleData.round;
      const roundId = round.round_id;

      let args: unknown[] = [Number(roundId)];
      let value = BigInt(0);

      if (id === "join_round") {
        value = BigInt(round.entry_amount);
      }
      if (id === "commit_choice") {
        if (!pendingBundle) {
          setNotice({
            tone: "error",
            message: "Pick YES or NO first so a commitment can be built.",
          });
          return;
        }
        if (!bundleAcknowledged) {
          setNotice({
            tone: "error",
            message:
              "Save the recovery bundle and tick the confirmation before signing.",
          });
          return;
        }
        args = [Number(roundId), pendingBundle.commitment];
      }
      if (id === "reveal_choice") {
        if (!storedBundle) {
          setNotice({
            tone: "error",
            message: "Restore your recovery bundle before revealing.",
          });
          return;
        }
        args = [Number(roundId), storedBundle.choice, storedBundle.salt];
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // The bundle is stored *before* the signature so a browser crash during
      // the wallet step cannot lose the salt behind an on-chain commitment.
      if (id === "commit_choice" && pendingBundle) {
        saveBundle(pendingBundle);
      }

      const settled = await submitWrite(
        { action: id as WriteAction, account, args, value },
        {
          signal: controller.signal,
          onUpdate: (state) => {
            setTx(state);
            if (state.hash && state.phase === "submitted") {
              rememberPending({
                hash: state.hash,
                action: state.action,
                roundId,
                account,
                startedAt: state.startedAt,
              });
            }
          },
        },
      );

      setTx(settled);
      if (settled.hash) {
        clearPending(settled.hash);
        recordHistory({
          hash: settled.hash,
          action: settled.action,
          roundId,
          account,
          startedAt: settled.startedAt,
          phase: settled.phase,
          statusName: settled.statusName,
          message: settled.message,
          settledAt: Date.now(),
        });
      }

      if (isSuccess(settled)) {
        if (id === "commit_choice" && pendingBundle) {
          setActiveBundle(pendingBundle);
          setPendingBundle(null);
          setBundleAcknowledged(false);
        }
        if (id === "reveal_choice") {
          setSelectedChoice(null);
        }
        if (id === "resolve_tile" && storedBundle) {
          forgetBundle({
            contract: effectiveContract,
            roundId,
            tileIndex: round.current_tile_index,
            account,
          });
          setActiveBundle(null);
        }
        setNotice({
          tone: "success",
          message:
            settled.phase === "finalized"
              ? `${ACTION_LABEL[id as WriteAction]} was finalized by ${NETWORK_LABEL}.`
              : `${ACTION_LABEL[id as WriteAction]} was accepted by ${NETWORK_LABEL}. The board below reads finalized state, so it catches up a moment later.`,
        });
        // The watch runs through to finality, and authoritative reads use the
        // finalized variant, so a single re-read here is already current.
        reload(roundId);
        void refreshBalance(account);
      } else if (settled.phase !== "rejected") {
        setNotice({
          tone: "error",
          message:
            settled.message ??
            `${ACTION_LABEL[id as WriteAction]} did not succeed on ${NETWORK_LABEL}.`,
        });
      }
    },
    [
      account,
      activeBundleData,
      bundleAcknowledged,
      effectiveContract,
      pendingBundle,
      refreshBalance,
      reload,
      storedBundle,
    ],
  );

  const onSimulateLapse = useCallback(() => {
    setSimulation((current) => (current ? simulateLapse(current) : current));
  }, []);

  const onAction = useCallback(
    (id: ActionId) => {
      setShowDisclosure(false);
      if (isBusy(tx)) return;
      if (isSimulation) {
        void runSimulationAction(id);
        return;
      }
      if (!derived) return;
      if (!actionById(derived, id).enabled) return;
      void runLiveAction(id);
    },
    [derived, isSimulation, runLiveAction, runSimulationAction, tx],
  );

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Mode switching
  // -------------------------------------------------------------------------

  const enterSimulation = useCallback(
    (id: ScenarioId) => {
      setScenarioId(id);
      setSimulation(createSimulation(id, Math.floor(Date.now() / 1000)));
      setMode("simulation");
      setSelectedChoice(null);
      setPendingBundle(null);
      setActiveBundle(null);
      setBundleAcknowledged(false);
      setTx(null);
      setNotice({
        tone: "info",
        message: `Simulation "${scenarioName(id)}" started. Nothing here touches a network.`,
      });
    },
    [],
  );

  const leaveSimulation = useCallback(() => {
    setMode("live");
    setSimulation(null);
    setSelectedChoice(null);
    setPendingBundle(null);
    setActiveBundle(null);
    setNotice(null);
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const contractLink = explorerAddressUrl(CONTRACT_ADDRESS);

  return (
    <main className="site-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <a className="skip-link" href="#main-content">
        Skip to the round
      </a>

      <header className="topbar">
        <a className="brand" href="#top" aria-label="Reality Bridge home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>
            <b>REALITY</b>
            <em>BRIDGE</em>
          </span>
        </a>
        <button
          className="mobile-menu"
          type="button"
          aria-label="Toggle navigation"
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen((value) => !value)}
        >
          {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <nav className={mobileNavOpen ? "nav-links nav-open" : "nav-links"}>
          <a href="#main-content">Play</a>
          <a href="#protocol">Protocol</a>
          <a href="#rules">Rules</a>
        </nav>
        <div className="topbar-actions">
          <span className={isSimulation ? "network-pill simulated" : "network-pill"}>
            <span className="network-dot" aria-hidden="true" />
            {isSimulation ? "Simulation — no network" : NETWORK_LABEL}
          </span>
          {isSimulation ? (
            <button className="wallet-button" type="button" onClick={leaveSimulation}>
              <X size={15} aria-hidden="true" /> Exit simulation
            </button>
          ) : account ? (
            <button
              className="wallet-button connected"
              type="button"
              onClick={() => setAccount("")}
              title={account}
            >
              <Wallet size={15} aria-hidden="true" /> {shortAddress(account)}
            </button>
          ) : (
            <button
              className="wallet-button"
              type="button"
              onClick={() => void connectWallet()}
              disabled={walletBusy}
            >
              {walletBusy ? (
                <LoaderCircle className="spin" size={15} aria-hidden="true" />
              ) : (
                <Wallet size={15} aria-hidden="true" />
              )}
              {walletBusy ? "Connecting" : "Connect wallet"}
            </button>
          )}
        </div>
      </header>

      <div id="top" className="page-wrap">
        {isSimulation && (
          <div className="simulation-banner" role="note">
            <FlaskConical size={16} aria-hidden="true" />
            <div>
              <strong>You are in a simulation.</strong>
              <p>
                Scenario “{scenarioName(scenarioId)}”. Panels, players, sources
                and payouts are fixtures. No wallet is used, no transaction is
                sent, no validator is consulted and no value moves. Outcomes are
                fixed by the scenario before you choose, so the simulation can
                never simply agree with you.
              </p>
            </div>
            <button className="ghost-button" type="button" onClick={leaveSimulation}>
              Leave simulation
            </button>
          </div>
        )}

        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="eyebrow-line" /> GenLayer-native game
            </div>
            <h1>
              Cross what
              <br />
              <span>the world can prove.</span>
            </h1>
            <p>
              A hidden-choice elimination game where every safe panel is a
              real-world claim. Commit your answer, reveal it later, and let
              independent validators settle the facts on {NETWORK_LABEL}.
            </p>
            <div className="hero-actions">
              <a className="primary-button" href="#main-content">
                Enter the round <ChevronRight size={17} aria-hidden="true" />
              </a>
              <button
                className="text-button"
                type="button"
                onClick={() => enterSimulation("clean-crossing")}
              >
                Try the practice round <FlaskConical size={15} aria-hidden="true" />
              </button>
              <a className="text-button" href="#protocol">
                How it works <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            </div>
          </div>
          <div className="hero-aside">
            <div className="quote-card">
              <Sparkles size={18} aria-hidden="true" />
              <p>
                “The bridge is not random. It is waiting for reality to catch
                up.”
              </p>
              <span>— Round publisher</span>
            </div>
            {activeBundleData && (
              <div className="hero-stats">
                <div>
                  <strong>{activeBundleData.round.tile_count}</strong>
                  <span>panels</span>
                </div>
                <div>
                  <strong>{activeBundleData.round.player_count}</strong>
                  <span>crossing</span>
                </div>
                <div>
                  <strong>
                    {formatAmount(activeBundleData.round.pool).split(" ")[0]}
                  </strong>
                  <span>pool</span>
                </div>
              </div>
            )}
          </div>
        </section>

        {notice && (
          <div className={`notice notice-${notice.tone}`} role="status">
            {notice.tone === "error" ? (
              <AlertTriangle size={16} aria-hidden="true" />
            ) : (
              <Info size={16} aria-hidden="true" />
            )}
            <span>{notice.message}</span>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => setNotice(null)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        {!isSimulation && !hasProvider && (
          <div className="notice notice-error" role="status">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>
              No injected wallet is available in this browser. You can still read
              StudioNet state, but you cannot sign anything.
            </span>
          </div>
        )}

        {!isSimulation && account && !networkOk && (
          <div className="notice notice-error" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>
              Your wallet is connected to chain {chainId ?? "unknown"}. Reality
              Bridge only runs on {NETWORK_LABEL} (chain {NETWORK_CHAIN_ID}).
              Every write is blocked until you switch.
            </span>
            <button
              className="ghost-button"
              type="button"
              onClick={() => void switchNetwork()}
              disabled={walletBusy}
            >
              Switch to {NETWORK_LABEL}
            </button>
          </div>
        )}

        {/* StudioNet has no faucet page, only a JSON-RPC method. Without this
            a new player has to run a curl command before they can join. */}
        {!isSimulation &&
          account &&
          networkOk &&
          activeBundleData &&
          needsTopUp(balance, BigInt(activeBundleData.round.entry_amount)) && (
            <div className="notice notice-info" role="status">
              <Info size={16} aria-hidden="true" />
              <span>
                This wallet holds{" "}
                <strong>{balance === null ? "—" : formatAmount(balance)}</strong>
                , which will not cover the{" "}
                {formatAmount(activeBundleData.round.entry_amount)} entry plus
                fees. {NETWORK_LABEL} is a simulator, so you can mint test{" "}
                {NATIVE_SYMBOL} instantly — it has no real-world value.
              </span>
              <button
                className="ghost-button"
                type="button"
                onClick={() => void topUp()}
                disabled={faucetBusy}
              >
                {faucetBusy ? (
                  <LoaderCircle className="spin" size={14} aria-hidden="true" />
                ) : null}
                {faucetBusy ? "Requesting…" : `Get test ${NATIVE_SYMBOL}`}
              </button>
            </div>
          )}

        <div id="main-content">
          {!isSimulation && !IS_CONFIGURED ? (
            <ConfigurationGate onSimulate={enterSimulation} />
          ) : !isSimulation && phase === "loading" ? (
            <section className="panel loading-panel" aria-busy="true">
              <LoaderCircle className="spin" size={22} aria-hidden="true" />
              <p>Reading Reality Bridge state from {NETWORK_LABEL}…</p>
            </section>
          ) : !isSimulation && phase === "error" ? (
            <section className="panel error-panel" role="alert">
              <AlertTriangle size={20} aria-hidden="true" />
              <h2>StudioNet is not answering</h2>
              <p>{loadError}</p>
              <p className="muted-copy">
                Live state is unavailable, so no round is shown. The simulation
                below is clearly marked and is never substituted for live data.
              </p>
              <div className="error-actions">
                <button
                  className="action-button"
                  type="button"
                  onClick={() => reload(selectedRoundId)}
                >
                  <RefreshCw size={15} aria-hidden="true" /> Try again
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => enterSimulation(scenarioId)}
                >
                  <FlaskConical size={15} aria-hidden="true" /> Open the
                  simulation instead
                </button>
              </div>
            </section>
          ) : (
            <>
              <div className="section-heading">
                <div>
                  <div className="eyebrow">
                    <span className="eyebrow-line" />{" "}
                    {isSimulation
                      ? "Simulated crossing"
                      : activeBundleData?.round.status === "SETTLED"
                        ? "Settled crossing"
                        : activeBundleData?.round.status === "REFUNDABLE" ||
                            activeBundleData?.round.status === "CANCELLED"
                          ? "Unwound crossing"
                          : "Live crossing"}
                  </div>
                  <h2>
                    {activeBundleData?.round.title ?? "Reality Bridge"}
                  </h2>
                  <p>
                    {isSimulation
                      ? "A scripted walkthrough of every rule, with no chain involved."
                      : `Panels settled by GenLayer validators on ${NETWORK_LABEL}.`}
                  </p>
                </div>
                <div className="heading-actions">
                  <StatusPill tone={isSimulation ? "warn" : "good"}>
                    {isSimulation ? "SIMULATION" : "LIVE STUDIONET"}
                  </StatusPill>
                  {!isSimulation && (
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => reload(selectedRoundId)}
                      disabled={refreshing}
                      aria-label="Refresh round state"
                    >
                      <RefreshCw
                        className={refreshing ? "spin" : ""}
                        size={16}
                        aria-hidden="true"
                      />
                    </button>
                  )}
                </div>
              </div>

              {!isSimulation && (
                <RoundLobby
                  rounds={visibleRounds}
                  filter={filter}
                  onFilter={setFilter}
                  selectedRoundId={selectedRoundId}
                  onSelect={setSelectedRoundId}
                  joinedRoundIds={joinedRoundIds}
                  actionableRoundIds={actionableRoundIds}
                  now={now}
                />
              )}

              {!isSimulation && summaries.length === 0 && phase === "ready" && (
                <EmptyState
                  title="No rounds published yet"
                  body={`The contract at ${shortAddress(CONTRACT_ADDRESS)} has no published rounds. The publisher must create and open one before anybody can join.`}
                  action={
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => enterSimulation(scenarioId)}
                    >
                      <FlaskConical size={15} aria-hidden="true" /> Try the
                      simulation
                    </button>
                  }
                />
              )}

              {activeBundleData && derived && activeConfig ? (
                <>
                  <div className="game-layout">
                    <BridgeBoard
                      round={activeBundleData.round}
                      tiles={activeBundleData.tiles}
                    />
                    <ActionPanel
                      round={activeBundleData.round}
                      tiles={activeBundleData.tiles}
                      config={activeConfig}
                      derived={derived}
                      now={now}
                      busy={isBusy(tx)}
                      simulation={isSimulation}
                      contractAddress={effectiveContract}
                      account={effectiveAccount}
                      selectedChoice={selectedChoice}
                      onSelectChoice={onSelectChoice}
                      pendingBundle={pendingBundle}
                      bundleAcknowledged={bundleAcknowledged}
                      onAcknowledgeBundle={setBundleAcknowledged}
                      storedBundle={storedBundle}
                      onRestoreBundle={onRestoreBundle}
                      showDisclosure={showDisclosure}
                      onRequestJoin={() => setShowDisclosure(true)}
                      onCancelJoin={() => setShowDisclosure(false)}
                      onAction={onAction}
                      onSimulateLapse={onSimulateLapse}
                      onNotice={(message) =>
                        setNotice({ tone: "error", message })
                      }
                    />
                  </div>

                  <div className="lower-grid">
                    <PlayerRail
                      round={activeBundleData.round}
                      players={activeBundleData.players}
                      account={effectiveAccount}
                    />
                    {isSimulation && simulation ? (
                      <section className="panel" aria-labelledby="sim-log">
                        <div className="panel-heading">
                          <div>
                            <span className="panel-kicker">SIMULATION LOG</span>
                            <h3 id="sim-log">What the script decided</h3>
                          </div>
                        </div>
                        <ol className="sim-journal">
                          {simulation.journal.map((entry, index) => (
                            <li key={`${index}-${entry.slice(0, 12)}`}>{entry}</li>
                          ))}
                        </ol>
                      </section>
                    ) : (
                      <TransactionMonitor current={tx} history={history} />
                    )}
                  </div>

                  <EvidenceLedger
                    tiles={activeBundleData.tiles}
                    simulation={isSimulation}
                  />
                </>
              ) : !isSimulation && phase === "ready" && summaries.length > 0 ? (
                <EmptyState
                  title="Select a round"
                  body="Pick a crossing from the lobby to see its panels, players and available actions."
                />
              ) : null}
            </>
          )}
        </div>

        {!isSimulation && (
          <section className="panel simulation-launcher" aria-labelledby="sim-heading">
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">OFFLINE</span>
                <h3 id="sim-heading">Simulation scenarios</h3>
              </div>
            </div>
            <p className="muted-copy">
              Each scenario is a fixed script that never touches a wallet, a
              network or a validator. Entering one is always your explicit
              choice — a StudioNet failure never drops you into it.
            </p>
            <ul className="scenario-list">
              {SCENARIOS.map((scenario) => (
                <li key={scenario.id}>
                  <div>
                    <strong>{scenario.name}</strong>
                    <p>{scenario.summary}</p>
                  </div>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => enterSimulation(scenario.id)}
                  >
                    <FlaskConical size={14} aria-hidden="true" /> Run simulation
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section id="protocol" className="protocol-card panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">TRUST LAYER</span>
              <h3>Reality, with receipts</h3>
            </div>
            <ShieldCheck className="heading-icon" size={20} aria-hidden="true" />
          </div>
          <div className="trust-list">
            <div className="trust-row">
              <span className="trust-icon green" aria-hidden="true">
                <ShieldCheck size={15} />
              </span>
              <div>
                <strong>Evidence is registered and frozen</strong>
                <p>
                  Only allowlisted hosts can back a panel, URLs must be plain
                  HTTPS paths with no query string, and a round&apos;s questions,
                  sources and deadlines cannot change after it opens.
                </p>
              </div>
            </div>
            <div className="trust-row">
              <span className="trust-icon blue" aria-hidden="true">
                <ShieldCheck size={15} />
              </span>
              <div>
                <strong>Validators must agree independently</strong>
                <p>
                  Leader and validators each render the source and must derive
                  the same status, outcome, event id, effective date and
                  evidence receipt. Consensus records agreement about the
                  evidence, not that the evidence is true.
                </p>
              </div>
            </div>
            <div className="trust-row">
              <span className="trust-icon amber" aria-hidden="true">
                <ShieldCheck size={15} />
              </span>
              <div>
                <strong>No keeper can hold the game</strong>
                <p>
                  Starting a round, forfeiting a missed commit or reveal,
                  requesting resolution and expiring a round are all
                  permissionless and available in this interface.
                </p>
              </div>
            </div>
            <div className="trust-row">
              <span className="trust-icon purple" aria-hidden="true">
                <ShieldCheck size={15} />
              </span>
              <div>
                <strong>Payouts are deterministic</strong>
                <p>
                  Survivors split the whole pool by weight{" "}
                  {activeConfig?.base_weight ?? 1} +{" "}
                  {activeConfig?.credit_weight ?? 3} × discovery credits, with
                  the integer remainder going to the highest-credit survivor.
                  There is no protocol fee.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="rules" className="rules-section">
          <div className="rules-intro">
            <div className="eyebrow">
              <span className="eyebrow-line" /> The crossing protocol
            </div>
            <h2>
              Every panel asks
              <br />
              <span>one honest question.</span>
            </h2>
            <p>
              Reality Bridge turns public facts into a strategic race. The
              contract never guesses who won; GenLayer validators verify what the
              registered sources recorded.
            </p>
          </div>
          <div className="rules-steps">
            <div className="rule-step">
              <span>01</span>
              <div>
                <h3>Commit in the dark</h3>
                <p>
                  A salted SHA-256 commitment hides your YES or NO while the
                  bridge is still crowded. Save the recovery bundle: it is the
                  only way to open it later.
                </p>
              </div>
            </div>
            <div className="rule-step">
              <span>02</span>
              <div>
                <h3>Reveal before the cut-off</h3>
                <p>
                  Open the same choice inside your reveal window. Miss it and
                  anyone may forfeit your crossing to keep the round moving.
                </p>
              </div>
            </div>
            <div className="rule-step">
              <span>03</span>
              <div>
                <h3>Let the evidence speak</h3>
                <p>
                  After the evidence timestamp, anyone can ask validators to
                  render the registered sources. Unresolved is retryable and
                  costs no deadline.
                </p>
              </div>
            </div>
            <div className="rule-step">
              <span>04</span>
              <div>
                <h3>Survive and collect</h3>
                <p>
                  A correct runner earns a discovery credit. Survivors split the
                  pool by weight; every terminal failure is individually
                  refundable.
                </p>
              </div>
            </div>
          </div>
        </section>

        <footer className="footer">
          <div className="footer-brand">
            <span className="brand-mark small" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>
              <b>REALITY</b>
              <em>BRIDGE</em>
            </span>
          </div>
          <span>
            {NETWORK_LABEL} only · chain {NETWORK_CHAIN_ID} · test assets with no
            real-world value
          </span>
          <div className="footer-links">
            <a href="#protocol">Protocol</a>
            <a href="#rules">Rules</a>
            {IS_CONFIGURED &&
              (contractLink ? (
                <a href={contractLink} target="_blank" rel="noreferrer noopener">
                  Contract {shortAddress(CONTRACT_ADDRESS)}
                </a>
              ) : (
                <span>Contract {shortAddress(CONTRACT_ADDRESS)}</span>
              ))}
          </div>
        </footer>
      </div>
    </main>
  );
}

function ConfigurationGate({
  onSimulate,
}: {
  onSimulate: (id: ScenarioId) => void;
}) {
  return (
    <section className="panel error-panel" role="alert">
      <AlertTriangle size={20} aria-hidden="true" />
      <h2>No StudioNet contract is configured</h2>
      <p>
        Set <code>NEXT_PUBLIC_REALITY_BRIDGE_CONTRACT</code> to a Reality Bridge
        address deployed on {NETWORK_LABEL}, then reload. Until then there is no
        live state to show, and this build will not pretend otherwise.
      </p>
      <div className="error-actions">
        <button
          className="ghost-button"
          type="button"
          onClick={() => onSimulate("clean-crossing")}
        >
          <FlaskConical size={15} aria-hidden="true" /> Open the offline
          simulation
        </button>
      </div>
    </section>
  );
}
