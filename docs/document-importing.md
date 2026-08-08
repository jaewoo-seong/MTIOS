# Document importing

The research workspace accepts only formats that can be converted into editable Markdown deterministically.

## Supported

- UTF-8 plain text (`.txt`)
- Markdown (`.md`, `.markdown`)
- Simple Office Open XML Word documents (`.docx`)

PDF, legacy Word (`.doc`), macro-enabled Word (`.docm`), HTML, CSV, TSV, and JSON are not document-import formats. Structured research imports into a client database remain a separate reviewed workflow.

## Simple DOCX eligibility

The server checks the file before creating a permanent document. It rejects corrupt or encrypted packages, macros, ActiveX, embedded/OLE objects, tracked changes, image-heavy files, structurally excessive files, zip-expansion risks, and documents without enough directly extractable text. Embedded images are not imported; the operator is told when a document contains images that will be omitted.

The current limits are 25 MB compressed, 40 MB expanded, 5,000 paragraphs, 30 tables, and 8 images. These limits are safety boundaries, not upload recommendations.

## Import and database relationship

An imported document may be attached to a project, but importing it does not directly modify that project's client database. AI-created company dossiers are linked to client records only through the reviewed client-change workflow. Each linked row stores the dossier document ID, and opening the row opens the current approved document. Manual saves create document revisions; agent rework produces a proposed revision that must be approved before it replaces the current body.

PDF/OCR import is intentionally deferred. The private conversion service is no longer a requirement for basic importing and must not be presented as active PDF support.
