'use strict';
/* =====================================================================
   GUARDIÕES DO VALE — motor do jogo
   Canvas 2D puro, sem dependências. Balanceamento fica em data.js.
   ===================================================================== */

const W = 960, H = 640, PATH_W = 46, DT = 1 / 60, TAU = Math.PI * 2;
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
const $ = id => document.getElementById(id);
const fmt = n => Math.floor(n).toLocaleString('pt-BR');

const DEFAULT_STATS = {
  range: 100, rate: 1, damage: 1, pierce: 1, projSpeed: 500, projCount: 1, spread: 0,
  splash: 0, blastCount: 8, armorPierce: false, camo: false, homing: false,
  slow: null, freeze: 0, burn: null, chain: 0, aura: null, kind: 'arrow', projColor: '#fff',
  attack: true, bossBonus: 0, knock: null, decamo: false, crit: null, frags: 0, income: 0, buff: null,
  cleave: 0,
  antiAir: true,        // false = não ataca monstros voadores (guardiões corpo a corpo)
};
const FRAG_STATS = Object.assign({}, DEFAULT_STATS, { damage: 1, pierce: 1, projSpeed: 420, kind: 'frag' });
const MODES = ['first', 'last', 'strong', 'close'];
const MODE_LABEL = { first: 'Primeiro', last: 'Último', strong: 'Mais forte', close: 'Mais perto' };

// ---------------------------------------------------------------------
//  Caminho
// ---------------------------------------------------------------------
const PATH = (() => {
  const pts = MAP.path.map(([x, y]) => ({ x, y }));
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
    segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, len, start: total });
    total += len;
  }
  return { pts, segs, total };
})();

function posAt(d) {
  let s = PATH.segs[0];
  if (d > 0) for (s of PATH.segs) if (d <= s.start + s.len) break;
  const t = (d - s.start) / s.len;
  return { x: s.x1 + (s.x2 - s.x1) * t, y: s.y1 + (s.y2 - s.y1) * t };
}

function distToPath(x, y) {
  let m = Infinity;
  for (const s of PATH.segs) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / (s.len * s.len)));
    m = Math.min(m, Math.hypot(x - (s.x1 + dx * t), y - (s.y1 + dy * t)));
  }
  return m;
}

// ---------------------------------------------------------------------
//  Utilidades
// ---------------------------------------------------------------------
function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = v => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// Completa os dados dos monstros: raio de colisão pelo tamanho, recompensa e vidas perdidas (= vida).
for (const d of Object.values(ENEMIES)) {
  d.radius = d.radius || Math.round(d.size * 0.33);
  d.lift = d.flying ? Math.round(d.size * 0.35) : 0;   // voadores ficam acima do caminho (corpo mais alto que a sombra)
  d.reward = d.reward ?? CONFIG.killReward(d.hp);
  d.leak = d.leak ?? d.hp;
}

function computeStats(key, tiers) {
  const def = TOWERS[key];
  const s = Object.assign({}, DEFAULT_STATS, JSON.parse(JSON.stringify(def.base)));
  def.paths.forEach((p, i) => { for (let k = 0; k < tiers[i]; k++) p.ups[k].apply(s); });
  return s;
}

// Recalcula os stats de todos: evoluções próprias + o melhor buff de Bardos no alcance (não acumula).
function refreshStats() {
  for (const t of G.towers) t.own = computeStats(t.key, t.tiers);
  for (const t of G.towers) {
    const b = { range: 1, rate: 1, camo: false, pierce: 0, damage: 0 };
    let buffed = false;
    for (const o of G.towers) {
      const ob = o.own.buff;
      if (o === t || !ob || Math.hypot(o.x - t.x, o.y - t.y) > o.own.range) continue;
      buffed = true;
      b.range = Math.max(b.range, ob.range || 1);
      b.rate = Math.min(b.rate, ob.rate || 1);
      b.camo = b.camo || !!ob.camo;
      b.pierce = Math.max(b.pierce, ob.pierce || 0);
      b.damage = Math.max(b.damage, ob.damage || 0);
    }
    const s = Object.assign({}, t.own);
    s.range *= b.range; s.rate *= b.rate; s.camo = s.camo || b.camo;
    s.pierce += b.pierce; s.damage += b.damage;
    t.s = s;
    t.buffed = buffed;
  }
}

function buffText(b) {
  const parts = [];
  if (b.range > 1) parts.push(`+${Math.round((b.range - 1) * 100)}% alcance`);
  if (b.rate < 1) parts.push(`${Math.round((1 - b.rate) * 100)}% mais rápidos`);
  if (b.pierce) parts.push(`+${b.pierce} perfuração`);
  if (b.damage) parts.push(`+${b.damage} dano`);
  if (b.camo) parts.push('veem camuflados');
  return parts.join(', ');
}

function dominant(tiers) {
  let p = 0;
  for (let i = 1; i < tiers.length; i++) if (tiers[i] > tiers[p]) p = i;
  return { p, tier: tiers[p] };
}

// ---------------------------------------------------------------------
//  Estado
// ---------------------------------------------------------------------
let G;
const mouse = { x: 0, y: 0, in: false };

function newGame() {
  G = {
    money: CONFIG.startMoney, lives: CONFIG.startLives, wave: 0, state: 'build',
    enemies: [], projectiles: [], towers: [], effects: [], spawners: [],
    speed: G ? G.speed : 1, auto: G ? G.auto : false, paused: false,
    placing: null, selected: null, freeplay: false, nextId: 1, time: 0,
  };
  hideOverlay();
  toast('Posicione seus guardiões e clique em ▶ Iniciar onda');
}

function getWave(i) { return i < WAVES.length ? WAVES[i] : freeplayWave(i + 1); }

function startWave() {
  if (G.state !== 'build') return;
  G.spawners = getWave(G.wave).map(gr => ({ ...gr, spawned: 0, timer: gr.delay }));
  G.state = 'wave';
}

function endWave() {
  G.wave++;
  const bonus = CONFIG.waveBonus(G.wave);
  let income = 0;
  for (const t of G.towers) {
    if (!t.s.income) continue;
    income += t.s.income;
    addText(t.x, t.y - 22, `+$${fmt(t.s.income)}`, '#f7dc6f');
  }
  G.money += bonus + income;
  G.state = 'build';
  if (G.wave === WAVES.length && !G.freeplay) return victory();
  toast(`Onda ${G.wave} concluída! +$${fmt(bonus)}` + (income ? ` · renda +$${fmt(income)}` : ''));
  if (G.auto) startWave();
}

// ---------------------------------------------------------------------
//  Inimigos
// ---------------------------------------------------------------------
function spawnEnemy(type, hpMul = 1, d = 0) {
  const p = posAt(d);
  const maxHp = Math.round(ENEMIES[type].hp * hpMul);
  const e = {
    id: G.nextId++, type, hp: maxHp, maxHp, d, camo: false, x: p.x, y: p.y,
    slowT: 0, slowF: 1, freezeT: 0, thawT: 0, burnDps: 0, burnT: 0, burnAcc: 0, burnSrc: null,
    auraSlow: 1, auraAcc: 0, dead: false, phase: Math.random() * TAU, flash: 0, dir: 0,
  };
  G.enemies.push(e);
  return e;
}

function killEnemy(e, tower) {
  const def = ENEMIES[e.type];
  e.dead = true;
  G.money += def.reward;
  if (tower) tower.pops++;
  addFx({ type: 'corpse', key: e.type, x: e.x, y: e.y, flip: e.dir < 0, color: def.color, ttl: 0.9 });
  addText(e.x, e.y - def.size * 0.6, `+$${def.reward}`, '#f7dc6f');
}

// Cada golpe tira `dmg` de vida. Retorna false se o golpe foi bloqueado (armadura).
function damageEnemy(e, dmg, armorPierce, tower) {
  if (e.dead) return false;
  if (ENEMIES[e.type].armored && !armorPierce) { addClink(e.x, e.y); return false; }
  e.hp -= dmg;
  e.flash = 0.12;
  if (e.hp <= 0) killEnemy(e, tower);
  return true;
}

function hitEnemy(e, s, tower) {
  const def = ENEMIES[e.type];
  const dmg = s.damage + (def.armored || def.boss ? s.bossBonus : 0);
  if (!damageEnemy(e, dmg, s.armorPierce, tower) || e.dead) return;
  const boss = ENEMIES[e.type].boss;
  if (s.decamo) e.camo = false;
  if (s.knock && !boss && Math.random() < s.knock.chance) e.d = Math.max(0, e.d - s.knock.dist);
  if (s.slow) {
    const f = boss ? Math.max(s.slow.factor, 0.7) : s.slow.factor;
    if (e.slowT <= 0 || f <= e.slowF) e.slowF = f;
    e.slowT = Math.max(e.slowT, s.slow.dur);
  }
  if (s.freeze && !boss && e.thawT <= 0) { e.freezeT = s.freeze; e.thawT = s.freeze + 0.6; }
  if (s.burn) {
    if (e.burnT <= 0 || s.burn.dps >= e.burnDps) { e.burnDps = s.burn.dps; e.burnSrc = tower; }
    e.burnT = Math.max(e.burnT, s.burn.dur);
  }
}

function enemySpeed(e) {
  if (e.freezeT > 0) return 0;
  let f = e.auraSlow;
  if (e.slowT > 0) f = Math.min(f, e.slowF);
  return CONFIG.baseSpeed * ENEMIES[e.type].speed * f;
}

