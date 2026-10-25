// Relatório de balanceamento por onda (node tools/wave_report.js)
// Lê js/data.js e mostra, por onda: monstros, vida total (terrestre/voadora), ouro ganho e acumulado.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8');
const { CONFIG, ENEMIES, WAVES } = new Function(src + '; return { CONFIG, ENEMIES, WAVES };')();

const reward = d => d.reward ?? CONFIG.killReward(d.hp);
let money = CONFIG.startMoney;
const rows = [];
WAVES.forEach((w, i) => {
  let n = 0, hpG = 0, hpA = 0, gold = 0, dur = 0;
  for (const g of w) {
    const d = ENEMIES[g.type], hp = Math.round(d.hp * (g.hpMul || 1));
    n += g.count;
    if (d.flying) hpA += hp * g.count; else hpG += hp * g.count;
    gold += reward(d) * g.count;
    dur = Math.max(dur, g.delay + g.gap * (g.count - 1));
  }
  const bonus = CONFIG.waveBonus(i + 1);
  money += gold + bonus;
  rows.push({
    onda: i + 1, monstros: n, vidaTerra: hpG, vidaAr: hpA, vidaTotal: hpG + hpA,
    'vida/s': +((hpG + hpA) / Math.max(dur, 1)).toFixed(1),
    ouroAbates: gold, bonus, ganhoOnda: gold + bonus, acumulado: money,
    'ouro/vida': +((gold + bonus) / (hpG + hpA)).toFixed(2),
  });
});
console.table(rows);
