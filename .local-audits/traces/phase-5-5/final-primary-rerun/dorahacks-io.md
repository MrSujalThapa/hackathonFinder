# Generic Structured Extraction Trace

Input: https://dorahacks.io/hackathon
Final URL: https://dorahacks.io/hackathon
Persistence: disabled

## Summary

    [structured-v2] Generic structured extraction
      input                     https://dorahacks.io/hackathon
      final URL                 https://dorahacks.io/hackathon
      static/browser            browser
      runtime                   custom
      artifacts                 2
      requests                  1
      queue requests added      0
      queue duplicates          0
      retries attempted         0
      pages requested           1
      pagination executed       no
      pagination stop           unknown
      browser escalated         no
      actions discovered        1
      actions executed          0
      listeners before nav       yes
      browser final rendered URL https://dorahacks.io/hackathon
      DOM samples                after-domcontentloaded:39/316/1, stability-1:39/316/1, stability-1:39/316/1
      network JSON responses     0
      nested scroll containers   0
      iframes/open shadows       0/0
      loading overlay            no
      blocked state              human_verification
      action trace              synthetic:scroll/infinite_scroll/rejected/+0(page fingerprint did not change|no new stable identities appeared)
      checkpoint loaded         no
      checkpoint saved          no
      browser pages             1
      bytes inspected           20006
      arrays scanned            0
      records inspected         0
      selected artifact         none
      selected path             none
      selected records          0
      strategy selected         none
      DOM unit sets             0
      DOM selected units        0
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
      total                     8.3s
      quality                   blocked
      persistence               disabled
      degraded reasons          human_verification; under-extracted against evaluation minimum

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
    "human_verification",
    "under-extracted against evaluation minimum"
  ],
  "classification": "blocked"
}
```

## Safe Lead Sample