function updateEnemies(dt) {
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (e.burnT > 0) {
      e.burnT -= dt;
      e.burnAcc += e.burnDps * dt;
      while (e.burnAcc >= 1 && !e.dead) { e.burnAcc -= 1; damageEnemy(e, 1, true, e.burnSrc); }
      if (e.dead) continue;
    }
    const sp = enemySpeed(e);
    if (e.freezeT > 0) e.freezeT -= dt;
    if (e.thawT > 0) e.thawT -= dt;
    if (e.slowT > 0) e.slowT -= dt;
    e.auraSlow = 1;
    e.d += sp * dt;
    e.phase += sp * dt;                       // passos andados (anima a caminhada)
    if (e.flash > 0) e.flash -= dt;
    const p = posAt(e.d);
    // direção da caminhada (escolhe o sprite): vx/vy = deslocamento; dir = lado que encara (1 dir., -1 esq.)
    e.vx = p.x - e.x; e.vy = p.y - e.y;
    if (e.vx > 0.01) e.dir = 1; else if (e.vx < -0.01) e.dir = -1;
    e.x = p.x; e.y = p.y;
    if (e.d >= PATH.total) {
      const loss = ENEMIES[e.type].leak;
      e.dead = true;
      G.lives -= loss;
      addText(e.x, H - 30, `-${fmt(loss)} ❤`, '#ff6b6b');
      if (G.lives <= 0) { G.lives = 0; gameOver(); return; }
    }
  }
}

// ---------------------------------------------------------------------
//  Guardiões
// ---------------------------------------------------------------------
function canPlace(key, x, y) {
  const r = TOWERS[key].radius;
  if (x < r || y < r || x > W - r || y > H - r) return false;
  if (distToPath(x, y) < PATH_W / 2 + r - 2) return false;
  for (const t of G.towers) if (Math.hypot(t.x - x, t.y - y) < r + TOWERS[t.key].radius + 2) return false;
  return true;
}

function placeTower(key, x, y) {
  const def = TOWERS[key];
  if (G.money < def.cost || !canPlace(key, x, y)) return null;
  G.money -= def.cost;
  const t = {
    id: G.nextId++, key, x, y, tiers: [0, 0, 0], spent: def.cost,
    cooldown: 0, angle: 0, recoil: 0, atk: 99, mode: 'first', pops: 0, shots: 0,
  };
  G.towers.push(t);
  refreshStats();
  addRing(x, y, 30, '#ffffff');
  return t;
}

function towerAt(x, y) {
  for (const t of G.towers) {
    if (Math.hypot(t.x - x, t.y - y) <= TOWERS[t.key].radius + 4) return t;
    // personagens desenhados ficam "em pé": vale clicar no corpo também
    if (SHEETS[t.key] && SHEETS[t.key].ready && Math.abs(x - t.x) <= 14 && y <= t.y && y >= t.y - CHAR_H) return t;
  }
  return null;
}

// Altura de onde sai o disparo (arco/cajado do personagem desenhado).
function muzzleY(t) { return SHEETS[t.key] && SHEETS[t.key].ready ? -24 : 0; }

function sellValue(t) { return Math.floor(t.spent * CONFIG.sellRate); }

function sellTower(t) {
  const v = sellValue(t);
  G.money += v;
  G.towers = G.towers.filter(x => x !== t);
  refreshStats();
  if (G.selected === t) G.selected = null;
  addText(t.x, t.y, `+$${fmt(v)}`, '#ffd54f');
}

// Regra BTD6: no máx. 2 caminhos, e só 1 passa do nível 2.
function upgradeState(t, p) {
  const ups = TOWERS[t.key].paths[p].ups;
  const tier = t.tiers[p];
  if (tier >= ups.length) return { status: 'max' };
  const others = t.tiers.filter((_, i) => i !== p);
  if (tier === 0 && others.filter(v => v > 0).length >= 2) return { status: 'locked', why: 'Só 2 caminhos por guardião' };
  if (tier + 1 >= 3 && others.some(v => v >= 3)) return { status: 'locked', why: 'Só 1 caminho passa do nível 2' };
  const up = ups[tier];
  return { status: G.money >= up.cost ? 'ok' : 'poor', up };
}

function buyUpgrade(t, p) {
  const st = upgradeState(t, p);
  if (st.status !== 'ok') return;
  G.money -= st.up.cost;
  t.spent += st.up.cost;
  t.tiers[p]++;
  t.lastPath = p;                       // define qual arte de evolução aparece em caso de empate
  refreshStats();
  addRing(t.x, t.y, 40, TOWERS[t.key].paths[p].color, 0.45);
  addText(t.x, t.y - 20, st.up.name, '#ffffff');
}

function inRange(t, e, r) {
  const dx = e.x - t.x, dy = e.y - t.y, rr = r + ENEMIES[e.type].radius;
  return dx * dx + dy * dy <= rr * rr;
}

function pickTarget(t) {
  const s = t.s;
  let best = null, bestV = -Infinity;
  for (const e of G.enemies) {
    if (e.dead || e.x < 0 || e.y > H) continue;
    if (e.camo && !s.camo) continue;
    if (ENEMIES[e.type].flying && !s.antiAir) continue;   // corpo a corpo não alcança voadores
    if (!inRange(t, e, s.range)) continue;
    let v;
    switch (t.mode) {
      case 'first': v = e.d; break;
      case 'last': v = -e.d; break;
      case 'strong': v = e.hp * 1e5 + e.d; break;         // mais vida restante
      default: v = -Math.hypot(e.x - t.x, e.y - t.y);
    }
    if (v > bestV) { bestV = v; best = e; }
  }
  return best;
}

function applyAura(t, dt) {
  const a = t.s.aura;
  for (const e of G.enemies) {
    if (e.dead || !inRange(t, e, t.s.range)) continue;
    const boss = ENEMIES[e.type].boss;
    e.auraSlow = Math.min(e.auraSlow, boss ? Math.max(a.slow, 0.7) : a.slow);
    if (a.dps) {
      e.auraAcc += a.dps * dt;
      while (e.auraAcc >= 1 && !e.dead) { e.auraAcc -= 1; damageEnemy(e, 1, true, t); }
    }
  }
}

function fire(t, target) {
  let s = t.s;
  t.recoil = 1;
  t.atk = 0;
  t.shots++;
  if (s.kind === 'pulse') return pulse(t);
  if (s.kind === 'slash') {
    // o dano sai no meio da animação, quando a espada passa (ver HIT_AT)
    t.angle = Math.atan2(target.y - t.y, target.x - t.x);
    t.swing = { target, at: attackDur(s.rate) * HIT_AT };
    return;
  }
  if (s.chain > 0) {
    t.angle = Math.atan2(target.y - t.y, target.x - t.x);
    return chainLightning(t, target);
  }
  if (s.crit && t.shots % s.crit.every === 0) {
    s = Object.assign({}, s, { damage: s.damage * s.crit.mult, armorPierce: true, isCrit: true });
  }
  // mira a partir de onde o projétil sai (arco/cajado), prevendo onde o alvo vai estar
  const ox = t.x, oy = t.y + muzzleY(t);
  const lift = ENEMIES[target.type].lift;            // voador: mira no corpo, não na sombra
  const at = d => { const q = posAt(d); return { x: q.x, y: q.y - lift }; };
  let aim = { x: target.x, y: target.y - lift };
  if (!s.homing) {
    const sp = enemySpeed(target);
    let tt = 0;
    for (let k = 0; k < 3; k++) {
      aim = at(target.d + sp * tt);
      tt = Math.max(0, Math.hypot(aim.x - ox, aim.y - oy) - 14) / s.projSpeed;
    }
    aim = at(target.d + sp * tt);
  }
  const base = Math.atan2(aim.y - oy, aim.x - ox);
  t.angle = base;
  const n = s.projCount, main = Math.floor(n / 2);
  for (let i = 0; i < n; i++) {
    const a = base + (n > 1 ? -s.spread + 2 * s.spread * i / (n - 1) : 0);
    G.projectiles.push({
      x: ox + Math.cos(a) * 14, y: oy + Math.sin(a) * 14,
      vx: Math.cos(a) * s.projSpeed, vy: Math.sin(a) * s.projSpeed,
      life: (s.range + 120) / s.projSpeed, pierce: s.pierce, hit: new Set(),
      // o projétil principal sempre persegue o alvo escolhido, então nunca erra o "primeiro da fila"
      s, tower: t, target: s.homing || i === main ? target : null, dead: false,
    });
  }
}

function chainLightning(t, first) {
  const s = t.s, hit = [first], seen = new Set([first.id]);
  let cur = first;
  while (hit.length < s.chain) {
    let best = null, bd = 110;
    for (const e of G.enemies) {
      if (e.dead || seen.has(e.id)) continue;
      const d = Math.hypot(e.x - cur.x, e.y - cur.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) break;
    hit.push(best); seen.add(best.id); cur = best;
  }
  addBolt([{ x: t.x + Math.cos(t.angle) * 14, y: t.y + (muzzleY(t) || -6) }, ...hit.map(e => ({ x: e.x, y: e.y }))], s.projColor);
  for (const e of hit) hitEnemy(e, s, t);
}

function explode(x, y, s, tower) {
  addBlast(x, y, s.splash, s.projColor);
  const list = G.enemies
    .filter(e => !e.dead && Math.hypot(e.x - x, e.y - y) <= s.splash + ENEMIES[e.type].radius)
    .sort((a, b) => b.d - a.d)
    .slice(0, s.blastCount);
  for (const e of list) hitEnemy(e, s, tower);
  for (let i = 0; i < s.frags; i++) {
    const a = i / s.frags * TAU + Math.random() * 0.3, sp = FRAG_STATS.projSpeed;
    G.projectiles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.3, pierce: 1, hit: new Set(),
      s: FRAG_STATS, tower, target: null, dead: false,
    });
  }
}

// Golpe corpo a corpo: acerta o alvo na hora (nunca erra) e mais quem estiver colado nele.
function melee(t, target) {
  const s = t.s;
  t.angle = Math.atan2(target.y - t.y, target.x - t.x);
  const others = G.enemies
    .filter(e => e !== target && !e.dead && (s.antiAir || !ENEMIES[e.type].flying) &&
      Math.hypot(e.x - target.x, e.y - target.y) <= s.cleave + ENEMIES[e.type].radius)
    .sort((a, b) => b.d - a.d)
    .slice(0, Math.max(0, s.pierce - 1));
  addFx({ type: 'slash', x: target.x, y: target.y, a: t.angle, r: 18 + s.cleave * 0.4, color: s.projColor, ttl: 0.2 });
  for (const e of [target, ...others]) hitEnemy(e, s, t);
}

