// Приборы на компьютере: тахометр (обороты — как у звука мотора, audio.js) с передачей посередине и под ним —
// крупный указатель бензина E…F. На телефоне — только полоски под скоростью (места мало).
import { engineTarget, MAX_RPM } from './audio.js';

const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25; // дуга тахометра: от 7:30 до 4:30 по часам
const RED = 5500;           // об/мин: красная зона
const F0 = Math.PI * 0.82, F1 = Math.PI * 0.18; // дуга бензина внизу (в просвете тахометра): E слева, F справа

export class Gauges {
  constructor(canvas) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.rpm = 900;
    this.gear = 1;
  }

  update(dt, car, input) {
    const kmh = Math.abs(car.speed) * 3.6;
    const { rpm, gear } = engineTarget(kmh, car.fuel > 0 && (input.up || input.down) ? 1 : 0);
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * 9);
    this.gear = car.speed < -0.5 ? 'R' : kmh < 2 && !input.up ? 'N' : gear;
    this.#draw(car);
  }

  #draw(car) {
    const cv = this.cv, g = this.g, dpr = Math.min(devicePixelRatio, 2);
    const S = cv.clientWidth;
    if (!S) return; // скрыт (телефон, гараж)
    if (cv.width !== Math.round(S * dpr)) cv.width = cv.height = Math.round(S * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    const c = S / 2, R = c - 6;
    // Циферблат.
    g.fillStyle = 'rgba(10,12,14,.55)';
    g.beginPath(); g.arc(c, c, R + 4, 0, 7); g.fill();
    const ang = (v) => A0 + (A1 - A0) * Math.min(1, v / (MAX_RPM + 600));
    g.lineCap = 'butt';
    g.lineWidth = 7;
    g.strokeStyle = 'rgba(255,255,255,.18)';
    g.beginPath(); g.arc(c, c, R - 4, A0, A1); g.stroke();
    g.strokeStyle = '#e0261b';
    g.beginPath(); g.arc(c, c, R - 4, ang(RED), A1); g.stroke();
    // Обороты — заливка дуги до текущих.
    g.strokeStyle = this.rpm > RED ? '#ff5a3c' : '#ffd23f';
    g.beginPath(); g.arc(c, c, R - 4, A0, ang(this.rpm)); g.stroke();
    // Деления и цифры (тысячи).
    g.fillStyle = '#fff';
    g.font = `700 ${S * 0.075}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let k = 0; k <= 7; k++) {
      const a = ang(k * 1000), ca = Math.cos(a), sa = Math.sin(a);
      g.strokeStyle = k * 1000 >= RED ? '#ff7a6a' : '#fff';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(c + ca * (R - 12), c + sa * (R - 12)); g.lineTo(c + ca * (R - 20), c + sa * (R - 20)); g.stroke();
      g.fillStyle = k * 1000 >= RED ? '#ff7a6a' : 'rgba(255,255,255,.85)';
      g.fillText(String(k), c + ca * (R - 31), c + sa * (R - 31));
    }
    // Стрелка.
    const a = ang(this.rpm);
    g.strokeStyle = '#ff3b30';
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(c - Math.cos(a) * 8, c - Math.sin(a) * 8); g.lineTo(c + Math.cos(a) * (R - 14), c + Math.sin(a) * (R - 14)); g.stroke();
    g.fillStyle = '#222';
    g.beginPath(); g.arc(c, c, 6, 0, 7); g.fill();
    // Передача и подпись.
    g.fillStyle = '#fff';
    g.font = `900 italic ${S * 0.2}px system-ui, sans-serif`;
    g.fillText(String(this.gear), c, c - S * 0.16);
    g.font = `600 ${S * 0.055}px system-ui, sans-serif`;
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.fillText('×1000 об/мин', c, c - S * 0.03);

    // Бензин: дуга E…F внизу циферблата, стрелка; мало — красное и мигает.
    const fr = R * 0.5, fy = c + R * 0.22, low = car.fuel < 0.25;
    g.lineWidth = 6;
    g.lineCap = 'butt';
    g.strokeStyle = 'rgba(255,255,255,.18)';
    g.beginPath(); g.arc(c, fy, fr, F1, F0); g.stroke();
    const blink = low && Math.floor(performance.now() / 400) % 2;
    g.strokeStyle = low ? (blink ? '#ff3b30' : '#7a1a14') : '#ff9d2e';
    g.beginPath(); g.arc(c, fy, fr, F0 - (F0 - F1) * car.fuel, F0); g.stroke();
    g.font = `800 ${S * 0.07}px system-ui, sans-serif`;
    g.fillStyle = low ? '#ff7a6a' : 'rgba(255,255,255,.8)';
    g.fillText('E', c + Math.cos(F0) * (fr - 13), fy + Math.sin(F0) * (fr - 13));
    g.fillStyle = 'rgba(255,255,255,.8)';
    g.fillText('F', c + Math.cos(F1) * (fr - 13), fy + Math.sin(F1) * (fr - 13));
    g.font = `${S * 0.09}px sans-serif`;
    g.fillText('⛽', c, fy + fr * 0.35);
    const na = F0 - (F0 - F1) * car.fuel;
    g.strokeStyle = '#fff';
    g.lineWidth = 2.5;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(c + Math.cos(na) * (fr - 12), fy + Math.sin(na) * (fr - 12)); g.lineTo(c + Math.cos(na) * (fr + 4), fy + Math.sin(na) * (fr + 4)); g.stroke();
    g.font = `700 ${S * 0.06}px system-ui, sans-serif`;
    g.fillStyle = low ? '#ff7a6a' : '#fff';
    g.fillText(`${Math.round(car.fuel * 100)}%`, c, fy + fr * 0.82);
  }
}
