# VLM-as-judge: grobid-js vs upstream GROBID against PDF truth

Ground truth was extracted by Claude (vision-language model) directly from page 1 of each PDF in `fixtures/external-corpus/`.
Both TEIs are scored against that truth. 54 papers scored. Re-run: `npx tsx test/bench/vlm-judge.ts`.

## Per-paper scores

| Paper | Truth title (head) | Title up/js | Authors up/js | Affil up/js | Abstract up/js | Title W | Authors W | Affil W | Abstract W |
|---|---|---|---|---|---|---|---|---|---|
| paper_012 | Utilizing Vector Database Management Systems in Cyber Securi | 100% / 100% | 100% / 100% | 100% / 100% | 70% / 70% | tie+ | tie+ | tie+ | tie+ |
| paper_014 | Introduction to hybrid cloud paradigms: Bridging public and  | 100% / 100% | 100% / 100% | 100% / 100% | 62% / 62% | tie+ | tie+ | tie+ | tie+ |
| paper_015 | Security Performance Analysis during Side-Channel Attack Usi | 100% / 0% | 0% / 0% | 0% / 0% | — / — | up | tie- | tie- | — |
| paper_019 | Attack of the Knights: A Non Uniform Cache Side-Channel Atta | 100% / 100% | 100% / 100% | 100% / 100% | 66% / 66% | tie+ | tie+ | tie+ | tie+ |
| paper_021 | Lightweight Hardware-Based Cache Side-Channel Attack Detecti | 100% / 100% | 75% / 75% | 100% / 100% | 74% / 74% | tie+ | tie- | tie+ | tie+ |
| paper_034 | Research on SQL Injection Attacks Using Word Embedding Techn | 100% / 100% | 83% / 83% | 88% / 88% | 68% / 68% | tie+ | tie- | tie+ | tie+ |
| paper_036 | FINANCIAL SECURITY MANAGEMENT OF ENTERPRISE: BIBLIOMETRIC, T | 100% / 100% | 100% / 100% | 100% / 100% | 68% / 68% | tie+ | tie+ | tie+ | tie+ |
| paper_038 | Estimating Missing Security Vectors in NVD Database Security | 100% / 100% | 100% / 100% | 72% / 72% | 56% / 56% | tie+ | tie+ | tie+ | tie+ |
| paper_040 | АНАЛІЗ ВЕКТОРІВ ДОСЛІДЖЕНЬ ФІНАНСОВОЇ БЕЗПЕКИ: БІБЛІОМЕТРИЧН | 100% / 100% | 0% / 0% | 0% / 0% | 48% / 48% | tie+ | tie- | tie- | tie- |
| paper_041 | Critical Evaluation of SQL Injection Security Measures in We | 100% / 100% | 100% / 100% | 0% / 0% | 64% / 64% | tie+ | tie+ | tie- | tie+ |
| paper_043 | DEVELOPMENT OF A MULTIPURPOSE GEOGRAPHIC DATABASE FOR URBAN  | 100% / 100% | 100% / 100% | 33% / 33% | 67% / 67% | tie+ | tie+ | tie- | tie+ |
| paper_047 | Designing a Robust Machine Learning-Based Framework for Secu | 100% / 100% | 100% / 100% | 100% / 100% | 71% / 71% | tie+ | tie+ | tie+ | tie+ |
| paper_048 | Cloud-Native Vector Search: A Comprehensive Performance Anal | 100% / 100% | 75% / 75% | 30% / 30% | 59% / 59% | tie+ | tie- | tie- | tie+ |
| paper_052 | Towards the Development of an LLM-Based Methodology for Auto | 100% / 100% | 100% / 100% | 100% / 100% | 59% / 59% | tie+ | tie+ | tie+ | tie+ |
| paper_055 | Exploiting Side-Channel Vulnerabilities in Virtualized Cloud | 100% / 100% | 0% / 0% | 100% / 100% | 61% / 61% | tie+ | tie- | tie+ | tie+ |
| paper_056 | Role of SOQL and Database Optimization in Large-Scale Salesf | 100% / 100% | 100% / 100% | 100% / 100% | 56% / 56% | tie+ | tie+ | tie+ | tie+ |
| paper_059 | Detection of potato diseases using image segmentation and mu | 100% / 100% | 75% / 75% | 100% / 100% | — / — | tie+ | tie- | tie+ | — |
| paper_061 | Machine Learning Adoption in Blockchain-Based Smart Applicat | 0% / 0% | 100% / 100% | 100% / 100% | 68% / 68% | tie- | tie+ | tie+ | tie+ |
| paper_067 | A Systematic Literature Review on Plant Disease Detection: M | 100% / 100% | 100% / 100% | 100% / 100% | 69% / 69% | tie+ | tie+ | tie+ | tie+ |
| paper_076 | Smart agriculture: utilizing machine learning and deep learn | 100% / 100% | 100% / 100% | 100% / 100% | 68% / 68% | tie+ | tie+ | tie+ | tie+ |
| paper_078 | Machine Learning Classification Approaches for Biometric Rec | 100% / 100% | 50% / 50% | 100% / 100% | 61% / 61% | tie+ | tie- | tie+ | tie+ |
| paper_082 | Pseudonymization for research data collection: is the juice  | 100% / 100% | 100% / 100% | 100% / 100% | 62% / 62% | tie+ | tie+ | tie+ | tie+ |
| paper_086 | Cybersecurity: Time Series Predictive Modeling of Vulnerabil | 100% / 100% | 100% / 100% | 100% / 100% | 71% / 71% | tie+ | tie+ | tie+ | tie+ |
| paper_089 | Attack Modeling and Mitigation Strategies for Risk-Based Ana | 100% / 100% | 100% / 100% | 57% / 57% | 64% / 64% | tie+ | tie+ | tie+ | tie+ |
| paper_090 | Deep Facial Emotion Recognition Using Local Features Based o | 100% / 100% | 75% / 75% | 100% / 100% | 75% / 75% | tie+ | tie- | tie+ | tie+ |
| paper_094 | Gender Recognition of Human from Face Images Using Multi-Cla | 100% / 100% | 100% / 100% | 100% / 100% | 68% / 68% | tie+ | tie+ | tie+ | tie+ |
| paper_097 | Robust facial expression recognition system in higher poses | 100% / 100% | 100% / 100% | 100% / 100% | 61% / 61% | tie+ | tie+ | tie+ | tie+ |
| paper_102 | A Novel Authentication Management for the Data Security of S | 100% / 100% | 100% / 100% | 57% / 57% | 59% / 59% | tie+ | tie+ | tie+ | tie+ |
| paper_108 | A Post-Quantum Fuzzy Commitment Scheme for Biometric Templat | 100% / 100% | 100% / 100% | 67% / 67% | 67% / 67% | tie+ | tie+ | tie+ | tie+ |
| paper_111 | Detection and prevention of SQLI attacks and developing comp | 100% / 100% | 100% / 100% | 100% / 100% | 68% / 68% | tie+ | tie+ | tie+ | tie+ |
| paper_112 | Is Image Encoding Beneficial for Deep Learning in Finance? | 0% / 0% | 100% / 100% | 0% / 0% | 67% / 67% | tie- | tie+ | tie- | tie+ |
| paper_115 | INCREASING ROBUSTNESS OF I-VECTORS VIA MASKING: A CASE STUDY | 100% / 100% | 100% / 100% | 97% / 97% | 68% / 68% | tie+ | tie+ | tie+ | tie+ |
| paper_116 | Adversarial Attacks on Agentic AI Systems: Mechanisms, Impac | 100% / 100% | 100% / 100% | 100% / 100% | 71% / 71% | tie+ | tie+ | tie+ | tie+ |
| paper_117 | Rethinking Human-Centric Cybersecurity: A Mixed-Methods Anal | 100% / 100% | 100% / 100% | 100% / 100% | 57% / 57% | tie+ | tie+ | tie+ | tie+ |
| paper_120 | Biometric Personal Classification with Deep Learning Using E | 100% / 100% | 100% / 100% | 100% / 100% | 63% / 63% | tie+ | tie+ | tie+ | tie+ |
| paper_123 | DATABASE SECURITY IN SUPPLY CHAIN SYSTEMS: SAFEGUARDING VEND | 100% / 100% | 100% / 100% | 100% / 100% | 57% / 57% | tie+ | tie+ | tie+ | tie+ |
| paper_124 | ADVERSARIAL MACHINE LEARNING IN NETWORK SECURITY: A SYSTEMAT | 0% / 0% | 67% / 67% | 100% / 100% | 0% / 0% | tie- | tie- | tie+ | tie- |
| paper_127 | A Mixed-Methods Study of Open-Source Software Maintainers On | 100% / 100% | 100% / 100% | 100% / 100% | 57% / 57% | tie+ | tie+ | tie+ | tie+ |
| paper_128 | Multi-phase algorithmic framework to prevent SQL injection a | 100% / 100% | 100% / 100% | 100% / 100% | — / — | tie+ | tie+ | tie+ | — |
| paper_130 | Strengthening AI Critical Infrastructure Security with the M | 100% / 100% | 100% / 100% | 100% / 100% | 65% / 65% | tie+ | tie+ | tie+ | tie+ |
| paper_132 | Enhanced brain image security using a hybrid of lifting wave | 100% / 100% | 75% / 75% | 100% / 100% | 63% / 63% | tie+ | tie- | tie+ | tie+ |
| paper_136 | Leveraging AI chat assistants for enhanced food security in  | 100% / 100% | 80% / 80% | 100% / 100% | 65% / 65% | tie+ | tie- | tie+ | tie+ |
| paper_141 | AI-DRIVEN PRIVACY AND SECURITY FRAMEWORKS FOR SMART HOMES: A | 100% / 100% | 100% / 100% | 100% / 100% | 64% / 64% | tie+ | tie+ | tie+ | tie+ |
| paper_143 | ONTOLOGICAL AUGMENTATION AND ANALYTICAL PARADIGMS FOR ELEVAT | 100% / 100% | 100% / 100% | 0% / 0% | 66% / 66% | tie+ | tie+ | tie- | tie+ |
| paper_146 | DEVSECOPS FOR CONTINUOUS SECURITY IN TRADING SOFTWARE APPLIC | 100% / 100% | 100% / 100% | 81% / 81% | 64% / 64% | tie+ | tie+ | tie+ | tie+ |
| paper_148 | Gorgeous: Revisiting the Data Layout for Disk-Resident High- | 100% / 100% | 78% / 78% | 100% / 100% | 55% / 55% | tie+ | tie- | tie+ | tie+ |
| paper_151 | GoVector: An I/O-Efficient Caching Strategy for High-Dimensi | 100% / 100% | 71% / 71% | 100% / 100% | 64% / 64% | tie+ | tie- | tie+ | tie+ |
| paper_152 | Optimizing SSD-Resident Graph Indexing for High-Throughput V | 100% / 100% | 63% / 63% | 50% / 50% | 61% / 61% | tie+ | tie- | tie+ | tie+ |
| paper_160 | I3 Retriever: Incorporating Implicit Interaction in Pre-trai | 50% / 50% | 38% / 38% | 83% / 83% | 68% / 68% | tie- | tie- | tie+ | tie+ |
| paper_162 | Multi-Class Intrusion Detection Using Two-Channel Color Mapp | 100% / 100% | 100% / 100% | 100% / 100% | 65% / 65% | tie+ | tie+ | tie+ | tie+ |
| paper_164 | Enhancing data security in cloud computing: a blockchain-bas | 100% / 100% | 100% / 100% | 100% / 100% | 15% / 15% | tie+ | tie+ | tie+ | tie- |
| paper_169 | Sound Event Classification in an Industrial Environment: Pip | 100% / 100% | 100% / 100% | 100% / 100% | 69% / 69% | tie+ | tie+ | tie+ | tie+ |
| paper_176 | Disk-Resident Graph ANN Search: An Experimental Evaluation | 100% / 100% | 50% / 50% | 57% / 57% | 66% / 66% | tie+ | tie- | tie+ | tie+ |
| paper_177 | Write-Read Decoupling in Modern Large-Scale Search Engines:  | 100% / 100% | 86% / 86% | 100% / 100% | 61% / 61% | tie+ | tie- | tie+ | tie+ |

