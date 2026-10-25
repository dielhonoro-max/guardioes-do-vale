# Guardiões do Vale — Tower Defense

Tower defense inspirado no Bloons TD 6: criaturas (goblins, aranhas, orcs, dragões…) descem o caminho
com barra de vida, e os guardiões evoluem em árvores de habilidades.

## Rodar
Servidor local `guardioes-td` em `.claude/launch.json` → http://localhost:8780
(`tools/serve.py`: igual ao `http.server`, mas sem cache — toda recarga pega a versão nova dos arquivos).

## Interface
- Barra lateral: vidas/dinheiro/onda, loja e controles.
- **Evoluções**: janela flutuante que abre ao clicar num guardião no mapa. Arrasta pelo título,
  redimensiona por qualquer borda ou canto; posição e tamanho ficam salvos no navegador (`localStorage` `gdv.popup`).
  Fecha com ✕, `Esc` ou clicando fora no mapa. Para voltar ao padrão: `popup.reset()` no console.

## Arquivos
| Arquivo | O que tem |
|---|---|
| `js/data.js` | **Todo o balanceamento**: CONFIG, mapa, inimigos, guardiões/evoluções, ondas |
| `js/game.js` | Motor: loop, combate, desenho, interface, atalhos |
| `js/sprites-data.js` | Gerado pelo script de recorte (não editar à mão) |
| `style.css` / `index.html` | Layout da barra lateral |

## Guardiões
Loja ordenada por preço (atalhos `1`, `2`… seguem a mesma ordem).

- **Cavaleiro ($150)** — corpo a corpo: 2 de dano, alcance 60, acerta o alvo + 1 monstro colado (nunca erra). Dano +2/+4 · Alcance +15/+25 · Rapidez +20%/+40%
- **Arqueiro ($200)** — 1 de dano, alcance 125 (valores totais por nível):
  Dano: Flechas Afiadas +2 / Tiro Perfurante +4 · Alcance: Arco Longo +30 / Olhos de Águia +50 ·
  Rapidez: Tiro Rápido +20% / Mãos Velozes +40%.
  Cada evolução tem arte própria (`sprite` em data.js → `assets/archer_d1.png` etc.); mostra a de nível mais alto, empate = a última comprada.
- **Mago ($350)** — "Em breve" (`soon: true`, cinza na loja); ainda com as árvores antigas (Gelo/Fogo/Arcano)

Ninja, Canhoneiro e Bardo foram **retirados do jogo**; os dados estão em `js/_arquivo-classes.js` (não carregado).

## Inimigos
Cada golpe tira o `damage` do guardião (1 sem upgrade). Vida vem da planilha "Protect The Realm Project".
Ao morrer dá $ = metade da vida (CONFIG.killReward); se passar, tira vidas = vida. Bônus por onda: $60 + $2 × onda.

**Voadores (✈)** só são atingidos por guardiões de ataque à distância (`antiAir`; hoje só o Arqueiro).
O Cavaleiro (corpo a corpo, `antiAir: false`) ignora voadores. Na tela eles flutuam acima do caminho, com sombra no chão.

| Monstro | Vida | Velocidade | | Monstro | Vida | Velocidade |
|---|---|---|---|---|---|---|
| Slime | 1 | 1.0 | | Harpia ✈ | 10 | 1.4 |
| Aranha | 2 | 1.3 | | Troll | 11 | 0.7 |
| Zumbi | 3 | 0.7 | | Minotauro | 12 | 1.0 |
| Esqueleto | 4 | 1.0 | | Gárgula ✈ | 13 | 0.9 |
| Morcego ✈ | 5 | 1.3 | | Quimera | 14 | 1.1 |
| Goblin | 6 | 1.2 | | Golem | 15 | 0.55 |
| Diabrete | 7 | 1.4 | | Dragão ✈ | 16 | 0.8 |
| Banshee ✈ | 8 | 1.1 | | Wyvern ✈ | 17 | 1.2 |
| Orc | 9 | 0.9 | | | | |

Um monstro novo entra a cada 2 ondas, na ordem da planilha (Slime nas ondas 1–2, primeiro voador — Morcego — na 7).
Voadores vêm em menor quantidade que os terrestres (só o Arqueiro dá conta deles).
Balanceado por bot: jogador atento zera com ~95 vidas; jogador mediano chega às ondas 15–18. Velocidade e tamanho (`size`) estão em `ENEMIES`.
`assets/src/arqueiro_longo.jpg` (Arqueiro Arco Longo) está recortado mas fora do jogo — não está na planilha.

## Arte (guardiões e inimigos)
Folhas de sprite em `assets/src/<nome>.jpg` (fundo xadrez pode vir "gravado" no JPG).
Linha 1 = parado/andando, linha 2 = ataque virado para a direita, linha 3 = frente, costas… e o último é morto.

```
python tools/extract_sprites.py archer mage:glow knight goblin@0.35
```
Gera `assets/<nome>.png` + `js/sprites-data.js`. `:glow` remove o halo do cristal; `@0.35` = escala (inimigos usam 0.35).

## Atalhos
`1` `2` escolher guardião · `Shift+clique` coloca vários · `Espaço` onda · `F` velocidade · `P` pausa ·
`,` `.` `/` evoluir caminhos 1/2/3 · `Tab` modo de mira · `Del` vender · `Esc` cancelar
