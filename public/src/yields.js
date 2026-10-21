// Знак STOP для игрока: проехал линию знака по ходу, не остановившись перед ней, — штраф (КоАП 12.16 ч.1, money.js).
// Камеры не нужны — как в жизни, ловит инспектор (у красного — только камеры, signals.js). Знаки и их линии —
// World.yields; трафик у них останавливается и уступает сам (traffic.js).
const STOPPED = 1.5;  // м/с: медленнее — считается остановкой
const STOP_NEAR = 20; // м: остановка не дальше стольких до линии
const COOLDOWN = 15;  // с: один знак штрафует не чаще

export class StopSigns {
  constructor(world) {
    this.world = world;
    this.prev = null;
    this.stopAt = null; // где игрок в последний раз стоял
    this.fined = new Map();
    this.time = 0;
  }

  // Раз в кадр. Возвращает знак, если игрок проехал STOP без остановки, иначе null.
  checkPlayer(car, dt) {
    this.time += dt;
    const px = car.pos.x, pz = car.pos.y, prev = this.prev;
    this.prev = [px, pz];
    if (!car.air && Math.abs(car.speed) < STOPPED) this.stopAt = [px, pz];
    if (!prev || car.air) return null;
    const f = car.forward;
    for (const y of this.world.yields) {
      if (y.s !== 's' || Math.abs(y.x - px) > 40 || Math.abs(y.z - pz) > 40 || f.x * y.ux + f.y * y.uz < 0.6) continue;
      const along = (px - y.x) * y.ux + (pz - y.z) * y.uz, before = (prev[0] - y.x) * y.ux + (prev[1] - y.z) * y.uz;
      if (!(before < 0 && along >= 0 && before > -10)) continue;
      const lat = -(px - y.x) * y.uz + (pz - y.z) * y.ux; // вправо от оси, как у светофоров
      if (y.ow ? Math.abs(lat) > y.w / 2 + 1.5 : lat < -0.8 || lat > y.w / 2 + 1.5) continue;
      const s = this.stopAt;
      this.stopAt = null;
      if (s && Math.hypot(s[0] - y.x, s[1] - y.z) < STOP_NEAR && (s[0] - y.x) * y.ux + (s[1] - y.z) * y.uz < 0.5) return null;
      if (this.time - (this.fined.get(y) ?? -99) < COOLDOWN) return null;
      this.fined.set(y, this.time);
      return y;
    }
    return null;
  }
}
