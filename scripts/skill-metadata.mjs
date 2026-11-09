import yaml from 'js-yaml';

// Support existing skills while new metadata uses the portable nested field.
export function getSkillVersion(frontmatter) {
  return frontmatter.metadata?.version ?? frontmatter.version;
}

export function parseSkillMetadata(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error('SKILL.md frontmatter is required');
  const metadata = yaml.load(match[1]);
  if (!metadata || typeof metadata !== 'object') throw new Error('Skill metadata must be a mapping');
  return metadata;
}