// Onda sonora do Bardo: atinge tudo no alcance (inclusive camuflados).
function pulse(t) {
  const s = t.s;
  addRing(t.x, t.y, s.range, s.projColor, 0.4);
  const list = G.enemies
    .filter(e => !e.dead && inRange(t, e, s.range))
    .sort((a, b) => b.d - a.d)
    .slice(0, s.blastCount);
  for (const e of list) hitEnemy(e, s, t);
}

function updateTowers(dt) {
  for (const t of G.towers) {
    t.cooldown -= dt;
    t.recoil = Math.max(0, t.recoil - dt * 5);
    t.atk += dt;
    if (t.swing && t.atk >= t.swing.at) {
      // se o alvo morreu ou saiu do alcance durante o golpe, acerta quem estiver ao alcance
      let tg = t.swing.target;
      t.swing = null;
      if (tg.dead || !inRange(t, tg, t.s.range + 15)) tg = pickTarget(t);
      if (tg) melee(t, tg);
    }
    if (t.s.aura) applyAura(t, dt);
    if (t.s.attack && t.cooldown <= 0) {
      const tg = pickTarget(t);
      if (tg) { fire(t, tg); t.cooldown = t.s.rate; } else t.cooldown = 0;
    }
  }
}

function updateProjectiles(dt) {
  for (const p of G.projectiles) {
    if (p.dead) continue;
    if (p.target && (p.target.dead || p.hit.has(p.target.id))) p.target = null; // já acertou: segue reto
    if (p.target) {
      const sp = p.s.projSpeed, dx = p.target.x - p.x, dy = p.target.y - ENEMIES[p.target.type].lift - p.y, d = Math.hypot(dx, dy) || 1;
      p.vx += (dx / d * sp - p.vx) * Math.min(1, dt * 10);
      p.vy += (dy / d * sp - p.vy) * Math.min(1, dt * 10);
      const v = Math.hypot(p.vx, p.vy) || 1;
      p.vx = p.vx / v * sp; p.vy = p.vy / v * sp;
    }
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    if (p.life <= 0 || p.x < -30 || p.x > W + 30 || p.y < -30 || p.y > H + 30) { p.dead = true; continue; }
    const pr = p.s.splash > 0 ? 6 : 4;
    for (const e of G.enemies) {
      if (e.dead || p.hit.has(e.id)) continue;
      const rr = ENEMIES[e.type].radius + pr, dx = e.x - p.x, dy = e.y - ENEMIES[e.type].lift - p.y;
      if (dx * dx + dy * dy > rr * rr) continue;
      if (p.s.splash > 0) { explode(p.x, p.y, p.s, p.tower); p.dead = true; break; }
      hitEnemy(e, p.s, p.tower);
      p.hit.add(e.id);
      if (--p.pierce <= 0) { p.dead = true; break; }
    }
  }
}

function updateWave(dt) {
  if (G.state !== 'wave') return;
  for (const sp of G.spawners) {
    if (sp.spawned >= sp.count) continue;
    sp.timer -= dt;
    while (sp.timer <= 0 && sp.spawned < sp.count) {
      spawnEnemy(sp.type, sp.hpMul);
      sp.spawned++;
      sp.timer += sp.gap;
    }
  }
}

function step(dt) {
  G.time += dt;
  updateWave(dt);
  updateTowers(dt);
  updateProjectiles(dt);
  updateEnemies(dt);
  for (const f of G.effects) f.t += dt;
  G.enemies = G.enemies.filter(e => !e.dead);
  G.projectiles = G.projectiles.filter(p => !p.dead);
  G.effects = G.effects.filter(f => f.t < f.ttl);
  if (G.state === 'wave' && G.enemies.length === 0 && G.spawners.every(sp => sp.spawned >= sp.count)) endWave();
}

// ---------------------------------------------------------------------
//  Efeitos
// ---------------------------------------------------------------------
function addFx(f) { if (G.effects.length < 600) G.effects.push(Object.assign({ t: 0 }, f)); }
function addSplat(x, y, color, r) {
  const drops = [];
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * TAU, v = 40 + Math.random() * 70;
    drops.push({ vx: Math.cos(a) * v, vy: Math.sin(a) * v });
  }
  addFx({ type: 'splat', x, y, color, ttl: 0.35, drops, r: Math.max(2, r * 0.25) });
}
function addRing(x, y, r, color, ttl = 0.3) { addFx({ type: 'ring', x, y, r, color, ttl }); }
function addBlast(x, y, r, color) { addFx({ type: 'blast', x, y, r, color, ttl: 0.3 }); }
function addClink(x, y) { addFx({ type: 'clink', x, y, ttl: 0.2 }); }
function addText(x, y, text, color) { addFx({ type: 'text', x, y, text, color, ttl: 1 }); }
function addBolt(pts, color) {
  const jag = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    jag.push(a);
    for (let k = 1; k < 4; k++) {
      const t = k / 4;
      jag.push({ x: a.x + (b.x - a.x) * t + (Math.random() - 0.5) * 12, y: a.y + (b.y - a.y) * t + (Math.random() - 0.5) * 12 });
    }
  }
  jag.push(pts[pts.length - 1]);
  addFx({ type: 'bolt', pts: jag, color, ttl: 0.18 });
}

// ---------------------------------------------------------------------
//  Desenho
// ---------------------------------------------------------------------
// Resolução de desenho: o jogo pensa em 960×640 "unidades", mas o canvas tem tantos pixels
// quanto ocupa de verdade na tela (tamanho na página × zoom do sistema). Sem isso, o navegador
// esticava um quadro de 960px até 2–3× num monitor grande e tudo ficava borrado.
let RS = 1;                                  // pixels reais do canvas por unidade do jogo
const bg = document.createElement('canvas'); // cenário pré-desenhado, na mesma resolução

function fitCanvas() {
  const r = cv.getBoundingClientRect();
  if (!r.width) return;
  const s = Math.max(1, Math.min(4, r.width * (window.devicePixelRatio || 1) / W));
  if (Math.abs(s - RS) < 0.01 && bg.width) return;
  RS = s;
  cv.width = Math.round(W * s); cv.height = Math.round(H * s);
  bg.width = cv.width; bg.height = cv.height;
  const b = bg.getContext('2d');
  b.setTransform(s, 0, 0, s, 0, 0);
  drawBackground(b);
}
fitCanvas();
new ResizeObserver(fitCanvas).observe(cv);
matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener?.('change', fitCanvas);  // mudou o zoom do sistema

function tracePath(c) {
  c.beginPath();
  PATH.pts.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
}

function drawBackground(c) {
  const grd = c.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, '#83c96f'); grd.addColorStop(1, '#5da653');
  c.fillStyle = grd; c.fillRect(0, 0, W, H);
  const rnd = mulberry32(7);
  // manchas de grama
  for (let i = 0; i < 40; i++) {
    c.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,60,0,0.05)';
    c.beginPath(); c.ellipse(rnd() * W, rnd() * H, 40 + rnd() * 80, 25 + rnd() * 50, rnd() * 3, 0, TAU); c.fill();
  }
  // tufos
  c.lineWidth = 1.5; c.lineCap = 'round';
  for (let i = 0; i < 600; i++) {
    const x = rnd() * W, y = rnd() * H;
    if (distToPath(x, y) < PATH_W / 2 + 6) continue;
    c.strokeStyle = rnd() < 0.5 ? 'rgba(40,110,40,0.5)' : 'rgba(170,220,130,0.55)';
    c.beginPath(); c.moveTo(x, y); c.lineTo(x - 2, y - 5); c.moveTo(x, y); c.lineTo(x + 2, y - 6); c.stroke();
  }
  // flores
  const petals = ['#fff', '#ffd6e7', '#fff3a6', '#d6c7ff'];
  for (let i = 0; i < 80; i++) {
    const x = rnd() * W, y = rnd() * H;
    if (distToPath(x, y) < PATH_W / 2 + 8) continue;
    c.fillStyle = petals[Math.floor(rnd() * petals.length)];
    for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(x + Math.cos(k * 1.57) * 2.2, y + Math.sin(k * 1.57) * 2.2, 1.8, 0, TAU); c.fill(); }
    c.fillStyle = '#f5b041'; c.beginPath(); c.arc(x, y, 1.4, 0, TAU); c.fill();
  }
  // caminho
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.strokeStyle = 'rgba(0,0,0,0.18)'; c.lineWidth = PATH_W + 14; c.save(); c.translate(0, 4); tracePath(c); c.stroke(); c.restore();
  c.strokeStyle = '#9b7442'; c.lineWidth = PATH_W + 8; tracePath(c); c.stroke();
  c.strokeStyle = '#d8b273'; c.lineWidth = PATH_W; tracePath(c); c.stroke();
  c.strokeStyle = '#e6c78e'; c.lineWidth = PATH_W - 18; tracePath(c); c.stroke();
  // pedrinhas
  for (let i = 0; i < 260; i++) {
    const d = rnd() * PATH.total, p = posAt(d);
    c.fillStyle = rnd() < 0.5 ? 'rgba(120,85,45,0.35)' : 'rgba(255,255,255,0.25)';
    c.beginPath(); c.arc(p.x + (rnd() - 0.5) * (PATH_W - 10), p.y + (rnd() - 0.5) * (PATH_W - 10), 1 + rnd() * 2, 0, TAU); c.fill();
  }
  // portão no fim
  const end = PATH.pts[PATH.pts.length - 2];
  c.fillStyle = '#7f8c8d'; c.fillRect(end.x - 40, H - 34, 14, 34); c.fillRect(end.x + 26, H - 34, 14, 34);
  c.fillStyle = '#95a5a6'; c.fillRect(end.x - 42, H - 40, 18, 8); c.fillRect(end.x + 24, H - 40, 18, 8);
  c.fillStyle = '#c0392b'; c.beginPath(); c.moveTo(end.x - 33, H - 40); c.lineTo(end.x - 33, H - 62); c.lineTo(end.x - 18, H - 56); c.lineTo(end.x - 33, H - 50); c.fill();
}

