# Perspectives Topo

> Fork de [justinh-rahb/TinyTopo](https://github.com/justinh-rahb/TinyTopo) (AGPL-3.0-or-later)
> pour l’association [PERSPECTIVES](https://perspectives-asso.fr), publié sur
> [topo.perspectives-asso.fr](https://topo.perspectives-asso.fr/) et lié depuis Perspectives Hub.

**Sélectionnez une zone sur la carte et générez une maquette 3D imprimable** — relief,
bâtiments, routes, eau et végétation — export STL ou 3MF multicolore. Tout tourne dans
le navigateur, sans compte.

L’interface de ce fork est en français ; le moteur reste celui de TinyTopo. Les
déploiements modifiés utilisent un autre nom (« Perspectives Topo »), comme le demande
la marque TinyTopo.

**[Ouvrir Perspectives Topo →](https://topo.perspectives-asso.fr/)** ·
[Dépôt source](https://github.com/GeoByteBrew/perspectives-topo) ·
[TinyTopo amont](https://github.com/justinh-rahb/TinyTopo)

## Licence

- **Code :** [AGPL-3.0-or-later](LICENSE) — toute version dérivée, y compris un service
  en ligne, doit publier son code sous les mêmes termes.
- Documentation amont (README / RESEARCH.md d’origine) : CC-BY-SA-4.0.

## Développement

```sh
npm install
npm run dev
npm run build
```

## Déploiement

Site statique. Le workflow GitHub Actions publie `dist/` sur GitHub Pages.
CNAME : `topo.perspectives-asso.fr` → `geobytebrew.github.io`.
