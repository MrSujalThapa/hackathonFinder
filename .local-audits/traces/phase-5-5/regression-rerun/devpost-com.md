# Generic Structured Extraction Trace

Input: https://devpost.com/hackathons
Final URL: https://devpost.com/hackathons
Persistence: disabled

## Summary

    [structured-v2] Generic structured extraction
      input                     https://devpost.com/hackathons
      final URL                 https://devpost.com/hackathons
      static/browser            browser
      runtime                   custom
      artifacts                 27
      requests                  24
      queue requests added      0
      queue duplicates          0
      retries attempted         0
      pages requested           20
      pagination executed       yes
      pagination stop           page_cap
      browser escalated         no
      actions discovered        0
      actions executed          0
      listeners before nav       yes
      browser final rendered URL https://devpost.com/hackathons
      DOM samples                after-domcontentloaded:471/606/8, stability-1:998/2481/34
      network JSON responses     4
      nested scroll containers   0
      iframes/open shadows       0/0
      loading overlay            no
      checkpoint loaded         no
      checkpoint saved          no
      browser pages             1
      bytes inspected           476273
      arrays scanned            202
      records inspected         726
      selected artifact         network_json
      selected path             hackathons
      selected records          180
      strategy selected         structured
      DOM unit sets             20
      DOM selected units        4
      field inference           0.2s
      normalized leads          116
      valid events              116
      estimated available       13592
      estimated recall          1%
      obvious non-events        0
      title completeness        100%
      URL completeness          0%
      date completeness         59%
      duplicate rate            0%
      pagination                none
      total                     8.9s
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
| 1 | network_json | `hackathons` | 180 | 0.98 | 0.865 | 0.917 |  |
| 2 | network_json | `<root>` | 49 | 1 | 0.354 | 0.645 |  |
| 3 | network_json | `hackathons[7].themes` | 57 | 0.86 | 0.438 | 0.628 |  |
| 4 | network_json | `hackathons[1].themes` | 49 | 0.86 | 0.438 | 0.628 |  |
| 5 | network_json | `hackathons[2].themes` | 54 | 0.86 | 0.438 | 0.628 |  |
| 6 | network_json | `hackathons[6].themes` | 50 | 0.86 | 0.438 | 0.628 |  |
| 7 | network_json | `hackathons[3].themes` | 58 | 0.86 | 0.438 | 0.628 |  |
| 8 | network_json | `hackathons[5].themes` | 55 | 0.86 | 0.438 | 0.628 |  |
| 9 | network_json | `hackathons[0].themes` | 54 | 0.86 | 0.438 | 0.628 |  |
| 10 | network_json | `hackathons[8].themes` | 52 | 0.86 | 0.438 | 0.628 |  |
| 11 | network_json | `hackathons[4].themes` | 54 | 0.86 | 0.393 | 0.603 |  |

## Field Schema

```json
{
  "recordSetId": "network_json:17:103+network_json:11:43+network_json:4:1+network_json:8:13+network_json:9:23+network_json:10:33+network_json:12:53+network_json:13:63+network_json:14:73+network_json:15:83+network_json:16:93+network_json:18:113+network_json:19:123+network_json:20:133+network_json:21:143+network_json:22:153+network_json:23:163+network_json:24:173+network_json:25:183+network_json:26:193",
  "title": {
    "path": "title",
    "confidence": 1,
    "evidence": [
      "coverage=1.00",
      "unique=1.00"
    ],
    "field": "title",
    "coverage": 1
  },
  "url": {
    "path": "thumbnail_url",
    "confidence": 1,
    "evidence": [
      "urlish=180/180",
      "coverage=1.00"
    ],
    "field": "url",
    "coverage": 1
  },
  "startDate": {
    "path": "open_state",
    "confidence": 0.4,
    "evidence": [
      "parseable=0/180"
    ],
    "field": "startDate",
    "coverage": 1
  },
  "endDate": {
    "path": "time_left_to_submission",
    "confidence": 0.4,
    "evidence": [
      "parseable=0/180"
    ],
    "field": "endDate",
    "coverage": 1
  },
  "deadline": {
    "path": "submission_period_dates",
    "confidence": 0.724,
    "evidence": [
      "parseable=106/180"
    ],
    "field": "deadline",
    "coverage": 1
  },
  "location": {
    "path": "displayed_location.location",
    "confidence": 0.95,
    "evidence": [
      "coverage=1.00"
    ],
    "field": "location",
    "coverage": 1
  },
  "mode": {
    "path": "title",
    "confidence": 0.6,
    "evidence": [
      "coverage=1.00"
    ],
    "field": "mode",
    "coverage": 1
  },
  "description": {
    "path": "eligibility_requirement_invite_only_description",
    "confidence": 0.72,
    "evidence": [
      "coverage=0.07"
    ],
    "field": "description",
    "coverage": 0.06666666666666667
  },
  "status": {
    "path": "open_state",
    "confidence": 1,
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
  "confidence": 0.898,
  "rejected": false,
  "rejectionReasons": []
}
```

