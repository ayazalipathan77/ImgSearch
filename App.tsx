
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  FolderSearch, 
  Image as ImageIcon, 
  Search, 
  Settings as SettingsIcon, 
  Layers, 
  Loader2, 
  Trash2, 
  ZoomIn, 
  Maximize2,
  X,
  CheckCircle2,
  Info,
  AlertCircle
} from 'lucide-react';
import { db } from './db';
import { ImageRecord, AppView, SearchResult } from './types';
import { generateThumbnail, calculatePHash, hammingDistance } from './imageProcessing';
import { analyzeImageSemantics, searchByDescription } from './geminiService';

const App: React.FC = () => {
  const [activeView, setActiveView] = useState<AppView>(AppView.Library);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [isIndexing, setIsIndexing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedImage, setSelectedImage] = useState<ImageRecord | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadLibrary();
  }, []);

  const loadLibrary = async () => {
    try {
      const allImages = await db.images.toArray();
      setImages(allImages);
    } catch (err) {
      console.error("Failed to load library:", err);
      setErrorMessage("Database access failed. Please ensure IndexedDB is enabled.");
    }
  };

  const processFileList = async (fileList: FileList | File[]) => {
    setIsIndexing(true);
    setProgress(0);
    setErrorMessage(null);
    
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    
    if (files.length === 0) {
      setErrorMessage("No supported image files found in the selected folder.");
      setIsIndexing(false);
      return;
    }

    let processedCount = 0;
    for (const file of files) {
      try {
        // Skip if already in DB (by name and size for basic uniqueness)
        const existing = await db.images.where('fileName').equals(file.name).first();
        if (existing && existing.fileSize === file.size) {
          processedCount++;
          setProgress(Math.round((processedCount / files.length) * 100));
          continue;
        }

        const { thumbnail, width, height } = await generateThumbnail(file);
        const pHash = await calculatePHash(thumbnail);
        
        // Semantic Analysis via Gemini (limit to first 5 for performance/quota)
        let tags: string[] = [];
        if (processedCount < 5) {
          tags = await analyzeImageSemantics(thumbnail);
        }

        await db.images.add({
          fileName: file.name,
          filePath: (file as any).webkitRelativePath || file.name,
          fileSize: file.size,
          lastModified: file.lastModified,
          width,
          height,
          thumbnail,
          pHash,
          tags
        });
      } catch (err) {
        console.warn(`Failed to process ${file.name}:`, err);
      }

      processedCount++;
      setProgress(Math.round((processedCount / files.length) * 100));
    }

    await loadLibrary();
    setIsIndexing(false);
  };

  const handleIndexFolder = async () => {
    setErrorMessage(null);
    
    // Check for Modern File System Access API
    if ('showDirectoryPicker' in window) {
      try {
        // @ts-ignore
        const dirHandle = await window.showDirectoryPicker();
        const files: File[] = [];
        
        async function scan(handle: any) {
          for await (const entry of handle.values()) {
            if (entry.kind === 'file') {
              const file = await entry.getFile();
              if (file.type.startsWith('image/')) {
                files.push(file);
              }
            } else if (entry.kind === 'directory') {
              await scan(entry);
            }
          }
        }

        await scan(dirHandle);
        await processFileList(files);
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.error("Directory picker failed, falling back:", err);
        // Fallback to traditional input
        fileInputRef.current?.click();
      }
    } else {
      // Direct fallback for browsers without showDirectoryPicker (Firefox, Safari, etc.)
      fileInputRef.current?.click();
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFileList(e.target.files);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setActiveView(AppView.Library);
      return;
    }

    const results: SearchResult[] = [];
    
    // First, keyword matching
    images.forEach(img => {
      let score = 0;
      if (img.fileName.toLowerCase().includes(searchQuery.toLowerCase())) score += 0.8;
      if (img.tags?.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))) score += 1.0;
      
      if (score > 0) {
        results.push({ image: img, similarity: score });
      }
    });

    // If no results, try Gemini to find "semantic intent"
    if (results.length === 0) {
      const allTags = Array.from(new Set(images.flatMap(i => i.tags || []))) as string[];
      if (allTags.length > 0) {
        const relevantKeywords = await searchByDescription(searchQuery, allTags);
        images.forEach(img => {
          const overlap = img.tags?.filter(t => relevantKeywords.includes(t)) || [];
          if (overlap.length > 0) {
            results.push({ image: img, similarity: overlap.length / relevantKeywords.length });
          }
        });
      }
    }

    setSearchResults(results.sort((a, b) => b.similarity - a.similarity));
    setActiveView(AppView.Search);
  };

  const findDuplicates = async () => {
    const results: SearchResult[] = [];
    const seenHashes = new Map<string, ImageRecord>();

    for (const img of images) {
      if (!img.pHash) continue;
      
      let matched = false;
      for (const [hash, existingImg] of seenHashes.entries()) {
        const dist = hammingDistance(hash, img.pHash);
        if (dist < 5) { // Threshold for near-duplicates
          results.push({ image: img, similarity: 1 - (dist / 64) });
          matched = true;
          break;
        }
      }
      if (!matched) seenHashes.set(img.pHash, img);
    }

    setSearchResults(results);
    setActiveView(AppView.Duplicates);
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 overflow-hidden select-none">
      {/* Hidden Fallback Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={onFileInputChange} 
        style={{ display: 'none' }} 
        // @ts-ignore
        webkitdirectory="true" 
        directory="true"
        multiple 
      />

      {/* Sidebar */}
      <nav className="w-64 border-r border-slate-800 bg-slate-900 flex flex-col p-4 space-y-2">
        <div className="flex items-center space-x-3 px-2 mb-8">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Layers className="text-white w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">VisionQuest</h1>
        </div>

        <NavItem 
          icon={<ImageIcon size={18} />} 
          label="Library" 
          active={activeView === AppView.Library} 
          onClick={() => setActiveView(AppView.Library)} 
          badge={images.length}
        />
        <NavItem 
          icon={<Search size={18} />} 
          label="Semantic Search" 
          active={activeView === AppView.Search} 
          onClick={() => setActiveView(AppView.Search)} 
        />
        <NavItem 
          icon={<Layers size={18} />} 
          label="Duplicates" 
          active={activeView === AppView.Duplicates} 
          onClick={findDuplicates} 
        />
        <NavItem 
          icon={<SettingsIcon size={18} />} 
          label="Settings" 
          active={activeView === AppView.Settings} 
          onClick={() => setActiveView(AppView.Settings)} 
        />

        <div className="mt-auto pt-4 border-t border-slate-800">
          {errorMessage && (
            <div className="mb-4 p-3 bg-red-900/20 border border-red-500/30 rounded-lg flex items-start space-x-2 text-red-400 text-xs">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}
          <button 
            onClick={handleIndexFolder}
            className="w-full flex items-center justify-center space-x-2 bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl transition-all duration-200 font-medium active:scale-95"
          >
            <FolderSearch size={18} />
            <span>Index New Folder</span>
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-950">
        <header className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900/50 backdrop-blur-md sticky top-0 z-10">
          <div className="flex-1 max-w-2xl relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input 
              type="text"
              placeholder="Search by keywords or semantic description..."
              className="w-full bg-slate-800 border-none rounded-lg py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-indigo-500 transition-all outline-none text-slate-200"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <div className="flex items-center space-x-4">
             <div className="flex items-center space-x-2 text-xs font-medium bg-slate-800 px-3 py-1.5 rounded-full border border-slate-700">
                <span className={`w-2 h-2 rounded-full ${'showDirectoryPicker' in window ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`}></span>
                <span className="text-slate-400">
                  {'showDirectoryPicker' in window ? 'FS Access Ready' : 'Classic Mode'}
                </span>
             </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
          {images.length === 0 && !isIndexing ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-4">
              <div className="p-8 bg-slate-900 rounded-full border border-slate-800">
                <FolderSearch size={48} className="text-slate-700" />
              </div>
              <div className="text-center">
                <h3 className="text-xl font-semibold text-slate-300">No images indexed</h3>
                <p className="text-slate-500 mt-1 max-w-sm">
                  Connect a local folder to start visual and semantic indexing of your collection.
                </p>
                <button 
                  onClick={handleIndexFolder}
                  className="mt-6 px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors flex items-center space-x-2 mx-auto"
                >
                  <FolderSearch size={18} />
                  <span>Connect Folder</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-white capitalize">
                    {activeView === AppView.Search ? 'Search Results' : 
                     activeView === AppView.Duplicates ? 'Potential Duplicates' : 'Media Library'}
                  </h2>
                  <p className="text-slate-500 text-sm mt-1">
                    {activeView === AppView.Search ? `${searchResults.length} matching visual patterns found` :
                     activeView === AppView.Library ? `${images.length} total indexed assets` : 'Identifying visual twins using pHash'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {(activeView === AppView.Library ? images : searchResults.map(r => r.image)).map((img, idx) => (
                  <div 
                    key={`${img.fileName}-${img.id || idx}`}
                    className="group relative bg-slate-900 rounded-xl overflow-hidden border border-slate-800 hover:border-indigo-500/50 transition-all cursor-pointer shadow-lg hover:shadow-indigo-500/10"
                    onClick={() => setSelectedImage(img)}
                  >
                    <div className="aspect-square bg-slate-800 flex items-center justify-center overflow-hidden">
                      <img 
                        src={img.thumbnail} 
                        alt={img.fileName} 
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                    </div>
                    <div className="p-3">
                      <p className="text-xs font-medium text-slate-300 truncate" title={img.fileName}>
                        {img.fileName}
                      </p>
                      <div className="flex items-center justify-between mt-1 text-[10px] text-slate-500 uppercase tracking-wider font-bold">
                        <span>{img.width}x{img.height}</span>
                        <span>{(img.fileSize / (1024 * 1024)).toFixed(1)}MB</span>
                      </div>
                    </div>
                    {activeView !== AppView.Library && (
                      <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/60 backdrop-blur rounded text-[10px] font-bold text-indigo-400">
                        {Math.round((searchResults.find(r => r.image.id === img.id)?.similarity || 0) * 100)}% Match
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </main>

      {/* Progress Overlay */}
      {isIndexing && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl shadow-2xl max-w-md w-full">
            <div className="flex items-center space-x-4 mb-6">
              <div className="bg-indigo-600/20 p-3 rounded-lg">
                <Loader2 className="text-indigo-500 animate-spin" size={24} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Indexing Asset Collection</h3>
                <p className="text-sm text-slate-400">Generating pHash signatures & metadata...</p>
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="flex justify-between text-xs font-medium">
                <span className="text-slate-500 uppercase tracking-widest">Progress</span>
                <span className="text-indigo-400">{progress}%</span>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-indigo-500 h-full transition-all duration-300 ease-out shadow-[0_0_10px_rgba(99,102,241,0.5)]" 
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex items-center space-x-2 mt-4 text-[10px] text-slate-500">
                <Info size={12} />
                <span>Large images are tiled and downscaled for memory safety.</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detailed View Modal */}
      {selectedImage && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={() => setSelectedImage(null)} />
          <div className="relative bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex max-w-5xl w-full h-[80vh] flex-col md:flex-row">
            <button 
              className="absolute top-4 right-4 z-20 p-2 bg-slate-800/50 hover:bg-slate-700 text-white rounded-full transition-colors"
              onClick={() => setSelectedImage(null)}
            >
              <X size={20} />
            </button>
            
            <div className="flex-1 bg-black flex items-center justify-center overflow-hidden min-h-0">
              <img src={selectedImage.thumbnail} alt="" className="max-w-full max-h-full object-contain" />
              <div className="absolute bottom-6 left-6 flex space-x-2 hidden md:flex">
                 <button className="bg-white/10 hover:bg-white/20 backdrop-blur px-4 py-2 rounded-lg flex items-center space-x-2 text-white text-sm">
                   <Maximize2 size={16} />
                   <span>View Full Size</span>
                 </button>
                 <button className="bg-white/10 hover:bg-white/20 backdrop-blur px-4 py-2 rounded-lg flex items-center space-x-2 text-white text-sm">
                   <ZoomIn size={16} />
                   <span>Inspect Pixels</span>
                 </button>
              </div>
            </div>

            <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-slate-800 flex flex-col p-6 overflow-y-auto shrink-0">
              <h4 className="text-lg font-bold text-white mb-1 truncate">{selectedImage.fileName}</h4>
              <p className="text-xs text-slate-500 mb-6 font-mono break-all">{selectedImage.filePath}</p>
              
              <div className="space-y-6">
                <DetailRow label="Dimensions" value={`${selectedImage.width} x ${selectedImage.height} px`} />
                <DetailRow label="File Size" value={`${(selectedImage.fileSize / (1024 * 1024)).toFixed(2)} MB`} />
                <DetailRow label="Modified" value={new Date(selectedImage.lastModified).toLocaleDateString()} />
                
                <div>
                  <h5 className="text-[10px] uppercase font-bold text-slate-500 mb-2 tracking-widest">Semantic Insights</h5>
                  <div className="flex flex-wrap gap-2">
                    {selectedImage.tags?.map(tag => (
                      <span key={tag} className="px-3 py-1 bg-indigo-600/20 text-indigo-300 rounded-full text-xs font-medium border border-indigo-500/20">
                        {tag}
                      </span>
                    )) || <span className="text-xs text-slate-600 italic">No semantic data indexed</span>}
                  </div>
                </div>

                <div className="pt-6 border-t border-slate-800 space-y-2 mt-auto">
                   <button className="w-full flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 rounded-lg text-sm font-semibold transition-all">
                     <FolderSearch size={16} />
                     <span>Reveal in Folder</span>
                   </button>
                   <button 
                    onClick={async () => {
                      if (selectedImage.id) {
                        await db.images.delete(selectedImage.id);
                        setSelectedImage(null);
                        loadLibrary();
                      }
                    }}
                    className="w-full flex items-center justify-center space-x-2 bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white py-2.5 rounded-lg text-sm font-semibold transition-all"
                  >
                     <Trash2 size={16} />
                     <span>Remove from Index</span>
                   </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const NavItem: React.FC<{ 
  icon: React.ReactNode; 
  label: string; 
  active?: boolean; 
  onClick: () => void;
  badge?: number;
}> = ({ icon, label, active, onClick, badge }) => (
  <button 
    onClick={onClick}
    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all duration-200 group ${
      active ? 'bg-indigo-600/10 text-indigo-400' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
    }`}
  >
    <div className="flex items-center space-x-3">
      <span className={`${active ? 'text-indigo-500' : 'text-slate-500 group-hover:text-slate-300'}`}>{icon}</span>
      <span className="font-medium text-sm">{label}</span>
    </div>
    {badge !== undefined && (
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${active ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-500'}`}>
        {badge}
      </span>
    )}
  </button>
);

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <h5 className="text-[10px] uppercase font-bold text-slate-500 mb-1 tracking-widest">{label}</h5>
    <p className="text-sm font-medium text-slate-200">{value}</p>
  </div>
);

export default App;
