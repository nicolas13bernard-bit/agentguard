// PREUVE REELLE sur Arc MAINNET : un agent borne ne peut pas faire n'importe quoi.
//
// But : produire des transactions verifiables publiquement (donc un dossier de
// candidature qu'on ne peut pas balayer) sans risquer plus de quelques centimes.
//
// Scenario joue :
//   1. le proprietaire designe un agent de demonstration
//   2. il autorise UN seul destinataire (lui-meme)
//   3. il finance 0,05 USDC de gaz a l'agent (rien de plus)
//   4. il depose 0,5 USDC dans le coffre
//   5. l'agent paie 0,1 USDC            -> PASSE (transaction reelle)
//   6. l'agent essaie 0,75 USDC         -> REFUSE (plafond par transaction)
//   7. le proprietaire revoque l'agent
//   8. l'agent revoque essaie 0,1 USDC  -> REFUSE (il n'existe plus)
//   9. le proprietaire recupere tout et rend le gaz restant -> 0,5 USDC revient
//
// Cout reel attendu : les frais de reseau seuls (quelques centimes).
// Toute signature passe par le garde-fou crypto (demande_autorisation.py).

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import {
  createWalletClient, createPublicClient, http, defineChain,
  parseUnits, formatUnits, parseEther, encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

process.on("unhandledRejection", (e) => {
  console.log("ERREUR :", String(e?.shortMessage || e?.message || e).slice(0, 400));
  process.exit(1);
});

const COFFRE = "0xf4e6ea95ec718ef1df81a91ea42f4aec4910eb21";
const USDC = "0x3600000000000000000000000000000000000000";
const CLE_WALLET = "/opt/data/.secrets/hermes_wallet.json"; // 0xF9A2…4c25, proprietaire du coffre
// NE PAS confondre : arc_wallet.json = 0xB4CB…5378, le wallet de TESTNET (chain 5042002).
const CLE_DEMO = "/opt/data/projets/pont-arc/agent-demo.key";
const ARTEFACT = "/opt/data/projets/arc-garde-fou/out/AgentGuard.sol/AgentGuard.json";
const PONT_GARDE = "/opt/data/projets/agent-crypto/demande_autorisation.py";
const PYTHON = "/opt/data/.venv/bin/python";
const SORTIE = "/opt/data/projets/agent-crypto/preuve-agentguard-mainnet.json";
const JOURNAL = [];

const arc = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
});

const lireCle = (chemin) => {
  const brut = fs.readFileSync(chemin, "utf8").trim();
  let cle;
  try {
    const j = JSON.parse(brut);
    cle = j.private_key || j.cle_privee || j.privateKey;
  } catch {
    cle = brut;
  }
  if (!cle) throw new Error("aucune cle lisible dans " + chemin);
  return cle.startsWith("0x") ? cle : "0x" + cle;
};

const abi = JSON.parse(fs.readFileSync(ARTEFACT, "utf8")).abi;
const proprietaire = privateKeyToAccount(lireCle(CLE_WALLET));
const agentDemo = privateKeyToAccount(lireCle(CLE_DEMO));
const transport = http(arc.rpcUrls.default.http[0]);
const pub = createPublicClient({ chain: arc, transport });
const wProp = createWalletClient({ chain: arc, transport, account: proprietaire });
const wAgent = createWalletClient({ chain: arc, transport, account: agentDemo });
const C = { address: COFFRE, abi };

// --- le passage oblige : demander l'autorisation AVANT de signer --------------
const intention = (surcharge) => ({
  wallet: "hermes_wallet", reseau: "mainnet", chain_id: 5042, token: "USDC", ...surcharge,
});

const garde = (int) => {
  try {
    const sortie = execFileSync(PYTHON, [PONT_GARDE, "verifie"], {
      input: JSON.stringify(int), encoding: "utf8",
    });
    const decision = JSON.parse(sortie.trim().split("\n").pop());
    if (decision.decision !== "autorise") throw new Error("refuse:" + decision.raison);
    return decision;
  } catch (e) {
    const brut = String(e.stdout || e.message || e);
    let raison = brut.trim();
    try { raison = JSON.parse(brut.trim().split("\n").pop()).raison; } catch { /* garde le texte brut */ }
    throw new Error(`GARDE-FOU A REFUSE (${raison})`);
  }
};

