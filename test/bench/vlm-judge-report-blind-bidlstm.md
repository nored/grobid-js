# VLM-as-judge: grobid-js vs upstream GROBID against PDF truth

Ground truth was extracted by Claude (vision-language model) directly from page 1 of each PDF in `fixtures/blind-corpus/`.
Both TEIs are scored against that truth. 114 papers scored. Re-run: `npx tsx test/bench/vlm-judge-blind.ts`.

## Per-paper scores

| Paper | Truth title (head) | Title up/js | Authors up/js | Affil up/js | Abstract up/js | Title W | Authors W | Affil W | Abstract W |
|---|---|---|---|---|---|---|---|---|---|
| paper_179 | Retrieval Pivot Attacks in Hybrid RAG: Measuring and Mitigat | 100% / 100% | 100% / 100% | — / — | 67% / 67% | tie+ | tie+ | tie- | tie+ |
| paper_180 | A Game-Theoretic Framework for the Virtual Machines Migratio | 100% / 100% | 100% / 100% | 100% / 100% | 63% / 63% | tie+ | tie+ | tie+ | tie+ |
| paper_184 | From Analysing Operating System Vulnerabilities to Designing | 50% / 50% | 100% / 100% | — / — | — / — | tie- | tie+ | tie- | — |
| paper_187 | Projecting wheat demand in China and India for 2030 and 2050 | 50% / 0% | 100% / 100% | 100% / 100% | 15% / 14% | tie- | tie+ | tie+ | tie- |
| paper_197 | A Systematic Review of Climate Change Risks to Communal Live | 100% / 100% | 80% / 80% | 100% / 100% | 65% / 65% | tie+ | tie- | tie+ | tie+ |
| paper_200 | Ground Zero: An In-Depth Analysis of 2022's Zero-Day Vulnera | 100% / 100% | 100% / 100% | 33% / 100% | 77% / 77% | tie+ | tie+ | js | tie+ |
| paper_203 | A HOLISTIC FRAMEWORK FOR DATABASE SECURITY GOVERNANCE: INTEG | 100% / 100% | 100% / 100% | 100% / 100% | 72% / 72% | tie+ | tie+ | tie+ | tie+ |
| paper_204 | Database Private Security Jurisprudence: A Case Study using  | 100% / 100% | 100% / 100% | 100% / 100% | 71% / 71% | tie+ | tie+ | tie+ | tie+ |
| paper_205 | Enhancing home IoT network security | 100% / 100% | 100% / 100% | 100% / 100% | 66% / 66% | tie+ | tie+ | tie+ | tie+ |
| paper_206 | Securing Automated Insulin Delivery Systems: A Review of Sec | 100% / 100% | 100% / 100% | 0% / 0% | 75% / 75% | tie+ | tie+ | tie- | tie+ |
| paper_207 | The availability of food in Mexico: an approach to measuring | 100% / 100% | 100% / 100% | 100% / 100% | 66% / 66% | tie+ | tie+ | tie+ | tie+ |
| paper_209 | A Review of Security Vulnerabilities and Defense Frameworks  | 100% / 50% | 100% / 100% | 80% / 100% | 65% / 65% | up | tie+ | tie+ | tie+ |
| paper_213 | Hardware-Accelerated Caching for Large-Scale AI Model Traini | 100% / 100% | 100% / 100% | 0% / 100% | 69% / 69% | tie+ | tie+ | js | tie+ |
| paper_215 | II-NVM: Enhancing Map Accuracy and Consistency with Normal V | 100% / 100% | 57% / 57% | 61% / 66% | 64% / 64% | tie+ | tie- | tie+ | tie+ |
| paper_217 | GIDS: Accelerating Sampling and Aggregation Operations in GN | 100% / 100% | 100% / 100% | 100% / 100% | 64% / 64% | tie+ | tie+ | tie+ | tie+ |
| paper_218 | A face template protection scheme based on chaotic map, erro | 100% / 0% | 100% / 100% | 100% / 100% | 59% / 59% | up | tie+ | tie+ | tie+ |
| paper_219 | A Dual-Pathway AI Architecture for Tourism Logistics and Sup | 100% / 100% | 100% / 100% | 100% / 100% | 68% / 68% | tie+ | tie+ | tie+ | tie+ |
| paper_224 | Accelerated Nearest Neighbor Search with Quick ADC | 50% / 50% | 100% / 33% | 0% / 0% | 79% / 65% | tie- | up | tie- | tie+ |
| paper_234 | Leveraging Channel Knowledge Map for Multi-User Hierarchical | 100% / 100% | 100% / 100% | 59% / 59% | 64% / 64% | tie+ | tie+ | tie+ | tie+ |
| paper_239 | Channel Estimation for BIOS-Assisted Multi-User MIMO Systems | 100% / 100% | 33% / 67% | 100% / 94% | 68% / 68% | tie+ | tie- | tie+ | tie+ |
| paper_241 | Multi-channel Opus compression for far-field automatic speec | 100% / 100% | 100% / 100% | 0% / 0% | 69% / 69% | tie+ | tie+ | tie- | tie+ |
| paper_244 | Cross-Platform Analytics Harmonization in Multi-Tenant Retai | 100% / 100% | 100% / 100% | 100% / 100% | 73% / 73% | tie+ | tie+ | tie+ | tie+ |
| paper_251 | Gas pipeline leakage detection based on multiple multimodal  | 100% / 100% | 100% / 100% | 79% / 79% | 70% / 70% | tie+ | tie+ | tie+ | tie+ |
| paper_262 | Bandana: Using Non-volatile Memory for Storing Deep Learning | 100% / 100% | 100% / 100% | 0% / 0% | 64% / 64% | tie+ | tie+ | tie- | tie+ |
| paper_267 | Side-Channel Attacks in Multi-Tenant Cloud Environments: Pre | 100% / 100% | 100% / 100% | 100% / 100% | 65% / 65% | tie+ | tie+ | tie+ | tie+ |
| paper_270 | Design and Implementation of Online Live Streaming System Us | 0% / 100% | 0% / 0% | 0% / 0% | — / — | js | tie- | tie- | — |
| paper_271 | FedCache: A Knowledge Cache-driven Federated Learning Archit | 100% / 100% | 67% / 67% | 80% / 70% | 63% / 63% | tie+ | tie- | tie+ | tie+ |
| paper_281 | Is My Data in Your Retrieval Database? Membership Inference  | 100% / 100% | 100% / 100% | 100% / 100% | 63% / 63% | tie+ | tie+ | tie+ | tie+ |
| paper_289 | Liquid air for energy storage, auto-compression, compressed  | 100% / 100% | 33% / 33% | 80% / 80% | 69% / 69% | tie+ | tie- | tie+ | tie+ |
| paper_293 | Revolutionary hybrid ensembled deep learning model for accur | 100% / 100% | 100% / 100% | 100% / 100% | 59% / 59% | tie+ | tie+ | tie+ | tie+ |
| paper_294 | Multi-User Pilot Pattern Optimization for Channel Extrapolat | 100% / 100% | 67% / 100% | 83% / 100% | 65% / 65% | tie+ | js | tie+ | tie+ |
| paper_295 | Multi-Armed Bandit Based Client Scheduling for Federated Lea | 100% / 100% | 100% / 100% | 76% / 65% | 74% / 74% | tie+ | tie+ | tie+ | tie+ |
| paper_301 | ABase: the Multi-Tenant NoSQL Serverless Database for Divers | 100% / 100% | 82% / 82% | 100% / 100% | 60% / 60% | tie+ | tie- | tie+ | tie+ |
| paper_307 | COMPASS: COmpact Multi-channel Prior-map And Scene Signature | 100% / 100% | 100% / 100% | 57% / 56% | 69% / 69% | tie+ | tie+ | tie+ | tie+ |
| paper_314 | Joint Computing, Pushing, and Caching Optimization for Mobil | 100% / 100% | 80% / 80% | 89% / 87% | 68% / 68% | tie+ | tie- | tie+ | tie+ |
| paper_317 | Implementing a Parallel Sparse Matrix-Vector Multiplication  | 100% / 100% | 100% / 100% | 31% / 31% | 66% / 66% | tie+ | tie+ | tie- | tie+ |
| paper_318 | Performance limitations for sparse matrix-vector multiplicat | 100% / 100% | 100% / 100% | 100% / 100% | 69% / 69% | tie+ | tie+ | tie+ | tie+ |
| paper_320 | AccMER: Accelerating Multi-Agent Experience Replay with Cach | 100% / 100% | 100% / 100% | 100% / 100% | 70% / 70% | tie+ | tie+ | tie+ | tie+ |
| paper_323 | ByteHouse: ByteDance's Cloud-Native Data Warehouse for Real- | 100% / 50% | 94% / 81% | 66% / 69% | 67% / 67% | up | tie- | tie+ | tie+ |
| paper_326 | Hybrid Deep Learning Model for Multiple Cache Side Channel A | 100% / 100% | 100% / 100% | 100% / 100% | 68% / 68% | tie+ | tie+ | tie+ | tie+ |
| paper_334 | MAGNUS: Generating Data Locality to Accelerate Sparse Matrix | 100% / 100% | 100% / 100% | 100% / 100% | 57% / 57% | tie+ | tie+ | tie+ | tie+ |
| paper_335 | HIT RATIO DRIVEN MOBILE EDGE CACHING SCHEME FOR VIDEO ON DEM | 100% / 100% | 33% / 33% | 100% / 100% | 67% / 67% | tie+ | tie- | tie+ | tie+ |
| paper_336 | Reconfigurable Intelligent Surface-Assisted Multiple-Antenna | 100% / 100% | 100% / 100% | 100% / 40% | 69% / 69% | tie+ | tie+ | up | tie+ |
| paper_340 | A Novel Approach to Prevent Cloud Infrastructure against Cac | 100% / 100% | 100% / 100% | 33% / 33% | — / — | tie+ | tie+ | tie- | — |
| paper_348 | Detecting Cache-Based Side Channel Attacks in IaaS using Enh | 0% / 0% | 0% / 0% | 9% / 0% | 64% / 64% | tie- | tie- | tie- | tie+ |
| paper_351 | Spy in the GPU-box: Covert and Side Channel Attacks on Multi | 100% / 100% | 100% / 83% | 49% / 49% | 63% / 63% | tie+ | up | tie- | tie+ |
| paper_362 | Inter-Architecture Portability of Artificial Neural Networks | 100% / 100% | 100% / 100% | 55% / 100% | 69% / 69% | tie+ | tie+ | tie+ | tie+ |
| paper_367 | An Achievable Scheme for the K-user Linear Computation Broad | 100% / 100% | 50% / 50% | 100% / 100% | 60% / 60% | tie+ | tie- | tie+ | tie+ |
| paper_375 | Burn-After-Use for Preventing Data Leakage through a Secure  | 100% / 100% | 75% / 75% | 50% / 58% | 65% / 65% | tie+ | tie- | tie+ | tie+ |
| paper_378 | Ohm's Law in Data Centers: A Voltage Side Channel for Timing | 100% / 100% | 50% / 100% | 0% / 100% | 59% / 59% | tie+ | js | js | tie+ |
| paper_385 | Security Audit of intel ICE Driver for e810 Network Interfac | 0% / 0% | 0% / 100% | — / — | — / — | tie- | js | tie- | — |
| paper_393 | Unified Gateway Architecture For Multi-Tenant Large Language | 100% / 100% | 100% / 100% | 100% / 100% | 59% / 59% | tie+ | tie+ | tie+ | tie+ |
| paper_395 | Improved Security of Audit Trail Logs in Multi-Tenant Cloud  | 100% / 100% | 50% / 50% | 88% / 88% | 62% / 62% | tie+ | tie- | tie+ | tie+ |
| paper_398 | SmartEmbed: A Tool for Clone and Bug Detection in Smart Cont | 100% / 100% | 83% / 83% | 75% / 75% | 59% / 59% | tie+ | tie- | tie+ | tie+ |
| paper_402 | Economic institutions and economic growth: Empirical evidenc | 100% / 0% | 100% / 100% | 100% / 100% | 52% / 52% | up | tie+ | tie+ | tie+ |
| paper_408 | An Empirical Analysis of Injection Attack Vectors and Mitiga | 100% / 100% | 100% / 100% | 100% / 100% | 65% / 65% | tie+ | tie+ | tie+ | tie+ |
| paper_412 | Comprehensive Security Assessment of Holy Stone Drones: Exam | 100% / 100% | 100% / 100% | 100% / 100% | 61% / 61% | tie+ | tie+ | tie+ | tie+ |
| paper_413 | Security Assessment for Guest-to-Guest and Host-to-Guest Iso | 50% / 50% | 0% / 0% | 0% / 0% | 3% / 3% | tie- | tie- | tie- | tie- |
| paper_414 | SoK: Security of EMV Contactless Payment Systems | 100% / 100% | 100% / 100% | 100% / 100% | 65% / 65% | tie+ | tie+ | tie+ | tie+ |
| paper_420 | Large Language Models for Code: Security Hardening and Adver | 100% / 100% | 50% / 50% | 100% / 100% | 66% / 66% | tie+ | tie- | tie+ | tie+ |
| paper_423 | The Power of Bamboo: On the Post-Compromise Security for Sea | 100% / 100% | 86% / 86% | 70% / 70% | 69% / 69% | tie+ | tie- | tie+ | tie+ |
| paper_426 | Кибербезопасность биометрических хранилищ на спортивных объе | 100% / 100% | 100% / 100% | 100% / 20% | 54% / 58% | tie+ | tie+ | up | tie+ |
| paper_427 | ECM modeling and performance tuning of SpMV and Lattice QCD  | 100% / 100% | 100% / 100% | 93% / 100% | 66% / 66% | tie+ | tie+ | tie+ | tie+ |
| paper_428 | QVecOpt: An Efficient Storage and Computing Optimization Fra | 100% / 100% | 57% / 57% | 69% / 69% | 66% / 66% | tie+ | tie- | tie+ | tie+ |
| paper_429 | In-Network Key-Value Cache with Linearizability | 100% / 0% | 100% / 100% | 67% / 67% | — / — | up | tie+ | tie+ | — |
| paper_431 | Observation of a Vector Charmoniumlike State at 4.7 GeV/c^2  | 50% / 50% | 0% / 0% | 15% / 0% | 76% / 76% | tie- | tie- | tie- | tie+ |
| paper_433 | Category-Aware Semantic Caching for Heterogeneous LLM Worklo | 100% / 100% | 100% / 100% | 54% / 54% | 66% / 66% | tie+ | tie+ | tie+ | tie+ |
| paper_434 | Scaling Limits of Memristor-Based Routers for Asynchronous N | 100% / 100% | 80% / 80% | 100% / 100% | 57% / 57% | tie+ | tie- | tie+ | tie+ |
| paper_435 | Свойства салицилиден-анилина как ингибитора коррозии в систе | 100% / 0% | 100% / 25% | 23% / 0% | 0% / 4% | up | up | tie- | tie- |
| paper_441 | Navigating Murky Waters: Automated Browser Feature Testing f | 100% / 100% | 83% / 83% | 100% / 71% | 63% / 63% | tie+ | tie- | tie+ | tie+ |
| paper_443 | ДОСЛІДЖЕННЯ МЕТОДІВ ТА ЗАСОБІВ ПІДВИЩЕННЯ БЕЗПЕКИ ПРОТОКОЛУ  | 0% / 0% | 0% / 0% | 30% / 0% | 68% / 70% | tie- | tie- | tie- | tie+ |
| paper_445 | PBFT-Backed Semantic Voting for Multi-Agent Memory Pruning | 100% / 100% | 100% / 100% | 50% / 50% | 64% / 64% | tie+ | tie+ | tie+ | tie+ |
| paper_447 | SigNet: Network-on-Chip Filtering for Coarse Vector Director | 100% / 100% | 100% / 100% | 100% / 100% | 74% / 74% | tie+ | tie+ | tie+ | tie+ |
| paper_450 | SSL-FL: A lightweight authentication framework for secure fe | 100% / 100% | 100% / 100% | 0% / 0% | 69% / 69% | tie+ | tie+ | tie- | tie+ |
| paper_455 | Prevention of Secured websites from Downgrade and MITM attac | 100% / 100% | 100% / 100% | 100% / 100% | 65% / 65% | tie+ | tie+ | tie+ | tie+ |
| paper_466 | Crosstalk-induced Side Channel Threats in Multi-Tenant NISQ  | 100% / 100% | 100% / 100% | 100% / 100% | 59% / 59% | tie+ | tie+ | tie+ | tie+ |
| paper_467 | The Need for MORE: Unsupervised Side-Channel Analysis with S | 100% / 100% | 60% / 60% | — / — | — / — | tie+ | tie- | tie- | — |
| paper_470 | MoEcho: Exploiting Side-Channel Attacks to Compromise User P | 100% / 100% | 80% / 80% | 100% / 100% | 64% / 64% | tie+ | tie- | tie+ | tie+ |
| paper_471 | Enhancing Side Channel Attack-Resistance of the STTL Combini | 50% / 50% | 90% / 90% | 100% / 100% | 66% / 66% | tie- | tie- | tie+ | tie+ |
| paper_478 | A Novel LPRPO-LSTDCNN Based Side Channel Attack Detection an | 100% / 100% | 50% / 50% | 68% / 68% | 72% / 72% | tie+ | tie- | tie+ | tie+ |
| paper_479 | Remote side-channel analysis of the loop PUF using a TDC-bas | 100% / 100% | 100% / 100% | 100% / 100% | 63% / 63% | tie+ | tie+ | tie+ | tie+ |
| paper_481 | Multiple-Valued Plaintext-Checking Side-Channel Attacks on P | 100% / 100% | 100% / 100% | 100% / 100% | 71% / 71% | tie+ | tie+ | tie+ | tie+ |
| paper_492 | Double Strike: Breaking Approximation-Based Side-Channel Cou | 100% / 100% | 100% / 100% | 100% / 47% | 75% / 75% | tie+ | tie+ | up | tie+ |
| paper_507 | Cryptography without (Hardly Any) Secrets ? | 100% / 100% | 100% / 100% | 100% / 100% | 64% / 64% | tie+ | tie+ | tie+ | tie+ |
| paper_522 | Machine Learning Power Side-Channel Attack on SNOW-V | 100% / 100% | 100% / 100% | 92% / 100% | 73% / 73% | tie+ | tie+ | tie+ | tie+ |
| paper_532 | Power-Related Side-Channel Attacks using the Android Sensor  | 100% / 100% | 100% / 100% | 100% / 100% | 66% / 66% | tie+ | tie+ | tie+ | tie+ |
| paper_533 | Side-Channel Attacks on VOLEitH Signature Schemes: Breaking  | 100% / 0% | 100% / 100% | 100% / 100% | 81% / 81% | up | tie+ | tie+ | tie+ |
| paper_538 | SC-LAMT: A Side-Channel Hardened Lightweight Protocol for Se | 100% / 0% | 80% / 80% | 82% / 100% | 68% / 68% | up | tie- | tie+ | tie+ |
| paper_539 | Post-Quantum Authenticated Key Exchange with Real-Time Side- | 0% / 50% | 100% / 100% | 50% / 50% | 72% / 72% | tie- | tie+ | tie+ | tie+ |
| paper_541 | Ml assisted techniques in power side channel analysis for tr | 100% / 100% | 100% / 100% | 100% / 100% | 70% / 70% | tie+ | tie+ | tie+ | tie+ |
| paper_544 | Side-Channel Linearization Attack on Unrolled Trivium Hardwa | 100% / 0% | 100% / 100% | 100% / 100% | 67% / 67% | up | tie+ | tie+ | tie+ |
| paper_550 | Impedance Side-Channel Analysis of ASICs: An investigation o | 100% / 100% | 100% / 100% | 100% / 100% | 75% / 75% | tie+ | tie+ | tie+ | tie+ |
| paper_551 | PowerGAN: A Machine Learning Approach for Power Side-Channel | 100% / 100% | 71% / 71% | 77% / 100% | 64% / 64% | tie+ | tie- | tie+ | tie+ |
| paper_554 | JitSCA: Jitter-based Side-Channel Analysis in Picoscale Reso | 100% / 100% | 100% / 100% | 100% / 100% | 58% / 58% | tie+ | tie+ | tie+ | tie+ |
| paper_556 | Island-based Random Dynamic Voltage Scaling vs ML-Enhanced P | 100% / 100% | 100% / 100% | 89% / 89% | 65% / 65% | tie+ | tie+ | tie+ | tie+ |
| paper_557 | From Dragondoom to Dragonstar: Side-channel Attacks and Form | 100% / 100% | 100% / 100% | 80% / 73% | 68% / 68% | tie+ | tie+ | tie+ | tie+ |
| paper_564 | Power-balanced Memristive Cryptographic Implementation Again | 100% / 0% | 71% / 71% | 100% / 100% | 63% / 63% | up | tie- | tie+ | tie+ |
| paper_566 | Digital Content Security by Butterfly and Elliptic Curve Cry | 100% / 100% | 100% / 100% | 100% / 100% | 65% / 65% | tie+ | tie+ | tie+ | tie+ |
| paper_569 | DRAMA: Exploiting DRAM Addressing for Cross-CPU Attacks | 100% / 100% | 100% / 100% | 100% / 100% | 70% / 70% | tie+ | tie+ | tie+ | tie+ |
| paper_570 | Eliminating Inter-Process Cache Interference through Cache R | 100% / 100% | 100% / 100% | 100% / 100% | 70% / 70% | tie+ | tie+ | tie+ | tie+ |
| paper_571 | Split Learning without Local Weight Sharing To Enhance Clien | 100% / 100% | 100% / 100% | 32% / 42% | 66% / 66% | tie+ | tie+ | tie- | tie+ |
| paper_581 | KV Cache Compression, But What Must We Give in Return? A Com | 100% / 100% | 75% / 75% | 93% / 100% | 65% / 65% | tie+ | tie- | tie+ | tie+ |
| paper_582 | Shared Disk KV Cache Management for Efficient Multi-Instance | 100% / 100% | 88% / 88% | 100% / 100% | 66% / 66% | tie+ | tie- | tie+ | tie+ |
| paper_585 | Architecting Selective Refresh based Multi-Retention Cache f | 100% / 100% | 100% / 100% | — / — | — / — | tie+ | tie+ | tie- | — |
| paper_588 | Privacy-Preserving k-Nearest Neighbor Computation in Multipl | 100% / 100% | 100% / 100% | 100% / 100% | 70% / 70% | tie+ | tie+ | tie+ | tie+ |
| paper_589 | Herbicide leakage into seawater impacts primary productivity | 100% / 100% | 50% / 50% | 100% / 100% | 70% / 70% | tie+ | tie- | tie+ | tie+ |
| paper_590 | CausalMesh: A Formally Verified Causal Cache for Stateful Se | 100% / 100% | 80% / 80% | 100% / 100% | 70% / 70% | tie+ | tie- | tie+ | tie+ |
| paper_605 | B²-Tree: Page-Based String Indexing in Concurrent Environmen | 50% / 50% | 100% / 100% | 100% / 100% | 71% / 71% | tie- | tie+ | tie+ | tie+ |
| paper_608 | A Network-Aware Distributed Storage Cache for Data Intensive | 0% / 50% | 67% / 67% | 29% / 33% | — / — | tie- | tie- | tie- | — |
| paper_637 | Robust Beamforming for Cache-Enabled Cloud Radio Access Netw | 100% / 100% | 0% / 100% | — / — | 68% / 68% | tie+ | js | tie- | tie+ |
| paper_644 | DATE: Defense Against TEmperature Side-Channel Attacks in DV | 100% / 0% | 100% / 100% | 0% / 0% | 71% / 71% | up | tie+ | tie- | tie+ |
| paper_648 | Physically-Guided Optical Inversion Enable Non-Contact Side- | 50% / 50% | 100% / 100% | 99% / 99% | 63% / 63% | tie- | tie+ | tie+ | tie+ |
| paper_655 | A Cache-Coloring Based Technique for Saving Leakage Energy I | 100% / 100% | 100% / 100% | 100% / 100% | 73% / 73% | tie+ | tie+ | tie+ | tie+ |
| paper_656 | Mitigating Leakage in Federated Learning with Trusted Hardwa | 100% / 100% | 100% / 0% | 100% / 75% | 68% / 68% | tie+ | up | tie+ | tie+ |

