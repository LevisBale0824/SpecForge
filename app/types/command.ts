export type CommandInfo = {
  /** Command identifier used in sendCommand, e.g. "opsx:explore". Derived from file path. */
  id: string;
  /** Display name from frontmatter, e.g. "OPSX: Explore". Falls back to id. */
  name?: string;
  description?: string;
  category?: string;
};
