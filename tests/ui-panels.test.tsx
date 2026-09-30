import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRun } from "../src/game/run";
import { teaOutcome } from "../src/game/tea";
import { Controls } from "../src/ui/Controls";
import { MuteButton } from "../src/ui/MuteButton";
import { PackPanel } from "../src/ui/PackPanel";
import { clearToast, showToast, snapshot } from "../src/ui/store";
import { teaSummary } from "../src/ui/teaCopy";

const noop = () => {};
const tally = { spills: 0, fetches: 0, topples: 0, trips: 0 };

describe("packing and neutral hike controls", () => {
  test("a named reading surface and individually described kit choices precede reordering", () => {
    const run = createRun();
    const html = renderToStaticMarkup(
      <PackPanel
        packed={run.packed}
        stats={run.stats}
        onToggle={noop}
        onMove={noop}
        onStart={noop}
      />,
    );
    expect(html).toContain('aria-labelledby="pack-title" tabindex="-1"');
    expect(html).toContain('aria-label="Kettle" aria-describedby="kit-kettle-stats"');
    expect(html).toContain('id="kit-kettle-stats"');
    expect(html).toContain('aria-label="Move Biscuits up" disabled=""');
    expect(html).toContain('aria-label="Move Kettle down" disabled=""');
    expect(html.match(/class="pack-reorder/g)).toHaveLength(6);
  });
  test("the start focus group permits global W/Space while its four native buttons stay labelled", () => {
    const html = renderToStaticMarkup(<Controls />);
    expect(html).toContain('aria-label="Hike controls" tabindex="-1"');
    expect(html.match(/data-game-key="true"/g)).toHaveLength(4);
    expect(html).toContain('aria-label="Walk, hold to keep walking (W or up arrow)"');
    expect(html).toContain('data-action="jump"');
  });
  test("the dialog Sound control has a visible label and documented key", () => {
    const html = renderToStaticMarkup(<MuteButton inline />);
    expect(html).toContain('aria-keyshortcuts="M"');
    expect(html).toContain("Sound on");
    expect(html).toContain("mute-inline");
  });
});
describe("truthful results and transient state", () => {
  test("a trip with a restored load cannot claim an unspilled hike", () => {
    const result = teaOutcome(["kettle", "biscuits"], ["kettle", "biscuits"]);
    expect(teaSummary({ ...tally, trips: 1 }, result)).toContain("1 trip");
    expect(teaSummary({ ...tally, trips: 1 }, result)).not.toContain("without spilling");
  });
  test("goose loss cannot claim a clean finish even when spill counters are zero", () => {
    const result = teaOutcome(["kettle", "biscuits"], ["kettle"]);
    expect(teaSummary(tally, result)).toContain("1 thing was left behind");
    expect(teaSummary(tally, result)).not.toContain("without spilling");
  });
  test("an intact uneventful hike keeps its earned clean result", () => {
    expect(teaSummary(tally, teaOutcome(["kettle"], ["kettle"]))).toBe(
      "Carried 1 thing to the top without spilling a thing.",
    );
  });
  test("Fetch is unavailable while airborne or already busy", () => {
    const run = createRun();
    run.phase = "hiking";
    run.airborne = true;
    expect(snapshot(run, null, -1, "done").busy).toBe(true);
    run.airborne = false;
    run.busy = 1;
    expect(snapshot(run, null, -1, "done").busy).toBe(true);
    run.busy = 0;
    expect(snapshot(run, null, -1, "done").busy).toBe(false);
  });
  test("replay can clear the toast rather than repeating yesterday's spill", () => {
    showToast("A kettle fell.");
    expect(snapshot(createRun(), null, -1, "done").toast?.text).toBe("A kettle fell.");
    clearToast();
    expect(snapshot(createRun(), null, -1, "done").toast).toBeNull();
  });
});