## DOM Inference

| Rank | Artifact | Parent | Units | Confidence | Title Unique | URL Unique | Date Coverage | Reasons |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | dom_snapshot:7 | 397 | 4 | 0.875 | 1 | 1 | 1 |  |
| 2 | html:0 | 90 | 5 | 0.81 | 1 | 1 | 0 |  |
| 3 | dom_snapshot:7 | 87 | 5 | 0.81 | 1 | 1 | 0 |  |
| 4 | html:0 | 35 | 2 | 0.8 | 1 | 1 | 0 |  |
| 5 | html:0 | 295 | 5 | 0.8 | 1 | 1 | 0 |  |
| 6 | dom_snapshot:7 | 32 | 2 | 0.8 | 1 | 1 | 0 |  |
| 7 | dom_snapshot:7 | 247 | 2 | 0.8 | 1 | 1 | 0 |  |
| 8 | dom_snapshot:7 | 397 | 2 | 0.8 | 1 | 1 | 0 |  |
| 9 | dom_snapshot:7 | 397 | 2 | 0.8 | 1 | 1 | 0 |  |
| 10 | dom_snapshot:7 | 823 | 5 | 0.8 | 1 | 1 | 0 |  |
| 11 | html:0 | 120 | 2 | 0.8 | 1 | 1 | 0 |  |
| 12 | html:0 | 235 | 4 | 0.8 | 1 | 1 | 0 |  |

## DOM Schema

```json
{
  "version": 1,
  "pageFingerprint": "839:15",
  "recordContainer": {
    "parentFingerprint": "div||hackathons-container|a3|i3|div,div,div,div,div,div,div,div",
    "unitFingerprint": "div||hackathon-tile.clearfix.open.mb-n|a1|i1|a,div,div",
    "unitTag": "div",
    "unitClassShape": "hackathon-tile.clearfix.open.mb-n"
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
    "startDate": {
      "relation": "text",
      "confidence": 1,
      "evidence": [
        "date-like text inside repeated unit"
      ]
    },
    "mode": {
      "relation": "text",
      "confidence": 1,
      "evidence": [
        "mode-like text inside repeated unit"
      ]
    }
  },
  "confidence": 0.938,
  "validationMetrics": {
    "testedRecords": 4,
    "validRecords": 4,
    "titleCompleteness": 1,
    "identityCompleteness": 1,
    "duplicateRate": 0
  }
}
```

## Quality

```json
{
  "discoveredRecords": 180,
  "normalizedLeads": 116,
  "validEventLeads": 116,
  "obviousNonEvents": 0,
  "titleCompleteness": 1,
  "urlCompleteness": 0,
  "dateCompleteness": 0.586,
  "duplicateRate": 0,
  "estimatedPrecision": 1,
  "estimatedAvailableRecords": 13592,
  "estimatedRecall": 0.009,
  "degradedReasons": [
    "under-extracted against evaluation minimum"
  ],
  "classification": "degraded_under_extraction"
}
```

## Safe Lead Sample

- DevsUnite Hiring Hackathon
- MelonJam 7
- Global Builders Hackathon: Code for Impact
- Hack Atlantic
- Build with Gemma NYC: On-Device AI for Healthcare
- 757 BLD WKND 2026 2.0
- Vitalitics 2026
- Ventura Challenge
- DTI Hackathon 2026
- AI YES :International Youth AI Competition
- Brainwave 2026 – X402 Blockchain Track
- Build with Gemini XPRIZE
- OpenAI Build Week
- Global AI Hackathon Series with Qwen Cloud
- Reddit’s Games with a Hook Hackathon
- CockroachDB × AWS Hackathon - Build with Agentic Memory
- Arm Create: AI Optimization Challenge
- Backblaze Generative Media Hackathon: Build with Genblaze on B2
- Africa Deep Tech Challenge 2026
- YouCam API Skin AI & Apparel VTO Hackathon
