import type { FunctionArgs } from 'convex/server';
import { type uiApi } from '@/lib/ui-api';

/**
 * What the employee editor hands back: the arguments `marketplace.saveDraft` takes, with the draft
 * identifier as the plain string the interface carries everywhere else. Taking the shape from the
 * generated reference means a field added or renamed in Convex fails the build here.
 */
export type DraftInput = Omit<FunctionArgs<typeof uiApi.saveDraft>, 'draftId'> & { draftId?: string };
