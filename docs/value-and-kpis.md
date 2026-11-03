# Value model & KPIs

| Group | KPI | Definition |
|---|---|---|
| Adoption | Active users | Distinct users with ≥1 run in the window |
| | Runs, runs per active user | Non-test runs |
| | Agents in use | Distinct agents run ÷ agents in workspace |
| Consumption | Tokens | Sum of input + output tokens reported by the model |
| | Model spend | Σ tokens × admin-entered price per 1M tokens (local/WebGPU = $0) |
| | Avg run time | Mean end-to-end latency |
| | Local / on-device share | Runs on Ollama, LM Studio or WebLLM ÷ runs |
| Output | Outputs produced | Agent step outputs |
| | Success rate | Succeeded ÷ runs |
| | Acceptance rate | Accepted ÷ reviewed runs |
| | Avg rating | Mean 1–5 rating |
| Value (estimates) | Hours saved | Σ agent minutes-saved for valued runs ÷ 60. A flow counts each participating agent once |
| | Value of time saved | Hours saved × hourly rate |
| | ROI | Value ÷ model spend |
| | Cost per accepted output | Spend ÷ valued runs |

**Valued runs:** by default, succeeded runs a person marked **accepted** (conservative). An admin can switch to "succeeded and not rejected". **Dry runs are excluded from every KPI.**

**Setting good assumptions:** time 5–10 real instances of the manual task, use the median, and record the method in the agent's description. Revisit quarterly. Present hours saved as an estimate, ideally next to the acceptance rate.

Trends compare against the previous window of the same length. CSV export gives raw runs for your BI tool.
