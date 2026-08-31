/**
 * The server's version, in one place.
 *
 * Declared as its own module so the bump script has a single literal to rewrite
 * rather than a line of unrelated code to pattern-match. It is also what the
 * panel compares itself against: the extension and the plugin are separate
 * installs on separate update cycles, and a panel talking to a different build
 * misbehaves in ways that point nowhere near the cause.
 */
export const SERVER_VERSION = "0.6.1";
