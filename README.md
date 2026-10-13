# auto-model

Mod Claude Code qui choisit le modèle **Claude 5.5** adapté à chaque requête :

| Requête | Modèle |
|---|---|
| Tâche simple et rapide | Haiku 5.5 |
| Rédaction, contenu business | Sonnet 5.5 |
| Code, n8n, raisonnement complexe | Opus 5.5 |

Un petit appel à Haiku classe chaque prompt (repli sur des mots-clés s'il ne répond pas). Une ligne au-dessus du prompt affiche le modèle actif, la répartition des tours et une économie estimée par rapport à « tout sur Opus ».

## Installation

Dans un terminal Claude Code :

```
/plugin install auto-model --marketplace TomTandem/claude-auto-model
```

Répondre `y` pour ajouter le marketplace, puis choisir la portée « user ». Le mod se charge dans toutes les sessions suivantes.

## Utilisation

- `/auto-model on|off` active ou coupe le routage.
- Les prompts de moins de 15 caractères (« oui », « ok ») gardent le modèle en cours.
- Les commandes slash sont ignorées.

## Réglages

- Règles de routage : constante `RULES` dans `hooks/register.tsx`.
- Tarifs utilisés pour l'économie estimée : constante `PRICES` (hypothèses, à ajuster).

Changer de modèle en cours de conversation invalide le cache de prompt : sur de longues sessions, trop d'allers-retours peuvent coûter plus qu'ils n'économisent.
