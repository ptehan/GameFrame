# Current Workflow Checklist

- [x] Menu order: EV Modeling, Matchup, Pitch, Swing, Dashboard, Teams and Hitters. Library remains last.
- [x] Redesign the first EV video-selection modal. Centered picker, verified desktop and phone sizing.
- [x] Save and restore field addresses in SQLite, independent of isolated iframe browser storage.
- [x] Advance automatically after all six required marks, including the second third-base baseline mark.
- [x] Update the outer modal title on iframe navigation. Swing-to-matchup transition verified in browser.
- [x] Provide Compact, Stacked, and Sidebar dashboard layouts, with remembered selection.
- [x] Draft EV pitch: choose or create pitcher, then open pitch velocity selection with known contact. Regular uploads retain their existing crop editor.
- [x] Automated tests: address persistence/validation; final landmark transition; existing/new pitcher and velocity handoff; background EV generation regression tests.
- [x] Browser checks: three dashboard layouts at 1440px and 390px, no horizontal overflow; picker at both widths; modal title transition.

## Awaiting User Review

- [x] Use the compact dashboard layout; remove the three-layout experiment from the screen.

The EV pitch copy remains optional via "Create a separate pitch video for matchups".

## Guided EV Simplification

- [x] Pick video, then select/search a field address; populate saved addresses from SQLite.
- [x] Keep all four map marks: camera, home, field direction, landing. Field type stays on the map marking screen.
- [x] Confirm or redo map marks before moving to video.
- [x] One full-width instruction above the entire modal; each click advances to the next instruction.
- [x] Home, rubber, first baseline twice, third baseline twice: no frame navigation or tool panels.
- [x] Contact has frame navigation; the next mark is exactly 10 frames later and navigation is locked.
- [x] Offer optional ground contact or skip, then collect team/hitter/description before Continue starts prediction/video creation.
- [x] Map marker center aligned with click position (browser-verified within one pixel).
- [x] Desktop and 390px browser tests with disposable fixtures; errors and retries remain visible.

## Approved Shared UI Cleanup

- [x] Single-column mobile shell with collapsible navigation.
- [x] Balanced matchup selection columns and stacked phone layout.
- [x] Library filters relevant to clip type, Play first, clearer delete consequence, corrected card nesting.
- [x] Single-item delete redirects retain library filters and embedded mode.
- [x] Prediction uses indeterminate progress instead of fabricated stages/percentages.
- [x] EV closing card held for five seconds for readability (new renders only).
- [x] Consistent visible keyboard focus styling.
- [ ] Complete keyboard/screen-reader audit across every legacy custom modal.
- [ ] Unify all legacy upload/render progress and technical error messages; current EV workflow is improved, not every renderer.
- [ ] Verify all media loading/failure placeholders under slow-network and damaged-video conditions.
- [ ] Review final real-video exports end to end at 30 and 60 fps; browser workflow tests use a generated fixture and mock prediction.

Backup/restore is outside the current release scope at the user's request.
