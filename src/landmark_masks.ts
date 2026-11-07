import data from "./landmark_masks.json";
export interface LandmarkMask { bounds: number[]; rows: string[] }
export const landmarkMasks: Partial<Record<string, LandmarkMask>> = data;
export function landmarkAspect(kind: string): number | undefined {
  const bounds = landmarkMasks[kind]?.bounds;
  return bounds ? bounds[2] / bounds[3] : undefined;
}
