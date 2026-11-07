/** Resolution-independent illustrated artwork shared by battle and HTML previews. */
export type ArtColor = readonly number[];
function shade(color: ArtColor, amount: number): string {
  return `rgb(${color.slice(0, 3).map(v => Math.max(0, Math.min(255, v + amount))).join(",")})`;
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
  // The barrel rotates around the same pivot used by the engine.
  ctx.save(); ctx.translate(0, -8.5); ctx.rotate(-angle * Math.PI / 180);
  const barrel = ctx.createLinearGradient(0, -1.3, 0, 1.3); barrel.addColorStop(0, shade(color, 95)); barrel.addColorStop(.4, shade(color, 15)); barrel.addColorStop(1, shade(color, -65));
  ctx.fillStyle = barrel; ctx.strokeStyle = shade(color, -75); ctx.lineWidth = .55;
  ctx.beginPath(); ctx.roundRect(1, -1.2, 15 + variant % 3, 2.4, .5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#15313b"; ctx.fillRect(14 + variant % 3, -1.35, 2.2, 2.7);
  ctx.fillStyle = shade(color, 55); ctx.fillRect(14 + variant % 3, -1.35, 2.2, .6);
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

export function drawModernBlast(ctx: CanvasRenderingContext2D, x: number, y: number,
  radius: number, age: number, progress: number, plasma = false, fading = false): void {
  const r = Math.max(2, radius * Math.max(.15, progress));
  const alpha = fading ? Math.max(0, 1 - age / (plasma ? 42 : 25)) : 1;
  if (alpha <= 0) return;
  ctx.save(); ctx.translate(x, y); ctx.globalAlpha = alpha;
  // Smoke and thrown fragments are cosmetic, deterministic functions of effect age.
  const motion = fading ? 1 + age / 14 : Math.min(1, progress);
  for (let n = 0; n < 8; n++) {
    const a = n * 2.39996, spread = r * (.5 + n % 3 * .12);
    const sx = Math.cos(a) * spread, sy = Math.sin(a) * spread - motion * r * .25;
    const smoke = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * .55);
    smoke.addColorStop(0, `rgba(53,45,42,${.5 * motion})`); smoke.addColorStop(1, "rgba(45,39,36,0)");
    ctx.fillStyle = smoke; ctx.beginPath(); ctx.arc(sx, sy, r * .55, 0, Math.PI * 2); ctx.fill();
  }
  const halo = ctx.createRadialGradient(0, 0, r * .25, 0, 0, r * 1.65);
  halo.addColorStop(0, plasma ? "rgba(129,191,255,.75)" : "rgba(255,199,70,.7)");
  halo.addColorStop(.5, plasma ? "rgba(81,137,255,.22)" : "rgba(255,116,23,.2)"); halo.addColorStop(1, "rgba(255,95,20,0)");
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, r * 1.65, 0, Math.PI * 2); ctx.fill();
  for (let n = 0; n < 10; n++) {
    const a = n * 2.39996 + age * .025, rr = r * (.3 + (n % 4) * .12);
    const px = Math.cos(a) * r * .43, py = Math.sin(a) * r * .38;
    const fire = ctx.createRadialGradient(px, py, 0, px, py, rr);
    fire.addColorStop(0, "#ffffe8"); fire.addColorStop(.22, plasma ? "#d3f6ff" : "#fff3a0");
    fire.addColorStop(.55, plasma ? "#79cfff" : "#ffc132"); fire.addColorStop(.8, plasma ? "#4d7dee" : "#f97518"); fire.addColorStop(1, plasma ? "rgba(65,89,210,0)" : "rgba(199,53,13,0)");
    ctx.fillStyle = fire; ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = plasma ? "#d2f9ff" : "#ffd28a"; ctx.lineWidth = .65;
  for (let n = 0; n < 15; n++) {
    const a = n * 2.39996, distance = r * (.8 + n % 5 * .17) * motion;
    const px = Math.cos(a) * distance, py = Math.sin(a) * distance - r * .3;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * 2.5, py + Math.sin(a) * 2.5); ctx.stroke();
  }
  ctx.restore();
}
