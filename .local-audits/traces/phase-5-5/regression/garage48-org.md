# Generic Structured Extraction Trace

Input: https://garage48.org/events
Final URL: https://garage48.org/events
Persistence: disabled

## Summary

    [structured-v2] Generic structured extraction
      input                     https://garage48.org/events
      final URL                 https://garage48.org/events
      static/browser            browser
      runtime                   custom
      artifacts                 2
      requests                  1
      queue requests added      0
      queue duplicates          0
      retries attempted         0
      pages requested           1
      pagination executed       no
      pagination stop           no_page_param
      browser escalated         no
      actions discovered        0
      actions executed          0
      listeners before nav       yes
      browser final rendered URL https://garage48.org/events
      DOM samples                after-domcontentloaded:3542/1158/13, stability-1:3542/1158/13, stability-2:3542/1158/13
      network JSON responses     0
      nested scroll containers   0
      iframes/open shadows       0/0
      loading overlay            no
      checkpoint loaded         no
      checkpoint saved          no
      browser pages             1
      bytes inspected           501767
      arrays scanned            0
      records inspected         0
      selected artifact         none
      selected path             none
      selected records          0
      strategy selected         dom
      DOM unit sets             20
      DOM selected units        194
      field inference           0.0s
      normalized leads          194
      valid events              194
      estimated available       194
      estimated recall          100%
      obvious non-events        0
      title completeness        100%
      URL completeness          100%
      date completeness         0%
      duplicate rate            0%
      pagination                none
      total                     6.7s
      quality                   healthy_complete
      persistence               disabled
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
| 1 | html:0 | 97 | 194 | 0.825 | 0.969 | 1 | 0 |  |
| 2 | dom_snapshot:1 | 97 | 194 | 0.825 | 0.969 | 1 | 0 |  |
| 3 | html:0 | 29 | 4 | 0.813 | 1 | 1 | 0 |  |
| 4 | dom_snapshot:1 | 29 | 4 | 0.813 | 1 | 1 | 0 |  |
| 5 | html:0 | 6 | 5 | 0.8 | 1 | 1 | 0 |  |
| 6 | dom_snapshot:1 | 6 | 5 | 0.8 | 1 | 1 | 0 |  |
| 7 | html:0 | 123 | 2 | 0.6 | 1 | 0 | 0 |  |
| 8 | html:0 | 183 | 2 | 0.6 | 1 | 0 | 0 |  |
| 9 | html:0 | 198 | 2 | 0.6 | 1 | 0 | 0 |  |
| 10 | html:0 | 213 | 2 | 0.6 | 1 | 0 | 0 |  |
| 11 | html:0 | 228 | 2 | 0.6 | 1 | 0 | 0 |  |
| 12 | html:0 | 258 | 2 | 0.6 | 1 | 0 | 0 |  |

## DOM Schema

```json
{
  "version": 1,
  "pageFingerprint": "3000:7",
  "recordContainer": {
    "parentFingerprint": "div||gr-events.gr-past-events|a3|i0|div,div,div,div,div,div,div,div",
    "unitFingerprint": "div||gr-event|a3|i0|div,div",
    "unitTag": "div",
    "unitClassShape": "gr-event"
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
      "confidence": 0.603,
      "evidence": [
        "location-like text inside repeated unit"
      ]
    },
    "mode": {
      "relation": "text",
      "confidence": 0.237,
      "evidence": [
        "mode-like text inside repeated unit"
      ]
    }
  },
  "confidence": 0.912,
  "validationMetrics": {
    "testedRecords": 194,
    "validRecords": 194,
    "titleCompleteness": 1,
    "identityCompleteness": 1,
    "duplicateRate": 0
  }
}
```

## Quality

```json
{
  "discoveredRecords": 194,
  "normalizedLeads": 194,
  "validEventLeads": 194,
  "obviousNonEvents": 0,
  "titleCompleteness": 1,
  "urlCompleteness": 1,
  "dateCompleteness": 0,
  "duplicateRate": 0,
  "estimatedPrecision": 1,
  "estimatedAvailableRecords": 194,
  "estimatedRecall": 1,
  "degradedReasons": [],
  "classification": "healthy_complete"
}
```

## Safe Lead Sample

- Garage48 15-Year Anniversary Hackathon (https://garage48.org/events/g48anniversaryhack15)
- Tech for Agriculture Kenya Edition (https://garage48.org/events/techforagriculturekenya)
- Hack the Border (https://garage48.org/events/hack-the-border)
- Empowering Women Idea Garage (https://garage48.org/events/empowering-women-eesti-ettevotlusprogramm)
- Empowering Women: Digitalisation and Export Acceleration 2025 (https://garage48.org/events/empowering-women-digitalisation-and-export-acceleration-2025)
- Female Founders Academy (https://garage48.org/events/femalefoundersacademynairobi)
- Klavani Jalkahäkk (https://garage48.org/events/klavani-jalkahakk-1)
- Hack the Future (https://garage48.org/events/hack-the-future)
- Minu Lääne-Virumaa Hackathon (https://garage48.org/events/minu-laane-viru-hackathon)
- Empowering Women Ettevõtlusprogramm (https://garage48.org/events/empowering-women-ettevotlusprogramm)
- Häkaton Andmetorm 2024 (https://garage48.org/events/andmetorm)
- EdTech Hackathon in Armenia (https://garage48.org/events/edtech-armenia)
- Green Growth AgriHack (https://garage48.org/events/greengrowth-agrihack)
- Empowering Women Mentorite Meistriklass (https://garage48.org/events/empowering-women-mentorite-meistriklass)
- Empowering Women Idee Garage (https://garage48.org/events/empowering-women-idee-garage)
- Empowering Women: Digitalisation and Export Acceleration (https://garage48.org/events/empowering-women)
- Ecotech Hackathon- Making Urban Water Smart (https://garage48.org/events/ecotechhackathon)
- #OceanHack4EU (https://garage48.org/events/oceanhack4eu)
- Empowering Women Ukraine 2024 ACCELERATION: Entrepreneurship programme for business development (https://garage48.org/events/empowering-women-ukraine-2024-acceleration-entrepreneurship-programme-for-business-development)
- DIGI-GREEN HACKATHON (https://garage48.org/events/digi-green-hackathon)
