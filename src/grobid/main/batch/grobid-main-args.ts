// Port of org.grobid.core.main.batch.GrobidMainArgs.
// Upstream: grobid-core/src/main/java/org/grobid/core/main/batch/GrobidMainArgs.java
//
// Args container for the batch GrobidMain.

import { Flavor } from "../../grobid-models.js";

/**
 * Class containing args of the batch `GrobidMain`.
 *
 * Upstream GrobidMainArgs.java line 9-255.
 */
export class GrobidMainArgs {
  // Upstream line 11.
  private path2grobidHome: string | null = null;

  // Upstream line 13.
  private path2grobidProperty: string | null = null;

  // Upstream line 15.
  private path2Input: string | null = null;

  // Upstream line 17.
  private path2Output: string | null = null;

  // Upstream line 19.
  private processMethodName: string | null = null;

  // Upstream line 21.
  private input: string | null = null;

  // Upstream line 23.
  private isPdf_: boolean = false;

  // Upstream line 25.
  private recursive: boolean = false;

  // Upstream line 27.
  private saveAssets: boolean = true;

  // Upstream line 29.
  private teiCoordinates: boolean = false;

  // Upstream line 31.
  private consolidateHeader: boolean = true;

  // Upstream line 33.
  private consolidateCitation: boolean = false;

  // Upstream line 35.
  private segmentSentences: boolean = false;

  // Upstream line 37.
  private addElementId: boolean = false;

  // Upstream line 39.
  private modelFlavor: Flavor | null = null;

  // Upstream line 44-46 / 52-54.
  getPath2grobidHome(): string | null {
    return this.path2grobidHome;
  }
  setPath2grobidHome(pPath2grobidHome: string | null): void {
    this.path2grobidHome = pPath2grobidHome;
  }

  // Upstream line 59-61 / 67-69.
  getPath2grobidProperty(): string | null {
    return this.path2grobidProperty;
  }
  setPath2grobidProperty(pPath2grobidProperty: string | null): void {
    this.path2grobidProperty = pPath2grobidProperty;
  }

  // Upstream line 74-76 / 82-84.
  getPath2Input(): string | null {
    return this.path2Input;
  }
  setPath2Input(pPath2input: string | null): void {
    this.path2Input = pPath2input;
  }

  // Upstream line 89-91 / 97-99.
  getPath2Output(): string | null {
    return this.path2Output;
  }
  setPath2Output(pPath2Output: string | null): void {
    this.path2Output = pPath2Output;
  }

  // Upstream line 104-106 / 112-114.
  getProcessMethodName(): string | null {
    return this.processMethodName;
  }
  setProcessMethodName(pProcessMethodName: string | null): void {
    this.processMethodName = pProcessMethodName;
  }

  // Upstream line 119-121 / 127-129.
  getInput(): string | null {
    return this.input;
  }
  setInput(pInput: string | null): void {
    this.input = pInput;
  }

  // Upstream line 134-136 / 142-144.
  isPdf(): boolean {
    return this.isPdf_;
  }
  setPdf(pIsPdf: boolean): void {
    this.isPdf_ = pIsPdf;
  }

  // Upstream line 149-151.
  isRecursive(): boolean {
    return this.recursive;
  }

  // Upstream line 156-158.
  isConsolidateHeader(): boolean {
    return this.consolidateHeader;
  }

  // Upstream line 163-165.
  isConsolidateCitation(): boolean {
    return this.consolidateCitation;
  }

  // Upstream line 170-172.
  getConsolidateHeader(): boolean {
    return this.consolidateHeader;
  }

  // Upstream line 177-179.
  getConsolidateCitation(): boolean {
    return this.consolidateCitation;
  }

  // Upstream line 184-186 / 191-193.
  getSaveAssets(): boolean {
    return this.saveAssets;
  }
  setSaveAssets(pSaveAssets: boolean): void {
    this.saveAssets = pSaveAssets;
  }

  // Upstream line 199-201.
  setRecursive(pRecursive: boolean): void {
    this.recursive = pRecursive;
  }

  // Upstream line 206-208 / 214-216.
  getTeiCoordinates(): boolean {
    return this.teiCoordinates;
  }
  setTeiCoordinates(pTeiCoordinates: boolean): void {
    this.teiCoordinates = pTeiCoordinates;
  }

  // Upstream line 221-223 / 229-231.
  getAddElementId(): boolean {
    return this.addElementId;
  }
  setAddElementId(pAddElementId: boolean): void {
    this.addElementId = pAddElementId;
  }

  // Upstream line 236-238 / 244-246.
  getSegmentSentences(): boolean {
    return this.segmentSentences;
  }
  setSegmentSentences(pSegmentSentences: boolean): void {
    this.segmentSentences = pSegmentSentences;
  }

  // Upstream line 248-250 / 252-254.
  getModelFlavor(): Flavor | null {
    return this.modelFlavor;
  }
  setModelFlavor(modelFlavor: Flavor | null): void {
    this.modelFlavor = modelFlavor;
  }

  // Setters for the consolidation booleans — upstream allows them via
  // direct field access from `GrobidMain.processArgs`. We expose them here
  // for the CLI port to call.
  setConsolidateHeader(value: boolean): void {
    this.consolidateHeader = value;
  }
  setConsolidateCitation(value: boolean): void {
    this.consolidateCitation = value;
  }
}
