// Recupere les MOTIFS EXACTS de refus, en rejouant les appels sur un bloc PASSE.
//
// Pourquoi : a l'etape 6 de la preuve, la blockchain a refuse — mais un refus simule
// ne laisse aucune trace. On peut quand meme le prouver : on rejoue exactement le meme
// appel contre l'etat de la blockchain tel qu'il etait au bloc de l'epoque. Le motif
// renvoye (OverPerTx, RecipientNotAllowed...) est verifiable par n'importe qui avec
// la meme requete.

import fs from "node:fs";
import { createPublicClient, http, defineChain, parseUnits, encodeFunctionData } from "viem";

const COFFRE = "0xf4e6ea95ec718ef1df81a91ea42f4aec4910eb21";
const PROPRIETAIRE = "0xF9A2aC9DDbeC773413AE72975B8B169abF784c25";
const AGENT_DEMO = "0x7968084E82fcCf88D8F5964900f4E001Cf048658";
const ARTEFACT = "/opt/data/projets/arc-garde-fou/out/AgentGuard.sol/AgentGuard.json";
const PREUVE = "/opt/data/projets/agent-crypto/preuve-agentguard-mainnet.json";

const arc = defineChain({
  id: 5042, name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
});
const pub = createPublicClient({ chain: arc, transport: http(arc.rpcUrls.default.http[0]) });
const abi = JSON.parse(fs.readFileSync(ARTEFACT, "utf8")).abi;

// On rejoue au bloc du depot (etat : agent designe, non revoque, plafonds 0,5 / 1).
const preuve = JSON.parse(fs.readFileSync(PREUVE, "utf8"));
const blocDepot = preuve.transactions.find((t) => t.etape.startsWith("depot"))?.bloc;
if (!blocDepot) throw new Error("bloc du depot introuvable dans la preuve");

const essais = [
  { titre: "l'agent depasse le plafond par transaction (0,75 USDC > 0,5)", appelant: AGENT_DEMO, montant: "0.75", destinataire: PROPRIETAIRE },
  { titre: "un agent NON designe essaie de payer", appelant: "0x000000000000000000000000000000000000dEaD", montant: "0.1", destinataire: PROPRIETAIRE },
  { titre: "l'agent paie un destinataire NON autorise", appelant: AGENT_DEMO, montant: "0.1", destinataire: "0x000000000000000000000000000000000000dEaD" },
];

const resultats = [];
console.log("=== motifs de refus, rejoues au bloc", blocDepot, "===");
for (const essai of essais) {
  let motif = "PASSE (probleme !)";
  try {
    await pub.simulateContract({
      address: COFFRE, abi, functionName: "spend",
      args: [essai.destinataire, parseUnits(essai.montant, 6)],
      account: essai.appelant, blockNumber: BigInt(blocDepot),
    });
  } catch (e) {
    const brut = e?.cause?.data ?? e?.data ?? e?.cause?.cause?.data ?? null;
    const nom = e?.cause?.data?.errorName || e?.cause?.cause?.data?.errorName || null;
    motif = nom ? `${nom}` : String(e?.shortMessage || e?.message).slice(0, 90);
    if (brut) motif += " | " + JSON.stringify(brut, (k, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 140);
  }
  console.log(`  ${essai.titre}\n    -> ${motif}`);
  resultats.push({ essai: essai.titre, appelant: essai.appelant, montant_usdc: essai.montant, motif });
}

preuve.motifs_de_refus_rejoues_au_bloc = blocDepot;
preuve.motifs_de_refus = resultats;
fs.writeFileSync(PREUVE, JSON.stringify(preuve, null, 2));
console.log("\najoute a la preuve :", PREUVE);