// =====================================================================
//  GUARDIÕES DO VALE — DADOS DO JOGO
//  Todo o balanceamento mora aqui: custos, dano, velocidade, ondas.
//  Mexa à vontade e recarregue a página.
// =====================================================================

const CONFIG = {
  startMoney: 500,
  startLives: 100,
  baseSpeed: 60,              // px/s de um monstro com velocidade 1.0
  sellRate: 0.7,              // venda devolve 70% do que foi gasto
  // Ouro acompanha a curva de dificuldade (waveBudget, lá embaixo em ONDAS):
  waveBonus: w => Math.round(30 + waveBudget(w) * 0.3),  // $ ao terminar a onda w
  killReward: hp => Math.max(1, Math.round(hp * 0.5)),     // $ por monstro morto (padrão; ENEMIES.reward sobrepõe)
};

// ---------------------------------------------------------------------
//  MAPA — pontos do caminho (canvas 960×640). Começa e termina fora da tela.
// ---------------------------------------------------------------------
const MAP = {
  name: 'Vale Verde',
  path: [[-40, 110], [200, 110], [200, 320], [440, 320], [440, 120], [720, 120],
         [720, 300], [860, 300], [860, 520], [120, 520], [120, 690]],
};

// ---------------------------------------------------------------------
//  INIMIGOS — criaturas com barra de vida (sprites em assets/<chave>.png).
//  hp: vida (planilha "Protect The Realm Project") — cada golpe tira `damage` do guardião (1 sem upgrade)
//  speed: multiplicador de baseSpeed · size: altura na tela (px)
//  reward: $ ao matar (padrão = CONFIG.killReward, metade da vida) · leak: vidas perdidas se passar (padrão = hp)
//  flying: voador (coluna TIPO da planilha) — só guardiões de ataque à distância conseguem acertar
//  color: cor de reserva enquanto o sprite carrega
// ---------------------------------------------------------------------
const ENEMIES = {
  slime:     { name: 'Slime',     hp: 1,  speed: 1.0,  size: 24, color: '#58d68d' },
  aranha:    { name: 'Aranha',    hp: 2,  speed: 1.3,  size: 26, color: '#4a3b52' },
  zumbi:     { name: 'Zumbi',     hp: 3,  speed: 0.7,  size: 34, color: '#7a9a5c' },
  esqueleto: { name: 'Esqueleto', hp: 4,  speed: 1.0,  size: 34, color: '#e8e2cf' },
  morcego:   { name: 'Morcego',   hp: 5,  speed: 1.3,  size: 28, color: '#5b4a6b', flying: true },
  goblin:    { name: 'Goblin',    hp: 6,  speed: 1.2,  size: 30, color: '#6b8e23' },
  diabrete:  { name: 'Diabrete',  hp: 7,  speed: 1.4,  size: 28, color: '#c0392b' },
  banshee:   { name: 'Banshee',   hp: 8,  speed: 1.1,  size: 36, color: '#a9cce3', flying: true },
  orc:       { name: 'Orc',       hp: 9,  speed: 0.9,  size: 38, color: '#556b2f' },
  harpia:    { name: 'Harpia',    hp: 10, speed: 1.4,  size: 36, color: '#a0522d', flying: true },
  troll:     { name: 'Troll',     hp: 11, speed: 0.7,  size: 46, color: '#6c7a89' },
  minotauro: { name: 'Minotauro', hp: 12, speed: 1.0,  size: 46, color: '#8b5a2b' },
  gargula:   { name: 'Gárgula',   hp: 13, speed: 0.9,  size: 40, color: '#7f8c8d', flying: true },
  quimera:   { name: 'Quimera',   hp: 14, speed: 1.1,  size: 46, color: '#b9770e' },
  golem:     { name: 'Golem',     hp: 15, speed: 0.55, size: 52, color: '#95a5a6' },
  dragao:    { name: 'Dragão',    hp: 16, speed: 0.8,  size: 58, color: '#922b21', flying: true },
  wyvern:    { name: 'Wyvern',    hp: 17, speed: 1.2,  size: 54, color: '#1e8449', flying: true },
};

