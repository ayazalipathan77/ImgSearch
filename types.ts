
export interface ImageRecord {
  id?: number;
  fileName: string;
  filePath: string;
  fileSize: number;
  lastModified: number;
  width: number;
  height: number;
  thumbnail: string; // Base64 or Blob URL
  pHash?: string;
  embedding?: number[];
  tags?: string[];
}

export enum AppView {
  Library = 'library',
  Search = 'search',
  Duplicates = 'duplicates',
  Settings = 'settings'
}

export interface SearchResult {
  image: ImageRecord;
  similarity: number;
}
