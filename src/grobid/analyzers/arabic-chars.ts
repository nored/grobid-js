// Port of org.grobid.core.analyzers.ArabicChars.
// Upstream: grobid-core/src/main/java/org/grobid/core/analyzers/ArabicChars.java
//
// Author (upstream): Chihebeddine Ammar

export class ArabicChars {
  /**
   * Method for mapping some Arabic characters to their equivalent ASCII codes.
   */
  static arabicCharacters(c: string): string {
    let car: string;
    switch (c) {
      case "،":
        car = ",";
        break;
      case "؛":
        car = ";";
        break;
      case "؟":
        car = "?";
        break;
      case "٠":
        car = "0";
        break;
      case "١":
        car = "1";
        break;
      case "٢":
        car = "2";
        break;
      case "٣":
        car = "3";
        break;
      case "٤":
        car = "4";
        break;
      case "٥":
        car = "5";
        break;
      case "٦":
        car = "6";
        break;
      case "٧":
        car = "7";
        break;
      case "٨":
        car = "8";
        break;
      case "٩":
        car = "9";
        break;
      default:
        car = c;
        break;
    }
    return car;
  }
}