function drawRange(x, y, r, ok) {
  ctx.fillStyle = ok ? 'rgba(255,255,255,0.12)' : 'rgba(255,60,60,0.18)';
  ctx.strokeStyle = ok ? 'rgba(255,255,255,0.55)' : 'rgba(255,80,80,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.stroke();
}

// Ajustes por monstro quando a linha 2 da folha não segue o padrão [frente, costas×4, morto]:
//   noBack = não tem quadros de costas (usa a caminhada de lado) · back = índices dos quadros de costas
const ENEMY_POSE = {
  slime: { back: [2] }, aranha: { noBack: true }, morcego: { noBack: true },
  zumbi: { back: [1, 2, 3] }, esqueleto: { back: [1, 2, 3, 4] }, diabrete: { back: [1, 2, 3] },
  banshee: { back: [1, 2] }, orc: { back: [0, 1, 2, 4] }, harpia: { back: [2, 3] },
  troll: { back: [1, 2, 4] }, minotauro: { back: [1, 2, 4] }, gargula: { back: [1, 2, 4] },
  quimera: { back: [1, 2, 4] }, golem: { back: [1, 2, 4] }, dragao: { back: [0, 1] }, wyvern: { back: [0] },
};

// Quadro do monstro conforme a direção: subindo = de costas (linha 2), senão caminhada de lado (linha 0).
function enemyFrame(e, sh) {
  const step = Math.floor(e.phase / 9);              // troca de quadro a cada ~9px andados
  const pose = ENEMY_POSE[e.type] || {};
  if ((e.vy || 0) < -Math.abs(e.vx || 0) && sh.rows[2] && !pose.noBack) {
    const back = pose.back ? pose.back.map(i => sh.rows[2][i]) : sh.rows[2].slice(1, -1);  // linha 2: [frente, costas..., morto]
    if (back.length) return { f: back[step % back.length], flip: false };
  }
  const walk = sh.rows[0];
  return { f: walk[step % walk.length], flip: e.dir < 0 };
}

function hpColor(frac) { return frac > 0.5 ? '#2ecc71' : frac > 0.25 ? '#f1c40f' : '#e74c3c'; }

function drawEnemy(c, e) {
  const def = ENEMIES[e.type], size = def.size, sh = SHEETS[e.type];
  c.save();
  c.translate(e.x, e.y);
  if (def.flying) {
    // voador: sombra pequena e clara no chão; o corpo flutua mais alto, subindo e descendo
    c.fillStyle = 'rgba(0,0,0,0.16)';
    c.beginPath(); c.ellipse(0, size * 0.42, size * 0.24, size * 0.07, 0, 0, TAU); c.fill();
    c.translate(0, -def.lift + Math.sin(G.time * 3 + e.id) * 2.5);
  } else {
    c.fillStyle = 'rgba(0,0,0,0.22)';
    c.beginPath(); c.ellipse(0, size * 0.42, size * 0.32, size * 0.1, 0, 0, TAU); c.fill();
  }
  if (sh && sh.ready) {
    const { f, flip } = enemyFrame(e, sh);
    const k = size / sh.rows[0][0].h;
    const bob = def.flying ? 0 : Math.abs(Math.sin(e.phase * 0.35)) * 1.2;
    const blit = () => c.drawImage(sh.img, f.x, f.y, f.w, f.h, -f.ax * k, size * 0.45 - f.ay * k - bob, f.w * k, f.h * k);
    c.save();
    if (flip) c.scale(-1, 1);
    blit();
    if (e.flash > 0) {                              // pisca branco ao levar golpe
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = Math.min(1, e.flash / 0.12) * 0.55;
      blit();
    }
    c.restore();
  } else {
    c.fillStyle = def.color; c.strokeStyle = shade(def.color, -0.4); c.lineWidth = 2;
    c.beginPath(); c.arc(0, 0, def.radius, 0, TAU); c.fill(); c.stroke();
  }
  // estados
  if (e.freezeT > 0) {
    c.fillStyle = 'rgba(190,230,255,0.45)'; c.strokeStyle = '#ecf8ff'; c.lineWidth = 1.5;
    c.beginPath(); c.ellipse(0, 0, size * 0.42, size * 0.5, 0, 0, TAU); c.fill(); c.stroke();
  } else if (e.slowT > 0 || e.auraSlow < 1) {
    c.strokeStyle = 'rgba(133,193,233,0.9)'; c.lineWidth = 2;
    c.beginPath(); c.ellipse(0, size * 0.42, size * 0.38, size * 0.13, 0, 0, TAU); c.stroke();
  }
  if (e.burnT > 0) {
    for (let k = 0; k < 3; k++) {
      const fx = (k - 1) * size * 0.18, fy = -size * 0.3 - Math.abs(Math.sin(G.time * 9 + k)) * 5;
      c.fillStyle = k % 2 ? '#f39c12' : '#e74c3c';
      c.beginPath(); c.arc(fx, fy, 2.5, 0, TAU); c.fill();
    }
  }
  // barra de vida
  const w = Math.max(22, size * 0.7), by = -size * 0.55 - 7, frac = Math.max(0, e.hp / e.maxHp);
  c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(-w / 2 - 1, by - 1, w + 2, 6);
  c.fillStyle = hpColor(frac); c.fillRect(-w / 2, by, w * frac, 4);
  c.restore();
}

function drawArcher(c, tiers, angle, recoil, s) {
  const dom = dominant(tiers);
  const bowCol = dom.tier >= 3 ? TOWERS.archer.paths[dom.p].color : '#6e4b2a';
  const big = s.kind === 'bolt';
  c.save();
  c.rotate(angle);
  c.fillStyle = '#1e8449'; c.strokeStyle = '#145a32'; c.lineWidth = 2;
  c.beginPath(); c.arc(-3, 0, 11, 0, TAU); c.fill(); c.stroke();
  c.fillStyle = '#7b5230'; c.fillRect(-15, -10, 9, 5);
  c.fillStyle = '#d0d3d4'; c.fillRect(-17, -11, 3, 2); c.fillRect(-17, -7, 3, 2);
  const br = big ? 15 : 12, ex = 4 + br * Math.cos(1.15), ey = br * Math.sin(1.15);
  const pull = (1 - recoil) * 6;
  c.strokeStyle = '#ecf0f1'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(ex, -ey); c.lineTo(ex - pull, 0); c.lineTo(ex, ey); c.stroke();
  c.strokeStyle = bowCol; c.lineWidth = big ? 4.5 : 3;
  c.beginPath(); c.arc(4, 0, br, -1.15, 1.15); c.stroke();
  if (recoil < 0.5) {
    c.strokeStyle = '#5d4037'; c.lineWidth = big ? 3 : 1.8;
    c.beginPath(); c.moveTo(ex - pull, 0); c.lineTo(4 + br + 3, 0); c.stroke();
  }
  c.fillStyle = '#f0c08a'; c.beginPath(); c.arc(-1, 0, 5.5, 0, TAU); c.fill();
  c.fillStyle = '#196f3d'; c.beginPath(); c.arc(-2, 0, 6.2, Math.PI * 0.5, Math.PI * 1.5); c.fill();
  c.restore();
}

function drawMage(c, tiers, angle, recoil, s) {
  const dom = dominant(tiers);
  const robe = dom.tier >= 3 ? ['#2471a3', '#a93226', '#5b2c6f'][dom.p] : '#6c3483';
  c.save();
  c.rotate(angle);
  const tip = 17 - recoil * 3;
  c.strokeStyle = '#5d4037'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(-2, 8); c.lineTo(tip, 8); c.stroke();
  c.fillStyle = s.projColor; c.globalAlpha = 0.35;
  c.beginPath(); c.arc(tip + 1, 8, 7 + recoil * 3, 0, TAU); c.fill();
  c.globalAlpha = 1;
  c.beginPath(); c.arc(tip + 1, 8, 3.5, 0, TAU); c.fill();
  c.fillStyle = robe; c.strokeStyle = shade(robe, -0.35); c.lineWidth = 2;
  c.beginPath(); c.arc(-2, 0, 11.5, 0, TAU); c.fill(); c.stroke();
  c.restore();
  // chapéu (não gira)
  c.fillStyle = shade(robe, -0.3);
  c.beginPath(); c.ellipse(0, -2, 11, 6, 0, 0, TAU); c.fill();
  c.fillStyle = robe; c.strokeStyle = shade(robe, -0.4); c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(-7, -3); c.lineTo(7, -3); c.lineTo(2, -23); c.closePath(); c.fill(); c.stroke();
  c.fillStyle = '#f7dc6f'; c.beginPath(); c.arc(1, -11, 1.8, 0, TAU); c.fill();
}

// ---------------------------------------------------------------------
//  Sprites desenhados (folhas em assets/, recortadas por tools/extract_sprites.py)
//  linha 0 = parado · linha 1 = ataque (virado p/ direita) · linha 2 = outros ângulos
// ---------------------------------------------------------------------
const CHAR_H = 46;                       // altura do personagem parado, em px do jogo
// Poses p/ alvo acima (up) ou abaixo (down), usando frames da linha 2:
//   idle = frame parado · atk = sequência de frames do golpe, ou 'side' = usa a animação de ataque de lado
//   swing = golpe de espada "encenado" (preparação → golpe → retorno + rastro de luz)
//   lunge = quantos px o corpo avança na direção do alvo durante o golpe
const SHEET_POSE = {
  archer: { up: { idle: 3, atk: [4] }, down: { idle: 0, atk: [0] } },
  mage:   { up: { idle: 3, atk: [4] }, down: { idle: 1, atk: [1] } },
  // de costas (20 fatias de 5%): espada à esquerda até o rastro chegar no topo (40%),
  // passa pelo centro e termina à direita; volta ao centro no fim
  knight: {
    up: { idle: 2, atk: [1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2], swing: true },
    down: { idle: 4, atk: 'side' }, lunge: 5,
  },
};
const HIT_AT = 0.4;   // em que ponto da animação o golpe corpo a corpo acerta (0→1)

