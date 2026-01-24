/**
 * Database module - re-exports all public APIs.
 */

export {PGliteDatabase} from './pglite';
export type {TransactionScope} from './pglite';

export {SCHEMA} from './schema';
export type {Article, Image, Embedding} from './schema';
