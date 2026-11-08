/** Resolution-independent illustrated artwork shared by battle and HTML previews. */
export type ArtColor = readonly number[];
function shade(color: ArtColor, amount: number): string {
  return `rgb(${color.slice(0, 3).map(v => Math.max(0, Math.min(255, v + amount))).join(",")})`;
}
/** Barrel geometry in the artwork's unscaled 26-pixel coordinate system. */
export function modernBarrel(design = 0) {
  return { pivotY: -8.5, length: 16.2 + (design % 7) % 3 };
}
// Browser artwork only: design IDs retain their existing mobility and weapon rules.
// Silhouettes are deliberately different even when painted the same team colour.
const TANK_DESIGNS = [
  { hull: [[-12,-5],[-9,-9],[8,-9],[12,-5]], turret: [-5.8,-14,12,7,3.5], gear: "tracks", wheels: 6 }, // domed howitzer
  { hull: [[-13,-5],[-10,-10],[7,-10],[13,-5]], turret: [-8,-13,15,5,0.6], gear: "tracks", wheels: 5 }, // flat heavy tank
  { hull: [[-12,-4],[-8,-7],[-3,-7],[-3,-10],[3,-10],[5,-5],[12,-4]], turret: [-3,-13,6,6,0.7], gear: "wheels", wheels: 2 }, // field artillery
  { hull: [[-12,-5],[-9,-9],[5,-9],[12,-6],[12,-4],[-12,-4]], turret: [-5,-13,10,6,2], gear: "wheels", wheels: 3 }, // armoured car
  { hull: [[-13,-5],[-10,-8],[10,-8],[13,-5]], turret: [-9,-13,18,6,2], gear: "wheels", wheels: 4 }, // broad turret
  { hull: [[-10,0],[-8,-5],[-5,-8],[5,-8],[8,-5],[10,0]], turret: [-4,-12,8,5,2], gear: "base", wheels: 0 }, // compact emplacement
  { hull: [[-13,-5],[-10,-10],[9,-10],[13,-5]], turret: [-7,-14,14,7,0.5], gear: "tracks", wheels: 4 }, // stepped command tank
] as const;

export function drawModernTank(ctx: CanvasRenderingContext2D, x: number, y: number,
  width: number, color: ArtColor, angle: number, design = 0): void {
  const variant = ((Math.trunc(design) % 7) + 7) % 7;
  const model = TANK_DESIGNS[variant] ?? TANK_DESIGNS[0];
  ctx.save(); ctx.translate(x, y); ctx.scale(width / 26, width / 26);
  ctx.fillStyle = "rgba(8,18,23,.24)";
  ctx.beginPath(); ctx.ellipse(0, .5, 14, 2, 0, 0, Math.PI * 2); ctx.fill();
  const paint = ctx.createLinearGradient(-4, -15, 4, -3);
  paint.addColorStop(0, shade(color, 65)); paint.addColorStop(.32, shade(color, 15));
  paint.addColorStop(.7, shade(color, -18)); paint.addColorStop(1, shade(color, -65));
  const plate = (left: number, top: number, w: number, h: number, radius: number) => {
    ctx.fillStyle = paint; ctx.strokeStyle = shade(color, -80); ctx.lineWidth = .7;
    ctx.beginPath(); ctx.roundRect(left, top, w, h, radius); ctx.fill(); ctx.stroke();
  };
  if (model.gear === "tracks") {
    const tracks = ctx.createLinearGradient(0, -7, 0, 0);
    tracks.addColorStop(0, "#536471"); tracks.addColorStop(.5, "#16242c"); tracks.addColorStop(1, "#08141b");
    ctx.fillStyle = tracks; ctx.strokeStyle = "#07121b"; ctx.lineWidth = .8;
    ctx.beginPath(); ctx.roundRect(-13, -6, 26, 6, 3); ctx.fill(); ctx.stroke();
  }
  if (model.gear !== "base") {
    for (let i = 0; i < model.wheels; i++) {
      const px = -9.5 + i * 19 / (model.wheels - 1);
      const radius = model.gear === "wheels" ? (variant === 2 ? 3.8 : 2.9) : 1.9;
      ctx.fillStyle = "#101e28"; ctx.beginPath(); ctx.arc(px, -radius, radius, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#80929a"; ctx.beginPath(); ctx.arc(px, -radius, radius * .63, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#263e4a"; ctx.beginPath(); ctx.arc(px, -radius, radius * .3, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    plate(-12, -2, 24, 2, .4);
  }
  if (model.gear === "tracks") {
    ctx.strokeStyle = "#9aa9a9"; ctx.lineWidth = .45;
    for (let px = -10; px <= 10; px += 2) {
      ctx.beginPath(); ctx.moveTo(px, -.2); ctx.lineTo(px + .5, -1); ctx.stroke();
    }
  }
  ctx.fillStyle = paint; ctx.strokeStyle = shade(color, -80); ctx.lineWidth = .7;
  ctx.beginPath(); model.hull.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py));
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // A solid identification plate preserves the assigned player colour.
  ctx.fillStyle = shade(color, 0); ctx.fillRect(-4, -6.5, 7, 1.5);
  if (variant === 1 || variant === 6) {
    // Large side armour panels distinguish heavy tracked chassis at battle scale.
    for (let px = -11; px < 10; px += 5.5) plate(px, -6.8, 4.8, 2.8, .3);
  }
  const geometry = modernBarrel(design);
  ctx.save(); ctx.translate(0, geometry.pivotY); ctx.rotate(-angle * Math.PI / 180);
  const barrel = ctx.createLinearGradient(0, -1.3, 0, 1.3);
  barrel.addColorStop(0, shade(color, 95)); barrel.addColorStop(.4, shade(color, 15)); barrel.addColorStop(1, shade(color, -65));
  ctx.fillStyle = barrel; ctx.strokeStyle = shade(color, -75); ctx.lineWidth = .55;
  ctx.beginPath(); ctx.roundRect(1, -1.2, geometry.length - 1.2, 2.4, .5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#15313b"; ctx.fillRect(geometry.length - 2.2, -1.35, 2.2, 2.7);
  ctx.fillStyle = shade(color, 55); ctx.fillRect(geometry.length - 2.2, -1.35, 2.2, .6);
  ctx.restore();
  const [turretX, turretY, turretWidth, turretHeight, turretRadius] = model.turret;
  plate(turretX, turretY, turretWidth, turretHeight, turretRadius);
  if (variant === 6) { plate(-4.5, -17, 8, 3, .5); plate(-2, -19, 4, 2, .3); }
  if (variant === 2) {
    // Tall gun shield and open breech on the two-wheel field piece.
    plate(-3, -16, 2, 8, .3);
    ctx.fillStyle = "#182e38"; ctx.fillRect(0, -12, 2, 3);
  } else {
    const [left, top, w] = model.turret;
    ctx.fillStyle = shade(color, 65); ctx.fillRect(left + 2, top + .5, w - 4, .8);
    ctx.fillStyle = "#143843"; ctx.fillRect(1, top + 2, 2.8, 1.2);
    ctx.fillStyle = "#99edee"; ctx.fillRect(1.2, top + 2, 1.9, .45);
  }
  if (variant === 0 || variant === 3 || variant === 6) {
    ctx.strokeStyle = "#263c45"; ctx.lineWidth = .45;
    ctx.beginPath(); ctx.moveTo(-4.3, -12); ctx.lineTo(-5.6, -19); ctx.stroke();
    ctx.fillStyle = "#edbf67"; ctx.beginPath(); ctx.arc(-5.6, -19, .45, 0, Math.PI * 2); ctx.fill();
  }
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
