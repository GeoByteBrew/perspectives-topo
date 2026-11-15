declare module 'polygon-clipping' {
  export type Pair = [number, number];
  export type Ring = Pair[];
  export type Polygon = Ring[];
  export type MultiPolygon = Polygon[];
  export function intersection(a: MultiPolygon, b: MultiPolygon): MultiPolygon;
  export function union(a: MultiPolygon, b: MultiPolygon): MultiPolygon;
  export function difference(a: MultiPolygon, b: MultiPolygon): MultiPolygon;
}
