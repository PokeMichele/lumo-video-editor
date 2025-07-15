import { useState, useRef, DragEvent } from "react";
import { Upload, File, Music, Video, Image as ImageIcon, Undo2, Redo2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MediaFile, TimelineItem } from "./VideoEditor";

interface FilesBrowserProps {
  files: MediaFile[];
  onFilesAdded: (files: MediaFile[]) => void;
  onItemAddedToTimeline: (item: TimelineItem) => void;
  timelineItems: TimelineItem[];
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

  // Calcola la posizione ottimale per un nuovo elemento nella timeline
  const calculateOptimalStartTime = (mediaFile: MediaFile): number => {
    // Determina la traccia appropriata basata sul tipo di media
    let targetTrack = 0;
    if (mediaFile.type === 'video' || mediaFile.type === 'image') {
      targetTrack = 0; // Video track
    } else if (mediaFile.type === 'audio') {
      // Trova la prima traccia audio disponibile (1 o 2)
      const track1Items = timelineItems.filter(item => item.track === 1);
      const track2Items = timelineItems.filter(item => item.track === 2);

      // Usa la traccia con meno elementi, o la 1 se sono uguali
      targetTrack = track1Items.length <= track2Items.length ? 1 : 2;
    }

    // Trova tutti gli elementi nella traccia target
    const itemsInTrack = timelineItems.filter(item => item.track === targetTrack);

    if (itemsInTrack.length === 0) {
      return 0; // Se la traccia è vuota, inizia da 0
    }

    // Trova l'ultimo elemento nella traccia
    const lastItem = itemsInTrack.reduce((latest, current) => {
      const currentEndTime = current.startTime + current.duration;
      const latestEndTime = latest.startTime + latest.duration;
      return currentEndTime > latestEndTime ? current : latest;
    });

    // Restituisce il tempo di fine dell'ultimo elemento
    return lastItem.startTime + lastItem.duration;
  };

  const handleAddToTimeline = (file: MediaFile) => {
    const startTime = calculateOptimalStartTime(file);

    // Determina la traccia appropriata
    let track = 0;
    if (file.type === 'video' || file.type === 'image') {
      track = 0; // Video track
    } else if (file.type === 'audio') {
      // Trova la prima traccia audio disponibile (1 o 2)
      const track1Items = timelineItems.filter(item => item.track === 1);
      const track2Items = timelineItems.filter(item => item.track === 2);
      track = track1Items.length <= track2Items.length ? 1 : 2;
    }

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

  return (
    <div className="h-full flex flex-col">
      {/* Header with Logo and Undo/Redo */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          {/* Logo placeholder */}
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-primary rounded-md flex items-center justify-center">
              <span className="text-white font-bold text-sm">VE</span>
            </div>
            <span className="text-sm font-medium text-muted-foreground">Video Editor</span>
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
                    {file.type === 'video' ? (
                      <Video className="w-4 h-4 text-video-track flex-shrink-0" />
                    ) : file.type === 'audio' ? (
                      <Music className="w-4 h-4 text-audio-track flex-shrink-0" />
                    ) : (
                      <ImageIcon className="w-4 h-4 text-image-icon flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {file.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {Math.round(file.duration)}s
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleAddToTimeline(file)}
                    className="ml-2 flex-shrink-0"
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