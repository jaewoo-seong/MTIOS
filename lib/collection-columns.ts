/**
 * The record column that carries a dossier's document id - the contract
 * between Stage 5 (Cross-Link), which writes it, and Stage 6 (Surface),
 * which renders it as a "View report" action.
 *
 * It lives in its own module rather than in lib/collection-research.ts
 * because the client component that reads it must not pull the database
 * client into the browser bundle.
 */
export const DOSSIER_DOCUMENT_COLUMN = "Dossier Document";