function attackDur(rate) { return Math.min(0.45, rate * 0.85); }

// Movimento do golpe de costas: afunda/inclina p/ trás, estica e avança no golpe, depois volta.
function swingMotion(p) {
  const ease = x => 1 - (1 - x) * (1 - x);
  if (p < 0.28) {
    const w = p / 0.28;
    return { ty: 2 * w, rot: -0.07 * w, sy: 1 - 0.04 * w, strike: -1 };
  }
  if (p < 0.5) {
    const q = (p - 0.28) / 0.22, e = ease(q);
    return { ty: 2 - 9 * e, rot: -0.07 + 0.17 * e, sy: 0.96 + 0.08 * e, strike: q };
  }
  const r = ease((p - 0.5) / 0.5);
  return { ty: -7 * (1 - r), rot: 0.1 * (1 - r), sy: 1.04 - 0.04 * r, strike: 1 + r };
}

// Meia-lua de luz da espada passando por cima da cabeça, da esquerda p/ a direita.
// st: 0→1 = desenhando o arco · 1→2 = sumindo
function drawSwingArc(c, st, angle) {
  if (st < 0) return;
  const cy = -CHAR_H * 0.6, R = 27, N = 18;
  const a0 = Math.PI * 1.06, a1 = Math.PI * 1.94;
  const lead = a0 + (a1 - a0) * Math.min(1, st);
  const tail = Math.max(a0, lead - 1.6);
  const alpha = st <= 1 ? 1 : Math.max(0, 1 - (st - 1) * 1.8);
  if (alpha <= 0 || lead - tail < 0.05) return;
  c.save();
  c.translate(0, cy); c.rotate(angle + Math.PI / 2);
  c.globalAlpha *= alpha;
  const pts = (rad, thick) => {
    const out = [];
    for (let i = 0; i <= N; i++) {
      const a = tail + (lead - tail) * i / N, th = thick(i / N);
      out.push([Math.cos(a) * (rad - th), Math.sin(a) * (rad - th)]);
    }
    return out;
  };
  const outer = pts(R, () => 0), inner = pts(R, u => 1.5 + 10.5 * Math.pow(u, 1.3));
  const gx0 = Math.cos(tail) * R, gy0 = Math.sin(tail) * R, gx1 = Math.cos(lead) * R, gy1 = Math.sin(lead) * R;
  const grd = c.createLinearGradient(gx0, gy0, gx1, gy1);
  grd.addColorStop(0, 'rgba(150,210,255,0)');
  grd.addColorStop(0.45, 'rgba(175,225,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,1)');
  c.fillStyle = grd;
  c.beginPath();
  outer.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  for (let i = inner.length - 1; i >= 0; i--) c.lineTo(inner[i][0], inner[i][1]);
  c.closePath(); c.fill();
  // fio de luz na borda externa, mais forte na ponta
  c.strokeStyle = grd; c.lineWidth = 1.5;
  c.beginPath(); outer.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke();
  c.restore();
}
const SHEETS = {};
for (const [key, d] of Object.entries(typeof SPRITE_DATA !== 'undefined' ? SPRITE_DATA : {})) {
  const sh = { img: new Image(), rows: d.rows, ready: false, scale: CHAR_H / d.rows[0][0].h };
  sh.img.onload = () => { sh.ready = true; if (shopButtons.length) buildShop(); };
  sh.img.src = d.src;
  SHEETS[key] = sh;
}

// Folha a usar p/ o guardião: a da evolução de nível mais alto (empate → a última comprada), se tiver arte.
function skinKey(key, tiers, lastPath) {
  const paths = TOWERS[key].paths;
  let best = -1, bt = 0;
  paths.forEach((p, i) => {
    if (tiers[i] > bt || (tiers[i] === bt && bt > 0 && i === lastPath)) { bt = tiers[i]; best = i; }
  });
  const sk = best >= 0 ? paths[best].ups[bt - 1].sprite : null;
  return sk && SHEETS[sk] && SHEETS[sk].ready ? sk : key;
}

function sheetFrame(key, angle, atk, rate, seed, sk = key) {
  const sh = SHEETS[sk], pose = SHEET_POSE[key];
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const dur = attackDur(rate);
  const attacking = atk < dur;
  const prog = attacking ? atk / dur : 0;                       // 0→1 durante o golpe
  const step = n => Math.min(n - 1, Math.floor(prog * n));
  const dir = dy < -0.8 ? 'up' : dy > 0.8 ? 'down' : 'side';
  if (dir !== 'side') {
    const p = pose[dir];
    if (!(attacking && p.atk === 'side')) {
      const i = attacking ? p.atk[step(p.atk.length)] : p.idle;
      // de costas não espelha: a sequência já varre da esquerda p/ a direita
      return { f: sh.rows[2][i], flip: dir === 'up' && attacking ? false : dx < 0, attacking, prog, dir, swing: attacking && p.swing };
    }
  }
  const row = attacking ? sh.rows[1] : sh.rows[0];
  const i = attacking ? step(row.length) : Math.floor(performance.now() / 200 + seed) % row.length;
  return { f: row[i], flip: dx < 0, attacking, prog, dir, swing: false };
}

function drawSheetTower(c, key, tiers, angle, s, t) {
  const sk = skinKey(key, tiers, t ? t.lastPath : -1);
  const sh = SHEETS[sk], r = TOWERS[key].radius;
  const dom = dominant(tiers);
  // base de pedra em perspectiva
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.beginPath(); c.ellipse(0, 3, r * 1.25, r * 0.6, 0, 0, TAU); c.fill();
  c.fillStyle = '#a6acaf'; c.strokeStyle = '#626567'; c.lineWidth = 2;
  c.beginPath(); c.ellipse(0, 0, r + 2, (r + 2) * 0.55, 0, 0, TAU); c.fill(); c.stroke();
  // anel colorido ao chegar no nível 3 (ou no máximo, se o caminho for mais curto)
  if (dom.tier >= Math.min(3, TOWERS[key].paths[dom.p].ups.length)) {
    c.strokeStyle = TOWERS[key].paths[dom.p].color;
    c.lineWidth = dom.tier >= 5 ? 4 : dom.tier >= 4 ? 3 : 2;
    c.beginPath(); c.ellipse(0, 0, r + 6, (r + 6) * 0.55, 0, 0, TAU); c.stroke();
  }
  const { f, flip, attacking, prog, swing } = sheetFrame(key, angle, t ? t.atk : 99, s.rate, t ? t.id * 0.7 : 0, sk);
  const k = sh.scale * (1 + dom.tier * 0.03);
  const blit = (fr, dy = 0) => c.drawImage(sh.img, fr.x, fr.y, fr.w, fr.h, -fr.ax * k, -fr.ay * k + 4 + dy, fr.w * k, fr.h * k);
  c.save();
  let motion = null;
  if (swing) {
    // golpe de costas encenado: corpo inclina a partir dos pés, estica no golpe
    motion = swingMotion(prog);
    c.translate(0, motion.ty);
    c.rotate(motion.rot);
    c.scale(1 + (1 - motion.sy) * 0.5, motion.sy);
    // "fantasma" da pose de preparação logo no início do golpe (sensação de velocidade)
    if (motion.strike >= 0 && motion.strike < 0.8) {
      c.save(); c.globalAlpha *= 0.35 * (1 - motion.strike); blit(sh.rows[2][1], 3); c.restore();
    }
  } else if (attacking && SHEET_POSE[key].lunge) {
    // avanço do corpo na direção do alvo (vai e volta durante o golpe)
    const off = Math.sin(prog * Math.PI) * SHEET_POSE[key].lunge;
    c.translate(Math.cos(angle) * off, Math.sin(angle) * off * 0.7);
  }
  if (flip) c.scale(-1, 1);
  blit(f);
  if (motion) drawSwingArc(c, motion.strike, angle);
  // brilho do cristal (cor do caminho de evolução)
  if (f.gx != null) {
    const gx = (f.gx - f.ax) * k, gy = (f.gy - f.ay) * k + 4;
    const pulse = 0.55 + Math.sin(performance.now() / 260) * 0.15 + (attacking ? 0.35 : 0);
    const gr = (attacking ? 11 : 7) * (1 + dom.tier * 0.08);
    const grd = c.createRadialGradient(gx, gy, 0, gx, gy, gr);
    grd.addColorStop(0, `rgba(255,255,255,${Math.min(1, pulse)})`);
    grd.addColorStop(0.35, hexA(s.projColor, pulse * 0.8));
    grd.addColorStop(1, hexA(s.projColor, 0));
    c.fillStyle = grd;
    c.beginPath(); c.arc(gx, gy, gr, 0, TAU); c.fill();
  }
  c.restore();
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

function drawTowerSprite(c, key, tiers, angle, recoil, s, t = null) {
  if (SHEETS[key] && SHEETS[key].ready) return drawSheetTower(c, key, tiers, angle, s, t);
  const r = TOWERS[key].radius;
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.beginPath(); c.ellipse(0, r * 0.55, r * 1.1, r * 0.5, 0, 0, TAU); c.fill();
  c.fillStyle = '#a6acaf'; c.strokeStyle = '#626567'; c.lineWidth = 2;
  c.beginPath(); c.arc(0, 0, r + 2, 0, TAU); c.fill(); c.stroke();
  const dom = dominant(tiers);
  if (dom.tier >= 3) {
    c.strokeStyle = TOWERS[key].paths[dom.p].color;
    c.lineWidth = dom.tier >= 5 ? 4 : dom.tier >= 4 ? 3 : 2;
    c.beginPath(); c.arc(0, 0, r + 5, 0, TAU); c.stroke();
  }
  SPRITES[key](c, tiers, angle, recoil, s);
}

function drawStar(c, x, y, r, color, rot = 0) {
  c.save();
  c.translate(x, y); c.rotate(rot);
  c.fillStyle = color; c.strokeStyle = '#5d6d7e'; c.lineWidth = 1;
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const rr = i % 2 ? r * 0.35 : r, a = i * Math.PI / 4;
    i ? c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : c.moveTo(rr, 0);
  }
  c.closePath(); c.fill(); c.stroke();
  c.fillStyle = '#2c3e50'; c.beginPath(); c.arc(0, 0, r * 0.18, 0, TAU); c.fill();
  c.restore();
}

