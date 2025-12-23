
import Dexie, { type Table } from 'dexie';
import { ImageRecord } from './types';

// Use default export Dexie to ensure proper inheritance and type recognition
export class VisionQuestDB extends Dexie {
  images!: Table<ImageRecord>;

  constructor() {
    super('VisionQuestDB');
    // Fix: Ensure version() is recognized as an instance method of Dexie by using the standard default import
    this.version(1).stores({
      images: '++id, fileName, filePath, fileSize, pHash, *tags'
    });
  }
}

export const db = new VisionQuestDB();
