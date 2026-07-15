# Generic Structured Extraction Trace

Input: https://hackathons.space/
Final URL: https://www.hackathons.space/
Persistence: disabled

## Summary

    [structured-v2] Generic structured extraction
      input                     https://hackathons.space/
      final URL                 https://www.hackathons.space/
      static/browser            browser
      runtime                   custom
      artifacts                 5
      requests                  2
      queue requests added      0
      queue duplicates          0
      retries attempted         0
      pages requested           1
      pagination executed       yes
      pagination stop           no_growth
      browser escalated         no
      actions discovered        5
      actions executed          1
      identities after actions  6
      checkpoint loaded         no
      checkpoint saved          no
      browser pages             2
      bytes inspected           356626
      arrays scanned            0
      records inspected         0
      selected artifact         none
      selected path             none
      selected records          0
      strategy selected         none
      DOM unit sets             4
      DOM selected units        12
      field inference           0.0s
      normalized leads          0
      valid events              0
      estimated available       20
      estimated recall          0%
      obvious non-events        0
      title completeness        0%
      URL completeness          0%
      date completeness         0%
      duplicate rate            0%
      pagination                none
      total                     12.6s
      quality                   failed
      persistence               disabled
      degraded reasons          under-extracted against evaluation minimum

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
| 1 | html:0 | 63 | 12 | 0.739 | 1 | 0 | 0.75 |  |
| 2 | dom_snapshot:1 | 63 | 12 | 0.739 | 1 | 0 | 0.75 |  |
| 3 | dom_snapshot:3 | 40 | 2 | 0.575 | 1 | 0 | 0 |  |
| 4 | dom_snapshot:4 | 40 | 2 | 0.575 | 1 | 0 | 0 |  |

## DOM Schema

```json
null
```

## Quality

```json
{
  "discoveredRecords": 0,
  "normalizedLeads": 0,
  "validEventLeads": 0,
  "obviousNonEvents": 0,
  "titleCompleteness": 0,
  "urlCompleteness": 0,
  "dateCompleteness": 0,
  "duplicateRate": 0,
  "estimatedPrecision": 0,
  "estimatedAvailableRecords": 20,
  "estimatedRecall": 0,
  "degradedReasons": [
    "under-extracted against evaluation minimum"
  ],
  "classification": "failed"
}
```

## Safe Lead Sample