function drawNinja(c, tiers, angle, recoil, s) {
  const dom = dominant(tiers);
  const band = dom.tier >= 3 ? TOWERS.ninja.paths[dom.p].color : '#c0392b';
  const now = performance.now() / 1000;
  c.save();
  c.rotate(angle);
  // fitas da faixa
  c.strokeStyle = band; c.lineWidth = 2; c.lineCap = 'round';
  for (const k of [-1, 1]) {
    c.beginPath(); c.moveTo(-5, 0);
    c.quadraticCurveTo(-11, k * 3 + Math.sin(now * 8 + k) * 2, -16, k * 5 + Math.sin(now * 8 + k) * 3);
    c.stroke();
  }
  c.fillStyle = '#2c2f3a'; c.strokeStyle = '#15171d'; c.lineWidth = 2;
  c.beginPath(); c.arc(-2, 0, 11, 0, TAU); c.fill(); c.stroke();
  // braço + shuriken
  const reach = 12 - recoil * 4;
  c.strokeStyle = '#2c2f3a'; c.lineWidth = 4;
  c.beginPath(); c.moveTo(0, 6); c.lineTo(reach, 7); c.stroke();
  if (recoil < 0.6) drawStar(c, reach + 2, 7, 4.5, '#d5d8dc', now * 4);
  // cabeça
  c.fillStyle = '#1c1e25'; c.beginPath(); c.arc(0, 0, 6.5, 0, TAU); c.fill();
  c.strokeStyle = band; c.lineWidth = 2.2; c.beginPath(); c.arc(0, 0, 6.2, 0, TAU); c.stroke();
  c.fillStyle = '#f0c08a'; c.fillRect(2.5, -3.5, 3, 7);
  c.fillStyle = '#1c1e25'; c.fillRect(3.5, -2.5, 1.2, 1.6); c.fillRect(3.5, 1, 1.2, 1.6);
  c.restore();
}

function drawCannon(c, tiers, angle, recoil, s) {
  const dom = dominant(tiers);
  const missile = s.kind === 'missile';
  c.fillStyle = '#8d6e63'; c.strokeStyle = '#5d4037'; c.lineWidth = 2;
  c.beginPath(); c.arc(0, 0, 14, 0, TAU); c.fill(); c.stroke();
  c.strokeStyle = 'rgba(93,64,55,0.6)'; c.lineWidth = 1;
  for (const k of [-6, 0, 6]) { c.beginPath(); c.moveTo(k, -13); c.lineTo(k, 13); c.stroke(); }
  c.save();
  c.rotate(angle);
  const back = recoil * 5;
  const offs = s.projCount >= 3 ? [-7, 0, 7] : s.projCount === 2 ? [-5, 5] : [0];
  const bw = offs.length > 2 ? 5 : offs.length > 1 ? 6 : 9;
  for (const o of offs) {
    c.fillStyle = missile ? '#95a5a6' : '#34495e';
    c.fillRect(-3 - back, o - bw / 2, 21, bw);
    c.fillStyle = missile ? '#c0392b' : '#1b2631';
    c.fillRect(16 - back, o - bw / 2 - 1, 4, bw + 2);
  }
  c.fillStyle = '#2c3e50'; c.beginPath(); c.arc(-3, 0, 8, 0, TAU); c.fill();
  c.fillStyle = dom.tier >= 3 ? TOWERS.cannon.paths[dom.p].color : '#f39c12';
  c.beginPath(); c.arc(-3, 0, 3, 0, TAU); c.fill();
  c.restore();
}

function drawBard(c, tiers, angle, recoil, s) {
  const dom = dominant(tiers);
  const cloak = dom.tier >= 3 ? ['#b7950b', '#1e8449', '#922b21'][dom.p] : '#16a085';
  const now = performance.now() / 1000;
  c.save();
  c.rotate(angle);
  c.fillStyle = cloak; c.strokeStyle = shade(cloak, -0.4); c.lineWidth = 2;
  c.beginPath(); c.arc(-2, 0, 11, 0, TAU); c.fill(); c.stroke();
  // alaúde
  c.strokeStyle = '#6e4b2a'; c.lineWidth = 2.5;
  c.beginPath(); c.moveTo(8, 4); c.lineTo(17, -2); c.stroke();
  c.fillStyle = '#b9770e'; c.strokeStyle = '#6e4b2a'; c.lineWidth = 1.5;
  c.beginPath(); c.ellipse(7, 5, 6 + recoil * 1.5, 4.5 + recoil, -0.6, 0, TAU); c.fill(); c.stroke();
  c.fillStyle = '#4a2f17'; c.beginPath(); c.arc(7.5, 4.5, 1.5, 0, TAU); c.fill();
  c.restore();
  // cabeça e chapéu com pena
  c.fillStyle = '#f0c08a'; c.beginPath(); c.arc(0, 0, 5.5, 0, TAU); c.fill();
  c.fillStyle = '#7d3c98'; c.beginPath(); c.ellipse(0, -3, 8.5, 4.5, 0, 0, TAU); c.fill();
  c.strokeStyle = '#f7dc6f'; c.lineWidth = 2.5; c.lineCap = 'round';
  c.beginPath(); c.moveTo(3, -5); c.quadraticCurveTo(9, -12, 14, -11); c.stroke();
  // notas musicais flutuando
  if (s.buff) {
    c.save();
    c.fillStyle = '#f7dc6f'; c.font = 'bold 11px Segoe UI, sans-serif'; c.textAlign = 'center';
    c.globalAlpha *= 0.6 + Math.sin(now * 3) * 0.3;
    c.fillText('♪', -11, -12 - Math.sin(now * 2) * 3);
    c.restore();
  }
}

// Cavaleiro só tem arte desenhada; enquanto a imagem carrega, mostra um escudo simples.
function drawKnightFallback(c) {
  c.fillStyle = '#95a5a6'; c.strokeStyle = '#2c3e50'; c.lineWidth = 2;
  c.beginPath(); c.arc(0, 0, 11, 0, TAU); c.fill(); c.stroke();
  c.fillStyle = '#f4d03f'; c.fillRect(-2, -8, 4, 16); c.fillRect(-7, -2, 14, 4);
}

const SPRITES = { archer: drawArcher, mage: drawMage, knight: drawKnightFallback, ninja: drawNinja, cannon: drawCannon, bard: drawBard };

function drawProjectile(c, p) {
  const a = Math.atan2(p.vy, p.vx), k = p.s.kind;
  c.save();
  c.translate(p.x, p.y);
  c.rotate(a);
  if (p.s.isCrit) {
    c.fillStyle = 'rgba(255,60,60,0.45)';
    c.beginPath(); c.arc(0, 0, 9, 0, TAU); c.fill();
  }
  if (k === 'shuriken') {
    drawStar(c, 0, 0, p.s.isCrit ? 7 : 5.5, p.s.isCrit ? '#ff6b6b' : p.s.projColor, G.time * 25);
  } else if (k === 'cannonball') {
    c.fillStyle = '#1b2631'; c.beginPath(); c.arc(0, 0, 5.5, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.5)'; c.beginPath(); c.arc(-1.8, -1.8, 1.8, 0, TAU); c.fill();
  } else if (k === 'missile') {
    c.fillStyle = '#f39c12'; c.beginPath(); c.moveTo(-7, -2.5); c.lineTo(-13 - Math.random() * 4, 0); c.lineTo(-7, 2.5); c.fill();
    c.fillStyle = '#bdc3c7'; c.fillRect(-7, -2.5, 11, 5);
    c.fillStyle = '#c0392b'; c.beginPath(); c.moveTo(4, -2.5); c.lineTo(8, 0); c.lineTo(4, 2.5); c.fill();
  } else if (k === 'frag') {
    c.fillStyle = '#4d5656'; c.fillRect(-3, -1.5, 6, 3);
  } else if (k === 'orb' || k === 'meteor') {
    const r = k === 'meteor' ? 8 : 5;
    c.fillStyle = p.s.projColor; c.globalAlpha = 0.35;
    c.beginPath(); c.arc(0, 0, r * 1.8, 0, TAU); c.fill();
    c.globalAlpha = 1;
    c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.8)'; c.beginPath(); c.arc(-r * 0.3, -r * 0.3, r * 0.35, 0, TAU); c.fill();
  } else {
    const len = k === 'bolt' ? 20 : 13;
    c.strokeStyle = k === 'bolt' ? '#4e342e' : '#6d4c41'; c.lineWidth = k === 'bolt' ? 3.5 : 2;
    c.beginPath(); c.moveTo(-len, 0); c.lineTo(0, 0); c.stroke();
    c.fillStyle = k === 'bomb' ? '#e67e22' : '#d5d8dc';
    c.beginPath(); c.moveTo(4, 0); c.lineTo(-3, -3); c.lineTo(-3, 3); c.closePath(); c.fill();
    c.strokeStyle = '#ecf0f1'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(-len, 0); c.lineTo(-len - 3, -3); c.moveTo(-len, 0); c.lineTo(-len - 3, 3); c.stroke();
  }
  c.restore();
}

