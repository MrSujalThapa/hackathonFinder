import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sourceFilterClause } from "@/server/candidates/repository";

describe("sourceFilterClause", () => {
  it("quotes custom source ids for PostgREST jsonb path filters", () => {
    assert.equal(
      sourceFilterClause("custom:hackathonmap"),
      'source.eq.custom:hackathonmap,source_ids->>"custom:hackathonmap".not.is.null',
    );
  });

  it("keeps built-in source filters parseable", () => {
    assert.equal(
      sourceFilterClause("luma"),
      'source.eq.luma,source_ids->>"luma".not.is.null',
    );
  });
});