Legend: `js` = grobid-js wins; `up` = upstream wins; `tie+` = both correct; `tie-` = both wrong; `—` = not applicable.

## Head-to-head tallies

| Metric | grobid-js wins | upstream wins | both correct | both wrong | n/a |
|---|---|---|---|---|---|
| title | 1 | 11 | 89 | 13 | 0 |
| authors | 4 | 4 | 71 | 35 | 0 |
| affiliations | 3 | 3 | 85 | 23 | 0 |
| abstract | 0 | 0 | 103 | 3 | 8 |

## Ambiguous / noted papers

- paper_184: Page 1 is the Leeds Beckett University repository cover sheet; title/authors taken from citation block. No abstract on page 1.
- paper_270: Page 1 is a thesis cover page (Bachelor of Engineering thesis dated 2021.5.13); no abstract or author affiliation block on page 1.
- paper_280: Title appears as a tagline below journal banner rather than as a large title; abstract column is split across two columns on the page.
- paper_340: Research Square preprint cover sheet; only title, author, keywords, DOI shown on page 1 — no abstract body.
- paper_385: Cover page of a project report (LK049 – Bachelor of Science in Cyber Security and IT Forensics, dated 24/03/2025). No abstract, affiliation, or body content on page 1.
- paper_426: Russian-language paper (Cyrillic); Modern Science and Innovations journal cover header
- paper_429: Master's thesis title page (HKUST); page 1 contains no abstract
- paper_431: Physical Review Letters; full author list deferred to end of article
- paper_435: Russian-language paper (Cyrillic); Technosphere Safety journal
- paper_443: Ukrainian-language paper (Cyrillic); Cybersecurity: Education, Science, Technique journal
- paper_467: Radboud Repository archive cover sheet; page 1 has no abstract or affiliations, only bibliographic metadata
- paper_585: Edinburgh Research Explorer archive cover sheet on page 1; no abstract or affiliations visible on this page. Citation metadata only: DAC '23: Proceedings of the 60th ACM/IEEE Design Automation Conference, 2023.
- paper_608: eScholarship cover sheet on page 1; only title, partial author list (with 'et al.'), and publication date (1999-12-23) are visible. No abstract on this page.

## Bottom line

- On title: grobid-js wins 1, upstream wins 11, both correct 89, both wrong 13 (out of 114, n/a 0).
- On authors: grobid-js wins 4, upstream wins 4, both correct 71, both wrong 35 (out of 114, n/a 0).
- On affiliations: grobid-js wins 3, upstream wins 3, both correct 85, both wrong 23 (out of 114, n/a 0).
- On abstract: grobid-js wins 0, upstream wins 0, both correct 103, both wrong 3 (out of 114, n/a 8).
