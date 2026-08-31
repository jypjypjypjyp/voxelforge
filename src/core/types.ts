export interface VoxelProject {
  format: "voxelforge/1";
  size: [number, number, number];
  palette: Record<string, string>;
  voxels: Record<string, number>;
}

export type Axis = "x" | "y" | "z";

export type Region = [number, number, number, number, number, number];