const envoie = async (client, int, req, titre) => {
  garde(int);
  const hash = await client.writeContract({ account: client.account, chain: arc, ...C, ...req });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  execFileSync(PYTHON, [PONT_GARDE, "resultat", r.status, hash], {
    input: JSON.stringify(int), encoding: "utf8",
  });
  JOURNAL.push({ etape: titre, hash, statut: r.status, bloc: Number(r.blockNumber) });
  console.log(`  ${titre} -> ${r.status}  ${hash}`);
  return r;
};

const soldeUSDC = (a) => pub.readContract({ address: USDC, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [a] });

// Envoi d'USDC « natif » (le gaz sur Arc est de l'USDC) : ce n'est pas un appel
// de contrat mais une transaction simple, d'ou une fonction a part.
const envoieNative = async (client, int, { to, value }, titre) => {
  garde(int);
  const hash = await client.sendTransaction({ account: client.account, chain: arc, to, value });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  execFileSync(PYTHON, [PONT_GARDE, "resultat", r.status, hash], {
    input: JSON.stringify(int), encoding: "utf8",
  });
  JOURNAL.push({ etape: titre, hash, statut: r.status, bloc: Number(r.blockNumber) });
  console.log(`  ${titre} -> ${r.status}  ${hash}`);
  return r;
};

// --- le scenario --------------------------------------------------------------
console.log("=== AgentGuard : preuve REELLE sur Arc mainnet ===");
console.log("coffre        :", COFFRE);
console.log("proprietaire  :", proprietaire.address);
console.log("agent (demo)  :", agentDemo.address);
console.log();
console.log("regles en place dans le contrat :");
console.log("  plafond / transaction :", formatUnits(await pub.readContract({ ...C, functionName: "maxPerTx" }), 6), "USDC");
console.log("  plafond / jour        :", formatUnits(await pub.readContract({ ...C, functionName: "maxPerDay" }), 6), "USDC");
console.log("  liste blanche         :", (await pub.readContract({ ...C, functionName: "allowlistOnly" })) ? "obligatoire" : "non");
console.log("  expire le             :", new Date(Number(await pub.readContract({ ...C, functionName: "expiresAt" })) * 1000).toISOString());
console.log("solde du proprietaire :", formatUnits(await soldeUSDC(proprietaire.address), 6), "USDC");
console.log();

console.log("1. le proprietaire designe l'agent de demonstration");
await envoie(wProp, intention({ type: "contrat", to: COFFRE, montant_usd: 0, note: "designation d'un agent borne" }), { functionName: "setAgent", args: [agentDemo.address] }, "setAgent");

console.log("2. il autorise UN seul destinataire (lui-meme)");
await envoie(wProp, intention({ type: "contrat", to: COFFRE, montant_usd: 0 }), { functionName: "setAllowed", args: [proprietaire.address, true] }, "setAllowed(moi)");

console.log("3. il donne 0,05 USDC de gaz a l'agent — pas un centime de plus");
await envoieNative(wProp, intention({ type: "transfert", to: agentDemo.address, montant_usd: 0.05 }),
  { to: agentDemo.address, value: parseEther("0.05") }, "gaz de l'agent finance");

console.log("4. il depose 0,5 USDC dans le coffre");
const appelApprove = encodeFunctionData({ abi: [{ type: "function", name: "approve", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }], functionName: "approve", args: [COFFRE, parseUnits("0.5", 6)] });
await envoie(wProp, intention({ type: "approve", to: USDC, montant_usd: 0, calldata: appelApprove }),
  { address: USDC, abi: [{ type: "function", name: "approve", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }], functionName: "approve", args: [COFFRE, parseUnits("0.5", 6)] },
  "approbation 0,5 USDC");
