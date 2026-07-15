# Generic Structured Extraction Trace

Input: https://www.mlh.com/seasons/2026/events
Final URL: https://www.mlh.com/seasons/2026/events
Persistence: disabled

## Summary

    [structured-v2] Generic structured extraction
      input                     https://www.mlh.com/seasons/2026/events
      final URL                 https://www.mlh.com/seasons/2026/events
      static/browser            static
      runtime                   custom
      artifacts                 2
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
      bytes inspected           554149
      arrays scanned            39
      records inspected         180
      selected artifact         router_data
      selected path             props.navigation.primary[1].children
      selected records          4
      strategy selected         structured
      DOM unit sets             8
      DOM selected units        3
      field inference           0.2s
      normalized leads          4
      valid events              4
      estimated available       253
      estimated recall          2%
      obvious non-events        0
      title completeness        100%
      URL completeness          50%
      date completeness         0%
      duplicate rate            0%
      pagination                none
      total                     5.0s
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
| 1 | router_data | `props.pastEvents` | 253 | 1 | 0.708 | 0.839 |  |
| 2 | router_data | `props.navigation.primary[1].children` | 4 | 0.88 | 0.595 | 0.723 |  |
| 3 | router_data | `props.navigation.primary[0].children` | 4 | 0.88 | 0.55 | 0.699 |  |
| 4 | router_data | `props.navigation.footer[0].children` | 3 | 0.86 | 0.55 | 0.69 |  |
| 5 | router_data | `props.navigation.footer[1].children` | 3 | 0.86 | 0.527 | 0.677 |  |
| 6 | router_data | `props.navigation.primary[3].children` | 5 | 0.9 | 0.483 | 0.671 |  |
| 7 | router_data | `props.navigation.footer[3].children` | 4 | 0.88 | 0.483 | 0.662 |  |
| 8 | router_data | `props.navigation.primary` | 7 | 0.725 | 0.595 | 0.653 |  |
| 9 | router_data | `props.navigation.footer` | 4 | 0.693 | 0.595 | 0.639 |  |
| 10 | router_data | `props.navigation.primary[2].children` | 4 | 0.88 | 0.438 | 0.637 |  |
| 11 | router_data | `props.navigation.footer[2].children` | 3 | 0.86 | 0.438 | 0.628 |  |

## Field Schema

```json
{
  "recordSetId": "router_data:1:4",
  "title": {
    "path": "name",
    "confidence": 1,
    "evidence": [
      "coverage=1.00",
      "unique=1.00"
    ],
    "field": "title",
    "coverage": 1
  },
  "url": {
    "path": "href",
    "confidence": 1,
    "evidence": [
      "urlish=4/4",
      "coverage=1.00"
    ],
    "field": "url",
    "coverage": 1
  },
  "sourceRecordId": {
    "path": "name",
    "confidence": 0.55,
    "evidence": [
      "coverage=1.00"
    ],
    "field": "sourceRecordId",
    "coverage": 1
  },
  "confidence": 0.717,
  "rejected": false,
  "rejectionReasons": []
}
```

## DOM Inference

| Rank | Artifact | Parent | Units | Confidence | Title Unique | URL Unique | Date Coverage | Reasons |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | html:0 | 673 | 3 | 0.8 | 1 | 1 | 0 |  |
| 2 | html:0 | 682 | 3 | 0.8 | 1 | 1 | 0 |  |
| 3 | html:0 | 691 | 3 | 0.8 | 1 | 1 | 0 |  |
| 4 | html:0 | 700 | 4 | 0.8 | 1 | 1 | 0 |  |
| 5 | html:0 | 670 | 4 | 0.8 | 1 | 1 | 0 |  |
| 6 | html:0 | 711 | 2 | 0.8 | 1 | 1 | 0 |  |
| 7 | html:0 | 43 | 24 | 0.683 | 1 | 0 | 0 |  |
| 8 | html:0 | 464 | 2 | 0.6 | 1 | 0 | 0 |  |

## DOM Schema

```json
{
  "version": 1,
  "pageFingerprint": "718:15",
  "recordContainer": {
    "parentFingerprint": "ul||space-y-n|a3|i0|li,li,li",
    "unitFingerprint": "li||font-normal.text-base.leading-n.hover:underline.text-blue-n.hover:text-blue-n.dark:text-gray-n.dark:hover:text-gray-n|a1|i0|a",
    "unitTag": "li",
    "unitClassShape": "font-normal.text-base.leading-n.hover:underline.text-blue-n.hover:text-blue-n.dark:text-gray-n.dark:hover:text-gray-n"
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
      "confidence": 0.667,
      "evidence": [
        "record-specific href within repeated unit"
      ]
    }
  },
  "confidence": 0.817,
  "validationMetrics": {
    "testedRecords": 3,
    "validRecords": 3,
    "titleCompleteness": 1,
    "identityCompleteness": 0.667,
    "duplicateRate": 0
  }
}
```

## Quality

```json
{
  "discoveredRecords": 4,
  "normalizedLeads": 4,
  "validEventLeads": 4,
  "obviousNonEvents": 0,
  "titleCompleteness": 1,
  "urlCompleteness": 0.5,
  "dateCompleteness": 0,
  "duplicateRate": 0,
  "estimatedPrecision": 1,
  "estimatedAvailableRecords": 253,
  "estimatedRecall": 0.016,
  "degradedReasons": [
    "under-extracted against evaluation minimum"
  ],
  "classification": "degraded_under_extraction"
}
```

## Safe Lead Sample

- Work with MLH (https://www.mlh.com/event-membership)
- Organizer Guide
- Coaches (https://www.mlh.com/coaches)
- Hackcon
