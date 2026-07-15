# Generic Structured Extraction Trace

Input: https://www.hackathons.space/
Final URL: https://www.hackathons.space/
Persistence: disabled

## Summary

    [structured-v2] Generic structured extraction
      input                     https://www.hackathons.space/
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
      identity growth/actions    6
      listeners before nav       yes
      browser final rendered URL https://www.hackathons.space/
      DOM samples                after-domcontentloaded:444/3858/49, stability-1:450/3858/49, stability-2:450/3858/49, stability-1:143/2096/13, stability-2:143/2096/13, stability-1:143/2096/13, stability-2:143/2096/13
      network JSON responses     0
      nested scroll containers   0
      iframes/open shadows       0/0
      loading overlay            no
      checkpoint loaded         no
      checkpoint saved          no
      browser pages             2
      bytes inspected           356215
      arrays scanned            0
      records inspected         0
      selected artifact         none
      selected path             none
      selected records          0
      strategy selected         dom
      DOM unit sets             4
      DOM selected units        12
      field inference           0.0s
      normalized leads          12
      valid events              12
      estimated available       190
      estimated recall          6%
      obvious non-events        0
      title completeness        100%
      URL completeness          0%
      date completeness         100%
      duplicate rate            0%
      pagination                none
      total                     17.7s
      quality                   degraded_under_extraction
      persistence               disabled
      degraded reasons          under-extracted against evaluation minimum
      AI invoked                yes
      AI accepted               yes
      AI candidate groups       4
      AI provider/model         openai/gpt-4o-mini-2024-07-18
      AI selected group         html:0:63:1
      AI classification         event_records
      AI latency                1.2s

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
{
  "version": 1,
  "pageFingerprint": "257:12",
  "recordContainer": {
    "parentFingerprint": "div||grid.gap-n.sm:gap-n.sm:grid-cols-n.lg:grid-cols-n|a3|i3|a,a,a,a,a,a,a,a",
    "unitFingerprint": "a||group.block.h-full|a1|i1|article",
    "unitTag": "a",
    "unitClassShape": "group.block.h-full"
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
    "location": {
      "relation": "text",
      "confidence": 0.25,
      "evidence": [
        "location-like text inside repeated unit"
      ]
    },
    "mode": {
      "relation": "text",
      "confidence": 0.167,
      "evidence": [
        "mode-like text inside repeated unit"
      ]
    }
  },
  "confidence": 0.869,
  "validationMetrics": {
    "testedRecords": 12,
    "validRecords": 12,
    "titleCompleteness": 1,
    "identityCompleteness": 1,
    "duplicateRate": 0
  }
}
```

## Quality

```json
{
  "discoveredRecords": 12,
  "normalizedLeads": 12,
  "validEventLeads": 12,
  "obviousNonEvents": 0,
  "titleCompleteness": 1,
  "urlCompleteness": 0,
  "dateCompleteness": 1,
  "duplicateRate": 0,
  "estimatedPrecision": 1,
  "estimatedAvailableRecords": 190,
  "estimatedRecall": 0.063,
  "degradedReasons": [
    "under-extracted against evaluation minimum"
  ],
  "classification": "degraded_under_extraction"
}
```

## Safe Lead Sample

- SuRaksha Cyber Hackathon 2.0
- APAC Stellar Hackathon
- UiPath AgentHack
- Splunk Agentic Ops Hackathon
- Slack Agent Builder Challenge
- Global AI Hackathon Series with Qwen Cloud
- Casper Agentic Buildathon 2026 - Qualification Round
- Build with AI: Code for Communities
- World Cup Hackathon
- Stellar Build Station Delhi NCR (21 Days Builders Sprint)
- OpenAI Build Week
- Spark Hackathon
