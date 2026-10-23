# Phase 4A voice baseline

Phase 4A measures the existing voice system. It does not change turn-taking or
audio behaviour. Run this checklist on staging before Phase 4C and repeat it
after every voice release.

## Enable the panel

Set `TIMING_DEBUG=1` on staging, redeploy, sign in, then open:

```text
/voice?debug=1&device=desktop-chrome&run=cold-01
```

The panel records microphone readiness, Flux connection, end-of-speech to first
audio, interruption stop time, active STT provider and false interruptions.
Use **Download baseline JSON** at the end of each run. It contains timings and
technical device metadata only, not transcripts or buyer details.

## Required matrix

Run each device on a normal buyer network:

| Device | Browser | Cold sessions | Warm sessions | Spoken turns | Interruptions |
|---|---|---:|---:|---:|---:|
| Desktop/laptop | Current Chrome | 5 | 5 | 20 | 10 |
| Android phone | Current Chrome | 5 | 5 | 20 | 10 |
| iPhone | Current Safari | 5 | 5 | 20 | 10 |

A cold session starts in a new private tab with microphone permission not yet
granted. A warm session reloads voice mode in the same tab after one successful
session. Label every URL with a unique `run` value.

Use a mix of greetings, company/capability questions, case questions and longer
pricing questions. For interruption samples, begin speaking while answer audio
is clearly playing. Include two deliberate room-noise tests per device; these
should not stop playback.

## Targets

- Cold microphone ready p95: at most 1.5 seconds.
- Warm microphone ready p95: at most 0.5 seconds.
- First meaningful answer audio: p50 at most 1.2 seconds and p95 at most 2 seconds.
- Confirmed interruption to stopped playback p95: at most 0.3 seconds.
- Flux handles at least 99% of measured turns.
- False interruption rate is at most 1%.
- No confidentiality or attribution failure is allowed during the run.

The panel's first-audio clock starts when the user stops speaking. It is not the
same as an instant visual acknowledgement.

## Build the report

Put the downloaded JSON files outside the repository, then run:

```powershell
npm run eval:voice-baseline -- "D:\path\voice-baseline-1.json" "D:\path\voice-baseline-2.json"
```

The merged Markdown report is written to `EVAL_OUT`. A metric with insufficient
data is reported as `NEEDS DATA`, never as a pass. Remove `TIMING_DEBUG` after
the staging measurement window.
