/**
 * The server's version, in one place.
 *
 * It used to be a literal inside the `McpServer` constructor, which meant the
 * bump script had to pattern-match a line of unrelated code. It is also what the
 * panel compares itself against: two installs of this thing can drift, and a
 * panel behaving like an older build with no way to tell is a whole afternoon.
 */
export const SERVER_VERSION = "0.5.2";
