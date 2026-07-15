# Generic Structured Extraction Trace

Input: https://eventornado.com/events
Final URL: https://eventornado.com/events
Persistence: disabled

## Summary

    [structured-v2] Generic structured extraction
      input                     https://eventornado.com/events
      final URL                 https://eventornado.com/events
      static/browser            browser
      runtime                   custom
      artifacts                 6
      requests                  2
      queue requests added      0
      queue duplicates          0
      retries attempted         0
      pages requested           1
      pagination executed       no
      pagination stop           no_page_param
      browser escalated         no
      actions discovered        2
      actions executed          0
      checkpoint loaded         no
      checkpoint saved          no
      browser pages             1
      bytes inspected           326476
      arrays scanned            1
      records inspected         0
      selected artifact         none
      selected path             none
      selected records          0
      strategy selected         dom
      DOM unit sets             20
      DOM selected units        9
      field inference           0.0s
      normalized leads          9
      valid events              9
      estimated available       20
      estimated recall          45%
      obvious non-events        0
      title completeness        100%
      URL completeness          100%
      date completeness         0%
      duplicate rate            0%
      pagination                none
      total                     6.5s
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

## Field Schema

```json
null
```

## DOM Inference

| Rank | Artifact | Parent | Units | Confidence | Title Unique | URL Unique | Date Coverage | Reasons |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | html:0 | 38 | 9 | 0.805 | 1 | 1 | 0 |  |
| 2 | dom_snapshot:2 | 383 | 9 | 0.805 | 1 | 1 | 0 |  |
| 3 | dom_snapshot:3 | 385 | 9 | 0.805 | 1 | 1 | 0 |  |
| 4 | dom_snapshot:5 | 385 | 18 | 0.803 | 1 | 1 | 0 |  |
| 5 | html:0 | 219 | 2 | 0.8 | 1 | 1 | 0 |  |
| 6 | html:0 | 226 | 3 | 0.8 | 1 | 1 | 0 |  |
| 7 | dom_snapshot:2 | 564 | 2 | 0.8 | 1 | 1 | 0 |  |
| 8 | dom_snapshot:2 | 571 | 3 | 0.8 | 1 | 1 | 0 |  |
| 9 | dom_snapshot:3 | 566 | 2 | 0.8 | 1 | 1 | 0 |  |
| 10 | dom_snapshot:3 | 573 | 3 | 0.8 | 1 | 1 | 0 |  |
| 11 | dom_snapshot:5 | 720 | 2 | 0.8 | 1 | 1 | 0 |  |
| 12 | dom_snapshot:5 | 727 | 3 | 0.8 | 1 | 1 | 0 |  |

## DOM Schema

```json
{
  "version": 1,
  "pageFingerprint": "255:10",
  "recordContainer": {
    "parentFingerprint": "div||row|a3|i3|div,div,div,div,div,div,div,div",
    "unitFingerprint": "div||col-lg-n.col-sm-n.col-xs-n.d-flex.pt-n|a3|i2|div",
    "unitTag": "div",
    "unitClassShape": "col-lg-n.col-sm-n.col-xs-n.d-flex.pt-n"
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
      "confidence": 0.111,
      "evidence": [
        "location-like text inside repeated unit"
      ]
    },
    "mode": {
      "relation": "text",
      "confidence": 0.444,
      "evidence": [
        "mode-like text inside repeated unit"
      ]
    }
  },
  "confidence": 0.903,
  "validationMetrics": {
    "testedRecords": 9,
    "validRecords": 9,
    "titleCompleteness": 1,
    "identityCompleteness": 1,
    "duplicateRate": 0
  }
}
```

## Quality

```json
{
  "discoveredRecords": 9,
  "normalizedLeads": 9,
  "validEventLeads": 9,
  "obviousNonEvents": 0,
  "titleCompleteness": 1,
  "urlCompleteness": 1,
  "dateCompleteness": 0,
  "duplicateRate": 0,
  "estimatedPrecision": 1,
  "estimatedAvailableRecords": 20,
  "estimatedRecall": 0.45,
  "degradedReasons": [
    "under-extracted against evaluation minimum"
  ],
  "classification": "degraded_under_extraction"
}
```

## Safe Lead Sample

- Ongoing Online UNFPA NextWave: A Youth Climate Data Challenge USD $3,000 in seed funding for three selected teams as well as Regional visibility and networking (https://eventornado.com/event/unfpa-nextwaveinnovationchallenge)
- Learn more (https://eventornado.com/event/futureminds-ai-hackathon-2026)
- Learn more (https://eventornado.com/event/democratised-agriculture-hackathon-2026)
- Learn more (https://eventornado.com/event/metsikult-andmetes-2026)
- Finished Offline Arrow Arrow Hackathon Learn more about Arrow Hackathon (https://eventornado.com/event/arrow-hackathon)
- Learn more (https://eventornado.com/event/presidendi-haridushaekaton)
- Learn more (https://eventornado.com/event/ieee-hackathon)
- Finished Private event Open GI Open GI Innovation Day 2026 Learn more about Open GI Innovation Day 2026 (https://eventornado.com/event/open-gi-innovation-day-2026)
- Learn more (https://eventornado.com/event/ep-permed-hackathon)
