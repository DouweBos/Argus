/** `owner/repo` from an ssh or https GitHub remote URL, or null. */
export function githubSlugFromUrl(url: string): string | null {
  const match = url
    .trim()
    .match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);

  return match ? `${match[1]}/${match[2]}` : null;
}
