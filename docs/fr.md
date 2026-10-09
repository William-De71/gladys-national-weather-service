# National Weather Service

Cette intégration fournit à Gladys les **prévisions météo** et les **alertes officielles** du National Weather Service (NWS), le service météorologique des États-Unis. Elle alimente le widget météo du tableau de bord, l'assistant, les scènes déclenchées par une alerte, et ajoute trois widgets.

> Intégration communautaire, sans lien avec le National Weather Service ni la NOAA.

## Prêt à l'emploi

**Aucune configuration n'est nécessaire** : l'API du NWS est gratuite et sans clé. Installez l'intégration, elle fonctionne immédiatement.

Le NWS ne couvre que les **États-Unis et leurs territoires** (Alaska, Hawaï, Porto Rico, Guam…). Pour une maison située ailleurs, Gladys utilise automatiquement un autre fournisseur météo.

Renseignez la **position de chaque maison** dans ses réglages : la surveillance des alertes, les actions de scène et les widgets en ont besoin.

## Ce que l'intégration fournit

- **Conditions actuelles** mesurées par la station météo la plus proche (température, ressenti, humidité, point de rosée, pression, vent, rafales, visibilité). Si aucune station n'a transmis récemment, la prévision de l'heure en cours prend le relais.
- **Prévisions heure par heure** sur 24 heures : température, ressenti, humidité, nébulosité, vent et rafales, cumul et probabilité de pluie.
- **Prévisions journalières** sur 6 à 7 jours : maximum de la journée, minimum de la nuit suivante, ciel, risque de pluie, cumul, vent et rafales.
- **Lever et coucher du soleil**, calculés localement.
- **Alertes officielles** (veilles, alertes, avis) avec leur texte complet et les consignes.

Le NWS ne publie pas d'indice UV.

Le NWS rédige ses textes **en anglais uniquement** : noms des alertes, textes des prévisionnistes et bulletins restent en anglais ; tout le reste suit la langue de Gladys.

## Les niveaux d'alerte américains

| Niveau        | Signification                                                    |
| ------------- | ---------------------------------------------------------------- |
| **Warning**   | le phénomène est en cours ou imminent : agir maintenant          |
| **Watch**     | les conditions sont réunies pour qu'il se produise : se préparer |
| **Advisory**  | phénomène moins grave, mais gênant                               |
| **Statement** | bulletin d'information ou de suivi                               |

## Scènes déclenchées par une alerte

Gladys propose déjà les déclencheurs génériques **« Alerte météo émise »** et **« Alerte météo terminée »**. Gladys vérifie les alertes toutes les 30 minutes ; cette intégration les surveille en plus **chaque minute** et prévient Gladys dès qu'une alerte change : votre scène se déclenche en quelques secondes.

L'intégration ajoute ses propres déclencheurs, plus précis, dans la rubrique **National Weather Service** de l'éditeur de scène :

| Déclencheur              | Se déclenche quand…                                            | Filtres                                 |
| ------------------------ | -------------------------------------------------------------- | --------------------------------------- |
| **Alerte NWS émise**     | une nouvelle veille, alerte ou un nouvel avis couvre la maison | maison, type d'alerte, niveau, sévérité |
| **Fin d'une alerte NWS** | une alerte a expiré ou a été annulée                           | maison, type d'alerte, niveau           |

Types d'alerte : tornade, ouragan / tempête tropicale, orage violent, inondation, tempête hivernale, froid, chaleur, vent, risque d'incendie, brouillard, qualité de l'air, mer / littoral, autre.

Par exemple, pour être prévenu d'une tornade : déclencheur **Alerte NWS émise**, type **Tornade**, niveau **Warning**, puis une action d'envoi de message contenant la variable **Résumé** et la variable **Consignes**.

Bon à savoir :

- Le champ **Maison** doit contenir le nom de la maison **exactement** comme dans Gladys. Vide = toutes les maisons.
- Le NWS ne modifie jamais une alerte : il en publie une nouvelle qui remplace l'ancienne. L'intégration suit ces mises à jour : une alerte prolongée ou complétée ne redéclenche pas votre scène.
- Les alertes déjà en cours au démarrage de l'intégration ne déclenchent rien : seules les nouvelles comptent.
- Une alerte est considérée terminée quand elle a disparu deux vérifications de suite, ou dès que son heure de fin est passée.

## Scènes : actions NWS

| Action                                   | Ce qu'elle renvoie                                                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Obtenir les alertes NWS**              | nombre d'alertes, de warnings, de watches et d'advisories, liste des événements, la plus grave (type, niveau, consignes, fin), un résumé |
| **Obtenir la prévision NWS d'un jour**   | d'aujourd'hui à dans 6 jours : maximum, minimum, ciel, risque de pluie, vent, texte du prévisionniste (jour et nuit), un résumé          |
| **Obtenir les conditions actuelles NWS** | température, ressenti, humidité, point de rosée, pression, vent, rafales, visibilité, ciel, station, un résumé                           |

Chaque action propose une sortie **Résumé**, une phrase prête à envoyer dans un message.

## Widgets du tableau de bord

| Widget                      | Contenu                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Alertes NWS**             | compteurs warnings / watches / avis, puis chaque alerte ; un appui affiche son texte complet et les consignes. Mis à jour dès qu'une alerte change. |
| **Prévision NWS détaillée** | le texte du prévisionniste période par période (cette nuit, samedi, nuit de samedi…), avec les icônes du NWS                                        |
| **NWS heure par heure**     | 12, 24 ou 48 heures en courbe : température et ressenti, risque de pluie, ou vent et rafales                                                        |

Chaque widget a un réglage **Maison** (vide = première maison localisée).

## Configuration (facultative)

| Réglage                                        | Par défaut | Rôle                                                                                                                                 |
| ---------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Email de contact**                           | —          | le NWS demande à chaque application de s'identifier ; votre email lui permet de vous prévenir avant de bloquer un trafic jugé abusif |
| **Durée du cache (s)**                         | 600        | durée de réutilisation d'une prévision (le NWS les met à jour environ une fois par heure)                                            |
| **Intervalle de vérification des alertes (s)** | 60         | fréquence de vérification des alertes de vos maisons, de 30 à 900 secondes                                                           |
