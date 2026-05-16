import { describe, it, expect } from "vitest";
import { parseAlto } from "../../src/core/pdf/alto-parser.js";

const MIN_ALTO = `<?xml version="1.0" encoding="UTF-8"?>
<alto>
  <Styles>
    <TextStyle ID="f0" FONTFAMILY="Times-Bold" FONTSIZE="14.0"/>
    <TextStyle ID="f1" FONTFAMILY="Times-Roman" FONTSIZE="10.0"/>
    <TextStyle ID="f2" FONTFAMILY="Times-Italic" FONTSIZE="10.0" FONTSTYLE="italic"/>
    <TextStyle ID="f3" FONTFAMILY="Symbol" FONTSIZE="6.0" FONTSTYLE="superscript"/>
  </Styles>
  <Layout>
    <Page ID="Page1" PHYSICAL_IMG_NR="1" WIDTH="612.0" HEIGHT="792.0">
      <PrintSpace>
        <TextBlock>
          <TextLine>
            <String CONTENT="Hello" HPOS="50.0" VPOS="80.0" WIDTH="40.0" HEIGHT="14.0" STYLEREFS="f0"/>
            <String CONTENT="world" HPOS="95.0" VPOS="80.0" WIDTH="40.0" HEIGHT="14.0" STYLEREFS="f0"/>
          </TextLine>
          <TextLine>
            <String CONTENT="A&amp;B" HPOS="50.0" VPOS="100.0" WIDTH="20.0" HEIGHT="10.0" STYLEREFS="f1"/>
            <String CONTENT="ital" HPOS="75.0" VPOS="100.0" WIDTH="20.0" HEIGHT="10.0" STYLEREFS="f2"/>
            <String CONTENT="∗" HPOS="100.0" VPOS="98.0" WIDTH="4.0" HEIGHT="6.0" STYLEREFS="f3"/>
          </TextLine>
        </TextBlock>
        <Illustration ID="fig1" HPOS="100.0" VPOS="200.0" WIDTH="400.0" HEIGHT="300.0" TYPE="svg"/>
      </PrintSpace>
    </Page>
    <Page ID="Page2" PHYSICAL_IMG_NR="2" WIDTH="612.0" HEIGHT="792.0">
      <PrintSpace>
        <TextBlock>
          <TextLine>
            <String CONTENT="page-2" HPOS="50.0" VPOS="80.0" WIDTH="40.0" HEIGHT="10.0" STYLEREFS="f1"/>
          </TextLine>
        </TextBlock>
      </PrintSpace>
    </Page>
  </Layout>
</alto>`;

describe("parseAlto", () => {
  const result = parseAlto(MIN_ALTO);

  it("emits one RawPage per <Page> element with correct geometry", () => {
    expect(result.pages.length).toBe(2);
    expect(result.pages[0]!.pageNumber).toBe(1);
    expect(result.pages[0]!.width).toBe(612);
    expect(result.pages[0]!.height).toBe(792);
    expect(result.pages[1]!.pageNumber).toBe(2);
  });

  it("emits one RawTextItem per <String> with content + coordinates", () => {
    const items = result.pages[0]!.items;
    expect(items.length).toBe(5);
    expect(items[0]!.str).toBe("Hello");
    expect(items[0]!.x).toBe(50);
    expect(items[0]!.y).toBe(80);
    expect(items[0]!.width).toBe(40);
    expect(items[0]!.height).toBe(14);
  });

  it("decodes XML entities in CONTENT", () => {
    const items = result.pages[0]!.items;
    expect(items[2]!.str).toBe("A&B");
  });

  it("resolves STYLEREFS to font name and size from the <TextStyle> table", () => {
    const items = result.pages[0]!.items;
    expect(items[0]!.fontName).toBe("Times-Bold");
    expect(items[0]!.fontSize).toBe(14);
    expect(items[2]!.fontName).toBe("Times-Roman");
    expect(items[2]!.fontSize).toBe(10);
  });

  it("propagates italic and bold style flags", () => {
    const items = result.pages[0]!.items;
    expect(items[0]!.bold).toBe(true);
    expect(items[3]!.italic).toBe(true);
  });

  it("attaches the superscript flag to superscript-styled strings", () => {
    const items = result.pages[0]!.items;
    const supItem = items[4] as typeof items[number] & { superscript?: boolean };
    expect(supItem.str).toBe("∗");
    expect(supItem.superscript).toBe(true);
  });

  it("collects illustration regions", () => {
    expect(result.illustrations.length).toBe(1);
    expect(result.illustrations[0]).toMatchObject({
      page: 1, x: 100, y: 200, width: 400, height: 300, type: "svg",
    });
  });
});
