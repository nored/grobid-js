// Port of org.grobid.core.data.FigureTableType.
// Upstream: grobid-core/src/main/java/org/grobid/core/data/FigureTableType.java

export enum FigureTableType {
  FIGURE = "figure",
  TABLE = "table",
}

export namespace FigureTableType {
  export function getValue(t: FigureTableType): string {
    return t;
  }
}