Legend: `js` = grobid-js wins; `up` = upstream wins; `tie+` = both correct; `tie-` = both wrong; `—` = not applicable.

## Head-to-head tallies

| Metric | grobid-js wins | upstream wins | both correct | both wrong | n/a |
|---|---|---|---|---|---|
| title | 0 | 1 | 49 | 4 | 0 |
| authors | 0 | 0 | 36 | 18 | 0 |
| affiliations | 0 | 0 | 47 | 7 | 0 |
| abstract | 0 | 0 | 48 | 3 | 3 |

## Ambiguous / noted papers

- paper_015: Research Square preprint cover page; no abstract visible on page 1
- paper_040: non-Latin (Ukrainian) script
- paper_059: archive cover sheet on page 1 (NRC Publications Archive); no abstract visible on page 1
- paper_128: archive cover sheet on page 1 (University of Reading CentAUR); no abstract visible on page 1

## Bottom line

- On title: grobid-js wins 0, upstream wins 1, both correct 49, both wrong 4 (out of 54, n/a 0).
- On authors: grobid-js wins 0, upstream wins 0, both correct 36, both wrong 18 (out of 54, n/a 0).
- On affiliations: grobid-js wins 0, upstream wins 0, both correct 47, both wrong 7 (out of 54, n/a 0).
- On abstract: grobid-js wins 0, upstream wins 0, both correct 48, both wrong 3 (out of 54, n/a 3).
