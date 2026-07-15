# Generic Structured Extraction Trace

Input: https://eventornado.com/hackathons
Final URL: https://eventornado.com/hackathons
Persistence: disabled

## Summary

    [structured-v2] Generic structured extraction
      input                     https://eventornado.com/hackathons
      final URL                 https://eventornado.com/hackathons
      static/browser            browser
      runtime                   custom
      artifacts                 3
      requests                  1
      queue requests added      0
      queue duplicates          0
      retries attempted         0
      pages requested           1
      pagination executed       no
      pagination stop           unknown
      browser escalated         no
      actions discovered        2
      actions executed          0
      checkpoint loaded         no
      checkpoint saved          no
      browser pages             1
      bytes inspected           180073
      arrays scanned            0
      records inspected         0
      selected artifact         none
      selected path             none
      selected records          0
      strategy selected         none
      DOM unit sets             20
      DOM selected units        2
      field inference           0.0s
      normalized leads          0
      valid events              0
      estimated available       unknown
      estimated recall          0%
      obvious non-events        0
      title completeness        0%
      URL completeness          0%
      date completeness         0%
      duplicate rate            0%
      pagination                none
      total                     9.1s
      quality                   failed
      persistence               disabled
      AI invoked                yes
      AI accepted               no
      AI candidate groups       5
      AI provider/model         openai/gpt-4o-mini-2024-07-18
      AI selected group         dom_snapshot:0:46:3
      AI classification         uncertain
      AI latency                1.4s
      vision invoked            no
      vision accepted           no
      vision rejected reasons   image-capable vision provider is not configured in the current LLM abstraction

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
| 1 | dom_snapshot:0 | 46 | 2 | 0.575 | 1 | 0 | 0 |  |
| 2 | dom_snapshot:0 | 57 | 2 | 0.575 | 1 | 0 | 0 |  |
| 3 | dom_snapshot:0 | 67 | 2 | 0.575 | 1 | 0 | 0 |  |
| 4 | dom_snapshot:0 | 77 | 2 | 0.575 | 1 | 0 | 0 |  |
| 5 | dom_snapshot:0 | 87 | 2 | 0.575 | 1 | 0 | 0 |  |
| 6 | dom_snapshot:0 | 98 | 2 | 0.575 | 1 | 0 | 0 |  |
| 7 | dom_snapshot:0 | 109 | 2 | 0.575 | 1 | 0 | 0 |  |
| 8 | dom_snapshot:0 | 132 | 2 | 0.575 | 1 | 0 | 0 |  |
| 9 | dom_snapshot:0 | 142 | 2 | 0.575 | 1 | 0 | 0 |  |
| 10 | dom_snapshot:0 | 175 | 2 | 0.575 | 1 | 0 | 0 |  |
| 11 | dom_snapshot:0 | 195 | 2 | 0.575 | 1 | 0 | 0 |  |
| 12 | dom_snapshot:0 | 205 | 2 | 0.575 | 1 | 0 | 0 |  |

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
  "degradedReasons": [],
  "classification": "failed"
}
```

## Safe Lead Sample

