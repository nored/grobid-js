// Port of org.grobid.core.main.batch.GrobidMain.
// Upstream: grobid-core/src/main/java/org/grobid/core/main/batch/GrobidMain.java
//
// The entrance point for starting grobid from command line and perform
// batch processing.

import { sep } from "node:path";
import { Flavor } from "../../grobid-models.js";
// @ts-expect-error stub-not-ported-yet
import { ProcessEngine } from "../../engines/process-engine.js";
import { GrobidProperties } from "../../utilities/grobid-properties.js";
import { Utilities } from "../../utilities/utilities.js";
import { GrobidHomeFinder } from "../grobid-home-finder.js";
import { GrobidMainArgs } from "./grobid-main-args.js";

/**
 * The entrance point for starting grobid from command line and perform
 * batch processing.
 *
 * Upstream GrobidMain.java line 17-215.
 */
export class GrobidMain {
  // Upstream line 19.
  private static availableCommands: string[] = [];

  // Upstream line 24.
  private static gbdArgs: GrobidMainArgs = new GrobidMainArgs();

  /**
   * Build the path to grobid.properties from the path to grobid-home.
   *
   * Upstream line 33-35.
   */
  protected static getPath2GbdProperties(pPath2GbdHome: string): string {
    return pPath2GbdHome + sep + "config" + sep + "grobid.properties";
  }

  /**
   * Infer some parameters not given in arguments.
   *
   * Upstream line 40-48.
   */
  protected static inferParamsNotSet(): void {
    let tmpFilePath: string;
    if (GrobidMain.gbdArgs.getPath2grobidHome() === null) {
      // `new File("grobid-home").getAbsolutePath()` resolves against the
      // current working directory.
      tmpFilePath = process.cwd() + sep + "grobid-home";
      // eslint-disable-next-line no-console
      console.log("No path set for grobid-home. Using: " + tmpFilePath);
      GrobidMain.gbdArgs.setPath2grobidHome(tmpFilePath);
      GrobidMain.gbdArgs.setPath2grobidProperty(process.cwd() + sep + "grobid.properties");
    }
  }

  // Upstream line 50-52.
  protected static initProcess(): void;
  // Upstream line 54-62.
  protected static initProcess(grobidHome: string): void;
  protected static initProcess(grobidHome?: string): void {
    if (grobidHome === undefined) {
      GrobidProperties.getInstance();
      return;
    }
    try {
      const grobidHomeFinder = new GrobidHomeFinder([grobidHome]);
      grobidHomeFinder.findGrobidHomeOrFail();
      GrobidProperties.getInstance(grobidHomeFinder);
    } catch (exp) {
      // eslint-disable-next-line no-console
      console.error("Grobid initialisation failed: " + String(exp));
    }
  }

  /**
   * @return String to display for help.
   *
   * Upstream line 67-84.
   */
  protected static getHelp(): string {
    const help: string[] = [];
    help.push("\nHELP for GROBID batch\n\n");
    help.push("Command line arguments:\n");
    help.push("  -h:\n \tdisplays help\n");
    help.push("  -gH:\n \tgives the path to grobid home directory.\n");
    help.push(
      "  -dIn:\n \tgives the path to the directory where the files to be processed are located, to be used only when the called method process files.\n",
    );
    help.push(
      "  -dOut:\n \tgives the path to the directory where the result files will be saved. The default output directory is the curent directory.\n",
    );
    help.push(
      "  -s:\n \tgives a string as input to be processed, to be used only when the called method process a string.\n",
    );
    help.push("  -r:\n \trecursive directory processing, default processing is not recursive.\n");
    help.push(
      "  -ignoreAssets:\n \tdo not extract and save the PDF assets (bitmaps, vector graphics), by default the assets are extracted and saved.\n",
    );
    help.push(
      "  -teiCoordinates:\n \toutput a subset of the identified structures with coordinates in the original PDF, by default no coordinates are present.\n",
    );
    help.push(
      "  -addElementId:\n \tadd xml:id attribute automatically to the XML elements in the resulting TEI XML, by default no xml:id are added.\n",
    );
    help.push(
      "  -segmentSentences:\n \tadd sentence segmentation level structures for paragraphs in the TEI XML result, by default no sentence segmentation is present.\n",
    );
    help.push("  -exe:\n \tgives the command to execute. The value should be one of these:\n");
    help.push("\t" + GrobidMain.availableCommands + "\n");
    return help.join("");
  }

