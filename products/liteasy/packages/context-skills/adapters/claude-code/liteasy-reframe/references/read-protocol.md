# Context read protocol

Run liteasy doctor --json to check CLI/runtime, configured origin, credentials and API reachability without business bodies. Missing shell/CLI/API is an actual capability gap; do not claim a successful read.

For task-relevant personal background: liteasy context get --scope personal --query "TASK_TERMS" --max-chars 12000 --json. Add --scope project/slug only for the user's relevant project. Use --kind group_background for group materials, --kind progress for tried routes, or --status draft when seeking unsorted ideas. Chinese and English terms are matched as normalized substrings; all whitespace-separated terms must match. Use a few relevant terms, and narrow/rephrase if there is no match.

JSON success is {schemaVersion:"liteasy.cli/v1",result:...}; result.selectedEntries contains full selected bodies and actual revisions, result.omitted lists whole entries that did not fit. Read a needed omitted item with liteasy context show ENTRY_ID --json. This does not mean a model has consumed or understood the data. No session/project entity is required.

Do not fetch the same supplied snapshot again when it already suffices for this task. If current authoritative revisions are required, read the service. All reads are scoped to this task; none authorize writes or future automatic calls.
