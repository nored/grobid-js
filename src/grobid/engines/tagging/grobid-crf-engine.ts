// Port of org.grobid.core.engines.tagging.GrobidCRFEngine.
// Upstream: grobid-core/src/main/java/org/grobid/core/engines/tagging/GrobidCRFEngine.java
//
// Java enum with one private field (the file extension used for the model
// file on disk). The TS port keeps the same constants and the static
// lookup helper `get(name)` for case-insensitive resolution of an
// engine by name.

/**
 * Sequence labeling engine in GROBID.
 */
export class GrobidCRFEngine {
  static readonly WAPITI: GrobidCRFEngine = new GrobidCRFEngine("WAPITI", "wapiti");
  static readonly CRFPP: GrobidCRFEngine = new GrobidCRFEngine("CRFPP", "crf");
  static readonly DELFT: GrobidCRFEngine = new GrobidCRFEngine("DELFT", "delft");
  static readonly DUMMY: GrobidCRFEngine = new GrobidCRFEngine("DUMMY", "dummy");
  // Grobid-js extension: dispatch to BidLSTMCRFFeaturesTagger (ONNX-backed).
  // Upstream selects this through the `DELFT` engine + an `architecture`
  // string; we expose it directly so the JS port can short-circuit
  // without booting a Python runtime.
  static readonly BIDLSTM_CRF_FEATURES: GrobidCRFEngine = new GrobidCRFEngine(
    "BIDLSTM_CRF_FEATURES",
    "bidlstm-crf-features",
  );

  private readonly _name: string;
  private readonly ext: string;

  private constructor(name: string, ext: string) {
    this._name = name;
    this.ext = ext;
  }

  /** Mirror of Java's `Enum.name()`. */
  name(): string {
    return this._name;
  }

  getExt(): string {
    return this.ext;
  }

  /** Mirror of Java's `Enum.values()`. */
  static values(): readonly GrobidCRFEngine[] {
    return [
      GrobidCRFEngine.WAPITI,
      GrobidCRFEngine.CRFPP,
      GrobidCRFEngine.DELFT,
      GrobidCRFEngine.DUMMY,
      GrobidCRFEngine.BIDLSTM_CRF_FEATURES,
    ];
  }

  static get(name: string | null | undefined): GrobidCRFEngine {
    if (name == null) {
      throw new Error("Name of a Grobid sequence labeling engine must not be null");
    }

    const n = name.toLowerCase();
    for (const e of GrobidCRFEngine.values()) {
      if (e.name().toLowerCase() === n) {
        return e;
      }
    }
    throw new Error(
      "No Grobid sequence labeling engine with name '" +
        name +
        "', possible values are: " +
        "[" +
        GrobidCRFEngine.values()
          .map((e) => e.name())
          .join(", ") +
        "]",
    );
  }

  toString(): string {
    return this._name;
  }
}
