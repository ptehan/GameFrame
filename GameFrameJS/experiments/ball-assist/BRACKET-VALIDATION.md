# Path and travel refinement

The refinement uses two fresh automatic image detections to constrain short uncertain intervals. It searches a corridor in camera-stabilized coordinates and limits progress along that corridor using elapsed video time. Candidate pixels must also match motion appearance at both endpoints. It never exports an interpolated point. Later saved human marks are evaluation labels, not inference inputs.

Five focused image tests pass: visible middle-ball recovery, a blank middle frame remaining missing, rejection of an off-path object, rejection of an object too far along the path, and recovery during camera panning. The full experimental suite passes 25 tests.

The frozen Cortland night-triple dense run is `night-bracket-dense.json`, job `72840a96-fe03-4e5d-970e-73f4702f296f`. It processed all 604 frames after contact, produced 22 proposals, and refined frame 15 from raw images. One of the two held-out human labels is still missing; the other differs by 1.29 source pixels. Ground contact was not detected. Runtime was 202.3 seconds.

Visual inspection of every proposal still finds false net-intersection detections later in the clip. Those can also pass the current anchor heuristics. Thus the clip fails full-flight validation: this change verifies a useful refinement mechanism, not reliable automatic tracking through nets. The next detector improvement must establish stronger image identity for anchors and reacquisition. A smooth trajectory alone is insufficient.

Model fingerprint: `9912c859e55b68975031e472434e22de9e1942979a4c16875db0a6385f9e8d82`. The per-job source snapshot and manifest are retained with the raw-frame session. Production database and five production source/template hashes match the pre-experiment baseline.

The same frozen detector with adaptive three-frame sampling checked 71 frames for proposals instead of 84. Runtime was 193.0 seconds versus 202.3 seconds in the dense run (about 5% faster in this single pair, not a reliable general speed estimate). It had the same held-out-label failure and did not detect ground contact. Launch, border/reentry, and recovery checks deliberately remain dense; native camera registration still covers all 604 frames. See `night-bracket-adaptive.json` and `bracket-sampling-comparison.json`.