// ---------------------------------------------------------------------
//  GUARDIÕES — 3 caminhos × 5 níveis.
//  Regra de evolução (igual BTD6): no máximo 2 caminhos,
//  e só 1 deles pode passar do nível 2  →  ex.: 5-2-0, 2-0-5, 0-3-2.
//
//  Stats disponíveis (ver DEFAULT_STATS em game.js):
//   range, rate (s entre ataques), damage, pierce, projSpeed, projCount, spread,
//   splash (raio), blastCount (máx. alvos na explosão), armorPierce, camo, homing,
//   slow {factor, dur}, freeze (s), burn {dps, dur}, chain (alvos do raio),
//   aura {slow, dps}, projColor,
//   kind ('arrow' | 'bolt' | 'bomb' | 'orb' | 'meteor' | 'shuriken' | 'cannonball' | 'missile' | 'pulse'),
//   attack (false = não ataca), bossBonus (dano extra em Couraçado/Rei),
//   knock {chance, dist}, decamo, crit {every, mult}, frags (estilhaços por explosão),
//   income ($ por onda), buff {range ×, rate ×, pierce +, damage +, camo} p/ guardiões no alcance
// ---------------------------------------------------------------------
const TOWERS = {
  archer: {
    name: 'Arqueiro',
    cost: 200,
    radius: 16,
    desc: 'Barato e rápido, ataca de longe. Acerta voadores.',
    base: {
      range: 125, rate: 0.9, damage: 1, pierce: 2, projSpeed: 650,
      kind: 'arrow', projColor: '#8d6e63',
    },
    // Valores de cada nível são o TOTAL acumulado (nível 2 de Dano = +4 no total, não +6).
    // sprite = folha (assets/<sprite>.png) que o Arqueiro passa a usar ao comprar a evolução.
    // Mostra a evolução de nível mais alto; empate → a última comprada.
    paths: [
      { name: 'Dano', color: '#ec7063', ups: [
        { name: 'Flechas Afiadas', cost: 250, desc: '+2 de dano', sprite: 'archer_d1',
          apply: s => { s.damage += 2; } },
        { name: 'Tiro Perfurante', cost: 450, desc: '+4 de dano no total', sprite: 'archer_d2',
          apply: s => { s.damage += 2; } },
      ]},
      { name: 'Alcance', color: '#58d68d', ups: [
        { name: 'Arco Longo',     cost: 100, desc: '+30 de alcance', sprite: 'archer_a1',
          apply: s => { s.range += 30; } },
        { name: 'Olhos de Águia', cost: 200, desc: '+50 de alcance no total', sprite: 'archer_a2',
          apply: s => { s.range += 20; } },
      ]},
      { name: 'Rapidez', color: '#5dade2', ups: [
        { name: 'Tiro Rápido',  cost: 150, desc: '+20% de velocidade de ataque', sprite: 'archer_r1',
          apply: s => { s.rate /= 1.2; } },
        { name: 'Mãos Velozes', cost: 300, desc: '+40% de velocidade de ataque no total', sprite: 'archer_r2',
          apply: s => { s.rate *= 1.2 / 1.4; } },
      ]},
    ],
  },

  knight: {
    name: 'Cavaleiro',
    cost: 150,
    radius: 16,
    desc: 'Barato e forte: golpe de espada que atinge até 2 monstros. Alcance curto e não alcança voadores.',
    base: {
      // corpo a corpo: acerta o alvo e mais (pierce - 1) monstros a até `cleave` px dele
      // antiAir: false = não ataca voadores (só quem ataca à distância acerta)
      range: 60, rate: 1.0, damage: 2, pierce: 2, cleave: 28, antiAir: false,
      kind: 'slash', projColor: '#d6eaf8',
    },
    // Valores de cada nível são o TOTAL acumulado, igual ao Arqueiro.
    paths: [
      { name: 'Dano', color: '#ec7063', ups: [
        { name: 'Lâmina Afiada', cost: 200, desc: '+2 de dano',
          apply: s => { s.damage += 2; } },
        { name: 'Espada Longa',  cost: 400, desc: '+4 de dano no total',
          apply: s => { s.damage += 2; } },
      ]},
      { name: 'Alcance', color: '#58d68d', ups: [
        { name: 'Investida',   cost: 80,  desc: '+15 de alcance',
          apply: s => { s.range += 15; } },
        { name: 'Passo Largo', cost: 160, desc: '+25 de alcance no total',
          apply: s => { s.range += 10; } },
      ]},
      { name: 'Rapidez', color: '#5dade2', ups: [
        { name: 'Golpe Ágil',   cost: 120, desc: '+20% de velocidade de ataque',
          apply: s => { s.rate /= 1.2; } },
        { name: 'Fúria Veloz',  cost: 250, desc: '+40% de velocidade de ataque no total',
          apply: s => { s.rate *= 1.2 / 1.4; } },
      ]},
    ],
  },

  mage: {
    name: 'Mago',
    soon: true,           // "Em breve": aparece cinza na loja e não pode ser comprado
    cost: 350,
    radius: 16,
    desc: 'Orbe mágico em área. Fura Couraça.',
    base: {
      range: 115, rate: 1.3, damage: 1, pierce: 1, projSpeed: 380,
      splash: 30, blastCount: 6, armorPierce: true, homing: true,
      kind: 'orb', projColor: '#c39bd3',
    },
    paths: [
      { name: 'Gelo', color: '#85c1e9', ups: [
        { name: 'Toque Gélido',   cost: 150,   desc: 'Deixa os alvos 40% mais lentos',
          apply: s => { s.slow = { factor: 0.6, dur: 1.5 }; s.projColor = '#85c1e9'; } },
        { name: 'Nevasca',        cost: 380,   desc: 'Área maior e lentidão de 50%',
          apply: s => { s.splash += 15; s.blastCount += 4; s.slow = { factor: 0.5, dur: 2 }; } },
        { name: 'Prisão de Gelo', cost: 1000,  desc: 'Congela os alvos por 0,9s, +1 dano',
          apply: s => { s.freeze = 0.9; s.damage += 1; } },
        { name: 'Era do Gelo',    cost: 3200,  desc: 'Aura: tudo no alcance fica lento e sofre dano',
          apply: s => { s.aura = { slow: 0.5, dps: 1 }; s.range += 15; } },
        { name: 'Zero Absoluto',  cost: 15000, desc: 'Aura brutal, congelamento longo',
          apply: s => { s.aura = { slow: 0.3, dps: 5 }; s.freeze = 1.6; s.rate *= 0.6; s.range += 30; s.damage += 2; } },
      ]},
      { name: 'Fogo', color: '#f0b27a', ups: [
        { name: 'Bola de Fogo',      cost: 220,   desc: '+1 de dano',
          apply: s => { s.damage += 1; s.projColor = '#f39c12'; } },
        { name: 'Brasas',            cost: 420,   desc: 'Queima: 1 de dano/s por 3s',
          apply: s => { s.burn = { dps: 1, dur: 3 }; } },
        { name: 'Meteoro',           cost: 1300,  desc: '+2 dano e explosão gigante',
          apply: s => { s.damage += 2; s.splash = 60; s.blastCount = 20; s.kind = 'meteor'; } },
        { name: 'Inferno',           cost: 4200,  desc: '2× mais rápido, queima 4/s',
          apply: s => { s.rate *= 0.5; s.burn = { dps: 4, dur: 3 }; } },
        { name: 'Avatar das Chamas', cost: 21000, desc: 'Dano colossal, queima 12/s',
          apply: s => { s.damage += 8; s.splash = 95; s.blastCount = 40; s.burn = { dps: 12, dur: 4 }; s.rate *= 0.7; } },
      ]},
      { name: 'Arcano', color: '#bb8fce', ups: [
        { name: 'Foco Arcano',       cost: 130,   desc: '+25 de alcance',
          apply: s => { s.range += 25; } },
        { name: 'Olho Místico',      cost: 260,   desc: 'Enxerga camuflados, 15% mais rápido',
          apply: s => { s.camo = true; s.rate *= 0.85; } },
        { name: 'Raio Encadeado',    cost: 1100,  desc: 'Raio salta entre 6 monstros, +1 dano',
          apply: s => { s.chain = 6; s.damage += 1; s.projColor = '#d2b4de'; } },
        { name: 'Tempestade Arcana', cost: 3600,  desc: 'Salta entre 12, muito mais rápido',
          apply: s => { s.chain = 12; s.rate *= 0.55; s.damage += 1; } },
        { name: 'Arquimago',         cost: 18000, desc: 'Salta entre 30, +4 dano, +40 alcance',
          apply: s => { s.chain = 30; s.damage += 4; s.rate *= 0.6; s.range += 40; } },
      ]},
    ],
  },

};

