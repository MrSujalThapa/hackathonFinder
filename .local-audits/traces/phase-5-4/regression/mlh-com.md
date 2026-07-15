# Generic Structured Extraction Trace

Input: https://www.mlh.com/events
Final URL: https://www.mlh.com/seasons/2027/events
Persistence: disabled

## Summary

    [structured-v2] Generic structured extraction
      input                     https://www.mlh.com/events
      final URL                 https://www.mlh.com/seasons/2027/events
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
      bytes inspected           476665
      arrays scanned            40
      records inspected         124
      selected artifact         router_data
      selected path             props.upcomingEvents
      selected records          63
      strategy selected         structured
      DOM unit sets             15
      DOM selected units        2
      field inference           0.1s
      normalized leads          63
      valid events              63
      estimated available       63
      estimated recall          100%
      obvious non-events        0
      title completeness        100%
      URL completeness          100%
      date completeness         100%
      duplicate rate            0%
      pagination                none
      total                     3.5s
      quality                   healthy_complete
      persistence               disabled
      AI invoked                no
      AI accepted               no
      AI candidate groups       5
      AI rejected reasons       deterministic extraction already produced leads

## Candidate Record Sets

| Rank | Artifact | Path | Records | Structural | Event | Confidence | Reasons |
| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | router_data | `props.upcomingEvents` | 63 | 1 | 0.708 | 0.839 |  |
| 2 | router_data | `props.navigation.primary[1].children` | 4 | 0.88 | 0.595 | 0.723 |  |
| 3 | router_data | `props.pastEvents` | 2 | 0.84 | 0.595 | 0.705 |  |
| 4 | router_data | `props.navigation.primary[0].children` | 4 | 0.88 | 0.55 | 0.699 |  |
| 5 | router_data | `props.navigation.footer[0].children` | 3 | 0.86 | 0.55 | 0.69 |  |
| 6 | router_data | `props.navigation.footer[1].children` | 3 | 0.86 | 0.527 | 0.677 |  |
| 7 | router_data | `props.navigation.primary[3].children` | 5 | 0.9 | 0.483 | 0.671 |  |
| 8 | router_data | `props.navigation.footer[3].children` | 4 | 0.88 | 0.483 | 0.662 |  |
| 9 | router_data | `props.navigation.primary` | 7 | 0.725 | 0.595 | 0.653 |  |
| 10 | router_data | `props.navigation.footer` | 4 | 0.693 | 0.595 | 0.639 |  |
| 11 | router_data | `props.navigation.primary[2].children` | 4 | 0.88 | 0.438 | 0.637 |  |
| 12 | router_data | `props.navigation.footer[2].children` | 3 | 0.86 | 0.438 | 0.628 |  |

## Field Schema

```json
{
  "recordSetId": "router_data:1:15",
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
    "path": "slug",
    "confidence": 1,
    "evidence": [
      "urlish=63/63",
      "coverage=1.00"
    ],
    "field": "url",
    "coverage": 1
  },
  "startDate": {
    "path": "startsAt",
    "confidence": 0.95,
    "evidence": [
      "parseable=63/63"
    ],
    "field": "startDate",
    "coverage": 1
  },
  "endDate": {
    "path": "endsAt",
    "confidence": 0.95,
    "evidence": [
      "parseable=63/63"
    ],
    "field": "endDate",
    "coverage": 1
  },
  "deadline": {
    "path": "endsAt",
    "confidence": 0.95,
    "evidence": [
      "parseable=63/63"
    ],
    "field": "deadline",
    "coverage": 1
  },
  "location": {
    "path": "location",
    "confidence": 0.95,
    "evidence": [
      "coverage=1.00"
    ],
    "field": "location",
    "coverage": 1
  },
  "mode": {
    "path": "formatType",
    "confidence": 0.75,
    "evidence": [
      "coverage=1.00"
    ],
    "field": "mode",
    "coverage": 1
  },
  "description": {
    "path": "url",
    "confidence": 0.55,
    "evidence": [
      "coverage=1.00"
    ],
    "field": "description",
    "coverage": 1
  },
  "status": {
    "path": "status",
    "confidence": 0.75,
    "evidence": [
      "coverage=1.00"
    ],
    "field": "status",
    "coverage": 1
  },
  "sourceRecordId": {
    "path": "id",
    "confidence": 1,
    "evidence": [
      "coverage=1.00"
    ],
    "field": "sourceRecordId",
    "coverage": 1
  },
  "confidence": 0.955,
  "rejected": false,
  "rejectionReasons": []
}
```

