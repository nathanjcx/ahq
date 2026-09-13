import { describe, expect, it } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import { CATALOG, CATALOG_TOOLS } from '../lib/catalog';
import { DELIVERABLES, STUDIO_TOOLS, WORKSHOP_LIBRARIES } from '../lib/contracts/core';
import { MODEL_IDS } from '../lib/contracts/core';
import { PERSONA_LIMITS, isPersonaTrait } from '../lib/personas';
import { harness, identity } from './support';

describe('the core catalog', () => {
  it('is complete, within the studio limits, and names only registered tools', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CATALOG.map((e) => e.name)).size).toBe(CATALOG.length);
    const registered = new Set(CATALOG_TOOLS.map((t) => `${t.provider}.${t.name}`));
    expect(new Set(CATALOG_TOOLS.map((t) => `${t.provider}.${t.name}`)).size).toBe(CATALOG_TOOLS.length);
    for (const e of CATALOG) {
      expect(e.description.length).toBeLessThanOrEqual(2000);
      expect(e.instructions.length).toBeGreaterThan(400);
      expect(e.strengths.length).toBeGreaterThanOrEqual(3);
      expect(e.limitations.length).toBeGreaterThanOrEqual(2);
      for (const s of e.strengths) expect(s.length).toBeLessThanOrEqual(200);
      for (const l of e.limitations) expect(l.length).toBeLessThanOrEqual(300);
      expect(MODEL_IDS).toContain(e.model);
      expect(e.persona.voice.length).toBeLessThanOrEqual(PERSONA_LIMITS.voice);
      expect(e.persona.traits.length).toBeLessThanOrEqual(PERSONA_LIMITS.traits);
      for (const t of e.persona.traits) expect(isPersonaTrait(t)).toBe(true);
      expect(new Set(e.capabilities.map((c) => c.provider)).size).toBe(e.capabilities.length);
      for (const c of e.capabilities) {
        expect(c.tools.length).toBeGreaterThan(0);
        for (const tool of c.tools) expect(registered.has(`${c.provider}.${tool}`)).toBe(true);
      }
      if (e.workshop) {
        for (const tool of e.workshop.tools) expect(tool in STUDIO_TOOLS).toBe(true);
        for (const library of e.workshop.libraries) expect(library in WORKSHOP_LIBRARIES).toBe(true);
        for (const kind of e.workshop.deliverables) expect(kind in DELIVERABLES).toBe(true);
        expect(e.workshop.deliverables.length).toBeGreaterThan(0);
      }
    }
  });

  it('publishes every employee once and republishes only what changed', async () => {
    const t = harness();
    const first = await t.mutation(internal.seed.catalog, {});
    expect(first.published.length).toBe(CATALOG.length);
    expect(first.tools).toBe(CATALOG_TOOLS.length);
    const second = await t.mutation(internal.seed.catalog, {});
    expect(second.published).toEqual([]);
    expect(second.unchanged.length).toBe(CATALOG.length);
    expect(second.tools).toBe(0);
    const listings = await t.withIdentity(identity('viewer')).query(api.marketplace.list, {});
    expect(listings.length).toBe(CATALOG.length);
    expect(listings.map((l) => l.name).sort()).toEqual(CATALOG.map((e) => e.name).sort());
  });
});
