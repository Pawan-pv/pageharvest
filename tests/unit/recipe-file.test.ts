import { describe, it, expect } from 'vitest';
import {
  parseRecipeFile,
  recipeFileName,
  recipeToSchema,
  schemaToRecipe,
  serializeRecipeFile,
} from '@/core/library/recipe-file';
import type { ExtractionRecipe } from '@/types';

const baseRecipe: ExtractionRecipe = {
  id: 'rcp_1',
  name: 'My Product List',
  description: 'Grabs product cards.',
  projectId: 'proj_1',
  urlPattern: 'https://shop.example.com/*',
  containerSelector: '.card',
  fields: [
    { id: 'f1', name: 'Title', selector: '.title', extractor: 'text' },
    { id: 'f2', name: 'Price', selector: '.price', extractor: 'number' },
  ],
  pagination: { type: 'none', maxPages: 5, delayMs: 1000, scrollCount: 10, scrollDelayMs: 300, startPage: 1, pageIncrement: 1, stopCondition: 'no_new_records' },
  createdAt: 1000,
  updatedAt: 2000,
};

describe('recipeFileName', () => {
  it('slugifies the recipe name and appends the extension', () => {
    expect(recipeFileName(baseRecipe)).toBe('my-product-list.pageharvest-recipe.json');
    expect(recipeFileName({ ...baseRecipe, name: '   ' })).toBe('pageharvest-recipe.pageharvest-recipe.json');
    expect(recipeFileName({ ...baseRecipe, name: 'A/B:C!' })).toBe('a-b-c.pageharvest-recipe.json');
  });
});

describe('recipeToSchema / schemaToRecipe', () => {
  it('converts a recipe to a canonical extraction schema', () => {
    const schema = recipeToSchema(baseRecipe);
    expect(schema.id).toBe('rcp_1');
    expect(schema.name).toBe('My Product List');
    expect(schema.containerSelector).toBe('.card');
    expect(schema.fields).toHaveLength(2);
    expect(schema.version).toBe(1);
    expect(schema.pagination.type).toBe('none');
  });

  it('converts a schema back to a recipe', () => {
    const schema = recipeToSchema(baseRecipe);
    const back = schemaToRecipe(schema);
    expect(back.id).toBe('rcp_1');
    expect(back.name).toBe('My Product List');
    expect(back.fields).toHaveLength(2);
    expect(back.pagination?.type).toBe('none');
  });

  it('round-trips a recipe through schema and back', () => {
    expect(schemaToRecipe(recipeToSchema(baseRecipe))).toMatchObject(baseRecipe);
  });
});

describe('serializeRecipeFile', () => {
  it('writes a valid recipe file envelope', () => {
    const text = serializeRecipeFile(baseRecipe, 1234567890);
    const file = JSON.parse(text);
    expect(file.kind).toBe('pageharvest-recipe');
    expect(file.version).toBe(1);
    expect(file.exportedAt).toBe(1234567890);
    expect(file.recipe.id).toBe('rcp_1');
  });

  it('produces stable, pretty-printed JSON for the same timestamp', () => {
    const now = 1234567890;
    const a = serializeRecipeFile(baseRecipe, now);
    const b = serializeRecipeFile(baseRecipe, now);
    expect(a).toBe(b);
    expect(a).toContain('  ');
  });
});

describe('parseRecipeFile', () => {
  it('parses a valid recipe file back into a recipe', () => {
    const text = serializeRecipeFile(baseRecipe);
    const recipe = parseRecipeFile(text);
    expect(recipe.id).toBe('rcp_1');
    expect(recipe.name).toBe('My Product List');
    expect(recipe.fields).toHaveLength(2);
    expect(recipe.containerSelector).toBe('.card');
  });

  it('rejects invalid JSON', () => {
    expect(() => parseRecipeFile('{ not json')).toThrow(/not valid JSON/);
  });

  it('rejects a file with the wrong kind', () => {
    expect(() => parseRecipeFile(JSON.stringify({ kind: 'other', version: 1, exportedAt: 1, recipe: baseRecipe }))).toThrow(
      /PageHarvest recipe file/
    );
  });

  it('rejects a file with the wrong version', () => {
    expect(() =>
      parseRecipeFile(JSON.stringify({ kind: 'pageharvest-recipe', version: 99, exportedAt: 1, recipe: baseRecipe }))
    ).toThrow(/PageHarvest recipe file/);
  });

  it('rejects a file missing required recipe fields', () => {
    expect(() =>
      parseRecipeFile(JSON.stringify({ kind: 'pageharvest-recipe', version: 1, exportedAt: 1, recipe: {} }))
    ).toThrow(/PageHarvest recipe file/);
  });
});
