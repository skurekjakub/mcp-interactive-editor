/**
 * The panel's version, in one place.
 *
 * Compared against the server's at runtime. The `.mcpb` extension and the Claude
 * Code plugin are separate installs with separate update cycles, so the two
 * halves genuinely can end up different builds — and the symptom of that is
 * behaviour that matches neither release.
 */
export const PANEL_VERSION = "0.5.1";
