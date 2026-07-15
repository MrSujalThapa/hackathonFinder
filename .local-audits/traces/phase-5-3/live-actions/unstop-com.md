# Generic Structured Extraction Trace

Input: https://unstop.com/hackathons
Final URL: https://unstop.com/hackathons
Persistence: disabled

## Summary

    [structured-v2] Generic structured extraction
      input                     https://unstop.com/hackathons
      final URL                 https://unstop.com/hackathons
      static/browser            browser
      runtime                   custom
      artifacts                 14
      requests                  13
      queue requests added      0
      queue duplicates          0
      retries attempted         0
      pages requested           2
      pagination executed       no
      pagination stop           no_growth
      browser escalated         no
      actions discovered        1
      actions executed          0
      checkpoint loaded         no
      checkpoint saved          no
      browser pages             1
      bytes inspected           1577719
      arrays scanned            438
      records inspected         1251
      selected artifact         network_json
      selected path             data[3].sub_categories
      selected records          10
      strategy selected         dom
      DOM unit sets             6
      DOM selected units        18
      field inference           0.4s
      normalized leads          18
      valid events              18
      estimated available       768
      estimated recall          2%
      obvious non-events        0
      title completeness        100%
      URL completeness          100%
      date completeness         100%
      duplicate rate            0%
      pagination                none
      total                     9.9s
      quality                   degraded_under_extraction
      persistence               disabled
      degraded reasons          under-extracted against evaluation minimum

## Candidate Record Sets

| Rank | Artifact | Path | Records | Structural | Event | Confidence | Reasons |
| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |
| 1 | network_json | `data` | 68 | 1 | 0.618 | 0.79 | filter/facet-like array; sponsor-only array |
| 2 | network_json | `data[3].sub_categories` | 10 | 1 | 0.55 | 0.753 |  |
| 3 | network_json | `data.data` | 28 | 1 | 0.55 | 0.753 | filter/facet-like array; sponsor-only array |
| 4 | network_json | `data[3].sub_categories[6].sub_categories` | 4 | 0.88 | 0.55 | 0.699 |  |
| 5 | network_json | `data[5].sub_categories` | 10 | 1 | 0.438 | 0.691 |  |
| 6 | network_json | `data[9].sub_categories[0].sub_categories` | 7 | 0.94 | 0.438 | 0.664 |  |
| 7 | network_json | `data[4].sub_categories` | 5 | 0.9 | 0.438 | 0.646 |  |
| 8 | network_json | `data[5].sub_categories[5].sub_categories` | 5 | 0.9 | 0.438 | 0.646 |  |
| 9 | network_json | `data[0].sub_categories` | 4 | 0.88 | 0.438 | 0.637 |  |
| 10 | network_json | `data[3].sub_categories[0].sub_categories` | 3 | 0.86 | 0.438 | 0.628 |  |
| 11 | network_json | `data[9].sub_categories[1].sub_categories` | 3 | 0.86 | 0.438 | 0.628 |  |
| 12 | network_json | `data[12].sub_categories` | 3 | 0.86 | 0.438 | 0.628 |  |

## Field Schema

```json
{
  "recordSetId": "network_json:4:215",
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
      "urlish=10/10",
      "coverage=1.00"
    ],
    "field": "url",
    "coverage": 1
  },
  "description": {
    "path": "description",
    "confidence": 0.45,
    "evidence": [
      "coverage=0.00"
    ],
    "field": "description",
    "coverage": 0
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
  "confidence": 0.72,
  "rejected": false,
  "rejectionReasons": []
}
```

## DOM Inference

| Rank | Artifact | Parent | Units | Confidence | Title Unique | URL Unique | Date Coverage | Reasons |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | dom_snapshot:12 | 193 | 18 | 0.891 | 1 | 1 | 1 |  |
| 2 | dom_snapshot:12 | 193 | 3 | 0.891 | 1 | 1 | 1 |  |
| 3 | dom_snapshot:13 | 193 | 18 | 0.891 | 1 | 1 | 1 |  |
| 4 | dom_snapshot:13 | 193 | 3 | 0.891 | 1 | 1 | 1 |  |
| 5 | dom_snapshot:12 | 1168 | 14 | 0.675 | 1 | 0 | 0 |  |
| 6 | dom_snapshot:13 | 1168 | 14 | 0.675 | 1 | 0 | 0 |  |

## DOM Schema

