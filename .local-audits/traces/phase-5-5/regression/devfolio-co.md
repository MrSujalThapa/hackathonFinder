# Generic Structured Extraction Trace

Input: https://devfolio.co/hackathons
Final URL: https://devfolio.co/hackathons
Persistence: disabled

## Summary

    [structured-v2] Generic structured extraction
      input                     https://devfolio.co/hackathons
      final URL                 https://devfolio.co/hackathons
      static/browser            static
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
      checkpoint loaded         no
      checkpoint saved          no
      browser pages             0
      bytes inspected           243978
      arrays scanned            8
      records inspected         30
      selected artifact         next_data
      selected path             props.pageProps.dehydratedState.queries[0].state.data.open_hackathons
      selected records          20
      strategy selected         structured
      DOM unit sets             12
      DOM selected units        2
      field inference           0.1s
      normalized leads          20
      valid events              20
      estimated available       20
      estimated recall          100%
      obvious non-events        0
      title completeness        100%
      URL completeness          100%
      date completeness         100%
      duplicate rate            0%
      pagination                none
      total                     2.1s
      quality                   healthy_complete
      persistence               disabled
      AI invoked                no
      AI accepted               no
      AI candidate groups       5
      AI rejected reasons       deterministic extraction already produced leads

## Candidate Record Sets

| Rank | Artifact | Path | Records | Structural | Event | Confidence | Reasons |
| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | next_data | `props.pageProps.dehydratedState.queries[0].state.data.open_hackathons` | 20 | 1 | 0.64 | 0.802 |  |
| 2 | next_data | `props.pageProps.dehydratedState.queries[0].state.data.upcoming_hackathons` | 3 | 0.86 | 0.573 | 0.702 |  |
| 3 | next_data | `props.pageProps.dehydratedState.queries[0].state.data.past_hackathons` | 4 | 0.88 | 0.223 | 0.379 | form/questionnaire-like array |

## Field Schema

```json
{
  "recordSetId": "next_data:1:3",
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
      "urlish=20/20",
      "coverage=1.00"
    ],
    "field": "url",
    "coverage": 1
  },
  "startDate": {
    "path": "starts_at",
    "confidence": 0.95,
    "evidence": [
      "parseable=20/20"
    ],
    "field": "startDate",
    "coverage": 1
  },
  "endDate": {
    "path": "ends_at",
    "confidence": 0.95,
    "evidence": [
      "parseable=20/20"
    ],
    "field": "endDate",
    "coverage": 1
  },
  "deadline": {
    "path": "ends_at",
    "confidence": 0.95,
    "evidence": [
      "parseable=20/20"
    ],
    "field": "deadline",
    "coverage": 1
  },
  "location": {
    "path": "settings.site",
    "confidence": 0.44,
    "evidence": [
      "coverage=0.80"
    ],
    "field": "location",
    "coverage": 0.8
  },
  "mode": {
    "path": "type",
    "confidence": 0.75,
    "evidence": [
      "coverage=1.00"
    ],
    "field": "mode",
    "coverage": 1
  },
  "description": {
    "path": "name",
    "confidence": 0.55,
    "evidence": [
      "coverage=1.00"
    ],
    "field": "description",
    "coverage": 1
  },
  "sourceRecordId": {
    "path": "uuid",
    "confidence": 1,
    "evidence": [
      "coverage=1.00"
    ],
    "field": "sourceRecordId",
    "coverage": 1
  },
  "confidence": 0.879,
  "rejected": false,
  "rejectionReasons": []
}
```

## DOM Inference

| Rank | Artifact | Parent | Units | Confidence | Title Unique | URL Unique | Date Coverage | Reasons |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | html:0 | 17 | 2 | 0.8 | 1 | 1 | 0 |  |
| 2 | html:0 | 1199 | 5 | 0.8 | 1 | 1 | 0 |  |
| 3 | html:0 | 1217 | 6 | 0.8 | 1 | 1 | 0 |  |
| 4 | html:0 | 1238 | 3 | 0.8 | 1 | 1 | 0 |  |
| 5 | html:0 | 1196 | 3 | 0.8 | 1 | 1 | 0 |  |
| 6 | html:0 | 138 | 13 | 0.8 | 1 | 1 | 0 |  |
| 7 | html:0 | 138 | 2 | 0.8 | 1 | 1 | 0 |  |
| 8 | html:0 | 906 | 3 | 0.8 | 1 | 1 | 0 |  |
| 9 | html:0 | 1004 | 2 | 0.8 | 1 | 1 | 0 |  |
| 10 | html:0 | 1004 | 2 | 0.8 | 1 | 1 | 0 |  |
| 11 | html:0 | 130 | 2 | 0.8 | 1 | 1 | 0 |  |
| 12 | html:0 | 1166 | 7 | 0.65 | 0 | 1 | 0 |  |

## DOM Schema

```json
null
```

## Quality

```json
{
  "discoveredRecords": 20,
  "normalizedLeads": 20,
  "validEventLeads": 20,
  "obviousNonEvents": 0,
  "titleCompleteness": 1,
  "urlCompleteness": 1,
  "dateCompleteness": 1,
  "duplicateRate": 0,
  "estimatedPrecision": 1,
  "estimatedAvailableRecords": 20,
  "estimatedRecall": 1,
  "degradedReasons": [],
  "classification": "healthy_complete"
}
```

## Safe Lead Sample

- Build with Gemma (https://devfolio.co/build-with-gemma-bengaluru-ai-sprint)
- HackVSIT7.0 (https://devfolio.co/hackvsit-7)
- FutureForge Hackathon 2026 (https://devfolio.co/futureforge-hackathon)
- HyperFusion (https://devfolio.co/hyperfusion)
- PEC HACKS 4.0 (https://devfolio.co/pec-hacks)
- Push to Prod Hackathon: Building at the Frontier (https://devfolio.co/pushtoprod-india)
- Agentic Commerce Hackathon (https://devfolio.co/agentic-commerce)
- Ignisys 1.O (https://devfolio.co/ignisys-ignitia)
- CodeStorm 2026 #2 (https://devfolio.co/codestorm-week2-2026)
- Port Mortem 2026 - Code Resurrection Hackathon (https://devfolio.co/portmortem)
- NexHack 2.0 (https://devfolio.co/nexhack-2)
- .hack '26 (https://devfolio.co/dothack26)
- DSU DEVHACK 3.0 (https://devfolio.co/dsudevhack3)
- Dora Hack 2.0 (https://devfolio.co/dora-hack)
- Brainwave 2026 (https://devfolio.co/brain-wave)
- ETHKochi (https://devfolio.co/ethkochi)
- HackNex Season 2 (https://devfolio.co/hacknex-season-2)
- MUBA Blockchain Hackathon (https://devfolio.co/muba-hackathon)
- CodeStorm 2026: FutureForge (https://devfolio.co/codestorm-futureforge)
- HACKER HOUSE GOA 2026 (https://devfolio.co/hacker-house-goa-2026)