await envoie(wProp, intention({ type: "contrat", to: COFFRE, montant_usd: 0.5, calldata: encodeFunctionData({ abi, functionName: "deposit", args: [parseUnits("0.5", 6)] }) }),
  { functionName: "deposit", args: [parseUnits("0.5", 6)] }, "depot 0,5 USDC");
console.log("   argent dans le coffre :", formatUnits(await soldeUSDC(COFFRE), 6), "USDC");
console.log();

console.log("5. l'agent paie 0,1 USDC (DANS les regles)");
const appelSpend = (montant) => encodeFunctionData({ abi, functionName: "spend", args: [proprietaire.address, parseUnits(montant, 6)] });
await envoie(wAgent, intention({ type: "contrat", to: proprietaire.address, montant_usd: 0.1, calldata: appelSpend("0.1"), note: "signe par l'agent de demonstration via le coffre" }),
  { functionName: "spend", args: [proprietaire.address, parseUnits("0.1", 6)] }, "paiement de 0,1 USDC");
console.log();

console.log("6. l'agent essaie 0,75 USDC (HORS des regles)");
try {
  await pub.simulateContract({ ...C, functionName: "spend", args: [proprietaire.address, parseUnits("0.75", 6)], account: agentDemo });
  console.log("   PROBLEME : la blockchain a laisse passer !");
} catch (e) {
  const msg = String(e.shortMessage || e.message).slice(0, 140);
  console.log("   REFUSE par la blockchain :", msg);
  JOURNAL.push({ etape: "tentative 0,75 USDC (simulation, non signee)", refus: msg });
}
console.log();

console.log("7. le proprietaire revoque l'agent");
await envoie(wProp, intention({ type: "contrat", to: COFFRE, montant_usd: 0 }), { functionName: "revoke", args: [] }, "revoke");

console.log("8. l'agent revoque essaie encore");
try {
  await pub.simulateContract({ ...C, functionName: "spend", args: [proprietaire.address, parseUnits("0.1", 6)], account: agentDemo });
  console.log("   PROBLEME : un agent revoque peut encore payer !");
} catch (e) {
  const msg = String(e.shortMessage || e.message).slice(0, 140);
  console.log("   REFUSE apres revocation :", msg);
  JOURNAL.push({ etape: "tentative apres revocation (simulation)", refus: msg });
}
console.log();

console.log("9. le proprietaire recupere tout");
const dedans = await soldeUSDC(COFFRE);
await envoie(wProp, intention({ type: "contrat", to: proprietaire.address, montant_usd: Number(formatUnits(dedans, 6)) }),
  { functionName: "withdraw", args: [proprietaire.address, dedans] }, `retrait de ${formatUnits(dedans, 6)} USDC`);
const gazReste = await pub.getBalance({ address: agentDemo.address });
const aRendre = gazReste > parseEther("0.01") ? gazReste - parseEther("0.01") : 0n;
if (aRendre > 0n) {
  await envoieNative(wAgent, intention({ type: "transfert", to: proprietaire.address, montant_usd: Number(formatUnits(aRendre, 18)) }),
    { to: proprietaire.address, value: aRendre },
    `retour du gaz restant (${formatUnits(aRendre, 18)} USDC)`);
}

const finProp = await soldeUSDC(proprietaire.address);
console.log();
console.log("=== RESULTAT ===");
console.log("solde du proprietaire :", formatUnits(finProp, 6), "USDC");
console.log("dans le coffre        :", formatUnits(await soldeUSDC(COFFRE), 6), "USDC");

const bilan = {
  date: new Date().toISOString(),
  reseau: "Arc mainnet (chain id 5042)",
  coffre: COFFRE,
  proprietaire: proprietaire.address,
  agent_de_demo: agentDemo.address,
  solde_proprietaire_debut_usdc: "2.470635",
  solde_proprietaire_fin_usdc: formatUnits(finProp, 6),
  argent_restant_dans_le_coffre_usdc: formatUnits(await soldeUSDC(COFFRE), 6),
  transactions: JOURNAL,
};
fs.writeFileSync(SORTIE, JSON.stringify(bilan, null, 2));
console.log("preuve ecrite dans", SORTIE);