import { useState, useRef, DragEvent } from "react";
import { Upload, File, Music, Video, Image as ImageIcon, Undo2, Redo2, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MediaFile, TimelineItem } from "./VideoEditor";
import { Track } from "./Timeline";

interface FilesBrowserProps {
  files: MediaFile[];
  onFilesAdded: (files: MediaFile[]) => void;
  onItemAddedToTimeline: (item: TimelineItem) => void;
  timelineItems: TimelineItem[];
  tracks: Track[];
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  historyIndex: number;
  historyLength: number;
}

export const FilesBrowser = ({
  files,
  onFilesAdded,
  onItemAddedToTimeline,
  timelineItems,
  tracks,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  historyIndex,
  historyLength
}: FilesBrowserProps) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    processFiles(droppedFiles);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      processFiles(selectedFiles);
    }
  };

  const processFiles = async (fileList: File[]) => {
    const mediaFiles: MediaFile[] = [];

    for (const file of fileList) {
      if (file.type.startsWith('video/') || file.type.startsWith('audio/') || file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        let duration = 0;
        let type: 'video' | 'audio' | 'image' = 'video';

        if (file.type.startsWith('video/')) {
          type = 'video';
          duration = await getMediaDuration(url, file.type);
        } else if (file.type.startsWith('audio/')) {
          type = 'audio';
          duration = await getMediaDuration(url, file.type);
        } else if (file.type.startsWith('image/')) {
          type = 'image';
          duration = 3; // Default 3 seconds for images
        }

        const mediaFile: MediaFile = {
          id: `${Date.now()}-${Math.random()}`,
          name: file.name,
          type,
          url,
          duration,
          file
        };

        mediaFiles.push(mediaFile);
      }
    }

    onFilesAdded(mediaFiles);
  };

  const getMediaDuration = (url: string, type: string): Promise<number> => {
    return new Promise((resolve) => {
      const element = type.startsWith('video/')
        ? document.createElement('video')
        : document.createElement('audio');

      element.src = url;
      element.onloadedmetadata = () => {
        resolve(element.duration || 0);
      };
      element.onerror = () => resolve(0);
    });
  };

  // AGGIORNATO: Trova la prima traccia disponibile del tipo specificato - ora include 'effect'
  const findFirstAvailableTrack = (mediaType: 'video' | 'audio' | 'image' | 'effect'): Track | null => {
    const targetType = (mediaType === 'video' || mediaType === 'image' || mediaType === 'effect') ? 'video' : 'audio';
    
    // Trova tutte le tracce del tipo corretto, ordinate per indice
    const relevantTracks = tracks
      .filter(track => track.type === targetType)
      .sort((a, b) => a.index - b.index);
    
    if (relevantTracks.length === 0) {
      return null; // Nessuna traccia del tipo corretto trovata
    }
    
    // Restituisce la prima traccia disponibile
    return relevantTracks[0];
  };

  // Calcola la posizione ottimale per un nuovo elemento nella timeline
  const calculateOptimalStartTime = (mediaFile: MediaFile): { startTime: number; track: number } => {
    const availableTrack = findFirstAvailableTrack(mediaFile.type);
    
    if (!availableTrack) {
      // Fallback: usa la traccia 0 se non ci sono tracce appropriate
      return { startTime: 0, track: 0 };
    }
    
    const targetTrack = availableTrack.index;
    
    // Trova tutti gli elementi nella traccia target
    const itemsInTrack = timelineItems.filter(item => item.track === targetTrack);

    if (itemsInTrack.length === 0) {
      return { startTime: 0, track: targetTrack }; // Se la traccia è vuota, inizia da 0
    }

    // Trova l'ultimo elemento nella traccia
    const lastItem = itemsInTrack.reduce((latest, current) => {
      const currentEndTime = current.startTime + current.duration;
      const latestEndTime = latest.startTime + latest.duration;
      return currentEndTime > latestEndTime ? current : latest;
    });

    // Restituisce il tempo di fine dell'ultimo elemento
    return { 
      startTime: lastItem.startTime + lastItem.duration, 
      track: targetTrack 
    };
  };

  const handleAddToTimeline = (file: MediaFile) => {
    const { startTime, track } = calculateOptimalStartTime(file);

    const newItem: TimelineItem = {
      id: `timeline-${Date.now()}-${Math.random()}`,
      mediaFile: file,
      startTime,
      duration: file.duration,
      track,
      mediaStartOffset: 0 // Nuovo elemento inizia dall'inizio del file
    };

    onItemAddedToTimeline(newItem);
  };

  // Funzione per ottenere il nome della traccia dove verrà aggiunto il file
  const getTargetTrackName = (file: MediaFile): string => {
    const availableTrack = findFirstAvailableTrack(file.type);
    return availableTrack ? availableTrack.label : 'Unknown Track';
  };

  // AGGIORNATO: Funzione per ottenere l'icona appropriata per il tipo di file
  const getFileIcon = (file: MediaFile) => {
    switch (file.type) {
      case 'video':
        return <Video className="w-4 h-4 text-video-track flex-shrink-0" />;
      case 'audio':
        return <Music className="w-4 h-4 text-audio-track flex-shrink-0" />;
      case 'image':
        return <ImageIcon className="w-4 h-4 text-image-icon flex-shrink-0" />;
      case 'effect':
        return <Sparkles className="w-4 h-4 text-red-500 flex-shrink-0" />;
      default:
        return <File className="w-4 h-4 text-muted-foreground flex-shrink-0" />;
    }
  };

  // AGGIORNATO: Funzione per ottenere il colore del testo del badge basato sul tipo
  const getFileTypeColor = (type: string) => {
    switch (type) {
      case 'video':
        return 'text-blue-600';
      case 'audio':
        return 'text-green-600';
      case 'image':
        return 'text-purple-600';
      case 'effect':
        return 'text-red-600';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header with Logo and Undo/Redo */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          {/* Logo - OPZIONE 1: Usando un'immagine dalla cartella public */}
          <div className="flex items-center space-x-2">
            <div className="w-16 h-16 rounded-md overflow-hidden flex items-center justify-center">
              <img 
                src="/lumo.png" 
                alt="Lumo Video Editor Logo" 
                className="w-full h-full object-contain"
                onError={(e) => {
                  // Fallback al logo di default se l'immagine non si carica
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                }}
              />
              {/* Fallback logo */}
              <div className="w-8 h-8 bg-gradient-primary rounded-md flex items-center justify-center hidden">
                <span className="text-white font-bold text-sm">VE</span>
              </div>
            </div>
          </div>

          {/* History indicator and Undo/Redo buttons */}
          <div className="flex items-center space-x-2">
            {/* History indicator */}
            <span className="text-xs text-muted-foreground/70 font-mono">
              {historyIndex + 1}/{historyLength}
            </span>
            
            {/* Undo/Redo buttons */}
            <div className="flex items-center space-x-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={onUndo}
                disabled={!canUndo}
                className="w-8 h-8 p-0 hover:bg-accent/50"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onRedo}
                disabled={!canRedo}
                className="w-8 h-8 p-0 hover:bg-accent/50"
                title="Redo (Ctrl+Y)"
              >
                <Redo2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        <h2 className="text-lg font-semibold text-foreground mb-4">Project Files</h2>

        {/* Drop Zone */}
        <Card
          className={`p-6 border-2 border-dashed transition-colors cursor-pointer ${
            isDragOver
              ? 'border-primary bg-primary/10'
              : 'border-muted-foreground/25 hover:border-primary/50'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="flex flex-col items-center text-center">
            <Upload className={`w-8 h-8 mb-2 ${isDragOver ? 'text-primary' : 'text-muted-foreground'}`} />
            <p className="text-sm text-muted-foreground">
              Drop video/audio/image files here or click to browse
            </p>
          </div>
        </Card>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/*,audio/*,image/*"
          onChange={handleFileInput}
          className="hidden"
        />
      </div>

      {/* Files List */}
      <div className="flex-1 overflow-y-auto p-4">
        {files.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No files imported yet
          </p>
        ) : (
          <div className="space-y-2">
            {files.map((file) => (
              <Card key={file.id} className="p-3 hover:bg-accent/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3 flex-1 min-w-0">
                    {getFileIcon(file)}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {file.name}
                      </p>
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-muted-foreground">
                          {Math.round(file.duration)}s → {getTargetTrackName(file)}
                        </p>
                        {/* Badge per indicare il tipo di file */}
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${getFileTypeColor(file.type)} bg-current/10`}>
                          {file.type.toUpperCase()}
                        </span>
                        {/* Badge speciale per gli effetti */}
                        {file.type === 'effect' && file.effectType && (
                          <span className="text-[10px] text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded">
                            {file.effectType.toUpperCase()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleAddToTimeline(file)}
                    className="ml-2 flex-shrink-0"
                    disabled={!findFirstAvailableTrack(file.type)}
                    title={
                      findFirstAvailableTrack(file.type) 
                        ? `Add to ${getTargetTrackName(file)}` 
                        : `No suitable track available for ${file.type}`
                    }
                  >
                    Add
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};