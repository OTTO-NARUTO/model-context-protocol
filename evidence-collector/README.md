# Evidence Collector

This folder stores generated evidence reports for compliance evaluations.

## Purpose
- Capture proof for why a control failed or errored.
- Keep a downloadable JSON document per evaluation run.

## Output Location
- Generated files are written to `evidence-collector/reports/`.
- Download URL format: `/downloads/evidence-reports/<file-name>.json`

## Report Contents
- Control status and reason (`PASS` / `FAIL` / `ERROR`)
- API call mode and API call reason
- Evidence snapshot used in evaluation
- Metadata and trace id for troubleshooting