// ---------------------------------------------------------------------
//  ONDAS — geradas a partir de uma CURVA DE DIFICULDADE.
//  Cada onda tem um "orçamento" de vida (soma da vida dos monstros) que cresce suave.
//  Voadores custam mais no orçamento (só o Arqueiro acerta neles).
//  WAVE_PLAN diz QUAIS monstros vêm em cada onda e que fatia do orçamento cada um leva;
//  as quantidades saem da conta. Para deixar mais fácil/difícil, mexa só em WAVE_CURVE.
// ---------------------------------------------------------------------
const WAVE_CURVE = {
  base: 26,                       // orçamento da onda 1 (vida total)
  growth: 1.135,                  // cada onda tem +13,5% de orçamento que a anterior
  airWeight: 2,                   // 1 de vida voadora conta como 2 no orçamento (só o Arqueiro acerta)
  duration: w => 14 + w * 0.4,    // segundos que os monstros levam p/ entrar
  groupDelay: 2.5,                // atraso entre os grupos da mesma onda
};
const waveBudget = w => Math.round(WAVE_CURVE.base * Math.pow(WAVE_CURVE.growth, w - 1));

//              [monstro, fatia do orçamento]  — um monstro novo a cada 2 ondas, na ordem da planilha.
//              Nenhuma onda é só de voadores (ficavam picos de dificuldade: Cavaleiro não acerta).
const WAVE_PLAN = [
  /* 1 */ [['slime', 1]],
  /* 2 */ [['slime', 0.5], ['aranha', 0.5]],
  /* 3 */ [['zumbi', 0.55], ['aranha', 0.45]],
  /* 4 */ [['zumbi', 0.55], ['aranha', 0.45]],
  /* 5 */ [['esqueleto', 0.55], ['zumbi', 0.45]],
  /* 6 */ [['esqueleto', 0.55], ['aranha', 0.45]],
  /* 7 */ [['morcego', 0.4], ['esqueleto', 0.6]],     // 1º voador: precisa de Arqueiro
  /* 8 */ [['morcego', 0.45], ['zumbi', 0.55]],
  /* 9 */ [['goblin', 0.55], ['morcego', 0.45]],
  /*10 */ [['goblin', 0.55], ['esqueleto', 0.45]],
  /*11 */ [['diabrete', 0.55], ['morcego', 0.45]],
  /*12 */ [['diabrete', 0.55], ['goblin', 0.45]],
  /*13 */ [['banshee', 0.45], ['diabrete', 0.55]],
  /*14 */ [['banshee', 0.45], ['goblin', 0.55]],
  /*15 */ [['orc', 0.55], ['banshee', 0.45]],
  /*16 */ [['orc', 0.55], ['diabrete', 0.45]],
  /*17 */ [['harpia', 0.45], ['orc', 0.55]],
  /*18 */ [['harpia', 0.45], ['orc', 0.55]],
  /*19 */ [['troll', 0.55], ['harpia', 0.45]],
  /*20 */ [['troll', 0.55], ['banshee', 0.45]],
  /*21 */ [['minotauro', 0.55], ['troll', 0.45]],
  /*22 */ [['minotauro', 0.55], ['orc', 0.45]],
  /*23 */ [['gargula', 0.45], ['minotauro', 0.55]],
  /*24 */ [['gargula', 0.45], ['troll', 0.55]],
  /*25 */ [['quimera', 0.55], ['gargula', 0.45]],
  /*26 */ [['quimera', 0.55], ['troll', 0.45]],
  /*27 */ [['golem', 0.55], ['quimera', 0.45]],
  /*28 */ [['golem', 0.55], ['minotauro', 0.45]],
  /*29 */ [['dragao', 0.45], ['golem', 0.55]],
  /*30 */ [['wyvern', 0.35], ['dragao', 0.3], ['golem', 0.35]],
];

// Um grupo de monstros: g(monstro, quantidade, intervalo_s, atraso_inicial_s, multiplicador_de_vida)
const g = (type, count, gap, delay = 0, hpMul = 1) => ({ type, count, gap, delay, hpMul });

function buildWave(plan, w, hpMul = 1) {
  const budget = waveBudget(w), dur = WAVE_CURVE.duration(w);
  return plan.map(([type, share], i) => {
    const d = ENEMIES[type];
    const cost = d.hp * hpMul * (d.flying ? WAVE_CURVE.airWeight : 1);
    const count = Math.max(2, Math.round(budget * share / cost));
    return g(type, count, +(dur / count).toFixed(2), i * WAVE_CURVE.groupDelay, hpMul);
  });
}

const WAVES = WAVE_PLAN.map((plan, i) => buildWave(plan, i + 1));

// Modo livre (depois da onda 30): a mesma curva continua subindo.
function freeplayWave(n) {
  return buildWave([['wyvern', 0.35], ['dragao', 0.3], ['golem', 0.35]], n);
}
