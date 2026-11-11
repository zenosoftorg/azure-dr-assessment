# DR establishment guide

> **DRAFT: not an operational procedure until rehearsed and approved by the owner.**

<!-- fill: one line with the workload, the tier, the primary and DR regions and the date of this draft; when evidence/pattern-resolution.json has a banner, add it as a blockquote line under the DRAFT line -->

How to establish DR in the DR region, service by service: what runs today, the target, how to build and validate it beside today's setup, how to cut over, and how to retire the paired setup afterwards. Every time is Estimated until a drill record shows it as Demonstrated. Commands are given only when the owner asks for them, labelled untested.

## Target picture

<!-- fill: the target in the DR region in two or three sentences, with links to the proposed-DR diagram (../architectures/<app>-proposed-dr.arch.json) and to presentation 2 (../presentations/<app>-proposed-dr.html) -->

## Build order

<!-- dr-guide:build-order -->

## Transition plan

<!-- fill: build and validate every chapter beside today's paired DR, then cut over in build order with the traffic switch last, then decommission the paired setup chapter by chapter, each only after its Validate criteria have passed; name the chapters that must cut over together -->

<!-- dr-guide:chapters -->

## Consolidated test plan

<!-- dr-guide:test-plan -->
<!-- /dr-guide:test-plan -->

## DR readiness checklist

<!-- fill: a checklist of what must be true before the DR region counts as ready: every chapter built and validated, the runbook rehearsed, every open input supplied, every default choice confirmed or changed by the owner -->
