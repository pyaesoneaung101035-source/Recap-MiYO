# Burmese Voice-Over Video Dubbing & Synchronization Plan

## Completed Tasks

1. **Strict 0% Original Audio Leakage (Pure Dubbing Mode)**
   - Configured `volume: 0` and `isMuted: true` as the initial default state across all video playback and rendering pipelines.
   - In Step 8 Export Studio, original video audio track is strictly silenced (`gain: 0`), preventing any bleed of original dialogue, music, or background noise into the exported MP4 video.
   - Dedicated indicators and toggles verify mute status before export.

2. **Single Male Narrator Voice ("Thiha" Adult Male)**
   - Configured all segments to default to single male narrator voice ("Thiha") across Whisper Generator and Assembly Generator.
   - All speakers in dialogue are narrated by the single natural voiceover.

3. **Segment-by-Segment Timestamp Alignment & Timing Fit**
   - Transcripts extract exact `startTime` and `endTime` matching original speech windows.
   - Burmese translation prompt strictly guides the model to write concise, short spoken phrases (<8-14 words or <35 Burmese characters per segment) so audio duration fits within the video scene without spilling into subsequent scenes.
   - Added `shortenBurmeseTextForDuration` powered by Gemini AI with a 1-click `✂️ AI စာတိုချုံ့မည် (Shorten)` button on each segment row when Burmese text is longer than the original speech duration.
   - Implemented per-segment `Auto-Fit Retime`:
     - If audio duration > slot duration: automatically adjusts playback rate up to 1.35x max with pitch-preserved `atempo`.
     - If audio duration < slot duration: preserves natural 1.0x tempo and adds natural silence/pause padding to fill the segment duration.

4. **Lead Silence & Smooth Audio Envelope Scheduling**
   - Audio segments are scheduled on the timeline starting precisely at `startTimeReal + segment.startTime`, preserving lead silence before the first dialogue.
   - Added smooth 12ms attack and 15ms release linear gain envelopes on each audio segment node to prevent pops or clicks at segment cut points.

5. **Single Synchronized MP4 Video Export**
   - Renders muted original video with Canvas subtitles and synchronized Web Audio mix into a single MP4 video matching exact video duration, framerate, and resolution.
