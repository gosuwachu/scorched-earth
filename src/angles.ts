/** The HUD elevation map: internal 0-180 angle (0=E,90=up,180=W) -> (elev 0..90,
 *  side letter). Mirrors _hud_angle. Shared by the host HUD and phone controls. */
export function hudAngle(angle: number): [number, string] {
  if (angle <= 90) {
    return [angle, "R"]; // East (right)
  }
  return [180 - angle, "L"]; // West (left)
}
