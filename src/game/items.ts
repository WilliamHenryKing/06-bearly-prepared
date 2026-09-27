// The prop set. Weights are in rough kilograms, heights in metres of stack they occupy.
// Grip is the tilt (radians) the item tolerates before it starts to slide.

export type ItemId = "kettle" | "teacups" | "biscuits" | "blanket" | "chair" | "lamp";

export interface ItemDef {
  id: ItemId;
  name: string;
  weight: number;
  height: number;
  grip: number;
  comfort: number;
  blurb: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  kettle: {
    id: "kettle",
    name: "Kettle",
    weight: 2.4,
    height: 0.3,
    grip: 0.3,
    comfort: 3,
    blurb: "Enamel, heavy, essential.",
  },
  teacups: {
    id: "teacups",
    name: "Teacups",
    weight: 0.9,
    height: 0.2,
    grip: 0.26,
    comfort: 2,
    blurb: "Two cups, one saucer. Rattly.",
  },
  biscuits: {
    id: "biscuits",
    name: "Biscuits",
    weight: 0.5,
    height: 0.16,
    grip: 0.2,
    comfort: 3,
    blurb: "Shortbread. Slippery tin.",
  },
  blanket: {
    id: "blanket",
    name: "Blanket",
    weight: 1.1,
    height: 0.26,
    grip: 0.42,
    comfort: 2,
    blurb: "Soft: whatever sits on it grips.",
  },
  chair: {
    id: "chair",
    name: "Folding chair",
    weight: 2.0,
    height: 0.36,
    grip: 0.32,
    comfort: 3,
    blurb: "Painted wood. Folds, mostly.",
  },
  lamp: {
    id: "lamp",
    name: "Standard lamp",
    weight: 2.2,
    height: 1.05,
    grip: 0.3,
    comfort: 4,
    blurb: "For ambience. Very tall.",
  },
};

export const ITEM_ORDER: ItemId[] = ["kettle", "teacups", "biscuits", "blanket", "chair", "lamp"];

export const item = (id: ItemId): ItemDef => ITEMS[id];
