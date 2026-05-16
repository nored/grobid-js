// Port of org.grobid.core.utilities.GrobidConfig.
// Upstream: grobid-core/src/main/java/org/grobid/core/utilities/GrobidConfig.java
//
// YAML configuration bean. Upstream uses Jackson YAML deserialization to
// populate these fields from grobid.yaml. The JS port keeps the field shape
// verbatim; loaders construct an instance and assign fields directly (no
// custom deserializer needed — `Object.assign(new GrobidConfig(), parsed)`).
//
// All defaults match upstream's initializer values.

export class GrobidConfig {
  grobid?: GrobidParameters;
}

export class GrobidParameters {
  grobidHome: string = "grobid-home";
  temp: string = "./tmp";
  nativelibrary: string = "./lib";
  pdf?: PdfParameters;
  consolidation?: ConsolidationParameters;
  proxy?: HostParameters;
  languageDetectorFactory?: string;
  sentenceDetectorFactory?: string;
  concurrency: number = 10;
  poolMaxWait: number = 1;
  delft?: DelftParameters;
  wapiti?: WapitiParameters;
  models?: ModelParameters[];
}

export class PdfParameters {
  pdfalto?: PdfAltoParameters;
  blocksMax: number = 100_000;
  tokensMax: number = 1_000_000;
}

export class PdfAltoParameters {
  path?: string;
  memoryLimitMb: number = 6096;
  timeoutSec: number = 60;
}

export class ConsolidationParameters {
  service?: string;
  glutton?: HostParameters;
  crossref?: CrossrefParameters;
}

export class CrossrefParameters {
  mailto?: string;
  token?: string;
  timeoutSec: number = 60;
  minRequestIntervalMs: number = -1;
  postValidation: boolean = true;
}

export class HostParameters {
  type?: string;
  host?: string;
  port?: number;
  url?: string;
  timeoutSec: number = 60;
}

export class DelftParameters {
  install?: string;
  pythonVirtualEnv?: string;
}

export class WapitiParameters {
  nbThreads: number = 0;
}

export class WapitiModelParameters {
  epsilon: number = 0.00001;
  window: number = 20;
  nbMaxIterations: number = 2000;
}

export class DelftModelParameters {
  architecture?: string;
  useELMo: boolean = false;
  embeddings_name: string = "glove-840B";
  transformer?: string;
  training?: DelftModelParameterSet;
  runtime?: DelftModelParameterSet;
}

export class DelftModelParameterSet {
  max_sequence_length: number = -1;
  batch_size: number = -1;
}

export class ModelParameters {
  /** Name of the model. */
  name?: string;
  /** "wapiti" or "delft". */
  engine?: string;
  wapiti?: WapitiModelParameters;
  delft?: DelftModelParameters;
}