## DOM Inference

| Rank | Artifact | Parent | Units | Confidence | Title Unique | URL Unique | Date Coverage | Reasons |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | html:0 | 42 | 2 | 0.85 | 1 | 1 | 0 |  |
| 2 | html:0 | 1714 | 3 | 0.8 | 1 | 1 | 0 |  |
| 3 | html:0 | 1723 | 3 | 0.8 | 1 | 1 | 0 |  |
| 4 | html:0 | 1732 | 3 | 0.8 | 1 | 1 | 0 |  |
| 5 | html:0 | 1741 | 4 | 0.8 | 1 | 1 | 0 |  |
| 6 | html:0 | 1711 | 4 | 0.8 | 1 | 1 | 0 |  |
| 7 | html:0 | 1752 | 2 | 0.8 | 1 | 1 | 0 |  |
| 8 | html:0 | 1639 | 2 | 0.7 | 1 | 0 | 0 |  |
| 9 | html:0 | 927 | 28 | 0.694 | 1 | 0 | 0 |  |
| 10 | html:0 | 45 | 35 | 0.692 | 1 | 0 | 0 |  |
| 11 | html:0 | 136 | 2 | 0.6 | 1 | 0 | 0 |  |
| 12 | html:0 | 639 | 2 | 0.6 | 1 | 0 | 0 |  |

## DOM Schema

```json
{
  "version": 1,
  "pageFingerprint": "1759:15",
  "recordContainer": {
    "parentFingerprint": "div||space-y-n|a3|i3|div,div",
    "unitFingerprint": "div|||a3|i3|h3,div",
    "unitTag": "div",
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
      "confidence": 1,
      "evidence": [
        "record-specific href within repeated unit"
      ]
    },
    "location": {
      "relation": "text",
      "confidence": 1,
      "evidence": [
        "location-like text inside repeated unit"
      ]
    },
    "mode": {
      "relation": "text",
      "confidence": 0.5,
      "evidence": [
        "mode-like text inside repeated unit"
      ]
    }
  },
  "confidence": 0.925,
  "validationMetrics": {
    "testedRecords": 2,
    "validRecords": 2,
    "titleCompleteness": 1,
    "identityCompleteness": 1,
    "duplicateRate": 0
  }
}
```

## Quality

```json
{
  "discoveredRecords": 63,
  "normalizedLeads": 63,
  "validEventLeads": 63,
  "obviousNonEvents": 0,
  "titleCompleteness": 1,
  "urlCompleteness": 1,
  "dateCompleteness": 1,
  "duplicateRate": 0,
  "estimatedPrecision": 1,
  "estimatedAvailableRecords": 63,
  "estimatedRecall": 1,
  "degradedReasons": [],
  "classification": "healthy_complete"
}
```

## Safe Lead Sample

- Global Hack Week: Season Launch (https://www.mlh.com/global-hack-week-season-launch-46)
- Midnight Virtual Hackathon (https://www.mlh.com/midnight-virtual-hackathon)
- Hack the 6ix (https://www.mlh.com/hack-the-6ix-cf)
- Hexafalls 2 (https://www.mlh.com/hexafalls-2)
- Global Hack Week: Agents (https://www.mlh.com/global-hack-week-agents)
- PEC HACKS 4.0 (https://www.mlh.com/pec-hacks-4-0)
- HackMTY (https://www.mlh.com/hackmty-2026)
- Global Hack Week: Data (https://www.mlh.com/global-hack-week-data)
- HackRice (https://www.mlh.com/hackrice-71)
- VTHacks 14 (https://www.mlh.com/vthacks-14)
- Hack the North (https://www.mlh.com/hack-the-north-e8)
- HopHacks (https://www.mlh.com/hophacks-40-1ae4)
- SteelHacks XIII (https://www.mlh.com/steelhacks-xiii)
- HackGT 13 (https://www.mlh.com/hackgt-13)
- ShellHacks (https://www.mlh.com/shellhacks-b9)
- hackUMBC (https://www.mlh.com/hackumbc-9b)
- DivHacks (https://www.mlh.com/divhacks-14)
- BigRed//Hacks 2026 (https://www.mlh.com/bigred-hacks-2026)
- Hack Dearborn 5: Conjure Reality (https://www.mlh.com/hack-dearborn-5-conjure-reality)
- Rowdy Hacks (https://www.mlh.com/rowdy-hacks)
