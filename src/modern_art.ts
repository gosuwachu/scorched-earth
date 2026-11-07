/** Resolution-independent illustrated artwork shared by battle and HTML previews. */
export type ArtColor = readonly number[];
function shade(color: ArtColor, amount: number): string {
  return `rgb(${color.slice(0, 3).map(v => Math.max(0, Math.min(255, v + amount))).join(",")})`;
}
/** Barrel geometry in the artwork's unscaled 26-pixel coordinate system. */
export function modernBarrel(design = 0) {
  return { pivotY: -8.5, length: 16.2 + (design % 7) % 3 };
}
export function drawModernTank(ctx: CanvasRenderingContext2D, x: number, y: number,
  width: number, color: ArtColor, angle: number, design = 0): void {
  ctx.save(); ctx.translate(x, y); ctx.scale(width / 26, width / 26);
  const variant = design % 7;
  // Ground contact, rubber tread, machined rollers and individually spaced links.
  ctx.fillStyle = "rgba(8,18,23,.24)"; ctx.beginPath(); ctx.ellipse(0, 0.5, 14, 2, 0, 0, Math.PI * 2); ctx.fill();
  const tracks = ctx.createLinearGradient(0, -7, 0, 0); tracks.addColorStop(0, "#536471"); tracks.addColorStop(0.5, "#16242c"); tracks.addColorStop(1, "#08141b");
  ctx.fillStyle = tracks; ctx.strokeStyle = "#07121b"; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.roundRect(-13, -6, 26, 6, 3); ctx.fill(); ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const px = -9.5 + i * 3.8;
    ctx.fillStyle = "#80929a"; ctx.beginPath(); ctx.arc(px, -2.8, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#263e4a"; ctx.beginPath(); ctx.arc(px, -2.8, 1.05, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#a6b6b9"; ctx.fillRect(px - .25, -3.1, .5, .5);
  }
  ctx.strokeStyle = "#9aa9a9"; ctx.lineWidth = 0.45;
  for (let px = -10; px <= 10; px += 2) { ctx.beginPath(); ctx.moveTo(px, -0.2); ctx.lineTo(px + .5, -1); ctx.stroke(); }
  const paint = ctx.createLinearGradient(-4, -13, 4, -3);
  paint.addColorStop(0, shade(color, 65)); paint.addColorStop(.32, shade(color, 15)); paint.addColorStop(.7, shade(color, -18)); paint.addColorStop(1, shade(color, -65));
  ctx.fillStyle = paint; ctx.strokeStyle = shade(color, -80); ctx.lineWidth = .7;
  ctx.beginPath(); ctx.moveTo(-12, -5.4); ctx.lineTo(-9, -9); ctx.lineTo(8, -9); ctx.lineTo(12.5, -5.4); ctx.closePath(); ctx.fill(); ctx.stroke();
  // A matte identification plate keeps the assigned team colour unambiguous
  // alongside the shaded armour, including in small controller previews.
  ctx.fillStyle = shade(color, 0); ctx.fillRect(-7.5, -7.8, 6, 1.7);
  ctx.strokeStyle = shade(color, 65); ctx.lineWidth = .6;
  ctx.beginPath(); ctx.moveTo(-8, -8.3); ctx.lineTo(7, -8.3); ctx.stroke();
  for (let px = -8; px <= 8; px += 4) { ctx.fillStyle = "#c6dae0"; ctx.beginPath(); ctx.arc(px, -6.2, .35, 0, Math.PI * 2); ctx.fill(); }
  const geometry = modernBarrel(design);
  ctx.save(); ctx.translate(0, geometry.pivotY); ctx.rotate(-angle * Math.PI / 180);
  const barrel = ctx.createLinearGradient(0, -1.3, 0, 1.3); barrel.addColorStop(0, shade(color, 95)); barrel.addColorStop(.4, shade(color, 15)); barrel.addColorStop(1, shade(color, -65));
  ctx.fillStyle = barrel; ctx.strokeStyle = shade(color, -75); ctx.lineWidth = .55;
  ctx.beginPath(); ctx.roundRect(1, -1.2, geometry.length - 1.2, 2.4, .5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#15313b"; ctx.fillRect(geometry.length - 2.2, -1.35, 2.2, 2.7);
  ctx.fillStyle = shade(color, 55); ctx.fillRect(geometry.length - 2.2, -1.35, 2.2, .6);
  ctx.restore();
  ctx.fillStyle = paint; ctx.strokeStyle = shade(color, -70);
  ctx.beginPath(); ctx.roundRect(-5.8, -13 - variant % 2, 12, 6, [3, 3, 1, 1]); ctx.fill(); ctx.stroke();
  ctx.fillStyle = shade(color, 65); ctx.fillRect(-3, -13.5 - variant % 2, 5.5, 1);
  ctx.fillStyle = "#143843"; ctx.fillRect(1.8, -11, 2.8, 1.2);
  ctx.fillStyle = "#99edee"; ctx.fillRect(2, -11, 1.9, .45);
  ctx.strokeStyle = "#263c45"; ctx.lineWidth = .45;
  ctx.beginPath(); ctx.moveTo(-4.3, -12); ctx.lineTo(-5.6, -19); ctx.stroke();
  ctx.fillStyle = "#edbf67"; ctx.beginPath(); ctx.arc(-5.6, -19, .45, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** Procedural particles in logical pixels: larger blasts emit more particles,
 * rather than magnifying a fixed illustration. Simulation age owns all motion. */
export function drawModernBlast(ctx: CanvasRenderingContext2D, x: number, y: number,
  radius: number, age: number, progress: number, plasma = false, fading = false, fadeAge = 0, fadeDuration = plasma ? 42 : 25): void {
  const r = radius * Math.max(0, Math.min(1, progress));
  const alpha = fading ? Math.max(0, 1 - fadeAge / fadeDuration) : 1;
  if (r <= 0 || alpha <= 0) return;
  const random = (n: number) => { const v = Math.sin(n * 127.1 + x * 12.7 + y * 3.1) * 43758.5453; return v - Math.floor(v); };
  ctx.save(); ctx.translate(x, y);
  // A thin pressure front keeps the true growing circle readable through smoke.
  ctx.globalAlpha = alpha * .35;
  ctx.strokeStyle = plasma ? "#a6eaff" : "#ffe7a3";
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  const count = Math.min(1000, Math.ceil(radius * radius / 28) + 24);
  for (let i = 0; i < count; i++) {
    const angle = random(i * 7 + 1) * Math.PI * 2;
    const distance = Math.sqrt(random(i * 7 + 2)) * radius;
    const birth = distance / (radius < 40 ? 1 : 2);
    const elapsed = age - birth;
    if (distance > r || elapsed < 0) continue;
    // Each point ignites once as the front passes. Never restart particles
    // during the simulation's long hold/cleanup phases.
    const t = elapsed;
    if (t >= 18) continue;
    const life = 1 - t / 18;
    const speed = 1.2 + random(i * 7 + 3) * 1.8;
    const px = Math.cos(angle) * (distance + t * speed);
    const py = Math.sin(angle) * (distance + t * speed) + .04 * t * t;
    const size = 1.5 + random(i * 7 + 4) * 4;
    ctx.globalAlpha = alpha * life * .7;
    ctx.fillStyle = plasma ? "#416d9a" : "#504a43";
    ctx.beginPath(); ctx.arc(px, py - t * .25, size + t * .12, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = alpha * life;
    const flameSize = size * life * 1.5;
    if (flameSize > 0) {
      const fire = ctx.createRadialGradient(px, py, 0, px, py, flameSize);
      fire.addColorStop(0, plasma ? "#dcfaff" : t < 13 ? "#fff5ba" : "#ffbd48");
      fire.addColorStop(.35, plasma ? "#70bdff" : "#ffad32");
      fire.addColorStop(.65, plasma ? "rgba(65,125,255,.7)" : "rgba(240,85,15,.7)");
      fire.addColorStop(1, "rgba(180,45,10,0)");
      ctx.fillStyle = fire;
      ctx.beginPath(); ctx.arc(px, py, flameSize, 0, Math.PI * 2); ctx.fill();
    }
    if (i % 4 === 0) {
      ctx.strokeStyle = plasma ? "#b9f2ff" : "#ffd68a"; ctx.lineWidth = .8;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(angle) * 4, py + Math.sin(angle) * 4); ctx.stroke();
    }
  }
  ctx.restore();
}
