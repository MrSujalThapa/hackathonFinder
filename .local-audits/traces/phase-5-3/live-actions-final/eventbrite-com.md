# Generic Structured Extraction Trace

Input: https://www.eventbrite.com/d/online/hackathon/
Final URL: https://www.eventbrite.com/d/online/hackathon/
Persistence: disabled

## Summary

    [structured-v2] Generic structured extraction
      input                     https://www.eventbrite.com/d/online/hackathon/
      final URL                 https://www.eventbrite.com/d/online/hackathon/
      static/browser            browser
      runtime                   custom
      artifacts                 15
      requests                  4
      queue requests added      0
      queue duplicates          0
      retries attempted         0
      pages requested           2
      pagination executed       no
      pagination stop           fetch_failed
      browser escalated         no
      actions discovered        20
      actions executed          0
      checkpoint loaded         no
      checkpoint saved          no
      browser pages             1
      bytes inspected           5533538
      arrays scanned            49
      records inspected         378
      selected artifact         none
      selected path             none
      selected records          0
      strategy selected         dom
      DOM unit sets             20
      DOM selected units        4
      field inference           0.2s
      normalized leads          4
      valid events              4
      estimated available       106
      estimated recall          4%
      obvious non-events        0
      title completeness        100%
      URL completeness          100%
      date completeness         0%
      duplicate rate            0%
      pagination                none
      total                     15.1s
      quality                   degraded_under_extraction
      persistence               disabled
      degraded reasons          under-extracted against evaluation minimum

## Candidate Record Sets

| Rank | Artifact | Path | Records | Structural | Event | Confidence | Reasons |
| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | json_ld | `[0].itemListElement` | 6 | 0.86 | 0.528 | 0.677 |  |
| 2 | json_ld | `itemListElement` | 40 | 1 | 0.583 | 0.631 | form/questionnaire-like array |
| 3 | network_json | `events` | 20 | 1 | 0.223 | 0.433 | form/questionnaire-like array |

## Field Schema

```json
null
```

## DOM Inference

| Rank | Artifact | Parent | Units | Confidence | Title Unique | URL Unique | Date Coverage | Reasons |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | html:0 | 466 | 4 | 0.813 | 1 | 1 | 0 |  |
| 2 | dom_snapshot:9 | 467 | 4 | 0.813 | 1 | 1 | 0 |  |
| 3 | dom_snapshot:10 | 467 | 4 | 0.813 | 1 | 1 | 0 |  |
| 4 | dom_snapshot:11 | 467 | 4 | 0.813 | 1 | 1 | 0 |  |
| 5 | dom_snapshot:12 | 467 | 4 | 0.813 | 1 | 1 | 0 |  |
| 6 | dom_snapshot:13 | 467 | 4 | 0.813 | 1 | 1 | 0 |  |
| 7 | dom_snapshot:14 | 467 | 4 | 0.813 | 1 | 1 | 0 |  |
| 8 | html:0 | 492 | 10 | 0.805 | 1 | 1 | 0 |  |
| 9 | dom_snapshot:9 | 493 | 10 | 0.805 | 1 | 1 | 0 |  |
| 10 | dom_snapshot:10 | 493 | 10 | 0.805 | 1 | 1 | 0 |  |
| 11 | dom_snapshot:11 | 493 | 10 | 0.805 | 1 | 1 | 0 |  |
| 12 | dom_snapshot:12 | 493 | 10 | 0.805 | 1 | 1 | 0 |  |

## DOM Schema

```json
{
  "version": 1,
  "pageFingerprint": "601:18",
  "recordContainer": {
    "parentFingerprint": "div||eds-bg-color--grey-n|a3|i0|div,div,div,div",
    "unitFingerprint": "div||mobile-footer__x.eds-g-cell.eds-g-cell-n-n.eds-g-cell-sw-n-n.eds-l-pad-left-n.eds-l-sn-pad-left-n.eds-l-sm-pad-left-n.eds-l-pad-top-n|a3|i0|p,ul",
    "unitTag": "div",
    "unitClassShape": "mobile-footer__x.eds-g-cell.eds-g-cell-n-n.eds-g-cell-sw-n-n.eds-l-pad-left-n.eds-l-sn-pad-left-n.eds-l-sm-pad-left-n.eds-l-pad-top-n"
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
      "confidence": 0.25,
      "evidence": [
        "location-like text inside repeated unit"
      ]
    },
    "mode": {
      "relation": "text",
      "confidence": 0.25,
      "evidence": [
        "mode-like text inside repeated unit"
      ]
    }
  },
  "confidence": 0.906,
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
  "discoveredRecords": 4,
  "normalizedLeads": 4,
  "validEventLeads": 4,
  "obviousNonEvents": 0,
  "titleCompleteness": 1,
  "urlCompleteness": 1,
  "dateCompleteness": 0,
  "duplicateRate": 0,
  "estimatedPrecision": 1,
  "estimatedAvailableRecords": 106,
  "estimatedRecall": 0.038,
  "degradedReasons": [
    "under-extracted against evaluation minimum"
  ],
  "classification": "degraded_under_extraction"
}
```

## Safe Lead Sample

- Use Eventbrite (https://www.eventbrite.com/organizer/overview/)
- Plan Events (https://www.eventbrite.com/organizer/features/sell-tickets/)
- Find Events (https://www.eventbrite.com/b/la--new-orleans/food-and-drink/)
- Connect With UsContact SupportContact SalesXFacebookLinkedInInstagramTikTok (https://www.eventbrite.com/help/en-us/contact-us/)
