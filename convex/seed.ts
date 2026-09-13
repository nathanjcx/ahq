import { v } from 'convex/values';
import { CATALOG, CATALOG_TOOLS, type CatalogEmployee } from '../lib/catalog';
import { providerServerUrls, providers } from '../lib/providers';
import { internalMutation } from './_generated/server';
import { listingForDraft } from './lib/marketplace';
import { providerConfigFor, validateRegistryTool } from './registry';

/** Who the catalog publishes as. Distinct from the reserved publisher so listings stay visible. */
export const CATALOG_PUBLISHER = 'catalog';

/** The fields a catalog entry pins on a draft and a version, in the order the studio stores them. */
function profile(entry: CatalogEmployee) {
  return {
    name: entry.name,
    role: entry.role,
    description: entry.description,
    category: entry.category,
    strengths: entry.strengths,
    limitations: entry.limitations,
    capabilities: entry.capabilities,
    model: entry.model,
    color: entry.color,
    media: [] as { url: string; type: 'image' | 'video'; alt: string }[],
    instructions: entry.instructions,
    skills: [] as { name: string; version: string; sha256: string; content: string }[],
    persona: entry.persona,
  };
}

/**
 * Publishes the core catalog. Safe to run on every deploy: registry tools are added only where
 * missing (an administrator's review wins) and a tool the catalog itself published and has since
 * dropped is removed, a draft is matched by name, and a new version is published only when the
 * catalog entry differs from the version the listing currently offers.
 *
 *   npx convex run --prod seed:catalog
 */
export const catalog = internalMutation({
  args: {},
  returns: v.object({
    tools: v.number(),
    removedTools: v.number(),
    published: v.array(v.string()),
    unchanged: v.array(v.string()),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    let tools = 0;
    let removedTools = 0;
    const catalogued = new Set(CATALOG_TOOLS.map((tool) => `${tool.provider}.${tool.name}`));
    for (const row of await ctx.db.query('registryTools').collect()) {
      if (row.updatedBy !== CATALOG_PUBLISHER || catalogued.has(`${row.provider}.${row.name}`)) continue;
      await ctx.db.delete(row._id);
      removedTools += 1;
    }
    for (const tool of CATALOG_TOOLS) {
      const existing = await ctx.db
        .query('registryTools')
        .withIndex('by_provider_name', (q) => q.eq('provider', tool.provider).eq('name', tool.name))
        .unique();
      if (existing) continue;
      const { name, description } = validateRegistryTool(tool);
      await ctx.db.insert('registryTools', {
        provider: tool.provider,
        name,
        description,
        mode: tool.mode,
        ...(tool.resourceArgument ? { resourceArgument: tool.resourceArgument } : {}),
        updatedBy: CATALOG_PUBLISHER,
        updatedAt: now,
      });
      tools += 1;
    }

    const drafts = await ctx.db.query('employeeDrafts').collect();
    const published: string[] = [];
    const unchanged: string[] = [];
    for (const entry of CATALOG) {
      const fields = profile(entry);
      let draft = drafts.find((row) => row.createdBy === CATALOG_PUBLISHER && row.name === entry.name);
      if (!draft) {
        const draftId = await ctx.db.insert('employeeDrafts', {
          createdBy: CATALOG_PUBLISHER,
          ...fields,
          updatedAt: now,
        });
        draft = (await ctx.db.get(draftId))!;
      }
      const listing = await listingForDraft(ctx, draft._id);
      const current = listing ? await ctx.db.get(listing.currentVersionId) : null;
      const same = current && canonical(profile({ ...entry, ...pick(current) })) === canonical(fields);
      if (same) {
        unchanged.push(entry.name);
        continue;
      }
      await ctx.db.patch(draft._id, { ...fields, updatedAt: now });
      const prior = await ctx.db
        .query('employeeVersions')
        .withIndex('by_draft', (q) => q.eq('draftId', draft._id))
        .collect();
      const versionId = await ctx.db.insert('employeeVersions', {
        draftId: draft._id,
        version: prior.length + 1,
        ...fields,
        publishedBy: CATALOG_PUBLISHER,
        publishedAt: now,
      });
      if (listing) await ctx.db.patch(listing._id, { currentVersionId: versionId, updatedAt: now });
      else
        await ctx.db.insert('listings', {
          draftId: draft._id,
          currentVersionId: versionId,
          visibility: 'published',
          hires: 0,
          completedTasks: 0,
          updatedAt: now,
        });
      published.push(entry.name);
    }
    return { tools, removedTools, published, unchanged };
  },
});

/** A stable rendering: keys sorted and undefined dropped, so a stored and a catalog value compare alike. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}

/** The catalog-shaped view of a stored version, so a stored and a catalog profile compare alike. */
function pick(version: {
  name: string;
  role: string;
  description: string;
  category: string;
  strengths: string[];
  limitations: string[];
  capabilities: CatalogEmployee['capabilities'];
  model: CatalogEmployee['model'];
  color: string;
  instructions: string;
  persona?: CatalogEmployee['persona'];
}): CatalogEmployee {
  return {
    name: version.name,
    role: version.role,
    category: version.category as CatalogEmployee['category'],
    description: version.description,
    strengths: version.strengths,
    limitations: version.limitations,
    capabilities: version.capabilities,
    model: version.model,
    color: version.color,
    instructions: version.instructions,
    persona: version.persona ?? { voice: '', traits: [] },
  };
}

/**
 * Enables every provider's default MCP server URLs where an administrator has not chosen any, so a
 * fresh deployment can connect a provider without a visit to the Operations page first.
 *
 *   npx convex run --prod seed:enableDefaultServers
 */
export const enableDefaultServers = internalMutation({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const now = Date.now();
    const enabled: string[] = [];
    for (const definition of providers) {
      const existing = await providerConfigFor(ctx, definition.id);
      if (existing?.enabledUrls.length) continue;
      const urls = providerServerUrls(definition);
      if (existing)
        await ctx.db.patch(existing._id, { enabledUrls: urls, updatedBy: CATALOG_PUBLISHER, updatedAt: now });
      else
        await ctx.db.insert('providerConfigs', {
          provider: definition.id,
          enabledUrls: urls,
          oauthClients: [],
          updatedBy: CATALOG_PUBLISHER,
          updatedAt: now,
        });
      enabled.push(definition.id);
    }
    return enabled;
  },
});
