# Legacy dashboard archive

The generic Agent, Knowledge, campaign-management, live-activity, and change-review panels were removed from the active shell during the research-workspace rebuild.

Their implementation remains recoverable from Git history. They are intentionally not mounted or copied into production because the product now has four focused surfaces:

1. Projects — strategy chat, continuous company queue, and dossiers
2. Documents — editable project artifacts and version history
3. Client Databases — one company database per project
4. Settings — account and model governance

The underlying services are retained only where the continuous research pipeline still calls them (for example, collection execution and approval-safe data writes).
