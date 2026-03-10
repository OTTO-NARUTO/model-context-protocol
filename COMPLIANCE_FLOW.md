# Compliance Report Flow (Simple Version)

## 1. User starts a compliance run
A user selects:
- provider (GitHub, GitLab, or Bitbucket)
- repository
- standard (ISO27001)

Then the UI sends a request to the backend compliance API.
Single-control evaluation is disabled; runs are standard-level only (`/api/compliance/evaluate-standard`).

## 2. Backend prepares the run
`ComplianceController` receives the request and:
- validates input
- fetches OAuth access token for tenant + provider
- loads controls from framework file
- loads checks from checks file

## 3. For each check, backend finds the tool to run
Each check contains a canonical tool name (business-level tool id).

Example: `get_branch_protection`

## 4. Tool mapping resolves concrete MCP/REST tool names
`ToolResolver` reads `config/tool-name-mapping.json` and maps canonical tool to:
- `mcpToolName`
- `restToolName`

Then it decides execution mode based on preference + MCP exposure:
- use MCP when available/exposed
- otherwise use REST

## 5. Evidence collection path
### If mode = MCP
- `McpClient` calls provider MCP server (`tools/call`)
- receives raw MCP evidence

### If mode = REST
- `RestToolFallbackClient` loads contract from `config/rest-tool-contracts.json`
- builds method/path/query/body
- calls provider REST API
- receives raw REST evidence

## 6. Normalize evidence
`ResponseNormalizer` converts raw MCP/REST payloads into a consistent shape.

## 7. Evaluate compliance
`EvaluationEngine` evaluates evidence against check logic and returns:
- PASS
- FAIL
- ERROR

Check results are then aggregated into control-level result.

## 8. Build output and save evidence report
- `ReportFormatter` prepares human-readable report output for API response.
- `EvidenceReportCollector` writes report JSON file and returns download link.

## 9. Final response
Backend returns:
- compliance results
- summary
- formatted report content
- evidence report download URL

---

## One-line flow
Request -> Validate -> Load controls/checks -> Resolve tool mapping -> Choose MCP/REST -> Collect evidence -> Normalize -> Evaluate -> Format + Save report -> Respond
