# Generic Structured Extraction Trace

Input: https://taikai.network/en/hackathons
Final URL: https://taikai.network/en/hackathons
Persistence: disabled

## Summary

    [structured-v2] Generic structured extraction
      input                     https://taikai.network/en/hackathons
      final URL                 https://taikai.network/en/hackathons
      static/browser            static
      runtime                   custom
      artifacts                 6
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
      bytes inspected           524194
      arrays scanned            50
      records inspected         373
      selected artifact         none
      selected path             none
      selected records          0
      strategy selected         dom
      DOM unit sets             20
      DOM selected units        2
      field inference           0.0s
      normalized leads          2
      valid events              2
      estimated available       40
      estimated recall          5%
      obvious non-events        0
      title completeness        100%
      URL completeness          50%
      date completeness         0%
      duplicate rate            0%
      pagination                none
      total                     24.3s
      quality                   degraded_under_extraction
      persistence               disabled
      degraded reasons          under-extracted against evaluation minimum
      AI invoked                no
      AI accepted               no
      AI candidate groups       5
      AI rejected reasons       deterministic extraction already produced leads

## Candidate Record Sets

| Rank | Artifact | Path | Records | Structural | Event | Confidence | Reasons |
| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | json_ld | `itemListElement` | 40 | 1 | 0.494 | 0.722 |  |

## Field Schema

```json
null
```

## DOM Inference

| Rank | Artifact | Parent | Units | Confidence | Title Unique | URL Unique | Date Coverage | Reasons |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | html:0 | 14 | 2 | 0.8 | 1 | 1 | 0 |  |
| 2 | html:0 | 626 | 7 | 0.8 | 1 | 1 | 0 |  |
| 3 | html:0 | 643 | 6 | 0.8 | 1 | 1 | 0 |  |
| 4 | html:0 | 658 | 4 | 0.8 | 1 | 1 | 0 |  |
| 5 | html:0 | 669 | 6 | 0.8 | 1 | 1 | 0 |  |
| 6 | html:0 | 34 | 2 | 0.8 | 1 | 1 | 0 |  |
| 7 | html:0 | 43 | 4 | 0.8 | 1 | 1 | 0 |  |
| 8 | html:0 | 92 | 20 | 0.8 | 1 | 1 | 0 |  |
| 9 | html:0 | 623 | 4 | 0.8 | 1 | 1 | 0 |  |
| 10 | html:0 | 8 | 2 | 0.8 | 1 | 1 | 0 |  |
| 11 | html:0 | 28 | 2 | 0.8 | 1 | 1 | 0 |  |
| 12 | html:0 | 614 | 2 | 0.8 | 1 | 1 | 0 |  |

## DOM Schema

```json
{
  "version": 1,
  "pageFingerprint": "698:14",
  "recordContainer": {
    "parentFingerprint": "ul||styles-module__x|a2|i0|li,li,li,li",
    "unitFingerprint": "li|||a1|i0|a",
    "unitTag": "li",
    "unitClassShape": ""
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
      "confidence": 0.5,
      "evidence": [
        "record-specific href within repeated unit"
      ]
    }
  },
  "confidence": 0.775,
  "validationMetrics": {
    "testedRecords": 2,
    "validRecords": 2,
    "titleCompleteness": 1,
    "identityCompleteness": 0.5,
    "duplicateRate": 0
  }
}
```

## Quality

```json
{
  "discoveredRecords": 2,
  "normalizedLeads": 2,
  "validEventLeads": 2,
  "obviousNonEvents": 0,
  "titleCompleteness": 1,
  "urlCompleteness": 0.5,
  "dateCompleteness": 0,
  "duplicateRate": 0,
  "estimatedPrecision": 1,
  "estimatedAvailableRecords": 40,
  "estimatedRecall": 0.05,
  "degradedReasons": [
    "under-extracted against evaluation minimum"
  ],
  "classification": "degraded_under_extraction"
}
```

## Safe Lead Sample

- Hackathons
- Blog (https://taikai.network/en/blog)