  /**
   * Process batch given the args.
   *
   * Upstream line 92-189.
   */
  protected static processArgs(pArgs: string[]): boolean {
    let result = true;
    if (pArgs.length === 0) {
      // eslint-disable-next-line no-console
      console.log(GrobidMain.getHelp());
      result = false;
    } else {
      let currArg: string;
      for (let i = 0; i < pArgs.length; i++) {
        // Upstream: `currArg = pArgs[i]` — Java arrays don't return `undefined`,
        // and the loop guard guarantees a valid index here.
        currArg = pArgs[i] as string;
        if (currArg === "-h") {
          // eslint-disable-next-line no-console
          console.log(GrobidMain.getHelp());
          result = false;
          break;
        }
        if (currArg === "-gH") {
          const next = pArgs[i + 1] as string;
          GrobidMain.gbdArgs.setPath2grobidHome(next);
          if (next !== null && next !== undefined) {
            GrobidMain.gbdArgs.setPath2grobidProperty(GrobidMain.getPath2GbdProperties(next));
          }
          i++;
          continue;
        }
        if (currArg === "-dIn") {
          const next = pArgs[i + 1] as string;
          if (next !== null && next !== undefined) {
            GrobidMain.gbdArgs.setPath2Input(next);
            GrobidMain.gbdArgs.setPdf(true);
          }
          i++;
          continue;
        }
        if (currArg === "-s") {
          const next = pArgs[i + 1] as string;
          if (next !== null && next !== undefined) {
            GrobidMain.gbdArgs.setInput(next);
            GrobidMain.gbdArgs.setPdf(false);
          }
          i++;
          continue;
        }
        if (currArg === "-dOut") {
          const next = pArgs[i + 1] as string;
          if (next !== null && next !== undefined) {
            GrobidMain.gbdArgs.setPath2Output(next);
          }
          i++;
          continue;
        }
        if (currArg === "-exe") {
          const command = pArgs[i + 1] as string;
          if (GrobidMain.availableCommands.includes(command)) {
            GrobidMain.gbdArgs.setProcessMethodName(command);
            i++;
            continue;
          } else {
            // eslint-disable-next-line no-console
            console.error("-exe value should be one value from this list: " + GrobidMain.availableCommands);
            result = false;
            break;
          }
        }
        if (currArg === "-ignoreAssets") {
          GrobidMain.gbdArgs.setSaveAssets(false);
          continue;
        }
        if (currArg === "-addElementId") {
          GrobidMain.gbdArgs.setAddElementId(true);
          continue;
        }
        if (currArg === "-teiCoordinates") {
          GrobidMain.gbdArgs.setTeiCoordinates(true);
          continue;
        }
        if (currArg === "-segmentSentences") {
          GrobidMain.gbdArgs.setSegmentSentences(true);
          continue;
        }
        if (currArg === "-r") {
          GrobidMain.gbdArgs.setRecursive(true);
          continue;
        }

        if (currArg === "-flavor") {
          const command = pArgs[i + 1] as string;
          const flavor: Flavor | null = Flavor.fromLabel(command);
          if (flavor !== null) {
            // eslint-disable-next-line no-console
            console.log("Setting model flavor to: " + flavor);
            GrobidMain.gbdArgs.setModelFlavor(flavor);
            i++;
            continue;
          } else {
            // eslint-disable-next-line no-console
            console.log("No model flavor, using the default models");
            break;
          }
        }
      }
    }
    return result;
  }

  /**
   * Starts Grobid from command line.
   *
   * Upstream line 197-213.
   */
  static async main(args: string[]): Promise<void> {
    GrobidMain.gbdArgs = new GrobidMainArgs();
    GrobidMain.availableCommands = ProcessEngine.getUsableMethods();

    if (GrobidMain.processArgs(args)) {
      GrobidMain.inferParamsNotSet();
      if (GrobidMain.gbdArgs.getPath2grobidHome() !== null) {
        GrobidMain.initProcess(GrobidMain.gbdArgs.getPath2grobidHome()!);
      } else {
        GrobidMain.initProcess();
      }
      const processEngine = new ProcessEngine();
      Utilities.launchMethod(processEngine, [GrobidMain.gbdArgs], GrobidMain.gbdArgs.getProcessMethodName()!);
      processEngine.close();
    }
  }
}