```json
{
  "version": 1,
  "pageFingerprint": "1253:18",
  "recordContainer": {
    "parentFingerprint": "div||user_list.no-scrollbar.ng-tns-#-n.ng-star-inserted|a3|i3|meta,link,app-competition-listing,app-competition-listing,app-competition-listing,app-competition-listing,app-competition-listing,app-featured-opportunity-tile",
    "unitFingerprint": "app-competition-listing||ng-tns-#-n.ng-star-inserted|a1|i1|a",
    "unitTag": "app-competition-listing",
    "unitClassShape": "ng-tns-#-n.ng-star-inserted"
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
      "confidence": 0.333,
      "evidence": [
        "location-like text inside repeated unit"
      ]
    },
    "mode": {
      "relation": "text",
      "confidence": 0.722,
      "evidence": [
        "mode-like text inside repeated unit"
      ]
    }
  },
  "confidence": 0.946,
  "validationMetrics": {
    "testedRecords": 18,
    "validRecords": 18,
    "titleCompleteness": 1,
    "identityCompleteness": 1,
    "duplicateRate": 0
  }
}
```

## Quality

```json
{
  "discoveredRecords": 18,
  "normalizedLeads": 18,
  "validEventLeads": 18,
  "obviousNonEvents": 0,
  "titleCompleteness": 1,
  "urlCompleteness": 1,
  "dateCompleteness": 1,
  "duplicateRate": 0,
  "estimatedPrecision": 1,
  "estimatedAvailableRecords": 768,
  "estimatedRecall": 0.023,
  "degradedReasons": [
    "under-extracted against evaluation minimum"
  ],
  "classification": "degraded_under_extraction"
}
```

## Safe Lead Sample

- NERDS 1.0 - India's First AI Hackathon For Schools (https://unstop.com/hackathons/nerds-10-indias-first-ai-hackathon-for-schools-kokos-ai-pvt-ltd-1718104)
- AI Design Sprint: Fresher Party Planning Night (https://unstop.com/hackathons/ai-design-sprint-fresher-party-planning-night-madhav-institute-of-technology-and-science-1717086)
- Segue 3.0 : Global Design Thinking Challenge (Online + Offline) (https://unstop.com/hackathons/segue-30-global-design-thinking-challenge-online-offline-schooloffutureskillscomsegue-3-0-noida-institute-of--1712134)
- DEMUX 3.0 (https://unstop.com/hackathons/demux-30-demux-30-bv-raju-institute-of-technology-narsapur-bvrit-n-1715858)
- DTI Ideathon & Hackathon 2026 (https://unstop.com/hackathons/dti-ideathon-hackathon-2026-cloud-counselage-1717607)
- S.T.E.M Jam (https://unstop.com/hackathons/stem-jam-iit-guwahati-1711334)
- NextHorizon Hackathon (https://unstop.com/hackathons/nexthorizon-hackathon-indian-institute-of-information-technology-iiit-bhagalpur-1717748)
- Orchestrix: Newgen x AI Club IITM (https://unstop.com/hackathons/orchestrix-newgen-x-ai-club-iitm-iit-madras-1717439)
- ByteBattle Hackathon 2026 (https://unstop.com/hackathons/bytebattle-hackathon-2026-h-p-projects-1717192)
- IgniteX HackFest 2026 (https://unstop.com/hackathons/ignitex-hackfest-2026-h-p-projects-1717162)
- HackMatriX 2026 - National Hackathon (https://unstop.com/hackathons/hackmatrix-2026-24-hour-national-hackathon-ieee-computer-society-mits-gwalior-1701757)
- Global AI Hackathon 2026 (https://unstop.com/hackathons/global-ai-hackathon-2026-innovation-hacks-1716925)
- FutureTech HackFest 2026 (https://unstop.com/hackathons/futuretech-hackfest-2026-h-p-projects-1716746)
- HackSynergy 2026 (https://unstop.com/hackathons/hacksynergy-2026-inderprastha-engineering-college-ipec-ghaziabad-1716413)
- All India Hackathon (https://unstop.com/hackathons/all-india-hackathon-axcentra-1703933)
- Code Build 1.0 (https://unstop.com/hackathons/code-build-10-cobuild-1703709)
- test (https://unstop.com/hackathons/hacknova-2026-kvg-college-of-engineering-kvgce-sullia-karnataka-1715653)
- NextGen Innovators Hackathon 2026 (https://unstop.com/hackathons/nextgen-innovators-hackathon-2026-h-p-projects-1715619)
