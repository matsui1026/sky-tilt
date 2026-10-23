// 射撃モードの交戦確認: 簡易オートパイロットで最寄りの敵を追い、撃つ
import { Simulation } from '../src/sim/sim.js';
import { vsub, vnorm, vdot, qrot, qrotInv, FWD } from '../src/sim/math.js';

const sim = new Simulation();
for (const id of ['fighter', 'prop', 'heli', 'drone', 'flycar']) {
  sim.load(id, 'island', { mode: 'combat', calm: true });
  let minDist = 1e9, enemyShots = 0, fired = 0;
  for (let i = 0; i < 60 * 90 && sim.getState().status === 'flying'; i++) {
    const c = sim.combat;
    const vs = sim.vs;
    const alive = c.enemies.filter((e) => e.alive);
    const tgt = alive.sort((a, b) => Math.hypot(a.pos.x - vs.pos.x, a.pos.z - vs.pos.z) - Math.hypot(b.pos.x - vs.pos.x, b.pos.z - vs.pos.z))[0];
    if (tgt) {
      const to = vsub(tgt.pos, vs.pos);
      const d = Math.hypot(to.x, to.y, to.z);
      minDist = Math.min(minDist, d);
      const local = qrotInv(vs.q, vnorm(to)); // 機体座標
      const fwd = -local.z;
      if (sim.def.model === 'fixedwing') {
        sim.setInput({ roll: Math.max(-1, Math.min(1, local.x * 3)), pitch: Math.max(-1, Math.min(1, local.y * 4 + 0.1)), throttle: 0.9, fire: fwd > 0.995 && d < 900 });
      } else {
        // 回転翼など: 機首を敵へ（ヨー）、高度を合わせ、前進
        const yaw = Math.max(-1, Math.min(1, local.x * 4));
        const thr = sim.getState().throttleCmd;
        sim.setInput({ yaw, pitch: d > 120 ? -0.3 : 0.1, throttle: Math.max(0, Math.min(1, thr + (to.y > 0 ? 0.004 : -0.004))), fire: fwd > 0.98 && d < 500 });
      }
      if (sim.ctl.fire) fired++;
    }
    sim.step(1);
    enemyShots = Math.max(enemyShots, c.bullets.filter((b) => b.owner === 'enemy').length);
  }
  const st = sim.getState();
  console.log(id, 'status', st.status, st.crashCause || '', 'health', st.combat.health, 'kills', st.combat.kills, 'wave', st.combat.wave, 'shots', st.combat.shots, 'hits', st.combat.hits, 'minDist', Math.round(minDist), 'enemyBulletsMax', enemyShots, 'score', st.combat.score);
}
void qrot; void FWD; void vdot;
