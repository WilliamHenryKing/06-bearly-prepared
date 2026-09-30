import { ITEM_ORDER, type ItemId, item } from "./items";

export type TeaStyle = "view" | "neat" | "picnic" | "lounge";

export interface TeaOutcome {
  style: TeaStyle;
  title: string;
  lines: string[];
  /** Biscuits were packed but did not arrive: a solemn moment is observed. */
  silence: boolean;
  civility: number;
  arrived: ItemId[];
  lost: ItemId[];
}

/** The final tea scene is built only from what actually arrived. */
export function teaOutcome(packed: readonly ItemId[], arrived: readonly ItemId[]): TeaOutcome {
  const has = (id: ItemId) => arrived.includes(id);
  const lost = packed.filter((id) => !arrived.includes(id));
  const silence = packed.includes("biscuits") && !has("biscuits");
  const lines: string[] = [];

  let style: TeaStyle;
  let title: string;
  if (arrived.length === 0) {
    style = "view";
    title = "Just the view";
    lines.push("Nothing arrived. The bear admires the mountains with great dignity.");
  } else if (arrived.length >= 5 && has("lamp")) {
    style = "lounge";
    title = "An elaborate little lounge";
  } else if (arrived.length <= 2 && has("kettle")) {
    style = "neat";
    title = "A neat cup of tea";
  } else {
    style = "picnic";
    title = "A respectable picnic";
  }

  if (arrived.length > 0) {
    if (has("kettle")) lines.push("The kettle sings on its little stove.");
    else lines.push("No kettle. Cold stream water, served with optimism.");
    if (has("teacups"))
      lines.push(
        has("kettle")
          ? "Tea is poured into a proper cup."
          : "Stream water is served in a proper cup.",
      );
    else if (has("kettle")) lines.push("Tea is sipped straight from the spout. Nobody saw.");
    if (has("chair")) lines.push("The chair unfolds on only the third attempt.");
    if (has("blanket")) lines.push("The blanket is spread with a flourish.");
    if (has("lamp"))
      lines.push("The standard lamp is switched on. There is no socket. It is fine.");
    if (has("biscuits")) lines.push("Biscuits, intact. A triumph.");
  }
  if (silence) lines.push("A moment of silence for the biscuits.");

  const civility = arrived.reduce((sum, id) => sum + item(id).comfort, 0);
  return { style, title, lines, silence, civility, arrived: [...arrived], lost };
}

export const MAX_CIVILITY = ITEM_ORDER.reduce((s, id) => s + item(id).comfort, 0);