function drawEffects(c) {
  for (const f of G.effects) {
    const k = f.t / f.ttl;
    c.globalAlpha = Math.max(0, 1 - k);
    switch (f.type) {
      case 'corpse': {
        // monstro caído (último quadro da linha 2) sumindo aos poucos
        const sh = SHEETS[f.key], def = ENEMIES[f.key];
        if (!sh || !sh.ready) break;
        const last = sh.rows[sh.rows.length - 1];
        const fr = last[last.length - 1], kk = def.size / sh.rows[0][0].h;
        c.save();
        c.globalAlpha = Math.max(0, 1 - k * k);
        c.translate(f.x, f.y);
        if (f.flip) c.scale(-1, 1);
        c.drawImage(sh.img, fr.x, fr.y, fr.w, fr.h, -fr.w * kk / 2, def.size * 0.45 - fr.h * kk, fr.w * kk, fr.h * kk);
        c.restore();
        break;
      }
      case 'splat':
        c.fillStyle = f.color;
        for (const d of f.drops) { c.beginPath(); c.arc(f.x + d.vx * f.t, f.y + d.vy * f.t, f.r * (1 - k * 0.5), 0, TAU); c.fill(); }
        break;
      case 'ring':
        c.strokeStyle = f.color; c.lineWidth = 3;
        c.beginPath(); c.arc(f.x, f.y, f.r * (0.3 + 0.7 * k), 0, TAU); c.stroke();
        break;
      case 'blast':
        c.fillStyle = f.color; c.globalAlpha *= 0.35;
        c.beginPath(); c.arc(f.x, f.y, f.r * (0.5 + 0.5 * k), 0, TAU); c.fill();
        c.globalAlpha = Math.max(0, 1 - k); c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
        break;
      case 'clink': {
        const s = 3 + k * 6;
        c.strokeStyle = '#fff'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(f.x - s, f.y - s); c.lineTo(f.x + s, f.y + s); c.moveTo(f.x + s, f.y - s); c.lineTo(f.x - s, f.y + s); c.stroke();
        break;
      }
      case 'slash': {
        // corte em arco atravessando o alvo
        const a0 = f.a - 1.1 + k * 0.6, a1 = f.a + 0.2 + k * 0.9;
        c.lineCap = 'round';
        for (const [w, col] of [[6, f.color], [2, '#fff']]) {
          c.strokeStyle = col; c.lineWidth = w * (1 - k * 0.5);
          c.beginPath(); c.arc(f.x - Math.cos(f.a) * f.r * 0.6, f.y - Math.sin(f.a) * f.r * 0.6, f.r, a0, a1); c.stroke();
        }
        break;
      }
      case 'text':
        c.font = 'bold 14px Segoe UI, sans-serif'; c.textAlign = 'center';
        c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.6)';
        c.strokeText(f.text, f.x, f.y - 30 * k); c.fillStyle = f.color; c.fillText(f.text, f.x, f.y - 30 * k);
        break;
      case 'bolt':
        c.lineJoin = 'round';
        for (const [w, col] of [[5, f.color], [1.5, '#fff']]) {
          c.strokeStyle = col; c.lineWidth = w;
          c.beginPath(); f.pts.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.stroke();
        }
        break;
    }
  }
  c.globalAlpha = 1;
}

function render() {
  ctx.setTransform(RS, 0, 0, RS, 0, 0);       // tudo abaixo continua em unidades do jogo (960×640)
  ctx.imageSmoothingQuality = 'high';          // reduz os sprites grandes com suavização de qualidade
  ctx.drawImage(bg, 0, 0, W, H);
  for (const t of G.towers) {
    if (!t.s.aura) continue;
    ctx.fillStyle = `rgba(133,193,233,${0.08 + Math.sin(G.time * 3) * 0.03})`;
    ctx.beginPath(); ctx.arc(t.x, t.y, t.s.range, 0, TAU); ctx.fill();
  }
  if (G.selected) drawRange(G.selected.x, G.selected.y, G.selected.s.range, true);
  for (const e of G.enemies.slice().sort((a, b) => a.y - b.y)) drawEnemy(ctx, e);
  for (const t of G.towers.slice().sort((a, b) => a.y - b.y)) {
    ctx.save(); ctx.translate(t.x, t.y);
    drawTowerSprite(ctx, t.key, t.tiers, t.angle, t.recoil, t.s, t);
    if (t.buffed) {
      const ny = SHEETS[t.key] && SHEETS[t.key].ready ? -CHAR_H + 4 : -12;
      ctx.fillStyle = '#f7dc6f'; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2;
      ctx.font = 'bold 11px Segoe UI, sans-serif'; ctx.textAlign = 'center';
      ctx.strokeText('♪', 14, ny); ctx.fillText('♪', 14, ny);
    }
    ctx.restore();
  }
  if (G.selected) {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(G.selected.x, G.selected.y, TOWERS[G.selected.key].radius + 8, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const p of G.projectiles) drawProjectile(ctx, p);
  drawEffects(ctx);
  if (G.placing && mouse.in) {
    const ok = canPlace(G.placing, mouse.x, mouse.y) && G.money >= TOWERS[G.placing].cost;
    drawRange(mouse.x, mouse.y, computeStats(G.placing, [0, 0, 0]).range, ok);
    ctx.save(); ctx.globalAlpha = 0.75; ctx.translate(mouse.x, mouse.y);
    drawTowerSprite(ctx, G.placing, [0, 0, 0], SHEETS[G.placing] ? 0 : -Math.PI / 2, 0, computeStats(G.placing, [0, 0, 0]));
    ctx.restore();
  }
  if (G.paused) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 42px Segoe UI, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('PAUSADO', W / 2, H / 2);
  }
}

// ---------------------------------------------------------------------
//  Interface
// ---------------------------------------------------------------------
const uiCache = {};
let shopButtons = [];

function setText(id, v) {
  if (uiCache[id] !== v) { uiCache[id] = v; $(id).textContent = v; }
}

// Ordem da loja (e dos atalhos 1, 2, 3…): mais barato primeiro, "Em breve" no fim.
function shopOrder() {
  return Object.keys(TOWERS).sort((a, b) =>
    (!!TOWERS[a].soon - !!TOWERS[b].soon) || TOWERS[a].cost - TOWERS[b].cost);
}

function buildShop() {
  const shop = $('shop');
  shop.innerHTML = '';
  shopOrder().map(k => [k, TOWERS[k]]).forEach(([key, def], i) => {
    const b = document.createElement('button');
    b.className = 'tower-btn';
    b.dataset.key = key;
    const ic = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;       // ícone na resolução real da tela
    ic.width = ic.height = Math.round(56 * dpr);
    const c = ic.getContext('2d');
    c.scale(dpr, dpr);
    c.imageSmoothingQuality = 'high';
    const drawn = SHEETS[key] && SHEETS[key].ready;
    c.translate(28, drawn ? 50 : 32);
    drawTowerSprite(c, key, [0, 0, 0], drawn ? 0 : -Math.PI / 2, 0, computeStats(key, [0, 0, 0]));
    b.appendChild(ic);
    if (def.soon) b.classList.add('soon');
    b.insertAdjacentHTML('beforeend', `<b>${def.name}</b>` +
      (def.soon ? '<span class="cost">Em breve</span>' : `<span class="cost">$${fmt(def.cost)}</span><kbd>${i + 1}</kbd>`));
    b.addEventListener('click', () => startPlacing(key));
    b.addEventListener('mouseenter', () => { shopHover = key; });
    b.addEventListener('mouseleave', () => { shopHover = null; });
    shop.appendChild(b);
  });
  shopButtons = [...shop.querySelectorAll('.tower-btn')];
}
let shopHover = null;

function shopDescText() {
  const key = shopHover || G.placing;
  if (!key) return 'Passe o mouse num guardião para ver o que ele faz. Clique num guardião no mapa para evoluir.';
  if (TOWERS[key].soon) return `${TOWERS[key].name}: em breve!`;
  if (!shopHover) return `${TOWERS[key].name}: clique no mapa para posicionar · Shift+clique coloca vários · Esc cancela`;
  return `${TOWERS[key].name}: ${TOWERS[key].desc}`;
}

// ---------------------------------------------------------------------
//  Janela de evoluções: arrasta pelo título, redimensiona pelas bordas/cantos,
//  lembra posição e tamanho (localStorage) entre aberturas e partidas.
// ---------------------------------------------------------------------
const popup = (() => {
  const el = $('upgradePopup'), KEY = 'gdv.popup';
  const MIN_W = 240, MIN_H = 180;
  let rect = null;            // {x, y, w, h} — h null = altura automática (até o usuário redimensionar)
  let visible = false;

  try { rect = JSON.parse(localStorage.getItem(KEY)); } catch (e) { rect = null; }

  function defaultRect() {
    // primeira vez: encostada no lado direito do mapa
    const c = cv.getBoundingClientRect();
    const w = 320;
    return { x: Math.max(8, c.right - w - 16), y: c.top + 60, w, h: null };
  }

  function clamp() {
    const vw = innerWidth, vh = innerHeight;
    rect.w = Math.max(MIN_W, Math.min(rect.w, vw - 16));
    if (rect.h != null) rect.h = Math.max(MIN_H, Math.min(rect.h, vh - 16));
    const h = rect.h != null ? rect.h : el.offsetHeight || 300;
    rect.x = Math.min(Math.max(8 - rect.w + 80, rect.x), vw - 80);   // sempre sobra um pedaço visível p/ pegar
    rect.y = Math.min(Math.max(0, rect.y), vh - 40);
    return h;
  }

  function apply() {
    clamp();
    el.style.left = rect.x + 'px';
    el.style.top = rect.y + 'px';
    el.style.width = rect.w + 'px';
    el.style.height = rect.h != null ? rect.h + 'px' : '';
    el.style.maxHeight = rect.h != null ? '' : (innerHeight - rect.y - 8) + 'px';
  }

  function save() { localStorage.setItem(KEY, JSON.stringify(rect)); }

  // ao abrir: garante a janela inteira na tela (a posição salva pode ser de uma tela maior)
  function fitInside() {
    const w = el.offsetWidth, h = el.offsetHeight;
    rect.x = Math.max(8, Math.min(rect.x, innerWidth - w - 8));
    rect.y = Math.max(8, Math.min(rect.y, innerHeight - h - 8));
    apply();
  }

  function show(on) {
    if (on === visible) return;
    visible = on;
    el.classList.toggle('hidden', !on);
    if (on) { if (!rect) rect = defaultRect(); apply(); fitInside(); }
  }

  // arrastar pelo título
  const head = el.querySelector('.popup-head');
  head.addEventListener('pointerdown', ev => {
    if (ev.target.closest('button')) return;
    ev.preventDefault();
    head.setPointerCapture(ev.pointerId);
    const sx = ev.clientX - rect.x, sy = ev.clientY - rect.y;
    const move = e => { rect.x = e.clientX - sx; rect.y = e.clientY - sy; apply(); };
    // aplica também a posição final do "soltar" (o último movimento pode vir só nele)
    const up = e => { move(e); head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); save(); };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
  });

  // redimensionar pelas 4 bordas e 4 cantos
  for (const h of el.querySelectorAll('.rz')) {
    h.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      h.setPointerCapture(ev.pointerId);
      const dir = h.dataset.dir, start = { ...rect, h: rect.h != null ? rect.h : el.offsetHeight }, mx = ev.clientX, my = ev.clientY;
      const move = e => {
        const dx = e.clientX - mx, dy = e.clientY - my;
        let { x, y, w, h: hh } = start;
        if (dir.includes('e')) w = start.w + dx;
        if (dir.includes('s')) hh = start.h + dy;
        if (dir.includes('w')) { w = start.w - dx; x = start.x + dx; }
        if (dir.includes('n')) { hh = start.h - dy; y = start.y + dy; }
        // não deixa encolher abaixo do mínimo "empurrando" a janela
        if (w < MIN_W) { if (dir.includes('w')) x -= MIN_W - w; w = MIN_W; }
        if (hh < MIN_H) { if (dir.includes('n')) y -= MIN_H - hh; hh = MIN_H; }
        rect = { x, y, w, h: hh };
        apply();
      };
      const up = e => { move(e); h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); save(); };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
    });
  }

  $('popClose').addEventListener('click', () => { G.selected = null; });
  addEventListener('resize', () => { if (visible) { apply(); fitInside(); } });

  return { show, reset() { rect = null; localStorage.removeItem(KEY); if (visible) { rect = defaultRect(); apply(); } } };
})();

