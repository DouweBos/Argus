/**
 * The stable id of every signal source, in a module that imports nothing.
 *
 * The ids used to live beside their sources, but the built-in templates name
 * them and the GitHub sources reach back into project discovery — a cycle that
 * left `SOURCES` holding an `undefined` and failed every run at 07:30. Anything
 * that only needs the id imports it from here.
 */

export const GITHUB_SOURCE_ID = "github";
export const GITHUB_PRS_SOURCE_ID = "github-prs";
export const GITLAB_SOURCE_ID = "gitlab";
export const LINEAR_SOURCE_ID = "linear";
