function escapeDirective(s: string): string {
  return s.replace(/\\/g, `\\\\`).replace(/\[/g, `\\[`).replace(/\]/g, `\\]`);
}

function formatType(prop: Record<string, any>): string {
  if (Array.isArray(prop.type))
    return prop.type.join(` | `);

  if (prop.enum)
    return prop.enum.map((v: any) => typeof v === `string` ? `"${v}"` : String(v)).join(` | `);

  if (prop.type === `array`)
    return `${prop.items?.type || `any`}[]`;

  return prop.type || `any`;
}

function propertyToMarkdown(name: string, prop: Record<string, any>): string {
  const pills = [`:type[${escapeDirective(formatType(prop))}]`];

  if (prop.default !== undefined)
    pills.push(`:default[${escapeDirective(JSON.stringify(prop.default))}]`);

  const lines = [`### \`${name}\` ${pills.join(` `)}`];

  if (prop.title)
    lines.push(``, `**${prop.title}**`);

  if (prop.description)
    lines.push(``, prop.description);

  return lines.join(`\n`);
}

function flattenToMarkdown(properties: Record<string, any>, prefix = ``): string[] {
  const sections: string[] = [];

  for (const [key, prop] of Object.entries(properties)) {
    const name = prefix + key;
    sections.push(propertyToMarkdown(name, prop as Record<string, any>));

    if ((prop as any).properties)
      sections.push(...flattenToMarkdown((prop as any).properties, `${name}.`));

    if ((prop as any).patternProperties) {
      for (const patternProp of Object.values((prop as any).patternProperties) as any[]) {
        if (patternProp.properties)
          sections.push(...flattenToMarkdown(patternProp.properties, `${name}[name].`));
      }
    }
  }

  return sections;
}

export function schemaFieldNames(schema: Record<string, any>): string[] {
  return flattenFieldNames(schema.properties);
}

function flattenFieldNames(properties: Record<string, any>, prefix = ``): string[] {
  const names: string[] = [];

  for (const [key, prop] of Object.entries(properties)) {
    const name = prefix + key;
    names.push(name);

    if ((prop as any).properties)
      names.push(...flattenFieldNames((prop as any).properties, `${name}.`));

    if ((prop as any).patternProperties) {
      for (const patternProp of Object.values((prop as any).patternProperties) as any[]) {
        if (patternProp.properties)
          names.push(...flattenFieldNames(patternProp.properties, `${name}[name].`));
      }
    }
  }

  return names;
}

export function schemaToMarkdown(schema: Record<string, any>): string {
  const parts: string[] = [];

  if (schema.description)
    parts.push(schema.description);

  parts.push(...flattenToMarkdown(schema.properties));

  return parts.join(`\n\n`);
}