function panelHTML() {
  const t = G.selected;
  if (!t) return '';
  const def = TOWERS[t.key];
  let h = `<div class="ptitle"><span>${def.name}</span><span class="tiers">${t.tiers.join('-')}</span></div>
    <div class="prow"><span>Abates: <b id="pops">0</b></span>
    <button class="mode" data-act="mode" title="Tab">🎯 ${MODE_LABEL[t.mode]}</button></div>`;
  const extras = [];
  if (t.s.income) extras.push(`💰 Renda: $${fmt(t.s.income)} por onda`);
  if (t.s.buff) extras.push(`🎵 Próximos: ${buffText(t.s.buff)}`);
  if (t.buffed) extras.push('🎵 Fortalecido por um Bardo');
  if (!t.s.attack) extras.push('🕊️ Não ataca');
  if (extras.length) h += `<div class="extras">${extras.map(x => `<div>${x}</div>`).join('')}</div>`;
  def.paths.forEach((path, p) => {
    const st = upgradeState(t, p);
    const pips = path.ups.map((u, i) => `<i class="${i < t.tiers[p] ? 'on' : ''}" title="${u.name}"></i>`).join('');
    let btn;
    if (st.status === 'max') btn = `<div class="up max">✨ Nível máximo</div>`;
    else if (st.status === 'locked') btn = `<div class="up locked">🔒 ${st.why}</div>`;
    else btn = `<button class="up ${st.status}" data-act="up" data-p="${p}">
        <span class="un">${st.up.name}</span><span class="uc">$${fmt(st.up.cost)}</span>
        <span class="ud">${st.up.desc}</span></button>`;
    h += `<div class="path" style="--c:${path.color}"><div class="phead"><span class="pname">${path.name}</span>
      <span class="pips">${pips}</span><kbd>${',./'[p]}</kbd></div>${btn}</div>`;
  });
  h += `<button class="sell" data-act="sell">Vender por $${fmt(sellValue(t))}</button>`;
  return h;
}

function updateUI() {
  setText('lives', fmt(G.lives));
  setText('money', fmt(G.money));
  const n = G.wave + 1;
  setText('wave', G.wave >= WAVES.length ? `${n} (livre)` : `${n}/${WAVES.length}`);
  for (const b of shopButtons) {
    const k = b.dataset.key;
    b.classList.toggle('poor', !TOWERS[k].soon && G.money < TOWERS[k].cost);
    b.classList.toggle('active', G.placing === k);
  }
  setText('shopDesc', shopDescText());
  const html = panelHTML();
  if (html !== uiCache.panel) { uiCache.panel = html; $('panel').innerHTML = html; }
  popup.show(!!G.selected);
  const pops = $('pops');
  if (pops && G.selected) pops.textContent = fmt(G.selected.pops);
  const play = $('btnPlay');
  play.disabled = G.state !== 'build';
  setText('btnPlay', G.state === 'build' ? `▶ Iniciar onda ${n}` : G.state === 'wave' ? 'Onda em andamento…' : '—');
  setText('btnSpeed', `⏩ ${G.speed}×`);
  setText('btnPause', G.paused ? '▶ Continuar' : '⏸ Pausar');
}

function startPlacing(key) {
  if (G.state === 'over' || G.state === 'victory') return;
  if (TOWERS[key].soon) { toast(`${TOWERS[key].name}: em breve!`); return; }
  G.placing = G.placing === key ? null : key;
  G.selected = null;
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

function showOverlay(title, text, buttons) {
  $('ovTitle').textContent = title;
  $('ovText').textContent = text;
  const box = $('ovBtns');
  box.innerHTML = '';
  for (const [label, fn] of buttons) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', fn);
    box.appendChild(b);
  }
  $('overlay').classList.remove('hidden');
}
function hideOverlay() { $('overlay').classList.add('hidden'); }

function gameOver() {
  G.state = 'over';
  G.placing = null;
  showOverlay('Os monstros invadiram o vale!', `Você resistiu até a onda ${G.wave + 1}.`, [['Tentar de novo', newGame]]);
}

function victory() {
  G.state = 'victory';
  G.placing = null;
  showOverlay('Vitória! 🎉', `O vale resistiu às ${WAVES.length} ondas com ${fmt(G.lives)} vidas sobrando.`, [
    ['Continuar no modo livre', () => { G.freeplay = true; G.state = 'build'; hideOverlay(); }],
    ['Jogar de novo', newGame],
  ]);
}

// ---------------------------------------------------------------------
//  Entrada
// ---------------------------------------------------------------------
function toGame(ev) {
  const r = cv.getBoundingClientRect();
  return { x: (ev.clientX - r.left) * W / r.width, y: (ev.clientY - r.top) * H / r.height };
}

cv.addEventListener('mousemove', ev => { Object.assign(mouse, toGame(ev), { in: true }); });
cv.addEventListener('mouseleave', () => { mouse.in = false; });
cv.addEventListener('contextmenu', ev => ev.preventDefault());
cv.addEventListener('mousedown', ev => {
  const p = toGame(ev);
  if (ev.button === 2) { G.placing = null; return; }
  if (G.placing) {
    const key = G.placing;
    const t = placeTower(key, p.x, p.y);
    if (!t) { addText(p.x, p.y, G.money < TOWERS[key].cost ? 'Sem dinheiro' : 'Não pode aqui', '#ff8a80'); return; }
    if (!ev.shiftKey || G.money < TOWERS[key].cost) { G.placing = null; G.selected = t; }
    return;
  }
  G.selected = towerAt(p.x, p.y);
});

$('panel').addEventListener('pointerdown', ev => {
  const b = ev.target.closest('[data-act]');
  if (!b || !G.selected) return;
  ev.preventDefault();
  const t = G.selected;
  if (b.dataset.act === 'up') buyUpgrade(t, +b.dataset.p);
  else if (b.dataset.act === 'sell') sellTower(t);
  else if (b.dataset.act === 'mode') t.mode = MODES[(MODES.indexOf(t.mode) + 1) % MODES.length];
});

$('btnPlay').addEventListener('click', startWave);
$('btnSpeed').addEventListener('click', () => { G.speed = G.speed >= 3 ? 1 : G.speed + 1; });
$('btnPause').addEventListener('click', () => { G.paused = !G.paused; });
$('chkAuto').addEventListener('change', ev => { G.auto = ev.target.checked; if (G.auto) startWave(); });
document.addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) b.blur(); });

addEventListener('keydown', ev => {
  if (ev.target.tagName === 'INPUT') return;
  const k = ev.key, keys = shopOrder();
  if (k >= '1' && k <= '9' && keys[+k - 1]) startPlacing(keys[+k - 1]);
  else if (k === 'Escape') { G.placing = null; G.selected = null; }
  else if (k === ' ') { ev.preventDefault(); startWave(); }
  else if (k === 'p' || k === 'P') G.paused = !G.paused;
  else if (k === 'f' || k === 'F') G.speed = G.speed >= 3 ? 1 : G.speed + 1;
  else if (G.selected && ',./'.includes(k)) { ev.preventDefault(); buyUpgrade(G.selected, ',./'.indexOf(k)); }
  else if (G.selected && (k === 'Delete' || k === 'Backspace')) sellTower(G.selected);
  else if (G.selected && k === 'Tab') { ev.preventDefault(); G.selected.mode = MODES[(MODES.indexOf(G.selected.mode) + 1) % MODES.length]; }
});

// ---------------------------------------------------------------------
//  Loop
// ---------------------------------------------------------------------
let last = performance.now(), acc = 0;
function frame(now) {
  const el = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!G.paused && (G.state === 'build' || G.state === 'wave')) {
    acc += el * G.speed;
    let n = 0;
    while (acc >= DT && n < 30) { step(DT); acc -= DT; n++; }
    if (n >= 30) acc = 0;
  }
  render();
  updateUI();
  requestAnimationFrame(frame);
}

buildShop();
newGame();
requestAnimationFrame(frame);
