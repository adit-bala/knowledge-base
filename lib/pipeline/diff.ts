/**
 * Diff resolution for comparing fetched data with existing database.
 */

import type {PGliteDatabase} from '../db/pglite';
import type {Article} from '../db/schema';
import type {FetchedArticle, UpdatePlan} from './types';

export interface DiffResolver {
  /**
   * Compare fetched articles with existing database state.
   * Returns a plan of what needs to be created, updated, or skipped.
   */
  resolve(
    fetched: FetchedArticle[],
    existing: PGliteDatabase,
  ): Promise<UpdatePlan<FetchedArticle>>;
}

/**
 * Default diff resolver using lastEdited timestamp.
 */
export class TimestampDiffResolver implements DiffResolver {
  async resolve(
    fetched: FetchedArticle[],
    existingDb: PGliteDatabase,
  ): Promise<UpdatePlan<FetchedArticle>> {
    // Get existing articles from DB
    const existing = await existingDb.query<Article>(
      'SELECT id, last_edited FROM article',
    );
    const existingMap = new Map(
      existing.map(a => [a.id, {lastEdited: new Date(a.last_edited)}]),
    );

    const toCreate: FetchedArticle[] = [];
    const toUpdate: FetchedArticle[] = [];
    const toSkip: FetchedArticle[] = [];
    const fetchedIds = new Set(fetched.map(f => f.id));

    for (const article of fetched) {
      const existingArticle = existingMap.get(article.id);

      if (!existingArticle) {
        // New article
        toCreate.push(article);
      } else if (this.hasChanged(article, existingArticle)) {
        // Article was modified
        toUpdate.push(article);
      } else {
        // No changes
        toSkip.push(article);
      }
    }

    // Find articles to delete (in DB but not in fetched)
    const toDelete = existing.filter(e => !fetchedIds.has(e.id)).map(e => e.id);

    return {toCreate, toUpdate, toSkip, toDelete};
  }

  private hasChanged(
    fetched: FetchedArticle,
    existing: {lastEdited: Date},
  ): boolean {
    // Compare timestamps
    return fetched.lastEdited.getTime() !== existing.lastEdited.getTime();
  }
}
