# AgentGuard — un coffre-fou pour les agents IA qui dépensent de l'argent

> Un agent autonome a besoin d'un portefeuille. Un portefeuille sans limites est un risque.
> AgentGuard place les limites **dans la blockchain**, pas dans le code de l'agent.

Déployé et vérifié sur **Arc mainnet** le 27 septembre 2026 :
[`0xf4e6ea95ec718ef1df81a91ea42f4aec4910eb21`](https://explorer.arc.io/address/0xf4e6ea95ec718ef1df81a91ea42f4aec4910eb21)

Dossier complet, avec toutes les transactions vérifiables : **https://agentguard-arc.surge.sh**

---

## Le problème

Pour qu'un agent IA puisse payer, on lui donne aujourd'hui une clé privée. Cette clé ouvre
tout, à vie, sans plafond. Les équipes sérieuses contournent le problème en écrivant les
limites *dans l'agent* — donc dans le logiciel qui peut être attaqué, détourné ou modifié.

AgentGuard déplace ces limites dans un contrat : **l'agent ne peut pas modifier ses propres
règles**, parce qu'il n'en est pas le propriétaire.

## Les règles, portées par le contrat

- plafond **par transaction** et plafond **par jour** ;
- **liste blanche** de destinataires — par défaut, tout destinataire est refusé ;
- **date d'expiration** : l'autorisation meurt toute seule ;
- **révocation** en une transaction par le propriétaire ;
- l'agent ne peut pas toucher aux règles, ni retirer les fonds.

## La preuve : neuf transactions réelles, pas une démonstration

Sur Arc mainnet, le 27/09/2026. Tout est vérifiable sur l'explorateur public d'Arc.

| Étape | Résultat | Transaction |
|---|---|---|
| Le propriétaire désigne un agent | succès | [`0xac653077…c1e12a`](https://explorer.arc.io/tx/0xac6530774a48964d3d60cd25510d4ca0c45141b6563ad0d57e5c7e3427c1e12a) |
| Un seul destinataire autorisé | succès | [`0x65cc03f8…3289f0`](https://explorer.arc.io/tx/0x65cc03f84e5d1748d2b756effe77c2792eb26be9c4e7f9605264c6cf963289f0) |
| 0,05 USDC de gaz donnés à l'agent | succès | [`0x880475b6…67c4c5`](https://explorer.arc.io/tx/0x880475b6808a62fb148dd03deff34913d19fdc7938017e4f19de6384ae67c4c5) |
| Approbation de 0,5 USDC | succès | [`0xf3b7df40…ac2d38d`](https://explorer.arc.io/tx/0xf3b7df40aa624579a0262168ece80adceebc155affb884a355f6e5677ac2d38d) |
| Dépôt de 0,5 USDC dans le coffre | succès | [`0xce8255d5…98ef3d2f`](https://explorer.arc.io/tx/0xce8255d5a134e61b028a530550e3b9158d277f76d4e1b51c3721599b98ef3d2f) |
| **L'agent paie 0,1 USDC (dans les règles)** | **succès** | [`0x67b03db5…4795ce`](https://explorer.arc.io/tx/0x67b03db5c22cabc3b15f36b897025eeed9a2502e825c2f975a4c923f475795ce) |
| **L'agent essaie 0,75 USDC (au-dessus du plafond)** | **refusé `OverPerTx`** | rejoué au bloc 23041065 |
| Le propriétaire révoque l'agent | succès | [`0x526201e3…54c4b1a6`](https://explorer.arc.io/tx/0x526201e313fd5569cad209faa0813dcf0416b3d25c9932a8222832e254c4b1a6) |
| L'agent révoqué essaie encore | refusé `NotAgent` | rejoué au bloc 23041065 |
| Un destinataire hors liste essaie d'être payé | refusé `RecipientNotAllowed` | rejoué au bloc 23041065 |
| Le propriétaire récupère tout | succès | [`0x248b2eca…b2957bec`](https://explorer.arc.io/tx/0x248b2eca9de4eae24634c83ce3e34d19ae6071f5d8d106b14e99a215b2957bec) |
| Le gaz non dépensé revient au propriétaire | succès | [`0x10af1e69…292bffa0`](https://explorer.arc.io/tx/0x10af1e699c99c6b8ffb7138aa92eea582567bfca9b6036583dca9b54292bffa0) |

**Pourquoi les refus sont « rejoués » et non signés** : un refus est gratuit en simulation, alors
qu'un refus signé coûte des frais. On rejoue donc le même appel contre l'état de la chaîne **tel
qu'il était au bloc 23041065** — le motif renvoyé est vérifiable, et la tentative est datée.

**Bilan comptable, sans arrondi :** 2,470635 USDC avant → **2,452618 USDC après**.
Coût total de la preuve : **0,018017 USDC** (1,8 centime). Zéro perdu, zéro laissé dans le contrat.

## Contenu du dépôt

```
src/AgentGuard.sol              le contrat (124 lignes, commenté en français)
test/AgentGuard.t.sol           11 tests automatisés, tous verts
preuve/preuve-mainnet.mjs       le script qui a produit les transactions ci-dessus
preuve/motifs-refus.mjs         le script qui rejoue les refus sur un bloc passé
preuve/preuve-agentguard-mainnet.json   la preuve brute, lisible par machine
outils/demande_autorisation.py  le passage obligé avant toute signature
```

## Lancer les tests

```bash
forge install foundry-rs/forge-std   # dépendance de test
forge test -vv
```

## Ce que ce projet n'est pas

- **Ce n'est pas un contrat audité** par un cabinet externe. Il est petit (124 lignes), testé,
  déployé progressivement, et le montant total qui l'a traversé à ce jour se compte en centimes :
  c'est un prototype assumé, pas un produit pour de l'argent sérieux.
- Ce n'est pas multi-utilisateurs : un propriétaire, un agent, à la fois.
- Ce n'est pas une innovation cryptographique. La valeur est dans l'assemblage et dans la
  discipline de test, pas dans une invention mathématique.

## Le défaut trouvé et corrigé en route

Le premier jet gonflait son compteur de dépenses : chaque *vérification* était comptée comme un
*paiement réel*, ce qui gelait le plafond journalier sans qu'un centime soit parti. Corrigé,
couvert par des tests dédiés (dont un scénario de plafond journalier à 2,5 USDC réels), puis
redéployé. C'est précisément le genre d'erreur qu'un testnet attrape et qu'un mainnet facture.

## English summary

AI agents that spend money need a wallet whose limits are enforced by the chain, not by the
agent's own code. AgentGuard is a minimal spending vault on Arc: per-transaction and daily caps,
recipient allowlist, expiry, revocation, and no way for the agent to change its own rules.
Live on Arc mainnet at `0xf4e6ea95ec718ef1df81a91ea42f4aec4910eb21`, with nine verifiable
transactions above — one allowed payment and three distinct refusals (`OverPerTx`, `NotAgent`,
`RecipientNotAllowed`) reproduced at a past block. Total cost of the proof: 0.018 USDC.
Prototype, not an audited product.

## Licence

MIT — voir [LICENSE](LICENSE).