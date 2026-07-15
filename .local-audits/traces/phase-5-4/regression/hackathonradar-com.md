# Generic Structured Extraction Trace

Input: https://www.hackathonradar.com/database
Final URL: https://www.hackathonradar.com/database
Persistence: disabled

## Summary

    [structured-v2] Generic structured extraction
      input                     https://www.hackathonradar.com/database
      final URL                 https://www.hackathonradar.com/database
      static/browser            static
      runtime                   custom
      artifacts                 7
      requests                  2
      queue requests added      0
      queue duplicates          0
      retries attempted         0
      pages requested           2
      pagination executed       no
      pagination stop           fetch_failed
      browser escalated         no
      actions discovered        0
      actions executed          0
      checkpoint loaded         no
      checkpoint saved          no
      browser pages             0
      bytes inspected           338494
      arrays scanned            4
      records inspected         16
      selected artifact         none
      selected path             none
      selected records          0
      strategy selected         dom
      DOM unit sets             1
      DOM selected units        3
      field inference           0.0s
      normalized leads          3
      valid events              3
      estimated available       25
      estimated recall          12%
      obvious non-events        0
      title completeness        100%
      URL completeness          100%
      date completeness         0%
      duplicate rate            0%
      pagination                none
      total                     1.9s
      quality                   degraded_under_extraction
      persistence               disabled
      degraded reasons          under-extracted against evaluation minimum
      AI invoked                no
      AI accepted               no
      AI candidate groups       4
      AI rejected reasons       deterministic extraction already produced leads

## Candidate Record Sets

| Rank | Artifact | Path | Records | Structural | Event | Confidence | Reasons |
| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | json_ld | `[2].@graph` | 10 | 0.9 | 0.438 | 0.646 |  |
| 2 | json_ld | `<root>` | 3 | 0.694 | 0.595 | 0.64 |  |
| 3 | embedded_json | `<root>` | 3 | 0.694 | 0.595 | 0.64 |  |

## Field Schema

```json
null
```

## DOM Inference

| Rank | Artifact | Parent | Units | Confidence | Title Unique | URL Unique | Date Coverage | Reasons |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | html:0 | 13 | 3 | 0.8 | 1 | 1 | 0 |  |

## DOM Schema

```json
{
  "version": 1,
  "pageFingerprint": "236:10",
  "recordContainer": {
    "parentFingerprint": "div||flex.min-h-n.flex-n.flex-col.gap-n.overflow-auto.group-data-[collapsible=icon]:overflow-hidden.scrollbar-thin|a3|i0|div,div,div",
    "unitFingerprint": "div||relative.flex.w-full.min-w-n.flex-col.p-n|a3|i0|div,div",
    "unitTag": "div",
    "unitClassShape": "relative.flex.w-full.min-w-n.flex-col.p-n"
  },
  "fields": {
    "title": {
      "relation": "heading",
      "confidence": 1,
      "evidence": [
        "unique title-like text within repeated unit"
      ]
    },
    "url": {
      "relation": "anchor",
      "confidence": 1,
      "evidence": [
        "record-specific href within repeated unit"
      ]
    }
  },
  "confidence": 0.9,
  "validationMetrics": {
    "testedRecords": 3,
    "validRecords": 3,
    "titleCompleteness": 1,
    "identityCompleteness": 1,
    "duplicateRate": 0
  }
}
```

## Quality

```json
{
  "discoveredRecords": 3,
  "normalizedLeads": 3,
  "validEventLeads": 3,
  "obviousNonEvents": 0,
  "titleCompleteness": 1,
  "urlCompleteness": 1,
  "dateCompleteness": 0,
  "duplicateRate": 0,
  "estimatedPrecision": 1,
  "estimatedAvailableRecords": 25,
  "estimatedRecall": 0.12,
  "degradedReasons": [
    "under-extracted against evaluation minimum"
  ],
  "classification": "degraded_under_extraction"
}
```

## Safe Lead Sample

- HackathonsBrowseJudge OpportunitiesSponsorsOrganizersMapDiscover (https://www.hackathonradar.com/judge-opportunities)
- ExploreStatsState of HackathonsChangelog (https://www.hackathonradar.com/stats)
- PersonalPassportFavoritesSettings (https://www.hackathonradar.com/passport)
