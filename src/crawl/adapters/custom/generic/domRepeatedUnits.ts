import type {
  DomNodeSummary,
  DomRepresentation,
  RepeatedUnitSet,
} from "@/crawl/adapters/custom/generic/types";

function ratio(count: number, total: number): number {
  return total <= 0 ? 0 : Number((count / total).toFixed(3));
}

function nodeById(representation: DomRepresentation): Map<number, DomNodeSummary> {
  return new Map(representation.nodes.map((node) => [node.nodeId, node]));
}

function titleCandidate(node: DomNodeSummary): string | undefined {
  const candidate = node.headingText ?? node.textSample;
  if (!candidate) return undefined;
  if (candidate.length < 4 || candidate.length > 160) return undefined;
  if (/^(open|past|upcoming|all|home|about|sponsors?|organizers?|faq|login|sign in)$/i.test(candidate)) {
    return undefined;
  }
  return candidate.toLowerCase();
}

function unitSignals(unit: DomNodeSummary, map: Map<number, DomNodeSummary>): {
  title?: string;
  href?: string;
  textLength: number;
  dateLike: boolean;
  locationLike: boolean;
  anchors: number;
} {
  const descendants = [unit, ...unit.childIds.map((id) => map.get(id)).filter((node): node is DomNodeSummary => Boolean(node))];
  const title = descendants.map(titleCandidate).find(Boolean);
  const href = descendants.flatMap((node) => node.hrefs).find((value) => !/^(#|javascript:|mailto:|tel:)/i.test(value));
  return {
    ...(title ? { title } : {}),
    ...(href ? { href } : {}),
    textLength: Math.max(...descendants.map((node) => node.textLength), unit.textLength),
    dateLike: descendants.some((node) => node.dateLikeCount > 0),
    locationLike: descendants.some((node) => node.locationLikeCount > 0),
    anchors: descendants.reduce((total, node) => total + node.anchorCount, 0),
  };
}

function similarFingerprint(value: string): string {
  return value
    .replace(/\bn\d+\b/g, "n")
    .replace(/#[a-z0-9]+/gi, "#")
    .split("|")
    .slice(0, 5)
    .join("|");
}

function rejectionReasons(parent: DomNodeSummary, units: DomNodeSummary[], signals: ReturnType<typeof unitSignals>[]): string[] {
  const reasons: string[] = [];
  const text = [parent.textSample, parent.classShape, ...units.map((unit) => `${unit.textSample ?? ""} ${unit.classShape}`)]
    .join(" ")
    .toLowerCase();
  const avgText = signals.reduce((total, signal) => total + signal.textLength, 0) / Math.max(1, signals.length);
  const uniqueTitles = new Set(signals.map((signal) => signal.title).filter(Boolean)).size;
  const uniqueUrls = new Set(signals.map((signal) => signal.href).filter(Boolean)).size;

  if (/\b(nav|navbar|menu|breadcrumb|footer)\b/.test(text)) reasons.push("navigation/footer-like group");
  if (/\b(filter|facet|tab|category|chip)\b/.test(text) && avgText < 120) reasons.push("filter/status-tab-like group");
  if (/\b(sponsor|partner|logo)\b/.test(text) && signals.every((signal) => !signal.dateLike)) reasons.push("sponsor/decorative group");
  if (uniqueTitles <= 1 && uniqueUrls <= 1) reasons.push("no stable per-record identity");
  if (avgText < 20 && signals.every((signal) => signal.anchors <= 1)) reasons.push("too little record text");
  return reasons;
}

function diagnosticsFor(parent: DomNodeSummary, units: DomNodeSummary[], map: Map<number, DomNodeSummary>) {
  const signals = units.map((unit) => unitSignals(unit, map));
  const titleCount = signals.filter((signal) => signal.title).length;
  const urlCount = signals.filter((signal) => signal.href).length;
  const uniqueTitleRatio = ratio(new Set(signals.map((signal) => signal.title).filter(Boolean)).size, titleCount);
  const uniqueUrlRatio = ratio(new Set(signals.map((signal) => signal.href).filter(Boolean)).size, urlCount);
  const dateCoverage = ratio(signals.filter((signal) => signal.dateLike).length, signals.length);
  const locationCoverage = ratio(signals.filter((signal) => signal.locationLike).length, signals.length);
  const anchorCoverage = ratio(signals.filter((signal) => signal.anchors > 0).length, signals.length);
  return {
    signals,
    diagnostics: {
      unitCount: units.length,
      averageTextLength: Math.round(signals.reduce((total, signal) => total + signal.textLength, 0) / Math.max(1, signals.length)),
      uniqueTitleRatio,
      uniqueUrlRatio,
      dateCoverage,
      locationCoverage,
      anchorCoverage,
      depth: units[0]?.depth ?? parent.depth + 1,
    },
  };
}

export function detectRepeatedDomUnitSets(representations: DomRepresentation[]): RepeatedUnitSet[] {
  const out: RepeatedUnitSet[] = [];
  for (const representation of representations) {
    const map = nodeById(representation);
    for (const parent of representation.nodes) {
      if (parent.childIds.length < 2) continue;
      const children = parent.childIds.map((id) => map.get(id)).filter((node): node is DomNodeSummary => Boolean(node));
      const groups = new Map<string, DomNodeSummary[]>();
      for (const child of children) {
        if (child.textLength < 8 && child.anchorCount === 0 && child.imageCount === 0) continue;
        const key = similarFingerprint(child.structuralFingerprint);
        const group = groups.get(key) ?? [];
        group.push(child);
        groups.set(key, group);
      }
      for (const [key, units] of groups) {
        if (units.length < 2) continue;
        const { signals, diagnostics } = diagnosticsFor(parent, units, map);
        const reasons = rejectionReasons(parent, units, signals);
        const structuralScore = ratio(
          units.filter((unit) => similarFingerprint(unit.structuralFingerprint) === key).length,
          units.length,
        );
        const fieldDensityScore = Number(
          (
            diagnostics.uniqueTitleRatio * 0.3 +
            diagnostics.uniqueUrlRatio * 0.25 +
            diagnostics.dateCoverage * 0.15 +
            diagnostics.locationCoverage * 0.1 +
            diagnostics.anchorCoverage * 0.2
          ).toFixed(3),
        );
        const layoutScore = 0.5;
        const penalty = reasons.length * 0.18;
        const confidence = Math.max(
          0,
          Number((structuralScore * 0.35 + fieldDensityScore * 0.5 + layoutScore * 0.15 - penalty).toFixed(3)),
        );
        if (reasons.some((reason) => /navigation|footer|sponsor|filter|tab|too little|no stable/i.test(reason))) {
          continue;
        }
        if (confidence < 0.35) continue;
        out.push({
          unitSetId: `${representation.artifactId}:${parent.nodeId}:${out.length + 1}`,
          artifactId: representation.artifactId,
          parentNodeId: parent.nodeId,
          unitNodeIds: units.map((unit) => unit.nodeId),
          structuralScore,
          fieldDensityScore,
          layoutScore,
          confidence,
          rejectionReasons: reasons,
          diagnostics,
        });
      }
    }
  }

  return out
    .sort((left, right) => {
      if (right.confidence !== left.confidence) return right.confidence - left.confidence;
      return right.diagnostics.depth - left.diagnostics.depth;
    })
    .slice(0, 20);
}
