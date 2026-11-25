import { describe, expect, it } from "vitest";
import { tidyTitle } from "@/lib/drafts/tidyTitle";

describe("tidyTitle", () => {
  it("fixes the QA examples", () => {
    expect(tidyTitle("7 Cozy Winter Outfit Ideas Ideas Worth Saving")).toBe("7 Cozy Winter Outfit Ideas Worth Saving");
    expect(tidyTitle("Layering A Trench Coat For Autumn for Autumn", "Layering a trench coat for autumn")).toBe("Layering a Trench Coat for Autumn");
    expect(tidyTitle("Summer Linen Outfits for Autumn", "Summer linen outfits")).toBe("Summer Linen Outfits");
    expect(tidyTitle("Stuck in a Rut? Cozy Winter Outfit Ideas Is the Easy Fix")).toBe("Stuck in a Rut? Cozy Winter Outfit Ideas Are the Easy Fix");
  });
  it("leaves good titles and other languages alone", () => {
    expect(tidyTitle("This Dress Is the One: Easy Eid Looks")).toBe("This Dress Is the One: Easy Eid Looks");
    expect(tidyTitle("Trench coat: layer like a pro")).toBe("Trench coat: layer like a pro");
    expect(tidyTitle("عید کے لیے خوبصورت لباس")).toBe("عید کے لیے خوبصورت لباس");
    expect(tidyTitle("Fall Outfits: the Fall Edit", "fall outfits")).toBe("Fall Outfits: The Fall Edit".replace("The", "the"));
  });
});
